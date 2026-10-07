import os
import re
import uuid
import secrets
import logging
import hashlib
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Any, Tuple
from fastapi import Depends, HTTPException, status, Response, Request
from fastapi.security import OAuth2PasswordBearer
import jwt
from jwt.exceptions import InvalidTokenError
from passlib.context import CryptContext
from sqlalchemy.future import select
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_db
import models
import schemas

# Logger config
logger = logging.getLogger("backend.utils")

# UPLOAD DIR
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# JWT Configuration
from config import get_secret_key
SECRET_KEY = get_secret_key()
ALGORITHM = "HS256"
# Access token: default 30 minutes for SOC 2 compliance
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
# Refresh token: default 7 days with continuous rotation
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/token", auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, token_version: int = 1) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    jti = str(uuid.uuid4())
    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow(),
        "jti": jti,
        "token_version": token_version,
        "type": "access"
    })
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def create_refresh_token(
    user_id: int,
    token_version: int,
    db: AsyncSession,
    device_info: Optional[str] = None,
    ip_address: Optional[str] = None,
    expires_delta: Optional[timedelta] = None
) -> str:
    raw_token = secrets.token_urlsafe(48)
    token_hash_val = hash_token(raw_token)
    expires_at = datetime.utcnow() + (expires_delta or timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))

    db_refresh = models.RefreshToken(
        token_hash=token_hash_val,
        user_id=user_id,
        token_version=token_version,
        expires_at=expires_at,
        device_info=device_info,
        ip_address=ip_address
    )
    db.add(db_refresh)
    await db.commit()
    return raw_token

async def rotate_refresh_token(
    raw_token: str,
    db: AsyncSession,
    device_info: Optional[str] = None,
    ip_address: Optional[str] = None
) -> Tuple[str, str, models.User]:
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is required",
            headers={"WWW-Authenticate": "Bearer"}
        )
    token_hash_val = hash_token(raw_token)
    result = await db.execute(select(models.RefreshToken).where(models.RefreshToken.token_hash == token_hash_val))
    db_token = result.scalars().first()

    if not db_token:
        logger.warning("Refresh attempt with unknown refresh token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"}
        )

    user_result = await db.execute(select(models.User).where(models.User.id == db_token.user_id))
    user = user_result.scalars().first()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive or not found",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # REPLAY ATTACK DETECTION (SOC 2 CC6.1 / CC6.2)
    # If this refresh token was already revoked, someone may have intercepted/replayed it.
    # Invalidate all active sessions for this user immediately!
    if db_token.revoked_at is not None:
        logger.error(f"Replay attack detected on revoked refresh token for user '{user.username}'. Invalidating all active sessions!")
        await revoke_user_sessions(user, db, reason="replay_attack_detected")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token reuse detected. All active sessions have been terminated for security.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    now = datetime.utcnow()
    expires_at = db_token.expires_at.replace(tzinfo=None) if (db_token.expires_at and db_token.expires_at.tzinfo) else db_token.expires_at
    if expires_at and expires_at < now:
        db_token.revoked_at = now
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # Check token version against user token version
    current_version = user.token_version or 1
    if db_token.token_version < current_version:
        db_token.revoked_at = now
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # Mark old refresh token as revoked and generate rotated replacement
    db_token.revoked_at = now
    new_raw_token = secrets.token_urlsafe(48)
    new_hash = hash_token(new_raw_token)
    db_token.replaced_by_hash = new_hash

    new_db_refresh = models.RefreshToken(
        token_hash=new_hash,
        user_id=user.id,
        token_version=current_version,
        expires_at=now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        device_info=device_info or db_token.device_info,
        ip_address=ip_address or db_token.ip_address
    )
    db.add(new_db_refresh)

    access_token = create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        token_version=current_version
    )
    await db.commit()
    return access_token, new_raw_token, user

async def revoke_user_sessions(user: models.User, db: AsyncSession, reason: str = "session_revocation") -> int:
    now = datetime.utcnow()
    user.token_version = (user.token_version or 1) + 1

    # Revoke all active refresh tokens for this user
    refresh_tokens_res = await db.execute(
        select(models.RefreshToken).where(
            models.RefreshToken.user_id == user.id,
            models.RefreshToken.revoked_at.is_(None)
        )
    )
    active_tokens = refresh_tokens_res.scalars().all()
    for t in active_tokens:
        t.revoked_at = now

    await db.commit()
    logger.info(f"Revoked {len(active_tokens)} active refresh tokens for user '{user.username}' (new token_version: {user.token_version}, reason: {reason})")
    return len(active_tokens)

