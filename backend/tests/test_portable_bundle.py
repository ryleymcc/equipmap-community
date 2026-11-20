import asyncio
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import zipfile

import pytest
from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, func
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from portable_bundle import database_snapshot, build_bundle


@pytest.fixture
def exported(tmp_path):
    async def capture():
        metadata = MetaData()
        users = Table('users', metadata, Column('id', Integer, primary_key=True),
            Column('username', String), Column('hashed_password', String),
            Column('created_at', DateTime, server_default=func.now(), nullable=False))
        for name in ('refresh_tokens', 'revoked_tokens', 'chatgpt_grants'):
            Table(name, metadata, Column('id', Integer, primary_key=True), Column('credential', String))
        engine = create_async_engine('sqlite+aiosqlite:///' + (tmp_path / 'source.sqlite3').as_posix())
        async with engine.begin() as connection:
            await connection.run_sync(metadata.create_all)
            await connection.execute(users.insert(), {'id': 1, 'username': 'operator', 'hashed_password': 'existing-hash'})
            for name in ('refresh_tokens', 'revoked_tokens', 'chatgpt_grants'):
                await connection.execute(metadata.tables[name].insert(), {'id': 1, 'credential': 'must-not-export'})
        result = await database_snapshot(engine)
        await engine.dispose()
        return result
    snapshot = asyncio.run(capture())
    template = tmp_path / 'template.zip'
    with zipfile.ZipFile(template, 'w') as archive:
        archive.writestr('EquipMap-Shared/EquipMap-Shared.exe', b'MZ-test-template')
    uploads = tmp_path / 'uploads'
    uploads.mkdir()
    (uploads / 'drawing.pdf').write_bytes(b'PDF fixture')
    (uploads / 'unreferenced-cache.json').write_text('must-not-export')
    work = tmp_path / 'work'
    work.mkdir()
    return template, uploads, work, snapshot


def test_bundle_retains_accounts_and_files_without_live_credentials(exported, tmp_path):
    archive, report = build_bundle(*exported)
    with zipfile.ZipFile(archive) as bundle:
        prefix = 'EquipMap-Shared/EquipMap Data/'
        pointer = json.loads(bundle.read(prefix + 'current.json'))
        manifest = json.loads(bundle.read(prefix + 'revisions/' + pointer['revision'] + '.json'))
        database = tmp_path / 'verify.sqlite3'
        database.write_bytes(bundle.read(prefix + 'blobs/' + manifest['database']))
        assert set(manifest['files']) == {'drawing.pdf'}
        assert report['row_counts'] == {'users': 1}
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute('SELECT username, hashed_password FROM users').fetchone() == ('operator', 'existing-hash')
        assert connection.execute("SELECT name FROM sqlite_master WHERE name IN ('refresh_tokens','chatgpt_grants')").fetchall() == []
        connection.execute("INSERT INTO users (username,hashed_password) VALUES ('new','new-hash')")
        assert connection.execute("SELECT created_at FROM users WHERE username='new'").fetchone()[0]


def test_template_containing_previous_user_data_is_rejected(exported):
    template, uploads, work, snapshot = exported
    with zipfile.ZipFile(template, 'a') as archive:
        archive.writestr('EquipMap-Shared/EquipMap Data/current.json', '{}')
    with pytest.raises(RuntimeError, match='already contains user data'):
        build_bundle(template, uploads, work, snapshot)


def test_missing_referenced_upload_does_not_create_download(exported):
    template, uploads, work, (metadata, rows, captured) = exported
    table = Table('floorplans', metadata, Column('id', Integer, primary_key=True), Column('file_path', String))
    rows[table.name] = [{'id': 1, 'file_path': '/uploads/missing.pdf'}]
    with pytest.raises(RuntimeError, match='referenced upload is missing'):
        build_bundle(template, uploads, work, (metadata, rows, captured))
    assert not (work / 'EquipMap-Shared.zip').exists()
