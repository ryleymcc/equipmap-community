import logging
from typing import List, Optional
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from database import get_db
import models
import schemas
from utils import (
    verify_password, get_password_hash, create_access_token,
    create_refresh_token, rotate_refresh_token, revoke_user_sessions,
    revoke_access_token, revoke_refresh_token_string, get_current_user,
    require_user, require_admin, ACCESS_TOKEN_EXPIRE_MINUTES, oauth2_scheme
)
from limiter import limiter, RATE_LIMIT_LOGIN


logger = logging.getLogger("backend.routers.users")
router = APIRouter(tags=["users"])

@router.post("/api/token", response_model=schemas.Token)
@limiter.limit(RATE_LIMIT_LOGIN)
async def login_for_access_token(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    logger.info(f"Login attempt for user: {form_data.username}")
    result = await db.execute(select(models.User).where(models.User.username == form_data.username))
    user = result.scalars().first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        logger.warning(f"Invalid login attempt for user: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        logger.warning(f"Login attempt for inactive user: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User account is inactive. Please contact an administrator.",
        )

    logger.info(f"Successful login for user: {form_data.username}")
    token_version = user.token_version or 1
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires, token_version=token_version
    )

    client_ip = request.client.host if request.client else None
    device_info = request.headers.get("user-agent")
    refresh_token_str = await create_refresh_token(
        user_id=user.id,
        token_version=token_version,
        db=db,
        device_info=device_info,
        ip_address=client_ip
    )

    is_adm = user.role == "admin"
    return {
        "access_token": access_token,
        "refresh_token": refresh_token_str,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role,
        "can_triage": bool(user.can_triage or is_adm),
        "can_assign": bool(user.can_assign or is_adm),
        "can_create_pm": bool(user.can_create_pm or is_adm),
        "can_create_work_orders": bool(user.can_create_work_orders if not is_adm else True),
        "can_manage_items": bool(user.can_manage_items or is_adm or user.role == "editor"),
        "can_close_work_orders": bool(user.can_close_work_orders if not is_adm else True),
        "can_undo_all_audit_logs": bool(user.can_undo_all_audit_logs or is_adm)
    }

@router.post("/api/refresh-token", response_model=schemas.Token)
@limiter.limit("30/minute")
async def refresh_token(
    request: Request,
    refresh_req: Optional[schemas.TokenRefreshRequest] = None,
    db: AsyncSession = Depends(get_db)
):
    client_ip = request.client.host if request.client else None
    device_info = request.headers.get("user-agent")

    raw_refresh = refresh_req.refresh_token if (refresh_req and refresh_req.refresh_token) else None

    if not raw_refresh:
        # Fallback: check if an access token was provided in Authorization header
        auth_header = request.headers.get("authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ")[1]
            try:
                current_user = await get_current_user(token=token, db=db)
                if current_user:
                    token_version = current_user.token_version or 1
                    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
                    access_token = create_access_token(
                        data={"sub": current_user.username},
                        expires_delta=access_token_expires,
                        token_version=token_version
                    )
                    new_refresh_token = await create_refresh_token(
                        user_id=current_user.id,
                        token_version=token_version,
                        db=db,
                        device_info=device_info,
                        ip_address=client_ip
                    )
                    is_adm = current_user.role == "admin"
                    return {
                        "access_token": access_token,
                        "refresh_token": new_refresh_token,
                        "token_type": "bearer",
                        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                        "username": current_user.username,
                        "full_name": current_user.full_name,
                        "email": current_user.email,
                        "role": current_user.role,
                        "can_triage": bool(current_user.can_triage or is_adm),
                        "can_assign": bool(current_user.can_assign or is_adm),
                        "can_create_pm": bool(current_user.can_create_pm or is_adm),
                        "can_create_work_orders": bool(current_user.can_create_work_orders if not is_adm else True),
                        "can_manage_items": bool(current_user.can_manage_items or is_adm or current_user.role == "editor"),
                        "can_close_work_orders": bool(current_user.can_close_work_orders if not is_adm else True),
                        "can_undo_all_audit_logs": bool(current_user.can_undo_all_audit_logs or is_adm)
                    }
            except Exception:
                pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is required",
            headers={"WWW-Authenticate": "Bearer"}
        )

    access_token, new_refresh_token, user = await rotate_refresh_token(
        raw_token=raw_refresh,
        db=db,
        device_info=device_info,
        ip_address=client_ip
    )
    is_adm = user.role == "admin"
    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role,
        "can_triage": bool(user.can_triage or is_adm),
        "can_assign": bool(user.can_assign or is_adm),
        "can_create_pm": bool(user.can_create_pm or is_adm),
        "can_create_work_orders": bool(user.can_create_work_orders if not is_adm else True),
        "can_manage_items": bool(user.can_manage_items or is_adm or user.role == "editor"),
        "can_close_work_orders": bool(user.can_close_work_orders if not is_adm else True),
        "can_undo_all_audit_logs": bool(user.can_undo_all_audit_logs or is_adm)
    }

