"""Two independent local servers simulating two PCs using one shared folder."""
from concurrent.futures import ThreadPoolExecutor
import ctypes
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import httpx
import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent


def main():
    source_mode = '--source' in sys.argv
    leave_running = '--leave-running' in sys.argv
    fixture = ROOT / ('test-data-shared-' + str(time.time_ns()))
    fixture.mkdir()
    shared, cache_a, cache_b = [fixture / name for name in ('share', 'client-a', 'client-b')]
    password_file = fixture / 'initial-password.txt'
    password_file.write_text('x')
    command = [sys.executable, str(ROOT / 'shared_launcher.py')] if source_mode else [str(ROOT / 'dist/EquipMap-Shared/EquipMap-Shared.exe')]
    processes = []
    checks = []
    def passed(name):
        checks.append(name)
        print('PASS', name, flush=True)
    def start(cache, bootstrap=False):
        args = [*command, '--headless', '--no-browser', '--data-dir', str(shared), '--cache-dir', str(cache)]
        if bootstrap:
            args += ['--initial-admin-password-file', str(password_file)]
        env = {key: value for key, value in os.environ.items() if key not in ('PYTHONHOME', 'PYTHONPATH')}
        if not source_mode:
            env['PATH'] = os.environ['SystemRoot'] + '\\System32'
        process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
        processes.append((process, cache))
        deadline = time.monotonic() + 90
        while not (cache / 'ready.json').exists():
            if process.poll() is not None or time.monotonic() > deadline:
                log = cache / 'logs/equipmap.log'
                raise AssertionError(log.read_text()[-10000:] if log.exists() else 'Startup failed without a log')
            time.sleep(.1)
        return json.loads((cache / 'ready.json').read_text())
    def stop(process, cache):
        state = json.loads((cache / 'ready.json').read_text())
        (cache / 'stop.request').write_text(state['instance'])
        assert process.wait(timeout=40) == 0
    def call(client, method, path, **kwargs):
        response = client.request(method, path, **kwargs)
        assert response.is_success, (method, path, response.status_code, response.text[:1000])
        return response.json()
    success = False
    try:
        assert not ctypes.windll.shell32.IsUserAnAdmin()
        state_a = start(cache_a, True)
        state_b = start(cache_b)
        passed('two non-elevated app processes share one authoritative folder, with independent local caches')
        with httpx.Client(base_url=state_a['url'], timeout=60, trust_env=False) as a, httpx.Client(base_url=state_b['url'], timeout=60, trust_env=False) as b:
            sessions = []
            for client in (a, b):
                token = call(client, 'POST', '/api/token', data={'username': 'admin', 'password': 'x'})
                sessions.append(token)
                client.headers['Authorization'] = 'Bearer ' + token['access_token']
            site = call(a, 'POST', '/api/sites', json={'name': 'Portable Test Facility'})
            assert call(b, 'GET', '/api/sites')[0]['id'] == site['id']
            passed('one-character shared administrator login and cross-client site visibility')
            pdf = pymupdf.open()
            page = pdf.new_page(width=720, height=480)
            page.draw_rect(pymupdf.Rect(40, 40, 680, 440))
            page.insert_text((80, 90), 'Portable facility floorplan', fontsize=20)
            page.insert_text((250, 230), '1EN01', fontsize=30)
            pdf_bytes = pdf.tobytes()
            fp = call(a, 'POST', '/api/floorplans', data={'site_id': site['id'], 'name': 'Offline PDF'},
                      files={'file': ('shared-plan.pdf', pdf_bytes, 'application/pdf')})
            assert call(b, 'GET', f'/api/floorplans/{fp["id"]}')['name'] == 'Offline PDF'
            assert b.get('/uploads/shared-plan.pdf').content == pdf_bytes
            passed('floorplan database records and uploaded PDF propagate to the other process')
            eq = call(a, 'POST', '/api/equipment', data={'floorplan_id': fp['id'], 'name': 'AHU-Portable',
                      'description': 'Shared unit', 'x_coordinate': 1000, 'y_coordinate': 750})
            def add_room(index):
                client = a if index % 2 == 0 else b
                for _ in range(20):
                    response = client.post('/api/rooms', json={'floorplan_id': fp['id'], 'name': f'R{index}',
                                            'x_coordinate': 100 + index * 20, 'y_coordinate': 150})
                    if response.status_code == 409:
                        time.sleep(.02)
                        continue
                    assert response.is_success, response.text
                    return response.json()
                raise AssertionError('Writer could not finish after conflicts')
            with ThreadPoolExecutor(max_workers=2) as executor:
                rooms = list(executor.map(add_room, range(12)))
            names = {room['name'] for room in call(a, 'GET', f'/api/floorplans/{fp["id"]}/rooms')}
            assert names == {f'R{i}' for i in range(12)}
            assert len({room['id'] for room in rooms}) == 12
            passed('simultaneous writers preserve all twelve unique records; conflicts fail explicitly and can be retried')
            call(b, 'PUT', f'/api/equipment/{eq["id"]}', data={'name': 'AHU-Portable', 'description': 'Saved on the second PC'})
            assert call(a, 'GET', f'/api/floorplans/{fp["id"]}')['equipment'][0]['description'] == 'Saved on the second PC'
            ticket = call(b, 'POST', '/api/tickets', json={'floorplan_id': fp['id'], 'title': 'Shared issue', 'description': 'Repair needed', 'x_coordinate': 1200, 'y_coordinate': 600})
            call(a, 'PUT', f'/api/tickets/{ticket["id"]}', json={'status': 'closed'})
            assert call(b, 'GET', '/api/tickets')[0]['status'] == 'closed'
            call(a, 'DELETE', f'/api/tickets/{ticket["id"]}')
            ticket_log = next(log for log in call(b, 'GET', '/api/audit-logs') if log['target_type'] == 'ticket' and log['action'] == 'delete')
            call(b, 'POST', f'/api/audit-logs/{ticket_log["id"]}/undo')
            assert call(a, 'GET', '/api/tickets')[0]['id'] == ticket['id']
            call(a, 'POST', '/api/users', json={'username': 'shared-viewer', 'password': 'v', 'role': 'viewer', 'can_manage_items': False})
            with httpx.Client(base_url=state_b['url'], trust_env=False, timeout=60) as viewer:
                viewer_token = call(viewer, 'POST', '/api/token', data={'username': 'shared-viewer', 'password': 'v'})
                viewer.headers['Authorization'] = 'Bearer ' + viewer_token['access_token']
                assert viewer.post('/api/sites', json={'name': 'Not permitted'}).status_code == 403
            passed('cross-client record edits, ticket CRUD/undo, shared accounts and viewer write restrictions')
            assert any(item['name'] == 'AHU-Portable' for item in call(b, 'GET', '/api/search?q=AHU-Portable'))
            call(b, 'POST', '/api/sync/check-updates', json={'etags': {}})
            call(b, 'GET', '/api/equipment')
            call(b, 'GET', '/api/rooms')
            passed('search, entity listings and cache-update endpoints work with local SQLite snapshots')
            photo = io.BytesIO()
            Image.new('RGB', (800, 600), '#3b82f6').save(photo, 'JPEG')
            photo_info = call(a, 'POST', f'/api/equipment/{eq["id"]}/photo', files={'photo': ('shared-photo.jpg', photo.getvalue(), 'image/jpeg')})
            assert b.get(photo_info['photo_thumbnail_path']).status_code == 200
            doc = call(a, 'POST', f'/api/equipment/{eq["id"]}/documents', files={'file': ('AHU manual.pdf', pdf_bytes, 'application/pdf')})
            assert call(b, 'GET', f'/api/equipment/{eq["id"]}/documents')[0]['filename'] == 'AHU manual.pdf'
            assert b.get(doc['path']).content == pdf_bytes
            call(b, 'DELETE', f'/api/equipment/{eq["id"]}/documents/{doc["id"]}')
            logs = call(a, 'GET', '/api/audit-logs')
            removal = next(log for log in logs if log['action'] == 'remove_document')
            call(a, 'POST', f'/api/audit-logs/{removal["id"]}/undo')
            assert len(call(b, 'GET', f'/api/equipment/{eq["id"]}/documents')) == 1
            inventory = call(b, 'GET', '/api/data-manager/uploads')['files']
            assert len(inventory) >= 4
            passed('photo, manual, inventory and audit undo propagate across both clients')
            job = call(a, 'POST', f'/api/floorplans/{fp["id"]}/room-scan', json={'dpi': 300})
            deadline = time.monotonic() + 60
            while True:
                scan = call(a, 'GET', f'/api/floorplans/{fp["id"]}/room-scan/{job["id"]}')
                if scan['status'] in ('error', 'ready'):
                    break
                assert time.monotonic() < deadline
                time.sleep(.3)
            assert scan['status'] == 'ready', scan
            passed('local English OCR remains functional')
            refreshed = call(b, 'POST', '/api/refresh-token', json={'refresh_token': sessions[0]['refresh_token']})
            a.headers['Authorization'] = 'Bearer ' + refreshed['access_token']
            call(a, 'GET', '/api/users/me')
            call(b, 'POST', '/api/auth/logout', json={'refresh_token': refreshed['refresh_token']},
                 headers={'Authorization': 'Bearer ' + refreshed['access_token']})
            assert a.get('/api/users/me').status_code == 401
            new_token = call(a, 'POST', '/api/token', data={'username': 'admin', 'password': 'x'})
            a.headers['Authorization'] = 'Bearer ' + new_token['access_token']
            passed('session rotation and logout revocation propagate between independent clients')
            # An inaccessible shared folder must never report a successful save
            # into a private per-user database instead.
            unavailable = shared.with_name('share-disconnected')
            shared.rename(unavailable)
            try:
                response = a.post('/api/sites', json={'name': 'Must not save'})
                assert response.status_code == 503
            finally:
                unavailable.rename(shared)
            assert all(row['name'] != 'Must not save' for row in call(b, 'GET', '/api/sites'))
            passed('unavailable share fails closed without accepting a local-only save')
        # Prove neither local cache is the sole copy: delete BOTH stopped caches,
        # then reconstruct a new client from the shared folder alone.
        for process, cache in processes:
            stop(process, cache)
        processes.clear()
        for cache in (cache_a, cache_b):
            assert cache.resolve().is_relative_to(fixture.resolve())
            shutil.rmtree(cache)
        restored = start(cache_a)
        with httpx.Client(base_url=restored['url'], trust_env=False, timeout=60) as a:
            assert len(call(a, 'GET', f'/api/floorplans/{fp["id"]}/rooms')) == 12
            assert a.get(doc['path']).content == pdf_bytes
        passed('all records and files restore from the shared folder after both Windows-user caches are removed')
        results = ROOT / 'test-results'
        results.mkdir(exist_ok=True)
        # Reuse the UI regression test against the shared edition fixture.
        (cache_a / 'initial-password.txt').write_text('x')
        evidence = dict(checks=checks, data=str(cache_a), shared_root=str(shared), url=restored['url'],
                        floorplan_id=fp['id'], equipment_id=eq['id'], source_mode=source_mode,
                        smb_tested=False, elevated=False)
        (results / 'shared-smoke.json').write_text(json.dumps(evidence, indent=2))
        success = True
    finally:
        if not success or not leave_running:
            for process, cache in processes:
                if process.poll() is None and (cache / 'ready.json').exists():
                    stop(process, cache)


if __name__ == '__main__':
    main()
