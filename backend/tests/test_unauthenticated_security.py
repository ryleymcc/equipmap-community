import pytest
from httpx import AsyncClient

@pytest.fixture
async def test_fp_id(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    site_data = {"name": "Security Test Site"}
    s_resp = await client.post("/api/sites", json=site_data, headers=headers)
    site_id = s_resp.json()["id"]

    files = {"file": ("test.svg", b"<svg></svg>", "image/svg+xml")}
    data = {"site_id": site_id, "name": "Security Test FP", "file_type": "svg"}
    f_resp = await client.post("/api/floorplans", data=data, files=files, headers=headers)
    return f_resp.json()["id"]

@pytest.fixture
async def existing_room_id(client: AsyncClient, admin_token: str, test_fp_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = await client.post(
        "/api/rooms",
        json={"floorplan_id": test_fp_id, "name": "Room 101", "description": "Desc", "x_coordinate": 10, "y_coordinate": 10},
        headers=headers
    )
    return resp.json()["id"]

@pytest.fixture
async def existing_equipment_id(client: AsyncClient, admin_token: str, test_fp_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = await client.post(
        "/api/equipment",
        data={"floorplan_id": test_fp_id, "name": "AC Unit 1", "x_coordinate": 20, "y_coordinate": 20},
        headers=headers
    )
    return resp.json()["id"]

@pytest.fixture
async def existing_admin_ticket_id(client: AsyncClient, admin_token: str, test_fp_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = await client.post(
        "/api/tickets",
        json={"floorplan_id": test_fp_id, "title": "Admin Ticket", "description": "Admin Issue", "x_coordinate": 30, "y_coordinate": 30},
        headers=headers
    )
    return resp.json()["id"]

@pytest.mark.asyncio
async def test_unauthenticated_requests_are_blocked(
    client: AsyncClient, test_fp_id: int, existing_room_id: int, existing_equipment_id: int, existing_admin_ticket_id: int
):
    # 1. Rooms
    res = await client.post("/api/rooms", json={"floorplan_id": test_fp_id, "name": "Hack Room", "x_coordinate": 0, "y_coordinate": 0})
    assert res.status_code == 401

    res = await client.put(f"/api/rooms/{existing_room_id}", json={"name": "Hacked Room"})
    assert res.status_code == 401

    res = await client.delete(f"/api/rooms/{existing_room_id}")
    assert res.status_code == 401

    # 2. Equipment
    res = await client.post("/api/equipment", data={"floorplan_id": test_fp_id, "name": "Hack Equip", "x_coordinate": 0, "y_coordinate": 0})
    assert res.status_code == 401

    res = await client.put(f"/api/equipment/{existing_equipment_id}", data={"name": "Hacked Equip"})
    assert res.status_code == 401

    res = await client.delete(f"/api/equipment/{existing_equipment_id}")
    assert res.status_code == 401

    res = await client.put("/api/equipment/bulk", json={"ids": [existing_equipment_id], "description": "Hacked"})
    assert res.status_code == 401

    res = await client.post("/api/equipment/batch", json={"floorplan_id": test_fp_id, "equipment": [], "rooms": []})
    assert res.status_code == 401

    # 3. Tickets / Issues
    res = await client.post("/api/tickets", json={"floorplan_id": test_fp_id, "title": "Hack Ticket", "x_coordinate": 0, "y_coordinate": 0})
    assert res.status_code == 401

    res = await client.put(f"/api/tickets/{existing_admin_ticket_id}", json={"title": "Hacked Ticket"})
    assert res.status_code == 401

    res = await client.delete(f"/api/tickets/{existing_admin_ticket_id}")
    assert res.status_code == 401

    # 4. User profile / Auth endpoints
    res = await client.get("/api/users/me")
    assert res.status_code == 401

    res = await client.post("/api/refresh-token")
    assert res.status_code == 401

@pytest.mark.asyncio
async def test_viewer_permissions_and_ticket_ownership(
    client: AsyncClient, viewer_token: str, admin_token: str, test_fp_id: int, existing_room_id: int, existing_equipment_id: int, existing_admin_ticket_id: int
):
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Viewer cannot create / edit / delete rooms (403)
    res = await client.post("/api/rooms", json={"floorplan_id": test_fp_id, "name": "Viewer Room", "x_coordinate": 0, "y_coordinate": 0}, headers=viewer_headers)
    assert res.status_code == 403

    res = await client.put(f"/api/rooms/{existing_room_id}", json={"name": "Modified Room"}, headers=viewer_headers)
    assert res.status_code == 403

    res = await client.delete(f"/api/rooms/{existing_room_id}", headers=viewer_headers)
    assert res.status_code == 403

    # 2. Viewer cannot create / edit / delete equipment (403)
    res = await client.post("/api/equipment", data={"floorplan_id": test_fp_id, "name": "Viewer Equip", "x_coordinate": 0, "y_coordinate": 0}, headers=viewer_headers)
    assert res.status_code == 403

    res = await client.put(f"/api/equipment/{existing_equipment_id}", data={"name": "Modified Equip"}, headers=viewer_headers)
    assert res.status_code == 403

    res = await client.delete(f"/api/equipment/{existing_equipment_id}", headers=viewer_headers)
    assert res.status_code == 403

    # 3. Viewer CAN create their own ticket
    res = await client.post(
        "/api/tickets",
        json={"floorplan_id": test_fp_id, "title": "Viewer Created Ticket", "description": "Water leak", "x_coordinate": 15, "y_coordinate": 15},
        headers=viewer_headers
    )
    assert res.status_code == 200
    viewer_ticket_id = res.json()["id"]

    # 4. Viewer CAN update their own ticket
    res = await client.put(f"/api/tickets/{viewer_ticket_id}", json={"status": "resolved"}, headers=viewer_headers)
    assert res.status_code == 200
    assert res.json()["status"] == "resolved"

    # 5. Viewer CANNOT update admin's ticket (403)
    res = await client.put(f"/api/tickets/{existing_admin_ticket_id}", json={"status": "resolved"}, headers=viewer_headers)
    assert res.status_code == 403

    # 6. Viewer CANNOT delete admin's ticket (403)
    res = await client.delete(f"/api/tickets/{existing_admin_ticket_id}", headers=viewer_headers)
    assert res.status_code == 403

    # 7. Viewer CAN delete their own ticket
    res = await client.delete(f"/api/tickets/{viewer_ticket_id}", headers=viewer_headers)
    assert res.status_code == 200

@pytest.mark.asyncio
async def test_editor_permissions(
    client: AsyncClient, editor_token: str, test_fp_id: int, existing_admin_ticket_id: int
):
    editor_headers = {"Authorization": f"Bearer {editor_token}"}

    # Editor can create room
    res = await client.post("/api/rooms", json={"floorplan_id": test_fp_id, "name": "Editor Room", "x_coordinate": 5, "y_coordinate": 5}, headers=editor_headers)
    assert res.status_code == 200
    room_id = res.json()["id"]

    # Editor can edit room
    res = await client.put(f"/api/rooms/{room_id}", json={"name": "Editor Room Updated"}, headers=editor_headers)
    assert res.status_code == 200

    # Editor can delete room
    res = await client.delete(f"/api/rooms/{room_id}", headers=editor_headers)
    assert res.status_code == 200

    # Editor can update any ticket (even admin's)
    res = await client.put(f"/api/tickets/{existing_admin_ticket_id}", json={"description": "Updated by editor"}, headers=editor_headers)
    assert res.status_code == 200
