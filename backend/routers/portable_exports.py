"""Admin-only private exports with cross-worker filesystem coordination."""
import asyncio
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from database import engine
from portable_bundle import database_snapshot, build_bundle
from utils import require_admin, UPLOAD_DIR

router = APIRouter(prefix='/api/data-manager/portable-exports', tags=['portable export'])
TTL = 3600
logger = logging.getLogger(__name__)


def root():
    path = Path(tempfile.gettempdir()) / 'equipmap-portable-jobs'
    path.mkdir(mode=0o700, exist_ok=True)
    return path.resolve()


def template_path():
    return Path(os.getenv('PORTABLE_TEMPLATE_PATH', '/app/data/portable/EquipMap-Shared-Windows-x64.zip'))


def save(directory, state):
    temporary = directory / ('state-' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(state), encoding='utf-8')
    os.replace(temporary, directory / 'state.json')


def acquire():
    handle = (root() / 'build.lock').open('a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            handle.seek(0, 2)
            if handle.tell() == 0:
                handle.write(b'0'); handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except OSError:
        handle.close()
        return None


def purge():
    parent = root()
    for directory in parent.iterdir():
        if directory.is_dir() and not directory.is_symlink() and re.fullmatch('[a-f0-9]{32}', directory.name) and directory.resolve().parent == parent:
            if time.time() - directory.stat().st_mtime > TTL:
                shutil.rmtree(directory, ignore_errors=True)


async def prepare(directory, state, handle):
    try:
        snapshot = await database_snapshot(engine)
        path, report = await run_in_threadpool(build_bundle, template_path(), UPLOAD_DIR, directory, snapshot)
        state.update(status='ready', snapshot_utc=report['snapshot_utc'], bytes=path.stat().st_size)
    except Exception:
        logger.exception('Portable export failed')
        state.update(status='error', error='The export could not be prepared. A required upload may be missing or changing. Retry, or contact an administrator.')
    finally:
        save(directory, state)
        handle.close()  # OS releases the cross-worker lock, including on crash.
        async def expire():
            await asyncio.sleep(TTL)
            purge()
        asyncio.create_task(expire())


@router.post('', status_code=202)
async def create_export(response: Response, user=Depends(require_admin)):
    response.headers['Cache-Control'] = 'private, no-store'
    purge()
    if not template_path().is_file():
        raise HTTPException(503, 'The Windows Shared package is not available on this server yet.')
    handle = acquire()
    if handle is None:
        raise HTTPException(409, 'Another portable export is being prepared. Try again shortly.')
    try:
        directories = [p for p in root().iterdir() if p.is_dir()]
        if len(directories) >= 5 or shutil.disk_usage(root()).free < 1024**3:
            raise HTTPException(429, 'Portable export storage is temporarily at capacity. Try again later.')
        # Mark interrupted jobs from a previous worker as failed before retry.
        for directory in directories:
            marker = directory / 'state.json'
            if marker.is_file():
                previous = json.loads(marker.read_text())
                if previous['status'] == 'preparing':
                    previous.update(status='error', error='The server restarted during this export. Create a new download.')
                    save(directory, previous)
        key = uuid.uuid4().hex
        directory = root() / key
        directory.mkdir(mode=0o700)
        state = dict(owner=user.id, created=time.time(), status='preparing')
        save(directory, state)
        asyncio.create_task(prepare(directory, state, handle))
        return {'id': key, 'status': 'preparing'}
    except BaseException:
        handle.close()
        raise


def owned(key, user):
    purge()
    if not re.fullmatch('[a-f0-9]{32}', key):
        raise HTTPException(404, 'Export not found')
    directory = root() / key
    marker = directory / 'state.json'
    if not marker.is_file():
        raise HTTPException(404, 'Export expired. Create a new download.')
    job = json.loads(marker.read_text())
    if job['owner'] != user.id:
        raise HTTPException(404, 'Export not found')
    return directory, job


@router.get('/{key}')
async def export_status(key: str, response: Response, user=Depends(require_admin)):
    response.headers['Cache-Control'] = 'private, no-store'
    directory, job = owned(key, user)
    if job['status'] == 'preparing':
        handle = acquire()
        if handle is not None:
            try:
                job = json.loads((directory / 'state.json').read_text())
                if job['status'] == 'preparing':
                    job.update(status='error', error='The server restarted during this export. Create a new download.')
                    save(directory, job)
            finally:
                handle.close()
    return {field: job[field] for field in ('status', 'error', 'snapshot_utc', 'bytes') if field in job}


@router.get('/{key}/download')
async def download_export(key: str, user=Depends(require_admin)):
    directory, job = owned(key, user)
    if job['status'] != 'ready':
        raise HTTPException(409, 'The export is not ready.')
    stamp = datetime.fromisoformat(job['snapshot_utc']).astimezone(timezone.utc).strftime('%Y%m%d-%H%M')
    return FileResponse(directory / 'EquipMap-Shared.zip', filename=f'EquipMap-Shared-{stamp}.zip', media_type='application/zip',
                        headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})
