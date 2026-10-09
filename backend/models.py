from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, UniqueConstraint, JSON, Boolean, Table, Text, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

# Association tables for many-to-many relationships
work_order_assignees = Table(
    "work_order_assignees",
    Base.metadata,
    Column("work_order_id", Integer, ForeignKey("work_orders.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
)

work_order_rooms = Table(
    "work_order_rooms",
    Base.metadata,
    Column("work_order_id", Integer, ForeignKey("work_orders.id", ondelete="CASCADE"), primary_key=True),
    Column("room_id", Integer, ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True)
)

work_order_equipment = Table(
    "work_order_equipment",
    Base.metadata,
    Column("work_order_id", Integer, ForeignKey("work_orders.id", ondelete="CASCADE"), primary_key=True),
    Column("equipment_id", Integer, ForeignKey("equipment.id", ondelete="CASCADE"), primary_key=True)
)

pm_schedule_assignees = Table(
    "pm_schedule_assignees",
    Base.metadata,
    Column("pm_schedule_id", Integer, ForeignKey("pm_schedules.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
)

pm_schedule_rooms = Table(
    "pm_schedule_rooms",
    Base.metadata,
    Column("pm_schedule_id", Integer, ForeignKey("pm_schedules.id", ondelete="CASCADE"), primary_key=True),
    Column("room_id", Integer, ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True)
)

pm_schedule_equipment = Table(
    "pm_schedule_equipment",
    Base.metadata,
    Column("pm_schedule_id", Integer, ForeignKey("pm_schedules.id", ondelete="CASCADE"), primary_key=True),
    Column("equipment_id", Integer, ForeignKey("equipment.id", ondelete="CASCADE"), primary_key=True)
)

task_rooms = Table(
    "task_rooms",
    Base.metadata,
    Column("task_id", Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("room_id", Integer, ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True)
)

task_equipment = Table(
    "task_equipment",
    Base.metadata,
    Column("task_id", Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("equipment_id", Integer, ForeignKey("equipment.id", ondelete="CASCADE"), primary_key=True)
)

# The composite primary keys above optimize lookups that start with a work
# order. History lookups run in the opposite direction.
Index("idx_work_order_rooms_room_id", work_order_rooms.c.room_id, work_order_rooms.c.work_order_id)
Index(
    "idx_work_order_equipment_equipment_id",
    work_order_equipment.c.equipment_id,
    work_order_equipment.c.work_order_id,
)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=True)
    email = Column(String, nullable=True, index=True)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="technician") # 'admin', 'technician', 'viewer'
    trade = Column(String, nullable=True, index=True) # e.g. 'General Maintenance', 'Electrical', 'Plumbing'
    can_triage = Column(Boolean, default=False) # Designated triage permission flag
    can_assign = Column(Boolean, default=False) # Assign/unassign technicians flag
    can_create_pm = Column(Boolean, default=False) # Create/edit PM schedules flag
    can_create_work_orders = Column(Boolean, default=False) # Direct create work orders flag
    can_manage_items = Column(Boolean, default=False) # Manage rooms, equipment, floorplans flag
    can_close_work_orders = Column(Boolean, default=False) # Close/complete work orders flag
    can_undo_all_audit_logs = Column(Boolean, default=False) # Undo any audit log record flag
    token_version = Column(Integer, default=1, nullable=False) # Used for instant global session revocation
    is_active = Column(Boolean, default=True)

    tickets = relationship("Ticket", back_populates="creator")
    assigned_work_orders = relationship("WorkOrder", secondary=work_order_assignees, back_populates="assignees")
    created_work_orders = relationship("WorkOrder", foreign_keys="[WorkOrder.created_by_id]", back_populates="creator")
    push_subscriptions = relationship("PushSubscription", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")
    revoked_tokens = relationship("RevokedToken", back_populates="user", cascade="all, delete-orphan")

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_version = Column(Integer, default=1, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    replaced_by_hash = Column(String, nullable=True)
    device_info = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)

    user = relationship("User", back_populates="refresh_tokens")

class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    id = Column(Integer, primary_key=True, index=True)
    jti = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reason = Column(String, nullable=True)

    user = relationship("User", back_populates="revoked_tokens")

class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, nullable=True)
    color = Column(String, nullable=True, default="#3b82f6")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class TaskCategory(Base):
    __tablename__ = "task_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    username = Column(String, nullable=True)
    action = Column(String, nullable=False) # 'create', 'update', 'delete'
    target_type = Column(String, nullable=False) # 'site', 'floorplan', 'room', 'equipment', 'work_order', 'pm_schedule'
    target_id = Column(Integer)
    target_name = Column(String)
    old_values = Column(JSON)
    new_values = Column(JSON)
    message = Column(String)

    user = relationship("User")

class Site(Base):
    __tablename__ = "sites"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    description = Column(String)
    location = Column(String)

    floorplans = relationship("Floorplan", back_populates="site", cascade="all, delete-orphan")

class Floorplan(Base):
    __tablename__ = "floorplans"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), index=True)
    name = Column(String, index=True, nullable=False)
    sort_order = Column(Integer, default=0)
    file_path = Column(String, nullable=False)
    previous_file_path = Column(String, nullable=True)
    file_type = Column(String, nullable=False) # 'svg' or 'pdf'
    pin_size = Column(Integer, default=16)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('site_id', 'name', name='_site_floorplan_name_uc'),
    )

    site = relationship("Site", back_populates="floorplans")
    rooms = relationship("Room", back_populates="floorplan", cascade="all, delete-orphan")
    equipment = relationship("Equipment", back_populates="floorplan", cascade="all, delete-orphan")
    reference_points = relationship("ReferencePoint", back_populates="floorplan", cascade="all, delete-orphan")
    tickets = relationship("Ticket", back_populates="floorplan", cascade="all, delete-orphan")
    work_orders = relationship("WorkOrder", back_populates="floorplan", cascade="all, delete-orphan")

class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    floorplan_id = Column(Integer, ForeignKey("floorplans.id"), index=True)
    name = Column(String, index=True, nullable=False)
    description = Column(String)
    x_coordinate = Column(Float)
    y_coordinate = Column(Float)

    floorplan = relationship("Floorplan", back_populates="rooms")
    work_orders = relationship("WorkOrder", secondary=work_order_rooms, back_populates="rooms")

class Equipment(Base):
    __tablename__ = "equipment"

    id = Column(Integer, primary_key=True, index=True)
    floorplan_id = Column(Integer, ForeignKey("floorplans.id"), index=True)
    name = Column(String, index=True, nullable=False)
    description = Column(String)
    x_coordinate = Column(Float)
    y_coordinate = Column(Float)
    color = Column(String, default="#10b981")
    photo_path = Column(String)
    tools_required = Column(String)

    floorplan = relationship("Floorplan", back_populates="equipment")
    work_orders = relationship("WorkOrder", secondary=work_order_equipment, back_populates="equipment")

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    floorplan_id = Column(Integer, ForeignKey("floorplans.id"), index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String, nullable=False)
    description = Column(String)
    x_coordinate = Column(Float, nullable=False)
    y_coordinate = Column(Float, nullable=False)
    status = Column(String, default="open") # 'open', 'resolved'
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    floorplan = relationship("Floorplan", back_populates="tickets")
    creator = relationship("User", back_populates="tickets")

class ReferencePoint(Base):
    __tablename__ = "reference_points"

    id = Column(Integer, primary_key=True, index=True)
    floorplan_id = Column(Integer, ForeignKey("floorplans.id"), index=True)
    label = Column(String, nullable=False)  # "A" or "B"
    x_coordinate = Column(Float, nullable=False)
    y_coordinate = Column(Float, nullable=False)

    __table_args__ = (
        UniqueConstraint('floorplan_id', 'label', name='_floorplan_refpoint_label_uc'),
    )

    floorplan = relationship("Floorplan", back_populates="reference_points")

class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=True) # Optional internal identifier
    description = Column(String, index=True, nullable=False) # Task title / summary
    category = Column(String, default="General", index=True) # "General", "HVAC", "Electrical", "Plumbing", "Safety", "Preventive Maintenance"
    trade = Column(String, nullable=True, index=True) # e.g. "General Maintenance", "Electrical"
    pm_task_sheet = Column(Text, nullable=True) # Full procedural instructions / standard work procedure
    checklist_items = Column(JSON, nullable=False, default=list) # Checklist items
    estimated_hours = Column(Float, default=1.0)
    task_type = Column(String, nullable=True, index=True) # e.g. "Electrical", "HVAC", "Plumbing", "Facility service" (xPM ignored)
    task_type_code = Column(String, nullable=True, index=True)
    task_type_description = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    work_orders = relationship("WorkOrder", back_populates="task")
    pm_schedules = relationship("PMSchedule", back_populates="task")
    rooms = relationship("Room", secondary=task_rooms)
    equipment = relationship("Equipment", secondary=task_equipment)

