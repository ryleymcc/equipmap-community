import os
import logging
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

logger = logging.getLogger("backend.limiter")

def get_real_ip(request: Request) -> str:
    """
    Extract the client's real IP address, accounting for reverse proxies (Nginx, Traefik, Cloudflare).
    """
    # Cloudflare connecting IP
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip.strip()

    # Standard proxy forwarded header (take the leftmost client IP)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    # Standard real IP header
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    # Default fallback to direct connection host
    return get_remote_address(request)

# Rate limit configuration via environment variables
RATE_LIMIT_LOGIN = os.getenv("RATE_LIMIT_LOGIN", "10/minute")
RATE_LIMIT_DEFAULT = os.getenv("RATE_LIMIT_DEFAULT", "200/minute")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() in ("true", "1", "yes")

limiter = Limiter(
    key_func=get_real_ip,
    default_limits=[RATE_LIMIT_DEFAULT],
    enabled=RATE_LIMIT_ENABLED,
)

def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> Response:
    """
    Custom RateLimitExceeded handler returning HTTP 429 with both FastAPI standard 'detail'
    and SlowAPI 'error' fields, along with standard rate limit headers.
    """
    logger.warning(f"Rate limit exceeded for IP {get_real_ip(request)} on {request.url.path}: {exc.detail}")
    response = JSONResponse(
        {
            "detail": f"Rate limit exceeded: {exc.detail}",
            "error": f"Rate limit exceeded: {exc.detail}"
        },
        status_code=429,
    )
    if hasattr(request.app.state, "limiter"):
        response = request.app.state.limiter._inject_headers(
            response, getattr(request.state, "view_rate_limit", None)
        )
    return response
