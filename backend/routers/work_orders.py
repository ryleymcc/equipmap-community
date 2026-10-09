import logging
from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, func, or_, and_, desc

from database import get_db
import models
import schemas
from utils import (
    require_user, require_work_order_user, get_current_user, require_triage,
    require_create_work_order, require_close_work_order, require_assign,
    log_action, check_etag_match, respond_304, parse_device_details
)
from routers.notifications import send_push_notification_to_users, send_push_notification_for_triage
from limiter import limiter, get_real_ip


logger = logging.getLogger("backend.routers.work_orders")
router = APIRouter(tags=["work_orders"])

def _is_past(dt: Optional[datetime]) -> bool:
    if not dt:
        return False
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt <= now

async def generate_order_number(db: AsyncSession) -> str:
    # Serialize allocation until this creation transaction commits.
    await db.execute(text("SELECT pg_advisory_xact_lock(42001)"))
    result = await db.execute(select(func.max(models.WorkOrder.id)))
    max_id = result.scalar() or 0
    next_num = 1000 + max_id + 1
    return f"WO-{next_num}"

def serialize_work_order(wo: models.WorkOrder) -> dict:
    linked_task_sheet = wo.task or (
        wo.task_type_record.task_sheet
        if wo.task_type_record and wo.task_type_record.task_sheet
        else None
    )
    return {
        "id": wo.id,
        "order_number": wo.order_number or f"WO-{1000 + wo.id}",
        "title": wo.title,
        "description": wo.description,
        "category": wo.category or "General",
        "trade": wo.trade,
        "priority": wo.priority or "medium",
        "status": wo.status or "pending_triage",
        "location_type": wo.location_type or "none",
        "site_id": wo.site_id,
        "floorplan_id": wo.floorplan_id,
        "x_coordinate": wo.x_coordinate,
        "y_coordinate": wo.y_coordinate,
        "location_details": wo.location_details,
        "requester_name": wo.requester_name or "Anonymous",
        "requester_email": wo.requester_email,
        "requester_phone": wo.requester_phone,
        "ip_address": wo.ip_address,
        "user_agent": wo.user_agent,
        "device_details": wo.device_details,
        "created_by_id": wo.created_by_id,
        "triaged_by_id": wo.triaged_by_id,
        "triaged_at": wo.triaged_at,
        "start_date": wo.start_date,
        "due_date": wo.due_date,
        "estimated_hours": wo.estimated_hours or 0.0,
        "actual_hours": wo.actual_hours or 0.0,
        "completion_notes": wo.completion_notes,
        "completed_at": wo.completed_at,
        "pm_schedule_id": wo.pm_schedule_id,
        "pm_scheduled_for": wo.pm_scheduled_for,
        "task_id": wo.task_id,
        "task_type_id": wo.task_type_id,
        "task_type_code": wo.task_type_record.code if wo.task_type_record else None,
        "task_type_name": wo.task_type_record.name if wo.task_type_record else None,
        "task_sheet_id": linked_task_sheet.id if linked_task_sheet else None,
        "task_code": linked_task_sheet.code if linked_task_sheet else None,
        "task_description": linked_task_sheet.description if linked_task_sheet else None,
        "task_sheet": linked_task_sheet.pm_task_sheet if linked_task_sheet else None,
        "checklist_items": wo.checklist_items or [],
        "created_at": wo.created_at,
        "updated_at": wo.updated_at,
        "site_name": wo.site.name if wo.site else (wo.floorplan.site.name if wo.floorplan and wo.floorplan.site else ""),
        "floorplan_name": wo.floorplan.name if wo.floorplan else "",
        "creator_username": wo.creator.username if wo.creator else None,
        "creator_name": (wo.creator.full_name or wo.creator.username) if wo.creator else None,
        "triaged_by_username": wo.triaged_by.username if wo.triaged_by else None,
        "triaged_by_name": (wo.triaged_by.full_name or wo.triaged_by.username) if wo.triaged_by else None,
        "assignees": [
            {
                "id": u.id,
                "username": u.username,
                "full_name": u.full_name,
                "role": u.role,
                "trade": u.trade,
                "can_triage": bool(u.can_triage or u.role == "admin")
            }
            for u in (wo.assignees or [])
        ],
        "rooms": [
            {
                "id": r.id,
                "floorplan_id": r.floorplan_id,
                "name": r.name,
                "description": r.description,
                "x_coordinate": r.x_coordinate,
                "y_coordinate": r.y_coordinate,
                "floorplan_name": r.floorplan.name if r.floorplan else "",
                "site_name": r.floorplan.site.name if r.floorplan and r.floorplan.site else "",
                "site_id": r.floorplan.site_id if r.floorplan else 0,
            }
            for r in (wo.rooms or [])
        ],
        "equipment": [
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
            for e in (wo.equipment or [])
        ],
        "labor_entries": [
            {
                "id": le.id,
                "work_order_id": le.work_order_id,
                "user_id": le.user_id,
                "hours": le.hours,
                "comment": le.comment,
                "entry_date": le.entry_date,
                "created_at": le.created_at,
                "user_username": le.user.username if le.user else None,
                "user_full_name": le.user.full_name if le.user else None,
                "user_display_name": (le.user.full_name or le.user.username) if le.user else None
            }
            for le in (wo.labor_entries or [])
        ],
        "comments": [
            {
                "id": c.id,
                "work_order_id": c.work_order_id,
                "user_id": c.user_id,
                "author_name": c.author_name,
                "comment": c.comment,
                "created_at": c.created_at
            }
            for c in (wo.comments or [])
        ]
    }

