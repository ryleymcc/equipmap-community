import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_site_lifecycle(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create
    site_data = {"name": "Test Site", "description": "Desc", "location": "Loc"}
    response = await client.post("/api/sites", json=site_data, headers=headers)
    assert response.status_code == 200
    site_id = response.json()["id"]

    # 2. Read
    response = await client.get("/api/sites", headers=headers)
    assert response.status_code == 200
    assert any(s["id"] == site_id for s in response.json())

    # 3. Update
    update_data = {"name": "Updated Site"}
    response = await client.put(f"/api/sites/{site_id}", json=update_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Site"

    # 4. Delete
    response = await client.delete(f"/api/sites/{site_id}", headers=headers)
    assert response.status_code == 200

    # 5. Verify
    response = await client.get("/api/sites", headers=headers)
    assert not any(s["id"] == site_id for s in response.json())

@pytest.mark.asyncio
async def test_site_permissions(client: AsyncClient, viewer_token: str):
    headers = {"Authorization": f"Bearer {viewer_token}"}

    # Viewer should be able to read
    response = await client.get("/api/sites", headers=headers)
    assert response.status_code == 200

    # Viewer should NOT be able to create
    site_data = {"name": "Fail Site"}
    response = await client.post("/api/sites", json=site_data, headers=headers)
    assert response.status_code == 403

@pytest.mark.asyncio
async def test_sites_etag_and_304(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Get sites list
    response = await client.get("/api/sites", headers=headers)
    assert response.status_code == 200
    etag = response.headers.get("etag")
    assert etag is not None

    # 304 match
    headers_with_etag = {**headers, "If-None-Match": etag}
    response_304 = await client.get("/api/sites", headers=headers_with_etag)
    assert response_304.status_code == 304
    assert response_304.text == ""

@pytest.mark.asyncio
async def test_site_cascade_deletion(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create site
    res = await client.post("/api/sites", json={"name": "Cascade Test Site"}, headers=headers)
    assert res.status_code == 200
    site_id = res.json()["id"]

    # 2. Create floorplan under site
    fp_res = await client.post(
        "/api/floorplans",
        data={"site_id": site_id, "name": "Cascade FP"},
        files={"file": ("test.svg", b"<svg></svg>", "image/svg+xml")},
        headers=headers
    )
    assert fp_res.status_code == 200
    fp_id = fp_res.json()["id"]

    # 3. Add room and equipment under floorplan
    room_res = await client.post("/api/rooms", json={"floorplan_id": fp_id, "name": "Room 101"}, headers=headers)
    assert room_res.status_code == 200
    room_id = room_res.json()["id"]

    equip_res = await client.post("/api/equipment", data={"floorplan_id": fp_id, "name": "Pump A"}, headers=headers)
    assert equip_res.status_code == 200
    equip_id = equip_res.json()["id"]

    # 4. Delete the site
    del_res = await client.delete(f"/api/sites/{site_id}", headers=headers)
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "success"

    # 5. Verify site, floorplan, room, equipment are deleted
    assert (await client.get(f"/api/floorplans/{fp_id}", headers=headers)).status_code == 404
    all_rooms = (await client.get("/api/rooms", headers=headers)).json()
    assert not any(r["id"] == room_id for r in all_rooms)
    all_equip = (await client.get("/api/equipment", headers=headers)).json()
    assert not any(e["id"] == equip_id for e in all_equip)

@pytest.mark.asyncio
async def test_editor_can_delete_site(client: AsyncClient, editor_token: str):
    headers = {"Authorization": f"Bearer {editor_token}"}

    # Editor creates site
    res = await client.post("/api/sites", json={"name": "Editor Site"}, headers=headers)
    assert res.status_code == 200
    site_id = res.json()["id"]

    # Editor updates site name
    up_res = await client.put(f"/api/sites/{site_id}", json={"name": "Editor Site Renamed"}, headers=headers)
    assert up_res.status_code == 200
    assert up_res.json()["name"] == "Editor Site Renamed"

    # Editor deletes site
    del_res = await client.delete(f"/api/sites/{site_id}", headers=headers)
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "success"
