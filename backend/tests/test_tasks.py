import pytest
from httpx import AsyncClient
from sqlalchemy import select

import models


@pytest.mark.asyncio
async def test_task_type_can_link_optional_task_sheet(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    sheet_response = await client.post("/api/tasks", json={
        "code": "SHEET-TYPE-LINK",
        "description": "Temperature control procedure",
        "pm_task_sheet": "1. Verify setpoint.\n2. Test control response.",
    }, headers=headers)
    assert sheet_response.status_code == 200

    type_response = await client.post("/api/task-types", json={
        "code": "HV-TYPE-LINK",
        "name": "Temperature control repair/service",
        "category": "HVAC",
        "priority": "medium",
        "trade": "General Maintenance",
        "task_sheet_id": sheet_response.json()["id"],
    }, headers=headers)
    assert type_response.status_code == 200
    assert type_response.json()["task_sheet_code"] == "SHEET-TYPE-LINK"

    listed = await client.get("/api/task-types", headers=headers)
    assert listed.status_code == 200
    created = next(item for item in listed.json() if item["code"] == "HV-TYPE-LINK")
    assert created["name"] == "Temperature control repair/service"
    assert created["task_sheet_name"] == "Temperature control procedure"


@pytest.mark.asyncio
async def test_task_categories_can_be_created_renamed_and_deactivated(
    client: AsyncClient, admin_token: str
):
    headers = {"Authorization": f"Bearer {admin_token}"}

    created = await client.post(
        "/api/tasks/categories",
        json={"name": "Generator maintenance", "description": "Generator inspections"},
        headers=headers,
    )
    assert created.status_code == 200
    assert created.json()["is_active"] is True

    task = await client.post(
        "/api/tasks",
        json={"description": "Inspect generator", "category": "Generator maintenance"},
        headers=headers,
    )
    assert task.status_code == 200

    renamed = await client.put(
        "/api/tasks/categories/Generator%20maintenance",
        json={"name": "Emergency generator maintenance"},
        headers=headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["task_count"] == 1

    updated_task = await client.get(f"/api/tasks/{task.json()['id']}", headers=headers)
    assert updated_task.json()["category"] == "Emergency generator maintenance"

    deactivated = await client.put(
        "/api/tasks/categories/Emergency%20generator%20maintenance",
        json={"is_active": False},
        headers=headers,
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    active_categories = await client.get(
        "/api/tasks/categories?include_inactive=false", headers=headers
    )
    assert active_categories.status_code == 200
    assert "Emergency generator maintenance" not in [item["name"] for item in active_categories.json()]
    assert {"General", "HVAC", "Safety"}.issubset(
        {item["name"] for item in active_categories.json()}
    )


@pytest.mark.asyncio
async def test_task_room_and_equipment_links_can_be_created_and_edited(
    client: AsyncClient, admin_token: str
):
    headers = {"Authorization": f"Bearer {admin_token}"}

    site_response = await client.post(
        "/api/sites", json={"name": "Task Link Test Site"}, headers=headers
    )
    assert site_response.status_code == 200
    site_id = site_response.json()["id"]

    floorplan_response = await client.post(
        "/api/floorplans",
        data={"site_id": site_id, "name": "Task Link Floor", "file_type": "svg"},
        files={"file": ("task-link-test.svg", b"<svg></svg>", "image/svg+xml")},
        headers=headers,
    )
    assert floorplan_response.status_code == 200
    floorplan_id = floorplan_response.json()["id"]

    room_response = await client.post(
        "/api/rooms",
        json={"floorplan_id": floorplan_id, "name": "Task Link Room"},
        headers=headers,
    )
    assert room_response.status_code == 200
    room_id = room_response.json()["id"]

    equipment_response = await client.post(
        "/api/equipment",
        data={"floorplan_id": floorplan_id, "name": "Task Link Pump"},
        headers=headers,
    )
    assert equipment_response.status_code == 200
    equipment_id = equipment_response.json()["id"]

    task_response = await client.post(
        "/api/tasks",
        json={
            "code": "TASK-LINK-TEST",
            "description": "Inspect linked pump",
            "room_ids": [room_id],
            "equipment_ids": [equipment_id],
        },
        headers=headers,
    )
    assert task_response.status_code == 200
    task = task_response.json()
    assert [room["id"] for room in task["rooms"]] == [room_id]
    assert [item["id"] for item in task["equipment"]] == [equipment_id]
    assert task["rooms"][0]["site_id"] == site_id
    assert task["equipment"][0]["floorplan_id"] == floorplan_id

    update_response = await client.put(
        f"/api/tasks/{task['id']}",
        json={"room_ids": []},
        headers=headers,
    )
    assert update_response.status_code == 200
    updated_task = update_response.json()
    assert updated_task["rooms"] == []
    assert [item["id"] for item in updated_task["equipment"]] == [equipment_id]

    list_response = await client.get("/api/tasks?search=TASK-LINK-TEST", headers=headers)
    assert list_response.status_code == 200
    listed_task = list_response.json()[0]
    assert listed_task["rooms"] == []
    assert [item["id"] for item in listed_task["equipment"]] == [equipment_id]
