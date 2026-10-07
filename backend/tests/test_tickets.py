import pytest
from httpx import AsyncClient

@pytest.fixture
async def test_fp_id(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    site_data = {"name": "Ticket Site"}
    s_resp = await client.post("/api/sites", json=site_data, headers=headers)
    site_id = s_resp.json()["id"]

    files = {"file": ("test.svg", b"<svg></svg>", "image/svg+xml")}
    data = {"site_id": site_id, "name": "Ticket FP", "file_type": "svg"}
    f_resp = await client.post("/api/floorplans", data=data, files=files, headers=headers)
    return f_resp.json()["id"]

@pytest.mark.asyncio
async def test_ticket_lifecycle(client: AsyncClient, admin_token: str, test_fp_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create Ticket
    ticket_data = {
        "title": "Test Ticket",
        "description": "Desc",
        "floorplan_id": test_fp_id,
        "x_coordinate": 50,
        "y_coordinate": 50
    }
    response = await client.post("/api/tickets", json=ticket_data, headers=headers)
    assert response.status_code == 200
    ticket_id = response.json()["id"]

    # 2. List Tickets
    response = await client.get("/api/tickets", headers=headers)
    assert response.status_code == 200
    assert any(t["id"] == ticket_id for t in response.json())

    # 3. Update Ticket
    update_data = {"status": "resolved"}
    response = await client.put(f"/api/tickets/{ticket_id}", json=update_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "resolved"

    # 4. Delete Ticket
    response = await client.delete(f"/api/tickets/{ticket_id}", headers=headers)
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_tickets_etag_and_304(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Get tickets list
    response = await client.get("/api/tickets", headers=headers)
    assert response.status_code == 200
    etag = response.headers.get("etag")
    assert etag is not None

    # 304 match
    headers_with_etag = {**headers, "If-None-Match": etag}
    response_304 = await client.get("/api/tickets", headers=headers_with_etag)
    assert response_304.status_code == 304
    assert response_304.text == ""
