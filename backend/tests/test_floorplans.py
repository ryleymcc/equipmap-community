import pytest
from httpx import AsyncClient
import io

@pytest.fixture
async def test_site_id(client: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    site_data = {"name": "Floorplan Test Site"}
    response = await client.post("/api/sites", json=site_data, headers=headers)
    return response.json()["id"]

@pytest.mark.asyncio
async def test_floorplan_lifecycle(client: AsyncClient, admin_token: str, test_site_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Upload SVG
    files = {"file": ("test.svg", b"<svg><rect x='10' y='10' width='50' height='50' /></svg>", "image/svg+xml")}
    data = {"site_id": test_site_id, "name": "Test Floorplan", "file_type": "svg"}

    response = await client.post("/api/floorplans", data=data, files=files, headers=headers)
    assert response.status_code == 200
    floorplan_id = response.json()["id"]

    # 2. Get Floorplan Details
    response = await client.get(f"/api/floorplans/{floorplan_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Test Floorplan"

    # 3. List site floorplans
    response = await client.get(f"/api/sites/{test_site_id}/floorplans", headers=headers)
    assert response.status_code == 200
    assert any(f["id"] == floorplan_id for f in response.json())

    # 4. Update Floorplan
    update_data = {"name": "Updated Floorplan", "pin_size": 24}
    response = await client.put(f"/api/floorplans/{floorplan_id}", json=update_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Floorplan"
    assert response.json()["pin_size"] == 24

    # 5. Reference Points
    ref_points = {
        "points": [
            {"label": "A", "x_coordinate": 1.0, "y_coordinate": 2.0},
            {"label": "B", "x_coordinate": 3.0, "y_coordinate": 4.0}
        ]
    }
    response = await client.put(f"/api/floorplans/{floorplan_id}/reference-points", json=ref_points, headers=headers)
    assert response.status_code == 200

    response = await client.get(f"/api/floorplans/{floorplan_id}/reference-points", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 2

    # 6. Delete
    response = await client.delete(f"/api/floorplans/{floorplan_id}", headers=headers)
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_etag_and_304(client: AsyncClient, admin_token: str, test_site_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Upload floorplan
    files = {"file": ("test_etag.svg", b"<svg><rect x='10' y='10' width='50' height='50' /></svg>", "image/svg+xml")}
    data = {"site_id": test_site_id, "name": "ETag Test Floorplan", "file_type": "svg"}

    response = await client.post("/api/floorplans", data=data, files=files, headers=headers)
    assert response.status_code == 200
    floorplan_id = response.json()["id"]

    try:
        # 2. Get details first time (should return 200 and ETag)
        response1 = await client.get(f"/api/floorplans/{floorplan_id}", headers=headers)
        assert response1.status_code == 200
        etag = response1.headers.get("etag")
        assert etag is not None

        # 3. Get details with matching ETag (should return 304)
        headers_with_etag = {**headers, "If-None-Match": etag}
        response2 = await client.get(f"/api/floorplans/{floorplan_id}", headers=headers_with_etag)
        assert response2.status_code == 304
        assert response2.text == "" # No body for 304 response

        # 4. Get details with matching weak ETag format (should return 304)
        raw_hash = etag.strip('"')
        if raw_hash.startswith("W/"):
            raw_hash = raw_hash[2:].strip('"')

        headers_with_weak_etag = {**headers, "If-None-Match": f'"{raw_hash}"'}
        response3 = await client.get(f"/api/floorplans/{floorplan_id}", headers=headers_with_weak_etag)
        assert response3.status_code == 304

        # 5. Get details with If-None-Match: * (should return 304)
        headers_with_wildcard = {**headers, "If-None-Match": "*"}
        response4 = await client.get(f"/api/floorplans/{floorplan_id}", headers=headers_with_wildcard)
        assert response4.status_code == 304

        # 6. Get details with non-matching ETag (should return 200)
        headers_with_bad_etag = {**headers, "If-None-Match": '"bad-etag"'}
        response5 = await client.get(f"/api/floorplans/{floorplan_id}", headers=headers_with_bad_etag)
        assert response5.status_code == 200
        assert response5.json()["name"] == "ETag Test Floorplan"
    finally:
        # Cleanup
        await client.delete(f"/api/floorplans/{floorplan_id}", headers=headers)

@pytest.mark.asyncio
async def test_replace_floorplan_file(client: AsyncClient, admin_token: str, test_site_id: int):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Upload initial SVG
    files = {"file": ("original.svg", b"<svg><rect width='10' height='10'/></svg>", "image/svg+xml")}
    data = {"site_id": test_site_id, "name": "Replace Test Floorplan"}
    response = await client.post("/api/floorplans", data=data, files=files, headers=headers)
    assert response.status_code == 200
    floorplan_id = response.json()["id"]
    original_path = response.json()["file_path"]
    assert response.json()["file_type"] == "svg"

    try:
        # 2. Replace with a PDF
        pdf_files = {"file": ("replacement.pdf", b"%PDF-1.4 test content", "application/pdf")}
        replace_resp = await client.put(f"/api/floorplans/{floorplan_id}/file", files=pdf_files, headers=headers)
        assert replace_resp.status_code == 200
        updated = replace_resp.json()
        assert updated["id"] == floorplan_id
        assert updated["file_type"] == "pdf"
        assert updated["file_path"] != original_path
        assert updated["file_path"].endswith(".pdf")
        assert "fp_" in updated["file_path"]

        # 3. Verify get details returns new file info
        get_resp = await client.get(f"/api/floorplans/{floorplan_id}", headers=headers)
        assert get_resp.status_code == 200
        assert get_resp.json()["file_type"] == "pdf"
        assert get_resp.json()["file_path"] == updated["file_path"]

        # 4. Attempt to upload unsupported file format
        bad_files = {"file": ("bad.exe", b"binary content", "application/octet-stream")}
        bad_resp = await client.put(f"/api/floorplans/{floorplan_id}/file", files=bad_files, headers=headers)
        assert bad_resp.status_code == 400
        assert "Unsupported file format" in bad_resp.json()["detail"]

        # 5. Non-existent floorplan returns 404
        non_existent_resp = await client.put("/api/floorplans/999999/file", files=pdf_files, headers=headers)
        assert non_existent_resp.status_code == 404
    finally:
        await client.delete(f"/api/floorplans/{floorplan_id}", headers=headers)