async def revoke_access_token(token: str, db: AsyncSession, reason: str = "logout") -> None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        jti = payload.get("jti")
        exp = payload.get("exp")
        username = payload.get("sub")

        if jti:
            expires_at = datetime.fromtimestamp(exp, tz=timezone.utc) if exp else datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
            user_id = None
            if username:
                u_res = await db.execute(select(models.User.id).where(models.User.username == username))
                user_id = u_res.scalar()

            revoked_entry = models.RevokedToken(
                jti=jti,
                user_id=user_id,
                expires_at=expires_at,
                reason=reason
            )
            db.add(revoked_entry)
            await db.commit()
    except Exception as e:
        logger.warning(f"Could not blacklist access token: {e}")

async def revoke_refresh_token_string(raw_token: str, db: AsyncSession) -> bool:
    if not raw_token:
        return False
    try:
        token_hash_val = hash_token(raw_token)
        result = await db.execute(select(models.RefreshToken).where(models.RefreshToken.token_hash == token_hash_val))
        db_token = result.scalars().first()
        if db_token and db_token.revoked_at is None:
            db_token.revoked_at = datetime.utcnow()
            await db.commit()
            return True
    except Exception as e:
        logger.warning(f"Failed to revoke refresh token: {e}")
    return False

async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> Optional[models.User]:
    if not token:
        return None
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        jti: Optional[str] = payload.get("jti")
        token_version: int = payload.get("token_version", 1)
        if username is None:
            raise credentials_exception
        token_data = schemas.TokenData(username=username, token_version=token_version, jti=jti)
    except InvalidTokenError as exc:
        logger.warning("Access token rejected: %s", type(exc).__name__)
        raise credentials_exception

    # Check if individual access token JTI was revoked (e.g. via explicit logout)
    if token_data.jti:
        revoked_res = await db.execute(
            select(models.RevokedToken).where(models.RevokedToken.jti == token_data.jti)
        )
        if revoked_res.scalars().first():
            logger.warning(f"Access attempt with revoked token JTI {token_data.jti}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has been revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )

    result = await db.execute(select(models.User).where(models.User.username == token_data.username))
    user = result.scalars().first()
    if user is None:
        raise credentials_exception

    # Verify token version matches user's current token version (instant offboarding / session revocation)
    current_user_version = user.token_version if getattr(user, "token_version", None) is not None else 1
    if token_data.token_version < current_user_version:
        logger.warning(f"Access attempt with outdated token version ({token_data.token_version} < {current_user_version}) for user {user.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked or invalidated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user

async def get_current_active_user(current_user: models.User = Depends(get_current_user)) -> Optional[models.User]:
    if current_user is None:
        return None
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

async def require_user(current_user: Optional[models.User] = Depends(get_current_active_user)) -> models.User:
    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user

async def require_manage_items(current_user: models.User = Depends(require_user)) -> models.User:
    can_manage = current_user.role in ["admin", "editor"] or (current_user.role != "viewer" and bool(getattr(current_user, "can_manage_items", False)))
    if not can_manage:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to manage floorplans, rooms, or equipment"
        )
    return current_user

# Alias for backwards compatibility
require_editor = require_manage_items

async def require_admin(current_user: models.User = Depends(require_user)) -> models.User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can perform this action"
        )
    return current_user

async def require_triage(current_user: models.User = Depends(require_user)) -> models.User:
    can_triage = current_user.role == "admin" or (current_user.role != "viewer" and bool(getattr(current_user, "can_triage", False)))
    if not can_triage:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to triage work orders"
        )
    return current_user

async def require_create_work_order(current_user: models.User = Depends(require_user)) -> models.User:
    can_create = current_user.role in ["admin", "editor"] or (current_user.role != "viewer" and bool(getattr(current_user, "can_create_work_orders", False)))
    if not can_create:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to create work orders"
        )
    return current_user

async def require_manage_pm(current_user: models.User = Depends(require_user)) -> models.User:
    can_pm = current_user.role == "admin" or (current_user.role != "viewer" and bool(getattr(current_user, "can_create_pm", False)))
    if not can_pm:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage PM schedules"
        )
    return current_user

async def require_assign(current_user: models.User = Depends(require_user)) -> models.User:
    can_assign = current_user.role == "admin" or (current_user.role != "viewer" and (bool(getattr(current_user, "can_assign", False)) or bool(getattr(current_user, "can_triage", False))))
    if not can_assign:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to assign or unassign technicians"
        )
    return current_user

async def require_close_work_order(current_user: models.User = Depends(require_user)) -> models.User:
    can_close = current_user.role in ["admin", "editor"] or (current_user.role != "viewer" and bool(getattr(current_user, "can_close_work_orders", False)))
    if not can_close:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to close work orders"
        )
    return current_user

