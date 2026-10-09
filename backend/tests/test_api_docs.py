import pytest
from httpx import AsyncClient, ASGITransport
from main import app

@pytest.mark.asyncio
async def test_swagger_ui_endpoints():
    """Verify all Swagger documentation routes render the custom UI."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for path in ["/docs", "/swag", "/swagger", "/api-docs"]:
            res = await client.get(path)
            assert res.status_code == 200
            assert "text/html" in res.headers.get("content-type", "")
            assert "EquipMap API" in res.text
            assert "Security Matrix" in res.text
            assert "Authenticated" in res.text
            assert "swagger-ui" in res.text

@pytest.mark.asyncio
async def test_openapi_schema_auth_badges():
    """Verify OpenAPI schema includes [🔒 AUTH] and [🌐 PUBLIC] badges."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/openapi.json")
        assert res.status_code == 200
        schema = res.json()

        paths = schema.get("paths", {})
        assert len(paths) > 0

        # Verify /api/token is tagged public
        token_post = paths.get("/api/token", {}).get("post", {})
        assert "[🌐 PUBLIC]" in token_post.get("summary", "")
        assert token_post.get("x-auth-status") == "public"

        # Verify /health is tagged public
        health_get = paths.get("/health", {}).get("get", {})
        assert "[🌐 PUBLIC]" in health_get.get("summary", "")
        assert health_get.get("x-auth-status") == "public"

        # Verify /api/users/me is tagged authenticated
        users_me_get = paths.get("/api/users/me", {}).get("get", {})
        assert "[🔒 AUTH]" in users_me_get.get("summary", "")
        assert users_me_get.get("x-auth-status") == "authenticated"

        # Verify /api/work-orders POST is tagged authenticated
        wo_post = paths.get("/api/work-orders", {}).get("post", {})
        assert "[🔒 AUTH]" in wo_post.get("summary", "")
        assert wo_post.get("x-auth-status") == "authenticated"

@pytest.mark.asyncio
async def test_endpoints_summary_api():
    """Verify /api/endpoints-summary provides accurate endpoint counts and security breakdowns."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/endpoints-summary")
        assert res.status_code == 200
        data = res.json()

        assert "stats" in data
        assert "endpoints" in data
        assert "authenticated_endpoints" in data
        assert "public_endpoints" in data

        stats = data["stats"]
        assert stats["total_endpoints"] > 50
        assert stats["authenticated_count"] > 40
        assert stats["public_count"] >= 10
        assert stats["total_endpoints"] == stats["authenticated_count"] + stats["public_count"]

        # Ensure all items in authenticated_endpoints have is_authenticated == True
        for ep in data["authenticated_endpoints"]:
            assert ep["is_authenticated"] is True
            assert ep["auth_status"] == "authenticated"

        # Ensure all items in public_endpoints have is_authenticated == False
        for ep in data["public_endpoints"]:
            assert ep["is_authenticated"] is False
            assert ep["auth_status"] == "public"
