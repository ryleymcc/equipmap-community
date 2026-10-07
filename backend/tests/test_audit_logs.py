import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_audit_logs(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Trigger an action that logs
    site_data = {"name": "Audit Test Site"}
    await client.post("/api/sites", json=site_data, headers=headers)

    # 2. Check logs
    response = await client.get("/api/audit-logs", headers=headers)
    assert response.status_code == 200
    logs = response.json()
    assert len(logs) >= 1
    # Most recent log should have the admin_test username
    site_log = next((l for l in logs if l.get("target_type") == "site" and l.get("target_name") == "Audit Test Site"), None)
    assert site_log is not None
    assert site_log["username"] == "admin_test"
    assert site_log["user_id"] is not None

    etag = response.headers.get("etag")
    assert etag is not None

    # 304 match
    headers_with_etag = {**headers, "If-None-Match": etag}
    response_304 = await client.get("/api/audit-logs", headers=headers_with_etag)
    assert response_304.status_code == 304
    assert response_304.text == ""

    # 3. Undo (if applicable)
    log_id = site_log["id"]
    response = await client.post(f"/api/audit-logs/{log_id}/undo", headers=headers)
    assert response.status_code in [200, 400]

@pytest.mark.asyncio
async def test_undo_deleted_site_with_cascading_children(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create a complete site hierarchy
    site_res = await client.post("/api/sites", json={"name": "Hospital Main", "description": "Main Building", "location": "North Wing"}, headers=headers)
    assert site_res.status_code == 200
    site_id = site_res.json()["id"]

    fp_res = await client.post(
        "/api/floorplans",
        data={"site_id": site_id, "name": "Level 1"},
        files={"file": ("level1.svg", b"<svg><rect width='100' height='100'/></svg>", "image/svg+xml")},
        headers=headers
    )
    assert fp_res.status_code == 200
    fp_id = fp_res.json()["id"]

    room_res = await client.post("/api/rooms", json={"floorplan_id": fp_id, "name": "Room 101", "description": "ICU", "x_coordinate": 15.5, "y_coordinate": 25.5}, headers=headers)
    assert room_res.status_code == 200
    room_id = room_res.json()["id"]

    equip_res = await client.post("/api/equipment", data={
        "floorplan_id": fp_id,
        "name": "AHU-1",
        "description": "Air Handler Unit",
        "x_coordinate": 40.0,
        "y_coordinate": 60.0,
        "color": "#3b82f6",
        "tools_required": "Wrench"
    }, headers=headers)
    assert equip_res.status_code == 200
    equip_id = equip_res.json()["id"]

    ticket_res = await client.post("/api/tickets", json={
        "floorplan_id": fp_id,
        "title": "Leak Detected",
        "description": "Minor leak near AHU-1",
        "x_coordinate": 42.0,
        "y_coordinate": 62.0
    }, headers=headers)
    assert ticket_res.status_code == 200
    ticket_id = ticket_res.json()["id"]

    ref_res = await client.put(f"/api/floorplans/{fp_id}/reference-points", json={
        "points": [
            {"label": "A", "x_coordinate": 10.0, "y_coordinate": 10.0},
            {"label": "B", "x_coordinate": 90.0, "y_coordinate": 90.0}
        ]
    }, headers=headers)
    assert ref_res.status_code == 200

    # 2. Delete the site
    del_res = await client.delete(f"/api/sites/{site_id}", headers=headers)
    assert del_res.status_code == 200

    # Verify site & floorplan are gone
    assert (await client.get(f"/api/floorplans/{fp_id}", headers=headers)).status_code == 404
    sites = (await client.get("/api/sites", headers=headers)).json()
    assert not any(s["id"] == site_id for s in sites)

    # 3. Find the delete log entry
    logs_res = await client.get("/api/audit-logs", headers=headers)
    assert logs_res.status_code == 200
    logs = logs_res.json()
    delete_site_log = next(l for l in logs if l["action"] == "delete" and l["target_type"] == "site" and l["target_name"] == "Hospital Main")

    # 4. Undo the site deletion
    undo_res = await client.post(f"/api/audit-logs/{delete_site_log['id']}/undo", headers=headers)
    assert undo_res.status_code == 200
    assert "Restored" in undo_res.json()["message"]

    # 5. Verify entire hierarchy is fully restored with original IDs
    restored_sites = (await client.get("/api/sites", headers=headers)).json()
    restored_site = next((s for s in restored_sites if s["name"] == "Hospital Main"), None)
    assert restored_site is not None
    assert restored_site["id"] == site_id
    assert restored_site["description"] == "Main Building"

    fps_res = await client.get(f"/api/sites/{restored_site['id']}/floorplans", headers=headers)
    assert fps_res.status_code == 200
    fps = fps_res.json()
    assert len(fps) == 1
    restored_fp = fps[0]
    assert restored_fp["id"] == fp_id
    assert restored_fp["name"] == "Level 1"

    # Verify children on floorplan with original IDs
    fp_detail = (await client.get(f"/api/floorplans/{restored_fp['id']}", headers=headers)).json()
    assert len(fp_detail["rooms"]) == 1
    assert fp_detail["rooms"][0]["id"] == room_id
    assert fp_detail["rooms"][0]["name"] == "Room 101"
    assert fp_detail["rooms"][0]["description"] == "ICU"

    assert len(fp_detail["equipment"]) == 1
    assert fp_detail["equipment"][0]["id"] == equip_id
    assert fp_detail["equipment"][0]["name"] == "AHU-1"
    assert fp_detail["equipment"][0]["tools_required"] == "Wrench"

    assert len(fp_detail["tickets"]) == 1
    assert fp_detail["tickets"][0]["id"] == ticket_id
    assert fp_detail["tickets"][0]["title"] == "Leak Detected"

    assert len(fp_detail["reference_points"]) == 2

@pytest.mark.asyncio
async def test_undo_deleted_floorplan_with_cascading_children(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create site and floorplan
    site_res = await client.post("/api/sites", json={"name": "Site Beta"}, headers=headers)
    assert site_res.status_code == 200
    site_id = site_res.json()["id"]

    fp_res = await client.post(
        "/api/floorplans",
        data={"site_id": site_id, "name": "Basement"},
        files={"file": ("basement.svg", b"<svg></svg>", "image/svg+xml")},
        headers=headers
    )
    assert fp_res.status_code == 200
    fp_id = fp_res.json()["id"]

    r_res = await client.post("/api/rooms", json={"floorplan_id": fp_id, "name": "Boiler Room"}, headers=headers)
    assert r_res.status_code == 200
    room_id = r_res.json()["id"]

    eq_res = await client.post("/api/equipment", data={"floorplan_id": fp_id, "name": "Boiler 1"}, headers=headers)
    assert eq_res.status_code == 200
    equip_id = eq_res.json()["id"]

    # 2. Delete floorplan
    del_res = await client.delete(f"/api/floorplans/{fp_id}", headers=headers)
    assert del_res.status_code == 200

    # 3. Find delete floorplan log
    logs_res = await client.get("/api/audit-logs", headers=headers)
    delete_fp_log = next(l for l in logs_res.json() if l["action"] == "delete" and l["target_type"] == "floorplan" and l["target_name"] == "Basement")

    # 4. Undo delete floorplan
    undo_res = await client.post(f"/api/audit-logs/{delete_fp_log['id']}/undo", headers=headers)
    assert undo_res.status_code == 200

    # 5. Verify floorplan and rooms/equipment are restored with original IDs
    fps = (await client.get(f"/api/sites/{site_id}/floorplans", headers=headers)).json()
    assert any(f["name"] == "Basement" for f in fps)
    restored_fp = next(f for f in fps if f["name"] == "Basement")
    assert restored_fp["id"] == fp_id
    fp_detail = (await client.get(f"/api/floorplans/{restored_fp['id']}", headers=headers)).json()
    assert len(fp_detail["rooms"]) == 1
    assert fp_detail["rooms"][0]["id"] == room_id
    assert fp_detail["rooms"][0]["name"] == "Boiler Room"
    assert len(fp_detail["equipment"]) == 1
    assert fp_detail["equipment"][0]["id"] == equip_id
    assert fp_detail["equipment"][0]["name"] == "Boiler 1"

@pytest.mark.asyncio
async def test_undo_audit_log_permissions(client: AsyncClient, admin_token: str):
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create two technician users: tech_normal (can_undo_all_audit_logs=False) and tech_super (can_undo_all_audit_logs=True)
    await client.post("/api/users", json={
        "username": "tech_normal",
        "password": "password123",
        "role": "technician",
        "can_manage_items": True,
        "can_undo_all_audit_logs": False
    }, headers=admin_headers)

    await client.post("/api/users", json={
        "username": "tech_super",
        "password": "password123",
        "role": "technician",
        "can_manage_items": True,
        "can_undo_all_audit_logs": True
    }, headers=admin_headers)

    # Log in as tech_normal
    res_normal = await client.post("/api/token", data={"username": "tech_normal", "password": "password123"})
    normal_token = res_normal.json()["access_token"]
    normal_headers = {"Authorization": f"Bearer {normal_token}"}

    # Log in as tech_super
    res_super = await client.post("/api/token", data={"username": "tech_super", "password": "password123"})
    super_token = res_super.json()["access_token"]
    super_headers = {"Authorization": f"Bearer {super_token}"}

    # 2. Admin creates Site X and deletes it -> Audit Log by admin_test
    admin_site = (await client.post("/api/sites", json={"name": "Admin Site For Undo"}, headers=admin_headers)).json()
    await client.delete(f"/api/sites/{admin_site['id']}", headers=admin_headers)

    # tech_normal creates Site Y and deletes it -> Audit Log by tech_normal
    normal_site = (await client.post("/api/sites", json={"name": "Normal Tech Site"}, headers=normal_headers)).json()
    await client.delete(f"/api/sites/{normal_site['id']}", headers=normal_headers)

    # Get logs
    logs = (await client.get("/api/audit-logs", headers=admin_headers)).json()
    admin_del_log = next(l for l in logs if l["action"] == "delete" and l["target_name"] == "Admin Site For Undo")
    normal_del_log = next(l for l in logs if l["action"] == "delete" and l["target_name"] == "Normal Tech Site")

    # 3. tech_normal tries to undo admin's delete -> Forbidden (403)
    res = await client.post(f"/api/audit-logs/{admin_del_log['id']}/undo", headers=normal_headers)
    assert res.status_code == 403
    assert "permission" in res.json()["detail"].lower()

    # 4. tech_normal undos their OWN delete -> Success (200)
    res = await client.post(f"/api/audit-logs/{normal_del_log['id']}/undo", headers=normal_headers)
    assert res.status_code == 200

    # 5. tech_super (with can_undo_all_audit_logs=True) undos admin's delete -> Success (200)
    res = await client.post(f"/api/audit-logs/{admin_del_log['id']}/undo", headers=super_headers)
    assert res.status_code == 200

@pytest.mark.asyncio
async def test_undo_rescale_floorplan(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create site and floorplan with room
    site_res = await client.post("/api/sites", json={"name": "Rescale Test Site"}, headers=headers)
    assert site_res.status_code == 200
    site_id = site_res.json()["id"]

    fp_res = await client.post(
        "/api/floorplans",
        data={"site_id": site_id, "name": "Rescale Level"},
        files={"file": ("level.svg", b"<svg><rect width='100' height='100'/></svg>", "image/svg+xml")},
        headers=headers
    )
    assert fp_res.status_code == 200
    fp_id = fp_res.json()["id"]

    room_res = await client.post("/api/rooms", json={"floorplan_id": fp_id, "name": "Room A", "x_coordinate": 10.0, "y_coordinate": 20.0}, headers=headers)
    assert room_res.status_code == 200

    # 2. Rescale floorplan
    rescale_payload = {
        "scale_x": 2.0,
        "scale_y": 2.0,
        "origin_x": 0.0,
        "origin_y": 0.0,
        "offset_x": 5.0,
        "offset_y": 5.0
    }
    rescale_res = await client.post(f"/api/floorplans/{fp_id}/rescale", json=rescale_payload, headers=headers)
    assert rescale_res.status_code == 200

    # Verify scaled coordinates: (10 - 0) * 2 + 0 + 5 = 25.0, (20 - 0) * 2 + 0 + 5 = 45.0
    fp_after_scale = (await client.get(f"/api/floorplans/{fp_id}", headers=headers)).json()
    assert fp_after_scale["rooms"][0]["x_coordinate"] == 25.0
    assert fp_after_scale["rooms"][0]["y_coordinate"] == 45.0

    # 3. Find rescale audit log
    logs = (await client.get("/api/audit-logs", headers=headers)).json()
    rescale_log = next(l for l in logs if l["action"] == "rescale_floorplan" and l["target_id"] == fp_id)

    # 4. Undo rescale
    undo_res = await client.post(f"/api/audit-logs/{rescale_log['id']}/undo", headers=headers)
    assert undo_res.status_code == 200

    # Verify coordinates restored to 10.0 and 20.0
    fp_restored = (await client.get(f"/api/floorplans/{fp_id}", headers=headers)).json()
    assert fp_restored["rooms"][0]["x_coordinate"] == 10.0
    assert fp_restored["rooms"][0]["y_coordinate"] == 20.0
