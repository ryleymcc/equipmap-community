import re
from fastapi import APIRouter, Depends
from sqlalchemy.future import select
from sqlalchemy import or_, text, literal_column
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
import models

router = APIRouter(tags=["search"])

@router.get("/api/search")
async def search(q: str, db: AsyncSession = Depends(get_db)):
    if not q:
        return []

    clean_q = re.sub(r'[^a-zA-Z0-9]', '', q.lower())
    lower_q = q.lower()
    pattern = rf"(^|[^a-zA-Z0-9]){re.escape(lower_q)}($|[^a-zA-Z0-9])"

    score_sql = f"""
        CASE
            WHEN LOWER(name) = :q THEN 1000.0
            WHEN LOWER(name) ~ :pattern THEN
                CASE WHEN LOWER(name) LIKE :q_prefix THEN 900.0 - (LENGTH(name) * 0.1)
                ELSE 800.0 - (LENGTH(name) * 0.1) END
            WHEN LOWER(name) LIKE :q_prefix THEN 700.0 - (LENGTH(name) * 0.1)
            WHEN LOWER(name) LIKE :q_contains THEN 600.0 - (LENGTH(name) * 0.1)
            WHEN REGEXP_REPLACE(LOWER(name), '[^a-zA-Z0-9]', '', 'g') LIKE :clean_prefix THEN 500.0 - (LENGTH(name) * 0.1)
            WHEN REGEXP_REPLACE(LOWER(name), '[^a-zA-Z0-9]', '', 'g') LIKE :clean_contains THEN 400.0 - (LENGTH(name) * 0.1)
            WHEN LOWER(description) LIKE :q_contains THEN 300.0 - (COALESCE(LENGTH(description), 0) * 0.1)
            WHEN REGEXP_REPLACE(LOWER(description), '[^a-zA-Z0-9]', '', 'g') LIKE :clean_contains THEN 200.0 - (COALESCE(LENGTH(description), 0) * 0.1)
            ELSE 100.0 + (similarity(name, :q) * 10)
        END
    """

    room_conditions = [
        models.Room.name.ilike(f"%{q}%"),
        models.Room.description.ilike(f"%{q}%"),
        text("rooms.name % :q"),
        text("rooms.description % :q")
    ]
    if clean_q:
        room_conditions.append(text("REGEXP_REPLACE(rooms.name, '[^a-zA-Z0-9]', '', 'g') ILIKE :clean_contains"))
        room_conditions.append(text("REGEXP_REPLACE(rooms.description, '[^a-zA-Z0-9]', '', 'g') ILIKE :clean_contains"))

    equip_conditions = [
        models.Equipment.name.ilike(f"%{q}%"),
        models.Equipment.description.ilike(f"%{q}%"),
        text("equipment.name % :q"),
        text("equipment.description % :q")
    ]
    if clean_q:
        equip_conditions.append(text("REGEXP_REPLACE(equipment.name, '[^a-zA-Z0-9]', '', 'g') ILIKE :clean_contains"))
        equip_conditions.append(text("REGEXP_REPLACE(equipment.description, '[^a-zA-Z0-9]', '', 'g') ILIKE :clean_contains"))

    room_select = select(
        models.Room.id,
        literal_column("'room'").label("type"),
        models.Room.name,
        models.Room.description,
        models.Room.floorplan_id,
        models.Room.x_coordinate,
        models.Room.y_coordinate,
        literal_column("NULL").label("color"),
        text(f"({score_sql}) AS score")
    ).where(or_(*room_conditions))

    equip_select = select(
        models.Equipment.id,
        literal_column("'equipment'").label("type"),
        models.Equipment.name,
        models.Equipment.description,
        models.Equipment.floorplan_id,
        models.Equipment.x_coordinate,
        models.Equipment.y_coordinate,
        models.Equipment.color,
        text(f"({score_sql}) AS score")
    ).where(or_(*equip_conditions))

    final_query = room_select.union_all(equip_select).order_by(text("score DESC"))

    params = {
        "q": lower_q,
        "pattern": pattern,
        "q_prefix": f"{lower_q}%",
        "q_contains": f"%{lower_q}%",
        "clean_prefix": f"{clean_q}%",
        "clean_contains": f"%{clean_q}%"
    }

    results = await db.execute(final_query.params(**params))
    return [dict(r._mapping) for r in results.all()]
