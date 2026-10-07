import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_search(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create something to search for
    site_data = {"name": "Search Site"}
    s_resp = await client.post("/api/sites", json=site_data, headers=headers)
    site_id = s_resp.json()["id"]

    files = {"file": ("test.svg", b"<svg></svg>", "image/svg+xml")}
    data = {"site_id": site_id, "name": "Search FP", "file_type": "svg"}
    f_resp = await client.post("/api/floorplans", data=data, files=files, headers=headers)
    fp_id = f_resp.json()["id"]

    room_data = {"name": "UniqueRoomName", "floorplan_id": fp_id, "x_coordinate": 10, "y_coordinate": 10}
    await client.post("/api/rooms", json=room_data, headers=headers)

    # 2. Search
    response = await client.get("/api/search?q=Unique", headers=headers)
    assert response.status_code == 200
    results = response.json()
    assert any(r["name"] == "UniqueRoomName" for r in results)

    etag = response.headers.get("etag")
    assert etag is not None

    # 304 match
    headers_with_etag = {**headers, "If-None-Match": etag}
    response_304 = await client.get("/api/search?q=Unique", headers=headers_with_etag)
    assert response_304.status_code == 304
    assert response_304.text == ""
