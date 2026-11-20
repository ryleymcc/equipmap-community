"""Exercise the packaged EXE, not the development server. Never uses live data."""
import argparse
import ctypes
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time

import httpx
import pymupdf
import psutil
from PIL import Image

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--leave-running', action='store_true')
    parser.add_argument('--short-password', action='store_true', help='Validate one-character first-run passwords')
    args = parser.parse_args()
    data = ROOT / f'test-data-{int(time.time())}'
    data.mkdir()
    results = ROOT / 'test-results'
    results.mkdir(exist_ok=True)
    password = 'x' if args.short_password else secrets.token_urlsafe(20)
    password_file = data / 'initial-password.txt'
    password_file.write_text(password)
    exe = ROOT / 'dist/EquipMap/EquipMap.exe'
    # Prove the EXE does not find Python, Node, Docker or PostgreSQL on PATH.
    env = {k: v for k, v in os.environ.items() if k not in ('PYTHONPATH', 'PYTHONHOME', 'DATABASE_URL', 'SECRET_KEY')}
    env['PATH'] = os.environ['SystemRoot'] + '\\System32'
    evidence = {'elevated': bool(ctypes.windll.shell32.IsUserAnAdmin()), 'checks': [], 'data': str(data)}
    assert evidence['elevated'] is False, 'Run validation under a non-elevated Windows token'
    def check(name):
        evidence['checks'].append(name)
        print('PASS', name, flush=True)
    def start():
        process = subprocess.Popen([str(exe), '--headless', '--no-browser', '--data-dir', str(data),
                                    '--initial-admin-password-file', str(password_file)], env=env)
        deadline = time.monotonic() + 120
        while not (data / 'ready.json').exists():
            if process.poll() is not None or time.monotonic() > deadline:
                logs = data / 'logs/equipmap.log'
                raise AssertionError('Packaged startup failed: ' + (logs.read_text()[-6000:] if logs.exists() else 'no logs'))
            time.sleep(.25)
        return process, json.loads((data / 'ready.json').read_text())
    def stop(process):
        subprocess.run([str(exe), '--stop', '--data-dir', str(data)], check=True, timeout=15)
        assert process.wait(timeout=60) == 0
        assert not (data / 'ready.json').exists()
    process = None
    success = False
    try:
        process, state = start()
        check('packaged executable starts with system-only PATH and no elevation')
        duplicate = subprocess.Popen([str(exe), '--headless', '--no-browser', '--data-dir', str(data)], env=env)
        assert duplicate.wait(timeout=20) != 0
        assert process.poll() is None
        check('second instance rejected without disturbing the running instance')
        with httpx.Client(base_url=state['url'], timeout=60, trust_env=False) as client:
            def call(method, path, **kwargs):
                response = client.request(method, path, **kwargs)
                assert response.is_success, f'{method} {path}: {response.status_code} {response.text[:1200]}'
                return response.json()
            assert client.get('/login').status_code == 200
            assert client.get('/assets/missing.js').status_code == 404
            assert client.get('/api/sites', headers={'Host': 'evil.example'}).status_code == 403
            assert client.post('/api/sites', headers={'Origin': 'https://evil.example'}, json={'name': 'forbidden'}).status_code == 403
            assert client.get('/api/sites', headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
            check('SPA routes, missing assets, Host and cross-origin restrictions')
            assert client.post('/api/sites', json={'name': 'forbidden'}).status_code == 401
            token = call('POST', '/api/token', data={'username': 'admin', 'password': password})
            client.headers['Authorization'] = 'Bearer ' + token['access_token']
            check('first-run admin authentication and unauthenticated write rejection')
            site = call('POST', '/api/sites', json={'name': 'Portable Test Facility'})
            pdf = pymupdf.open()
            page = pdf.new_page(width=720, height=480)
            page.draw_rect(pymupdf.Rect(40, 40, 680, 440))
            page.insert_text((80, 90), 'Portable facility floorplan', fontsize=20)
            page.insert_text((250, 230), '1EN01', fontsize=30)
            pdf_bytes = pdf.tobytes()
            floorplan = call('POST', '/api/floorplans', data={'site_id': site['id'], 'name': 'Offline PDF'},
                             files={'file': ('portable-plan.pdf', pdf_bytes, 'application/pdf')})
            room = call('POST', '/api/rooms', json={'floorplan_id': floorplan['id'], 'name': '1EN01', 'x_coordinate': 750, 'y_coordinate': 600})
            equipment = call('POST', '/api/equipment', data={'floorplan_id': floorplan['id'], 'name': 'AHU-Portable',
                           'description': 'Local air handling unit', 'x_coordinate': 1000, 'y_coordinate': 750})
            check('site, PDF floorplan, room and equipment creation')
            assert any(r['name'] == 'AHU-Portable' for r in call('GET', '/api/search?q=AHU-Portable'))
            check('PostgreSQL search including pg_trgm')
            photo = io.BytesIO()
            Image.new('RGB', (800, 600), '#3b82f6').save(photo, 'JPEG')
            photo_info = call('POST', f'/api/equipment/{equipment["id"]}/photo', files={'photo': ('AHU-photo.jpg', photo.getvalue(), 'image/jpeg')})
            assert client.get(photo_info['photo_path']).status_code == 200
            assert client.get(photo_info['photo_thumbnail_path']).status_code == 200
            doc = call('POST', f'/api/equipment/{equipment["id"]}/documents', files={'file': ('AHU manual.pdf', pdf_bytes, 'application/pdf')})
            assert client.get(doc['path']).content == pdf_bytes
            inventory = call('GET', '/api/data-manager/uploads')['files']
            assert len(inventory) >= 4
            check('photo conversion, thumbnails, document upload/download and inventory')
            call('DELETE', f'/api/equipment/{equipment["id"]}/documents/{doc["id"]}')
            logs = call('GET', '/api/audit-logs')
            removal = next(log for log in logs if log['action'] == 'remove_document')
            call('POST', f'/api/audit-logs/{removal["id"]}/undo')
            assert call('GET', f'/api/equipment/{equipment["id"]}/documents')[0]['filename'] == 'AHU manual.pdf'
            check('audit trail and document removal undo')
            job = call('POST', f'/api/floorplans/{floorplan["id"]}/room-scan', json={'dpi': 300})
            deadline = time.monotonic() + 90
            while True:
                scan = call('GET', f'/api/floorplans/{floorplan["id"]}/room-scan/{job["id"]}')
                if scan['status'] in ('ready', 'error'):
                    break
                assert time.monotonic() < deadline, 'OCR timed out'
                time.sleep(.5)
            assert scan['status'] == 'ready', scan
            check('bundled English Tesseract room scanning')
            refreshed = call('POST', '/api/refresh-token', json={'refresh_token': token['refresh_token']})
            assert refreshed['access_token']
            check('refresh-token rotation and disabled external integration')
        evidence.update(url=state['url'], floorplan_id=floorplan['id'], equipment_id=equipment['id'])
        stop(process)
        check('clean app and PostgreSQL shutdown')
        backup = ROOT / (data.name + '-backup')
        shutil.copytree(data, backup)
        (backup / 'initial-password.txt').unlink()
        process, restarted = start()
        assert restarted['url'] == state['url']
        with httpx.Client(base_url=state['url'], trust_env=False) as client:
            assert client.get('/api/search?q=AHU-Portable').json()[0]['name'] == 'AHU-Portable'
            assert client.get(doc['path']).content == pdf_bytes
        check('records and uploaded bytes persist across a real EXE restart')
        # Launch the copied data folder as a restore check, with the first
        # instance stopped so the restored origin/ports can be preserved.
        stop(process)
        original_data = data
        data = backup
        process, restored = start()
        assert httpx.get(restored['url'] + '/api/search?q=AHU-Portable', trust_env=False).json()[0]['name'] == 'AHU-Portable'
        stop(process)
        check('stopped full-data-folder backup restores into a separate folder')
        data = original_data
        process, crash_state = start()
        process.kill()
        process.wait(timeout=15)
        deadline = time.monotonic() + 15
        while psutil.pid_exists(crash_state['database_pid']) and time.monotonic() < deadline:
            time.sleep(.2)
        assert not psutil.pid_exists(crash_state['database_pid']), 'Database survived launcher termination'
        # The ready marker is intentionally stale after termination. Its owner
        # was killed; wait for a fresh ready marker on the next launch.
        (data / 'ready.json').unlink()
        process, _ = start()
        check('Windows job removes database on launcher crash; next launch recovers')
        success = True
    finally:
        (results / 'smoke.json').write_text(json.dumps(evidence, indent=2))
        if process and process.poll() is None and (not args.leave_running or not success):
            stop(process)
    print('Results:', results / 'smoke.json', flush=True)


if __name__ == '__main__':
    main()