class TaskType(Base):
    __tablename__ = "task_types"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    category = Column(String, default="General", nullable=False, index=True)
    priority = Column(String, default="medium", nullable=False, index=True)
    trade = Column(String, nullable=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    task_sheet_id = Column(Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    task_sheet = relationship("Task", foreign_keys=[task_sheet_id])
    work_orders = relationship("WorkOrder", back_populates="task_type_record")

class WorkOrder(Base):
    __tablename__ = "work_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(String, unique=True, index=True) # e.g. "WO-1001"
    title = Column(String, index=True, nullable=False)
    description = Column(Text)
    category = Column(String, default="General", index=True) # "General", "Plumbing", "Electrical", "HVAC", "Doors & Locks", "Lighting", "Safety", "Furniture", "Other"
    trade = Column(String, nullable=True, index=True) # e.g. "General Maintenance", "Electrical", "Plumbing"
    priority = Column(String, default="medium", index=True) # "low", "medium", "high", "urgent"
    status = Column(String, default="pending_triage", index=True) # "pending_triage", "unassigned", "assigned", "in_progress", "on_hold", "completed", "cancelled", "rejected"

    # Location Information
    location_type = Column(String, default="none") # "room", "equipment", "pin", "none", "multi"
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True)
    floorplan_id = Column(Integer, ForeignKey("floorplans.id", ondelete="SET NULL"), nullable=True, index=True)
    x_coordinate = Column(Float, nullable=True)
    y_coordinate = Column(Float, nullable=True)
    location_details = Column(String, nullable=True)

    # Requester Contact Info
    requester_name = Column(String, default="Anonymous")
    requester_email = Column(String, nullable=True)
    requester_phone = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(Text, nullable=True)
    device_details = Column(String, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    # Triage & Management
    triaged_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    triaged_at = Column(DateTime(timezone=True), nullable=True)
    start_date = Column(DateTime(timezone=True), nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)
    estimated_hours = Column(Float, default=0.0)
    actual_hours = Column(Float, default=0.0)
    completion_notes = Column(Text, nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    pm_schedule_id = Column(Integer, ForeignKey("pm_schedules.id", ondelete="SET NULL"), nullable=True, index=True)
    pm_scheduled_for = Column(DateTime(timezone=True), nullable=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    task_type_id = Column(Integer, ForeignKey("task_types.id", ondelete="SET NULL"), nullable=True, index=True)
    checklist_items = Column(JSON, nullable=False, default=list)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    site = relationship("Site")
    floorplan = relationship("Floorplan", back_populates="work_orders")
    creator = relationship("User", foreign_keys=[created_by_id], back_populates="created_work_orders")
    triaged_by = relationship("User", foreign_keys=[triaged_by_id])
    assignees = relationship("User", secondary=work_order_assignees, back_populates="assigned_work_orders")
    rooms = relationship("Room", secondary=work_order_rooms, back_populates="work_orders")
    equipment = relationship("Equipment", secondary=work_order_equipment, back_populates="work_orders")
    labor_entries = relationship("WorkOrderLaborEntry", back_populates="work_order", cascade="all, delete-orphan", order_by="WorkOrderLaborEntry.created_at.desc()")
    comments = relationship("WorkOrderComment", back_populates="work_order", cascade="all, delete-orphan", order_by="WorkOrderComment.created_at.asc()")
    task = relationship("Task", back_populates="work_orders")
    task_type_record = relationship("TaskType", back_populates="work_orders")

    __table_args__ = (
        UniqueConstraint("pm_schedule_id", "pm_scheduled_for", name="uq_work_order_pm_occurrence"),
    )

class WorkOrderLaborEntry(Base):
    __tablename__ = "work_order_labor_entries"

    id = Column(Integer, primary_key=True, index=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    hours = Column(Float, nullable=False, default=1.0)
    comment = Column(Text, nullable=True)
    entry_date = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    work_order = relationship("WorkOrder", back_populates="labor_entries")
    user = relationship("User")

class WorkOrderComment(Base):
    __tablename__ = "work_order_comments"

    id = Column(Integer, primary_key=True, index=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name = Column(String, nullable=False)
    comment = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    work_order = relationship("WorkOrder", back_populates="comments")
    user = relationship("User")

class PMSchedule(Base):
    __tablename__ = "pm_schedules"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, default="Preventive Maintenance", index=True)
    trade = Column(String, nullable=True, index=True) # e.g. "General Maintenance", "General Maintenance", "Refrigeration", "Electrical"
    priority = Column(String, default="medium")
    cron_expression = Column(String, nullable=False, default="0 0 1 * *") # Legacy schedule format
    recurrence_version = Column(Integer, nullable=True)
    recurrence_rule = Column(JSON, nullable=True)
    timezone = Column(String, nullable=False, default="UTC")
    checklist_items = Column(JSON, nullable=False, default=list)
    is_active = Column(Boolean, default=True, index=True)

    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="SET NULL"), nullable=True)
    floorplan_id = Column(Integer, ForeignKey("floorplans.id", ondelete="SET NULL"), nullable=True)
    estimated_hours = Column(Float, default=1.0)

    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    site = relationship("Site")
    floorplan = relationship("Floorplan")
    assignees = relationship("User", secondary=pm_schedule_assignees)
    rooms = relationship("Room", secondary=pm_schedule_rooms)
    equipment = relationship("Equipment", secondary=pm_schedule_equipment)
    task = relationship("Task", back_populates="pm_schedules")

class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(Text, unique=True, index=True, nullable=False)
    p256dh = Column(Text, nullable=False)
    auth = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="push_subscriptions")
