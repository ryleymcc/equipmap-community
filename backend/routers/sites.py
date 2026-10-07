import os
import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db
import models
import schemas
from utils import require_editor, require_admin, log_action, update_db_object, delete_db_object

logger = logging.getLogger("backend.routers.sites")

router = APIRouter(tags=["sites"])

@router.get("/api/sites", response_model=List[schemas.Site])
async def get_sites(response: Response, db: AsyncSession = Depends(get_db)):
    res = await db.execute(text("SELECT md5(COALESCE(string_agg(xmin::text, ',' ORDER BY id), '')) FROM sites"))
    db_hash = res.scalar() or ""
    response.headers["ETag"] = f'W/"{db_hash}"'

    result = await db.execute(select(models.Site))
    return result.scalars().all()

@router.post("/api/sites", response_model=schemas.Site)
async def create_site(site: schemas.SiteCreate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_editor)):
    db_site = models.Site(**site.model_dump())
    db.add(db_site)
    await db.commit()
    await db.refresh(db_site)
    await log_action(db, "create", "site", db_site.id, db_site.name, new_values=site.model_dump(), message=f"Created site '{db_site.name}'", user=current_user)
    await db.commit()
    return db_site

@router.put("/api/sites/{site_id}", response_model=schemas.Site)
async def update_site(site_id: int, site_update: schemas.SiteUpdate, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_editor)):
    result = await db.execute(select(models.Site).where(models.Site.id == site_id))
    db_site = result.scalars().first()
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    return await update_db_object(db, db_site, site_update, "site", user=current_user)

@router.delete("/api/sites/{site_id}")
async def delete_site(site_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_editor)):
    result = await db.execute(
        select(models.Site)
        .options(
            selectinload(models.Site.floorplans).selectinload(models.Floorplan.rooms),
            selectinload(models.Site.floorplans).selectinload(models.Floorplan.equipment),
            selectinload(models.Site.floorplans).selectinload(models.Floorplan.tickets),
            selectinload(models.Site.floorplans).selectinload(models.Floorplan.reference_points)
        )
        .where(models.Site.id == site_id)
    )
    db_site = result.scalars().first()
    if not db_site:
        raise HTTPException(status_code=404, detail="Site not found")

    # Capture complete cascading state in old_values so deletion can be completely undone
    old_values = {
        "id": db_site.id,
        "name": db_site.name,
        "description": db_site.description,
        "location": db_site.location,
        "floorplans": [
            {
                "id": fp.id,
                "name": fp.name,
                "file_path": fp.file_path,
                "file_type": fp.file_type,
                "pin_size": fp.pin_size,
                "sort_order": fp.sort_order,
                "rooms": [
                    {
                        "id": r.id,
                        "name": r.name,
                        "description": r.description,
                        "x_coordinate": r.x_coordinate,
                        "y_coordinate": r.y_coordinate,
                    }
                    for r in fp.rooms
                ],
                "equipment": [
                    {
                        "id": eq.id,
                        "name": eq.name,
                        "description": eq.description,
                        "x_coordinate": eq.x_coordinate,
                        "y_coordinate": eq.y_coordinate,
                        "color": eq.color,
                        "photo_path": eq.photo_path,
                        "tools_required": eq.tools_required,
                    }
                    for eq in fp.equipment
                ],
                "tickets": [
                    {
                        "id": t.id,
                        "title": t.title,
                        "description": t.description,
                        "x_coordinate": t.x_coordinate,
                        "y_coordinate": t.y_coordinate,
                        "status": t.status,
                        "created_by_id": t.created_by_id,
                    }
                    for t in fp.tickets
                ],
                "reference_points": [
                    {
                        "id": rp.id,
                        "label": rp.label,
                        "x_coordinate": rp.x_coordinate,
                        "y_coordinate": rp.y_coordinate,
                    }
                    for rp in fp.reference_points
                ],
            }
            for fp in db_site.floorplans
        ]
    }

    site_name = db_site.name
    await db.delete(db_site)
    await log_action(db, "delete", "site", site_id, site_name, old_values=old_values, message=f"Deleted site '{site_name}'", user=current_user)
    await db.commit()
    return {"status": "success", "message": f"Site '{site_name}' deleted successfully"}