# --- Helper for Audit Logging ---
async def log_action(
    db: AsyncSession,
    action: str,
    target_type: str,
    target_id: Optional[int] = None,
    target_name: Optional[str] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    message: Optional[str] = None,
    user: Optional[models.User] = None,
    username: Optional[str] = None,
    user_id: Optional[int] = None
):
    def sanitize(val):
        if isinstance(val, dict):
            return {k: sanitize(v) for k, v in val.items()}
        elif isinstance(val, list):
            return [sanitize(v) for v in val]
        elif isinstance(val, datetime):
            return val.isoformat()
        elif hasattr(val, "isoformat"):
            return val.isoformat()
        return val

    resolved_username = username
    resolved_user_id = user_id
    if user is not None:
        if resolved_username is None:
            resolved_username = getattr(user, "username", None)
        if resolved_user_id is None:
            resolved_user_id = getattr(user, "id", None)

    audit_log = models.AuditLog(
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_name=target_name,
        old_values=sanitize(old_values),
        new_values=sanitize(new_values),
        message=message,
        user_id=resolved_user_id,
        username=resolved_username
    )
    db.add(audit_log)

# --- ETag and Cache Helpers ---
def check_etag_match(if_none_match: Optional[str], etag: str) -> bool:
    if not if_none_match:
        return False

    def clean(val: str) -> str:
        val = val.strip()
        if val.upper().startswith('W/'):
            val = val[2:]
        return val.strip('"')

    clean_server_etag = clean(etag)
    for part in if_none_match.split(','):
        part = part.strip()
        if part == '*' or clean(part) == clean_server_etag:
            return True
    return False

async def get_floorplan_db_hash(db: AsyncSession, floorplan_id: int) -> Optional[str]:
    query = text("""
        SELECT md5(concat_ws(',',
            (SELECT xmin::text FROM floorplans WHERE id = :fp_id),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM rooms WHERE floorplan_id = :fp_id),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM equipment WHERE floorplan_id = :fp_id),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM tickets WHERE floorplan_id = :fp_id),
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM reference_points WHERE floorplan_id = :fp_id)
        ))
    """)
    result = await db.execute(query, {"fp_id": floorplan_id})
    return result.scalar()

async def get_site_floorplans_db_hash(db: AsyncSession, site_id: int) -> str:
    query = text("""
        SELECT md5(concat_ws(',',
            (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM floorplans WHERE site_id = :s_id),
            (SELECT COALESCE(string_agg(r.xmin::text, ',' ORDER BY r.id), '') FROM rooms r JOIN floorplans f ON r.floorplan_id = f.id WHERE f.site_id = :s_id),
            (SELECT COALESCE(string_agg(e.xmin::text, ',' ORDER BY e.id), '') FROM equipment e JOIN floorplans f ON e.floorplan_id = f.id WHERE f.site_id = :s_id),
            (SELECT COALESCE(string_agg(t.xmin::text, ',' ORDER BY t.id), '') FROM tickets t JOIN floorplans f ON t.floorplan_id = f.id WHERE f.site_id = :s_id),
            (SELECT COALESCE(string_agg(rp.xmin::text, ',' ORDER BY rp.id), '') FROM reference_points rp JOIN floorplans f ON rp.floorplan_id = f.id WHERE f.site_id = :s_id)
        ))
    """)
    result = await db.execute(query, {"s_id": site_id})
    return result.scalar() or "empty"

def respond_304(etag: str) -> Response:
    return Response(
        status_code=304,
        headers={
            "ETag": etag,
            "Cache-Control": "public, max-age=0, must-revalidate"
        }
    )

async def update_db_object(
    db: AsyncSession,
    obj: Any,
    update_data: BaseModel,
    target_type: str,
    name_attr: str = 'name',
    user: Optional[models.User] = None,
    username: Optional[str] = None
) -> Any:
    data = update_data.model_dump(exclude_unset=True)
    old_values = {k: getattr(obj, k) for k in data.keys() if hasattr(obj, k)}

    for key, val in data.items():
        if hasattr(obj, key):
            setattr(obj, key, val)

    name = getattr(obj, name_attr, "")
    await log_action(
        db, "update", target_type, obj.id, name,
        old_values=old_values, new_values=data,
        message=f"Updated {target_type} '{name}'",
        user=user, username=username
    )
    await db.commit()
    await db.refresh(obj)
    return obj

async def delete_db_object(
    db: AsyncSession,
    obj: Any,
    target_type: str,
    name_attr: str = 'name',
    user: Optional[models.User] = None,
    username: Optional[str] = None
) -> None:
    obj_id = obj.id
    name = getattr(obj, name_attr, "")
    old_values = {c.name: getattr(obj, c.name) for c in obj.__table__.columns}

    await db.delete(obj)
    await log_action(
        db, "delete", target_type, obj_id, name,
        old_values=old_values,
        message=f"Deleted {target_type} '{name}'",
        user=user, username=username
    )
    await db.commit()

