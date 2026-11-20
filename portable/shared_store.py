"""Immutable shared-folder snapshots with Windows byte locks and revision checks.

SQLite is opened only in the local cache. The share carries ordinary closed
snapshot/blob files; no live database or SQLite journal is opened over SMB.
"""
import asyncio
from contextlib import asynccontextmanager, contextmanager, closing
import hashlib
import json
import logging
import msvcrt
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import sqlite3
import time
import uuid


class Conflict(RuntimeError):
    pass


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def atomic_json(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as output:
            json.dump(value, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class SharedStore:
    FORMAT = 1

    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.blobs = self.root / 'blobs'
        self.revisions = self.root / 'revisions'
        self.blobs.mkdir(exist_ok=True)
        self.revisions.mkdir(exist_ok=True)
        with self.lock():
            settings = self.root / 'shared-settings.json'
            if not settings.exists():
                atomic_json(settings, dict(format=self.FORMAT, store_id=uuid.uuid4().hex,
                                           secret_key=secrets.token_urlsafe(48)))
            self.settings = json.loads(settings.read_text())
            if self.settings['format'] != self.FORMAT:
                raise RuntimeError('Unsupported shared data format. Use the matching EquipMap edition.')

    @contextmanager
    def lock(self, timeout=30):
        # SMB byte-range locks are released by Windows if the process dies.
        # Never remove or replace this coordination file while any app is open.
        with (self.root / 'coordination.lock').open('a+b') as handle:
            handle.seek(0, 2)
            if handle.tell() == 0:
                handle.write(b'0')
                handle.flush()
            deadline = time.monotonic() + timeout
            while True:
                handle.seek(0)
                try:
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError('Shared folder is busy or unavailable. Nothing has been saved locally as a substitute.')
                    time.sleep(.05)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

    def current(self):
        # Called under the coordination lock, avoiding replace/open races on SMB.
        path = self.root / 'current.json'
        if not path.exists():
            if json.loads((self.root / 'shared-settings.json').read_text()).get('initialized'):
                raise RuntimeError('The shared commit pointer is missing. Restore the shared folder backup; do not create a new database here.')
            return None
        pointer = json.loads(path.read_text())
        if not re.fullmatch('[a-f0-9]{32}', pointer['revision']):
            raise RuntimeError('Invalid shared revision pointer')
        return pointer

    def read_current(self):
        with self.lock():
            return self.current()

    def put_blob(self, path):
        key = digest(path)
        target = self.blobs / key
        if target.exists() and digest(target) != key:
            raise RuntimeError('An existing shared file failed its checksum; the save was not published.')
        if not target.exists():
            temporary = self.blobs / (key + '.' + uuid.uuid4().hex + '.tmp')
            try:
                with path.open('rb') as source, temporary.open('xb') as output:
                    shutil.copyfileobj(source, output)
                    output.flush()
                    os.fsync(output.fileno())
                if digest(temporary) != key:
                    raise RuntimeError('A source file changed during save. Retry the operation.')
                # Concurrent identical blob writes are harmless: same hash/bytes.
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        return key

    def blob(self, key):
        if not re.fullmatch('[a-f0-9]{64}', key):
            raise RuntimeError('Invalid shared blob identifier')
        path = self.blobs / key
        if digest(path) != key:
            raise RuntimeError('Shared data checksum failed. Stop and restore a known-good backup.')
        return path

    def publish(self, expected, database, uploads):
        # Snapshot the CLOSED/idle local database using SQLite's backup API.
        temporary = database.with_name('snapshot-' + uuid.uuid4().hex + '.sqlite3')
        try:
            with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(temporary)) as destination:
                source.backup(destination)
                if destination.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Local database failed its integrity check')
            files = {}
            for path in sorted(uploads.rglob('*')):
                if path.is_file():
                    if path.is_symlink() or not path.resolve().is_relative_to(uploads.resolve()):
                        raise RuntimeError('Upload files must stay inside the data folder')
                    files[path.relative_to(uploads).as_posix()] = self.put_blob(path)
            revision = uuid.uuid4().hex
            manifest = dict(format=self.FORMAT, database=self.put_blob(temporary), files=files)
            manifest_file = self.revisions / (revision + '.json')
            atomic_json(manifest_file, manifest)
            pointer = dict(revision=revision, manifest_sha256=digest(manifest_file))
            # A fresh lock is acquired AFTER preparing immutable data. If another
            # PC saved meanwhile, never overwrite it or silently retry the edit.
            with self.lock():
                current = self.current()
                if (current['revision'] if current else None) != expected:
                    raise Conflict('Another PC saved changes. Refresh the record and try your change again.')
                if current is None:
                    atomic_json(self.root / 'shared-settings.json', {**self.settings, 'initialized': True})
                atomic_json(self.root / 'current.json', pointer)
            return pointer
        finally:
            temporary.unlink(missing_ok=True)

    def restore(self, pointer, database, uploads):
        manifest_path = self.revisions / (pointer['revision'] + '.json')
        if digest(manifest_path) != pointer['manifest_sha256']:
            raise RuntimeError('Shared revision checksum failed')
        manifest = json.loads(manifest_path.read_text())
        if manifest['format'] != self.FORMAT:
            raise RuntimeError('Unsupported shared snapshot format')
        source_db = self.blob(manifest['database'])
        # Validate every reference before changing any local cached data.
        sources = {}
        for relative, key in manifest['files'].items():
            name = PurePosixPath(relative)
            if name.is_absolute() or '..' in name.parts or '\\' in relative or ':' in relative:
                raise RuntimeError('Invalid shared upload path')
            sources[relative] = self.blob(key)
        database.parent.mkdir(parents=True, exist_ok=True)
        incoming = database.with_name('incoming-' + uuid.uuid4().hex + '.sqlite3')
        try:
            shutil.copy2(source_db, incoming)
            if digest(incoming) != source_db.name:
                raise RuntimeError('Shared database copy checksum failed')
            with closing(sqlite3.connect(incoming)) as source, closing(sqlite3.connect(database)) as destination:
                source.backup(destination)
        finally:
            incoming.unlink(missing_ok=True)
        uploads.mkdir(exist_ok=True)
        for path in uploads.rglob('*'):
            if path.is_file() and path.relative_to(uploads).as_posix() not in sources:
                path.unlink()
        for relative, source in sources.items():
            target = uploads / relative
            if not target.exists() or digest(target) != source.name:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)


