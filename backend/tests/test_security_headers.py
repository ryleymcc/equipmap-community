import pytest
from httpx import AsyncClient
from httpx import ASGITransport
from main import CachedStaticFiles


@pytest.mark.asyncio
async def test_legacy_svg_is_sandboxed_on_reads_and_revalidation(tmp_path):
    (tmp_path / "legacy.svg").write_text("<svg/>")
    static = CachedStaticFiles(directory=tmp_path)
    async with AsyncClient(transport=ASGITransport(app=static), base_url="http://test") as client:
        initial = await client.get("/legacy.svg")
        assert initial.status_code == 200
        cached = await client.get("/legacy.svg", headers={"If-None-Match": initial.headers["etag"]})
        assert cached.status_code == 304
    for response in (initial, cached):
        policy = response.headers["Content-Security-Policy"].split("; ")
        assert "sandbox" in policy
        assert "default-src 'none'" in policy

@pytest.mark.asyncio
async def test_security_headers_on_health_endpoint(client: AsyncClient):
    response = await client.get("/health")
    assert response.status_code == 200

    # Verify HSTS
    assert "strict-transport-security" in response.headers
    assert "max-age=" in response.headers["strict-transport-security"]
    assert "includeSubDomains" in response.headers["strict-transport-security"]
    assert "preload" in response.headers["strict-transport-security"]

    # Verify other security headers
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert response.headers.get("x-xss-protection") == "1; mode=block"

@pytest.mark.asyncio
async def test_security_headers_on_api_endpoints(client: AsyncClient, viewer_token: str):
    headers = {"Authorization": f"Bearer {viewer_token}"}
    response = await client.get("/api/users/me", headers=headers)
    assert response.status_code == 200

    assert "strict-transport-security" in response.headers
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
