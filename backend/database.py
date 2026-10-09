import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text

from config import get_database_url

DATABASE_URL = get_database_url()

engine = create_async_engine(DATABASE_URL, echo=os.getenv("DB_ECHO", "false").lower() == "true")

async_session_maker = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()

async def get_db():
    async with async_session_maker() as session:
        yield session

async def init_db():
    import models  # noqa: F401 - ensure all SQLAlchemy models are registered on Base.metadata

    async with engine.begin() as conn:
        # Create pg_trgm extension if it doesn't exist
        try:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
        except Exception:
            pass
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)

    # Create fuzzy search & foreign key indexes safely
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_rooms_name_trgm ON rooms USING gin (name gin_trgm_ops)",
        "CREATE INDEX IF NOT EXISTS idx_equipment_name_trgm ON equipment USING gin (name gin_trgm_ops)",
        "CREATE INDEX IF NOT EXISTS idx_tickets_title_trgm ON tickets USING gin (title gin_trgm_ops)",
        "CREATE INDEX IF NOT EXISTS idx_floorplans_site_id ON floorplans (site_id)",
        "CREATE INDEX IF NOT EXISTS idx_rooms_floorplan_id ON rooms (floorplan_id)",
        "CREATE INDEX IF NOT EXISTS idx_equipment_floorplan_id ON equipment (floorplan_id)",
        "CREATE INDEX IF NOT EXISTS idx_tickets_floorplan_id ON tickets (floorplan_id)",
        "CREATE INDEX IF NOT EXISTS idx_reference_points_floorplan_id ON reference_points (floorplan_id)",
        "CREATE INDEX IF NOT EXISTS idx_work_order_rooms_room_id ON work_order_rooms (room_id, work_order_id)",
        "CREATE INDEX IF NOT EXISTS idx_work_order_equipment_equipment_id ON work_order_equipment (equipment_id, work_order_id)",
    ]
    for idx_stmt in indexes:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(idx_stmt))
        except Exception:
            pass

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
        "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
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

    # Additive PM scheduler migration for databases created before structured recurrence.
    pm_columns = [
        "ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS recurrence_version INTEGER",
        "ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS recurrence_rule JSON",
        "ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS timezone VARCHAR NOT NULL DEFAULT 'UTC'",
        "ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS checklist_items JSON NOT NULL DEFAULT '[]'::json",
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS pm_schedule_id INTEGER REFERENCES pm_schedules(id) ON DELETE SET NULL",
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS pm_scheduled_for TIMESTAMPTZ",
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS checklist_items JSON NOT NULL DEFAULT '[]'::json",
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ",
    ]
    for statement in pm_columns:
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
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_pm_schedules_due ON pm_schedules (next_run_at) WHERE is_active = TRUE"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_work_orders_pm_schedule_id ON work_orders (pm_schedule_id)"))
            await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_work_order_pm_occurrence ON work_orders (pm_schedule_id, pm_scheduled_for) WHERE pm_schedule_id IS NOT NULL AND pm_scheduled_for IS NOT NULL"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id)"))
    except Exception:
        pass

    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE floorplans ADD COLUMN IF NOT EXISTS previous_file_path VARCHAR"))

    # Tasks and Task Templates migration
    task_columns = [
        "ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL",
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL",
    ]
    for statement in task_columns:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(statement))
        except Exception:
            pass

    task_type_migrations = [
        "ALTER TABLE task_types ADD COLUMN IF NOT EXISTS code VARCHAR",
        "ALTER TABLE task_types ADD COLUMN IF NOT EXISTS category VARCHAR NOT NULL DEFAULT 'General'",
        "ALTER TABLE task_types ADD COLUMN IF NOT EXISTS priority VARCHAR NOT NULL DEFAULT 'medium'",
        "ALTER TABLE task_types ADD COLUMN IF NOT EXISTS trade VARCHAR",
        "ALTER TABLE task_types ADD COLUMN IF NOT EXISTS task_sheet_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL",
        "DROP INDEX IF EXISTS ix_task_types_name",
        "CREATE INDEX IF NOT EXISTS idx_task_types_name ON task_types (name)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_types_code_unique ON task_types (code)",
        "CREATE INDEX IF NOT EXISTS idx_task_types_category ON task_types (category)",
        "CREATE INDEX IF NOT EXISTS idx_task_types_priority ON task_types (priority)",
        "CREATE INDEX IF NOT EXISTS idx_task_types_trade ON task_types (trade)",
        "CREATE INDEX IF NOT EXISTS idx_task_types_task_sheet_id ON task_types (task_sheet_id)",
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS task_type_id INTEGER REFERENCES task_types(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS idx_work_orders_task_type_id ON work_orders (task_type_id)",
        """
        INSERT INTO task_types (code, name, category, priority, trade, is_active, task_sheet_id)
        SELECT code, description, COALESCE(category, 'General'), 'medium', trade,
               COALESCE(is_active, TRUE),
               CASE WHEN pm_task_sheet IS NOT NULL AND TRIM(pm_task_sheet) <> '' THEN id ELSE NULL END
        FROM tasks
        WHERE code IS NOT NULL AND TRIM(code) <> ''
        ON CONFLICT (code) DO NOTHING
        """,
        """
        UPDATE work_orders wo
        SET task_type_id = tt.id
        FROM tasks t, task_types tt
        WHERE wo.task_type_id IS NULL
          AND wo.task_id = t.id
          AND tt.code = t.code
        """,
        """
        UPDATE work_orders wo
        SET task_id = NULL
        FROM tasks t
        WHERE wo.task_id = t.id
          AND (t.pm_task_sheet IS NULL OR TRIM(t.pm_task_sheet) = '')
        """,
    ]
    for statement in task_type_migrations:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(statement))
        except Exception:
            pass

    # Trade columns migration
    trade_columns = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS trade VARCHAR",
        "ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS trade VARCHAR",
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS trade VARCHAR",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS trade VARCHAR",
    ]
    for statement in trade_columns:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(statement))
        except Exception:
            pass

    task_columns = [
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type VARCHAR",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type_code VARCHAR",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type_description VARCHAR",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_sub_type VARCHAR",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_sub_type_code VARCHAR",
        "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_sub_type_description VARCHAR",
        "CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks (task_type)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_task_sub_type ON tasks (task_sub_type)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_task_type_code ON tasks (task_type_code)",
        "ALTER TABLE tasks ALTER COLUMN code DROP NOT NULL",
        # Clean up the legacy xPM placeholder. Reactive task definitions are
        # valid without a PM procedure sheet and must remain available for
        # imported work-order links.
        "UPDATE tasks SET task_type = NULL, task_type_code = NULL, task_type_description = NULL WHERE lower(task_type) = 'xpm' OR lower(task_type_code) = 'xpm' OR lower(task_type_description) = 'xpm'",
        "UPDATE tasks SET category = 'General' WHERE category = 'General Maintenance'",
    ]
    for statement in task_columns:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(statement))
        except Exception:
            pass

    # Trades Table & Initial Seed Migration
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS trades (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR UNIQUE NOT NULL,
                    description VARCHAR,
                    color VARCHAR DEFAULT '#3b82f6',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trades_name ON trades(name)"))
            await conn.execute(text("""
                INSERT INTO trades (name)
                SELECT DISTINCT TRIM(trade) FROM (
                    SELECT trade FROM users WHERE trade IS NOT NULL AND TRIM(trade) != ''
                    UNION
                    SELECT trade FROM pm_schedules WHERE trade IS NOT NULL AND TRIM(trade) != ''
                    UNION
                    SELECT trade FROM tasks WHERE trade IS NOT NULL AND TRIM(trade) != ''
                ) t
                ON CONFLICT (name) DO NOTHING;
            """))
    except Exception:
        pass

    # Safety notes cleanup migration
    safety_cleanup = [
        "ALTER TABLE tasks DROP COLUMN IF EXISTS safety_notes",
        "ALTER TABLE pm_schedules DROP COLUMN IF EXISTS safety_notes",
        "ALTER TABLE work_orders DROP COLUMN IF EXISTS safety_notes",
    ]
    for statement in safety_cleanup:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(statement))
        except Exception:
            pass

    # Work Order client metadata migration
    wo_client_columns = [
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS ip_address VARCHAR",
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS user_agent TEXT",
        "ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS device_details VARCHAR",
    ]
    for statement in wo_client_columns:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(statement))
        except Exception:
            pass
