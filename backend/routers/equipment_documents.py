"""Equipment reference files, tracked in the shared upload inventory."""
from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
import models
from utils import UPLOAD_DIR, require_editor, log_action

router = APIRouter(prefix='/api/equipment/{equipment_id}/documents', tags=['equipment documents'])
ALLOWED = {'.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'}
MAX_BYTES = 25 * 1024 * 1024


async def equipment(db, equipment_id):
    item = await db.get(models.Equipment, equipment_id)
    if not item:
        raise HTTPException(404, 'Equipment not found')
    return item


def document_data(doc):
    return dict(id=doc.id, filename=doc.filename, path=doc.path,
                size_bytes=doc.size_bytes, created_at=doc.created_at)


@router.get('')
async def list_documents(equipment_id: int, db: AsyncSession = Depends(get_db)):
    await equipment(db, equipment_id)
    docs = (await db.execute(select(models.EquipmentDocument).where(
        models.EquipmentDocument.equipment_id == equipment_id).order_by(models.EquipmentDocument.id.desc()))).scalars()
    return [document_data(doc) for doc in docs]


@router.post('')
async def upload_document(equipment_id: int, file: UploadFile = File(...),
                          db: AsyncSession = Depends(get_db), user=Depends(require_editor)):
    item = await equipment(db, equipment_id)
    filename = (file.filename or '').replace('\\', '/').split('/')[-1]
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED or len(filename) > 255:
        raise HTTPException(400, 'Choose a PDF, text, Word, Excel or PowerPoint file.')
    folder = Path(UPLOAD_DIR) / 'equipment-documents'
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (uuid4().hex + suffix)
    size = 0
    try:
        with path.open('xb') as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, 'Choose a file under 25 MB.')
                output.write(chunk)
        if not size:
            raise HTTPException(400, 'The file is empty.')
        doc = models.EquipmentDocument(equipment_id=equipment_id, filename=filename,
            path='/uploads/equipment-documents/' + path.name, size_bytes=size)
        db.add(doc)
        await db.flush()
        await log_action(db, 'upload_document', 'equipment', item.id, item.name,
                         new_values={**document_data(doc), 'equipment_id': equipment_id},
                         message=f"Added document '{filename}' to '{item.name}'", user=user)
        await db.commit()
        await db.refresh(doc)
        return document_data(doc)
    except Exception:
        await db.rollback()
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@router.delete('/{document_id}')
async def remove_document(equipment_id: int, document_id: int,
                          db: AsyncSession = Depends(get_db), user=Depends(require_editor)):
    item = await equipment(db, equipment_id)
    doc = await db.get(models.EquipmentDocument, document_id)
    if not doc or doc.equipment_id != equipment_id:
        raise HTTPException(404, 'Document not found')
    # Retain the physical file, consistent with equipment/photo deletion behavior.
    await log_action(db, 'remove_document', 'equipment', item.id, item.name,
                     old_values={**document_data(doc), 'equipment_id': equipment_id},
                     message=f"Removed document '{doc.filename}' from '{item.name}'", user=user)
    await db.delete(doc)
    await db.commit()
    return {'message': 'Document removed'}
