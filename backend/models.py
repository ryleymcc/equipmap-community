from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, UniqueConstraint, JSON, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=True)
    email = Column(String, nullable=True, index=True)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="technician") # 'admin', 'editor', 'technician', 'viewer'
    trade = Column(String, nullable=True, index=True)
    can_triage = Column(Boolean, default=False)
    can_assign = Column(Boolean, default=False)
    can_create_pm = Column(Boolean, default=False)
    can_create_work_orders = Column(Boolean, default=True)
    can_manage_items = Column(Boolean, default=True)
    can_close_work_orders = Column(Boolean, default=True)
    can_undo_all_audit_logs = Column(Boolean, default=False)
    token_version = Column(Integer, default=1, nullable=False)
    is_active = Column(Boolean, default=True)

    tickets = relationship("Ticket", back_populates="creator")
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

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    username = Column(String, nullable=True)
    action = Column(String, nullable=False) # 'create', 'update', 'delete'
    target_type = Column(String, nullable=False) # 'site', 'floorplan', 'room', 'equipment'
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
    file_type = Column(String, nullable=False) # 'svg' or 'pdf'
    previous_file_path = Column(String, nullable=True)
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

class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    floorplan_id = Column(Integer, ForeignKey("floorplans.id"), index=True)
    name = Column(String, index=True, nullable=False)
    description = Column(String)
    x_coordinate = Column(Float)
    y_coordinate = Column(Float)

    floorplan = relationship("Floorplan", back_populates="rooms")

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
