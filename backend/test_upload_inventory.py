import os
import tempfile
import time
import unittest
from pathlib import Path
from upload_inventory import inventory, references

class UploadInventoryTests(unittest.TestCase):
    def test_nested_history_and_photo_pair(self):
        found = references({'floorplans': [{'equipment': [{'photo_path': '/uploads/entity-photos/x.preview.webp'}]}]})
        self.assertEqual(found, {'entity-photos/x.preview.webp', 'entity-photos/x.thumb.webp'})
        self.assertIn('old drawing.pdf', references('https://example.test/uploads/old%20drawing.pdf'))

    def test_reference_protection_scope_and_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ['live.pdf', 'history.svg', 'unused.webp', 'recent.png', 'private.json']:
                (root / name).write_bytes(b'test')
                if name != 'recent.png': os.utime(root / name, (time.time()-90000,)*2)
            (root / 'backups').mkdir()
            (root / 'backups' / 'not-scanned.pdf').write_bytes(b'private')
            try:
                os.symlink(root / 'unused.webp', root / 'link.webp')
                os.symlink(root / 'backups', root / 'entity-photos', target_is_directory=True)
            except OSError:
                pass  # Windows may deny symlink creation without developer mode.
            rows = {r['path']: r for r in inventory(root, {'live.pdf'}, {'history.svg'})}
            self.assertEqual(set(rows), {'live.pdf', 'history.svg', 'unused.webp', 'recent.png'})
            self.assertEqual([rows[n]['status'] for n in ['live.pdf','history.svg','unused.webp','recent.png']], ['in_use','history','unused','unused'])
            first=rows['unused.webp']['fingerprint']
            (root / 'unused.webp').write_bytes(b'changed')
            self.assertNotEqual(first, {r['path']:r for r in inventory(root,set(),set())}['unused.webp']['fingerprint'])

from test_photo_support import PhotoApiTests
from routers import data_manager
from unittest.mock import patch
from sqlalchemy import select
import models

