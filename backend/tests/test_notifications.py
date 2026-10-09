import pytest
from unittest.mock import patch, MagicMock
from httpx import AsyncClient
from sqlalchemy.future import select
import models
from pywebpush import WebPushException

import uuid

@pytest.fixture
async def technician_user(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    uname = f"tech_notif_{uuid.uuid4().hex[:8]}"
    resp = await client.post(
        "/api/users",
        json={"username": uname, "password": "password123", "role": "technician", "is_active": True},
        headers=headers
    )
    assert resp.status_code == 200
    return resp.json()

@pytest.fixture
async def sample_subscription_payload(technician_user):
    return {
        "user_id": technician_user["id"],
        "subscription": {
            "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-12345",
            "keys": {
                "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DKM",
                "auth": "AAAAAAAAAAAAAAAAAAAAAA"  # Synthetic all-zero auth key.
            }
        }
    }

@pytest.mark.asyncio
async def test_get_vapid_public_key_unauthenticated(client: AsyncClient):
    """VAPID public key endpoint must be publicly accessible without authentication."""
    resp = await client.get("/api/notifications/vapid-public-key")
    assert resp.status_code == 200
    data = resp.json()
    assert "public_key" in data
    assert len(data["public_key"]) > 30

@pytest.mark.asyncio
async def test_subscribe_and_unsubscribe_unauthenticated(
    client: AsyncClient, technician_user, sample_subscription_payload, db_session
):
    """
    Subscribing and unsubscribing must work without an Authorization header so that
    devices can stay registered even when user sessions expire in the background.
    """
    # 1. Subscribe without auth token
    resp = await client.post("/api/notifications/subscribe", json=sample_subscription_payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "subscribed"
    assert resp.json()["user_id"] == technician_user["id"]

    # Verify stored in DB
    result = await db_session.execute(
        select(models.PushSubscription).where(models.PushSubscription.user_id == technician_user["id"])
    )
    subs = result.scalars().all()
    assert len(subs) == 1
    assert subs[0].endpoint == sample_subscription_payload["subscription"]["endpoint"]

    # 2. Re-subscribe updates existing endpoint without duplicating
    resp2 = await client.post("/api/notifications/subscribe", json=sample_subscription_payload)
    assert resp2.status_code == 200
    result2 = await db_session.execute(
        select(models.PushSubscription).where(models.PushSubscription.user_id == technician_user["id"])
    )
    assert len(result2.scalars().all()) == 1

    # 3. Unsubscribe without auth token
    unsub_resp = await client.post(
        "/api/notifications/unsubscribe",
        json={"endpoint": sample_subscription_payload["subscription"]["endpoint"], "user_id": technician_user["id"]}
    )
    assert unsub_resp.status_code == 200
    assert unsub_resp.json()["status"] == "unsubscribed"

    # Verify deleted from DB
    result3 = await db_session.execute(
        select(models.PushSubscription).where(models.PushSubscription.user_id == technician_user["id"])
    )
    assert len(result3.scalars().all()) == 0

@pytest.mark.asyncio
async def test_subscribe_invalid_user_returns_404(client: AsyncClient):
    payload = {
        "user_id": 999999,
        "subscription": {
            "endpoint": "https://fcm.googleapis.com/fcm/send/invalid-user",
            "keys": {"p256dh": "key1", "auth": "key2"}
        }
    }
    resp = await client.post("/api/notifications/subscribe", json=payload)
    assert resp.status_code == 404

@pytest.mark.asyncio
async def test_work_order_creation_triggers_push_notification(
    client: AsyncClient, admin_token: str, technician_user, sample_subscription_payload, db_session
):
    """
    Creating a work order assigned to a technician must trigger a privacy-safe
    push notification to that technician's registered devices.
    """
    # Register technician subscription
    await client.post("/api/notifications/subscribe", json=sample_subscription_payload)

    with patch("routers.notifications.webpush") as mock_webpush:
        mock_webpush.return_value = MagicMock(status_code=201)

        headers = {"Authorization": f"Bearer {admin_token}"}
        wo_payload = {
            "title": "HVAC Leak in Room 102",
            "description": "Fix air conditioner leak immediately",
            "category": "HVAC",
            "priority": "high",
            "assigned_user_ids": [technician_user["id"]]
        }
        resp = await client.post("/api/work-orders", json=wo_payload, headers=headers)
        assert resp.status_code == 200

        # Verify webpush was called
        assert mock_webpush.called
        call_kwargs = mock_webpush.call_args.kwargs
        assert call_kwargs["subscription_info"]["endpoint"] == sample_subscription_payload["subscription"]["endpoint"]
        # Verify notification payload contains privacy-safe message
        assert "new work order assignment" in call_kwargs["data"]
        # Ensure no sensitive title or internal details were leaked in the payload
        assert "HVAC Leak" not in call_kwargs["data"]

@pytest.mark.asyncio
async def test_work_order_update_triggers_push_for_new_assignees(
    client: AsyncClient, admin_token: str, technician_user, sample_subscription_payload, db_session
):
    """
    Updating a work order to assign a technician must trigger a push notification
    only to the newly assigned user.
    """
    # Register technician subscription
    await client.post("/api/notifications/subscribe", json=sample_subscription_payload)

    headers = {"Authorization": f"Bearer {admin_token}"}
    # Create unassigned work order
    wo_payload = {
        "title": "Door latch broken",
        "description": "Door does not close properly",
        "category": "General",
        "priority": "medium",
        "assigned_user_ids": []
    }
    create_resp = await client.post("/api/work-orders", json=wo_payload, headers=headers)
    assert create_resp.status_code == 200
    wo_id = create_resp.json()["id"]

    with patch("routers.notifications.webpush") as mock_webpush:
        mock_webpush.return_value = MagicMock(status_code=201)

        # Update work order to assign technician
        update_resp = await client.put(
            f"/api/work-orders/{wo_id}",
            json={"assigned_user_ids": [technician_user["id"]]},
            headers=headers
        )
        assert update_resp.status_code == 200

        # Verify webpush was called
        assert mock_webpush.called
        call_kwargs = mock_webpush.call_args.kwargs
        assert call_kwargs["subscription_info"]["endpoint"] == sample_subscription_payload["subscription"]["endpoint"]

@pytest.mark.asyncio
async def test_expired_subscription_cleanup_on_410_gone(
    client: AsyncClient, technician_user, sample_subscription_payload, db_session
):
    """
    When webpush returns HTTP 410 or 404 (subscription revoked/expired by browser),
    the dead subscription should be automatically removed from the database.
    """
    # Register subscription
    await client.post("/api/notifications/subscribe", json=sample_subscription_payload)

    # Mock webpush to throw WebPushException with status_code 410
    mock_response = MagicMock()
    mock_response.status_code = 410
    fake_exception = WebPushException("Push subscription has expired", response=mock_response)

    with patch("routers.notifications.webpush", side_effect=fake_exception):
        # Trigger test notification
        test_resp = await client.post(f"/api/notifications/test?user_id={technician_user['id']}")
        assert test_resp.status_code == 200
        assert test_resp.json()["sent_count"] == 0

        # Verify dead subscription was deleted
        result = await db_session.execute(
            select(models.PushSubscription).where(models.PushSubscription.user_id == technician_user["id"])
        )
        assert len(result.scalars().all()) == 0

@pytest.mark.asyncio
async def test_multiple_devices_for_same_user_all_receive_notifications(
    client: AsyncClient, admin_token: str, technician_user, db_session
):
    """
    When a user is signed in on multiple devices (e.g. phone on FCM and laptop on Mozilla Autopush),
    both devices must receive push notifications concurrently without audience claim corruption.
    """
    # 1. Register Device 1 (FCM / Chrome)
    device1_payload = {
        "user_id": technician_user["id"],
        "subscription": {
            "endpoint": "https://fcm.googleapis.com/fcm/send/device-phone-111",
            "keys": {
                "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DKM",
                "auth": "AAAAAAAAAAAAAAAAAAAAAA"  # Synthetic all-zero auth key.
            }
        }
    }
    await client.post("/api/notifications/subscribe", json=device1_payload)

    # 2. Register Device 2 (Mozilla / Firefox or Apple)
    device2_payload = {
        "user_id": technician_user["id"],
        "subscription": {
            "endpoint": "https://updates.push.services.mozilla.com/wpush/v2/device-laptop-222",
            "keys": {
                "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DKM",
                "auth": "AAAAAAAAAAAAAAAAAAAAAA"  # Synthetic all-zero auth key.
            }
        }
    }
    await client.post("/api/notifications/subscribe", json=device2_payload)

    # Verify both subscriptions exist for user
    result = await db_session.execute(
        select(models.PushSubscription).where(models.PushSubscription.user_id == technician_user["id"])
    )
    subs = result.scalars().all()
    assert len(subs) == 2

    # 3. Trigger notification for work order assignment
    with patch("routers.notifications.webpush") as mock_webpush:
        mock_webpush.return_value = MagicMock(status_code=201)

        test_resp = await client.post(f"/api/notifications/test?user_id={technician_user['id']}")
        assert test_resp.status_code == 200
        assert test_resp.json()["sent_count"] == 2

        # Verify webpush was called for BOTH endpoints
        assert mock_webpush.call_count == 2
        endpoints_called = [call.kwargs["subscription_info"]["endpoint"] for call in mock_webpush.call_args_list]
        assert "https://fcm.googleapis.com/fcm/send/device-phone-111" in endpoints_called
        assert "https://updates.push.services.mozilla.com/wpush/v2/device-laptop-222" in endpoints_called

@pytest.mark.asyncio
async def test_public_request_notifies_triage_users_and_admins(
    client: AsyncClient, admin_token: str, db_session
):
    """
    When a new public maintenance request or ticket is submitted, all active admins
    and users with triage permissions must receive a push notification.
    """
    # 1. Create a user with can_triage=True
    headers = {"Authorization": f"Bearer {admin_token}"}
    triage_uname = f"triage_user_{uuid.uuid4().hex[:8]}"
    triage_user_res = await client.post(
        "/api/users",
        json={"username": triage_uname, "password": "password123", "role": "technician", "can_triage": True, "is_active": True},
        headers=headers
    )
    assert triage_user_res.status_code == 200
    triage_user = triage_user_res.json()

    # 2. Register push subscription for the triage user
    triage_sub_payload = {
        "user_id": triage_user["id"],
        "subscription": {
            "endpoint": f"https://fcm.googleapis.com/fcm/send/triage-{uuid.uuid4().hex[:8]}",
            "keys": {
                "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DKM",
                "auth": "AAAAAAAAAAAAAAAAAAAAAA"  # Synthetic all-zero auth key.
            }
        }
    }
    await client.post("/api/notifications/subscribe", json=triage_sub_payload)

    # 3. Submit a public maintenance request
    with patch("routers.notifications.webpush") as mock_webpush:
        mock_webpush.return_value = MagicMock(status_code=201)

        pub_req_payload = {
            "title": "Water fountain leaking in hallway",
            "description": "Continuous leak onto carpet",
            "category": "Plumbing",
            "priority": "medium",
            "requester_name": "Jane Doe",
            "requester_email": "jane@example.com"
        }
        pub_resp = await client.post("/api/work-orders/public", json=pub_req_payload)
        assert pub_resp.status_code == 200
        assert pub_resp.json()["status"] == "pending_triage"

        # Verify push was sent to triage user
        assert mock_webpush.called
        endpoints_called = [call.kwargs["subscription_info"]["endpoint"] for call in mock_webpush.call_args_list]
        assert triage_sub_payload["subscription"]["endpoint"] in endpoints_called

        # Verify notification message content is generic and privacy-safe
        last_call_data = mock_webpush.call_args_list[-1].kwargs["data"]
        assert "maintenance request to triage" in last_call_data
        assert "Water fountain" not in last_call_data
