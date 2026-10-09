import os
import json
import logging
import asyncio
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from py_vapid import Vapid, b64urlencode
from cryptography.hazmat.primitives import serialization
from pywebpush import webpush, WebPushException

from database import get_db
import models
import schemas
logger = logging.getLogger("backend.routers.notifications")
router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# Private data directory for secrets that must NOT be publicly accessible.
# UPLOAD_DIR is served by StaticFiles — never store keys there.
_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
os.makedirs(_DATA_DIR, exist_ok=True)

_vapid_instance: Optional[Vapid] = None
_vapid_public_key_b64: Optional[str] = None

def get_vapid_instance() -> Vapid:
    global _vapid_instance, _vapid_public_key_b64
    if _vapid_instance is not None:
        return _vapid_instance

    # 1. Check environment variables
    env_priv = os.getenv("VAPID_PRIVATE_KEY")
    if env_priv:
        try:
            if "BEGIN" in env_priv:
                _vapid_instance = Vapid.from_pem(env_priv.encode("utf-8"))
            else:
                _vapid_instance = Vapid.from_raw(env_priv.encode("utf-8"))
            logger.info("Loaded VAPID key from environment variable")
        except Exception as e:
            logger.warning(f"Failed to load VAPID key from environment: {e}")

    # 2. Check persistent key file on disk (private data dir, NOT public uploads)
    key_file_path = os.path.join(_DATA_DIR, "vapid_key.pem")
    if _vapid_instance is None and os.path.exists(key_file_path):
        try:
            with open(key_file_path, "rb") as f:
                pem_data = f.read()
            _vapid_instance = Vapid.from_pem(pem_data)
            logger.info(f"Loaded persistent VAPID key from {key_file_path}")
        except Exception as e:
            logger.warning(f"Failed to load VAPID key from {key_file_path}: {e}")

    # 3. Generate new keypair if none exists and save
    if _vapid_instance is None:
        _vapid_instance = Vapid()
        _vapid_instance.generate_keys()
        try:
            with open(key_file_path, "wb") as f:
                f.write(_vapid_instance.private_pem())
            logger.info(f"Generated new VAPID keypair and saved to {key_file_path}")
        except Exception as e:
            logger.warning(f"Could not save VAPID key to disk: {e}")

    raw_pub = _vapid_instance.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    _vapid_public_key_b64 = b64urlencode(raw_pub)
    return _vapid_instance

def get_vapid_public_key() -> str:
    global _vapid_public_key_b64
    if _vapid_public_key_b64 is None:
        get_vapid_instance()
    return _vapid_public_key_b64 or ""

def get_vapid_claims() -> dict:
    return {
        "sub": os.getenv("VAPID_CLAIMS_SUB", "mailto:admin@equipmap.local")
    }

@router.get("/vapid-public-key")
async def get_public_key():
    """Returns the application server VAPID public key for Web Push subscription."""
    pub_key = get_vapid_public_key()
    return {"public_key": pub_key}

