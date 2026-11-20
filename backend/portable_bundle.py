"""Build a private, fresh Windows Shared bundle from a read-only DB snapshot."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import uuid
import zipfile

from sqlalchemy import MetaData, create_engine, select, text

EXCLUDED = {'refresh_tokens', 'revoked_tokens'}
SUFFIXES = {'.pdf', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.glb', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.ico'}


async def database_snapshot(engine):
    async with engine.connect() as connection:
        if engine.dialect.name == 'postgresql':
            connection = await connection.execution_options(isolation_level='REPEATABLE READ')
        async with connection.begin():
            if engine.dialect.name == 'postgresql':
                await connection.execute(text('SET TRANSACTION READ ONLY'))
            metadata = MetaData()
            await connection.run_sync(metadata.reflect)
            rows = {}
            for table in metadata.sorted_tables:
                if table.name.startswith('chatgpt_') or table.name in EXCLUDED:
                    continue
                rows[table.name] = [dict(row) for row in (await connection.execute(select(table))).mappings()]
            return metadata, rows, datetime.now(timezone.utc).isoformat()


def build_bundle(template, uploads, work, snapshot):
    metadata, rows, captured = snapshot
    template, uploads, work = Path(template), Path(uploads).resolve(), Path(work)
    prefix = 'EquipMap-Shared/'
    with zipfile.ZipFile(template) as archive:
        names = archive.namelist()
        if prefix + 'EquipMap-Shared.exe' not in names or any(name.startswith(prefix + 'EquipMap Data/') for name in names):
            raise RuntimeError('Portable template is invalid or already contains user data')
    # Reflected types retain production-only fields/tables without dropping data.
    target = MetaData()
    for table in metadata.sorted_tables:
        if table.name in rows:
            table.to_metadata(target)
    for table in target.tables.values():
        for column in table.columns:
            if column.server_default is not None:
                value = str(column.server_default.arg)
                column.server_default = None
                if value.lower() in ('now()', 'current_timestamp'):
                    from sqlalchemy import DefaultClause
                    column.server_default = DefaultClause(text('CURRENT_TIMESTAMP'))
    database = work / 'snapshot.sqlite3'
    sqlite_engine = create_engine('sqlite:///' + database.as_posix())
    try:
        with sqlite_engine.begin() as connection:
            target.create_all(connection)
            for table in target.sorted_tables:
                if rows[table.name]:
                    connection.execute(table.insert(), rows[table.name])
    finally:
        sqlite_engine.dispose()
    with sqlite3.connect(database) as connection:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or connection.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('Exported database integrity check failed')
        counts = {name: connection.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in rows}
        if counts != {name: len(values) for name, values in rows.items()}:
            raise RuntimeError('Exported record counts do not match the database snapshot')
    data = work / 'EquipMap Data'
    blobs = data / 'blobs'
    revisions = data / 'revisions'
    blobs.mkdir(parents=True)
    revisions.mkdir()
    def blob(source):
        before = source.stat()
        temporary = blobs / (uuid.uuid4().hex + '.tmp')
        digest = hashlib.sha256()
        with source.open('rb') as incoming, temporary.open('xb') as output:
            for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                digest.update(chunk)
                output.write(chunk)
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise RuntimeError('An upload changed during export. Please retry.')
        key = digest.hexdigest()
        os.replace(temporary, blobs / key)
        return key
    files = {}
    for path in sorted(uploads.rglob('*')):
        if path.is_symlink() or not path.resolve().is_relative_to(uploads):
            raise RuntimeError('Uploads contain a path outside the upload directory')
        if path.is_file() and path.suffix.lower() in SUFFIXES:
            files[path.relative_to(uploads).as_posix()] = blob(path)
    # Ensure all actual file references from business rows resolve in the bundle.
    for table in ('floorplans', 'equipment', 'rooms', 'equipment_documents'):
        for row in rows.get(table, []):
            for field in ('file_path', 'previous_file_path', 'photo_path', 'icon_path', 'path'):
                value = row.get(field)
                if value and value.startswith('/uploads/') and value.removeprefix('/uploads/') not in files:
                    raise RuntimeError('A referenced upload is missing. Restore it or retry after the current upload finishes.')
    manifest = dict(format=1, database=blob(database), files=files)
    revision = uuid.uuid4().hex
    manifest_file = revisions / (revision + '.json')
    manifest_file.write_text(json.dumps(manifest, sort_keys=True))
    (data / 'current.json').write_text(json.dumps(dict(revision=revision, manifest_sha256=hashlib.sha256(manifest_file.read_bytes()).hexdigest())))
    (data / 'shared-settings.json').write_text(json.dumps(dict(format=1, store_id=uuid.uuid4().hex, secret_key=secrets.token_urlsafe(48), initialized=True)))
    (data / 'coordination.lock').write_bytes(b'0')
    report = dict(snapshot_utc=captured, row_counts=counts, uploads_files=len(files),
                  excluded='Live sessions, and OAuth credentials are not included.',
                  consistency='Database is a consistent snapshot. Uploaded files were captured afterward while the website remained live.',
                  compatibility='Production-only data is retained; the Shared preview may not display every newer website feature. Real SMB qualification is still required.')
    (work / 'export-report.json').write_text(json.dumps(report, indent=2))
    output = work / 'EquipMap-Shared.zip'
    shutil.copyfile(template, output)
    with zipfile.ZipFile(output, 'a', zipfile.ZIP_DEFLATED) as archive:
        for path in data.rglob('*'):
            if path.is_file():
                archive.write(path, prefix + path.relative_to(work).as_posix())
        archive.write(work / 'export-report.json', prefix + 'production-export-report.json')
    return output, report