@router.post("/api/work-orders/public", response_model=schemas.WorkOrderWithDetails)
@limiter.limit("20/minute")
async def create_public_work_order(
    request: Request,
    payload: schemas.WorkOrderPublicCreate,
    db: AsyncSession = Depends(get_db)
):

    order_num = await generate_order_number(db)

    # Resolve locations
    site_id = payload.site_id
    floorplan_id = payload.floorplan_id
    x_coord = payload.x_coordinate
    y_coord = payload.y_coordinate
    loc_type = payload.location_type or "none"

    rooms_to_link = []
    if payload.room_ids:
        r_res = await db.execute(
            select(models.Room)
            .options(joinedload(models.Room.floorplan))
            .where(models.Room.id.in_(payload.room_ids))
        )
        rooms_to_link = list(r_res.scalars().all())
        if rooms_to_link and not floorplan_id:
            floorplan_id = rooms_to_link[0].floorplan_id
            site_id = rooms_to_link[0].floorplan.site_id if rooms_to_link[0].floorplan else site_id
            if x_coord is None:
                x_coord = rooms_to_link[0].x_coordinate
                y_coord = rooms_to_link[0].y_coordinate
        if not loc_type or loc_type == "none":
            loc_type = "room" if len(rooms_to_link) == 1 else "multi"

    equip_to_link = []
    if payload.equipment_ids:
        e_res = await db.execute(
            select(models.Equipment)
            .options(joinedload(models.Equipment.floorplan))
            .where(models.Equipment.id.in_(payload.equipment_ids))
        )
        equip_to_link = list(e_res.scalars().all())
        if equip_to_link and not floorplan_id:
            floorplan_id = equip_to_link[0].floorplan_id
            site_id = equip_to_link[0].floorplan.site_id if equip_to_link[0].floorplan else site_id
            if x_coord is None:
                x_coord = equip_to_link[0].x_coordinate
                y_coord = equip_to_link[0].y_coordinate
        if not loc_type or loc_type == "none":
            loc_type = "equipment" if len(equip_to_link) == 1 else "multi"

    if floorplan_id and not site_id:
        fp_res = await db.execute(select(models.Floorplan).where(models.Floorplan.id == floorplan_id))
        fp = fp_res.scalars().first()
        if fp:
            site_id = fp.site_id

    # Extract client IP and Device / User-Agent details
    client_ip = get_real_ip(request)
    ua_str = request.headers.get("user-agent")
    parsed_device = parse_device_details(ua_str, payload.device_details)

    db_wo = models.WorkOrder(
        order_number=order_num,
        title=payload.title.strip(),
        description=payload.description.strip() if payload.description else None,
        category=payload.category or "General",
        trade=payload.trade.strip() if payload.trade else None,
        priority=payload.priority or "medium",
        status="pending_triage",
        location_type=loc_type,
        site_id=site_id,
        floorplan_id=floorplan_id,
        x_coordinate=x_coord,
        y_coordinate=y_coord,
        location_details=payload.location_details,
        requester_name=payload.requester_name.strip() if payload.requester_name else "Anonymous",
        requester_email=payload.requester_email.strip() if payload.requester_email else None,
        requester_phone=payload.requester_phone.strip() if payload.requester_phone else None,
        ip_address=client_ip,
        user_agent=ua_str,
        device_details=parsed_device,
        start_date=payload.start_date,
        task_id=payload.task_id,
        task_type_id=payload.task_type_id,
        checklist_items=list(payload.checklist_items or []),
    )
    db_wo.rooms = rooms_to_link
    db_wo.equipment = equip_to_link

    db.add(db_wo)
    await db.commit()
    await db.refresh(db_wo)

    await log_action(
        db, "create", "work_order", db_wo.id, db_wo.order_number,
        new_values=payload.model_dump(),
        message=f"Public maintenance request submitted '{db_wo.order_number}': {db_wo.title}",
        username=payload.requester_name.strip() if payload.requester_name else "Anonymous"
    )
    await db.commit()

    try:
        await send_push_notification_for_triage(
            db,
            title="EquipMap",
            body="You have a new maintenance request to triage.",
            url="/work-orders"
        )
    except Exception as e:
        logger.error(f"Error sending triage push notification for public request {db_wo.order_number}: {e}")

    # Refetch full details
    return await get_work_order_by_id(db_wo.id, db)

