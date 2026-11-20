"""Isolated browser-test server. Run after the frontend build; never opens the app database."""
import sys
import tempfile
import os
import json
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from database import Base, get_db
from utils import get_current_active_user
from routers import floorplan_drawings
import models

root = Path(__file__).resolve().parents[2]
preview_data = os.environ.get('DRAWING_PREVIEW_DATA')
files = None if preview_data else tempfile.TemporaryDirectory(prefix='equipmap-drawing-browser-')
uploads = Path(preview_data or files.name).resolve()
uploads.mkdir(parents=True, exist_ok=True)
floorplan_drawings.UPLOAD_DIR = str(uploads)
engine = create_async_engine('sqlite+aiosqlite:///' + (uploads / 'fixture.sqlite3').as_posix() if preview_data else 'sqlite+aiosqlite:///:memory:')
sessions = async_sessionmaker(engine, expire_on_commit=False, info={'upload_root': str(uploads)})
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200"><rect width="2000" height="1200" fill="white"/><path d="M100 100H1900V1100H100ZM100 500H1900M600 100V500M1200 100V500M600 650V1100M1200 650V1100M100 650H1900" fill="none" stroke="#455266" stroke-width="8"/></svg>'
(uploads / 'base.svg').write_text(svg)
(uploads / 'replacement.svg').write_text(svg)
import fitz
with fitz.open() as pdf:
    for label in ['First page', 'Second page']:
        page = pdf.new_page(width=1000, height=600)
        page.insert_text((80, 80), label)
        page.draw_line((100, 150), (800, 450))
    pdf.save(uploads / 'pages.pdf')
from PIL import Image
Image.new('RGB', (1000, 600), 'lightblue').save(uploads / 'image.png')


@asynccontextmanager
async def lifespan(app):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with sessions() as db:
        if not await db.get(models.Site, 1):
            restored_floor = json.loads((uploads / 'restored-floor.json').read_text()) if (uploads / 'restored-floor.json').exists() else {}
            db.add_all([models.Site(id=1, name='Drawing test site'), models.Floorplan(id=1, site_id=1, name='Level 2', file_path=restored_floor.get('file_path', '/uploads/base.svg'), file_type='svg'), models.User(id=1, username='tester', role='editor', hashed_password='unused')])
            await db.flush()
            if (uploads / 'restored-drawings.json').exists():
                for values in json.loads((uploads / 'restored-drawings.json').read_text()):
                    db.add(models.FloorplanDrawing(**values))
            await db.commit()
    yield
    await engine.dispose()
    if files:
        files.cleanup()


app = FastAPI(lifespan=lifespan)
async def database():
    async with sessions() as db:
        yield db
app.dependency_overrides[get_db] = database
app.dependency_overrides[get_current_active_user] = lambda: models.User(id=1, username='tester', role='editor', is_active=True)
app.include_router(floorplan_drawings.router)


@app.get('/fixture/start', response_class=HTMLResponse)
async def start_preview():
    return '<script>localStorage.setItem("token","isolated-drawing-fixture");location.replace("/map/1");</script>'


@app.get('/api/fixture/recover', response_class=HTMLResponse)
async def recover_preview():
    return HTMLResponse('''<script>(async()=>{
      for(const name of ['equipment','rooms','tickets']){
        const key='equipmap_cache_'+name, raw=localStorage.getItem(key);
        if(raw){try{const value=JSON.parse(raw);if(!Array.isArray(value.data??value))localStorage.removeItem(key);}catch{localStorage.removeItem(key);}}
      }
      if('caches' in window)for(const name of await caches.keys()){
        const cache=await caches.open(name);
        for(const request of await cache.keys())if(['/api/equipment','/api/rooms','/api/tickets'].includes(new URL(request.url).pathname))await cache.delete(request);
      }
      localStorage.setItem('token','isolated-drawing-fixture');location.replace('/?siteId=1');
    })();</script>''', headers={'Cache-Control': 'no-store'})


@app.get('/api/users/me')
async def user():
    return {'id': 1, 'username': 'tester', 'role': 'editor', 'can_manage_items': True}


@app.get('/api/floorplans/1')
async def floor():
    async with sessions() as db:
        item = await db.get(models.Floorplan, 1)
        return {'id': 1, 'site_id': 1, 'name': item.name, 'file_path': item.file_path, 'file_type': 'svg', 'pin_size': 16, 'rooms': [], 'equipment': [{'id': 1, 'floorplan_id': 1, 'name': 'Test AHU', 'description': 'Drawing test equipment', 'x_coordinate': 1000, 'y_coordinate': 600, 'color': '#10b981', 'photo_path': None}], 'tickets': [], 'reference_points': []}


@app.get('/api/equipment/1/documents')
async def documents():
    return []


@app.get('/api/sites/1/floorplans')
async def floors():
    return [await floor()]


@app.get('/api/sites')
async def sites():
    return [{'id': 1, 'name': 'Drawing test site'}]


@app.get('/api/equipment')
async def equipment():
    return (await floor())['equipment']


@app.get('/api/rooms')
@app.get('/api/tickets')
@app.get('/api/audit-logs')
async def empty_lists():
    return []


@app.get('/api/chatgpt/pending-changes')
async def pending():
    return {'results': [], 'has_more': False}


@app.post('/api/sync/check-updates')
async def check_updates():
    return {'urls_to_update': []}


@app.post('/fixture/replace-base')
async def replace():
    async with sessions() as db:
        item = await db.get(models.Floorplan, 1)
        item.file_path = '/uploads/replacement.svg'
        await db.commit()
    return {'ok': True}


app.mount('/uploads', StaticFiles(directory=uploads), name='uploads')
app.mount('/assets', StaticFiles(directory=root / 'frontend/dist/assets'), name='assets')


@app.get('/api/{path:path}')
async def missing_api(path: str):
    return JSONResponse({'detail': 'This endpoint is not available in the drawing preview.'}, status_code=404, headers={'Cache-Control': 'no-store'})


@app.get('/{path:path}')
async def frontend(path: str):
    destination = (root / 'frontend/dist' / path).resolve()
    if destination.is_relative_to(root / 'frontend/dist') and destination.is_file():
        return FileResponse(destination)
    return FileResponse(root / 'frontend/dist/index.html')


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('DRAWING_PREVIEW_PORT', '8768')), log_level='warning')
