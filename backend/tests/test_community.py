import pytest
from main import app


def test_community_api_excludes_tma():
    assert not any("/tma" in path for path in app.openapi()["paths"])


@pytest.mark.asyncio
async def test_removed_tma_endpoint_is_not_available(client):
    response = await client.post("/api/tma/auth/login", json={})
    assert response.status_code == 404
