"""Bounded proposals with native or user-operated, private in-chat confirmation."""
import copy
import hashlib
import hmac
import secrets
from datetime import timedelta
from chatgpt_review_models import RecordChanges, ReviewDecision
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
import models
from chatgpt_models import ChatGPTChange, ChatGPTGrant, EquipmentRelationship
from chatgpt_data import get_record
from routers.chatgpt import credential_hash, utcnow
from utils import SECRET_KEY, log_action, require_manage_items

def approval_token(row, grant):
    # The model sees the native review link, so its handle is NOT an approval
    # capability. This separate server-signed capability is sent only in _meta.
    message = f"equipmap-chat-review-v1:{row.id}:{row.user_id}:{row.grant_id}:{row.review_hash}"
    # The hashed random refresh credential stays server-side. It also ensures
    # approval capabilities remain unpredictable in local/test installations
    # using the development JWT key. Rotation invalidates an open form safely.
    key = (SECRET_KEY + ":" + grant.refresh_hash).encode()
    return hmac.new(key, message.encode(), hashlib.sha256).hexdigest()

def change_summary(row):
    return {"change_id": row.id, "status": "expired" if row.status == "pending" and row.expires_at <= utcnow() else row.status,
        "expires_at": row.expires_at.isoformat(), "preview": row.payload, "audit_id": row.audit_id}

async def pending_changes(db, user, config, *, grant_id=None, change_ids=None, audit=False):
    stmt = select(ChatGPTChange, models.User.username, ChatGPTGrant).join(ChatGPTGrant, ChatGPTChange.grant_id == ChatGPTGrant.id).join(
        models.User, ChatGPTChange.user_id == models.User.id).where(
        ChatGPTGrant.revoked_at.is_(None), ChatGPTGrant.expires_at > utcnow(), models.User.is_active.is_(True),
        ChatGPTGrant.token_version == models.User.token_version, ChatGPTGrant.client_id == config.client_id,
        ChatGPTGrant.resource == config.resource)
    if not (audit and user.role == "admin"):
        stmt = stmt.where(ChatGPTChange.user_id == user.id)
    if grant_id:
        stmt = stmt.where(ChatGPTChange.grant_id == grant_id)
    if change_ids is not None:
        stmt = stmt.where(ChatGPTChange.id.in_(change_ids))
    else:
        stmt = stmt.where(ChatGPTChange.status == "pending", ChatGPTChange.expires_at > utcnow())
    rows = (await db.execute(stmt.order_by(ChatGPTChange.expires_at, ChatGPTChange.id).limit(101 if audit else 21))).all()
    limit = 100 if audit else 20
    entries = [dict(change_summary(row), username=username) for row, username, _ in rows[:limit]]
    tokens = {row.id: approval_token(row, grant) for row, _, grant in rows[:limit] if row.user_id == user.id and row.status == "pending" and row.expires_at > utcnow()}
    return {"results": entries, "has_more": len(rows) > limit,
        "guidance": "Select changes, edit the proposed values, then click Approve selected. Nothing is saved until status is applied. Unselected changes remain pending."}, tokens

