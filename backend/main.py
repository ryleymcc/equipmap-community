import os
import hashlib
import logging
import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers, MutableHeaders
from sqlalchemy.future import select
import sentry_sdk
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from limiter import limiter, rate_limit_exceeded_handler
from swagger_custom import generate_custom_openapi, render_custom_swagger_ui_html, get_endpoints_summary_data
from config import get_initial_admin_password, IS_PRODUCTION

from database import init_db
import models
from utils import check_etag_match, get_password_hash, UPLOAD_DIR

# Import Routers
from routers import users, sites, floorplans, rooms, equipment, tickets, audit_logs, search, sync, room_ocr

import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_app_version():
    candidates = [
        os.path.join(os.path.dirname(__file__), "version.json"),
        os.path.join(os.path.dirname(__file__), "..", "version.json"),
        os.path.join(os.path.dirname(__file__), "..", "frontend", "package.json"),
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if "version" in data:
                        return data["version"]
            except Exception:
                pass
    return "1.0.0"

APP_VERSION = get_app_version()

# Initialize Sentry SDK
SENTRY_DSN = os.getenv(
    "SENTRY_DSN",
    "",
)

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        release=os.getenv("SENTRY_RELEASE", f"equipmap-backend@{APP_VERSION}"),
        # Add data like request headers and IP for users,
        # see https://docs.sentry.io/platforms/python/data-management/data-collected/ for more info
        send_default_pii=False,
        # Enable sending logs to Sentry
        enable_logs=True,
        # Set traces_sample_rate to 1.0 to capture 100%
        # of transactions for tracing.
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "1.0")),
        # Set profile_session_sample_rate to 1.0 to profile 100%
        # of profile sessions.
        profile_session_sample_rate=float(os.getenv("SENTRY_PROFILE_SESSION_SAMPLE_RATE", "1.0")),
        # Set profile_lifecycle to "trace" to automatically
        # run the profiler on when there is an active transaction
        profile_lifecycle="trace",
    )

class ETagMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "")

        # Only process GET requests to /api/ (excluding ChatGPT endpoints)
        if method != "GET" or not path.startswith("/api/") or path.startswith("/api/chatgpt/"):
            await self.app(scope, receive, send)
            return

        response_status = 200
        response_headers = []
        response_body = b""
        start_sent = False

        async def send_wrapper(message) -> None:
            nonlocal response_status, response_headers, response_body, start_sent
            if message["type"] == "http.response.start":
                response_status = message["status"]
                response_headers = message["headers"]
                return  # Swallow and hold onto it
            elif message["type"] == "http.response.body":
                if response_status == 200:
                    response_body += message.get("body", b"")
                    if not message.get("more_body", False):
                        # Get request headers
                        request_headers = Headers(raw=scope.get("headers", []))
                        if_none_match = request_headers.get("if-none-match")

                        # Create mutable headers helper
                        headers = MutableHeaders(raw=response_headers)
                        existing_etag = headers.get("etag")

                        if existing_etag:
                            etag = existing_etag
                        else:
                            etag = f'W/"{hashlib.md5(response_body).hexdigest()}"'

                        # Robust ETag comparison
                        is_match = check_etag_match(if_none_match, etag)

                        # Create new headers
                        if "content-length" in headers:
                            del headers["content-length"]
                        if "etag" in headers:
                            del headers["etag"]
                        if "cache-control" in headers:
                            del headers["cache-control"]

                        headers["ETag"] = etag
                        headers["Cache-Control"] = "public, max-age=0, must-revalidate"

                        if is_match:
                            # Return 304 response
                            await send({
                                "type": "http.response.start",
                                "status": 304,
                                "headers": headers.raw
                            })
                            await send({
                                "type": "http.response.body",
                                "body": b"",
                                "more_body": False
                            })
                        else:
                            # Return 200 response
                            headers["Content-Length"] = str(len(response_body))
                            await send({
                                "type": "http.response.start",
                                "status": 200,
                                "headers": headers.raw
                            })
                            await send({
                                "type": "http.response.body",
                                "body": response_body,
                                "more_body": False
                            })
                    return
                else:
                    # For non-200 responses, send the stored start message first (only once), then the body message
                    if not start_sent and response_headers is not None:
                        start_sent = True
                        await send({
                            "type": "http.response.start",
                            "status": response_status,
                            "headers": response_headers
                        })
                    await send(message)
                    return

            await send(message)

        await self.app(scope, receive, send_wrapper)