@router.post("/api/auth/logout")
async def logout(
    request: Request,
    logout_data: Optional[schemas.LogoutRequest] = None,
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
):
    if token:
        await revoke_access_token(token, db=db, reason="user_logout")
    if logout_data and logout_data.refresh_token:
        await revoke_refresh_token_string(logout_data.refresh_token, db=db)
    return {"status": "success", "message": "Logged out successfully"}

@router.post("/api/users/{user_id}/revoke-sessions", response_model=schemas.RevokeSessionsResponse)
async def admin_revoke_user_sessions(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin)
):
    result = await db.execute(select(models.User).where(models.User.id == user_id))
    db_user = result.scalars().first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    revoked_count = await revoke_user_sessions(db_user, db, reason=f"admin_revocation_by_{current_user.username}")
    logger.info(f"Admin '{current_user.username}' revoked all sessions ({revoked_count} refresh tokens) for user '{db_user.username}'")

    return {
        "status": "success",
        "message": f"Successfully revoked all active sessions for user '{db_user.username}'",
        "user_id": db_user.id,
        "new_token_version": db_user.token_version,
        "revoked_refresh_tokens_count": revoked_count
    }

@router.get("/api/users/me", response_model=schemas.User)
async def read_users_me(current_user: models.User = Depends(require_user)):
    return current_user

@router.get("/api/users/assignable", response_model=List[schemas.UserAssignable])
async def get_assignable_users(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_user)):
    result = await db.execute(
        select(models.User)
        .where(models.User.is_active == True)
        .order_by(
            func.lower(func.coalesce(models.User.full_name, models.User.username)).asc(),
            func.lower(models.User.username).asc()
        )
    )
    users = result.scalars().all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "email": u.email,
            "role": u.role,
            "trade": u.trade,
            "can_triage": bool(u.can_triage or u.role == "admin"),
            "can_assign": bool(u.can_assign or u.role == "admin"),
            "can_create_pm": bool(u.can_create_pm or u.role == "admin"),
            "can_create_work_orders": bool(u.can_create_work_orders if u.role != "admin" else True),
            "can_manage_items": bool(u.can_manage_items or u.role in ["admin", "editor"]),
            "can_close_work_orders": bool(u.can_close_work_orders if u.role != "admin" else True),
            "can_undo_all_audit_logs": bool(u.can_undo_all_audit_logs or u.role == "admin")
        }
        for u in users
    ]

@router.post("/api/users", response_model=schemas.User)
async def create_user(user: schemas.UserCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_admin)):
    result = await db.execute(select(models.User).where(models.User.username == user.username))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Username already registered")

    is_admin = user.role == "admin"
    is_viewer = user.role == "viewer"

    db_user = models.User(
        username=user.username,
        full_name=user.full_name.strip() if user.full_name and user.full_name.strip() else None,
        email=user.email.strip() if user.email and user.email.strip() else None,
        hashed_password=get_password_hash(user.password),
        role=user.role,
        trade=user.trade.strip() if user.trade and user.trade.strip() else None,
        can_triage=True if is_admin else (False if is_viewer else user.can_triage),
        can_assign=True if is_admin else (False if is_viewer else user.can_assign),
        can_create_pm=True if is_admin else (False if is_viewer else user.can_create_pm),
        can_create_work_orders=True if is_admin else (False if is_viewer else user.can_create_work_orders),
        can_manage_items=True if is_admin else (False if is_viewer else user.can_manage_items),
        can_close_work_orders=True if is_admin else (False if is_viewer else user.can_close_work_orders),
        can_undo_all_audit_logs=True if is_admin else (False if is_viewer else user.can_undo_all_audit_logs),
        is_active=user.is_active
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

@router.get("/api/users", response_model=List[schemas.User])
async def get_users(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_admin)):
    result = await db.execute(select(models.User).order_by(models.User.username))
    return result.scalars().all()