class SharedTransactions:
    def __init__(self, store, database, uploads):
        self.store, self.database, self.uploads = store, database, uploads
        self.revision = None
        self.valid = False
        self.local_lock = asyncio.Lock()

    async def sync(self):
        from database import engine
        pointer = await asyncio.to_thread(self.store.read_current)
        revision = pointer['revision'] if pointer else None
        if not self.valid or revision != self.revision:
            await engine.dispose()
            if pointer:
                await asyncio.to_thread(self.store.restore, pointer, self.database, self.uploads)
            elif self.database.exists():
                raise RuntimeError('Shared data is missing. Refusing to use an uncommitted local database.')
            self.revision, self.valid = revision, True
        return pointer

    def state_hash(self):
        # API reads must not re-read every photo/manual just to detect writes.
        # All actual snapshot/blob content is still hashed during publication.
        def stamp(path):
            stat = path.stat()
            return stat.st_size, stat.st_mtime_ns
        return (stamp(self.database) if self.database.exists() else None,
                {str(p.relative_to(self.uploads)): stamp(p) for p in self.uploads.rglob('*') if p.is_file()})

    @asynccontextmanager
    async def transaction(self):
        async with self.local_lock:
            await self.sync()
            before = await asyncio.to_thread(self.state_hash)
            try:
                yield
                after = await asyncio.to_thread(self.state_hash)
                if before != after:
                    pointer = await asyncio.to_thread(self.store.publish, self.revision, self.database, self.uploads)
                    self.revision = pointer['revision']
            except BaseException:
                self.valid = False
                raise


class SharedRequests:
    def __init__(self, app, transactions):
        self.app, self.transactions = app, transactions

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith(('/api/', '/uploads/')):
            await self.app(scope, receive, send)
            return
        from starlette.responses import JSONResponse
        messages = []
        async def collect(message):
            messages.append(message)
        try:
            async with self.transactions.transaction():
                await self.app(scope, receive, collect)
                start = next(m for m in messages if m['type'] == 'http.response.start')
                if start['status'] >= 500:
                    raise RuntimeError('Operation failed; shared changes were not published.')
        except Conflict as exc:
            await JSONResponse({'detail': str(exc)}, status_code=409)(scope, receive, send)
            return
        except Exception:
            logging.exception('Shared operation failed')
            await JSONResponse({'detail': 'Shared storage is unavailable or this operation failed. Your change was not confirmed; reconnect and reload before retrying.'}, status_code=503)(scope, receive, send)
            return
        # A success response cannot escape until its shared snapshot is durable.
        for message in messages:
            await send(message)
