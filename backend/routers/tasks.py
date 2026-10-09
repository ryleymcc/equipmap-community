import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, or_, desc, asc, update
from sqlalchemy.orm import selectinload

from database import get_db
import models
import schemas
from utils import log_action, require_user, require_manage_pm

logger = logging.getLogger("backend.routers.tasks")
router = APIRouter(tags=["tasks"])

DEFAULT_TASK_CATEGORIES = (
    "General", "HVAC", "Electrical", "Plumbing", "Safety",
    "Doors & Locks", "Facility & Grounds", "Preventive Maintenance",
)

def _task_options():
    return (
        selectinload(models.Task.rooms).selectinload(models.Room.floorplan).selectinload(models.Floorplan.site),
        selectinload(models.Task.equipment).selectinload(models.Equipment.floorplan).selectinload(models.Floorplan.site),
    )

async def _load_linked_items(db: AsyncSession, model, ids: Optional[List[int]], label: str):
    if not ids:
        return []
    unique_ids = list(dict.fromkeys(ids))
    result = await db.execute(
        select(model)
        .options(selectinload(model.floorplan).selectinload(models.Floorplan.site))
        .where(model.id.in_(unique_ids))
    )
    values = list(result.scalars().all())
    found = {value.id for value in values}
    missing = [value for value in unique_ids if value not in found]
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown {label} IDs: {missing}")
    return values

def _serialize_room(room: models.Room) -> dict:
    return {
        "id": room.id,
        "floorplan_id": room.floorplan_id,
        "name": room.name,
        "description": room.description,
        "x_coordinate": room.x_coordinate,
        "y_coordinate": room.y_coordinate,
        "floorplan_name": room.floorplan.name if room.floorplan else "",
        "site_name": room.floorplan.site.name if room.floorplan and room.floorplan.site else "",
        "site_id": room.floorplan.site_id if room.floorplan else 0,
    }

def _serialize_equipment(equipment: models.Equipment) -> dict:
    return {
        "id": equipment.id,
        "floorplan_id": equipment.floorplan_id,
        "name": equipment.name,
        "description": equipment.description,
        "x_coordinate": equipment.x_coordinate,
        "y_coordinate": equipment.y_coordinate,
        "color": equipment.color,
        "photo_path": equipment.photo_path,
        "tools_required": equipment.tools_required,
        "floorplan_name": equipment.floorplan.name if equipment.floorplan else "",
        "site_name": equipment.floorplan.site.name if equipment.floorplan and equipment.floorplan.site else "",
        "site_id": equipment.floorplan.site_id if equipment.floorplan else 0,
    }

