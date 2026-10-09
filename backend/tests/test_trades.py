import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_trades_lifecycle_and_cascade(client: AsyncClient, admin_token: str, editor_token: str):
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    editor_headers = {"Authorization": f"Bearer {editor_token}"}

    # 1. Fetch trades list and summary
    res = await client.get("/api/trades", headers=editor_headers)
    assert res.status_code == 200
    trades_list = res.json()
    assert isinstance(trades_list, list)
    assert len(trades_list) > 0

    res = await client.get("/api/trades/summary", headers=editor_headers)
    assert res.status_code == 200
    summary = res.json()
    assert isinstance(summary, list)
    assert len(summary) > 0
    assert "name" in summary[0]
    assert "user_count" in summary[0]
    assert "pm_schedule_count" in summary[0]

    # 2. Non-admin cannot create trade
    res = await client.post("/api/trades", json={"name": "TEST-UNAUTH-TRADE"}, headers=editor_headers)
    assert res.status_code == 403

    # 3. Admin creates trade
    test_trade = "TEST-ELEC-SPECIAL"
    res = await client.post("/api/trades", json={
        "name": test_trade,
        "description": "Special electrical systems",
        "color": "#10b981"
    }, headers=admin_headers)
    assert res.status_code == 200
    created = res.json()
    assert created["name"] == test_trade
    assert created["description"] == "Special electrical systems"
    assert created["color"] == "#10b981"

    # Verify duplicate creation is rejected
    res = await client.post("/api/trades", json={"name": test_trade}, headers=admin_headers)
    assert res.status_code == 400

    # 4. Create user assigned to this trade
    user_res = await client.post("/api/users", json={
        "username": "trade_tech_1",
        "password": "password123",
        "role": "technician",
        "trade": test_trade,
        "full_name": "Trade Tech One"
    }, headers=admin_headers)
    assert user_res.status_code == 200
    created_user_id = user_res.json()["id"]

    # Check summary shows user count >= 1
    res = await client.get("/api/trades/summary", headers=admin_headers)
    trade_item = next((t for t in res.json() if t["name"] == test_trade), None)
    assert trade_item is not None
    assert trade_item["user_count"] == 1

    # 5. Rename trade with automatic cascade
    renamed_trade = "TEST-ELEC-RENAMED"
    res = await client.put(f"/api/trades/{test_trade}", json={
        "name": renamed_trade,
        "description": "Updated electrical description",
        "color": "#a855f7"
    }, headers=admin_headers)
    assert res.status_code == 200
    updated = res.json()
    assert updated["name"] == renamed_trade
    assert updated["description"] == "Updated electrical description"
    assert updated["color"] == "#a855f7"
    assert updated["user_count"] == 1

    # Verify user's trade cascaded to renamed_trade
    users_res = await client.get("/api/users", headers=admin_headers)
    user_obj = next((u for u in users_res.json() if u["id"] == created_user_id), None)
    assert user_obj is not None
    assert user_obj["trade"] == renamed_trade

    # 6. Delete trade with reassignment
    target_trade = "Electrical"
    del_res = await client.request("DELETE", f"/api/trades/{renamed_trade}", json={"reassign_to": target_trade}, headers=admin_headers)
    assert del_res.status_code == 200

    # Verify user's trade was reassigned to target_trade
    users_res = await client.get("/api/users", headers=admin_headers)
    user_obj = next((u for u in users_res.json() if u["id"] == created_user_id), None)
    assert user_obj is not None
    assert user_obj["trade"] == target_trade

    # Clean up test user
    await client.delete(f"/api/users/{created_user_id}", headers=admin_headers)