@router.post("/api/work-orders", response_model=schemas.WorkOrderWithDetails)
async def create_work_order(
    request: Request,
    payload: schemas.WorkOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_create_work_order)
):
    # Check if assigning someone other than current_user without assignment permission
    is_admin = current_user.role == "admin"
    can_assign = is_admin or bool(getattr(current_user, "can_assign", False)) or bool(getattr(current_user, "can_triage", False))
    if payload.assigned_user_ids:
        other_assignees = [uid for uid in payload.assigned_user_ids if uid != current_user.id]
        if other_assignees and not can_assign:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to assign or unassign technicians."
            )

    order_num = await generate_order_number(db)

    site_id = payload.site_id
    floorplan_id = payload.floorplan_id
    x_coord = payload.x_coordinate
    y_coord = payload.y_coordinate
    loc_type = payload.location_type or "none"

    rooms_to_link = []
    if payload.room_ids:
        r_res = await db.execute(
            select(models.Room)
            .options(joinedload(models.Room.floorplan))
            .where(models.Room.id.in_(payload.room_ids))
        )
        rooms_to_link = list(r_res.scalars().all())
        if rooms_to_link and not floorplan_id:
            floorplan_id = rooms_to_link[0].floorplan_id
            site_id = rooms_to_link[0].floorplan.site_id if rooms_to_link[0].floorplan else site_id
            if x_coord is None:
                x_coord = rooms_to_link[0].x_coordinate
                y_coord = rooms_to_link[0].y_coordinate
        if not loc_type or loc_type == "none":
            loc_type = "room" if len(rooms_to_link) == 1 else "multi"

    equip_to_link = []
    if payload.equipment_ids:
        e_res = await db.execute(
            select(models.Equipment)
            .options(joinedload(models.Equipment.floorplan))
            .where(models.Equipment.id.in_(payload.equipment_ids))
        )
        equip_to_link = list(e_res.scalars().all())
        if equip_to_link and not floorplan_id:
            floorplan_id = equip_to_link[0].floorplan_id
            site_id = equip_to_link[0].floorplan.site_id if equip_to_link[0].floorplan else site_id
            if x_coord is None:
                x_coord = equip_to_link[0].x_coordinate
                y_coord = equip_to_link[0].y_coordinate
        if not loc_type or loc_type == "none":
            loc_type = "equipment" if len(equip_to_link) == 1 else "multi"

    assignees_to_link = []
    if payload.assigned_user_ids:
        u_res = await db.execute(select(models.User).where(models.User.id.in_(payload.assigned_user_ids)))
        assignees_to_link = list(u_res.scalars().all())

    if floorplan_id and not site_id:
        fp_res = await db.execute(select(models.Floorplan).where(models.Floorplan.id == floorplan_id))
        fp = fp_res.scalars().first()
        if fp:
            site_id = fp.site_id

    init_status = payload.status or ("assigned" if assignees_to_link else "unassigned")
    if init_status == "assigned" and not assignees_to_link:
        init_status = "unassigned"
    elif init_status == "pending_triage":
        init_status = "assigned" if assignees_to_link else "unassigned"

    # Automatically promote to in_progress if start_date has already passed for active order
    if _is_past(payload.start_date) and init_status in ("assigned", "unassigned"):
        init_status = "in_progress"

    auth_client_ip = payload.ip_address or get_real_ip(request)
    auth_ua_str = payload.user_agent or request.headers.get("user-agent")
    auth_device = parse_device_details(auth_ua_str, payload.device_details)

    db_wo = models.WorkOrder(
        order_number=order_num,
        title=payload.title.strip(),
        description=payload.description.strip() if payload.description else None,
        category=payload.category or "General",
        trade=payload.trade.strip() if payload.trade else None,
        priority=payload.priority or "medium",
        status=init_status,
        location_type=loc_type,
        site_id=site_id,
        floorplan_id=floorplan_id,
        x_coordinate=x_coord,
        y_coordinate=y_coord,
        location_details=payload.location_details,
        requester_name=payload.requester_name.strip() if payload.requester_name else current_user.username,
        requester_email=payload.requester_email.strip() if payload.requester_email else None,
        requester_phone=payload.requester_phone.strip() if payload.requester_phone else None,
        ip_address=auth_client_ip,
        user_agent=auth_ua_str,
        device_details=auth_device,
        created_by_id=current_user.id,
        start_date=payload.start_date,
        due_date=payload.due_date,
        estimated_hours=payload.estimated_hours or 0.0,
        task_id=payload.task_id,
        task_type_id=payload.task_type_id,
        checklist_items=list(payload.checklist_items or []),
    )
    db_wo.rooms = rooms_to_link
    db_wo.equipment = equip_to_link
    db_wo.assignees = assignees_to_link

    db.add(db_wo)
    await db.commit()
    await db.refresh(db_wo)

    await log_action(
        db, "create", "work_order", db_wo.id, db_wo.order_number,
        new_values=payload.model_dump(),
        message=f"Created work order '{db_wo.order_number}': {db_wo.title}",
        user=current_user
    )
    await db.commit()

    if db_wo.status == "pending_triage":
        try:
            await send_push_notification_for_triage(
                db,
                title="EquipMap",
                body="You have a new maintenance request to triage.",
                url="/work-orders"
            )
        except Exception as e:
            logger.error(f"Error sending triage push notification for work order {db_wo.order_number}: {e}")
    elif assignees_to_link:
        try:
            await send_push_notification_to_users(
                db,
                [u.id for u in assignees_to_link],
                title="EquipMap",
                body="You have a new work order assignment.",
                url="/work-orders"
            )
        except Exception as e:
            logger.error(f"Error sending push notification for work order {db_wo.order_number}: {e}")

    return await get_work_order_by_id(db_wo.id, db)

async def get_work_order_by_id(wo_id: int, db: AsyncSession) -> dict:
    query = (
        select(models.WorkOrder)
        .options(
            selectinload(models.WorkOrder.site),
            selectinload(models.WorkOrder.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.WorkOrder.creator),
            selectinload(models.WorkOrder.triaged_by),
            selectinload(models.WorkOrder.assignees),
            selectinload(models.WorkOrder.rooms).selectinload(models.Room.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.WorkOrder.equipment).selectinload(models.Equipment.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.WorkOrder.labor_entries).selectinload(models.WorkOrderLaborEntry.user),
            selectinload(models.WorkOrder.comments).selectinload(models.WorkOrderComment.user),
            selectinload(models.WorkOrder.task),
            selectinload(models.WorkOrder.task_type_record).selectinload(models.TaskType.task_sheet),
        )
        .where(models.WorkOrder.id == wo_id)
    )
    res = await db.execute(query)
    wo = res.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    return serialize_work_order(wo)