class DataManagerApiTests(PhotoApiTests):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.app.include_router(data_manager.router)
        self.data_patch = patch.object(data_manager, 'UPLOAD_DIR', self.folder.name)
        self.data_patch.start()

    async def asyncTearDown(self):
        self.data_patch.stop()
        await super().asyncTearDown()

    async def test_usage_finds_each_live_owner_and_thumbnail(self):
        from upload_index import reconcile
        self.user.role = 'admin'
        root = Path(self.folder.name)
        (root / 'entity-photos').mkdir(exist_ok=True)
        for variant in ['preview', 'thumb']:
            (root / f'entity-photos/shared.{variant}.webp').write_bytes(b'test')
        async with self.sessions() as db:
            (await db.get(models.Room, 1)).photo_path = '/uploads/entity-photos/shared.preview.webp'
            (await db.get(models.Equipment, 1)).photo_path = '/uploads/entity-photos/shared.preview.webp'
            await db.commit()
            await reconcile(db, root)
        for variant in ['preview', 'thumb']:
            response = await self.client.get('/api/data-manager/uploads/usage', params={'path': f'entity-photos/shared.{variant}.webp'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual({use['type'] for use in response.json()['uses']}, {'rooms', 'equipment'})
            self.assertTrue(all(use['entity']['floorplan_id'] == 1 for use in response.json()['uses']))
            self.assertEqual(response.headers['cache-control'], 'no-store')
        self.user.role = 'viewer'
        self.assertEqual((await self.client.get('/api/data-manager/uploads/usage', params={'path': 'anything.webp'})).status_code, 403)

    async def test_get_uses_catalog_without_disk_scan_and_delete_rechecks(self):
        from upload_index import reconcile
        self.user.role='admin'
        root=Path(self.folder.name)
        (root/'orphan.pdf').write_bytes(b'test')
        os.utime(root/'orphan.pdf',(time.time()-90000,)*2)
        async with self.sessions() as db:
            await reconcile(db, root)
        with patch('upload_index.inventory', side_effect=AssertionError('Page load must not scan disk')):
            response=await self.client.get('/api/data-manager/uploads')
            row=response.json()['files'][0]
            self.assertEqual(row['status'],'unused')
            # A new live reference after the page loaded must prevent deletion.
            async with self.sessions() as db:
                (await db.get(models.Floorplan,1)).file_path='/uploads/orphan.pdf'
                await db.commit()
            response=await self.client.post('/api/data-manager/uploads/delete',json={'files':[{'path':row['path'],'fingerprint':row['fingerprint']}]})
            self.assertEqual(response.status_code,409)
            self.assertTrue((root/'orphan.pdf').exists())

    async def test_discard_undo_keeps_audit_and_blocks_restore(self):
        from routers import audit_logs
        self.app.include_router(audit_logs.router)
        self.user.role='admin'
        root=Path(self.folder.name)
        for path in ['old.pdf','sibling.pdf','unrelated.pdf','active.pdf','recent.pdf']:
            (root/path).write_bytes(b'file')
            if path!='recent.pdf': os.utime(root/path,(time.time()-90000,)*2)
        async with self.sessions() as db:
            retained=models.AuditLog(action='replace_file',target_type='floorplan',target_id=1,
                old_values={'file_path':'/uploads/old.pdf','other':'/uploads/sibling.pdf'})
            unrelated=models.AuditLog(action='update',target_type='floorplan',target_id=1,old_values={'file_path':'/uploads/unrelated.pdf'})
            db.add_all([retained, unrelated, models.AuditLog(action='update',target_type='room',old_values={'photo_path':'/uploads/recent.pdf'})])
            (await db.get(models.Floorplan,1)).file_path='/uploads/active.pdf'
            await db.commit()
            retained_id, unrelated_id=retained.id, unrelated.id
        rows={r['path']:r for r in (await self.client.get('/api/data-manager/uploads')).json()['files']}
        def payload(path, override=False):
            return {'discard_undo':override,'files':[{'path':path,'fingerprint':rows[path]['fingerprint']}]}
        self.assertEqual((await self.client.post('/api/data-manager/uploads/delete',json=payload('old.pdf'))).status_code,409)
        for path in ['active.pdf']:
            self.assertEqual((await self.client.post('/api/data-manager/uploads/delete',json=payload(path,True))).status_code,409)
        result=await self.client.post('/api/data-manager/uploads/delete',json=payload('old.pdf',True))
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['disabled_undo_count'],1)
        self.assertFalse((root/'old.pdf').exists())
        async with self.sessions() as db:
            retained=await db.get(models.AuditLog,retained_id)
            self.assertTrue(retained.undo_unavailable_reason)
            self.assertEqual(retained.old_values['file_path'],'/uploads/old.pdf')
            self.assertIsNone((await db.get(models.AuditLog,unrelated_id)).undo_unavailable_reason)
        response=await self.client.post(f'/api/audit-logs/{retained_id}/undo')
        self.assertEqual(response.status_code,409,response.text)
        rows={r['path']:r for r in (await self.client.get('/api/data-manager/uploads')).json()['files']}
        self.assertEqual(rows['sibling.pdf']['status'],'unused')
        self.assertEqual(rows['unrelated.pdf']['status'],'history')
        # Startup repair must not reinstate references for disabled undo entries.
        await self.client.post('/api/data-manager/uploads/reconcile')
        rows={r['path']:r for r in (await self.client.get('/api/data-manager/uploads')).json()['files']}
        self.assertEqual(rows['sibling.pdf']['status'],'unused')

    async def test_recent_unreferenced_and_undo_retained_files_are_deletable(self):
        self.user.role='admin'
        root=Path(self.folder.name)
        for path in ['new-unused.png','new-retained.png']:
            (root/path).write_bytes(b'fresh')
        async with self.sessions() as db:
            db.add(models.AuditLog(action='update',target_type='room',old_values={'photo_path':'/uploads/new-retained.png'}))
            await db.commit()
        await self.client.post('/api/data-manager/uploads/reconcile')
        rows={r['path']:r for r in (await self.client.get('/api/data-manager/uploads')).json()['files']}
        self.assertEqual(rows['new-unused.png']['status'],'unused')
        self.assertEqual(rows['new-retained.png']['status'],'history')
        result=await self.client.post('/api/data-manager/uploads/delete',json={'discard_undo':True,'files':[{'path':r['path'],'fingerprint':r['fingerprint']} for r in rows.values()]})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['deleted'],2)
        self.assertEqual(result.json()['disabled_undo_count'],1)

    async def test_failed_file_deletion_preserves_undo(self):
        self.user.role='admin'
        root=Path(self.folder.name)
        (root/'retained.pdf').write_bytes(b'file')
        os.utime(root/'retained.pdf',(time.time()-90000,)*2)
        async with self.sessions() as db:
            log=models.AuditLog(action='update',target_type='floorplan',old_values={'file_path':'/uploads/retained.pdf'})
            db.add(log)
            await db.commit()
            log_id=log.id
        row=(await self.client.get('/api/data-manager/uploads')).json()['files'][0]
        with patch.object(Path,'unlink',side_effect=PermissionError('Test locked file')):
            result=await self.client.post('/api/data-manager/uploads/delete',json={'discard_undo':True,'files':[{'path':row['path'],'fingerprint':row['fingerprint']}]})
        self.assertEqual(result.json()['deleted'],0)
        self.assertEqual(result.json()['disabled_undo_count'],0)
        self.assertTrue((root/'retained.pdf').exists())
        async with self.sessions() as db:
            self.assertIsNone((await db.get(models.AuditLog,log_id)).undo_unavailable_reason)

    async def test_cleanup_permissions_and_revalidation(self):
        response = await self.client.get('/api/data-manager/uploads')
        self.assertEqual(response.status_code,403)
        self.user.role='admin'
        root=Path(self.folder.name)
        for name in ['used.pdf','old.pdf','unused.pdf','recent.png']:
            (root/name).write_bytes(b'test')
            if name!='recent.png': os.utime(root/name,(time.time()-90000,)*2)
        async with self.sessions() as db:
            (await db.get(models.Floorplan,1)).file_path='/uploads/used.pdf'
            db.add(models.AuditLog(action='update',target_type='floorplan',old_values={'file_path':'/uploads/old.pdf'}))
            await db.commit()
        self.assertEqual((await self.client.post('/api/data-manager/uploads/reconcile')).status_code,200)
        scan=await self.client.get('/api/data-manager/uploads')
        self.assertEqual(scan.headers['cache-control'],'no-store')
        rows={r['path']:r for r in scan.json()['files']}
        for name in ['used.pdf','old.pdf']:
            response=await self.client.post('/api/data-manager/uploads/delete',json={'files':[{'path':name,'fingerprint':rows[name]['fingerprint']}]})
            self.assertEqual(response.status_code,409)
        response=await self.client.post('/api/data-manager/uploads/delete',json={'files':[{'path':'../outside.pdf','fingerprint':'x'*64}]})
        self.assertEqual(response.status_code,409)
        chosen=rows['unused.pdf']
        (root/'unused.pdf').write_bytes(b'changed')
        os.utime(root/'unused.pdf',(time.time()-90000,)*2)
        response=await self.client.post('/api/data-manager/uploads/delete',json={'files':[{'path':chosen['path'],'fingerprint':chosen['fingerprint']}]})
        self.assertEqual(response.status_code,409)
        self.assertEqual((await self.client.post('/api/data-manager/uploads/reconcile')).status_code,200)
        scan=await self.client.get('/api/data-manager/uploads')
        chosen=next(r for r in scan.json()['files'] if r['path']=='unused.pdf')
        response=await self.client.post('/api/data-manager/uploads/delete',json={'files':[{'path':chosen['path'],'fingerprint':chosen['fingerprint']}]})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['deleted'],1)
        self.assertFalse((root/'unused.pdf').exists())
        self.assertTrue((root/'used.pdf').exists())
        async with self.sessions() as db:
            logs=(await db.execute(select(models.AuditLog).where(models.AuditLog.action=='cleanup'))).scalars().all()
            self.assertEqual(len(logs),1)
        self.user=None
        self.assertEqual((await self.client.get('/api/data-manager/uploads')).status_code,401)

