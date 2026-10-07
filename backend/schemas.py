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

class ReferencePointBase(BaseModel):
    label: str
    x_coordinate: float
    y_coordinate: float

class ReferencePointCreate(ReferencePointBase):
    pass

class ReferencePoint(ReferencePointBase):
    id: int
    floorplan_id: int

    class Config:
        from_attributes = True

class ReferencePointList(BaseModel):
    points: List[ReferencePointCreate]

class RoomWithDetails(Room):
    floorplan_name: str = ""
    site_name: str = ""
    site_id: int = 0

class EquipmentWithDetails(Equipment):
    floorplan_name: str = ""
    site_name: str = ""
    site_id: int = 0

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

class TicketBase(BaseModel):
    title: str
    description: Optional[str] = None
    x_coordinate: float
    y_coordinate: float
    status: str = "open"

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
    created_by_id: int
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
    previous_file_path: Optional[str] = None

class FloorplanCreate(FloorplanBase):
    site_id: int

class FloorplanUpdate(BaseModel):
    name: Optional[str] = None
    pin_size: Optional[int] = None

class FloorplanRescale(BaseModel):
    scale_x: float = 1.0
    scale_y: float = 1.0
    offset_x: float = 0.0
    offset_y: float = 0.0
    origin_x: float = 0.0
    origin_y: float = 0.0

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
    previous_file_path: Optional[str] = None
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