def sanitize_type_field(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    val_str = val.strip()
    if val_str.lower() in ["xpm", "none", "null", ""]:
        return None
    return val_str

async def _task_category_count(db: AsyncSession, name: str) -> int:
    type_count = (await db.execute(
        select(func.count(models.TaskType.id)).where(func.lower(models.TaskType.category) == name.lower())
    )).scalar() or 0
    sheet_count = (await db.execute(
        select(func.count(models.Task.id)).where(func.lower(models.Task.category) == name.lower())
    )).scalar() or 0
    return type_count + sheet_count

@router.get("/api/tasks/categories", response_model=List[schemas.TaskCategoryResponse])
async def get_task_categories(
    include_inactive: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    entities = list((await db.execute(select(models.TaskCategory))).scalars().all())
    by_name = {entity.name.lower(): entity for entity in entities}
    legacy_rows = (await db.execute(select(models.Task.category).distinct())).scalars().all()
    names = {entity.name for entity in entities}
    names.update(DEFAULT_TASK_CATEGORIES)
    names.update(value.strip() for value in legacy_rows if value and value.strip())

    result = []
    for name in sorted(names, key=str.lower):
        entity = by_name.get(name.lower())
        is_active = entity.is_active if entity else True
        if not include_inactive and not is_active:
            continue
        result.append({
            "id": entity.id if entity else None,
            "name": entity.name if entity else name,
            "description": entity.description if entity else None,
            "is_active": is_active,
            "task_count": await _task_category_count(db, name),
        })
    return result

def serialize_task_type(task_type: models.TaskType, work_orders_count: int = 0) -> dict:
    sheet = task_type.task_sheet
    return {
        "id": task_type.id,
        "code": task_type.code,
        "name": task_type.name,
        "category": task_type.category or "General",
        "priority": task_type.priority or "medium",
        "trade": task_type.trade,
        "is_active": task_type.is_active,
        "task_sheet_id": task_type.task_sheet_id,
        "task_sheet_code": sheet.code if sheet else None,
        "task_sheet_name": sheet.description if sheet else None,
        "work_orders_count": work_orders_count,
    }

@router.get("/api/task-types", response_model=List[schemas.TaskTypeResponse])
async def get_task_types(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    values = list((await db.execute(
        select(models.TaskType)
        .options(selectinload(models.TaskType.task_sheet))
        .order_by(models.TaskType.name.asc())
    )).scalars().all())
    counts = dict((await db.execute(
        select(models.WorkOrder.task_type_id, func.count(models.WorkOrder.id))
        .where(models.WorkOrder.task_type_id.is_not(None))
        .group_by(models.WorkOrder.task_type_id)
    )).all())
    return [serialize_task_type(value, counts.get(value.id, 0)) for value in values]

async def _validate_task_sheet(db: AsyncSession, task_sheet_id: Optional[int]):
    if task_sheet_id is None:
        return None
    sheet = (await db.execute(select(models.Task).where(models.Task.id == task_sheet_id))).scalars().first()
    if not sheet:
        raise HTTPException(status_code=422, detail="Linked task sheet was not found")
    if not sheet.pm_task_sheet or not sheet.pm_task_sheet.strip():
        raise HTTPException(status_code=422, detail="The linked record does not contain a task sheet")
    return sheet

@router.post("/api/task-types", response_model=schemas.TaskTypeResponse)
async def create_task_type(
    payload: schemas.TaskTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_manage_pm),
):
    code = payload.code.strip().upper()
    if not code or not payload.name.strip():
        raise HTTPException(status_code=400, detail="Task type code and name are required")
    if (await db.execute(select(models.TaskType).where(models.TaskType.code == code))).scalars().first():
        raise HTTPException(status_code=400, detail=f"Task type '{code}' already exists")
    await _validate_task_sheet(db, payload.task_sheet_id)
    entity = models.TaskType(**payload.model_dump())
    entity.code = code
    entity.name = payload.name.strip()
    entity.trade = payload.trade.strip() if payload.trade else None
    db.add(entity)
    await db.commit()
    entity = (await db.execute(select(models.TaskType).options(selectinload(models.TaskType.task_sheet)).where(models.TaskType.code == code))).scalars().one()
    return serialize_task_type(entity)

@router.put("/api/task-types/{task_type_id}", response_model=schemas.TaskTypeResponse)
async def update_task_type(
    task_type_id: int,
    payload: schemas.TaskTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_manage_pm),
):
    entity = (await db.execute(select(models.TaskType).where(models.TaskType.id == task_type_id))).scalars().first()
    if not entity:
        raise HTTPException(status_code=404, detail="Task type not found")
    data = payload.model_dump(exclude_unset=True)
    if "task_sheet_id" in data:
        await _validate_task_sheet(db, data["task_sheet_id"])
    for field, value in data.items():
        if field == "code" and value:
            value = value.strip().upper()
        elif field in {"name", "category", "trade"} and isinstance(value, str):
            value = value.strip() or None
        setattr(entity, field, value)
    await db.commit()
    entity = (await db.execute(select(models.TaskType).options(selectinload(models.TaskType.task_sheet)).where(models.TaskType.id == task_type_id))).scalars().one()
    count = (await db.execute(select(func.count(models.WorkOrder.id)).where(models.WorkOrder.task_type_id == task_type_id))).scalar() or 0
    return serialize_task_type(entity, count)

@router.post("/api/tasks/categories", response_model=schemas.TaskCategoryResponse)
async def create_task_category(
    payload: schemas.TaskCategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_manage_pm),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Task category name is required")
    existing = (await db.execute(
        select(models.TaskCategory).where(func.lower(models.TaskCategory.name) == name.lower())
    )).scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Task category '{name}' already exists")
    entity = models.TaskCategory(name=name, description=payload.description.strip() if payload.description else None)
    db.add(entity)
    await db.flush()
    await log_action(db, "create", "task_category", entity.id, entity.name,
                     new_values=payload.model_dump(), message=f"Created task category '{entity.name}'", user=current_user)
    await db.commit()
    await db.refresh(entity)
    return {"id": entity.id, "name": entity.name, "description": entity.description, "is_active": entity.is_active, "task_count": 0}

@router.put("/api/tasks/categories/{category_name}", response_model=schemas.TaskCategoryResponse)
async def update_task_category(
    category_name: str,
    payload: schemas.TaskCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_manage_pm),
):
    old_name = category_name.strip()
    entity = (await db.execute(
        select(models.TaskCategory).where(func.lower(models.TaskCategory.name) == old_name.lower())
    )).scalars().first()
    if not entity:
        entity = models.TaskCategory(name=old_name)
        db.add(entity)
        await db.flush()

    new_name = payload.name.strip() if payload.name is not None else entity.name
    if not new_name:
        raise HTTPException(status_code=400, detail="Task category name is required")
    duplicate = (await db.execute(select(models.TaskCategory).where(
        func.lower(models.TaskCategory.name) == new_name.lower(), models.TaskCategory.id != entity.id
    ))).scalars().first()
    if duplicate:
        raise HTTPException(status_code=400, detail=f"Task category '{new_name}' already exists")

    if new_name.lower() != old_name.lower():
        for model in (models.TaskType, models.Task, models.PMSchedule, models.WorkOrder):
            await db.execute(update(model).where(func.lower(model.category) == old_name.lower()).values(category=new_name))
        entity.name = new_name
    if payload.description is not None:
        entity.description = payload.description.strip() or None
    if payload.is_active is not None:
        entity.is_active = payload.is_active
    await log_action(db, "update", "task_category", entity.id, entity.name,
                     old_values={"name": old_name}, new_values=payload.model_dump(exclude_unset=True),
                     message=f"Updated task category '{entity.name}'", user=current_user)
    await db.commit()
    await db.refresh(entity)
    return {"id": entity.id, "name": entity.name, "description": entity.description,
            "is_active": entity.is_active, "task_count": await _task_category_count(db, entity.name)}

