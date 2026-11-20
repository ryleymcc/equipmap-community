from pathlib import Path
from typing import List
from fastapi.responses import JSONResponse
from fastapi import APIRouter, Depends, HTTPException, Response, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from database import get_db
import models
import schemas
from utils import require_admin, UPLOAD_DIR, log_action
from upload_index import indexed_inventory, reconcile, collect_references, file_row
from upload_inventory import references

router = APIRouter(prefix='/api/data-manager', tags=['data manager'])


class FileSelection(BaseModel):
    path: str = Field(max_length=512)
    fingerprint: str = Field(min_length=64, max_length=64)


class CleanupRequest(BaseModel):
    discard_undo: bool = False
    files: List[FileSelection] = Field(min_length=1, max_length=100)


@router.get('/uploads')
async def get_uploads(response: Response, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    response.headers['Cache-Control'] = 'no-store'
    return JSONResponse({'files': await indexed_inventory(db)}, headers={'Cache-Control': 'no-store'})


@router.get('/uploads/usage')
async def get_upload_usage(response: Response, path: str = Query(min_length=1, max_length=512),
                           db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    response.headers['Cache-Control'] = 'no-store'
    refs = (await db.execute(select(models.UploadReference).where(
        models.UploadReference.path == path, models.UploadReference.category == 'live'))).scalars().all()
    uses = []
    for source, model, schema in [('rooms', models.Room, schemas.Room),
                                   ('equipment', models.Equipment, schemas.Equipment),
                                   ('floorplans', models.Floorplan, None)]:
        ids = {ref.source_id for ref in refs if ref.source_type == source}
        if not ids:
            continue
        items = (await db.execute(select(model).where(model.id.in_(ids)))).scalars()
        for item in items:
            if schema:
                if path not in references(item.photo_path):
                    continue
                uses.append({'type': source, 'id': item.id, 'name': item.name,
                             'floorplan_id': item.floorplan_id, 'entity': schema.model_validate(item).model_dump(),
                             'relationship': 'Photo'})
            else:
                for field, label in [('file_path', 'Current drawing'), ('previous_file_path', 'Previous drawing')]:
                    if path in references(getattr(item, field)):
                        uses.append({'type': source, 'id': item.id, 'name': item.name,
                                     'site_id': item.site_id, 'relationship': label})
    document_ids = {ref.source_id for ref in refs if ref.source_type == 'equipment_documents'}
    drawing_ids = {ref.source_id for ref in refs if ref.source_type == 'floorplan_drawings'}
    if drawing_ids:
        rows = await db.execute(select(models.FloorplanDrawing, models.Floorplan).join(
            models.Floorplan, models.Floorplan.id == models.FloorplanDrawing.floorplan_id
        ).where(models.FloorplanDrawing.id.in_(drawing_ids)))
        for drawing, item in rows:
            if path in references(drawing.file_path):
                uses.append({'type': 'floorplans', 'id': item.id, 'name': item.name,
                             'site_id': item.site_id, 'relationship': f'Layer drawing: {drawing.title}'})
    if document_ids:
        rows = await db.execute(select(models.EquipmentDocument, models.Equipment).join(
            models.Equipment, models.Equipment.id == models.EquipmentDocument.equipment_id
        ).where(models.EquipmentDocument.id.in_(document_ids)))
        for doc, item in rows:
            if path in references(doc.path):
                uses.append({'type': 'equipment', 'id': item.id, 'name': item.name,
                             'floorplan_id': item.floorplan_id,
                             'entity': schemas.Equipment.model_validate(item).model_dump(),
                             'relationship': f'Document: {doc.filename}'})
    return {'uses': uses}


@router.post('/uploads/reconcile')
async def reconcile_uploads(response: Response, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    response.headers['Cache-Control'] = 'no-store'
    count = await reconcile(db, UPLOAD_DIR)
    return {'indexed': count}


@router.post('/uploads/delete')
async def delete_uploads(payload: CleanupRequest, response: Response,
                         db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    response.headers['Cache-Control'] = 'no-store'
    # Prevent concurrent entity/history changes between rechecking references and deletion.
    if db.bind.dialect.name == 'postgresql':
        await db.execute(text('LOCK TABLE rooms, equipment, floorplans, floorplan_drawings, equipment_documents, audit_logs IN SHARE ROW EXCLUSIVE MODE'))
    live, history = await collect_references(db)
    def inspect_selected():
        result = {}
        for requested in payload.files:
            row = file_row(UPLOAD_DIR, requested.path)
            if row:
                row['status'] = ('in_use' if row['path'] in live else 'history' if row['path'] in history
                                 else 'unused')
                result[row['path']] = row
        return result
    current = await run_in_threadpool(inspect_selected)
    selected = []
    for requested in payload.files:
        row = current.get(requested.path)
        eligible = row and (row['status'] == 'unused' or (payload.discard_undo and row['status'] == 'history'))
        if not eligible or row['fingerprint'] != requested.fingerprint:
            raise HTTPException(409, 'Files changed or are protected. Scan again before deleting.')
        if row not in selected:
            selected.append(row)
    # Store only relative names in the audit event, so they are not mistaken for undo references.
    deleted, failed = [], []
    root = Path(UPLOAD_DIR).resolve()
    for row in selected:
        path = root / row['path']
        try:
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                raise OSError('Unsafe path')
            path.unlink()
            deleted.append(row)
        except OSError:
            failed.append(row['path'])
    disabled_undo_ids = []
    if deleted and payload.discard_undo:
        deleted_paths = {row['path'] for row in deleted}
        logs = (await db.execute(select(models.AuditLog).where(models.AuditLog.undo_unavailable_reason.is_(None)))).scalars()
        for log in logs:
            if (references(log.old_values) | references(log.new_values)) & deleted_paths:
                log.undo_unavailable_reason = 'A required upload was permanently deleted by an administrator.'
                disabled_undo_ids.append(log.id)
    if deleted:
        paths = [row['path'] for row in deleted]
        await db.execute(delete(models.UploadReference).where(models.UploadReference.path.in_(paths)))
        await db.execute(delete(models.UploadAsset).where(models.UploadAsset.path.in_(paths)))
    await log_action(db, 'cleanup', 'uploads', new_values={'deleted_files': [r['path'] for r in deleted],
                     'bytes_freed': sum(r['size_bytes'] for r in deleted), 'failed_files': failed, 'disabled_undo_ids': disabled_undo_ids},
                     message=f"Deleted {len(deleted)} unused uploads", user=user)
    await db.commit()
    return {'disabled_undo_count': len(disabled_undo_ids), 'deleted': len(deleted), 'bytes_freed': sum(r['size_bytes'] for r in deleted), 'failed': failed}
