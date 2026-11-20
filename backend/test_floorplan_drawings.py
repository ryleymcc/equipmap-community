"""Drawing API/inventory regression tests using an isolated SQLite database."""
from pathlib import Path
from unittest.mock import patch
from sqlalchemy import select
from test_photo_support import PhotoApiTests
from routers import floorplan_drawings, audit_logs, data_manager, floorplans, sites
import models


class DrawingApiTests(PhotoApiTests):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        for router in (floorplan_drawings, audit_logs, data_manager, floorplans, sites):
            self.app.include_router(router.router)
        self.drawing_patch = patch.object(floorplan_drawings, 'UPLOAD_DIR', self.folder.name)
        self.drawing_patch.start()

    async def asyncTearDown(self):
        self.drawing_patch.stop()
        await super().asyncTearDown()

    async def upload(self, filename='sheet.svg', **metadata):
        return await self.client.post('/api/floorplans/1/drawings', data={'title': 'West HVAC', 'discipline': 'hvac', **metadata},
            files={'file': (filename, b'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>', 'image/svg+xml')})

    def placement(self):
        return {'base_file_path': '/test.svg', 'x': 2, 'y': 3, 'scale': .75, 'rotation': 5,
                'coverage': {'x': 10, 'y': 20, 'width': 50, 'height': 60}}

    async def test_upload_unique_paths_metadata_and_validation(self):
        a, b = await self.upload('../../drawing.svg', project='West renovation'), await self.upload('../../drawing.svg')
        self.assertEqual(a.status_code, 200, a.text)
        self.assertEqual(a.json()['filename'], 'drawing.svg')
        self.assertNotEqual(a.json()['file_path'], b.json()['file_path'])
        self.assertIsNone(a.json()['placement'])
        self.assertEqual((await self.upload(drawing_date='2025-02-30')).status_code, 422)
        self.assertEqual((await self.upload(title='  ')).status_code, 422)
        self.assertEqual((await self.upload(discipline='  ')).status_code, 422)
        self.assertEqual((await self.upload(discipline='a' * 81)).status_code, 422)
        self.assertEqual((await self.upload(discipline='Fire\x00Protection')).status_code, 422)
        self.assertEqual((await self.upload(filename='sheet.html')).status_code, 400)
        self.assertEqual((await self.upload(page_number=2)).status_code, 422)
        self.assertEqual((await self.client.get('/api/floorplans/999/drawings')).status_code, 404)

    async def test_custom_discipline_on_upload_and_edit(self):
        first = await self.upload(discipline='  Fire   Protection  ')
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()['discipline'], 'Fire Protection')
        second = await self.upload(discipline='fire protection')
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json()['discipline'], 'Fire Protection')

        url = f"/api/floorplans/1/drawings/{first.json()['id']}"
        for name, expected in [('Life Safety', 'Life Safety'), ('Mechanical / HVAC', 'hvac')]:
            edited = await self.client.put(url, json={'title': 'Updated sheet', 'discipline': name})
            self.assertEqual(edited.status_code, 200, edited.text)
            self.assertEqual(edited.json()['discipline'], expected)

    async def test_placement_validation_and_base_revision(self):
        item = (await self.upload()).json()
        url = f"/api/floorplans/1/drawings/{item['id']}/placement"
        response = await self.client.put(url, json=self.placement())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['placement']['crop']['width'], 100)
        for patch_data in [{'scale': 0}, {'scale': 11}, {'rotation': 181}, {'coverage': {'x': 90, 'y': 0, 'width': 20, 'height': 20}}, {'crop': {'x': 0, 'y': 0, 'width': 0, 'height': 100}}]:
            self.assertEqual((await self.client.put(url, json={**self.placement(), **patch_data})).status_code, 422)
        self.assertEqual((await self.client.put(url, json={**self.placement(), 'base_file_path': '/old.svg'})).status_code, 409)
        async with self.sessions() as db:
            db.add(models.Floorplan(id=2, site_id=1, name='Other', file_path='/test.svg', file_type='svg'))
            await db.commit()
        self.assertEqual((await self.client.put(url.replace('/1/', '/2/'), json=self.placement())).status_code, 404)

    async def test_read_only_permissions(self):
        item = (await self.upload()).json()
        self.user.role = 'viewer'
        self.assertEqual((await self.client.get('/api/floorplans/1/drawings')).status_code, 200)
        self.assertEqual((await self.upload()).status_code, 403)
        self.assertEqual((await self.client.put(f"/api/floorplans/1/drawings/{item['id']}/placement", json=self.placement())).status_code, 403)
        self.assertEqual((await self.client.delete(f"/api/floorplans/1/drawings/{item['id']}")).status_code, 403)
        self.user = None
        self.assertEqual((await self.client.get('/api/floorplans/1/drawings')).status_code, 401)

    async def test_inventory_and_remove_undo(self):
        item = (await self.upload()).json()
        self.user.role = 'admin'
        response = await self.client.get('/api/data-manager/uploads')
        row = next(row for row in response.json()['files'] if row['path'].endswith(Path(item['file_path']).name))
        self.assertEqual(row['status'], 'in_use')
        self.assertEqual(row['filename'], 'sheet.svg')
        usage = await self.client.get('/api/data-manager/uploads/usage', params={'path': row['path']})
        self.assertEqual(usage.json()['uses'][0]['relationship'], 'Layer drawing: West HVAC')
        await self.client.delete(f"/api/floorplans/1/drawings/{item['id']}")
        async with self.sessions() as db:
            log = (await db.execute(select(models.AuditLog).where(models.AuditLog.action == 'remove_drawing'))).scalar_one()
            log_id = log.id
        response = await self.client.post(f'/api/audit-logs/{log_id}/undo')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len((await self.client.get('/api/floorplans/1/drawings')).json()), 1)
        self.assertEqual((await self.client.post(f'/api/audit-logs/{log_id}/undo')).status_code, 409)

    async def test_alignment_undo_and_changed_sheet_guard(self):
        item = (await self.upload()).json()
        await self.client.put(f"/api/floorplans/1/drawings/{item['id']}/placement", json=self.placement())
        async with self.sessions() as db:
            log = (await db.execute(select(models.AuditLog).where(models.AuditLog.action == 'align_drawing'))).scalar_one()
            log_id = log.id
        response = await self.client.post(f'/api/audit-logs/{log_id}/undo')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone((await self.client.get('/api/floorplans/1/drawings')).json()[0]['placement'])

    async def test_floorplan_and_site_delete_restore_drawings(self):
        await self.upload()
        for kind in ['floorplan', 'site']:
            response = await self.client.delete('/api/floorplans/1' if kind == 'floorplan' else '/api/sites/1')
            self.assertEqual(response.status_code, 200, response.text)
            async with self.sessions() as db:
                log = (await db.execute(select(models.AuditLog).where(models.AuditLog.action == 'delete', models.AuditLog.target_type == kind))).scalar_one()
                log_id = log.id
            response = await self.client.post(f'/api/audit-logs/{log_id}/undo')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(len((await self.client.get('/api/floorplans/1/drawings')).json()), 1)

    async def test_empty_and_oversize_upload_cleanup(self):
        response = await self.client.post('/api/floorplans/1/drawings', data={'title': 'Empty', 'discipline': 'hvac'}, files={'file': ('empty.pdf', b'', 'application/pdf')})
        self.assertEqual(response.status_code, 400)
        with patch.object(floorplan_drawings, 'MAX_BYTES', 2):
            self.assertEqual((await self.upload()).status_code, 413)
        self.assertFalse(list((Path(self.folder.name) / 'floorplan-drawings').glob('*')))

    async def test_pdf_pages_metadata_undo_and_stale_creation_guard(self):
        import fitz
        with fitz.open() as pdf:
            pdf.new_page(); pdf.new_page()
            source = pdf.tobytes()
        response = await self.client.post('/api/floorplans/1/drawings', data={'title': 'PDF sheet', 'discipline': 'electrical', 'page_number': 2}, files={'file': ('two.pdf', source, 'application/pdf')})
        self.assertEqual(response.status_code, 200, response.text)
        item = response.json()
        url = f"/api/floorplans/1/drawings/{item['id']}"
        await self.client.put(url + '/placement', json=self.placement())
        self.assertEqual((await self.client.put(url, json={'title': 'Changed', 'discipline': 'electrical', 'page_number': 3})).status_code, 400)
        response = await self.client.put(url, json={'title': 'Changed', 'discipline': 'electrical', 'page_number': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['placement'])
        async with self.sessions() as db:
            creation = (await db.execute(select(models.AuditLog).where(models.AuditLog.action == 'upload_drawing'))).scalar_one().id
            edit = (await db.execute(select(models.AuditLog).where(models.AuditLog.action == 'update_drawing'))).scalar_one().id
        self.assertEqual((await self.client.post(f'/api/audit-logs/{creation}/undo')).status_code, 409)
        self.assertEqual((await self.client.post(f'/api/audit-logs/{edit}/undo')).status_code, 200)
        restored = (await self.client.get('/api/floorplans/1/drawings')).json()[0]
        self.assertEqual(restored['page_number'], 2)
        self.assertIsNotNone(restored['placement'])

    async def test_source_validation_and_catalog_rebuild(self):
        from upload_index import reconcile, indexed_inventory
        for contents in [b'<svg><script>alert(1)</script></svg>', b'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/x"/></svg>']:
            response = await self.client.post('/api/floorplans/1/drawings', data={'title': 'Bad', 'discipline': 'hvac'}, files={'file': ('unsafe.svg', contents, 'image/svg+xml')})
            self.assertEqual(response.status_code, 400)
        response = await self.client.post('/api/floorplans/1/drawings', data={'title': 'Bad PDF', 'discipline': 'hvac'}, files={'file': ('bad.pdf', b'invalid', 'application/pdf')})
        self.assertEqual(response.status_code, 400)
        await self.upload()
        async with self.sessions() as db:
            await reconcile(db, self.folder.name)
            rows = await indexed_inventory(db)
            self.assertEqual(rows[0]['status'], 'in_use')
            self.assertEqual(rows[0]['filename'], 'sheet.svg')
