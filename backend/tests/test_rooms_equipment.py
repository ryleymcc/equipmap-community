import pytest
from httpx import AsyncClient

@pytest.fixture
async def test_fp_id(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    site_data = {"name": "Room/Equip Site"}
    s_resp = await client.post("/api/sites", json=site_data, headers=headers)
    site_id = s_resp.json()["id"]

    files = {"file": ("test.svg", b"<svg></svg>", "image/svg+xml")}
    data = {"site_id": site_id, "name": "Room/Equip FP", "file_type": "svg"}
    f_resp = await client.post("/api/floorplans", data=data, files=files, headers=headers)
    return f_resp.json()["id"]

@pytest.mark.asyncio
async def test_room_lifecycle(client: AsyncClient, admin_token: str, test_fp_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create Room
    room_data = {"name": "Test Room", "floorplan_id": test_fp_id, "x_coordinate": 100, "y_coordinate": 100}
    response = await client.post("/api/rooms", json=room_data, headers=headers)
    assert response.status_code == 200
    room_id = response.json()["id"]

    # 2. List Rooms for FP
    response = await client.get(f"/api/floorplans/{test_fp_id}/rooms", headers=headers)
    assert response.status_code == 200
    assert any(r["id"] == room_id for r in response.json())

    # 3. Update Room
    update_data = {"name": "Updated Room"}
    response = await client.put(f"/api/rooms/{room_id}", json=update_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Room"

    # 4. Delete Room
    response = await client.delete(f"/api/rooms/{room_id}", headers=headers)
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_equipment_lifecycle(client: AsyncClient, admin_token: str, test_fp_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create Equipment
    equip_data = {"name": "Test Equip", "floorplan_id": test_fp_id, "x_coordinate": 200, "y_coordinate": 200}
    response = await client.post("/api/equipment", data=equip_data, headers=headers)
    assert response.status_code == 200
    equip_id = response.json()["id"]

    # 2. List Equipment for FP
    response = await client.get(f"/api/floorplans/{test_fp_id}/equipment", headers=headers)
    assert response.status_code == 200
    assert any(e["id"] == equip_id for e in response.json())

    # 3. Update Equipment
    update_data = {"name": "Updated Equip", "color": "#ff0000"}
    response = await client.put(f"/api/equipment/{equip_id}", data=update_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Equip"
    assert response.json()["color"] == "#ff0000"

    # 4. Delete Equipment
    response = await client.delete(f"/api/equipment/{equip_id}", headers=headers)
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_batch_import(client: AsyncClient, admin_token: str, test_fp_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}

    batch_data = {
        "floorplan_id": test_fp_id,
        "clear_existing": True,
        "items": [
            {"name": "Batch Room 1", "x_coordinate": 10, "y_coordinate": 10, "is_room": True},
            {"name": "Batch Equip 1", "x_coordinate": 20, "y_coordinate": 20, "is_room": False}
        ]
    }
    response = await client.post("/api/equipment/batch", json=batch_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["count"] == 2

    # Verify
    rooms = await client.get(f"/api/floorplans/{test_fp_id}/rooms", headers=headers)
    assert len(rooms.json()) == 1
    equip = await client.get(f"/api/floorplans/{test_fp_id}/equipment", headers=headers)
    assert len(equip.json()) == 1

@pytest.mark.asyncio
async def test_rooms_equipment_etag_and_304(client: AsyncClient, admin_token: str, test_fp_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Rooms ETag and 304
    response = await client.get(f"/api/floorplans/{test_fp_id}/rooms", headers=headers)
    assert response.status_code == 200
    etag_rooms = response.headers.get("etag")
    assert etag_rooms is not None

    headers_rooms = {**headers, "If-None-Match": etag_rooms}
    response_rooms_304 = await client.get(f"/api/floorplans/{test_fp_id}/rooms", headers=headers_rooms)
    assert response_rooms_304.status_code == 304
    assert response_rooms_304.text == ""

    # 2. Equipment ETag and 304
    response_eq = await client.get(f"/api/floorplans/{test_fp_id}/equipment", headers=headers)
    assert response_eq.status_code == 200
    etag_eq = response_eq.headers.get("etag")
    assert etag_eq is not None

    headers_eq = {**headers, "If-None-Match": etag_eq}
    response_eq_304 = await client.get(f"/api/floorplans/{test_fp_id}/equipment", headers=headers_eq)
    assert response_eq_304.status_code == 304
    assert response_eq_304.text == ""
