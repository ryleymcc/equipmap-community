import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from limiter import limiter

@pytest.mark.asyncio
async def test_login_rate_limiting_exceeded(client: AsyncClient):
    """
    Verify that rapid failed login attempts on /api/token trigger HTTP 429 Too Many Requests
    with rate-limiting error payload and headers.
    """
    limiter.reset()
    responses = []

    # 10 attempts allowed per minute by default
    for i in range(12):
        res = await client.post(
            "/api/token",
            data={"username": f"attacker_{i}", "password": "wrongpassword"},
            headers={"X-Forwarded-For": "198.51.100.1"}
        )
        responses.append(res)

    # First 10 attempts fail with 401 Unauthorized
    for i in range(10):
        assert responses[i].status_code == 401, f"Attempt {i+1} expected 401, got {responses[i].status_code}"

    # 11th and 12th attempts exceed rate limit and receive 429
    assert responses[10].status_code == 429
    assert responses[11].status_code == 429

    data = responses[10].json()
    assert "Rate limit exceeded" in data.get("detail", "")
    assert "Rate limit exceeded" in data.get("error", "")


@pytest.mark.asyncio
async def test_rate_limiting_ip_isolation(client):
    # Real transport peers get independent counters without trusting raw headers.
    limiter.reset()
    async with AsyncClient(transport=ASGITransport(app=app, client=("192.0.2.10", 123)), base_url="http://test") as first:
        for _ in range(10):
            assert (await first.post("/api/token", data={"username": "missing", "password": "bad"})).status_code == 401
        assert (await first.post("/api/token", data={"username": "missing", "password": "bad"})).status_code == 429
    async with AsyncClient(transport=ASGITransport(app=app, client=("192.0.2.20", 123)), base_url="http://test") as second:
        assert (await second.post("/api/token", data={"username": "missing", "password": "bad"})).status_code == 401


@pytest.mark.asyncio
async def test_spoofed_forwarding_headers_cannot_reset_login_limit(client):
    limiter.reset()
    for i in range(11):
        response = await client.post("/api/token", data={"username": "missing", "password": "bad"},
            headers={"CF-Connecting-IP": f"192.0.2.{i+1}", "X-Forwarded-For": f"198.51.100.{i+1}", "X-Real-IP": f"203.0.113.{i+1}"})
        assert response.status_code == (401 if i < 10 else 429)


@pytest.mark.asyncio
async def test_only_trusted_proxy_can_select_resolved_client_address(client):
    limiter.reset()
    proxy_app = ProxyHeadersMiddleware(app, trusted_hosts=["172.20.0.5"])
    async with AsyncClient(transport=ASGITransport(app=proxy_app, client=("172.20.0.5", 123)), base_url="http://test") as trusted:
        for _ in range(10):
            assert (await trusted.post("/api/token", data={"username": "missing", "password": "bad"}, headers={"X-Forwarded-For": "192.0.2.1"})).status_code == 401
        assert (await trusted.post("/api/token", data={"username": "missing", "password": "bad"}, headers={"X-Forwarded-For": "192.0.2.1"})).status_code == 429
        assert (await trusted.post("/api/token", data={"username": "missing", "password": "bad"}, headers={"X-Forwarded-For": "192.0.2.2"})).status_code == 401
    async with AsyncClient(transport=ASGITransport(app=proxy_app, client=("198.51.100.1", 123)), base_url="http://test") as untrusted:
        for i in range(11):
            response = await untrusted.post("/api/token", data={"username": "missing", "password": "bad"}, headers={"X-Forwarded-For": f"203.0.113.{i+1}"})
            assert response.status_code == (401 if i < 10 else 429)
