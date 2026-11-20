"""Run with: python -m unittest test_photo_support -v (no production database)."""
import tempfile
import unittest
from pathlib import Path
from io import BytesIO
from unittest.mock import patch
from PIL import Image
from fastapi import FastAPI, HTTPException
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import select
import models
import schemas
from database import Base, get_db
from routers import photos
from utils import get_current_active_user
from photo_pipeline import process_photo, MAX_UPLOAD_BYTES


def image_bytes(size=(2000, 1000), format='JPEG', exif=None):
    output = BytesIO()
    Image.new('RGB', size, 'red').save(output, format, **({'exif': exif} if exif else {}))
    return output.getvalue()


class PipelineTests(unittest.TestCase):
    def test_sizes_metadata_and_unique_urls(self):
        with tempfile.TemporaryDirectory() as folder:
            exif = Image.Exif()
            exif[274] = 6
            exif[270] = 'private description'
            data = image_bytes(exif=exif)
            path = process_photo(data, folder)
            self.assertNotEqual(path, process_photo(data, folder))
            for variant, edge in [('preview', 1280), ('thumb', 160)]:
                filename = Path(folder) / path.removeprefix('/uploads/').replace('.preview.', f'.{variant}.')
                with Image.open(filename) as result:
                    self.assertEqual(result.format, 'WEBP')
                    self.assertLessEqual(max(result.size), edge)
                    self.assertGreater(result.height, result.width)  # Orientation applied.
                    self.assertFalse(result.getexif())
                    self.assertNotIn('icc_profile', result.info)
            self.assertEqual(len(list(Path(folder).rglob('*.*'))), 4)

    def test_invalid_oversize_and_pixel_limit(self):
        for data, status in [(b'<svg/>', 415), (b'x' * (MAX_UPLOAD_BYTES + 1), 413),
                             (image_bytes((6000, 4100), 'PNG'), 413)]:
            with tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(HTTPException) as caught:
                    process_photo(data, folder)
                self.assertEqual(caught.exception.status_code, status)
                self.assertFalse(list(Path(folder).rglob('*.webp')))

    def test_no_upscaling_and_animation_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = process_photo(image_bytes((50, 30)), folder)
            with Image.open(Path(folder) / path.removeprefix('/uploads/')) as result:
                self.assertEqual(result.size, (50, 30))
            output = BytesIO()
            frames = [Image.new('RGB', (20, 20), color) for color in ['red', 'blue']]
            frames[0].save(output, 'WEBP', save_all=True, append_images=frames[1:])
            with self.assertRaises(HTTPException):
                process_photo(output.getvalue(), folder)


class PhotoApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, info={'upload_root': self.folder.name})
        async with self.sessions() as db:
            db.add_all([models.Site(id=1, name='Test'), models.Floorplan(id=1, site_id=1, name='Test', file_path='/test.svg', file_type='svg'), models.Room(id=1, floorplan_id=1, name='Room'), models.Equipment(id=1, floorplan_id=1, name='Pump'),
                        models.User(id=1, username='test', hashed_password='unused', role='editor')])
            await db.commit()
        self.app = FastAPI()
        self.app.include_router(photos.router)
        async def database():
            async with self.sessions() as db:
                yield db
        self.user = models.User(id=1, username='test', role='editor', is_active=True)
        self.app.dependency_overrides[get_db] = database
        self.app.dependency_overrides[get_current_active_user] = lambda: self.user
        self.client = AsyncClient(transport=ASGITransport(app=self.app), base_url='http://test')
        self.files_patch = patch.object(photos, 'UPLOAD_DIR', self.folder.name)
        self.files_patch.start()

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.engine.dispose()
        self.files_patch.stop()
        self.folder.cleanup()

    async def test_upload_replace_remove_and_serialization_for_both_entities(self):
        for kind, model, schema in [('rooms', models.Room, schemas.Room), ('equipment', models.Equipment, schemas.Equipment)]:
            response = await self.client.post(f'/api/{kind}/1/photo', files={'photo': ('../../unsafe.jpg', image_bytes(), 'image/jpeg')})
            self.assertEqual(response.status_code, 200, response.text)
            first = response.json()
            self.assertTrue(first['photo_thumbnail_path'].endswith('.thumb.webp'))
            async with self.sessions() as db:
                item = await db.get(model, 1)
                self.assertEqual(schema.model_validate(item).photo_thumbnail_path, first['photo_thumbnail_path'])
            second = await self.client.post(f'/api/{kind}/1/photo', files={'photo': ('x.jpg', image_bytes(), 'image/jpeg')})
            self.assertNotEqual(first['photo_path'], second.json()['photo_path'])
            removed = await self.client.delete(f'/api/{kind}/1/photo')
            self.assertEqual(removed.json(), {'photo_path': None, 'photo_thumbnail_path': None})
        async with self.sessions() as db:
            logs = (await db.execute(select(models.AuditLog))).scalars().all()
            self.assertEqual(len(logs), 6)

    async def test_permissions_not_found_and_invalid_file_preserve_existing_photo(self):
        response = await self.client.post('/api/rooms/1/photo', files={'photo': ('x.jpg', image_bytes())})
        original = response.json()['photo_path']
        bad = await self.client.post('/api/rooms/1/photo', files={'photo': ('x.jpg', b'broken')})
        self.assertEqual(bad.status_code, 415)
        async with self.sessions() as db:
            self.assertEqual((await db.get(models.Room, 1)).photo_path, original)
        missing = await self.client.post('/api/rooms/999/photo', files={'photo': ('x.jpg', image_bytes())})
        self.assertEqual(missing.status_code, 404)
        self.user = models.User(id=1, role='viewer')
        for method in ['post', 'delete']:
            response = await getattr(self.client, method)('/api/rooms/1/photo', **({'files': {'photo': ('x.jpg', image_bytes())}} if method == 'post' else {}))
            self.assertEqual(response.status_code, 403)
        self.user = None
        self.assertEqual((await self.client.delete('/api/equipment/1/photo')).status_code, 401)


if __name__ == '__main__':
    unittest.main()