@router.get("/api/work-orders", response_model=schemas.WorkOrdersResponse)
async def get_all_work_orders(
    request: Request,
    response: Response,
    status_filter: Optional[str] = None,
    priority: Optional[str] = None,
    category: Optional[str] = None,
    trade: Optional[str] = None,
    assigned_user_id: Optional[str] = None,
    site_id: Optional[str] = None,
    floorplan_id: Optional[str] = None,
    room_id: Optional[str] = None,
    equipment_id: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user)
):
    # ETag computation
    etag_res = await db.execute(text("""
        SELECT md5(concat_ws(',',
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM work_orders),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM work_order_labor_entries),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM work_order_comments),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM task_types),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM tasks),
            'work-order-task-fields-v2'
        ))
    """))
    db_hash = etag_res.scalar() or ""
    etag = f'W/"{db_hash}"'
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"

    if check_etag_match(request.headers.get("if-none-match"), etag):
        return respond_304(etag)

    # Base query for all work orders with loaded relationships
    query = (
        select(models.WorkOrder)
        .options(
            selectinload(models.WorkOrder.site),
            selectinload(models.WorkOrder.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.WorkOrder.creator),
            selectinload(models.WorkOrder.triaged_by),
            selectinload(models.WorkOrder.assignees),
            selectinload(models.WorkOrder.rooms).selectinload(models.Room.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.WorkOrder.equipment).selectinload(models.Equipment.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.WorkOrder.labor_entries).selectinload(models.WorkOrderLaborEntry.user),
            selectinload(models.WorkOrder.comments).selectinload(models.WorkOrderComment.user),
            selectinload(models.WorkOrder.task),
            selectinload(models.WorkOrder.task_type_record).selectinload(models.TaskType.task_sheet),
        )
        .order_by(desc(models.WorkOrder.created_at))
    )

    result = await db.execute(query)
    all_wos = result.scalars().all()

    # Calculate summary counts across all orders
    summary = schemas.WorkOrderSummary(
        total=len(all_wos),
        pending_triage_count=sum(1 for w in all_wos if w.status == "pending_triage"),
        unassigned_count=sum(1 for w in all_wos if w.status == "unassigned"),
        assigned_count=sum(1 for w in all_wos if w.status == "assigned"),
        in_progress_count=sum(1 for w in all_wos if w.status == "in_progress"),
        completed_count=sum(1 for w in all_wos if w.status == "completed"),
        on_hold_count=sum(1 for w in all_wos if w.status in ["on_hold", "cancelled", "rejected"])
    )

    # Apply filters in Python or SQL
    filtered = all_wos
    if status_filter and status_filter != "all":
        if status_filter == "open":
            filtered = [w for w in filtered if w.status not in ["completed", "cancelled", "rejected"]]
        else:
            filtered = [w for w in filtered if w.status == status_filter]

    if priority and priority != "all":
        filtered = [w for w in filtered if w.priority == priority]

    if category and category != "all":
        filtered = [w for w in filtered if w.category == category]

    if trade and trade != "all":
        filtered = [w for w in filtered if (w.trade or "").lower() == trade.lower()]

    int_assigned_user_id = int(assigned_user_id) if assigned_user_id and str(assigned_user_id).isdigit() else None
    int_site_id = int(site_id) if site_id and str(site_id).isdigit() else None
    int_floorplan_id = int(floorplan_id) if floorplan_id and str(floorplan_id).isdigit() else None
    int_room_id = int(room_id) if room_id and str(room_id).isdigit() else None
    int_equipment_id = int(equipment_id) if equipment_id and str(equipment_id).isdigit() else None

    if int_assigned_user_id:
        filtered = [w for w in filtered if any(u.id == int_assigned_user_id for u in (w.assignees or []))]

    if int_site_id:
        filtered = [w for w in filtered if w.site_id == int_site_id or (w.floorplan and w.floorplan.site_id == int_site_id)]

    if int_floorplan_id:
        def work_order_matches_floorplan(work_order):
            # Linked room/equipment locations are authoritative for map
            # placement. Their floorplan can change after the work order was
            # created, so do not keep the badge on the old floorplan snapshot.
            if work_order.location_type == "room" and work_order.rooms:
                return any(r.floorplan_id == int_floorplan_id for r in work_order.rooms)
            if work_order.location_type == "equipment" and work_order.equipment:
                return any(e.floorplan_id == int_floorplan_id for e in work_order.equipment)
            return work_order.floorplan_id == int_floorplan_id

        filtered = [
            w for w in filtered
            if work_order_matches_floorplan(w)
        ]

    if int_room_id:
        filtered = [w for w in filtered if any(r.id == int_room_id for r in (w.rooms or []))]

    if int_equipment_id:
        filtered = [w for w in filtered if any(e.id == int_equipment_id for e in (w.equipment or []))]

    if search:
        s = search.lower().strip()
        filtered = [
            w for w in filtered
            if (w.order_number and s in w.order_number.lower())
            or (w.title and s in w.title.lower())
            or (w.description and s in w.description.lower())
            or (w.requester_name and s in w.requester_name.lower())
            or (w.location_details and s in w.location_details.lower())
            or ((w.trade or "") and s in (w.trade or "").lower())
            or any(r.name and s in r.name.lower() for r in (w.rooms or []))
            or any(e.name and s in e.name.lower() for e in (w.equipment or []))
            or any(((u.full_name and s in u.full_name.lower()) or (u.username and s in u.username.lower())) for u in (w.assignees or []))
        ]

    data = [serialize_work_order(w) for w in filtered]
    return {
        "summary": summary,
        "data": data
    }

@router.put("/api/work-orders/{wo_id}", response_model=schemas.WorkOrderWithDetails)
async def update_work_order(
    wo_id: int,
    payload: schemas.WorkOrderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    query = (
        select(models.WorkOrder)
        .options(
            selectinload(models.WorkOrder.assignees),
            selectinload(models.WorkOrder.rooms),
            selectinload(models.WorkOrder.equipment)
        )
        .where(models.WorkOrder.id == wo_id)
    )
    res = await db.execute(query)
    wo = res.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    # Check triage permission if modifying triage status or assigning users
    is_admin = current_user.role == "admin"
    can_triage = bool(current_user.can_triage or is_admin)
    can_assign = is_admin or bool(getattr(current_user, "can_assign", False)) or can_triage

    is_triaging = (
        (wo.status == "pending_triage" and payload.status and payload.status != "pending_triage") or
        payload.status == "rejected"
    )

    if is_triaging and not can_triage:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Designated triage permission is required to triage work orders."
        )

    old_assignee_ids = {u.id for u in (wo.assignees or [])}
    new_requested_assignee_ids = set(payload.assigned_user_ids) if payload.assigned_user_ids is not None else None

    if new_requested_assignee_ids is not None and new_requested_assignee_ids != old_assignee_ids and not can_assign:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to assign or unassign technicians."
        )

    # If transitioning out of pending_triage, mark triaged_by
    if wo.status == "pending_triage" and payload.status and payload.status != "pending_triage":
        wo.triaged_by_id = current_user.id
        wo.triaged_at = datetime.utcnow()

    # Update basic fields
    data_dict = payload.model_dump(exclude_unset=True)

    for field in [
        "title", "description", "category", "trade", "priority", "status",
        "location_type", "site_id", "floorplan_id", "x_coordinate", "y_coordinate",
        "location_details", "requester_name", "requester_email", "requester_phone",
        "start_date", "due_date", "estimated_hours", "actual_hours", "completion_notes",
        "task_id", "task_type_id", "checklist_items"
    ]:
        if field in data_dict:
            val = data_dict[field]
            if field == "title":
                if val and isinstance(val, str) and val.strip():
                    wo.title = val.strip()
            elif field in ("description", "trade", "location_details", "requester_email", "requester_phone", "completion_notes"):
                if isinstance(val, str):
                    setattr(wo, field, val.strip() if val.strip() else None)
                else:
                    setattr(wo, field, val)
            elif field == "task_id":
                wo.task_id = val # Can be int or None to unlink
            elif field == "task_type_id":
                wo.task_type_id = val
            elif field == "checklist_items":
                wo.checklist_items = val if val is not None else []
            elif field in ("category", "priority", "status", "location_type"):
                if val:
                    setattr(wo, field, val)
            else:
                setattr(wo, field, val)

    # If status is set to completed, set completed_at
    if payload.status == "completed" and not wo.completed_at:
        wo.completed_at = datetime.utcnow()

    # Update assignees
    new_assignee_ids = []
    if payload.assigned_user_ids is not None and can_assign:
        if payload.assigned_user_ids:
            u_res = await db.execute(select(models.User).where(models.User.id.in_(payload.assigned_user_ids)))
            wo.assignees = list(u_res.scalars().all())
            new_assignee_ids = [u.id for u in wo.assignees if u.id not in old_assignee_ids]
        else:
            wo.assignees = []

    # Automatically synchronize status with technician assignment
    if wo.status == "assigned" and not wo.assignees:
        wo.status = "unassigned"
    elif wo.status == "unassigned" and wo.assignees:
        wo.status = "assigned"
    elif wo.status == "pending_triage" and wo.assignees:
        wo.status = "assigned"
        if not wo.triaged_by_id:
            wo.triaged_by_id = current_user.id
            wo.triaged_at = datetime.utcnow()

    # Automatically promote to in_progress if start_date has passed for active scheduled orders
    if _is_past(wo.start_date) and wo.status in ("assigned", "unassigned"):
        wo.status = "in_progress"

    # Update rooms
    if payload.room_ids is not None:
        if payload.room_ids:
            r_res = await db.execute(select(models.Room).where(models.Room.id.in_(payload.room_ids)))
            wo.rooms = list(r_res.scalars().all())
        else:
            wo.rooms = []

    # Update equipment
    if payload.equipment_ids is not None:
        if payload.equipment_ids:
            e_res = await db.execute(select(models.Equipment).where(models.Equipment.id.in_(payload.equipment_ids)))
            wo.equipment = list(e_res.scalars().all())
        else:
            wo.equipment = []

    await db.commit()
    await db.refresh(wo)

    await log_action(
        db, "update", "work_order", wo.id, wo.order_number,
        new_values=data_dict,
        message=f"Updated work order '{wo.order_number}'",
        user=current_user
    )
    await db.commit()

    if new_assignee_ids:
        try:
            await send_push_notification_to_users(
                db,
                new_assignee_ids,
                title="EquipMap",
                body="You have a new work order assignment.",
                url="/work-orders"
            )
        except Exception as e:
            logger.error(f"Error sending push notification for updated work order {wo.order_number}: {e}")

    return await get_work_order_by_id(wo.id, db)

