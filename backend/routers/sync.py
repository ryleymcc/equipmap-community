import re
from typing import Dict, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from urllib.parse import urlparse

from database import get_db
from utils import get_floorplan_db_hash, get_site_floorplans_db_hash

router = APIRouter(tags=["sync"])

class SyncRequest(BaseModel):
    etags: Dict[str, str]  # URL -> ETag string

class SyncResponse(BaseModel):
    urls_to_update: List[str]

@router.post("/api/sync/check-updates", response_model=SyncResponse)
async def check_updates(payload: SyncRequest, db: AsyncSession = Depends(get_db)):
    urls_to_update = []

    site_floorplans_pattern = re.compile(r'/api/sites/(\d+)/floorplans')
    floorplan_detail_pattern = re.compile(r'/api/floorplans/(\d+)(?!/rooms)(?!/equipment)')
    sites_pattern = re.compile(r'/api/sites$')

    for url, client_etag in payload.etags.items():
        # Parse path from URL (in case it is absolute)
        path = url
        if url.startswith('http://') or url.startswith('https://'):
            path = urlparse(url).path

        def clean_etag(val: str) -> str:
            val = val.strip()
            if val.upper().startswith('W/'):
                val = val[2:]
            return val.strip('"')

        clean_client_etag = clean_etag(client_etag)

        # Check /api/sites
        if sites_pattern.search(path):
            res = await db.execute(text("SELECT md5(COALESCE(string_agg(xmin::text, ',' ORDER BY id), '')) FROM sites"))
            db_hash = res.scalar() or ""
            if clean_client_etag != db_hash:
                urls_to_update.append(url)
            continue

        # Check /api/rooms
        if path.endswith('/api/rooms'):
            res = await db.execute(text("""
                SELECT md5(concat_ws(',',
                    (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM rooms),
                    (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM floorplans),
                    (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM sites)
                ))
            """))
            db_hash = res.scalar() or ""
            if clean_client_etag != db_hash:
                urls_to_update.append(url)
            continue

        # Check /api/equipment
        if path.endswith('/api/equipment'):
            res = await db.execute(text("""
                SELECT md5(concat_ws(',',
                    (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM equipment),
                    (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM floorplans),
                    (SELECT COALESCE(string_agg(xmin::text, ',' ORDER BY id), '') FROM sites)
                ))
            """))
            db_hash = res.scalar() or ""
            if clean_client_etag != db_hash:
                urls_to_update.append(url)
            continue

        # Check /api/sites/{site_id}/floorplans
        match = site_floorplans_pattern.search(path)
        if match:
            site_id = int(match.group(1))
            db_hash = await get_site_floorplans_db_hash(db, site_id)
            if clean_client_etag != db_hash:
                urls_to_update.append(url)
            continue

        # Check /api/floorplans/{floorplan_id}
        match = floorplan_detail_pattern.search(path)
        if match:
            floorplan_id = int(match.group(1))
            db_hash = await get_floorplan_db_hash(db, floorplan_id)
            if not db_hash or clean_client_etag != db_hash:
                urls_to_update.append(url)
            continue

    return SyncResponse(urls_to_update=urls_to_update)
