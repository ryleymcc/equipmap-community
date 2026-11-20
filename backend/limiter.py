import os
import logging
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from config import IS_PRODUCTION

logger = logging.getLogger("backend.limiter")

def get_real_ip(request: Request) -> str:
    # Uvicorn resolves forwarding headers only for configured trusted proxies.
    # Reading headers here would bypass that trust boundary.
    return get_remote_address(request)

# Rate limit configuration via environment variables
RATE_LIMIT_LOGIN = os.getenv("RATE_LIMIT_LOGIN", "10/minute")
RATE_LIMIT_DEFAULT = os.getenv("RATE_LIMIT_DEFAULT", "200/minute")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() in ("true", "1", "yes")
RATE_LIMIT_STORAGE_URI = os.getenv("RATE_LIMIT_STORAGE_URI", "memory://")
if IS_PRODUCTION and os.getenv("EQUIPMAP_PORTABLE") != "1" and RATE_LIMIT_ENABLED and not RATE_LIMIT_STORAGE_URI.startswith(("redis://", "rediss://")):
    raise RuntimeError("Production rate limiting requires shared Redis storage via RATE_LIMIT_STORAGE_URI")

limiter = Limiter(
    key_func=get_real_ip,
    default_limits=[RATE_LIMIT_DEFAULT],
    enabled=RATE_LIMIT_ENABLED,
    storage_uri=RATE_LIMIT_STORAGE_URI,
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