async def active_grant(db, grant_id, user_id):
    grant = (await db.execute(select(ChatGPTGrant).where(ChatGPTGrant.id == grant_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    user = (await db.execute(select(models.User).where(models.User.id == user_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if (not grant or grant.user_id != user_id or grant.revoked_at or grant.expires_at <= utcnow()
            or not user or not user.is_active or grant.token_version != user.token_version):
        raise ValueError("The ChatGPT connection is no longer active. Reconnect before reviewing changes.")
    await require_manage_items(user)
    return user

async def record_snapshot(db, record_id, kind, frontend_url, lock=False):
    record = await get_record(db, record_id, kind, frontend_url)
    model = models.Equipment if kind == "equipment" else models.Room
    stmt = select(model).where(model.id == record_id)
    if lock:
        stmt = stmt.with_for_update()
    item = (await db.execute(stmt)).scalar_one()
    fields = ["name", "description", "floorplan_id", "x_coordinate", "y_coordinate"]
    if kind == "equipment":
        fields.append("tools_required")
    return record, item, {field: getattr(item, field) for field in fields}

async def store_proposal(db, grant, payload, frontend_url):
    count = (await db.execute(select(ChatGPTChange.id).where(ChatGPTChange.user_id == grant.user_id,
        ChatGPTChange.status == "pending", ChatGPTChange.expires_at > utcnow()))).scalars().all()
    if len(count) >= 20:
        raise ValueError("Review or cancel existing changes before proposing more (maximum 20 pending).")
    handle = secrets.token_urlsafe(32)
    row = ChatGPTChange(id=secrets.token_urlsafe(24), review_hash=credential_hash(handle), grant_id=grant.id,
        user_id=grant.user_id, payload=payload, status="pending", expires_at=utcnow() + timedelta(minutes=30))
    db.add(row)
    await db.commit()
    return {"change_id": row.id, "status": "pending", "review_url": f"{frontend_url}/connect/chatgpt?change={handle}",
        "expires_at": row.expires_at.isoformat(), "preview": payload,
        "guidance": "Nothing has been saved. After preparing the requested proposals, call review_pending_changes once to let the user select, edit and approve them in chat. The EquipMap review link is an optional fallback. Only report success after get_change_status returns applied. Pins cannot be moved by these tools."}

async def propose_edit(db, grant, record_id, kind, changes, frontend_url):
    await active_grant(db, grant.id, grant.user_id)
    values = changes.model_dump(exclude_unset=True)
    if kind == "room" and "tools_required" in values:
        raise ValueError("Rooms support name and description only.")
    if "name" in values:
        if values["name"] is None or not values["name"].strip():
            raise ValueError("A name cannot be empty.")
        values["name"] = values["name"].strip()
    record, _, snapshot = await record_snapshot(db, record_id, kind, frontend_url)
    values = {k: v for k, v in values.items() if v != snapshot[k]}
    if not values:
        raise ValueError("There are no changed values to review.")
    return await store_proposal(db, grant, {"kind": "edit", "record_type": kind, "record_id": record_id,
        "record_name": record["name"], "context": f"{record['site_name']} / {record['floorplan_name']}",
        "record_url": record["url"], "snapshot": snapshot,
        "before": {k: snapshot[k] for k in values}, "after": values}, frontend_url)

async def propose_relationship(db, grant, source_id, target_id, relationship_type, detail, operation, frontend_url):
    await active_grant(db, grant.id, grant.user_id)
    if source_id == target_id:
        raise ValueError("A relationship must connect different equipment records.")
    source, _, source_snapshot = await record_snapshot(db, source_id, "equipment", frontend_url)
    target, _, target_snapshot = await record_snapshot(db, target_id, "equipment", frontend_url)
    if source["site_id"] != target["site_id"]:
        raise ValueError("Equipment relationships must stay within the same site.")
    existing = (await db.execute(select(EquipmentRelationship).where(EquipmentRelationship.source_id == source_id,
        EquipmentRelationship.target_id == target_id, EquipmentRelationship.relationship_type == relationship_type))).scalar_one_or_none()
    if operation == "add" and existing:
        raise ValueError("This relationship already exists. Remove it before replacing its details.")
    if operation == "remove" and not existing:
        raise ValueError("This relationship no longer exists.")
    label = {"fed_by": "is fed by", "controlled_by": "is controlled by", "serves": "serves"}[relationship_type]
    return await store_proposal(db, grant, {"kind": "relationship", "operation": operation,
        "source_id": source_id, "target_id": target_id, "relationship_type": relationship_type,
        "detail": detail if operation == "add" else existing.detail,
        "relationship_id": existing.id if existing else None,
        "source_snapshot": source_snapshot, "target_snapshot": target_snapshot,
        "record_name": source["name"], "context": source["site_name"], "record_url": source["url"],
        "before": {"relationship": "None" if not existing else f"{source['name']} {label} {target['name']}: {existing.detail}"},
        "after": {"relationship": "None" if operation == "remove" else f"{source['name']} {label} {target['name']}: {detail}"}}, frontend_url)

async def review(db, handle, user, config, approve=None):
    row = (await db.execute(select(ChatGPTChange).where(ChatGPTChange.review_hash == credential_hash(handle)).with_for_update())).scalar_one_or_none()
    if not row or row.user_id != user.id:
        raise HTTPException(404, "Change request not found for this account.")
    return await review_row(db, row, user, config, approve)

async def review_row(db, row, user, config, approve=None, *, changes=None, detail=None):
    try:
        # Re-read current permissions rather than trusting the proposal or native token's role.
        await db.refresh(user)
        await active_grant(db, row.grant_id, user.id)
        grant = await db.get(ChatGPTGrant, row.grant_id)
        if grant.client_id != config.client_id or grant.resource != config.resource:
            raise ValueError("The connection configuration changed. Prepare a new proposal after reconnecting.")
        if row.status != "pending":
            return {"change_id": row.id, "status": row.status, "preview": row.payload, "audit_id": row.audit_id}
        if row.expires_at <= utcnow():
            raise HTTPException(410, "This change expired. Ask ChatGPT to prepare it again.")
        if approve is None:
            return {"change_id": row.id, "status": row.status, "preview": row.payload}
        if not approve:
            row.status = "cancelled"
            await db.commit()
            return {"change_id": row.id, "status": row.status, "preview": row.payload}
        payload = copy.deepcopy(row.payload)
        if changes is not None:
            values = changes.model_dump(exclude_unset=True)
            if payload["kind"] != "edit" or set(values) - set(payload["after"]):
                raise ValueError("Only the proposed fields may be edited in this review.")
            if "name" in values:
                if values["name"] is None or not values["name"].strip():
                    raise ValueError("A name cannot be empty.")
                values["name"] = values["name"].strip()
            payload["after"].update(values)
        if detail is not None:
            if payload["kind"] != "relationship" or payload["operation"] != "add":
                raise ValueError("Only the details of a proposed relationship addition may be edited.")
            # Preserve the recorded directed relationship, replacing only its note.
            label = {"fed_by": "is fed by", "controlled_by": "is controlled by", "serves": "serves"}[payload["relationship_type"]]
            payload["after"]["relationship"] = f"{payload['source_snapshot']['name']} {label} {payload['target_snapshot']['name']}: {detail}"
            payload["detail"] = detail
        row.payload = payload
        if payload["kind"] == "edit":
            record, item, snapshot = await record_snapshot(db, payload["record_id"], payload["record_type"], config.frontend_url, lock=True)
            if snapshot != payload["snapshot"]:
                raise HTTPException(409, "The record changed since this proposal. Ask ChatGPT to prepare a fresh review.")
            if "name" in payload["after"]:
                model = models.Equipment if payload["record_type"] == "equipment" else models.Room
                duplicate = (await db.execute(select(model.id).join(models.Floorplan).where(models.Floorplan.site_id == record["site_id"],
                    model.name == payload["after"]["name"], model.id != item.id))).first()
                if duplicate:
                    raise HTTPException(409, "That name already exists at this site.")
            for field, value in payload["after"].items():
                setattr(item, field, value)
            await log_action(db, "update", payload["record_type"], item.id, item.name, old_values=payload["before"],
                new_values=payload["after"], message=f"Confirmed ChatGPT edit ({row.id})", user=user)
        else:
            # Deterministic lock order prevents reciprocal relationship approvals deadlocking.
            snapshots = {}
            for record_id in sorted([payload["source_id"], payload["target_id"]]):
                record, _, snapshots[record_id] = await record_snapshot(db, record_id, "equipment", config.frontend_url, lock=True)
            if snapshots[payload["source_id"]] != payload["source_snapshot"] or snapshots[payload["target_id"]] != payload["target_snapshot"]:
                raise HTTPException(409, "Equipment changed since this proposal. Prepare a fresh review.")
            stmt = select(EquipmentRelationship).where(EquipmentRelationship.source_id == payload["source_id"],
                EquipmentRelationship.target_id == payload["target_id"], EquipmentRelationship.relationship_type == payload["relationship_type"]).with_for_update()
            existing = (await db.execute(stmt)).scalar_one_or_none()
            if payload["operation"] == "add":
                if existing:
                    raise HTTPException(409, "This relationship already exists.")
                relationship = EquipmentRelationship(source_id=payload["source_id"], target_id=payload["target_id"],
                    relationship_type=payload["relationship_type"], detail=payload["detail"])
                db.add(relationship)
                await db.flush()
                relationship_id = relationship.id
            else:
                if not existing or existing.id != payload["relationship_id"] or existing.detail != payload["detail"]:
                    raise HTTPException(409, "The relationship changed. Prepare a fresh review.")
                relationship_id = existing.id
                await db.delete(existing)
            await log_action(db, "create" if payload["operation"] == "add" else "delete", "equipment_relationship", relationship_id,
                payload["record_name"], old_values=payload["before"], new_values=payload["after"],
                message=f"Confirmed ChatGPT relationship ({row.id})", user=user)
        # Existing audit entries are committed atomically with the edit and proposal status.
        await db.flush()
        audit = (await db.execute(select(models.AuditLog).where(models.AuditLog.user_id == user.id,
            models.AuditLog.message.like(f"%({row.id})")).order_by(models.AuditLog.id.desc()))).scalars().first()
        row.audit_id = audit.id
        row.status = "applied"
        await db.commit()
        return {"change_id": row.id, "status": row.status, "preview": row.payload, "audit_id": row.audit_id}
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

async def submit_reviews(db, grant_id, user_id, config, decisions):
    if len({decision.change_id for decision in decisions}) != len(decisions):
        raise ValueError("Select each change only once.")
    results = []
    for decision in decisions:
        try:
            row = (await db.execute(select(ChatGPTChange).where(ChatGPTChange.id == decision.change_id).with_for_update())).scalar_one_or_none()
            if not row or row.user_id != user_id or (grant_id is not None and row.grant_id != grant_id):
                raise HTTPException(404, "Change request not found for this connection.")
            user = await active_grant(db, row.grant_id, user_id)
            grant = await db.get(ChatGPTGrant, row.grant_id)
            if not hmac.compare_digest(approval_token(row, grant), decision.approval_token):
                raise HTTPException(403, "Refresh the review form before approving this change.")
            results.append(await review_row(db, row, user, config, decision.approve,
                changes=decision.changes, detail=decision.detail))
            # Idempotent returns can still hold locks; release before the next entry.
            await db.commit()
        except (HTTPException, ValueError, IntegrityError) as exc:
            await db.rollback()
            message = exc.detail if isinstance(exc, HTTPException) else (
                "The change conflicts with a saved record. Refresh the review." if isinstance(exc, IntegrityError) else str(exc))
            results.append({"change_id": decision.change_id, "status": "error", "error": message})
    return {"results": results, "guidance": "Only entries with status applied were saved. Other selected entries have their own errors; unselected changes remain pending."}

async def relationships_for(db, equipment_id, frontend_url):
    rows = (await db.execute(select(EquipmentRelationship).where(or_(EquipmentRelationship.source_id == equipment_id,
        EquipmentRelationship.target_id == equipment_id)).order_by(EquipmentRelationship.id).limit(51))).scalars().all()
    result = []
    for row in rows[:50]:
        source = await get_record(db, row.source_id, "equipment", frontend_url)
        target = await get_record(db, row.target_id, "equipment", frontend_url)
        result.append({"id": row.id, "relationship_type": row.relationship_type, "detail": row.detail,
            "source": {k: source[k] for k in ("id", "name", "url")}, "target": {k: target[k] for k in ("id", "name", "url")}})
    return result, len(rows) > 50
