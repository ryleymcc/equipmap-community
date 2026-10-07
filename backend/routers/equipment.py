import os
import shutil
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Form, UploadFile, File, Request, Response
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy import update, delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
import models
import schemas
from utils import require_editor, log_action, delete_db_object, check_etag_match, respond_304, UPLOAD_DIR

router = APIRouter(tags=["equipment"])

@router.get("/api/floorplans/{floorplan_id}/equipment", response_model=List[schemas.Equipment])
async def get_equipment(floorplan_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Equipment).where(models.Equipment.floorplan_id == floorplan_id))
    return result.scalars().all()

@router.post("/api/equipment", response_model=schemas.Equipment)
async def create_equipment(
    floorplan_id: int = Form(...),
    name: str = Form(...),
    description: str = Form(""),
    x_coordinate: float = Form(0.0),
    y_coordinate: float = Form(0.0),
    color: str = Form("#10b981"),
    tools_required: str = Form(None),
    photo: UploadFile = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    fp_result = await db.execute(select(models.Floorplan).where(models.Floorplan.id == floorplan_id))
    db_fp = fp_result.scalars().first()
    if not db_fp:
        raise HTTPException(status_code=404, detail="Floorplan not found")

    existing_equip_result = await db.execute(
        select(models.Equipment)
        .join(models.Floorplan)
        .where(models.Floorplan.site_id == db_fp.site_id, models.Equipment.name == name)
    )
    if existing_equip_result.scalars().first():
        raise HTTPException(status_code=400, detail="An equipment with this name already exists at this site.")

    photo_path = None
    if photo:
        photo_loc = os.path.join(UPLOAD_DIR, photo.filename)
        with open(photo_loc, "wb") as buffer:
            shutil.copyfileobj(photo.file, buffer)
        photo_path = f"/uploads/{photo.filename}"

    db_equip = models.Equipment(
        floorplan_id=floorplan_id,
        name=name,
        description=description,
        x_coordinate=x_coordinate,
        y_coordinate=y_coordinate,
        color=color,
        tools_required=tools_required,
        photo_path=photo_path
    )
    db.add(db_equip)
    await db.commit()
    await db.refresh(db_equip)

    new_values = {
        "floorplan_id": floorplan_id,
        "name": name,
        "description": description,
        "x_coordinate": x_coordinate,
        "y_coordinate": y_coordinate,
        "color": color,
        "tools_required": tools_required
    }
    await log_action(db, "create", "equipment", db_equip.id, db_equip.name, new_values=new_values, message=f"Created equipment '{db_equip.name}'", user=current_user)
    await db.commit()
    return db_equip

@router.put("/api/equipment/bulk")
async def bulk_update_equipment(
    update_data: schemas.EquipmentBulkUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    if not update_data.ids:
        return {"status": "success", "updated": 0}

    update_values = {}
    if update_data.description is not None:
        update_values["description"] = update_data.description
    if update_data.color is not None:
        update_values["color"] = update_data.color
    if update_data.tools_required is not None:
        update_values["tools_required"] = update_data.tools_required

    if not update_values:
        return {"status": "success", "updated": 0}

    await db.execute(
        update(models.Equipment)
        .where(models.Equipment.id.in_(update_data.ids))
        .values(**update_values)
    )

    await log_action(
        db,
        "bulk_update",
        "equipment",
        message=f"Bulk updated {len(update_data.ids)} equipment items. Fields: {', '.join(update_values.keys())}",
        user=current_user
    )
    await db.commit()
    return {"status": "success", "updated": len(update_data.ids)}

@router.put("/api/equipment/{equipment_id}")
async def update_equipment(
    equipment_id: int,
    request: Request,
    floorplan_id: int = Form(None),
    name: str = Form(None),
    description: str = Form(None),
    x_coordinate: float = Form(None),
    y_coordinate: float = Form(None),
    color: str = Form(None),
    tools_required: str = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    result = await db.execute(select(models.Equipment).where(models.Equipment.id == equipment_id))
    db_equipment = result.scalars().first()
    if not db_equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")

    form_data = await request.form()
    old_values = {}
    new_values = {}
    message = None

    if floorplan_id is not None:
        old_values["floorplan_id"] = db_equipment.floorplan_id
        new_values["floorplan_id"] = floorplan_id

        old_fp_res = await db.execute(select(models.Floorplan.name).where(models.Floorplan.id == db_equipment.floorplan_id))
        new_fp_res = await db.execute(select(models.Floorplan.name).where(models.Floorplan.id == floorplan_id))
        old_fp_name = old_fp_res.scalar()
        new_fp_name = new_fp_res.scalar()

        db_equipment.floorplan_id = floorplan_id
        if old_fp_name and new_fp_name and old_fp_name != new_fp_name:
            message = f"Relocated equipment '{db_equipment.name}' from '{old_fp_name}' to '{new_fp_name}'"

    if name is not None and name != db_equipment.name:
        existing_equip_result = await db.execute(
            select(models.Equipment)
            .join(models.Floorplan)
            .where(
                models.Floorplan.site_id == (
                    select(models.Floorplan.site_id)
                    .where(models.Floorplan.id == db_equipment.floorplan_id)
                    .scalar_subquery()
                ),
                models.Equipment.name == name
            )
        )
        if existing_equip_result.scalars().first():
            raise HTTPException(status_code=400, detail="An equipment with this name already exists at this site.")
        old_values["name"] = db_equipment.name
        new_values["name"] = name
        db_equipment.name = name

    if "description" in form_data:
        description_val = form_data.get("description")
        old_values["description"] = db_equipment.description
        new_values["description"] = description_val
        db_equipment.description = description_val
    if x_coordinate is not None:
        old_values["x_coordinate"] = db_equipment.x_coordinate
        new_values["x_coordinate"] = x_coordinate
        db_equipment.x_coordinate = x_coordinate
    if y_coordinate is not None:
        old_values["y_coordinate"] = db_equipment.y_coordinate
        new_values["y_coordinate"] = y_coordinate
        db_equipment.y_coordinate = y_coordinate
    if color is not None:
        old_values["color"] = db_equipment.color
        new_values["color"] = color
        db_equipment.color = color
    if "tools_required" in form_data:
        tools_val = form_data.get("tools_required")
        old_values["tools_required"] = db_equipment.tools_required
        new_values["tools_required"] = tools_val
        db_equipment.tools_required = tools_val

    if new_values:
        if not message:
            message = f"Updated equipment '{db_equipment.name}'"
        await log_action(db, "update", "equipment", db_equipment.id, db_equipment.name, old_values=old_values, new_values=new_values, message=message, user=current_user)
        await db.commit()
        await db.refresh(db_equipment)
    return db_equipment

@router.delete("/api/equipment/{equipment_id}")
async def delete_equipment(equipment_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_editor)):
    result = await db.execute(select(models.Equipment).where(models.Equipment.id == equipment_id))
    db_equipment = result.scalars().first()
    if not db_equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")

    await delete_db_object(db, db_equipment, "equipment", user=current_user)
    return {"message": "Equipment deleted successfully"}

@router.get("/api/equipment")
async def get_all_equipment(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    res = await db.execute(text("""
        SELECT md5(concat_ws(',',
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM equipment),
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
        select(models.Equipment)
        .options(joinedload(models.Equipment.floorplan).joinedload(models.Floorplan.site))
        .order_by(models.Equipment.id.asc())
    )
    equipment_list = result.scalars().all()
    return [
        {
            "id": e.id,
            "floorplan_id": e.floorplan_id,
            "name": e.name,
            "description": e.description,
            "x_coordinate": e.x_coordinate,
            "y_coordinate": e.y_coordinate,
            "color": e.color,
            "photo_path": e.photo_path,
            "tools_required": e.tools_required,
            "floorplan_name": e.floorplan.name if e.floorplan else "",
            "site_name": e.floorplan.site.name if e.floorplan and e.floorplan.site else "",
            "site_id": e.floorplan.site_id if e.floorplan else 0,
        }
        for e in equipment_list
    ]

@router.post("/api/equipment/batch")
async def batch_import_equipment(
    import_data: schemas.EquipmentBatchImport,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_editor)
):
    fp_result = await db.execute(
        select(models.Floorplan).where(models.Floorplan.id == import_data.floorplan_id)
    )
    db_fp = fp_result.scalars().first()
    if not db_fp:
        raise HTTPException(status_code=404, detail="Floorplan not found")

    if import_data.clear_existing:
        await db.execute(
            delete(models.Equipment).where(models.Equipment.floorplan_id == import_data.floorplan_id)
        )
        await db.execute(
            delete(models.Room).where(models.Room.floorplan_id == import_data.floorplan_id)
        )

    existing_names = set()
    if not import_data.clear_existing:
        existing_equip = await db.execute(
            select(models.Equipment.name)
            .join(models.Floorplan)
            .where(models.Floorplan.site_id == db_fp.site_id)
        )
        existing_names = {name for name in existing_equip.scalars().all()}

    new_models = []
    for item in import_data.items:
        if item.is_room:
            db_room = models.Room(
                floorplan_id=import_data.floorplan_id,
                name=item.name,
                description=item.description,
                x_coordinate=item.x_coordinate,
                y_coordinate=item.y_coordinate
            )
            db.add(db_room)
            new_models.append(db_room)
        else:
            item_name = item.name
            if item_name in existing_names:
                base_name = item_name
                counter = 1
                while f"{base_name} ({counter})" in existing_names or base_name in existing_names:
                    base_name = f"{item_name} ({counter})"
                    counter += 1
                item_name = base_name

            existing_names.add(item_name)

            db_equip = models.Equipment(
                floorplan_id=import_data.floorplan_id,
                name=item_name,
                description=item.description,
                x_coordinate=item.x_coordinate,
                y_coordinate=item.y_coordinate,
                color=item.color,
                tools_required=item.tools_required
            )
            db.add(db_equip)
            new_models.append(db_equip)

    await log_action(
        db,
        "batch_import",
        "floorplan",
        import_data.floorplan_id,
        db_fp.name,
        message=f"Batch imported {len(new_models)} items to floorplan '{db_fp.name}'",
        user=current_user
    )
    await db.commit()
    return {"message": "Success", "count": len(new_models)}
