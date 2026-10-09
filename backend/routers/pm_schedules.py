import logging
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from database import get_db
import models
import schemas
from recurrence import RecurrenceValidationError, occurrences, summarize, validate_rule
from utils import log_action, require_manage_pm, require_user
from routers.notifications import send_push_notification_to_users


logger = logging.getLogger("backend.routers.pm_schedules")
router = APIRouter(tags=["pm_schedules"])


def compute_next_run(cron_expr: str, start_time: Optional[datetime] = None) -> datetime:
    expr = (cron_expr or "").strip()
    if not expr or not croniter.is_valid(expr):
        raise ValueError("Invalid cron expression")
    base = start_time or datetime.now(timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    value = croniter(expr, base).get_next(datetime)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _schedule_options():
    return (
        selectinload(models.PMSchedule.site),
        selectinload(models.PMSchedule.floorplan).selectinload(models.Floorplan.site),
        selectinload(models.PMSchedule.assignees),
        selectinload(models.PMSchedule.rooms).selectinload(models.Room.floorplan).selectinload(models.Floorplan.site),
        selectinload(models.PMSchedule.equipment).selectinload(models.Equipment.floorplan).selectinload(models.Floorplan.site),
        selectinload(models.PMSchedule.task),
    )


def serialize_pm_schedule(pm: models.PMSchedule) -> dict:
    return {
        "id": pm.id, "title": pm.title, "description": pm.description,
        "category": pm.category or "Preventive Maintenance", "trade": pm.trade, "priority": pm.priority or "medium",
        "cron_expression": pm.cron_expression, "recurrence_version": pm.recurrence_version,
        "recurrence_rule": pm.recurrence_rule, "timezone": pm.timezone or "UTC",
        "checklist_items": pm.checklist_items or [],
        "is_active": pm.is_active, "task_id": pm.task_id, "task_code": pm.task.code if pm.task else None,
        "task_description": pm.task.description if pm.task else None,
        "site_id": pm.site_id, "floorplan_id": pm.floorplan_id,
        "estimated_hours": pm.estimated_hours or 1.0, "last_run_at": pm.last_run_at,
        "next_run_at": pm.next_run_at, "created_at": pm.created_at, "updated_at": pm.updated_at,
        "site_name": pm.site.name if pm.site else (pm.floorplan.site.name if pm.floorplan and pm.floorplan.site else ""),
        "floorplan_name": pm.floorplan.name if pm.floorplan else "",
        "assignees": [{"id": u.id, "username": u.username, "full_name": u.full_name, "role": u.role, "trade": u.trade,
                       "can_triage": bool(u.can_triage or u.role == "admin")} for u in (pm.assignees or [])],
        "rooms": [{"id": r.id, "floorplan_id": r.floorplan_id, "name": r.name, "description": r.description,
                   "x_coordinate": r.x_coordinate, "y_coordinate": r.y_coordinate,
                   "floorplan_name": r.floorplan.name if r.floorplan else "",
                   "site_name": r.floorplan.site.name if r.floorplan and r.floorplan.site else "",
                   "site_id": r.floorplan.site_id if r.floorplan else 0} for r in (pm.rooms or [])],
        "equipment": [{"id": e.id, "floorplan_id": e.floorplan_id, "name": e.name, "description": e.description,
                       "x_coordinate": e.x_coordinate, "y_coordinate": e.y_coordinate, "color": e.color,
                       "photo_path": e.photo_path, "tools_required": e.tools_required,
                       "floorplan_name": e.floorplan.name if e.floorplan else "",
                       "site_name": e.floorplan.site.name if e.floorplan and e.floorplan.site else "",
                       "site_id": e.floorplan.site_id if e.floorplan else 0} for e in (pm.equipment or [])],
    }


async def get_pm_schedule_by_id(pm_id: int, db: AsyncSession) -> dict:
    result = await db.execute(select(models.PMSchedule).options(*_schedule_options()).where(models.PMSchedule.id == pm_id))
    pm = result.scalars().first()
    if not pm:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    return serialize_pm_schedule(pm)


def _next_for_values(cron_expression: str, version: Optional[int], rule: Optional[dict], after=None):
    try:
        if not croniter.is_valid((cron_expression or "").strip()):
            raise ValueError("Invalid cron expression")
        if rule is not None or version is not None:
            if rule is None or version is None:
                raise RecurrenceValidationError("recurrence_version and recurrence_rule must be supplied together")
            normalized = validate_rule(rule, version)
            upcoming = occurrences(normalized, 1, after=after or datetime.now(timezone.utc), version=version)
            return normalized, upcoming[0].issue_datetime if upcoming else None
        return None, compute_next_run(cron_expression, after)
    except (ValueError, RecurrenceValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


async def _load_ids(db: AsyncSession, model, ids: Optional[list[int]], label: str):
    if not ids:
        return []
    unique_ids = list(dict.fromkeys(ids))
    result = await db.execute(select(model).where(model.id.in_(unique_ids)))
    values = list(result.scalars().all())
    found = {value.id for value in values}
    missing = [value for value in unique_ids if value not in found]
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown {label} IDs: {missing}")
    return values


async def _validate_parent_ids(db: AsyncSession, site_id: Optional[int], floorplan_id: Optional[int]):
    if site_id is not None and not await db.get(models.Site, site_id):
        raise HTTPException(status_code=422, detail=f"Unknown site ID: {site_id}")
    if floorplan_id is not None and not await db.get(models.Floorplan, floorplan_id):
        raise HTTPException(status_code=422, detail=f"Unknown floorplan ID: {floorplan_id}")


def _validate_timezone(value: str):
    try:
        ZoneInfo(value)
    except (TypeError, ZoneInfoNotFoundError):
        raise HTTPException(status_code=422, detail="timezone must be a valid IANA timezone")


async def generate_work_order_from_schedule(
    pm: models.PMSchedule, db: AsyncSession, occurrence=None, manual: bool = False,
) -> models.WorkOrder:
    from routers.work_orders import generate_order_number
    now = datetime.now(timezone.utc)
    if occurrence:
        scheduled_for = occurrence.nominal_scheduled_datetime
        due_date = occurrence.due_datetime
    else:
        scheduled_for = None
        due_days = (pm.recurrence_rule or {}).get("due_after_issued_days", 0)
        due_date = now + timedelta(days=due_days)
    location_type = "none"
    if pm.equipment:
        location_type = "equipment" if len(pm.equipment) == 1 else "multi"
    elif pm.rooms:
        location_type = "room" if len(pm.rooms) == 1 else "multi"
    wo = models.WorkOrder(
        order_number=await generate_order_number(db), title=pm.title,
        description=pm.description or "Scheduled Preventive Maintenance",
        category=pm.category or "Preventive Maintenance", trade=pm.trade, priority=pm.priority or "medium",
        status="assigned" if pm.assignees else "unassigned", location_type=location_type,
        site_id=pm.site_id, floorplan_id=pm.floorplan_id, requester_name="PM Scheduler",
        estimated_hours=pm.estimated_hours or 1.0, start_date=scheduled_for, due_date=due_date, pm_schedule_id=pm.id,
        pm_scheduled_for=scheduled_for, task_id=pm.task_id,
        checklist_items=list(pm.checklist_items or []),
    )
    wo.assignees, wo.rooms, wo.equipment = list(pm.assignees or []), list(pm.rooms or []), list(pm.equipment or [])
    db.add(wo)
    if not manual:
        pm.last_run_at = now
    await db.flush()
    return wo


async def process_due_schedules(db: AsyncSession, now: Optional[datetime] = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    query = (select(models.PMSchedule).options(*_schedule_options())
             .where(models.PMSchedule.is_active.is_(True), models.PMSchedule.next_run_at <= now)
             .with_for_update(skip_locked=True))
    try:
        due = list((await db.execute(query)).scalars().all())
        generated = []
        assigned_user_ids = []
        for pm in due:
            occurrence = None
            if pm.recurrence_rule is not None:
                last_nominal = await db.scalar(select(func.max(models.WorkOrder.pm_scheduled_for)).where(
                    models.WorkOrder.pm_schedule_id == pm.id,
                    models.WorkOrder.pm_scheduled_for.is_not(None),
                ))
                if last_nominal is not None:
                    candidates = occurrences(pm.recurrence_rule, 1, version=pm.recurrence_version,
                                              after_nominal=last_nominal)
                else:
                    candidates = occurrences(pm.recurrence_rule, 1, version=pm.recurrence_version,
                                              after=pm.next_run_at - timedelta(microseconds=1))
                if not candidates:
                    pm.next_run_at = None
                    pm.is_active = False
                    continue
                occurrence = candidates[0]
            wo = await generate_work_order_from_schedule(pm, db, occurrence=occurrence)
            generated.append(wo.order_number)
            if wo.assignees:
                assigned_user_ids.extend(u.id for u in wo.assignees)
            if occurrence:
                following = occurrences(pm.recurrence_rule, 1, version=pm.recurrence_version,
                                        after_nominal=occurrence.nominal_scheduled_datetime)
                pm.next_run_at = following[0].issue_datetime if following else None
                if not following:
                    pm.is_active = False
            else:
                pm.next_run_at = compute_next_run(pm.cron_expression, pm.next_run_at or now)
        await db.commit()
        if assigned_user_ids:
            try:
                await send_push_notification_to_users(
                    db,
                    list(set(assigned_user_ids)),
                    title="EquipMap",
                    body="You have a new work order assignment.",
                    url="/work-orders"
                )
            except Exception as e:
                logger.error(f"Error sending push notification for generated PM work orders: {e}")
        return generated
    except Exception:
        await db.rollback()
        raise


@router.get("/api/pm-schedules", response_model=List[schemas.PMScheduleWithDetails])
async def get_pm_schedules(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_user)):
    result = await db.execute(select(models.PMSchedule).options(*_schedule_options()).order_by(models.PMSchedule.title.asc()))
    return [serialize_pm_schedule(pm) for pm in result.scalars().all()]


@router.get("/api/pm-schedules/calendar", response_model=schemas.PMCalendarResponse)
async def get_pm_schedule_calendar(
    start: datetime = Query(...),
    end: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    """Return active PM issue and due projections that intersect a bounded calendar range."""
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(status_code=422, detail="start and end must include a timezone")
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    if end_utc <= start_utc:
        raise HTTPException(status_code=422, detail="end must be after start")
    if end_utc - start_utc > timedelta(days=62):
        raise HTTPException(status_code=422, detail="calendar range cannot exceed 62 days")

    result = await db.execute(
        select(models.PMSchedule)
        .options(*_schedule_options())
        .where(models.PMSchedule.is_active.is_(True))
        .order_by(models.PMSchedule.title.asc())
    )
    calendar_items = []

    for pm in result.scalars().all():
        schedule_occurrences = []
        if pm.recurrence_rule is not None and pm.recurrence_version is not None:
            due_days = int((pm.recurrence_rule or {}).get("due_after_issued_days", 0) or 0)
            lookup_start = start_utc - timedelta(days=due_days, microseconds=1)
            range_days = max(1, (end_utc.date() - lookup_start.date()).days)
            occurrence_limit = min(1000, max(16, range_days + 7))
            try:
                schedule_occurrences = occurrences(
                    pm.recurrence_rule,
                    occurrence_limit,
                    after=lookup_start,
                    version=pm.recurrence_version,
                )
            except RecurrenceValidationError:
                logger.warning("Skipping invalid recurrence rule for PM schedule %s", pm.id)
                continue
        else:
            try:
                schedule_zone = ZoneInfo(pm.timezone or "UTC")
                cursor = (start_utc - timedelta(microseconds=1)).astimezone(schedule_zone)
                iterator = croniter(pm.cron_expression, cursor)
                for occurrence_number in range(1, 1001):
                    issue = iterator.get_next(datetime)
                    if issue.tzinfo is None:
                        issue = issue.replace(tzinfo=schedule_zone)
                    issue_utc = issue.astimezone(timezone.utc)
                    if issue_utc >= end_utc:
                        break
                    schedule_occurrences.append(SimpleNamespace(
                        occurrence_number=occurrence_number,
                        nominal_scheduled_date=issue.astimezone(schedule_zone).date(),
                        nominal_scheduled_datetime=issue_utc,
                        issue_datetime=issue_utc,
                        due_datetime=issue_utc,
                        adjustment_reason=None,
                    ))
            except (TypeError, ValueError, ZoneInfoNotFoundError):
                logger.warning("Skipping invalid legacy recurrence for PM schedule %s", pm.id)
                continue

        assignee_names = [user.full_name or user.username for user in (pm.assignees or [])]
        assignee_usernames = [user.username for user in (pm.assignees or [])]
        site_name = pm.site.name if pm.site else (
            pm.floorplan.site.name if pm.floorplan and pm.floorplan.site else ""
        )
        for occurrence in schedule_occurrences:
            if not (
                start_utc <= occurrence.issue_datetime < end_utc
                or start_utc <= occurrence.due_datetime < end_utc
            ):
                if occurrence.issue_datetime >= end_utc and occurrence.due_datetime >= end_utc:
                    break
                continue
            calendar_items.append({
                **(occurrence.to_dict() if hasattr(occurrence, "to_dict") else {
                    "occurrence_number": occurrence.occurrence_number,
                    "nominal_scheduled_date": occurrence.nominal_scheduled_date,
                    "nominal_scheduled_datetime": occurrence.nominal_scheduled_datetime,
                    "issue_datetime": occurrence.issue_datetime,
                    "due_datetime": occurrence.due_datetime,
                    "adjustment_reason": occurrence.adjustment_reason,
                }),
                "schedule_id": pm.id,
                "title": pm.title,
                "category": pm.category or "Preventive Maintenance",
                "trade": pm.trade,
                "priority": pm.priority or "medium",
                "task_code": pm.task.code if pm.task else None,
                "site_name": site_name,
                "floorplan_name": pm.floorplan.name if pm.floorplan else "",
                "assignee_names": assignee_names,
                "assignee_usernames": assignee_usernames,
            })

    calendar_items.sort(key=lambda item: (item["issue_datetime"], item["title"].lower(), item["schedule_id"]))
    return {"start": start_utc, "end": end_utc, "occurrences": calendar_items}


@router.get("/api/pm-schedules/{pm_id}", response_model=schemas.PMScheduleWithDetails)
async def get_pm_schedule(
    pm_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    return await get_pm_schedule_by_id(pm_id, db)


@router.post("/api/pm-schedules/preview", response_model=schemas.PMPreviewResponse)
async def preview_pm_schedule(payload: schemas.PMPreviewRequest, current_user: models.User = Depends(require_user)):
    try:
        return {"summary": summarize(payload.recurrence_rule, payload.recurrence_version),
                "occurrences": [item.to_dict() for item in occurrences(
                    payload.recurrence_rule, payload.count, version=payload.recurrence_version)]}
    except RecurrenceValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/api/pm-schedules", response_model=schemas.PMScheduleWithDetails)
async def create_pm_schedule(payload: schemas.PMScheduleCreate, db: AsyncSession = Depends(get_db),
                             current_user: models.User = Depends(require_manage_pm)):
    normalized, next_run = _next_for_values(payload.cron_expression, payload.recurrence_version, payload.recurrence_rule)
    _validate_timezone(normalized["timezone"] if normalized else payload.timezone)
    await _validate_parent_ids(db, payload.site_id, payload.floorplan_id)
    rooms = await _load_ids(db, models.Room, payload.room_ids, "room")
    equipment = await _load_ids(db, models.Equipment, payload.equipment_ids, "equipment")
    assignees = await _load_ids(db, models.User, payload.assigned_user_ids, "user")
    pm = models.PMSchedule(
        title=payload.title.strip(), description=payload.description.strip() if payload.description else None,
        category=payload.category or "Preventive Maintenance", trade=payload.trade.strip() if payload.trade else None,
        priority=payload.priority or "medium",
        cron_expression=payload.cron_expression.strip(), recurrence_version=payload.recurrence_version,
        recurrence_rule=normalized, timezone=normalized["timezone"] if normalized else payload.timezone,
        checklist_items=payload.checklist_items or [], is_active=payload.is_active,
        task_id=payload.task_id, site_id=payload.site_id, floorplan_id=payload.floorplan_id,
        estimated_hours=payload.estimated_hours or 1.0, next_run_at=next_run,
    )
    pm.rooms, pm.equipment, pm.assignees = rooms, equipment, assignees
    try:
        db.add(pm)
        await db.flush()
        await log_action(db, "create", "pm_schedule", pm.id, pm.title, new_values=payload.model_dump(),
                         message=f"Created PM schedule '{pm.title}'", user=current_user)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return await get_pm_schedule_by_id(pm.id, db)


@router.put("/api/pm-schedules/{pm_id}", response_model=schemas.PMScheduleWithDetails)
async def update_pm_schedule(pm_id: int, payload: schemas.PMScheduleUpdate, db: AsyncSession = Depends(get_db),
                             current_user: models.User = Depends(require_manage_pm)):
    pm = (await db.execute(select(models.PMSchedule).options(*_schedule_options()).where(models.PMSchedule.id == pm_id))).scalars().first()
    if not pm:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    data = payload.model_dump(exclude_unset=True)
    cron = data.get("cron_expression", pm.cron_expression)
    version = data.get("recurrence_version", pm.recurrence_version)
    rule = data.get("recurrence_rule", pm.recurrence_rule)
    normalized = pm.recurrence_rule
    if {"cron_expression", "recurrence_version", "recurrence_rule"} & data.keys():
        normalized, next_run = _next_for_values(cron, version, rule)
        pm.cron_expression, pm.recurrence_version, pm.recurrence_rule = cron.strip(), version, normalized
        pm.next_run_at = next_run
        if normalized:
            pm.timezone = normalized["timezone"]
    _validate_timezone(normalized["timezone"] if normalized else data.get("timezone", pm.timezone))
    await _validate_parent_ids(db, data.get("site_id", pm.site_id), data.get("floorplan_id", pm.floorplan_id))
    for field in ["title", "description", "category", "trade", "priority", "is_active", "task_id", "site_id", "floorplan_id",
                  "estimated_hours", "timezone", "checklist_items"]:
        if field in data:
            if field == "timezone" and normalized:
                continue
            setattr(pm, field, data[field].strip() if isinstance(data[field], str) else data[field])
    for key, model, attr, label in [("assigned_user_ids", models.User, "assignees", "user"),
                                    ("room_ids", models.Room, "rooms", "room"),
                                    ("equipment_ids", models.Equipment, "equipment", "equipment")]:
        if key in data:
            setattr(pm, attr, await _load_ids(db, model, data[key], label))
    try:
        await log_action(db, "update", "pm_schedule", pm.id, pm.title, new_values=data,
                         message=f"Updated PM schedule '{pm.title}'", user=current_user)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return await get_pm_schedule_by_id(pm.id, db)


@router.delete("/api/pm-schedules/{pm_id}")
async def delete_pm_schedule(pm_id: int, db: AsyncSession = Depends(get_db),
                             current_user: models.User = Depends(require_manage_pm)):
    pm = await db.get(models.PMSchedule, pm_id)
    if not pm:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    title = pm.title
    try:
        await db.delete(pm)
        await log_action(db, "delete", "pm_schedule", pm_id, title, message=f"Deleted PM schedule '{title}'", user=current_user)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return {"status": "success", "message": f"PM schedule '{title}' deleted"}


@router.post("/api/pm-schedules/{pm_id}/trigger", response_model=schemas.WorkOrderWithDetails)
async def trigger_pm_schedule(pm_id: int, db: AsyncSession = Depends(get_db),
                              current_user: models.User = Depends(require_manage_pm)):
    pm = (await db.execute(select(models.PMSchedule).options(*_schedule_options()).where(models.PMSchedule.id == pm_id))).scalars().first()
    if not pm:
        raise HTTPException(status_code=404, detail="PM schedule not found")
    try:
        wo = await generate_work_order_from_schedule(pm, db, manual=True)
        await db.commit()
        if wo.assignees:
            try:
                await send_push_notification_to_users(
                    db,
                    [u.id for u in wo.assignees],
                    title="EquipMap",
                    body="You have a new work order assignment.",
                    url="/work-orders"
                )
            except Exception as e:
                logger.error(f"Error sending push notification for triggered PM work order {wo.order_number}: {e}")
    except Exception:
        await db.rollback()
        raise
    from routers.work_orders import get_work_order_by_id
    return await get_work_order_by_id(wo.id, db)


@router.post("/api/pm-schedules/check-due")
async def check_due_pm_schedules(db: AsyncSession = Depends(get_db),
                                 current_user: models.User = Depends(require_manage_pm)):
    try:
        generated = await process_due_schedules(db)
    except IntegrityError:
        logger.info("A PM occurrence was already generated by another dispatcher")
        generated = []
    return {"due_count": len(generated), "generated_orders": generated}
