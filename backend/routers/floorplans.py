import os
import shutil
import json
import time
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, Response
from fastapi.encoders import jsonable_encoder
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
import models
import schemas
from svg_parser import parse_svg_for_rooms
from utils import (
    require_editor, log_action, check_etag_match, respond_304,
    get_floorplan_db_hash, get_site_floorplans_db_hash, UPLOAD_DIR
)

router = APIRouter(tags=["floorplans"])

_site_floorplans_cache = {} # site_id -> (etag, response_bytes)
_floorplan_detail_cache = {} # floorplan_id -> (etag, response_bytes)

@router.get("/api/sites/{site_id}/floorplans", response_model=List[schemas.Floorplan])
async def get_floorplans(site_id: int, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    # Verify site exists
    site_result = await db.execute(select(models.Site).where(models.Site.id == site_id))
    if not site_result.scalars().first():
        raise HTTPException(status_code=404, detail="Site not found")

    db_hash = await get_site_floorplans_db_hash(db, site_id)
    etag = f'W/"{db_hash}"'

    if check_etag_match(request.headers.get("if-none-match"), etag):
        return respond_304(etag)

    cached = _site_floorplans_cache.get(site_id)
    if cached and cached[0] == etag:
        return Response(
            content=cached[1],
            media_type="application/json",
            headers={
                "ETag": etag,
                "Cache-Control": "public, max-age=0, must-revalidate"
            }
        )

    result = await db.execute(
        select(models.Floorplan)
        .options(
            selectinload(models.Floorplan.rooms),
            selectinload(models.Floorplan.equipment),
            selectinload(models.Floorplan.tickets),
            selectinload(models.Floorplan.reference_points)
        )
        .where(models.Floorplan.site_id == site_id)
        .order_by(models.Floorplan.sort_order.asc(), models.Floorplan.id.asc())
    )
    floorplans = result.scalars().all()

    # Standard Pydantic validation and serialization
    serialized = [schemas.Floorplan.model_validate(fp).model_dump() for fp in floorplans]
    response_bytes = json.dumps(jsonable_encoder(serialized)).encode('utf-8')
    _site_floorplans_cache[site_id] = (etag, response_bytes)

    return Response(
        content=response_bytes,
        media_type="application/json",
        headers={
            "ETag": etag,
            "Cache-Control": "public, max-age=0, must-revalidate"
        }
    )

@router.put("/api/sites/{site_id}/floorplans/sort")
async def sort_floorplans(
    site_id: int,
    sort_data: schemas.FloorplanSortOrderList,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    for item in sort_data.orders:
        await db.execute(
            update(models.Floorplan)
            .where(models.Floorplan.id == item.id, models.Floorplan.site_id == site_id)
            .values(sort_order=item.sort_order)
        )
    await db.commit()
    return {"status": "success"}

@router.post("/api/floorplans", response_model=schemas.Floorplan)
async def upload_floorplan(
    site_id: int = Form(...),
    name: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    existing_fp = await db.execute(
        select(models.Floorplan).where(models.Floorplan.site_id == site_id, models.Floorplan.name == name)
    )
    if existing_fp.scalars().first():
        raise HTTPException(status_code=400, detail="A floorplan with this name already exists for this site.")

    filename_lower = file.filename.lower()
    if filename_lower.endswith('.pdf'):
        file_type = 'pdf'
    elif filename_lower.endswith('.svg'):
        file_type = 'svg'
    elif filename_lower.endswith('.glb'):
        file_type = 'glb'
    elif filename_lower.endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
        file_type = 'image'
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file format. Please upload a PDF, SVG, PNG, JPG, JPEG, WEBP, GIF, or GLB file."
        )

    file_location = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    db_floorplan = models.Floorplan(
        site_id=site_id,
        name=name,
        file_path=f"/uploads/{file.filename}",
        file_type=file_type
    )
    db.add(db_floorplan)
    await db.commit()
    await db.refresh(db_floorplan)

    await log_action(db, "create", "floorplan", db_floorplan.id, db_floorplan.name, new_values={"name": name, "file_type": file_type}, message=f"Uploaded floorplan '{db_floorplan.name}'", user=current_user)
    await db.commit()

    if file_type == 'svg':
        with open(file_location, "r", encoding="utf-8") as f:
            svg_content = f.read()
            rooms_data = parse_svg_for_rooms(svg_content)
            for r in rooms_data:
                db_room = models.Room(
                    floorplan_id=db_floorplan.id,
                    name=r['name'],
                    description="",
                    x_coordinate=r['x_coordinate'],
                    y_coordinate=r['y_coordinate']
                )
                db.add(db_room)
            if rooms_data:
                await db.commit()

    result = await db.execute(
        select(models.Floorplan)
        .options(
            selectinload(models.Floorplan.rooms),
            selectinload(models.Floorplan.equipment),
            selectinload(models.Floorplan.tickets),
            selectinload(models.Floorplan.reference_points)
        )
        .where(models.Floorplan.id == db_floorplan.id)
    )
    return result.scalars().first()

@router.get("/api/floorplans/{floorplan_id}", response_model=schemas.Floorplan)
async def get_floorplan(floorplan_id: int, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    db_hash = await get_floorplan_db_hash(db, floorplan_id)
    if not db_hash:
        raise HTTPException(status_code=404, detail="Floorplan not found")

    etag = f'W/"{db_hash}"'

    if check_etag_match(request.headers.get("if-none-match"), etag):
        return respond_304(etag)

    cached = _floorplan_detail_cache.get(floorplan_id)
    if cached and cached[0] == etag:
        return Response(
            content=cached[1],
            media_type="application/json",
            headers={
                "ETag": etag,
                "Cache-Control": "public, max-age=0, must-revalidate"
            }
        )

    result = await db.execute(
        select(models.Floorplan)
        .options(
            selectinload(models.Floorplan.rooms),
            selectinload(models.Floorplan.equipment),
            selectinload(models.Floorplan.tickets),
            selectinload(models.Floorplan.reference_points)
        )
        .where(models.Floorplan.id == floorplan_id)
    )
    floorplan = result.scalars().first()
    if not floorplan:
        raise HTTPException(status_code=404, detail="Floorplan not found")

    # Standard Pydantic validation and serialization
    serialized = schemas.Floorplan.model_validate(floorplan).model_dump()
    response_bytes = json.dumps(jsonable_encoder(serialized)).encode('utf-8')
    _floorplan_detail_cache[floorplan_id] = (etag, response_bytes)

    return Response(
        content=response_bytes,
        media_type="application/json",
        headers={
            "ETag": etag,
            "Cache-Control": "public, max-age=0, must-revalidate"
        }
    )

@router.put("/api/floorplans/{floorplan_id}", response_model=schemas.Floorplan)
async def update_floorplan(
    floorplan_id: int,
    floorplan_update: schemas.FloorplanUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    result = await db.execute(
        select(models.Floorplan)
        .options(
            selectinload(models.Floorplan.rooms),
            selectinload(models.Floorplan.equipment),
            selectinload(models.Floorplan.tickets),
            selectinload(models.Floorplan.reference_points)
        )
        .where(models.Floorplan.id == floorplan_id)
    )
    floorplan = result.scalars().first()
    if not floorplan:
        raise HTTPException(status_code=404, detail="Floorplan not found")

    old_values = {"name": floorplan.name, "pin_size": floorplan.pin_size}
    new_values = {}

    if floorplan_update.name is not None and floorplan_update.name != floorplan.name:
        existing_fp = await db.execute(
            select(models.Floorplan).where(
                models.Floorplan.site_id == floorplan.site_id,
                models.Floorplan.name == floorplan_update.name
            )
        )
        if existing_fp.scalars().first():
            raise HTTPException(status_code=400, detail="A floorplan with this name already exists for this site.")
        new_values["name"] = floorplan_update.name
        floorplan.name = floorplan_update.name

    if floorplan_update.pin_size is not None and floorplan_update.pin_size != floorplan.pin_size:
        new_values["pin_size"] = floorplan_update.pin_size
        floorplan.pin_size = floorplan_update.pin_size

    if new_values:
        await log_action(db, "update", "floorplan", floorplan.id, floorplan.name, old_values=old_values, new_values=new_values, message=f"Updated floorplan '{floorplan.name}'", user=current_user)
        await db.commit()
        await db.refresh(floorplan)
        _floorplan_detail_cache.pop(floorplan.id, None)
        _site_floorplans_cache.pop(floorplan.site_id, None)
    return floorplan

@router.put("/api/floorplans/{floorplan_id}/file", response_model=schemas.Floorplan)
@router.post("/api/floorplans/{floorplan_id}/file", response_model=schemas.Floorplan)
async def replace_floorplan_file(
    floorplan_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    result = await db.execute(
        select(models.Floorplan)
        .options(
            selectinload(models.Floorplan.rooms),
            selectinload(models.Floorplan.equipment),
            selectinload(models.Floorplan.tickets),
            selectinload(models.Floorplan.reference_points)
        )
        .where(models.Floorplan.id == floorplan_id)
    )
    floorplan = result.scalars().first()
    if not floorplan:
        raise HTTPException(status_code=404, detail="Floorplan not found")

    filename_lower = file.filename.lower()
    if filename_lower.endswith('.pdf'):
        file_type = 'pdf'
    elif filename_lower.endswith('.svg'):
        file_type = 'svg'
    elif filename_lower.endswith('.glb'):
        file_type = 'glb'
    elif filename_lower.endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
        file_type = 'image'
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file format. Please upload a PDF, SVG, PNG, JPG, JPEG, WEBP, GIF, or GLB file."
        )

    base, ext = os.path.splitext(os.path.basename(file.filename))
    safe_base = "".join(c for c in base if c.isalnum() or c in ('_', '-')).strip() or "floorplan"
    new_filename = f"fp_{floorplan.id}_{int(time.time())}_{safe_base}{ext}"
    file_location = os.path.join(UPLOAD_DIR, new_filename)

    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    old_values = {
        "file_path": floorplan.file_path,
        "file_type": floorplan.file_type,
        "previous_file_path": floorplan.previous_file_path,
        "equipment": [{"id": eq.id, "x": eq.x_coordinate, "y": eq.y_coordinate} for eq in floorplan.equipment],
        "rooms": [{"id": r.id, "x": r.x_coordinate, "y": r.y_coordinate} for r in floorplan.rooms],
        "tickets": [{"id": t.id, "x": t.x_coordinate, "y": t.y_coordinate} for t in floorplan.tickets],
        "reference_points": [{"id": rp.id, "x": rp.x_coordinate, "y": rp.y_coordinate} for rp in floorplan.reference_points]
    }
    new_values = {
        "file_path": f"/uploads/{new_filename}",
        "file_type": file_type,
        "previous_file_path": floorplan.file_path
    }

    floorplan.previous_file_path = floorplan.file_path
    floorplan.file_path = f"/uploads/{new_filename}"
    floorplan.file_type = file_type

    await log_action(
        db,
        "replace_file",
        "floorplan",
        floorplan.id,
        floorplan.name,
        old_values=old_values,
        new_values=new_values,
        message=f"Replaced file for floorplan '{floorplan.name}' with '{file.filename}'",
        user=current_user
    )
    await db.commit()
    await db.refresh(floorplan)

    _floorplan_detail_cache.pop(floorplan.id, None)
    _site_floorplans_cache.pop(floorplan.site_id, None)

    return floorplan

@router.post("/api/floorplans/{floorplan_id}/rescale", response_model=schemas.Floorplan)
async def rescale_floorplan(
    floorplan_id: int,
    rescale_data: schemas.FloorplanRescale,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    result = await db.execute(
        select(models.Floorplan)
        .options(
            selectinload(models.Floorplan.rooms),
            selectinload(models.Floorplan.equipment),
            selectinload(models.Floorplan.tickets),
            selectinload(models.Floorplan.reference_points)
        )
        .where(models.Floorplan.id == floorplan_id)
    )
    floorplan = result.scalars().first()
    if not floorplan:
        raise HTTPException(status_code=404, detail="Floorplan not found")

    old_values = {
        "equipment": [{"id": eq.id, "x": eq.x_coordinate, "y": eq.y_coordinate} for eq in floorplan.equipment],
        "rooms": [{"id": r.id, "x": r.x_coordinate, "y": r.y_coordinate} for r in floorplan.rooms],
        "tickets": [{"id": t.id, "x": t.x_coordinate, "y": t.y_coordinate} for t in floorplan.tickets],
        "reference_points": [{"id": rp.id, "x": rp.x_coordinate, "y": rp.y_coordinate} for rp in floorplan.reference_points],
        "scale_x": rescale_data.scale_x,
        "scale_y": rescale_data.scale_y,
        "offset_x": rescale_data.offset_x,
        "offset_y": rescale_data.offset_y
    }

    sx = rescale_data.scale_x
    sy = rescale_data.scale_y
    ox = rescale_data.origin_x
    oy = rescale_data.origin_y
    tx = rescale_data.offset_x
    ty = rescale_data.offset_y

    for eq in floorplan.equipment:
        if eq.x_coordinate is not None and eq.y_coordinate is not None:
            eq.x_coordinate = round((eq.x_coordinate - ox) * sx + ox + tx, 2)
            eq.y_coordinate = round((eq.y_coordinate - oy) * sy + oy + ty, 2)

    for r in floorplan.rooms:
        if r.x_coordinate is not None and r.y_coordinate is not None:
            r.x_coordinate = round((r.x_coordinate - ox) * sx + ox + tx, 2)
            r.y_coordinate = round((r.y_coordinate - oy) * sy + oy + ty, 2)

    for t in floorplan.tickets:
        if t.x_coordinate is not None and t.y_coordinate is not None:
            t.x_coordinate = round((t.x_coordinate - ox) * sx + ox + tx, 2)
            t.y_coordinate = round((t.y_coordinate - oy) * sy + oy + ty, 2)

    for rp in floorplan.reference_points:
        if rp.x_coordinate is not None and rp.y_coordinate is not None:
            rp.x_coordinate = round((rp.x_coordinate - ox) * sx + ox + tx, 2)
            rp.y_coordinate = round((rp.y_coordinate - oy) * sy + oy + ty, 2)

    new_values = {
        "equipment": [{"id": eq.id, "x": eq.x_coordinate, "y": eq.y_coordinate} for eq in floorplan.equipment],
        "rooms": [{"id": r.id, "x": r.x_coordinate, "y": r.y_coordinate} for r in floorplan.rooms],
        "tickets": [{"id": t.id, "x": t.x_coordinate, "y": t.y_coordinate} for t in floorplan.tickets],
        "reference_points": [{"id": rp.id, "x": rp.x_coordinate, "y": rp.y_coordinate} for rp in floorplan.reference_points],
        "scale_x": sx,
        "scale_y": sy,
        "offset_x": tx,
        "offset_y": ty
    }

    scale_desc = f"{sx*100:.1f}%" if sx == sy else f"X:{sx*100:.1f}%, Y:{sy*100:.1f}%"
    await log_action(
        db,
        "rescale_floorplan",
        "floorplan",
        floorplan.id,
        floorplan.name,
        old_values=old_values,
        new_values=new_values,
        message=f"Rescaled floorplan '{floorplan.name}' ({scale_desc}, offset: [{tx:+0.1f}, {ty:+0.1f}])",
        user=current_user
    )
    await db.commit()
    await db.refresh(floorplan)

    _floorplan_detail_cache.pop(floorplan.id, None)
    _site_floorplans_cache.pop(floorplan.site_id, None)

    return floorplan

@router.delete("/api/floorplans/{floorplan_id}")
async def delete_floorplan(floorplan_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_editor)):
    result = await db.execute(
        select(models.Floorplan)
        .options(
            selectinload(models.Floorplan.rooms),
            selectinload(models.Floorplan.equipment),
            selectinload(models.Floorplan.tickets),
            selectinload(models.Floorplan.reference_points)
        )
        .where(models.Floorplan.id == floorplan_id)
    )
    floorplan = result.scalars().first()
    if not floorplan:
        raise HTTPException(status_code=404, detail="Floorplan not found")

    fp_id = floorplan.id
    fp_name = floorplan.name
    old_values = {
        "id": floorplan.id,
        "site_id": floorplan.site_id,
        "name": floorplan.name,
        "file_path": floorplan.file_path,
        "file_type": floorplan.file_type,
        "pin_size": floorplan.pin_size,
        "sort_order": floorplan.sort_order,
        "rooms": [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "x_coordinate": r.x_coordinate,
                "y_coordinate": r.y_coordinate,
            }
            for r in floorplan.rooms
        ],
        "equipment": [
            {
                "id": eq.id,
                "name": eq.name,
                "description": eq.description,
                "x_coordinate": eq.x_coordinate,
                "y_coordinate": eq.y_coordinate,
                "color": eq.color,
                "photo_path": eq.photo_path,
                "tools_required": eq.tools_required,
            }
            for eq in floorplan.equipment
        ],
        "tickets": [
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "x_coordinate": t.x_coordinate,
                "y_coordinate": t.y_coordinate,
                "status": t.status,
                "created_by_id": t.created_by_id,
            }
            for t in floorplan.tickets
        ],
        "reference_points": [
            {
                "id": rp.id,
                "label": rp.label,
                "x_coordinate": rp.x_coordinate,
                "y_coordinate": rp.y_coordinate,
            }
            for rp in floorplan.reference_points
        ],
    }

    await db.delete(floorplan)
    await log_action(db, "delete", "floorplan", fp_id, fp_name, old_values=old_values, message=f"Deleted floorplan '{fp_name}'", user=current_user)
    await db.commit()
    return {"status": "success"}

@router.get("/api/floorplans/{floorplan_id}/reference-points", response_model=List[schemas.ReferencePoint])
async def get_reference_points(floorplan_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.ReferencePoint).where(models.ReferencePoint.floorplan_id == floorplan_id)
    )
    return result.scalars().all()

@router.put("/api/floorplans/{floorplan_id}/reference-points")
async def set_reference_points(
    floorplan_id: int,
    data: schemas.ReferencePointList,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    fp_result = await db.execute(select(models.Floorplan).where(models.Floorplan.id == floorplan_id))
    db_fp = fp_result.scalars().first()
    if not db_fp:
        raise HTTPException(status_code=404, detail="Floorplan not found")

    await db.execute(
        delete(models.ReferencePoint).where(models.ReferencePoint.floorplan_id == floorplan_id)
    )

    for pt in data.points:
        db_ref = models.ReferencePoint(
            floorplan_id=floorplan_id,
            label=pt.label,
            x_coordinate=pt.x_coordinate,
            y_coordinate=pt.y_coordinate
        )
        db.add(db_ref)

    await log_action(db, "update_refs", "floorplan", floorplan_id, db_fp.name, message=f"Updated reference points for floorplan '{db_fp.name}'", user=current_user)
    await db.commit()
    _floorplan_detail_cache.pop(floorplan_id, None)
    _site_floorplans_cache.pop(db_fp.site_id, None)
    return {"status": "success", "count": len(data.points)}
