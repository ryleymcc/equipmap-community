from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime

class UserBase(BaseModel):
    username: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: str = "technician"
    trade: Optional[str] = None
    can_triage: bool = False
    can_assign: bool = False
    can_create_pm: bool = False
    can_create_work_orders: bool = True
    can_manage_items: bool = True
    can_close_work_orders: bool = True
    can_undo_all_audit_logs: bool = False
    is_active: bool = True

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    trade: Optional[str] = None
    can_triage: Optional[bool] = None
    can_assign: Optional[bool] = None
    can_create_pm: Optional[bool] = None
    can_create_work_orders: Optional[bool] = None
    can_manage_items: Optional[bool] = None
    can_close_work_orders: Optional[bool] = None
    can_undo_all_audit_logs: Optional[bool] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None

class User(UserBase):
    id: int

    class Config:
        from_attributes = True

class UserAssignable(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: str
    trade: Optional[str] = None
    can_triage: bool = False
    can_assign: bool = False
    can_create_pm: bool = False
    can_create_work_orders: bool = True
    can_manage_items: bool = True
    can_close_work_orders: bool = True
    can_undo_all_audit_logs: bool = False

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    expires_in: Optional[int] = None
    username: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: str
    can_triage: bool = False
    can_assign: bool = False
    can_create_pm: bool = False
    can_create_work_orders: bool = True
    can_manage_items: bool = True
    can_close_work_orders: bool = True
    can_undo_all_audit_logs: bool = False

class TokenData(BaseModel):
    username: Optional[str] = None
    token_version: Optional[int] = 1
    jti: Optional[str] = None

class TokenRefreshRequest(BaseModel):
    refresh_token: Optional[str] = None

class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None

class RevokeSessionsResponse(BaseModel):
    status: str = "success"
    message: str
    user_id: int
    new_token_version: int
    revoked_refresh_tokens_count: int

class SiteBase(BaseModel):
    name: str
    description: Optional[str] = None
    location: Optional[str] = None

class SiteCreate(SiteBase):
    pass

class SiteUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None

class Site(SiteBase):
    id: int

    class Config:
        from_attributes = True

class RoomBase(BaseModel):
    name: str
    description: Optional[str] = None
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None

class RoomCreate(RoomBase):
    floorplan_id: int

class Room(RoomBase):
    id: int
    floorplan_id: int

    class Config:
        from_attributes = True

class EquipmentBase(BaseModel):
    name: str
    description: Optional[str] = None
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    color: Optional[str] = "#10b981"
    photo_path: Optional[str] = None
    tools_required: Optional[str] = None

class EquipmentCreate(EquipmentBase):
    floorplan_id: int

class Equipment(EquipmentBase):
    id: int
    floorplan_id: int

    class Config:
        from_attributes = True

class RoomUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    floorplan_id: Optional[int] = None

class EquipmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    color: Optional[str] = None
    photo_path: Optional[str] = None
    tools_required: Optional[str] = None
    floorplan_id: Optional[int] = None

class ReferencePointBase(BaseModel):
    label: str
    x_coordinate: float
    y_coordinate: float

class ReferencePointCreate(ReferencePointBase):
    floorplan_id: Optional[int] = None

class ReferencePoint(ReferencePointBase):
    id: int
    floorplan_id: int

    class Config:
        from_attributes = True

class ReferencePointList(BaseModel):
    points: List[ReferencePointCreate]

class RoomWithDetails(Room):
    floorplan_name: Optional[str] = ""
    site_name: Optional[str] = ""
    site_id: Optional[int] = 0

class EquipmentWithDetails(Equipment):
    floorplan_name: Optional[str] = ""
    site_name: Optional[str] = ""
    site_id: Optional[int] = 0

class EquipmentBatchItem(BaseModel):
    name: str
    description: Optional[str] = None
    x_coordinate: float
    y_coordinate: float
    color: Optional[str] = "#10b981"
    tools_required: Optional[str] = None
    is_room: Optional[bool] = False

class EquipmentBatchImport(BaseModel):
    floorplan_id: int
    clear_existing: bool = False
    items: List[EquipmentBatchItem]

class EquipmentBulkUpdate(BaseModel):
    ids: List[int]
    description: Optional[str] = None
    color: Optional[str] = None
    tools_required: Optional[str] = None

# --- Work Orders & Maintenance ---

class WorkOrderLaborCreate(BaseModel):
    hours: float
    comment: Optional[str] = None
    entry_date: Optional[datetime] = None

class WorkOrderLaborUpdate(BaseModel):
    hours: Optional[float] = None
    comment: Optional[str] = None
    entry_date: Optional[datetime] = None

class WorkOrderLaborEntry(BaseModel):
    id: int
    work_order_id: int
    user_id: Optional[int] = None
    hours: float
    comment: Optional[str] = None
    entry_date: datetime
    created_at: datetime
    user_username: Optional[str] = None
    user_full_name: Optional[str] = None
    user_display_name: Optional[str] = None

    class Config:
        from_attributes = True

class WorkOrderCommentCreate(BaseModel):
    comment: str
    author_name: Optional[str] = None

class WorkOrderCommentUpdate(BaseModel):
    comment: str

class WorkOrderComment(BaseModel):
    id: int
    work_order_id: int
    user_id: Optional[int] = None
    author_name: str
    comment: str
    created_at: datetime

    class Config:
        from_attributes = True

# --- Task Templates & Sheets ---

class TaskCategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None

class TaskCategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class TaskCategoryResponse(BaseModel):
    id: Optional[int] = None
    name: str
    description: Optional[str] = None
    is_active: bool = True
    task_count: int = 0

class TaskTypeBase(BaseModel):
    code: str
    name: str
    category: str = "General"
    priority: str = "medium"
    trade: Optional[str] = None
    is_active: bool = True
    task_sheet_id: Optional[int] = None

class TaskTypeCreate(TaskTypeBase):
    pass

class TaskTypeUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    trade: Optional[str] = None
    is_active: Optional[bool] = None
    task_sheet_id: Optional[int] = None

class TaskTypeResponse(TaskTypeBase):
    id: int
    task_sheet_code: Optional[str] = None
    task_sheet_name: Optional[str] = None
    work_orders_count: int = 0

    class Config:
        from_attributes = True

class TaskBase(BaseModel):
    code: Optional[str] = None
    description: str
    category: Optional[str] = "General"
    trade: Optional[str] = None
    pm_task_sheet: Optional[str] = None
    checklist_items: List[dict] = []
    estimated_hours: Optional[float] = 1.0
    task_type: Optional[str] = None
    task_type_code: Optional[str] = None
    task_type_description: Optional[str] = None
    is_active: bool = True

class TaskCreate(TaskBase):
    room_ids: Optional[List[int]] = []
    equipment_ids: Optional[List[int]] = []

class TaskUpdate(BaseModel):
    code: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    trade: Optional[str] = None
    pm_task_sheet: Optional[str] = None
    checklist_items: Optional[List[dict]] = None
    estimated_hours: Optional[float] = None
    task_type: Optional[str] = None
    task_type_code: Optional[str] = None
    task_type_description: Optional[str] = None
    is_active: Optional[bool] = None
    room_ids: Optional[List[int]] = None
    equipment_ids: Optional[List[int]] = None

class TaskResponse(TaskBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class TaskWithDetails(TaskResponse):
    pm_schedules_count: Optional[int] = 0
    work_orders_count: Optional[int] = 0
    rooms: List[RoomWithDetails] = []
    equipment: List[EquipmentWithDetails] = []

class WorkOrderPublicCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = "General"
    trade: Optional[str] = None
    priority: Optional[str] = "medium"

    # Location
    location_type: Optional[str] = "none" # "room", "equipment", "pin", "none", "multi"
    site_id: Optional[int] = None
    floorplan_id: Optional[int] = None
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    location_details: Optional[str] = None
    room_ids: Optional[List[int]] = []
    equipment_ids: Optional[List[int]] = []

    # Requester
    requester_name: str = "Anonymous"
    requester_email: Optional[str] = None
    requester_phone: Optional[str] = None
    start_date: Optional[datetime] = None
    device_details: Optional[str] = None

    # Task
    task_id: Optional[int] = None
    task_type_id: Optional[int] = None
    checklist_items: Optional[List[dict]] = []

class WorkOrderCreate(WorkOrderPublicCreate):
    status: Optional[str] = None # Direct creation defaults based on technician assignment (assigned vs unassigned)
    assigned_user_ids: Optional[List[int]] = []
    due_date: Optional[datetime] = None
    estimated_hours: Optional[float] = 0.0
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None

class WorkOrderUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    trade: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None

    location_type: Optional[str] = None
    site_id: Optional[int] = None
    floorplan_id: Optional[int] = None
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    location_details: Optional[str] = None
    room_ids: Optional[List[int]] = None
    equipment_ids: Optional[List[int]] = None

    requester_name: Optional[str] = None
    requester_email: Optional[str] = None
    requester_phone: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    device_details: Optional[str] = None

    assigned_user_ids: Optional[List[int]] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    completion_notes: Optional[str] = None
    task_id: Optional[int] = None
    task_type_id: Optional[int] = None
    checklist_items: Optional[List[dict]] = None

class WorkOrderClose(BaseModel):
    hours: Optional[float] = None
    completion_notes: Optional[str] = None
    completed_at: Optional[datetime] = None

class WorkOrderBulkClose(BaseModel):
    ids: List[int]
    hours: Optional[float] = None
    completion_notes: Optional[str] = None
    completed_at: Optional[datetime] = None

class WorkOrderBulkAssign(BaseModel):
    ids: List[int]
    assigned_user_ids: Optional[List[int]] = None
    trade: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[datetime] = None
    dispatch_note: Optional[str] = None

class WorkOrderBulkDelete(BaseModel):
    ids: List[int]

class WorkOrderBulkResponse(BaseModel):
    status: str = "success"
    message: str
    count: int
    ids: List[int]

class WorkOrder(BaseModel):
    id: int
    order_number: str
    title: str
    description: Optional[str] = None
    category: str = "General"
    trade: Optional[str] = None
    priority: str = "medium"
    status: str = "unassigned"

    location_type: str = "none"
    site_id: Optional[int] = None
    floorplan_id: Optional[int] = None
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    location_details: Optional[str] = None

    requester_name: str
    requester_email: Optional[str] = None
    requester_phone: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    device_details: Optional[str] = None
    created_by_id: Optional[int] = None

    triaged_by_id: Optional[int] = None
    triaged_at: Optional[datetime] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    estimated_hours: float = 0.0
    actual_hours: float = 0.0
    completion_notes: Optional[str] = None
    completed_at: Optional[datetime] = None
    pm_schedule_id: Optional[int] = None
    pm_scheduled_for: Optional[datetime] = None
    task_id: Optional[int] = None
    task_type_id: Optional[int] = None
    checklist_items: List[dict] = []

    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class WorkOrderWithDetails(WorkOrder):
    site_name: Optional[str] = ""
    floorplan_name: Optional[str] = ""
    creator_username: Optional[str] = None
    creator_name: Optional[str] = None
    triaged_by_username: Optional[str] = None
    triaged_by_name: Optional[str] = None
    task_type_code: Optional[str] = None
    task_type_name: Optional[str] = None
    task_sheet_id: Optional[int] = None
    task_code: Optional[str] = None
    task_description: Optional[str] = None
    task_sheet: Optional[str] = None
    assignees: List[UserAssignable] = []
    rooms: List[RoomWithDetails] = []
    equipment: List[EquipmentWithDetails] = []
    labor_entries: List[WorkOrderLaborEntry] = []
    comments: List[WorkOrderComment] = []

class WorkOrderSummary(BaseModel):
    total: int = 0
    pending_triage_count: int = 0
    unassigned_count: int = 0
    assigned_count: int = 0
    in_progress_count: int = 0
    completed_count: int = 0
    on_hold_count: int = 0

class WorkOrdersResponse(BaseModel):
    summary: WorkOrderSummary
    data: List[WorkOrderWithDetails]

class WorkOrderHistoryResponse(BaseModel):
    total: int = 0
    open_count: int = 0
    completed_count: int = 0
    data: List[WorkOrderWithDetails]

# --- Preventive Maintenance (PM) Schedules ---

class PMScheduleBase(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = "Preventive Maintenance"
    trade: Optional[str] = None
    priority: Optional[str] = "medium"
    cron_expression: str = "0 0 1 * *" # legacy monthly default
    recurrence_version: Optional[int] = None
    recurrence_rule: Optional[dict] = None
    timezone: str = "UTC"
    checklist_items: List[dict] = []
    is_active: bool = True
    task_id: Optional[int] = None
    site_id: Optional[int] = None
    floorplan_id: Optional[int] = None
    estimated_hours: Optional[float] = 1.0

class PMScheduleCreate(PMScheduleBase):
    assigned_user_ids: Optional[List[int]] = []
    room_ids: Optional[List[int]] = []
    equipment_ids: Optional[List[int]] = []

class PMScheduleUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    trade: Optional[str] = None
    priority: Optional[str] = None
    cron_expression: Optional[str] = None
    recurrence_version: Optional[int] = None
    recurrence_rule: Optional[dict] = None
    timezone: Optional[str] = None
    checklist_items: Optional[List[dict]] = None
    is_active: Optional[bool] = None
    task_id: Optional[int] = None
    site_id: Optional[int] = None
    floorplan_id: Optional[int] = None
    estimated_hours: Optional[float] = None
    assigned_user_ids: Optional[List[int]] = None
    room_ids: Optional[List[int]] = None
    equipment_ids: Optional[List[int]] = None

class PMScheduleWithDetails(PMScheduleBase):
    id: int
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    site_name: Optional[str] = ""
    floorplan_name: Optional[str] = ""
    task_code: Optional[str] = None
    task_description: Optional[str] = None
    assignees: List[UserAssignable] = []
    rooms: List[RoomWithDetails] = []
    equipment: List[EquipmentWithDetails] = []

    class Config:
        from_attributes = True

class PMPreviewRequest(BaseModel):
    recurrence_version: int = 1
    recurrence_rule: dict
    count: int = 12

class PMOccurrence(BaseModel):
    occurrence_number: int
    nominal_scheduled_date: date
    nominal_scheduled_datetime: datetime
    issue_datetime: datetime
    due_datetime: datetime
    adjustment_reason: Optional[str] = None

class PMPreviewResponse(BaseModel):
    recurrence_version: int = 1
    summary: str
    timezone: Optional[str] = "UTC"
    is_active: bool = True
    estimated_hours_per_order: float = 1.0
    start_date: Optional[date] = None
    occurrences: List[PMOccurrence] = []

class PMCalendarOccurrence(PMOccurrence):
    schedule_id: int
    title: str
    category: str = "Preventive Maintenance"
    trade: Optional[str] = None
    priority: str = "medium"
    task_code: Optional[str] = None
    site_name: Optional[str] = ""
    floorplan_name: Optional[str] = ""
    assignee_names: List[str] = []
    assignee_usernames: List[str] = []

class PMCalendarResponse(BaseModel):
    start: datetime
    end: datetime
    occurrences: List[PMCalendarOccurrence] = []

# --- Legacy Ticket (kept for backwards compatibility if needed) ---

class TicketBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "open"
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None

class TicketCreate(TicketBase):
    floorplan_id: int

class TicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None

class Ticket(TicketBase):
    id: int
    floorplan_id: int
    created_by_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True

class TicketWithDetails(Ticket):
    floorplan_name: str = ""
    site_name: str = ""
    site_id: int = 0
    creator_username: str = ""
    creator_name: Optional[str] = None

class FloorplanBase(BaseModel):
    name: str
    sort_order: Optional[int] = 0

class FloorplanCreate(FloorplanBase):
    site_id: int

class FloorplanUpdate(BaseModel):
    name: Optional[str] = None
    pin_size: Optional[int] = None

class FloorplanSortOrder(BaseModel):
    id: int
    sort_order: int

class FloorplanSortOrderList(BaseModel):
    orders: List[FloorplanSortOrder]

class Floorplan(FloorplanBase):
    id: int
    site_id: int
    file_path: str
    file_type: str
    pin_size: int = 16
    created_at: datetime
    rooms: List[Room] = []
    equipment: List[Equipment] = []
    tickets: List[Ticket] = []
    reference_points: List[ReferencePoint] = []

    class Config:
        from_attributes = True

class AuditLog(BaseModel):
    id: int
    timestamp: datetime
    user_id: Optional[int] = None
    username: Optional[str] = None
    user_full_name: Optional[str] = None
    action: str
    target_type: str
    target_id: Optional[int] = None
    target_name: Optional[str] = None
    old_values: Optional[dict] = None
    new_values: Optional[dict] = None
    message: Optional[str] = None

    class Config:
        from_attributes = True

class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str

class PushSubscriptionDetail(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys

class PushSubscriptionCreate(BaseModel):
    user_id: int
    subscription: PushSubscriptionDetail

class PushSubscriptionUnsubscribe(BaseModel):
    endpoint: str
    user_id: Optional[int] = None

class TradeBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#3b82f6"

class TradeCreate(TradeBase):
    pass

class TradeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None

class TradeSummary(BaseModel):
    id: Optional[int] = None
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#3b82f6"
    user_count: int = 0
    pm_schedule_count: int = 0
    task_count: int = 0
    work_order_count: int = 0

class TradeDeletePayload(BaseModel):
    reassign_to: Optional[str] = None