class IncrementalUploadIndexTests(PhotoApiTests):
    async def catalog(self):
        from upload_index import indexed_inventory
        async with self.sessions() as db:
            return {row['path']: row for row in await indexed_inventory(db)}

    async def test_upload_replace_remove_undo_delete_and_rollback(self):
        from test_photo_support import image_bytes
        from upload_index import indexed_inventory
        with patch('upload_index.inventory',side_effect=AssertionError('Mutations must be incremental')):
            first=await self.client.post('/api/rooms/1/photo',files={'photo':('one.jpg',image_bytes(),'image/jpeg')})
            self.assertEqual(first.status_code,200,first.text)
            old=first.json()['photo_path']
            rows=await self.catalog()
            self.assertEqual(len(rows),2)
            self.assertTrue(all(row['status']=='in_use' for row in rows.values()))
            second=await self.client.post('/api/rooms/1/photo',files={'photo':('two.jpg',image_bytes(),'image/jpeg')})
            new=second.json()['photo_path']
            rows=await self.catalog()
            self.assertEqual(len(rows),4)
            self.assertEqual(rows[old.removeprefix('/uploads/')]['status'],'history')
            self.assertEqual(rows[new.removeprefix('/uploads/')]['status'],'in_use')
            await self.client.delete('/api/rooms/1/photo')
            self.assertTrue(all(row['status']=='history' for row in (await self.catalog()).values()))
            async with self.sessions() as db:
                room=await db.get(models.Room,1)
                room.photo_path=old
                await db.commit()  # Same reference mutation used by audit undo.
            self.assertEqual((await self.catalog())[old.removeprefix('/uploads/')]['status'],'in_use')
            async with self.sessions() as db:
                room=await db.get(models.Room,1)
                room.photo_path=new
                await db.flush()
                await db.rollback()
            rows=await self.catalog()
            self.assertEqual(rows[old.removeprefix('/uploads/')]['status'],'in_use')
            self.assertEqual(rows[new.removeprefix('/uploads/')]['status'],'history')
            async with self.sessions() as db:
                await db.delete(await db.get(models.Room,1))
                await db.commit()
            self.assertTrue(all(row['status']=='history' for row in (await self.catalog()).values()))

    async def test_photo_original_names_survive_removal_and_reconcile(self):
        from test_photo_support import image_bytes
        from upload_index import reconcile
        for kind in ('rooms', 'equipment'):
            result = await self.client.post(f'/api/{kind}/1/photo', files={
                'photo': ('pump name.jpg', image_bytes(), 'image/jpeg')})
            self.assertEqual(result.status_code, 200)
            paths = [result.json()['photo_path'].removeprefix('/uploads/'),
                     result.json()['photo_thumbnail_path'].removeprefix('/uploads/')]
            for path in paths:
                self.assertEqual((await self.catalog())[path]['filename'], 'pump name.jpg')
            await self.client.delete(f'/api/{kind}/1/photo')
            async with self.sessions() as db:
                await reconcile(db, self.folder.name)
            for path in paths:
                row = (await self.catalog())[path]
                self.assertEqual(row['filename'], 'pump name.jpg')
                self.assertEqual(row['status'], 'history')

    async def test_previous_floorplan_and_cascading_deletion(self):
        root=Path(self.folder.name)
        for path in ['current.pdf','previous.pdf','room.png','equipment.png']:
            (root/path).write_bytes(b'file')
        snapshot={'file_path':'/uploads/current.pdf','previous_file_path':'/uploads/previous.pdf',
                  'rooms':[{'photo_path':'/uploads/room.png'}],
                  'equipment':[{'photo_path':'/uploads/equipment.png'}]}
        async with self.sessions() as db:
            floor=await db.get(models.Floorplan,1)
            floor.file_path=snapshot['file_path']
            floor.previous_file_path=snapshot['previous_file_path']
            (await db.get(models.Room,1)).photo_path='/uploads/room.png'
            (await db.get(models.Equipment,1)).photo_path='/uploads/equipment.png'
            await db.commit()
        self.assertEqual(len(await self.catalog()),4)
        self.assertTrue(all(row['status']=='in_use' for row in (await self.catalog()).values()))
        async with self.sessions() as db:
            db.add(models.AuditLog(action='delete',target_type='site',old_values={'floorplans':[snapshot]}))
            await db.delete(await db.get(models.Site,1))
            await db.commit()
        self.assertTrue(all(row['status']=='history' for row in (await self.catalog()).values()))

    async def test_reconcile_external_files_and_age_without_rescan(self):
        from upload_index import reconcile, indexed_inventory
        root=Path(self.folder.name)
        (root/'external.pdf').write_bytes(b'file')
        async with self.sessions() as db:
            await reconcile(db,root)
        self.assertEqual((await self.catalog())['external.pdf']['status'],'unused')
        with patch('upload_index.inventory',side_effect=AssertionError('No disk scan')):
            self.assertEqual((await self.catalog())['external.pdf']['status'],'unused')
        (root/'external.pdf').unlink()
        async with self.sessions() as db:
            await reconcile(db,root)
        self.assertNotIn('external.pdf',await self.catalog())

if __name__ == '__main__': unittest.main()