@router.post("/api/work-orders/{wo_id}/labor", response_model=schemas.WorkOrderLaborEntry)
async def add_work_order_labor(
    wo_id: int,
    payload: schemas.WorkOrderLaborCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    res = await db.execute(select(models.WorkOrder).where(models.WorkOrder.id == wo_id))
    wo = res.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    if wo.status == "pending_triage":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Work order must be triaged before labor hours can be added."
        )

    labor_entry = models.WorkOrderLaborEntry(
        work_order_id=wo.id,
        user_id=current_user.id,
        hours=max(0.01, float(payload.hours)),
        comment=payload.comment.strip() if payload.comment else None,
        entry_date=payload.entry_date or datetime.utcnow()
    )
    db.add(labor_entry)

    # Accumulate total actual hours
    wo.actual_hours = (wo.actual_hours or 0.0) + labor_entry.hours

    # If order is currently assigned or unassigned, automatically move to in_progress
    if wo.status in ("assigned", "unassigned"):
        wo.status = "in_progress"

    await db.commit()
    await db.refresh(labor_entry)

    await log_action(
        db, "create", "work_order_labor", labor_entry.id, f"{wo.order_number} Labor",
        new_values={"hours": labor_entry.hours, "comment": labor_entry.comment},
        message=f"Logged {labor_entry.hours} hr(s) labor on work order '{wo.order_number}'",
        user=current_user
    )
    await db.commit()

    return {
        "id": labor_entry.id,
        "work_order_id": labor_entry.work_order_id,
        "user_id": labor_entry.user_id,
        "hours": labor_entry.hours,
        "comment": labor_entry.comment,
        "entry_date": labor_entry.entry_date,
        "created_at": labor_entry.created_at,
        "user_username": current_user.username
    }

@router.put("/api/work-orders/{wo_id}/labor/{labor_id}", response_model=schemas.WorkOrderLaborEntry)
async def update_work_order_labor(
    wo_id: int,
    labor_id: int,
    payload: schemas.WorkOrderLaborUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    res = await db.execute(
        select(models.WorkOrderLaborEntry)
        .options(selectinload(models.WorkOrderLaborEntry.user))
        .where(
            models.WorkOrderLaborEntry.id == labor_id,
            models.WorkOrderLaborEntry.work_order_id == wo_id
        )
    )
    labor_entry = res.scalars().first()
    if not labor_entry:
        raise HTTPException(status_code=404, detail="Labor entry not found")

    is_admin = current_user.role == "admin"
    is_owner = (labor_entry.user_id == current_user.id)
    if not (is_admin or is_owner):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own logged labor entries."
        )

    res_wo = await db.execute(select(models.WorkOrder).where(models.WorkOrder.id == wo_id))
    wo = res_wo.scalars().first()

    old_hours = labor_entry.hours
    old_comment = labor_entry.comment

    if payload.hours is not None:
        labor_entry.hours = max(0.01, float(payload.hours))
    if payload.comment is not None:
        labor_entry.comment = payload.comment.strip() if payload.comment.strip() else None
    if payload.entry_date is not None:
        labor_entry.entry_date = payload.entry_date

    await db.commit()
    await db.refresh(labor_entry)

    # Recalculate total actual hours for the work order
    if wo and payload.hours is not None:
        res_sum = await db.execute(
            select(func.sum(models.WorkOrderLaborEntry.hours))
            .where(models.WorkOrderLaborEntry.work_order_id == wo.id)
        )
        total_hours = res_sum.scalar() or 0.0
        wo.actual_hours = round(total_hours, 2)
        await db.commit()

    await log_action(
        db, "update", "work_order_labor", labor_entry.id, f"{wo.order_number if wo else ''} Labor",
        old_values={"hours": old_hours, "comment": old_comment},
        new_values={"hours": labor_entry.hours, "comment": labor_entry.comment},
        message=f"Updated logged labor on work order '{wo.order_number if wo else wo_id}' to {labor_entry.hours} hr(s)",
        user=current_user
    )
    await db.commit()

    username = labor_entry.user.username if labor_entry.user else (current_user.username if is_owner else None)
    return {
        "id": labor_entry.id,
        "work_order_id": labor_entry.work_order_id,
        "user_id": labor_entry.user_id,
        "hours": labor_entry.hours,
        "comment": labor_entry.comment,
        "entry_date": labor_entry.entry_date,
        "created_at": labor_entry.created_at,
        "user_username": username
    }

