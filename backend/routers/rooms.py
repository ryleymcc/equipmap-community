from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, update

from database import get_db
import models
import schemas
from utils import require_editor, log_action, update_db_object, delete_db_object, check_etag_match, respond_304

router = APIRouter(tags=["rooms"])

@router.get("/api/floorplans/{floorplan_id}/rooms", response_model=List[schemas.Room])
async def get_rooms(floorplan_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Room).where(models.Room.floorplan_id == floorplan_id))
    return result.scalars().all()

@router.post("/api/rooms", response_model=schemas.Room)
async def create_room(room: schemas.RoomCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_editor)):
    db_room = models.Room(**room.model_dump())
    db.add(db_room)
    await db.commit()
    await db.refresh(db_room)
    await log_action(db, "create", "room", db_room.id, db_room.name, new_values=room.model_dump(), message=f"Created room '{db_room.name}'", user=current_user)
    await db.commit()
    return db_room

@router.put("/api/rooms/bulk", response_model=List[schemas.Room])
async def bulk_update_rooms(
    room_data: schemas.RoomBulkUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor),
):
    room_ids = set(room_data.ids)
    result = await db.execute(
        update(models.Room)
        .where(models.Room.id.in_(room_ids))
        .values(description=room_data.description)
        .returning(models.Room)
    )
    updated_rooms = result.scalars().all()
    if len(updated_rooms) != len(room_ids):
        await db.rollback()
        raise HTTPException(status_code=404, detail="A selected room no longer exists. Refresh the room list and try again.")

    await log_action(
        db, "bulk_update", "room",
        new_values={"ids": sorted(room_ids), "description": room_data.description},
        message=f"Bulk updated the description of {len(room_ids)} rooms",
        user=current_user,
    )
    await db.commit()
    return updated_rooms

@router.put("/api/rooms/{room_id}", response_model=schemas.Room)
async def update_room(room_id: int, room_data: schemas.RoomUpdate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_editor)):
    result = await db.execute(select(models.Room).where(models.Room.id == room_id))
    db_room = result.scalars().first()
    if not db_room:
        raise HTTPException(status_code=404, detail="Room not found")

    updated_room = await update_db_object(db, db_room, room_data, "room", user=current_user)
    return updated_room

@router.delete("/api/rooms/{room_id}")
async def delete_room(room_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_editor)):
    result = await db.execute(select(models.Room).where(models.Room.id == room_id))
    db_room = result.scalars().first()
    if not db_room:
        raise HTTPException(status_code=404, detail="Room not found")

    await delete_db_object(db, db_room, "room", user=current_user)
    return {"status": "success"}

@router.get("/api/rooms", response_model=List[schemas.RoomWithDetails])
async def get_all_rooms(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    res = await db.execute(text("""
        SELECT md5(concat_ws(',',
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM rooms),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM floorplans),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM sites)
        ))
    """))
    db_hash = res.scalar() or ""
    etag = f'W/"{db_hash}"'
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"

    if check_etag_match(request.headers.get("if-none-match"), etag):
        return respond_304(etag)

    result = await db.execute(
        select(models.Room)
        .options(joinedload(models.Room.floorplan).joinedload(models.Floorplan.site))
        .order_by(models.Room.id.asc())
    )
    rooms_list = result.scalars().all()
    return [
        {
            "id": r.id,
            "floorplan_id": r.floorplan_id,
            "name": r.name,
            "description": r.description,
            "photo_thumbnail_path": r.photo_thumbnail_path,
            "photo_path": r.photo_path,
            "x_coordinate": r.x_coordinate,
            "y_coordinate": r.y_coordinate,
            "floorplan_name": r.floorplan.name if r.floorplan else "",
            "site_name": r.floorplan.site.name if r.floorplan and r.floorplan.site else "",
            "site_id": r.floorplan.site_id if r.floorplan else 0,
        }
        for r in rooms_list
    ]