@router.put("/api/users/{user_id}", response_model=schemas.User)
async def update_user(user_id: int, user_update: schemas.UserUpdate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_admin)):
    result = await db.execute(select(models.User).where(models.User.id == user_id))
    db_user = result.scalars().first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Protect the last active administrator from demotion or deactivation
    is_currently_active_admin = (db_user.role == "admin" and db_user.is_active)
    will_be_role = user_update.role if user_update.role is not None else db_user.role
    will_be_active = user_update.is_active if user_update.is_active is not None else db_user.is_active
    will_be_active_admin = (will_be_role == "admin" and will_be_active)

    if is_currently_active_admin and not will_be_active_admin:
        other_admins_result = await db.execute(
            select(func.count(models.User.id)).where(
                models.User.role == "admin",
                models.User.is_active == True,
                models.User.id != user_id
            )
        )
        other_admins_count = other_admins_result.scalar() or 0
        if other_admins_count == 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot demote or deactivate the only active administrator. There must be at least one active administrator in the system."
            )

    if user_update.username is not None:
        dup_result = await db.execute(select(models.User).where(models.User.username == user_update.username, models.User.id != user_id))
        if dup_result.scalars().first():
            raise HTTPException(status_code=400, detail="Username already taken")
        db_user.username = user_update.username

    if user_update.full_name is not None:
        db_user.full_name = user_update.full_name.strip() if user_update.full_name.strip() else None

    if user_update.email is not None:
        db_user.email = user_update.email.strip() if user_update.email.strip() else None

    if user_update.trade is not None:
        db_user.trade = user_update.trade.strip() if user_update.trade.strip() else None

    if user_update.role is not None:
        db_user.role = user_update.role
        if user_update.role == "viewer":
            db_user.can_triage = False
            db_user.can_assign = False
            db_user.can_create_pm = False
            db_user.can_create_work_orders = False
            db_user.can_manage_items = False
            db_user.can_close_work_orders = False
            db_user.can_undo_all_audit_logs = False
        elif user_update.role == "admin":
            db_user.can_triage = True
            db_user.can_assign = True
            db_user.can_create_pm = True
            db_user.can_create_work_orders = True
            db_user.can_manage_items = True
            db_user.can_close_work_orders = True
            db_user.can_undo_all_audit_logs = True

    if db_user.role not in ["viewer", "admin"]:
        if user_update.can_triage is not None:
            db_user.can_triage = user_update.can_triage
        if user_update.can_assign is not None:
            db_user.can_assign = user_update.can_assign
        if user_update.can_create_pm is not None:
            db_user.can_create_pm = user_update.can_create_pm
        if user_update.can_create_work_orders is not None:
            db_user.can_create_work_orders = user_update.can_create_work_orders
        if user_update.can_manage_items is not None:
            db_user.can_manage_items = user_update.can_manage_items
        if user_update.can_close_work_orders is not None:
            db_user.can_close_work_orders = user_update.can_close_work_orders
        if user_update.can_undo_all_audit_logs is not None:
            db_user.can_undo_all_audit_logs = user_update.can_undo_all_audit_logs

    should_revoke_sessions = False
    if user_update.is_active is False and db_user.is_active:
        should_revoke_sessions = True
    if user_update.password is not None:
        should_revoke_sessions = True

    if user_update.is_active is not None:
        db_user.is_active = user_update.is_active
    if user_update.password is not None:
        db_user.hashed_password = get_password_hash(user_update.password)

    if should_revoke_sessions:
        await revoke_user_sessions(db_user, db, reason="admin_user_update_deactivation_or_password_reset")
    else:
        await db.commit()
    await db.refresh(db_user)
    return db_user

@router.delete("/api/users/{user_id}")
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_admin)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    result = await db.execute(select(models.User).where(models.User.id == user_id))
    db_user = result.scalars().first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Protect the last active administrator from deletion
    if db_user.role == "admin" and db_user.is_active:
        other_admins_result = await db.execute(
            select(func.count(models.User.id)).where(
                models.User.role == "admin",
                models.User.is_active == True,
                models.User.id != user_id
            )
        )
        other_admins_count = other_admins_result.scalar() or 0
        if other_admins_count == 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the only active administrator. There must be at least one active administrator in the system."
            )

    await db.delete(db_user)
    await db.commit()
    return {"status": "success"}
