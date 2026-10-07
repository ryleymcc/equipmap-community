"""Durable OAuth state. Only hashes of bearer credentials are persisted."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, CheckConstraint
from database import Base


class ChatGPTAuthorization(Base):
    __tablename__ = "chatgpt_authorizations"

    request_hash = Column(String(64), primary_key=True)
    parameters = Column(JSON, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    code_hash = Column(String(64), unique=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    token_version = Column(Integer, nullable=True)


class ChatGPTGrant(Base):
    __tablename__ = "chatgpt_grants"

    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id = Column(String, nullable=False)
    resource = Column(String, nullable=False)
    token_version = Column(Integer, nullable=False)
    access_hash = Column(String(64), unique=True, nullable=False)
    refresh_hash = Column(String(64), unique=True, nullable=False)
    access_expires_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)


class ChatGPTUsedRefreshToken(Base):
    __tablename__ = "chatgpt_used_refresh_tokens"

    token_hash = Column(String(64), primary_key=True)
    grant_id = Column(String(64), ForeignKey("chatgpt_grants.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)


class ChatGPTChange(Base):
    __tablename__ = "chatgpt_changes"

    id = Column(String(64), primary_key=True)
    review_hash = Column(String(64), unique=True, nullable=False)
    grant_id = Column(String(64), ForeignKey("chatgpt_grants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    payload = Column(JSON, nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    audit_id = Column(Integer, ForeignKey("audit_logs.id", ondelete="SET NULL"), nullable=True)


class EquipmentRelationship(Base):
    __tablename__ = "equipment_relationships"

    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False, index=True)
    target_id = Column(Integer, ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False, index=True)
    relationship_type = Column(String(30), nullable=False)
    detail = Column(String(2000), nullable=False, default="")
    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "relationship_type", name="equipment_relationship_unique"),
        CheckConstraint("source_id <> target_id", name="equipment_relationship_not_self"),
    )
