import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base, Session
from sqlalchemy import text, event

from config import get_database_url

DATABASE_URL = get_database_url()
IS_SHARED_SQLITE = os.getenv('EQUIPMAP_SHARED_FOLDER') == '1'
if DATABASE_URL.startswith('sqlite') and not IS_SHARED_SQLITE:
    raise RuntimeError('SQLite is supported only by the coordinated shared-folder edition')

engine = create_async_engine(DATABASE_URL, echo=os.getenv("DB_ECHO", "false").lower() == "true")
if IS_SHARED_SQLITE:
    from shared_sqlite import install
    install(engine)

async_session_maker = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()

async def get_db():
    async with async_session_maker() as session:
        yield session

async def init_db():
    if IS_SHARED_SQLITE:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return
    async with engine.begin() as conn:
        # Create pg_trgm extension if it doesn't exist
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE upload_assets ALTER COLUMN size_bytes TYPE BIGINT"))
        await conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS undo_unavailable_reason VARCHAR"))

        # Create fuzzy search indexes
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_rooms_name_trgm ON rooms USING gin (name gin_trgm_ops);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_equipment_name_trgm ON equipment USING gin (name gin_trgm_ops);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tickets_title_trgm ON tickets USING gin (title gin_trgm_ops);"))

        # Create foreign key indexes for performance
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_floorplans_site_id ON floorplans (site_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_rooms_floorplan_id ON rooms (floorplan_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_equipment_floorplan_id ON equipment (floorplan_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tickets_floorplan_id ON tickets (floorplan_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_reference_points_floorplan_id ON reference_points (floorplan_id);"))

    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS photo_path VARCHAR"))

    # Patch existing equipment table for new columns in separate transactions so they don't roll back table creations
    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE equipment ADD COLUMN color VARCHAR DEFAULT '#10b981'"))
    except Exception:
        pass

    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE equipment ADD COLUMN tools_required VARCHAR"))
    except Exception:
        pass

    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE floorplans ADD COLUMN previous_file_path VARCHAR"))
    except Exception:
        pass

    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR UNIQUE NOT NULL,
                    hashed_password VARCHAR NOT NULL,
                    role VARCHAR DEFAULT 'viewer',
                    is_active BOOLEAN DEFAULT TRUE
                )
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)"))
    except Exception:
        pass

    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE floorplans ADD COLUMN pin_size INTEGER DEFAULT 16"))
    except Exception:
        pass

    user_columns = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS trade VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_triage BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_assign BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_pm BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_work_orders BOOLEAN DEFAULT TRUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_items BOOLEAN DEFAULT TRUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_close_work_orders BOOLEAN DEFAULT TRUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS can_undo_all_audit_logs BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 1",
    ]
    for statement in user_columns:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(statement))
        except Exception:
            pass

    audit_columns = [
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username VARCHAR",
    ]
    for statement in audit_columns:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(statement))
        except Exception:
            pass

    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id)"))
    except Exception:
        pass



@event.listens_for(Session, 'before_flush')
def track_upload_changes(session, *args):
    from upload_index import before_flush
    before_flush(session, *args)


@event.listens_for(Session, 'after_flush_postexec')
def apply_upload_changes(session, *args):
    from upload_index import after_flush
    after_flush(session, *args)


@event.listens_for(Session, 'after_rollback')
def clear_upload_changes(session, *args):
    session.info.pop('upload_index_changes', None)
