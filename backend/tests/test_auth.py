import pytest
from httpx import AsyncClient
from main import get_password_hash

@pytest.mark.asyncio
async def test_login_invalid_credentials(client: AsyncClient):
    response = await client.post("/api/token", data={"username": "wrong", "password": "wrong"})
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_get_current_user(client: AsyncClient, viewer_token: str):
    headers = {"Authorization": f"Bearer {viewer_token}"}
    response = await client.get("/api/users/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["username"] == "viewer_test"

@pytest.mark.asyncio
async def test_crud_users(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Create user
    new_user = {"username": "new_user", "password": "password123", "role": "editor", "email": "new_user@example.com"}
    response = await client.post("/api/users", json=new_user, headers=headers)
    assert response.status_code == 200
    user_data = response.json()
    user_id = user_data["id"]
    assert user_data["email"] == "new_user@example.com"

    # Get users
    response = await client.get("/api/users", headers=headers)
    assert response.status_code == 200
    assert any(u["username"] == "new_user" and u.get("email") == "new_user@example.com" for u in response.json())

    # Update user
    update_data = {"role": "viewer", "email": "updated_user@example.com"}
    response = await client.put(f"/api/users/{user_id}", json=update_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["role"] == "viewer"
    assert response.json()["email"] == "updated_user@example.com"

    # Delete user
    response = await client.delete(f"/api/users/{user_id}", headers=headers)
    assert response.status_code == 200

    # Verify deleted
    response = await client.get("/api/users", headers=headers)
    assert not any(u["id"] == user_id for u in response.json())

@pytest.mark.asyncio
async def test_unauthorized_access(client: AsyncClient):
    response = await client.get("/api/users/me")
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_auth_etag_and_304(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. /api/users ETag and 304
    response = await client.get("/api/users", headers=headers)
    assert response.status_code == 200
    etag_users = response.headers.get("etag")
    assert etag_users is not None

    headers_with_etag_users = {**headers, "If-None-Match": etag_users}
    response_users_304 = await client.get("/api/users", headers=headers_with_etag_users)
    assert response_users_304.status_code == 304
    assert response_users_304.text == ""

    # 2. /api/users/me ETag and 304
    response_me = await client.get("/api/users/me", headers=headers)
    assert response_me.status_code == 200
    etag_me = response_me.headers.get("etag")
    assert etag_me is not None

    headers_with_etag_me = {**headers, "If-None-Match": etag_me}
    response_me_304 = await client.get("/api/users/me", headers=headers_with_etag_me)
    assert response_me_304.status_code == 304
    assert response_me_304.text == ""

@pytest.mark.asyncio
async def test_granular_permissions_crud_and_token(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create technician with specific granular toggles
    tech_payload = {
        "username": "granular_tech",
        "password": "techpassword123",
        "role": "technician",
        "can_triage": False,
        "can_assign": True,
        "can_create_pm": True,
        "can_create_work_orders": True,
        "can_manage_items": True,
        "can_close_work_orders": True
    }
    create_res = await client.post("/api/users", json=tech_payload, headers=headers)
    assert create_res.status_code == 200
    user_data = create_res.json()
    assert user_data["role"] == "technician"
    assert user_data["can_triage"] is False
    assert user_data["can_assign"] is True
    assert user_data["can_create_pm"] is True
    user_id = user_data["id"]

    # 2. Log in as this tech and verify token response returns all permission flags
    login_res = await client.post("/api/token", data={"username": "granular_tech", "password": "techpassword123"})
    assert login_res.status_code == 200
    token_data = login_res.json()
    assert token_data["role"] == "technician"
    assert token_data["can_triage"] is False
    assert token_data["can_assign"] is True
    assert token_data["can_create_pm"] is True
    assert token_data["can_create_work_orders"] is True

    # 3. Update permissions
    update_res = await client.put(f"/api/users/{user_id}", json={
        "can_triage": True,
        "can_create_pm": False
    }, headers=headers)
    assert update_res.status_code == 200
    updated_user = update_res.json()
    assert updated_user["can_triage"] is True
    assert updated_user["can_create_pm"] is False

    # 4. Clean up
    del_res = await client.delete(f"/api/users/{user_id}", headers=headers)
    assert del_res.status_code == 200

@pytest.mark.asyncio
async def test_prevent_last_active_admin_lockout(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Fetch admin user id
    me_res = await client.get("/api/users/me", headers=headers)
    assert me_res.status_code == 200
    admin_id = me_res.json()["id"]

    # 1. Attempt to demote the only admin to technician -> should be rejected
    demote_res = await client.put(f"/api/users/{admin_id}", json={"role": "technician"}, headers=headers)
    assert demote_res.status_code == 400
    assert "at least one active administrator" in demote_res.json()["detail"].lower()

    # 2. Attempt to deactivate the only admin -> should be rejected
    deactivate_res = await client.put(f"/api/users/{admin_id}", json={"is_active": False}, headers=headers)
    assert deactivate_res.status_code == 400
    assert "at least one active administrator" in deactivate_res.json()["detail"].lower()

    # 3. Create a second admin
    second_admin_res = await client.post("/api/users", json={
        "username": "second_admin_user",
        "password": "password123",
        "role": "admin",
        "is_active": True
    }, headers=headers)
    assert second_admin_res.status_code == 200
    second_admin_id = second_admin_res.json()["id"]

    # 4. Now deactivating the second admin should succeed (since first admin is still active)
    deact_second = await client.put(f"/api/users/{second_admin_id}", json={"is_active": False}, headers=headers)
    assert deact_second.status_code == 200
    assert deact_second.json()["is_active"] is False

    # 5. Clean up second admin
    del_second = await client.delete(f"/api/users/{second_admin_id}", headers=headers)
    assert del_second.status_code == 200

@pytest.mark.asyncio
async def test_login_returns_refresh_token(client: AsyncClient):
    response = await client.post("/api/token", data={"username": "viewer_test", "password": "viewer_test"})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert len(data["refresh_token"]) > 20
    assert data["expires_in"] == 30 * 60

@pytest.mark.asyncio
async def test_refresh_token_rotation(client: AsyncClient):
    # 1. Log in to get initial pair
    login_res = await client.post("/api/token", data={"username": "viewer_test", "password": "viewer_test"})
    assert login_res.status_code == 200
    token1 = login_res.json()["access_token"]
    refresh1 = login_res.json()["refresh_token"]

    # 2. Use refresh1 to get rotated pair
    rot_res = await client.post("/api/refresh-token", json={"refresh_token": refresh1})
    assert rot_res.status_code == 200
    rot_data = rot_res.json()
    token2 = rot_data["access_token"]
    refresh2 = rot_data["refresh_token"]

    assert token2 is not None
    assert refresh2 is not None
    assert refresh2 != refresh1

    # 3. Verify new token2 works
    me_res = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token2}"})
    assert me_res.status_code == 200
    assert me_res.json()["username"] == "viewer_test"

    # 4. Use refresh2 to rotate again
    rot2_res = await client.post("/api/refresh-token", json={"refresh_token": refresh2})
    assert rot2_res.status_code == 200
    refresh3 = rot2_res.json()["refresh_token"]
    assert refresh3 != refresh2

@pytest.mark.asyncio
async def test_refresh_token_replay_attack_detection(client: AsyncClient):
    # 1. Log in
    login_res = await client.post("/api/token", data={"username": "viewer_test", "password": "viewer_test"})
    refresh1 = login_res.json()["refresh_token"]

    # 2. Rotate refresh1 -> yields refresh2
    rot1_res = await client.post("/api/refresh-token", json={"refresh_token": refresh1})
    assert rot1_res.status_code == 200
    token2 = rot1_res.json()["access_token"]
    refresh2 = rot1_res.json()["refresh_token"]

    # 3. Attempt to REUSE already revoked refresh1 (Simulated Replay Attack)
    replay_res = await client.post("/api/refresh-token", json={"refresh_token": refresh1})
    assert replay_res.status_code == 401
    assert "reuse detected" in replay_res.json()["detail"].lower() or "revoked" in replay_res.json()["detail"].lower()

    # 4. Because reuse was detected, ALL active tokens for this user must now be invalid!
    # Even refresh2 should now be rejected
    reuse_rot2 = await client.post("/api/refresh-token", json={"refresh_token": refresh2})
    assert reuse_rot2.status_code == 401

    # And previously issued access token token2 must be rejected
    me_res = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token2}"})
    assert me_res.status_code == 401

@pytest.mark.asyncio
async def test_immediate_offboarding_deactivation_revocation(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create a user
    user_payload = {"username": "offboard_test_user", "password": "temp_password_123", "role": "technician"}
    create_res = await client.post("/api/users", json=user_payload, headers=headers)
    assert create_res.status_code == 200
    user_id = create_res.json()["id"]

    # 2. Log in as offboard_test_user
    login_res = await client.post("/api/token", data={"username": "offboard_test_user", "password": "temp_password_123"})
    assert login_res.status_code == 200
    user_access_token = login_res.json()["access_token"]
    user_refresh_token = login_res.json()["refresh_token"]

    # 3. Verify user access token works
    user_headers = {"Authorization": f"Bearer {user_access_token}"}
    me_res = await client.get("/api/users/me", headers=user_headers)
    assert me_res.status_code == 200

    # 4. Admin deactivates user (Immediate Offboarding)
    deact_res = await client.put(f"/api/users/{user_id}", json={"is_active": False}, headers=headers)
    assert deact_res.status_code == 200

    # 5. Outstanding access token must immediately fail with 401 or 400
    me_after_deact = await client.get("/api/users/me", headers=user_headers)
    assert me_after_deact.status_code in [400, 401]

    # 6. Refresh token must also fail
    refresh_after_deact = await client.post("/api/refresh-token", json={"refresh_token": user_refresh_token})
    assert refresh_after_deact.status_code == 401

    # Clean up
    await client.delete(f"/api/users/{user_id}", headers=headers)

@pytest.mark.asyncio
async def test_admin_revoke_user_sessions_endpoint(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create user
    user_payload = {"username": "revoke_session_user", "password": "password123", "role": "technician"}
    create_res = await client.post("/api/users", json=user_payload, headers=headers)
    assert create_res.status_code == 200
    user_id = create_res.json()["id"]

    # 2. Log in as user
    login_res = await client.post("/api/token", data={"username": "revoke_session_user", "password": "password123"})
    user_token = login_res.json()["access_token"]
    user_refresh = login_res.json()["refresh_token"]

    user_headers = {"Authorization": f"Bearer {user_token}"}
    me_res = await client.get("/api/users/me", headers=user_headers)
    assert me_res.status_code == 200

    # 3. Admin calls /api/users/{id}/revoke-sessions
    revoke_res = await client.post(f"/api/users/{user_id}/revoke-sessions", headers=headers)
    assert revoke_res.status_code == 200
    rev_data = revoke_res.json()
    assert rev_data["status"] == "success"
    assert rev_data["revoked_refresh_tokens_count"] >= 1

    # 4. User's previous access token is immediately revoked
    me_revoked = await client.get("/api/users/me", headers=user_headers)
    assert me_revoked.status_code == 401
    assert me_revoked.headers["WWW-Authenticate"] == "Bearer"

    # 5. User's previous refresh token is also invalid
    refresh_revoked = await client.post("/api/refresh-token", json={"refresh_token": user_refresh})
    assert refresh_revoked.status_code == 401

    # Clean up
    await client.delete(f"/api/users/{user_id}", headers=headers)

@pytest.mark.asyncio
async def test_logout_revokes_tokens(client: AsyncClient):
    # 1. Log in
    login_res = await client.post("/api/token", data={"username": "viewer_test", "password": "viewer_test"})
    access_token = login_res.json()["access_token"]
    refresh_token = login_res.json()["refresh_token"]

    user_headers = {"Authorization": f"Bearer {access_token}"}

    # 2. Logout
    logout_res = await client.post(
        "/api/auth/logout",
        json={"refresh_token": refresh_token},
        headers=user_headers
    )
    assert logout_res.status_code == 200
    assert logout_res.json()["status"] == "success"

    # 3. Access token should be rejected (blacklisted)
    me_res = await client.get("/api/users/me", headers=user_headers)
    assert me_res.status_code == 401

    # 4. Refresh token should also be rejected
    refresh_res = await client.post("/api/refresh-token", json={"refresh_token": refresh_token})
    assert refresh_res.status_code == 401