@router.delete("/api/work-orders/{wo_id}/labor/{labor_id}")
async def delete_work_order_labor(
    wo_id: int,
    labor_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    res = await db.execute(
        select(models.WorkOrderLaborEntry)
        .options(selectinload(models.WorkOrderLaborEntry.user))
        .where(
            models.WorkOrderLaborEntry.id == labor_id,
            models.WorkOrderLaborEntry.work_order_id == wo_id
        )
    )
    labor_entry = res.scalars().first()
    if not labor_entry:
        raise HTTPException(status_code=404, detail="Labor entry not found")

    is_admin = current_user.role == "admin"
    is_owner = (labor_entry.user_id == current_user.id)
    if not (is_admin or is_owner):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own logged labor entries."
        )

    res_wo = await db.execute(select(models.WorkOrder).where(models.WorkOrder.id == wo_id))
    wo = res_wo.scalars().first()

    deleted_hours = labor_entry.hours
    deleted_comment = labor_entry.comment

    await db.delete(labor_entry)
    await db.commit()

    if wo:
        res_sum = await db.execute(
            select(func.sum(models.WorkOrderLaborEntry.hours))
            .where(models.WorkOrderLaborEntry.work_order_id == wo.id)
        )
        total_hours = res_sum.scalar() or 0.0
        wo.actual_hours = round(total_hours, 2)
        await db.commit()

    await log_action(
        db, "delete", "work_order_labor", labor_id, f"{wo.order_number if wo else ''} Labor",
        old_values={"hours": deleted_hours, "comment": deleted_comment},
        message=f"Removed {deleted_hours} hr(s) logged labor on work order '{wo.order_number if wo else wo_id}'",
        user=current_user
    )
    await db.commit()

    return {"message": "Labor entry deleted successfully"}