def serialize_task(task: models.Task, pm_count: int = 0, wo_count: int = 0) -> dict:
    return {
        "id": task.id,
        "code": task.code,
        "description": task.description,
        "category": task.category or "General",
        "trade": task.trade,
        "pm_task_sheet": task.pm_task_sheet,
        "checklist_items": task.checklist_items or [],
        "estimated_hours": task.estimated_hours or 1.0,
        "task_type": sanitize_type_field(task.task_type or task.task_type_description or task.task_type_code),
        "task_type_code": sanitize_type_field(task.task_type_code),
        "task_type_description": sanitize_type_field(task.task_type_description),
        "is_active": task.is_active,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "pm_schedules_count": pm_count,
        "work_orders_count": wo_count,
        "rooms": [_serialize_room(room) for room in (task.rooms or [])],
        "equipment": [_serialize_equipment(equipment) for equipment in (task.equipment or [])],
    }

@router.get("/api/tasks", response_model=List[schemas.TaskWithDetails])
async def get_tasks(
    search: Optional[str] = Query(None, description="Search by task description, category, or procedure"),
    category: Optional[str] = Query(None, description="Filter by category"),
    trade: Optional[str] = Query(None, description="Filter by trade"),
    task_type: Optional[str] = Query(None, description="Filter by task type"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user)
):
    query = select(models.Task).options(*_task_options())

    if isinstance(is_active, bool):
        query = query.where(models.Task.is_active == is_active)

    if isinstance(category, str) and category and category.lower() != "all":
        query = query.where(models.Task.category.ilike(category))

    if isinstance(trade, str) and trade and trade.lower() != "all":
        query = query.where(models.Task.trade.ilike(trade))

    if isinstance(task_type, str) and task_type and task_type.lower() != "all":
        query = query.where(or_(
            models.Task.task_type.ilike(task_type),
            models.Task.task_type_code.ilike(task_type),
            models.Task.task_type_description.ilike(task_type),
        ))

    if isinstance(search, str) and search.strip():
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                models.Task.code.ilike(term),
                models.Task.description.ilike(term),
                models.Task.pm_task_sheet.ilike(term),
                models.Task.trade.ilike(term),
                models.Task.task_type.ilike(term),
                models.Task.task_type_description.ilike(term),
            )
        )

    # Safely extract limit/offset
    try:
        lim = int(limit) if not hasattr(limit, 'default') else int(limit.default)
    except Exception:
        lim = 500
    try:
        off = int(offset) if not hasattr(offset, 'default') else int(offset.default)
    except Exception:
        off = 0

    query = query.order_by(models.Task.description.asc()).limit(lim).offset(off)
    result = await db.execute(query)
    tasks = result.scalars().all()

    if not tasks:
        return []

    task_ids = [t.id for t in tasks]

    # Query PM schedule counts per task
    pm_counts_res = await db.execute(
        select(models.PMSchedule.task_id, func.count(models.PMSchedule.id))
        .where(models.PMSchedule.task_id.in_(task_ids))
        .group_by(models.PMSchedule.task_id)
    )
    pm_counts = dict(pm_counts_res.all())

    # Query Work Order counts per task
    wo_counts_res = await db.execute(
        select(models.WorkOrder.task_id, func.count(models.WorkOrder.id))
        .where(models.WorkOrder.task_id.in_(task_ids))
        .group_by(models.WorkOrder.task_id)
    )
    wo_counts = dict(wo_counts_res.all())

    return [
        serialize_task(
            t,
            pm_count=pm_counts.get(t.id, 0),
            wo_count=wo_counts.get(t.id, 0)
        )
        for t in tasks
    ]

