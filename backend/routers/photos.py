from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
import models
from utils import require_editor, log_action, UPLOAD_DIR
from photo_pipeline import save_photo

router = APIRouter(tags=['photos'])


async def get_item(kind, item_id, db):
    model = models.Room if kind == 'rooms' else models.Equipment
    item = (await db.execute(select(model).where(model.id == item_id).with_for_update())).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, 'Room or equipment not found.')
    return item


async def update_photo(item, kind, path, db, user, filename=None):
    old_path = item.photo_path
    item.photo_path = path
    await log_action(db, 'update', 'room' if kind == 'rooms' else 'equipment', item.id,
                     item.name, old_values={'photo_path': old_path},
                     new_values={'photo_path': path, **({'photo_filename': filename} if filename else {})}, user=user,
                     message=f"Updated photo for '{item.name}'")
    await db.commit()
    return {'photo_path': path, 'photo_thumbnail_path': item.photo_thumbnail_path}


@router.post('/api/{kind}/{item_id}/photo')
async def upload_photo(kind: Literal['rooms', 'equipment'], item_id: int,
                       photo: UploadFile = File(...), db: AsyncSession = Depends(get_db),
                       user: models.User = Depends(require_editor)):
    item = await get_item(kind, item_id, db)
    path = await save_photo(photo, UPLOAD_DIR)
    try:
        filename = (photo.filename or '').replace('\\', '/').split('/')[-1]
        result = await update_photo(item, kind, path, db, user, filename=filename)
    except Exception:
        await db.rollback()
        for variant in ['preview', 'thumb']:
            output = Path(UPLOAD_DIR) / path.removeprefix('/uploads/').replace('.preview.', f'.{variant}.')
            output.unlink(missing_ok=True)
        raise
    return result


@router.delete('/api/{kind}/{item_id}/photo')
async def remove_photo(kind: Literal['rooms', 'equipment'], item_id: int,
                       db: AsyncSession = Depends(get_db), user: models.User = Depends(require_editor)):
    item = await get_item(kind, item_id, db)
    result = await update_photo(item, kind, None, db, user)
    return result