class SecurityHeadersMiddleware:
    """Middleware to enforce HSTS and browser security headers on all responses."""
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                # Encryption in Transit & Browser Security Headers
                headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                headers["X-XSS-Protection"] = "1; mode=block"
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
            await send(message)

        await self.app(scope, receive, send_wrapper)

app = FastAPI(title="EquipMap API", docs_url=None, redoc_url="/redoc")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# Custom OpenAPI schema generator
app.openapi = lambda: generate_custom_openapi(app, APP_VERSION)

# Register Rate Limiting Middleware
app.add_middleware(SlowAPIMiddleware)

# Register Security Headers Middleware
app.add_middleware(SecurityHeadersMiddleware)

# Register Cors Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Register ETag Middleware
app.add_middleware(ETagMiddleware)

class CachedStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=604800, stale-while-revalidate=86400"
        return response

# Mount Uploads with browser cache headers for instant re-loads
app.mount("/uploads", CachedStaticFiles(directory=UPLOAD_DIR), name="uploads")

from routers import work_orders, pm_schedules, notifications, tasks, trades

# Include APIRouters
app.include_router(users.router)
app.include_router(sites.router)
app.include_router(floorplans.router)
app.include_router(room_ocr.router)
app.include_router(rooms.router)
app.include_router(equipment.router)
app.include_router(tickets.router)
app.include_router(audit_logs.router)
app.include_router(search.router)
app.include_router(sync.router)
app.include_router(work_orders.router)
app.include_router(pm_schedules.router)
app.include_router(notifications.router)
app.include_router(tasks.router)
app.include_router(trades.router)

pm_runner_task: asyncio.Task = None

async def pm_schedule_periodic_runner():
    """Periodic background worker to check and generate due PM work orders every 60 seconds."""
    from database import async_session_maker
    from routers.pm_schedules import process_due_schedules

    # Wait a brief moment on startup before initial run
    await asyncio.sleep(5)
    while True:
        try:
            async with async_session_maker() as db:
                generated = await process_due_schedules(db)
                for order_number in generated:
                    logger.info(f"PM Runner generated work order '{order_number}'")
        except asyncio.CancelledError:
            logger.info("PM schedule runner task cancelled")
            break
        except Exception as e:
            logger.error(f"Error in PM schedule periodic loop: {e}")

        await asyncio.sleep(60)

@app.on_event("startup")
async def startup_event():
    global pm_runner_task
    try:
        await init_db()
        logger.info("Database initialized successfully")

        # Create default admin user if none exists and allowed
        from database import async_session_maker
        async with async_session_maker() as db:
            result = await db.execute(select(models.User))
            if not result.scalars().first():
                initial_pw = get_initial_admin_password()
                if initial_pw:
                    admin_user = models.User(
                        username="admin",
                        hashed_password=get_password_hash(initial_pw),
                        role="admin",
                        is_active=True
                    )
                    db.add(admin_user)
                    await db.commit()
                    if IS_PRODUCTION:
                        logger.info("Initial admin user bootstrapped with configured INITIAL_ADMIN_PASSWORD.")
                    else:
                        logger.warning("Default dev admin user created ('admin' / 'admin'). Change credentials before deploying to production.")
                else:
                    logger.warning("No users found in database. In production, initial admin auto-creation with default credentials is disabled. Set INITIAL_ADMIN_PASSWORD to bootstrap an admin user.")
        pm_runner_task = asyncio.create_task(pm_schedule_periodic_runner())
        logger.info("PM schedule runner started")
    except Exception as e:
        logger.error(f"Error during database initialization: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    global pm_runner_task
    if pm_runner_task and not pm_runner_task.done():
        pm_runner_task.cancel()
        try:
            await pm_runner_task
        except asyncio.CancelledError:
            pass
        logger.info("PM Schedule runner stopped")

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/docs", include_in_schema=False)
@app.get("/swag", include_in_schema=False)
@app.get("/swagger", include_in_schema=False)
@app.get("/api-docs", include_in_schema=False)
async def swagger_ui_page(request: Request):
    """Custom rich Swagger UI documentation portal with live Auth / Public filter controls."""
    return HTMLResponse(render_custom_swagger_ui_html(openapi_url="/openapi.json", app_version=APP_VERSION))

@app.get("/api/endpoints-summary", tags=["System / Docs"])
async def api_endpoints_summary():
    """Get complete structured summary of all API endpoints and their authentication & authorization requirements."""
    return JSONResponse(get_endpoints_summary_data(app, APP_VERSION))


# Opt-in read-only ChatGPT connection, registered after existing application routes.
from chatgpt_mcp import install_chatgpt
install_chatgpt(app)
