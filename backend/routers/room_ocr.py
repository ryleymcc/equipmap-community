import asyncio
import hashlib
import logging
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
from database import get_db
from room_ocr import propose, scan
from utils import UPLOAD_DIR, log_action, require_editor

router = APIRouter(tags=['floorplan room OCR'])
jobs = {}
scan_lock = asyncio.Semaphore(1)
logger = logging.getLogger(__name__)


class ScanRequest(BaseModel):
    dpi: Literal[300, 450, 600, 900, 1200] = 450


class ApplyRequest(BaseModel):
    selected_ids: list[int] = Field(min_length=1, max_length=3000)


def source_path(fp):
    root = Path(UPLOAD_DIR).resolve()
    path = (root / fp.file_path.removeprefix('/uploads/')).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(400, 'Floorplan source file is unavailable.')
    return path


def fingerprint(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


async def room_snapshot(db, site_id):
    rows = (await db.execute(select(models.Room).join(models.Floorplan).where(
        models.Floorplan.site_id == site_id).order_by(models.Room.id))).scalars().all()
    return [dict(id=r.id, floorplan_id=r.floorplan_id, name=r.name,
                 x_coordinate=r.x_coordinate, y_coordinate=r.y_coordinate) for r in rows]


async def run_scan(job, path, dpi):
    async with scan_lock:
        try:
            job['status'] = 'scanning'
            output = await asyncio.to_thread(scan, str(path), dpi, lambda n: job.update(progress=n))
            job['rows'] = propose(output['detections'], job['snapshot'], job['floorplan_id'])
            job.update(image=output['image'], height=output['height'], dpi=output['dpi'])
            job['status'] = 'ready'
        except Exception as exc:
            logger.exception('Room OCR scan failed')
            job.update(status='error', error=str(exc) if isinstance(exc, ValueError) else 'Scan failed. Crop the source drawing and retry.')


def get_job(job_id, floorplan_id, user):
    job = jobs.get(job_id)
    if not job or job['floorplan_id'] != floorplan_id or job['user_id'] != user.id or time.monotonic() - job['created'] > 3600:
        raise HTTPException(404, 'Scan expired. Scan the floorplan again.')
    return job


@router.post('/api/floorplans/{floorplan_id}/room-scan')
async def start_scan(floorplan_id: int, data: ScanRequest, db: AsyncSession = Depends(get_db), user=Depends(require_editor)):
    fp = await db.get(models.Floorplan, floorplan_id)
    if not fp:
        raise HTTPException(404, 'Floorplan not found')
    if fp.file_type not in ('pdf', 'image'):
        raise HTTPException(400, 'Room scanning supports PDF and image floorplans.')
    existing = next((j for j in jobs.values() if j['user_id'] == user.id and j['floorplan_id'] == floorplan_id and j['status'] in ('queued', 'scanning')), None)
    if existing:
        return {'id': existing['id'], 'dpi': existing['dpi']}
    for key, job in list(jobs.items()):
        if time.monotonic() - job['created'] > 3600 and job['status'] not in ('queued', 'scanning'):
            del jobs[key]
    active = [j for j in jobs.values() if j['status'] in ('queued', 'scanning')]
    completed = [k for k, j in jobs.items() if j['status'] not in ('queued', 'scanning')]
    for key in completed[:-7]:
        del jobs[key]
    if len(active) >= 4 or any(j['user_id'] == user.id for j in active):
        raise HTTPException(409, 'A scan is already running. Wait for it to finish.')
    path = source_path(fp)
    job_id = str(uuid.uuid4())
    job = dict(id=job_id, created=time.monotonic(), user_id=user.id, floorplan_id=fp.id,
               status='queued', progress=0, dpi=data.dpi, rows=[], source=fingerprint(path),
               snapshot=await room_snapshot(db, fp.site_id))
    jobs[job_id] = job
    job['task'] = asyncio.create_task(run_scan(job, path, data.dpi))
    return {'id': job_id, 'dpi': data.dpi}


@router.get('/api/floorplans/{floorplan_id}/room-scan/{job_id}')
async def read_scan(floorplan_id: int, job_id: str, user=Depends(require_editor)):
    job = get_job(job_id, floorplan_id, user)
    return {k: job[k] for k in ('id', 'status', 'progress', 'rows', 'error', 'image', 'height', 'dpi') if k in job}


@router.post('/api/floorplans/{floorplan_id}/room-scan/{job_id}/apply')
async def apply_scan(floorplan_id: int, job_id: str, data: ApplyRequest, db: AsyncSession = Depends(get_db), user=Depends(require_editor)):
    job = get_job(job_id, floorplan_id, user)
    # Serialize applications on this floorplan, including retries of the same scan.
    fp = (await db.execute(select(models.Floorplan).where(models.Floorplan.id == floorplan_id).with_for_update())).scalar_one_or_none()
    if not fp:
        raise HTTPException(404, 'Floorplan not found')
    if job['status'] != 'ready':
        raise HTTPException(409, 'This scan is not ready or has already been applied.')
    if fingerprint(source_path(fp)) != job['source'] or await room_snapshot(db, fp.site_id) != job['snapshot']:
        raise HTTPException(409, 'The drawing or rooms changed. Scan again before applying pins.')
    selected = set(data.selected_ids)
    rows = [r for r in job['rows'] if r['id'] in selected]
    if len(rows) != len(selected) or any(r['action'] == 'review' for r in rows):
        raise HTTPException(400, 'Select only unambiguous proposed room pins.')
    moved = created = 0
    for row in rows:
        coords = {k: row[k] for k in ('x_coordinate', 'y_coordinate')}
        if row['action'] == 'move':
            room = await db.get(models.Room, row['room_id'])
            old = {k: getattr(room, k) for k in coords}
            for key, value in coords.items():
                setattr(room, key, value)
            moved += 1
        else:
            room = models.Room(floorplan_id=fp.id, name=row['name'], description='', **coords)
            db.add(room)
            await db.flush()
            old = None
            created += 1
        await log_action(db, 'update' if old else 'create', 'room', room.id, room.name,
                         old_values=old, new_values=coords, message='Applied floorplan text location', user=user)
    await db.commit()
    job['status'] = 'applied'
    return dict(moved=moved, created=created)
