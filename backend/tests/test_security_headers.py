import pytest
from httpx import AsyncClient

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
