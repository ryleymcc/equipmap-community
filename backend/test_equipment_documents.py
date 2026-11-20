import unittest
from pathlib import Path
from unittest.mock import patch
import test_photo_support
from routers import equipment_documents as documents, audit_logs, data_manager
import models

class DocumentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await test_photo_support.PhotoApiTests.asyncSetUp(self)
        self.app.include_router(documents.router)
        self.app.include_router(audit_logs.router)
        self.app.include_router(data_manager.router)
        self.data_patch = patch.object(data_manager, "UPLOAD_DIR", self.folder.name)
        self.data_patch.start()
        self.document_patch = patch.object(documents, 'UPLOAD_DIR', self.folder.name)
        self.document_patch.start()

    async def asyncTearDown(self):
        self.document_patch.stop()
        self.data_patch.stop()
        await test_photo_support.PhotoApiTests.asyncTearDown(self)

    async def test_document_lifecycle(self):
        url = '/api/equipment/1/documents'
        response = await self.client.post(url, files={'file': ('../../manual.pdf', b'%PDF-1.4 test')})
        self.assertEqual(response.status_code, 200, response.text)
        doc = response.json()
        self.assertEqual(doc['filename'], 'manual.pdf')
        self.assertTrue((Path(self.folder.name) / doc['path'].removeprefix('/uploads/')).exists())
        self.assertEqual(len((await self.client.get(url)).json()), 1)
        self.assertEqual((await self.client.delete(f"/api/equipment/999/documents/{doc['id']}")).status_code, 404)
        self.assertEqual((await self.client.delete(f"{url}/{doc['id']}")).status_code, 200)
        self.assertEqual((await self.client.get(url)).json(), [])

    async def test_documents_in_storage_inventory(self):
        from upload_index import reconcile
        self.user.role = 'admin'
        url = '/api/equipment/1/documents'
        for extension in ('pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'):
            doc = (await self.client.post(url, files={'file': (f'manual.{extension}', b'test file')})).json()
            path = doc['path'].removeprefix('/uploads/')
            rows = {r['path']: r for r in (await self.client.get('/api/data-manager/uploads')).json()['files']}
            self.assertEqual(rows[path]['status'], 'in_use')
            self.assertEqual(rows[path]['filename'], f'manual.{extension}')
            selection = {'discard_undo': True, 'files': [{'path': path, 'fingerprint': rows[path]['fingerprint']}]}
            self.assertEqual((await self.client.post('/api/data-manager/uploads/delete', json=selection)).status_code, 409)
            uses = (await self.client.get('/api/data-manager/uploads/usage', params={'path': path})).json()['uses']
            self.assertEqual(uses[0]['id'], 1)
            self.assertEqual(uses[0]['relationship'], f'Document: manual.{extension}')
            # Rebuild also finds files uploaded before the document index existed.
            async with self.sessions() as db:
                self.assertEqual(await reconcile(db, self.folder.name), 1)
            await self.client.delete(f"{url}/{doc['id']}")
            rows = {r['path']: r for r in (await self.client.get('/api/data-manager/uploads')).json()['files']}
            self.assertEqual(rows[path]['status'], 'history')
            self.assertEqual(rows[path]['filename'], f'manual.{extension}')
            self.assertEqual((await self.client.post('/api/data-manager/uploads/delete', json=selection)).status_code, 200)
            self.assertFalse((Path(self.folder.name) / path).exists())
            self.assertEqual((await self.client.get('/api/data-manager/uploads')).json()['files'], [])

    async def test_document_validation_permissions(self):
        url = '/api/equipment/1/documents'
        for name, data, expected in [('bad.html', b'<script/>', 400), ('empty.pdf', b'', 400), ('large.pdf', b'x' * (documents.MAX_BYTES + 1), 413)]:
            self.assertEqual((await self.client.post(url, files={'file': (name, data)})).status_code, expected)
        self.assertFalse(list(Path(self.folder.name).rglob('*.*')))
        self.user = models.User(id=1, role='viewer', is_active=True)
        self.assertEqual((await self.client.post(url, files={'file': ('x.pdf', b'test')})).status_code, 403)
        self.assertEqual((await self.client.delete(url + '/1')).status_code, 403)

    async def test_document_audit_and_undo(self):
        url = '/api/equipment/1/documents'
        doc = (await self.client.post(url, files={'file': ('manual.pdf', b'%PDF test')})).json()
        logs = (await self.client.get('/api/audit-logs')).json()
        upload = next(log for log in logs if log['action'] == 'upload_document')
        self.assertEqual(upload['new_values']['id'], doc['id'])
        self.assertEqual(upload['new_values']['filename'], 'manual.pdf')
        self.assertEqual(upload['user_id'], 1)
        await self.client.delete(f"{url}/{doc['id']}")
        logs = (await self.client.get('/api/audit-logs')).json()
        removal = next(log for log in logs if log['action'] == 'remove_document')
        self.assertEqual(removal['old_values']['path'], doc['path'])
        response = await self.client.post(f"/api/audit-logs/{removal['id']}/undo")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((await self.client.get(url)).json()[0]['id'], doc['id'])
        self.assertEqual((await self.client.post(f"/api/audit-logs/{removal['id']}/undo")).status_code, 409)
        response = await self.client.post(f"/api/audit-logs/{upload['id']}/undo")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((await self.client.get(url)).json(), [])
        (Path(self.folder.name) / doc['path'].removeprefix('/uploads/')).unlink()
        self.assertEqual((await self.client.post(f"/api/audit-logs/{removal['id']}/undo")).status_code, 409)

if __name__ == '__main__':
    unittest.main()
