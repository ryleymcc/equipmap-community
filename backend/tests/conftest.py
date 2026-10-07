import asyncio
import os
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.sql import text

# Import the FastAPI app and database components
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app
from database import Base, get_db
from limiter import limiter

from sqlalchemy.pool import NullPool

# Use a test database
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://myuser:mypassword@localhost:5432/floorplan_db")

# If the URL already contains "test", assume it's already a test database URL
if "test" in DATABASE_URL.split("/")[-1]:
    TEST_DATABASE_URL = DATABASE_URL
elif "floorplan_db" in DATABASE_URL:
    TEST_DATABASE_URL = DATABASE_URL.replace("floorplan_db", "floorplan_test_db")
else:
    TEST_DATABASE_URL = DATABASE_URL + "_test"

engine_test = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
TestingSessionLocal = async_sessionmaker(
    engine_test, class_=AsyncSession, expire_on_commit=False
)

async def init_test_db():
    async with engine_test.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE;"))
        await conn.execute(text("CREATE SCHEMA public;"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
        await conn.run_sync(Base.metadata.create_all)

        # Create fuzzy search indexes (matching database.py)
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_rooms_name_trgm ON rooms USING gin (name gin_trgm_ops);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_equipment_name_trgm ON equipment USING gin (name gin_trgm_ops);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tickets_title_trgm ON tickets USING gin (title gin_trgm_ops);"))

    # Create test users
    from main import get_password_hash
    from models import User
    async with TestingSessionLocal() as session:
        admin = User(username="admin_test", hashed_password=get_password_hash("admin_test"), role="admin")
        editor = User(username="editor_test", hashed_password=get_password_hash("editor_test"), role="editor")
        viewer = User(username="viewer_test", hashed_password=get_password_hash("viewer_test"), role="viewer")
        session.add_all([admin, editor, viewer])
        await session.commit()

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="session", autouse=True)
async def setup_test_db():
    # Parse host, port, and database name from TEST_DATABASE_URL
    import re
    # Extract host and optional port: postgresql+asyncpg://user:pass@host:port/dbname
    host_match = re.search(r'@([^:/]+)(?::(\d+))?', TEST_DATABASE_URL)
    db_host = host_match.group(1) if host_match else "localhost"
    db_port = host_match.group(2) if (host_match and host_match.group(2)) else "5432"

    # Extract db name
    db_name = TEST_DATABASE_URL.split("/")[-1].split("?")[0]

    # Attempt to create the test database if it doesn't exist
    admin_url = f"postgresql+asyncpg://myuser:mypassword@{db_host}:{db_port}/postgres"
    admin_engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")

    async with admin_engine.connect() as conn:
        result = await conn.execute(text(f"SELECT 1 FROM pg_database WHERE datname='{db_name}'"))
        if not result.scalar():
            await conn.execute(text(f"CREATE DATABASE {db_name}"))

    await admin_engine.dispose()

    # Initialize the test database schema and users
    await init_test_db()
    yield

@pytest.fixture(autouse=True)
def reset_limiter_storage():
    limiter.reset()
    yield
    limiter.reset()

@pytest.fixture
async def db_session():
    async with TestingSessionLocal() as session:
        yield session
        await session.rollback()

@pytest.fixture
async def admin_token(client: AsyncClient):
    response = await client.post("/api/token", data={"username": "admin_test", "password": "admin_test"})
    return response.json()["access_token"]

@pytest.fixture
async def editor_token(client: AsyncClient):
    response = await client.post("/api/token", data={"username": "editor_test", "password": "editor_test"})
    return response.json()["access_token"]

@pytest.fixture
async def viewer_token(client: AsyncClient):
    response = await client.post("/api/token", data={"username": "viewer_test", "password": "viewer_test"})
    return response.json()["access_token"]

@pytest.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