@router.post("/api/work-orders/{wo_id}/comments", response_model=schemas.WorkOrderComment)
async def add_work_order_comment(
    wo_id: int,
    payload: schemas.WorkOrderCommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    res = await db.execute(select(models.WorkOrder).where(models.WorkOrder.id == wo_id))
    wo = res.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    author = payload.author_name or current_user.full_name or current_user.username
    user_id = current_user.id

    comment = models.WorkOrderComment(
        work_order_id=wo.id,
        user_id=user_id,
        author_name=author,
        comment=payload.comment.strip()
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    return comment

@router.put("/api/work-orders/{wo_id}/comments/{comment_id}", response_model=schemas.WorkOrderComment)
async def update_work_order_comment(
    wo_id: int,
    comment_id: int,
    payload: schemas.WorkOrderCommentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    res = await db.execute(
        select(models.WorkOrderComment)
        .where(
            models.WorkOrderComment.id == comment_id,
            models.WorkOrderComment.work_order_id == wo_id
        )
    )
    comment = res.scalars().first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    is_admin = current_user.role == "admin"
    is_owner = (comment.user_id == current_user.id or (comment.user_id is None and (comment.author_name == current_user.username or (current_user.full_name and comment.author_name == current_user.full_name))))
    if not (is_admin or is_owner):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own notes/comments."
        )

    old_comment_text = comment.comment
    comment.comment = payload.comment.strip()
    await db.commit()
    await db.refresh(comment)

    await log_action(
        db, "update", "work_order_comment", comment.id, f"Work Order {wo_id} Comment",
        old_values={"comment": old_comment_text},
        new_values={"comment": comment.comment},
        message=f"Updated note/comment on work order {wo_id}",
        user=current_user
    )
    await db.commit()

    return comment

@router.delete("/api/work-orders/{wo_id}/comments/{comment_id}")
async def delete_work_order_comment(
    wo_id: int,
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    res = await db.execute(
        select(models.WorkOrderComment)
        .where(
            models.WorkOrderComment.id == comment_id,
            models.WorkOrderComment.work_order_id == wo_id
        )
    )
    comment = res.scalars().first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    is_admin = current_user.role == "admin"
    is_owner = (comment.user_id == current_user.id or (comment.user_id is None and (comment.author_name == current_user.username or (current_user.full_name and comment.author_name == current_user.full_name))))
    if not (is_admin or is_owner):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own notes/comments."
        )

    deleted_text = comment.comment
    await db.delete(comment)
    await db.commit()

    await log_action(
        db, "delete", "work_order_comment", comment_id, f"Work Order {wo_id} Comment",
        old_values={"comment": deleted_text},
        message=f"Deleted note/comment on work order {wo_id}",
        user=current_user
    )
    await db.commit()

    return {"message": "Comment deleted successfully"}

@router.post("/api/work-orders/bulk/close", response_model=schemas.WorkOrderBulkResponse, operation_id="bulk_close_work_orders_nested")
@router.post("/api/work-orders/bulk-close", response_model=schemas.WorkOrderBulkResponse, operation_id="bulk_close_work_orders")
async def bulk_close_work_orders(
    payload: schemas.WorkOrderBulkClose,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    if not payload.ids:
        return {"status": "success", "message": "No work orders selected", "count": 0, "ids": []}

    is_admin = current_user.role == "admin"
    can_user_close = is_admin or bool(getattr(current_user, "can_close_work_orders", True)) or bool(current_user.can_triage)

    res = await db.execute(
        select(models.WorkOrder)
        .options(selectinload(models.WorkOrder.assignees))
        .where(models.WorkOrder.id.in_(payload.ids))
    )
    work_orders = res.scalars().all()
    if not work_orders:
        return {"status": "success", "message": "No matching work orders found", "count": 0, "ids": []}

    now = payload.completed_at or datetime.utcnow()
    closed_ids = []

    for wo in work_orders:
        is_assigned = any(u.id == current_user.id for u in (wo.assignees or []))
        if not (can_user_close or is_assigned):
            continue

        if payload.hours and payload.hours > 0 and wo.status != "pending_triage":
            labor = models.WorkOrderLaborEntry(
                work_order_id=wo.id,
                user_id=current_user.id,
                hours=payload.hours,
                comment=payload.completion_notes or "Bulk labor closeout",
                entry_date=now
            )
            db.add(labor)
            wo.actual_hours = (wo.actual_hours or 0.0) + payload.hours

        wo.status = "completed"
        if payload.completion_notes:
            wo.completion_notes = payload.completion_notes
        wo.completed_at = now

        await log_action(
            db, "update", "work_order", wo.id, wo.order_number,
            new_values={"status": "completed", "completion_notes": wo.completion_notes},
            message=f"Bulk closed work order '{wo.order_number}'",
            user=current_user
        )
        closed_ids.append(wo.id)

    await db.commit()
    return {
        "status": "success",
        "message": f"Successfully closed {len(closed_ids)} work order(s)",
        "count": len(closed_ids),
        "ids": closed_ids
    }

@router.post("/api/work-orders/bulk/assign", response_model=schemas.WorkOrderBulkResponse, operation_id="bulk_assign_work_orders_nested")
@router.post("/api/work-orders/bulk-assign", response_model=schemas.WorkOrderBulkResponse, operation_id="bulk_assign_work_orders")
async def bulk_assign_work_orders(
    payload: schemas.WorkOrderBulkAssign,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    if not payload.ids:
        return {"status": "success", "message": "No work orders selected", "count": 0, "ids": []}

    is_admin = current_user.role == "admin"
    can_triage = bool(current_user.can_triage or is_admin)
    can_assign = is_admin or bool(getattr(current_user, "can_assign", False)) or can_triage

    if not can_assign:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to assign technicians."
        )

    res = await db.execute(
        select(models.WorkOrder)
        .options(selectinload(models.WorkOrder.assignees))
        .where(models.WorkOrder.id.in_(payload.ids))
    )
    work_orders = res.scalars().all()
    if not work_orders:
        return {"status": "success", "message": "No matching work orders found", "count": 0, "ids": []}

    # Fetch users to assign if provided
    assignees_list = None
    if payload.assigned_user_ids is not None:
        if payload.assigned_user_ids:
            u_res = await db.execute(select(models.User).where(models.User.id.in_(payload.assigned_user_ids)))
            assignees_list = list(u_res.scalars().all())
        else:
            assignees_list = []

    updated_ids = []
    all_new_assignee_ids = set()

    for wo in work_orders:
        old_assignee_ids = {u.id for u in (wo.assignees or [])}

        if assignees_list is not None:
            wo.assignees = list(assignees_list)
            new_assignee_ids = [u.id for u in wo.assignees if u.id not in old_assignee_ids]
            all_new_assignee_ids.update(new_assignee_ids)

        if payload.trade is not None:
            wo.trade = payload.trade.strip() if payload.trade.strip() else None

        if payload.priority is not None and payload.priority in ("low", "medium", "high", "urgent"):
            wo.priority = payload.priority

        if payload.due_date is not None:
            wo.due_date = payload.due_date

        # Status determination
        if payload.status:
            wo.status = payload.status
        else:
            if wo.status == "pending_triage" and wo.assignees:
                wo.status = "assigned"
                if not wo.triaged_by_id:
                    wo.triaged_by_id = current_user.id
                    wo.triaged_at = datetime.utcnow()
            elif wo.status == "assigned" and not wo.assignees:
                wo.status = "unassigned"
            elif wo.status == "unassigned" and wo.assignees:
                wo.status = "assigned"

        if payload.status == "completed" and not wo.completed_at:
            wo.completed_at = datetime.utcnow()

        # Add optional dispatch note as a comment
        if payload.dispatch_note and payload.dispatch_note.strip():
            comment = models.WorkOrderComment(
                work_order_id=wo.id,
                user_id=current_user.id,
                author_name=current_user.full_name or current_user.username,
                comment=payload.dispatch_note.strip()
            )
            db.add(comment)

        await log_action(
            db, "update", "work_order", wo.id, wo.order_number,
            new_values={
                "status": wo.status,
                "trade": wo.trade,
                "priority": wo.priority,
                "assignees": [u.username for u in (wo.assignees or [])]
            },
            message=f"Bulk updated/assigned work order '{wo.order_number}'",
            user=current_user
        )
        updated_ids.append(wo.id)

    await db.commit()

    if all_new_assignee_ids:
        try:
            await send_push_notification_to_users(
                db,
                list(all_new_assignee_ids),
                title="EquipMap",
                body=f"You have been assigned to {len(updated_ids)} work order(s).",
                url="/work-orders"
            )
        except Exception as e:
            logger.error(f"Error sending bulk push notification: {e}")

    return {
        "status": "success",
        "message": f"Successfully updated {len(updated_ids)} work order(s)",
        "count": len(updated_ids),
        "ids": updated_ids
    }

@router.post("/api/work-orders/bulk/delete", response_model=schemas.WorkOrderBulkResponse, operation_id="bulk_delete_work_orders_nested")
@router.post("/api/work-orders/bulk-delete", response_model=schemas.WorkOrderBulkResponse, operation_id="bulk_delete_work_orders")
async def bulk_delete_work_orders(
    payload: schemas.WorkOrderBulkDelete,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    if not payload.ids:
        return {"status": "success", "message": "No work orders selected", "count": 0, "ids": []}

    can_delete_all = (
        current_user.role in ["admin", "editor"] or
        bool(current_user.can_triage)
    )

    res = await db.execute(select(models.WorkOrder).where(models.WorkOrder.id.in_(payload.ids)))
    work_orders = res.scalars().all()
    if not work_orders:
        return {"status": "success", "message": "No matching work orders found", "count": 0, "ids": []}

    deleted_ids = []
    for wo in work_orders:
        can_delete_wo = can_delete_all or (wo.created_by_id == current_user.id)
        if not can_delete_wo:
            continue

        order_num = wo.order_number
        deleted_ids.append(wo.id)
        await db.delete(wo)
        await log_action(
            db, "delete", "work_order", wo.id, order_num,
            message=f"Bulk deleted work order '{order_num}'",
            user=current_user
        )

    await db.commit()
    return {
        "status": "success",
        "message": f"Successfully deleted {len(deleted_ids)} work order(s)",
        "count": len(deleted_ids),
        "ids": deleted_ids
    }

@router.post("/api/work-orders/{wo_id}/close", response_model=schemas.WorkOrderWithDetails)
async def close_work_order(
    wo_id: int,
    payload: schemas.WorkOrderClose,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    res = await db.execute(
        select(models.WorkOrder)
        .options(selectinload(models.WorkOrder.assignees))
        .where(models.WorkOrder.id == wo_id)
    )
    wo = res.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    is_admin = current_user.role == "admin"
    is_assigned = any(u.id == current_user.id for u in (wo.assignees or []))
    can_close = is_admin or bool(getattr(current_user, "can_close_work_orders", True)) or is_assigned

    if not can_close:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to close this work order."
        )

    # Add labor entry if hours provided (requires triage)
    if payload.hours and payload.hours > 0:
        if wo.status == "pending_triage":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Work order must be triaged before labor hours can be added."
            )
        labor = models.WorkOrderLaborEntry(
            work_order_id=wo.id,
            user_id=current_user.id,
            hours=payload.hours,
            comment=payload.completion_notes or "Final labor closeout",
            entry_date=payload.completed_at or datetime.utcnow()
        )
        db.add(labor)
        wo.actual_hours = (wo.actual_hours or 0.0) + payload.hours

    wo.status = "completed"
    if payload.completion_notes:
        wo.completion_notes = payload.completion_notes
    wo.completed_at = payload.completed_at or datetime.utcnow()

    await db.commit()
    await db.refresh(wo)

    await log_action(
        db, "update", "work_order", wo.id, wo.order_number,
        new_values={"status": "completed", "completion_notes": wo.completion_notes},
        message=f"Closed work order '{wo.order_number}'",
        user=current_user
    )
    await db.commit()

    return await get_work_order_by_id(wo.id, db)

@router.delete("/api/work-orders/{wo_id}")
async def delete_work_order(
    wo_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_work_order_user)
):
    res = await db.execute(select(models.WorkOrder).where(models.WorkOrder.id == wo_id))
    wo = res.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    # Permission check: admin, editor, triage authorized, or creator can delete
    can_delete = (
        current_user.role in ["admin", "editor"] or
        current_user.can_triage or
        wo.created_by_id == current_user.id
    )
    if not can_delete:
        raise HTTPException(status_code=403, detail="You do not have permission to delete this work order")

    order_num = wo.order_number
    await db.delete(wo)
    await log_action(db, "delete", "work_order", wo_id, order_num, message=f"Deleted work order '{order_num}'", user=current_user)
    await db.commit()

    return {"status": "success", "message": f"Work order {order_num} deleted"}

@router.get("/api/work-orders/history", response_model=schemas.WorkOrderHistoryResponse)
async def get_work_order_history(
    entity_type: str, # 'room' | 'equipment' | 'floorplan' | 'site'
    entity_id: Optional[str] = None,
    entity_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user)
):
    norm_type = (entity_type or "").lower().strip()
    norm_name = (entity_name or "").upper().strip()
    int_id: Optional[int] = int(entity_id) if entity_id and str(entity_id).isdigit() else None

    match_conditions = []
    if norm_type == "room":
        if int_id is not None:
            match_conditions.append(models.WorkOrder.rooms.any(models.Room.id == int_id))
        if norm_name:
            match_conditions.append(
                models.WorkOrder.rooms.any(func.upper(models.Room.name) == norm_name)
            )
    elif norm_type == "equipment":
        if int_id is not None:
            match_conditions.append(models.WorkOrder.equipment.any(models.Equipment.id == int_id))
        if norm_name:
            match_conditions.append(
                models.WorkOrder.equipment.any(func.upper(models.Equipment.name) == norm_name)
            )
    elif norm_type == "floorplan" and int_id is not None:
        match_conditions.append(models.WorkOrder.floorplan_id == int_id)
    elif norm_type == "site" and int_id is not None:
        match_conditions.extend([
            models.WorkOrder.site_id == int_id,
            models.WorkOrder.floorplan.has(models.Floorplan.site_id == int_id),
        ])

    # Preserve legacy history matches for work orders that recorded only free-text
    # location data instead of an explicit room/equipment association.
    if norm_name and len(norm_name) >= 2:
        match_conditions.extend([
            func.upper(models.WorkOrder.location_details).contains(norm_name, autoescape=True),
            func.upper(models.WorkOrder.title).contains(norm_name, autoescape=True),
        ])

    if not match_conditions:
        return {"total": 0, "open_count": 0, "completed_count": 0, "data": []}

    query = (
        select(models.WorkOrder)
        .options(
            selectinload(models.WorkOrder.site),
            selectinload(models.WorkOrder.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.WorkOrder.creator),
            selectinload(models.WorkOrder.triaged_by),
            selectinload(models.WorkOrder.assignees),
            selectinload(models.WorkOrder.rooms).selectinload(models.Room.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.WorkOrder.equipment).selectinload(models.Equipment.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.WorkOrder.labor_entries).selectinload(models.WorkOrderLaborEntry.user),
            selectinload(models.WorkOrder.comments).selectinload(models.WorkOrderComment.user),
            selectinload(models.WorkOrder.task),
            selectinload(models.WorkOrder.task_type_record).selectinload(models.TaskType.task_sheet),
        )
        .where(or_(*match_conditions))
        .order_by(desc(models.WorkOrder.created_at))
    )

    res = await db.execute(query)
    matches = res.scalars().all()

    open_cnt = sum(1 for w in matches if w.status != "completed" and w.status != "cancelled")
    return {
        "total": len(matches),
        "open_count": open_cnt,
        "completed_count": len(matches) - open_cnt,
        "data": [serialize_work_order(w) for w in matches]
    }

# Keep static paths above the dynamic work-order ID route.  Otherwise FastAPI
# treats "history" as a work-order ID and returns a validation-error payload.
@router.get("/api/work-orders/{wo_id}", response_model=schemas.WorkOrderWithDetails)
async def get_work_order(
    wo_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user)
):
    return await get_work_order_by_id(wo_id, db)