@router.get("/api/tasks/{task_id}", response_model=schemas.TaskWithDetails)
async def get_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user)
):
    result = await db.execute(select(models.Task).options(*_task_options()).where(models.Task.id == task_id))
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Get usage counts
    pm_count = (await db.execute(select(func.count(models.PMSchedule.id)).where(models.PMSchedule.task_id == task_id))).scalar() or 0
    wo_count = (await db.execute(select(func.count(models.WorkOrder.id)).where(models.WorkOrder.task_id == task_id))).scalar() or 0

    return serialize_task(task, pm_count=pm_count, wo_count=wo_count)

@router.post("/api/tasks", response_model=schemas.TaskWithDetails)
async def create_task(
    payload: schemas.TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_manage_pm)
):
    import uuid
    code_val = (payload.code or "").strip()
    if code_val:
        # Check if code already exists
        existing = (await db.execute(select(models.Task).where(models.Task.code == code_val))).scalars().first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Task with code '{code_val}' already exists")
    else:
        code_val = f"TSK-{uuid.uuid4().hex[:8].upper()}"

    rooms = await _load_linked_items(db, models.Room, payload.room_ids, "room")
    equipment = await _load_linked_items(db, models.Equipment, payload.equipment_ids, "equipment")

    task = models.Task(
        code=code_val,
        description=payload.description.strip(),
        category=payload.category or "General",
        trade=payload.trade.strip() if payload.trade else None,
        pm_task_sheet=payload.pm_task_sheet.strip() if payload.pm_task_sheet else None,
        checklist_items=payload.checklist_items or [],
        estimated_hours=payload.estimated_hours or 1.0,
        task_type=sanitize_type_field(payload.task_type or payload.task_type_description or payload.task_type_code),
        task_type_code=sanitize_type_field(payload.task_type_code),
        task_type_description=sanitize_type_field(payload.task_type_description),
        is_active=payload.is_active,
    )
    task.rooms = rooms
    task.equipment = equipment
    db.add(task)
    try:
        await db.flush()
        await log_action(
            db, "create", "task", task.id, task.code,
            new_values=payload.model_dump(),
            message=f"Created task '{task.code}': {task.description}",
            user=current_user
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create task: {e}")

    task = (await db.execute(select(models.Task).options(*_task_options()).where(models.Task.id == task.id))).scalars().first()
    return serialize_task(task)

@router.put("/api/tasks/{task_id}", response_model=schemas.TaskWithDetails)
async def update_task(
    task_id: int,
    payload: schemas.TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_manage_pm)
):
    task = (await db.execute(select(models.Task).options(*_task_options()).where(models.Task.id == task_id))).scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = payload.model_dump(exclude_unset=True)

    if "code" in data and data["code"]:
        new_code = data["code"].strip()
        if new_code != task.code:
            existing = (await db.execute(select(models.Task).where(models.Task.code == new_code, models.Task.id != task_id))).scalars().first()
            if existing:
                raise HTTPException(status_code=400, detail=f"Task with code '{new_code}' already exists")
            task.code = new_code

    for field in [
        "description", "category", "trade", "pm_task_sheet",
        "checklist_items", "estimated_hours", "is_active"
    ]:
        if field in data:
            setattr(task, field, data[field].strip() if isinstance(data[field], str) else data[field])

    for type_field in ["task_type", "task_type_code", "task_type_description"]:
        if type_field in data:
            setattr(task, type_field, sanitize_type_field(data[type_field]))

    if "room_ids" in data:
        task.rooms = await _load_linked_items(db, models.Room, data["room_ids"], "room")
    if "equipment_ids" in data:
        task.equipment = await _load_linked_items(db, models.Equipment, data["equipment_ids"], "equipment")

    try:
        await log_action(
            db, "update", "task", task.id, task.code,
            new_values=data,
            message=f"Updated task '{task.code}'",
            user=current_user
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update task: {e}")

    task = (await db.execute(select(models.Task).options(*_task_options()).where(models.Task.id == task.id))).scalars().first()
    return serialize_task(task)

@router.delete("/api/tasks/{task_id}")
async def delete_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_manage_pm)
):
    task = (await db.execute(select(models.Task).where(models.Task.id == task_id))).scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Check if task is referenced by work orders or PM schedules
    pm_count = (await db.execute(select(func.count(models.PMSchedule.id)).where(models.PMSchedule.task_id == task_id))).scalar() or 0
    wo_count = (await db.execute(select(func.count(models.WorkOrder.id)).where(models.WorkOrder.task_id == task_id))).scalar() or 0

    if pm_count > 0 or wo_count > 0:
        # Soft delete by marking inactive
        task.is_active = False
        await log_action(
            db, "update", "task", task.id, task.code,
            new_values={"is_active": False},
            message=f"Deactivated task '{task.code}' (in use by {pm_count} PM schedules, {wo_count} work orders)",
            user=current_user
        )
        await db.commit()
        return {"message": f"Task '{task.code}' deactivated because it is linked to active records.", "deactivated": True}

    await db.delete(task)
    await log_action(
        db, "delete", "task", task_id, task.code,
        message=f"Deleted task '{task.code}'",
        user=current_user
    )
    await db.commit()
    return {"message": f"Task '{task.code}' deleted permanently.", "deleted": True}