def parse_device_details(user_agent: Optional[str] = None, client_device_info: Optional[str] = None) -> Optional[str]:
    """
    Parse a User-Agent header and optional client metadata into a clean, human-friendly summary string.
    Example output: 'Chrome 122 on Windows 10/11 (Desktop) • 1920x1080 • America/New_York'
    """
    if not user_agent and not client_device_info:
        return None

    ua = (user_agent or "").strip()

    # 1. Parse Browser
    browser = None
    if "Edg/" in ua or "EdgA/" in ua or "EdgiOS/" in ua or "Edge/" in ua:
        m = re.search(r"(?:Edg|EdgA|EdgiOS|Edge)/(\d+)", ua)
        browser = f"Edge {m.group(1)}" if m else "Edge"
    elif "OPR/" in ua or "Opera/" in ua:
        m = re.search(r"(?:OPR|Opera)/(\d+)", ua)
        browser = f"Opera {m.group(1)}" if m else "Opera"
    elif "SamsungBrowser/" in ua:
        m = re.search(r"SamsungBrowser/(\d+)", ua)
        browser = f"Samsung Internet {m.group(1)}" if m else "Samsung Internet"
    elif "Chrome/" in ua and "Chromium/" not in ua:
        m = re.search(r"Chrome/(\d+)", ua)
        browser = f"Chrome {m.group(1)}" if m else "Chrome"
    elif "Firefox/" in ua:
        m = re.search(r"Firefox/(\d+)", ua)
        browser = f"Firefox {m.group(1)}" if m else "Firefox"
    elif "Safari/" in ua and "Chrome/" not in ua:
        m = re.search(r"Version/(\d+)", ua)
        browser = f"Safari {m.group(1)}" if m else "Safari"

    # 2. Parse OS & Device Form Factor
    os_name = None
    device_type = "Desktop"

    if "iPhone" in ua:
        m = re.search(r"iPhone OS (\d+[._]\d+)", ua)
        os_version = m.group(1).replace("_", ".") if m else ""
        os_name = f"iOS {os_version}".strip() if os_version else "iOS"
        device_type = "iPhone"
    elif "iPad" in ua or ("Macintosh" in ua and "Mobile" in ua):
        m = re.search(r"OS (\d+[._]\d+)", ua)
        os_version = m.group(1).replace("_", ".") if m else ""
        os_name = f"iPadOS {os_version}".strip() if os_version else "iPadOS"
        device_type = "iPad"
    elif "Android" in ua:
        m = re.search(r"Android (\d+(?:\.\d+)?)", ua)
        os_version = m.group(1) if m else ""
        os_name = f"Android {os_version}".strip() if os_version else "Android"
        device_type = "Mobile" if "Mobile" in ua else "Tablet"
    elif "Windows NT 10.0" in ua:
        os_name = "Windows 10/11"
        device_type = "Desktop"
    elif "Windows NT 6.3" in ua:
        os_name = "Windows 8.1"
        device_type = "Desktop"
    elif "Windows NT 6.1" in ua:
        os_name = "Windows 7"
        device_type = "Desktop"
    elif "Windows" in ua:
        os_name = "Windows"
        device_type = "Desktop"
    elif "Macintosh" in ua or "Mac OS X" in ua:
        os_name = "macOS"
        device_type = "Desktop"
    elif "CrOS" in ua:
        os_name = "ChromeOS"
        device_type = "Desktop"
    elif "Linux" in ua:
        os_name = "Linux"
        device_type = "Desktop"

    # Construct main device/browser summary
    main_parts = []
    if browser and os_name:
        main_parts.append(f"{browser} on {os_name} ({device_type})")
    elif browser:
        main_parts.append(f"{browser} ({device_type})")
    elif os_name:
        main_parts.append(f"{os_name} ({device_type})")
    elif ua:
        # Shorten very long unrecognized UA
        main_parts.append(ua if len(ua) <= 50 else f"{ua[:47]}...")

    # Extract extra client metadata (e.g. screen resolution, timezone) from client_device_info
    extra_parts = []
    if client_device_info:
        raw_extras = [p.strip() for p in client_device_info.split("•") if p.strip()]
        for extra in raw_extras:
            # Skip if it repeats what we already identified
            if extra.lower() in ("desktop", "mobile", "tablet", "iphone", "ipad"):
                continue
            if os_name and extra.lower() in os_name.lower():
                continue
            if extra not in extra_parts:
                extra_parts.append(extra)

    combined = " • ".join(main_parts + extra_parts)
    return combined.strip() if combined.strip() else (client_device_info or ua or None)