@router.post("/subscribe")
async def subscribe_push(
    payload: schemas.PushSubscriptionCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Subscribes a device/browser push endpoint to notifications for a user.
    Does not require auth so it works seamlessly even if session token expires.
    """
    # Verify user exists
    user_res = await db.execute(select(models.User).where(models.User.id == payload.user_id))
    user = user_res.scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    endpoint = payload.subscription.endpoint
    p256dh = payload.subscription.keys.p256dh
    auth = payload.subscription.keys.auth

    if not endpoint or not p256dh or not auth:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid push subscription details")

    # Upsert subscription by endpoint
    existing_res = await db.execute(
        select(models.PushSubscription).where(models.PushSubscription.endpoint == endpoint)
    )
    sub = existing_res.scalars().first()

    if sub:
        sub.user_id = payload.user_id
        sub.p256dh = p256dh
        sub.auth = auth
    else:
        sub = models.PushSubscription(
            user_id=payload.user_id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth
        )
        db.add(sub)

    await db.commit()
    logger.info(f"Push subscription registered for user_id={payload.user_id}")
    return {"status": "subscribed", "user_id": payload.user_id}

@router.post("/unsubscribe")
async def unsubscribe_push(
    payload: schemas.PushSubscriptionUnsubscribe,
    db: AsyncSession = Depends(get_db)
):
    """
    Unsubscribes a device/browser push endpoint from notifications.
    Called when the user explicitly signs out.
    """
    endpoint = payload.endpoint
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Endpoint is required")

    query = select(models.PushSubscription).where(models.PushSubscription.endpoint == endpoint)
    if payload.user_id is not None:
        query = query.where(models.PushSubscription.user_id == payload.user_id)

    existing_res = await db.execute(query)
    subs = existing_res.scalars().all()

    for sub in subs:
        await db.delete(sub)

    await db.commit()
    logger.info(f"Unsubscribed endpoint {endpoint[:40]}...")
    return {"status": "unsubscribed", "count": len(subs)}

@router.post("/test")
async def test_notification(
    user_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Sends a test push notification to a specified user's registered devices."""
    sent_count = await send_push_notification_to_users(
        db,
        user_ids=[user_id],
        title="EquipMap",
        body="You have a new work order assignment.",
        url="/work-orders"
    )
    return {"status": "success", "sent_count": sent_count}

async def send_push_notification_to_users(
    db: AsyncSession,
    user_ids: List[int],
    title: str = "EquipMap",
    body: str = "You have a new work order assignment.",
    url: str = "/work-orders"
) -> int:
    """
    Asynchronously delivers a privacy-safe generic push notification to all
    registered push subscriptions for the given user IDs across all their devices.
    """
    if not user_ids:
        return 0

    # Query subscriptions for these user IDs
    result = await db.execute(
        select(models.PushSubscription).where(models.PushSubscription.user_id.in_(user_ids))
    )
    subscriptions = result.scalars().all()

    if not subscriptions:
        logger.info(f"No push subscriptions found for user_ids={user_ids}")
        return 0

    vapid = get_vapid_instance()
    payload = json.dumps({
        "title": title,
        "body": body,
        "url": url
    })

    async def _send_single(sub: models.PushSubscription):
        sub_info = {
            "endpoint": sub.endpoint,
            "keys": {
                "p256dh": sub.p256dh,
                "auth": sub.auth
            }
        }
        # Copy claims per device so aud/exp mutations in pywebpush don't corrupt other devices
        claims = get_vapid_claims().copy()
        try:
            await asyncio.to_thread(
                webpush,
                subscription_info=sub_info,
                data=payload,
                vapid_private_key=vapid,
                vapid_claims=claims,
                ttl=86400,
                headers={"Urgency": "high"}
            )
            logger.info(f"Web push successfully sent to endpoint {sub.endpoint[:40]}...")
            return (True, None)
        except WebPushException as ex:
            logger.warning(f"WebPush failed for endpoint {sub.endpoint[:40]}: {ex}")
            # If 404 or 410 (Gone), subscription has expired or was revoked by browser
            if ex.response is not None and ex.response.status_code in [404, 410]:
                return (False, sub)
            return (False, None)
        except Exception as e:
            logger.error(f"Unexpected error sending webpush to {sub.endpoint[:40]}: {e}")
            return (False, None)

    results = await asyncio.gather(*[_send_single(sub) for sub in subscriptions])
    sent_count = sum(1 for success, _ in results if success)
    subs_to_delete = [dead_sub for _, dead_sub in results if dead_sub is not None]

    if subs_to_delete:
        for dead_sub in subs_to_delete:
            await db.delete(dead_sub)
        await db.commit()
        logger.info(f"Cleaned up {len(subs_to_delete)} expired push subscriptions")

    return sent_count

async def get_triage_user_ids(db: AsyncSession) -> List[int]:
    """Returns the IDs of all active users who are admins or have triage permissions."""
    result = await db.execute(
        select(models.User.id).where(
            models.User.is_active == True,
            (models.User.role == "admin") | (models.User.can_triage == True)
        )
    )
    return [row[0] for row in result.fetchall()]

async def send_push_notification_for_triage(
    db: AsyncSession,
    title: str = "EquipMap",
    body: str = "You have a new maintenance request to triage.",
    url: str = "/work-orders"
) -> int:
    """
    Asynchronously delivers a push notification to all active admins and triage users
    informing them that a new maintenance request is awaiting triage.
    """
    triage_ids = await get_triage_user_ids(db)
    if not triage_ids:
        logger.info("No triage users or admins found to notify.")
        return 0
    return await send_push_notification_to_users(
        db,
        user_ids=triage_ids,
        title=title,
        body=body,
        url=url
    )
