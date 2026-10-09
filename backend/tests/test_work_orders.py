import pytest
from httpx import AsyncClient
from datetime import datetime, timedelta, timezone
from sqlalchemy import event
import models

@pytest.fixture
async def test_fp_and_entities(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create Site
    s_resp = await client.post("/api/sites", json={"name": "WO Test Hospital", "location": "Winnipeg"}, headers=headers)
    assert s_resp.status_code == 200
    site_id = s_resp.json()["id"]

    # 2. Create Floorplan
    files = {"file": ("test.svg", b"<svg></svg>", "image/svg+xml")}
    data = {"site_id": site_id, "name": "Ground Floor", "file_type": "svg"}
    f_resp = await client.post("/api/floorplans", data=data, files=files, headers=headers)
    assert f_resp.status_code == 200
    fp_id = f_resp.json()["id"]

    # 3. Create Rooms
    r1_resp = await client.post("/api/rooms", json={"floorplan_id": fp_id, "name": "101", "description": "Exam Room", "x_coordinate": 100.0, "y_coordinate": 150.0}, headers=headers)
    assert r1_resp.status_code == 200
    r1_id = r1_resp.json()["id"]

    r2_resp = await client.post("/api/rooms", json={"floorplan_id": fp_id, "name": "102", "description": "X-Ray Room", "x_coordinate": 200.0, "y_coordinate": 250.0}, headers=headers)
    assert r2_resp.status_code == 200
    r2_id = r2_resp.json()["id"]

    # 4. Create Equipment
    e1_resp = await client.post("/api/equipment", data={"floorplan_id": fp_id, "name": "AHU-1", "description": "Air Handler", "x_coordinate": 120.0, "y_coordinate": 160.0}, headers=headers)
    assert e1_resp.status_code == 200
    e1_id = e1_resp.json()["id"]

    return {
        "site_id": site_id,
        "floorplan_id": fp_id,
        "room_ids": [r1_id, r2_id],
        "equipment_ids": [e1_id]
    }

import uuid

@pytest.fixture
async def triage_tech_user(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    uname = f"triagetech_{uuid.uuid4().hex[:6]}"
    u_resp = await client.post("/api/users", json={
        "username": uname,
        "password": "password123",
        "role": "technician",
        "can_triage": True,
        "can_create_work_orders": True,
        "can_close_work_orders": True,
        "is_active": True
    }, headers=headers)
    assert u_resp.status_code == 200
    user_id = u_resp.json()["id"]

    login_resp = await client.post("/api/token", data={"username": uname, "password": "password123"})
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    return {"id": user_id, "username": uname, "token": token}

@pytest.mark.asyncio
async def test_public_work_order_submission(client: AsyncClient, test_fp_and_entities: dict):
    env = test_fp_and_entities

    # Unauthenticated public submission with custom IP and User-Agent headers
    headers = {
        "X-Forwarded-For": "198.51.100.42",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
    payload = {
        "title": "Water leak in ceiling",
        "description": "Dripping near light fixture",
        "category": "Plumbing",
        "priority": "high",
        "location_type": "room",
        "room_ids": [env["room_ids"][0]],
        "requester_name": "Nurse Jackie",
        "requester_email": "jackie@hospital.org",
        "requester_phone": "204-555-0199",
        "device_details": "Desktop • 1920x1080 • America/New_York"
    }

    res = await client.post("/api/work-orders/public", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()

    assert data["order_number"].startswith("WO-")
    assert data["title"] == "Water leak in ceiling"
    assert data["category"] == "Plumbing"
    assert data["priority"] == "high"
    assert data["status"] == "pending_triage"
    assert data["floorplan_id"] == env["floorplan_id"]
    assert len(data["rooms"]) == 1
    assert data["rooms"][0]["id"] == env["room_ids"][0]
    assert data["requester_name"] == "Nurse Jackie"
    assert data["ip_address"] == "198.51.100.42"
    assert "Chrome 122" in (data["device_details"] or "")
    assert "Windows 10/11" in (data["device_details"] or "")
    assert "1920x1080" in (data["device_details"] or "")
    assert data["user_agent"] == headers["User-Agent"]

@pytest.mark.asyncio
async def test_authenticated_direct_creation_multi_location(
    client: AsyncClient, admin_token: str, triage_tech_user: dict, test_fp_and_entities: dict
):
    headers = {"Authorization": f"Bearer {admin_token}"}
    env = test_fp_and_entities

    payload = {
        "title": "HVAC Filter Replacement",
        "description": "Replace HEPA filters across exam rooms",
        "category": "HVAC",
        "priority": "medium",
        "status": "assigned",
        "location_type": "multi",
        "room_ids": env["room_ids"],
        "equipment_ids": env["equipment_ids"],
        "assigned_user_ids": [triage_tech_user["id"]],
        "estimated_hours": 2.0
    }

    res = await client.post("/api/work-orders", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()

    assert data["status"] == "assigned"
    assert len(data["assignees"]) == 1
    assert data["assignees"][0]["username"] == triage_tech_user["username"]
    assert len(data["rooms"]) == 2
    assert len(data["equipment"]) == 1
    assert data["estimated_hours"] == 2.0


@pytest.mark.asyncio
async def test_task_type_is_serialized_separately_from_task_sheet(
    client: AsyncClient, admin_token: str
):
    headers = {"Authorization": f"Bearer {admin_token}"}
    type_res = await client.post("/api/task-types", json={
        "code": f"TYPE-{uuid.uuid4().hex[:8]}",
        "name": "Temperature control repair/service",
        "category": "HVAC",
        "priority": "high",
        "trade": "General Maintenance",
        "is_active": True,
        "task_sheet_id": None,
    }, headers=headers)
    assert type_res.status_code == 200
    task_type = type_res.json()

    create_res = await client.post("/api/work-orders", json={
        "title": "Procedure room temperature is high",
        "category": task_type["category"],
        "priority": task_type["priority"],
        "trade": task_type["trade"],
        "task_type_id": task_type["id"],
    }, headers=headers)
    assert create_res.status_code == 200
    work_order = create_res.json()

    assert work_order["task_type_id"] == task_type["id"]
    assert work_order["task_type_code"] == task_type["code"]
    assert work_order["task_type_name"] == task_type["name"]
    assert work_order["task_sheet_id"] is None
    assert work_order["task_code"] is None
    assert work_order["task_description"] is None
    assert work_order["task_sheet"] is None

@pytest.mark.asyncio
async def test_triage_permission_enforcement(
    client: AsyncClient, viewer_token: str, triage_tech_user: dict, admin_token: str, test_fp_and_entities: dict
):
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}
    tech_headers = {"Authorization": f"Bearer {triage_tech_user['token']}"}

    # 1. Create pending triage work order
    pub_res = await client.post("/api/work-orders/public", json={
        "title": "Flickering fluorescent lamp",
        "category": "Lighting",
        "priority": "low"
    })
    wo_id = pub_res.json()["id"]

    # 2. Standard viewer (no can_triage) tries to triage -> 403
    triage_payload = {
        "status": "assigned",
        "assigned_user_ids": [triage_tech_user["id"]],
        "priority": "medium"
    }
    fail_res = await client.put(f"/api/work-orders/{wo_id}", json=triage_payload, headers=viewer_headers)
    assert fail_res.status_code == 403

    # 3. Designated triage user tries to triage -> 200 OK
    tech_res = await client.put(f"/api/work-orders/{wo_id}", json=triage_payload, headers=tech_headers)
    assert tech_res.status_code == 200
    updated_data = tech_res.json()
    assert updated_data["status"] == "assigned"
    assert updated_data["priority"] == "medium"
    assert updated_data["triaged_by_username"] == triage_tech_user["username"]
    assert len(updated_data["assignees"]) == 1

@pytest.mark.asyncio
async def test_labor_logging_and_comments_without_closing(
    client: AsyncClient, triage_tech_user: dict, admin_token: str
):
    headers = {"Authorization": f"Bearer {triage_tech_user['token']}"}

    # 0. Create a pending_triage public work order and verify adding labor is rejected
    pending_wo_res = await client.post("/api/work-orders/public", json={
        "title": "Un-triaged diagnostic",
        "category": "HVAC",
    })
    pending_wo_id = pending_wo_res.json()["id"]

    fail_labor = await client.post(f"/api/work-orders/{pending_wo_id}/labor", json={
        "hours": 1.0,
        "comment": "Tried logging before triage"
    }, headers=headers)
    assert fail_labor.status_code == 400
    assert "triaged" in fail_labor.json()["detail"].lower()

    # Create work order in assigned status
    create_res = await client.post("/api/work-orders", json={
        "title": "Air compressor diagnostic",
        "category": "HVAC",
        "assigned_user_ids": [triage_tech_user["id"]]
    }, headers=headers)
    wo_id = create_res.json()["id"]

    # 1. Log 1.5 hours labor without closing
    l1_res = await client.post(f"/api/work-orders/{wo_id}/labor", json={
        "hours": 1.5,
        "comment": "Checked pressure valves and belts"
    }, headers=headers)
    assert l1_res.status_code == 200
    assert l1_res.json()["hours"] == 1.5

    # 2. Log another 0.75 hours labor
    l2_res = await client.post(f"/api/work-orders/{wo_id}/labor", json={
        "hours": 0.75,
        "comment": "Replaced O-ring and tested seal"
    }, headers=headers)
    assert l2_res.status_code == 200

    # 3. Add comment
    c_res = await client.post(f"/api/work-orders/{wo_id}/comments", json={
        "comment": "Part ordered from supplier, arriving tomorrow."
    }, headers=headers)
    assert c_res.status_code == 200

    # 4. Fetch work order details -> actual_hours should be 2.25 and status in_progress
    get_res = await client.get(f"/api/work-orders/{wo_id}", headers=headers)
    assert get_res.status_code == 200
    wo_data = get_res.json()
    assert wo_data["actual_hours"] == 2.25
    assert wo_data["status"] == "in_progress" # Auto moved to in_progress on labor logging
    assert len(wo_data["labor_entries"]) == 2
    assert len(wo_data["comments"]) == 1

    # 5. Close work order
    close_res = await client.post(f"/api/work-orders/{wo_id}/close", json={
        "completion_notes": "Completed and fully operational"
    }, headers=headers)
    assert close_res.status_code == 200
    assert close_res.json()["status"] == "completed"
    assert close_res.json()["completed_at"] is not None

@pytest.mark.asyncio
async def test_pm_schedule_generator_and_trigger(
    client: AsyncClient, admin_token: str, triage_tech_user: dict, test_fp_and_entities: dict
):
    headers = {"Authorization": f"Bearer {admin_token}"}
    env = test_fp_and_entities

    # 1. Create PM Schedule
    pm_payload = {
        "title": "Quarterly HVAC Inspection",
        "description": "Inspect fan belts, bearings, and motor amperage",
        "category": "HVAC",
        "priority": "medium",
        "cron_expression": "0 0 1 */3 *",
        "site_id": env["site_id"],
        "floorplan_id": env["floorplan_id"],
        "equipment_ids": env["equipment_ids"],
        "assigned_user_ids": [triage_tech_user["id"]],
        "estimated_hours": 3.0
    }

    pm_res = await client.post("/api/pm-schedules", json=pm_payload, headers=headers)
    assert pm_res.status_code == 200
    pm_data = pm_res.json()
    pm_id = pm_data["id"]
    assert pm_data["next_run_at"] is not None
    assert len(pm_data["assignees"]) == 1

    # 2. Trigger PM Schedule manually
    trigger_res = await client.post(f"/api/pm-schedules/{pm_id}/trigger", headers=headers)
    assert trigger_res.status_code == 200
    gen_wo = trigger_res.json()
    assert gen_wo["title"] == "Quarterly HVAC Inspection"
    assert gen_wo["status"] == "assigned"
    assert len(gen_wo["assignees"]) == 1
    assert gen_wo["assignees"][0]["username"] == triage_tech_user["username"]
    assert len(gen_wo["equipment"]) == 1

    # 3. Check Due PM Schedules endpoint
    check_res = await client.post("/api/pm-schedules/check-due", headers=headers)
    assert check_res.status_code == 200
    assert "due_count" in check_res.json()


@pytest.mark.asyncio
async def test_structured_pm_preview_creation_and_manual_snapshot(
    client: AsyncClient, admin_token: str, test_fp_and_entities: dict
):
    headers = {"Authorization": f"Bearer {admin_token}"}
    recurrence_rule = {
        "frequency": "weekly", "interval": 2, "start_date": "2030-01-07",
        "time_of_day": "08:30", "timezone": "America/Chicago",
        "weekly_days": ["MO", "TH"], "non_working_day_rule": "none",
        "due_after_issued_days": 4, "end_rule": "never",
    }
    preview = await client.post("/api/pm-schedules/preview", json={
        "recurrence_version": 1, "recurrence_rule": recurrence_rule, "count": 3,
    }, headers=headers)
    assert preview.status_code == 200
    assert len(preview.json()["occurrences"]) == 3
    assert "Every 2 weeks" in preview.json()["summary"]

    created = await client.post("/api/pm-schedules", json={
        "title": "Structured PM", "recurrence_version": 1, "recurrence_rule": recurrence_rule,
        "site_id": test_fp_and_entities["site_id"],
        "checklist_items": [{"task": "Inspect belt", "required": True}],
    }, headers=headers)
    assert created.status_code == 200
    schedule = created.json()
    assert schedule["timezone"] == "America/Chicago"
    original_next = schedule["next_run_at"]

    triggered = await client.post(f"/api/pm-schedules/{schedule['id']}/trigger", headers=headers)
    assert triggered.status_code == 200
    work_order = triggered.json()
    assert work_order["pm_schedule_id"] == schedule["id"]
    assert work_order["pm_scheduled_for"] is None
    assert work_order["checklist_items"][0]["task"] == "Inspect belt"
    assert work_order["due_date"] is not None

    listed = await client.get("/api/pm-schedules", headers=headers)
    refreshed = next(item for item in listed.json() if item["id"] == schedule["id"])
    assert refreshed["next_run_at"] == original_next


@pytest.mark.asyncio
async def test_invalid_pm_schedules_rejected(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    invalid_cron = await client.post("/api/pm-schedules", json={
        "title": "Bad cron", "cron_expression": "not a cron",
    }, headers=headers)
    assert invalid_cron.status_code == 422
    invalid_rule = await client.post("/api/pm-schedules/preview", json={
        "recurrence_version": 1,
        "recurrence_rule": {"frequency": "weekly", "start_date": "bad"},
    }, headers=headers)
    assert invalid_rule.status_code == 422


@pytest.mark.asyncio
async def test_automated_pm_generation_sets_due_and_source_metadata(
    client: AsyncClient, admin_token: str, db_session
):
    headers = {"Authorization": f"Bearer {admin_token}"}
    nominal = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    recurrence_rule = {
        "frequency": "daily", "interval": 1, "start_date": nominal.isoformat(),
        "time_of_day": "00:00", "timezone": "UTC", "non_working_day_rule": "none",
        "due_after_issued_days": 2, "end_rule": "never",
    }
    created = await client.post("/api/pm-schedules", json={
        "title": "Due structured PM", "recurrence_version": 1, "recurrence_rule": recurrence_rule,
        "checklist_items": [{"task": "Verify guard"}],
    }, headers=headers)
    assert created.status_code == 200
    schedule_id = created.json()["id"]
    schedule = await db_session.get(models.PMSchedule, schedule_id)
    schedule.next_run_at = datetime.combine(nominal, datetime.min.time(), timezone.utc)
    await db_session.commit()

    dispatched = await client.post("/api/pm-schedules/check-due", headers=headers)
    assert dispatched.status_code == 200
    assert dispatched.json()["due_count"] == 1
    listed = await client.get("/api/work-orders", headers=headers)
    generated = next(item for item in listed.json()["data"] if item["pm_schedule_id"] == schedule_id)
    assert generated["pm_scheduled_for"].startswith(nominal.isoformat())
    assert generated["due_date"].startswith((nominal + timedelta(days=2)).isoformat())
    assert generated["checklist_items"] == [{"task": "Verify guard"}]


@pytest.mark.asyncio
async def test_pm_endpoints_require_authentication(client: AsyncClient):
    assert (await client.get("/api/pm-schedules")).status_code == 401
    assert (await client.get(
        "/api/pm-schedules/calendar",
        params={"start": "2030-02-01T00:00:00Z", "end": "2030-03-01T00:00:00Z"},
    )).status_code == 401
    assert (await client.post("/api/pm-schedules/preview", json={
        "recurrence_version": 1, "recurrence_rule": {},
    })).status_code == 401
    assert (await client.post("/api/pm-schedules/check-due")).status_code == 401


@pytest.mark.asyncio
async def test_pm_calendar_returns_active_occurrences_in_range(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    recurrence_rule = {
        "frequency": "daily", "interval": 7, "start_date": "2030-02-01",
        "time_of_day": "08:00", "timezone": "UTC", "non_working_day_rule": "none",
        "due_after_issued_days": 2, "end_rule": "after-count", "end_count": 2,
    }
    created = await client.post("/api/pm-schedules", json={
        "title": "Calendar PM", "recurrence_version": 1, "recurrence_rule": recurrence_rule,
        "trade": "HVAC", "priority": "high",
    }, headers=headers)
    assert created.status_code == 200

    response = await client.get("/api/pm-schedules/calendar", params={
        "start": "2030-02-01T00:00:00Z", "end": "2030-03-01T00:00:00Z",
    }, headers=headers)
    assert response.status_code == 200
    payload = response.json()
    occurrences = [
        item for item in payload["occurrences"]
        if item["schedule_id"] == created.json()["id"]
    ]
    assert len(occurrences) == 2
    assert occurrences[0]["title"] == "Calendar PM"
    assert occurrences[0]["trade"] == "HVAC"
    assert occurrences[0]["assignee_usernames"] == []
    assert occurrences[0]["issue_datetime"].startswith("2030-02-01T08:00:00")
    assert occurrences[0]["due_datetime"].startswith("2030-02-03T08:00:00")

    detail = await client.get(
        f"/api/pm-schedules/{created.json()['id']}",
        headers=headers,
    )
    assert detail.status_code == 200
    assert detail.json()["title"] == "Calendar PM"
    assert detail.json()["recurrence_rule"]["frequency"] == recurrence_rule["frequency"]
    assert detail.json()["recurrence_rule"]["start_date"] == recurrence_rule["start_date"]
    assert detail.json()["recurrence_rule"]["due_after_issued_days"] == 2

@pytest.mark.asyncio
async def test_work_order_pin_selection_and_floorplan_coordinates(
    client: AsyncClient, admin_token: str, test_fp_and_entities: dict
):
    headers = {"Authorization": f"Bearer {admin_token}"}
    env = test_fp_and_entities
    fp_id = env["floorplan_id"]
    site_id = env["site_id"]

    # 1. Public Work Order with dropped map pin coordinates (0..1000 scale)
    pin_payload = {
        "title": "Broken window latch",
        "description": "Second window from left entrance",
        "category": "Doors & Locks",
        "priority": "medium",
        "location_type": "pin",
        "site_id": site_id,
        "floorplan_id": fp_id,
        "x_coordinate": 485.5,
        "y_coordinate": 612.0,
        "location_details": "Near north wall window sill",
        "requester_name": "Dr. Sarah Adams",
        "requester_email": "sarah@hospital.org"
    }

    pub_res = await client.post("/api/work-orders/public", json=pin_payload)
    assert pub_res.status_code == 200
    wo_data = pub_res.json()
    assert wo_data["order_number"].startswith("WO-")
    assert wo_data["location_type"] == "pin"
    assert wo_data["floorplan_id"] == fp_id
    assert wo_data["site_id"] == site_id
    assert wo_data["x_coordinate"] == 485.5
    assert wo_data["y_coordinate"] == 612.0
    assert wo_data["location_details"] == "Near north wall window sill"
    wo_id = wo_data["id"]

    # 2. Query work orders filtered by floorplan_id
    fp_query_res = await client.get(f"/api/work-orders?floorplan_id={fp_id}", headers=headers)
    assert fp_query_res.status_code == 200
    fp_work_orders = fp_query_res.json()["data"]
    matching = [w for w in fp_work_orders if w["id"] == wo_id]
    assert len(matching) == 1
    assert matching[0]["x_coordinate"] == 485.5
    assert matching[0]["y_coordinate"] == 612.0

    # 3. Authenticated direct creation with pin coordinates
    direct_pin_payload = {
        "title": "Emergency exit light out",
        "category": "Lighting",
        "priority": "urgent",
        "status": "assigned",
        "location_type": "pin",
        "site_id": site_id,
        "floorplan_id": fp_id,
        "x_coordinate": 750.0,
        "y_coordinate": 220.0,
        "location_details": "Exit B stairwell header"
    }
    dir_res = await client.post("/api/work-orders", json=direct_pin_payload, headers=headers)
    assert dir_res.status_code == 200
    dir_data = dir_res.json()
    assert dir_data["location_type"] == "pin"
    assert dir_data["x_coordinate"] == 750.0
    assert dir_data["y_coordinate"] == 220.0
    assert dir_data["floorplan_id"] == fp_id

    # 4. Update / relocate pin coordinate
    update_res = await client.put(f"/api/work-orders/{dir_data['id']}", json={
        "x_coordinate": 765.0,
        "y_coordinate": 235.0
    }, headers=headers)
    assert update_res.status_code == 200
    assert update_res.json()["x_coordinate"] == 765.0
    assert update_res.json()["y_coordinate"] == 235.0


@pytest.mark.asyncio
async def test_work_order_history_route_is_not_captured_as_an_id(
    client: AsyncClient, admin_token: str, test_fp_and_entities: dict, db_session
):
    """Opening a room/equipment pin requests this static history endpoint."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    env = test_fp_and_entities
    room_id = env["room_ids"][0]

    create_res = await client.post("/api/work-orders/public", json={
        "title": "History route regression check",
        "location_type": "room",
        "room_ids": [room_id],
    })
    assert create_res.status_code == 200
    work_order_id = create_res.json()["id"]

    statements = []

    def capture_statement(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sync_engine = db_session.bind.sync_engine
    event.listen(sync_engine, "before_cursor_execute", capture_statement)
    try:
        history_res = await client.get(
            "/api/work-orders/history",
            params={"entity_type": "room", "entity_id": room_id, "entity_name": "101"},
            headers=headers
        )
    finally:
        event.remove(sync_engine, "before_cursor_execute", capture_statement)

    assert history_res.status_code == 200
    assert any(item["id"] == work_order_id for item in history_res.json()["data"])
    work_order_query = next(
        statement for statement in statements
        if statement.lstrip().startswith("SELECT work_orders.id")
    )
    assert "WHERE" in work_order_query
    assert "work_order_rooms" in work_order_query


@pytest.mark.asyncio
async def test_unauthenticated_work_order_access_rejected(
    client: AsyncClient, test_fp_and_entities: dict
):
    """Unauthenticated users cannot access work orders, history, or manage work orders."""
    assert (await client.get("/api/work-orders")).status_code == 401
    assert (await client.get("/api/work-orders/1")).status_code == 401
    assert (await client.get("/api/work-orders/history?entity_type=room&entity_id=1")).status_code == 401
    assert (await client.post("/api/work-orders", json={"title": "Test"})).status_code == 401
    assert (await client.put("/api/work-orders/1", json={"status": "completed"})).status_code == 401
    assert (await client.post("/api/work-orders/1/labor", json={"hours": 1.0})).status_code == 401
    assert (await client.post("/api/work-orders/1/close", json={})).status_code == 401
    assert (await client.delete("/api/work-orders/1")).status_code == 401


@pytest.mark.asyncio
async def test_work_order_assignee_status_synchronization(
    client: AsyncClient, admin_token: str, triage_tech_user: dict
):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create WO with assignees -> status is assigned
    res1 = await client.post("/api/work-orders", json={
        "title": "Fix water leak",
        "category": "Plumbing",
        "assigned_user_ids": [triage_tech_user["id"]]
    }, headers=headers)
    assert res1.status_code == 200
    wo1 = res1.json()
    assert wo1["status"] == "assigned"
    assert len(wo1["assignees"]) == 1

    # 2. Remove technician -> status automatically transitions to unassigned (never reverts to pending_triage)
    res2 = await client.put(f"/api/work-orders/{wo1['id']}", json={
        "assigned_user_ids": []
    }, headers=headers)
    assert res2.status_code == 200
    wo2 = res2.json()
    assert wo2["status"] == "unassigned"
    assert len(wo2["assignees"]) == 0

    # 3. Add technician back -> status automatically becomes assigned
    res3 = await client.put(f"/api/work-orders/{wo1['id']}", json={
        "assigned_user_ids": [triage_tech_user["id"]]
    }, headers=headers)
    assert res3.status_code == 200
    wo3 = res3.json()
    assert wo3["status"] == "assigned"
    assert len(wo3["assignees"]) == 1

    # 4. Create WO with status="assigned" but empty assignees -> status defaults to unassigned
    res4 = await client.post("/api/work-orders", json={
        "title": "Unassigned lighting task",
        "category": "Lighting",
        "status": "assigned",
        "assigned_user_ids": []
    }, headers=headers)
    assert res4.status_code == 200
    wo4 = res4.json()
    assert wo4["status"] == "unassigned"
    assert len(wo4["assignees"]) == 0


@pytest.mark.asyncio
async def test_work_order_start_date_auto_progression(
    client: AsyncClient, admin_token: str, triage_tech_user: dict
):
    headers = {"Authorization": f"Bearer {admin_token}"}
    past_start = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    future_start = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()

    # 1. Create WO with past start_date -> status automatically becomes in_progress
    res1 = await client.post("/api/work-orders", json={
        "title": "Immediate repair",
        "category": "Plumbing",
        "start_date": past_start,
        "assigned_user_ids": [triage_tech_user["id"]]
    }, headers=headers)
    assert res1.status_code == 200
    wo1 = res1.json()
    assert wo1["status"] == "in_progress"
    assert wo1["start_date"] is not None

    # 2. Create WO with future start_date -> status remains assigned
    res2 = await client.post("/api/work-orders", json={
        "title": "Scheduled maintenance",
        "category": "HVAC",
        "start_date": future_start,
        "assigned_user_ids": [triage_tech_user["id"]]
    }, headers=headers)
    assert res2.status_code == 200
    wo2 = res2.json()
    assert wo2["status"] == "assigned"

    # 3. Update future WO's start_date to past -> auto-promotes to in_progress
    res3 = await client.put(f"/api/work-orders/{wo2['id']}", json={
        "start_date": past_start
    }, headers=headers)
    assert res3.status_code == 200
    wo3 = res3.json()
    assert wo3["status"] == "in_progress"


@pytest.mark.asyncio
async def test_work_order_edit_details_and_task_linking(
    client: AsyncClient, admin_token: str, triage_tech_user: dict
):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create a task template
    task_res = await client.post("/api/tasks", json={
        "code": "TASK-HVAC-99",
        "description": "Monthly AHU Filter Replacement",
        "category": "HVAC",
        "trade": "General Maintenance",
        "estimated_hours": 2.5,
        "pm_task_sheet": "1. Turn off disconnect.\n2. Replace air filters.\n3. Verify airflow.",
        "checklist_items": [
            {"id": "step-1", "task": "Check differential pressure", "type": "reading", "unit": "inWC"},
            {"id": "step-2", "task": "Replace pre-filters", "type": "checkbox", "required": True}
        ]
    }, headers=headers)
    assert task_res.status_code == 200
    task_data = task_res.json()
    task_id = task_data["id"]

    # 2. Create initial simple work order
    wo_create_res = await client.post("/api/work-orders", json={
        "title": "Initial Basic Work Order",
        "description": "Old description",
        "category": "General",
        "priority": "low"
    }, headers=headers)
    assert wo_create_res.status_code == 200
    wo = wo_create_res.json()
    wo_id = wo["id"]
    assert wo["task_id"] is None
    assert wo["trade"] is None

    # 3. Edit title, description, trade, and link the task template
    wo_update_res = await client.put(f"/api/work-orders/{wo_id}", json={
        "title": "Updated Filter Replacement Work Order",
        "description": "Updated maintenance scope with details.",
        "category": "HVAC",
        "trade": "General Maintenance",
        "priority": "high",
        "task_id": task_id,
        "checklist_items": task_data["checklist_items"],
        "estimated_hours": 2.5
    }, headers=headers)
    assert wo_update_res.status_code == 200
    updated_wo = wo_update_res.json()
    assert updated_wo["title"] == "Updated Filter Replacement Work Order"
    assert updated_wo["description"] == "Updated maintenance scope with details."
    assert updated_wo["category"] == "HVAC"
    assert updated_wo["trade"] == "General Maintenance"
    assert updated_wo["priority"] == "high"
    assert updated_wo["task_id"] == task_id
    assert updated_wo["task_description"] == "Monthly AHU Filter Replacement"
    assert len(updated_wo["checklist_items"]) == 2
    assert updated_wo["estimated_hours"] == 2.5

    # 4. Update checklist item status (complete step 1)
    checklist = updated_wo["checklist_items"]
    checklist[0]["completed"] = True
    checklist[0]["value"] = "0.45"
    wo_check_res = await client.put(f"/api/work-orders/{wo_id}", json={
        "checklist_items": checklist
    }, headers=headers)
    assert wo_check_res.status_code == 200
    checked_wo = wo_check_res.json()
    assert checked_wo["checklist_items"][0]["completed"] is True
    assert checked_wo["checklist_items"][0]["value"] == "0.45"

    # 5. Unlink task template (set task_id to None) and clear trade
    wo_unlink_res = await client.put(f"/api/work-orders/{wo_id}", json={
        "task_id": None,
        "trade": ""
    }, headers=headers)
    assert wo_unlink_res.status_code == 200
    unlinked_wo = wo_unlink_res.json()
    assert unlinked_wo["task_id"] is None
    assert unlinked_wo["trade"] is None


@pytest.mark.asyncio
async def test_work_order_labor_edit_and_delete_permissions(
    client: AsyncClient, admin_token: str, editor_token: str, viewer_token: str, test_fp_and_entities: dict
):
    """Technicians can edit and delete only their own labor entries, while admins can edit/delete all."""
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    editor_headers = {"Authorization": f"Bearer {editor_token}"}
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}

    # 1. Create and triage a work order
    wo_res = await client.post("/api/work-orders", json={
        "title": "HVAC Motor Repair",
        "category": "HVAC",
        "priority": "medium",
        "status": "in_progress"
    }, headers=admin_headers)
    assert wo_res.status_code == 200
    wo_id = wo_res.json()["id"]

    # 2. Log 2.0 hours as editor (technician)
    labor_res = await client.post(f"/api/work-orders/{wo_id}/labor", json={
        "hours": 2.0,
        "comment": "Replaced bearings"
    }, headers=editor_headers)
    assert labor_res.status_code == 200
    labor_id = labor_res.json()["id"]
    assert labor_res.json()["hours"] == 2.0

    # Verify actual_hours on work order
    wo_get = await client.get(f"/api/work-orders/{wo_id}", headers=editor_headers)
    assert wo_get.json()["actual_hours"] == 2.0

    # 3. Editor updates their own labor entry to 3.5 hours
    update_res = await client.put(f"/api/work-orders/{wo_id}/labor/{labor_id}", json={
        "hours": 3.5,
        "comment": "Replaced bearings and aligned shaft"
    }, headers=editor_headers)
    assert update_res.status_code == 200
    assert update_res.json()["hours"] == 3.5
    assert update_res.json()["comment"] == "Replaced bearings and aligned shaft"

    wo_get2 = await client.get(f"/api/work-orders/{wo_id}", headers=editor_headers)
    assert wo_get2.json()["actual_hours"] == 3.5

    # 4. Another user (viewer) tries to edit editor's labor -> 403 Forbidden
    unauthorized_update = await client.put(f"/api/work-orders/{wo_id}/labor/{labor_id}", json={
        "hours": 1.0,
        "comment": "Unauthorized edit"
    }, headers=viewer_headers)
    assert unauthorized_update.status_code == 403

    # 5. Admin updates the editor's labor entry -> succeeds
    admin_update = await client.put(f"/api/work-orders/{wo_id}/labor/{labor_id}", json={
        "hours": 4.0,
        "comment": "Adjusted after supervisor review"
    }, headers=admin_headers)
    assert admin_update.status_code == 200
    assert admin_update.json()["hours"] == 4.0

    wo_get3 = await client.get(f"/api/work-orders/{wo_id}", headers=admin_headers)
    assert wo_get3.json()["actual_hours"] == 4.0

    # 6. Another user (viewer) tries to delete editor's labor -> 403 Forbidden
    unauthorized_delete = await client.delete(f"/api/work-orders/{wo_id}/labor/{labor_id}", headers=viewer_headers)
    assert unauthorized_delete.status_code == 403

    # 7. Editor deletes their own labor entry -> succeeds
    delete_res = await client.delete(f"/api/work-orders/{wo_id}/labor/{labor_id}", headers=editor_headers)
    assert delete_res.status_code == 200

    # Verify labor entry is removed and work order actual_hours is updated to 0.0
    wo_get4 = await client.get(f"/api/work-orders/{wo_id}", headers=editor_headers)
    assert wo_get4.json()["actual_hours"] == 0.0
    assert len(wo_get4.json()["labor_entries"]) == 0


@pytest.mark.asyncio
async def test_work_order_comment_edit_and_delete_permissions(
    client: AsyncClient, admin_token: str, editor_token: str, viewer_token: str, test_fp_and_entities: dict
):
    """Technicians can edit and delete only their own comments, while admins can edit/delete all."""
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    editor_headers = {"Authorization": f"Bearer {editor_token}"}
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}

    # 1. Create a work order
    wo_res = await client.post("/api/work-orders", json={
        "title": "Chiller Inspection",
        "category": "HVAC",
        "priority": "medium",
        "status": "in_progress"
    }, headers=admin_headers)
    assert wo_res.status_code == 200
    wo_id = wo_res.json()["id"]

    # 2. Editor posts a comment
    comment_res = await client.post(f"/api/work-orders/{wo_id}/comments", json={
        "comment": "Found leaking gasket on valve #2"
    }, headers=editor_headers)
    assert comment_res.status_code == 200
    comment_id = comment_res.json()["id"]
    assert comment_res.json()["comment"] == "Found leaking gasket on valve #2"

    # 3. Editor updates their comment
    update_res = await client.put(f"/api/work-orders/{wo_id}/comments/{comment_id}", json={
        "comment": "Found leaking gasket on valve #2, replaced with silicone seal"
    }, headers=editor_headers)
    assert update_res.status_code == 200
    assert update_res.json()["comment"] == "Found leaking gasket on valve #2, replaced with silicone seal"

    # 4. Viewer tries to update editor's comment -> 403 Forbidden
    unauthorized_update = await client.put(f"/api/work-orders/{wo_id}/comments/{comment_id}", json={
        "comment": "Unauthorized change"
    }, headers=viewer_headers)
    assert unauthorized_update.status_code == 403

    # 5. Admin updates the editor's comment -> succeeds
    admin_update = await client.put(f"/api/work-orders/{wo_id}/comments/{comment_id}", json={
        "comment": "Supervisor approved repair with silicone seal"
    }, headers=admin_headers)
    assert admin_update.status_code == 200
    assert admin_update.json()["comment"] == "Supervisor approved repair with silicone seal"

    # 6. Viewer tries to delete editor's comment -> 403 Forbidden
    unauthorized_delete = await client.delete(f"/api/work-orders/{wo_id}/comments/{comment_id}", headers=viewer_headers)
    assert unauthorized_delete.status_code == 403

    # 7. Editor deletes their own comment -> succeeds
    delete_res = await client.delete(f"/api/work-orders/{wo_id}/comments/{comment_id}", headers=editor_headers)
    assert delete_res.status_code == 200

    # Verify comment list on work order
    wo_get = await client.get(f"/api/work-orders/{wo_id}", headers=editor_headers)
    assert len(wo_get.json()["comments"]) == 0

@pytest.mark.asyncio
async def test_bulk_work_order_operations(
    client: AsyncClient, admin_token: str, triage_tech_user: dict
):
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    tech_id = triage_tech_user["id"]

    # 1. Create 3 work orders
    wo_ids = []
    for i in range(3):
        res = await client.post("/api/work-orders", json={
            "title": f"Bulk Test Ticket {i+1}",
            "category": "Electrical",
            "priority": "low",
            "status": "unassigned"
        }, headers=admin_headers)
        assert res.status_code == 200
        wo_ids.append(res.json()["id"])

    assert len(wo_ids) == 3

    # 2. Bulk Assign to tech with trade, priority, and dispatch note
    assign_res = await client.post("/api/work-orders/bulk/assign", json={
        "ids": wo_ids,
        "assigned_user_ids": [tech_id],
        "trade": "Electrician",
        "priority": "high",
        "dispatch_note": "Batch dispatched for maintenance round"
    }, headers=admin_headers)
    assert assign_res.status_code == 200
    assert assign_res.json()["count"] == 3

    # Verify orders are assigned with updated priority and comments
    for wid in wo_ids:
        get_res = await client.get(f"/api/work-orders/{wid}", headers=admin_headers)
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["status"] == "assigned"
        assert data["trade"] == "Electrician"
        assert data["priority"] == "high"
        assert any(u["id"] == tech_id for u in data["assignees"])
        assert any(c["comment"] == "Batch dispatched for maintenance round" for c in data["comments"])

    # 3. Bulk Close 2 of the work orders with labor hours
    close_res = await client.post("/api/work-orders/bulk/close", json={
        "ids": wo_ids[:2],
        "hours": 1.5,
        "completion_notes": "Bulk completed during rounds"
    }, headers=admin_headers)
    assert close_res.status_code == 200
    assert close_res.json()["count"] == 2

    # Verify first 2 are completed and 3rd is still assigned
    wo1 = (await client.get(f"/api/work-orders/{wo_ids[0]}", headers=admin_headers)).json()
    wo2 = (await client.get(f"/api/work-orders/{wo_ids[1]}", headers=admin_headers)).json()
    wo3 = (await client.get(f"/api/work-orders/{wo_ids[2]}", headers=admin_headers)).json()

    assert wo1["status"] == "completed"
    assert wo1["actual_hours"] == 1.5
    assert wo1["completion_notes"] == "Bulk completed during rounds"
    assert wo2["status"] == "completed"
    assert wo3["status"] == "assigned"

    # 4. Bulk Delete all 3 work orders
    del_res = await client.post("/api/work-orders/bulk/delete", json={
        "ids": wo_ids
    }, headers=admin_headers)
    assert del_res.status_code == 200
    assert del_res.json()["count"] == 3

    # Verify they no longer exist
    for wid in wo_ids:
        missing_res = await client.get(f"/api/work-orders/{wid}", headers=admin_headers)
        assert missing_res.status_code == 404

def test_parse_device_details_telemetry():
    from utils import parse_device_details

    # Windows Chrome
    ua_win_chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    res1 = parse_device_details(ua_win_chrome, "Desktop • 1920x1080 • America/Chicago")
    assert "Chrome 122" in res1
    assert "Windows 10/11 (Desktop)" in res1
    assert "1920x1080" in res1
    assert "America/Chicago" in res1

    # iPhone Safari
    ua_iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
    res2 = parse_device_details(ua_iphone, "Mobile • 390x844 • America/New_York")
    assert "Safari 17" in res2
    assert "iOS 17.4 (iPhone)" in res2
    assert "390x844" in res2

    # Mac Firefox
    ua_mac_ff = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0"
    res3 = parse_device_details(ua_mac_ff)
    assert "Firefox 123 on macOS (Desktop)" in res3

    # Android Edge
    ua_android_edge = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36 EdgA/120.0.2210.141"
    res4 = parse_device_details(ua_android_edge)
    assert "Edge 120" in res4
    assert "Android 14 (Mobile)" in res4

@pytest.mark.asyncio
async def test_public_work_order_direct_and_proxy_ip(client: AsyncClient):
    # 1. Test CF-Connecting-IP
    cf_res = await client.post("/api/work-orders/public", json={
        "title": "Broken elevator button",
        "category": "General",
    }, headers={
        "CF-Connecting-IP": "203.0.113.88",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15"
    })
    assert cf_res.status_code == 200
    cf_data = cf_res.json()
    assert cf_data["ip_address"] == "203.0.113.88"
    assert "Safari 17 on macOS (Desktop)" in cf_data["device_details"]

    # 2. Test X-Real-IP
    real_res = await client.post("/api/work-orders/public", json={
        "title": "HVAC whistling noise",
        "category": "HVAC",
    }, headers={
        "X-Real-IP": "198.51.100.99",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0"
    })
    assert real_res.status_code == 200
    real_data = real_res.json()
    assert real_data["ip_address"] == "198.51.100.99"
    assert "Firefox 122 on Windows 10/11 (Desktop)" in real_data["device_details"]
