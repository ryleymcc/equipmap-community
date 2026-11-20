from contextlib import closing
import json
import multiprocessing
import sqlite3

import pytest

from shared_store import SharedStore, Conflict


def hold_coordination_lock(root, ready):
    store = SharedStore(root)
    with store.lock():
        ready.put(True)
        import time
        time.sleep(30)


@pytest.fixture
def snapshot(tmp_path):
    database = tmp_path / 'local.sqlite3'
    with closing(sqlite3.connect(database)) as connection:
        connection.execute('CREATE TABLE records (id INTEGER PRIMARY KEY, name TEXT)')
        connection.execute("INSERT INTO records VALUES (1, 'first')")
        connection.commit()
    uploads = tmp_path / 'uploads'
    uploads.mkdir()
    (uploads / 'manual.txt').write_text('shared bytes')
    return SharedStore(tmp_path / 'share'), database, uploads


def test_conflicting_commit_cannot_replace_another_clients_revision(snapshot):
    store, database, uploads = snapshot
    first = store.publish(None, database, uploads)
    second_client = SharedStore(store.root)
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("UPDATE records SET name='second' WHERE id=1")
        connection.commit()
    second = second_client.publish(first['revision'], database, uploads)
    with pytest.raises(Conflict):
        store.publish(first['revision'], database, uploads)
    assert store.read_current() == second


def test_publication_failure_keeps_previous_revision_usable(snapshot, monkeypatch, tmp_path):
    store, database, uploads = snapshot
    first = store.publish(None, database, uploads)
    import shared_store
    real_atomic = shared_store.atomic_json
    def disk_full(path, value):
        if path.name == 'current.json':
            raise OSError('Simulated storage failure')
        real_atomic(path, value)
    monkeypatch.setattr(shared_store, 'atomic_json', disk_full)
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("UPDATE records SET name='not committed' WHERE id=1")
        connection.commit()
    with pytest.raises(OSError):
        store.publish(first['revision'], database, uploads)
    assert store.read_current() == first
    restored = tmp_path / 'restored.sqlite3'
    store.restore(first, restored, tmp_path / 'restored-uploads')
    with closing(sqlite3.connect(restored)) as connection:
        assert connection.execute('SELECT name FROM records').fetchone()[0] == 'first'


def test_missing_authoritative_pointer_does_not_create_an_empty_database(snapshot):
    store, database, uploads = snapshot
    store.publish(None, database, uploads)
    (store.root / 'current.json').unlink()
    with pytest.raises(RuntimeError, match='commit pointer is missing'):
        store.read_current()


def test_corrupted_shared_file_blocks_restore_and_republication(snapshot, tmp_path):
    store, database, uploads = snapshot
    pointer = store.publish(None, database, uploads)
    manifest = json.loads((store.revisions / (pointer['revision'] + '.json')).read_text())
    (store.blobs / manifest['files']['manual.txt']).write_text('corrupted')
    with pytest.raises(RuntimeError, match='checksum failed'):
        store.restore(pointer, tmp_path / 'restored.sqlite3', tmp_path / 'restored-uploads')
    with pytest.raises(RuntimeError, match='checksum'):
        store.publish(pointer['revision'], database, uploads)


def test_local_cache_can_be_reconstructed_with_files_and_credentials(snapshot, tmp_path):
    store, database, uploads = snapshot
    pointer = store.publish(None, database, uploads)
    restored = tmp_path / 'other-user.sqlite3'
    store.restore(pointer, restored, tmp_path / 'other-user-uploads')
    with closing(sqlite3.connect(restored)) as connection:
        assert connection.execute('SELECT name FROM records').fetchone()[0] == 'first'
    assert (tmp_path / 'other-user-uploads/manual.txt').read_text() == 'shared bytes'
    assert SharedStore(store.root).settings['secret_key'] == store.settings['secret_key']


def test_crashed_process_does_not_leave_a_permanent_coordination_lock(snapshot):
    store, _, _ = snapshot
    context = multiprocessing.get_context('spawn')
    ready = context.Queue()
    process = context.Process(target=hold_coordination_lock, args=(store.root, ready))
    process.start()
    try:
        assert ready.get(timeout=10) is True
        with pytest.raises(TimeoutError):
            with store.lock(timeout=.1):
                pass
    finally:
        process.terminate()
        process.join(timeout=10)
        ready.close()
    with store.lock(timeout=2):
        assert True
