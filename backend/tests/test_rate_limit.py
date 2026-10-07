import pytest
from httpx import AsyncClient
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
async def test_rate_limiting_ip_isolation(client: AsyncClient):
    """
    Verify that rate limits apply per IP address independently via proxy headers.
    """
    limiter.reset()

    # Exhaust rate limit for IP 192.0.2.10
    for _ in range(10):
        res = await client.post(
            "/api/token",
            data={"username": "user1", "password": "bad"},
            headers={"X-Forwarded-For": "192.0.2.10"}
        )
        assert res.status_code == 401

    # 11th request from 192.0.2.10 is rate-limited
    res_blocked = await client.post(
        "/api/token",
        data={"username": "user1", "password": "bad"},
        headers={"X-Forwarded-For": "192.0.2.10"}
    )
    assert res_blocked.status_code == 429

    # Distinct IP 192.0.2.20 should NOT be blocked
    res_allowed = await client.post(
        "/api/token",
        data={"username": "user1", "password": "bad"},
        headers={"X-Forwarded-For": "192.0.2.20"}
    )
    assert res_allowed.status_code == 401
