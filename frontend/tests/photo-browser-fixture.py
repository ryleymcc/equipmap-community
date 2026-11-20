"""Local fixture for exercising the production UI/PWA without production data."""
import json
import sys
import tempfile
from pathlib import Path
from io import BytesIO
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from email.parser import BytesParser
from email.policy import default
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from photo_pipeline import process_photo
from PIL import Image

folder = tempfile.TemporaryDirectory()
buffer = BytesIO()
Image.new('RGB', (2000, 1400), 'steelblue').save(buffer, 'JPEG')
photo = process_photo(buffer.getvalue(), folder.name)
shared = dict(id=1, floorplan_id=1, description='Photo verification', x_coordinate=300, y_coordinate=250,
              photo_path=photo, photo_thumbnail_path=photo.replace('.preview.', '.thumb.'),
              floorplan_name='Test floor', site_name='Test site', site_id=1)
room = dict(shared, name='Room 101')
equipment = dict(shared, name='Pump 1', color='#10b981', tools_required='Wrench')
site = dict(id=1, name='Test site')
fp = dict(id=1, site_id=1, name='Test floor', file_path='/uploads/test.svg', file_type='svg', pin_size=16,
          rooms=[room], equipment=[equipment], tickets=[], reference_points=[])

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).resolve().parents[1] / 'dist'), **kwargs)
    def log_message(self, *args): pass
    def send(self, data, content_type='application/json', cache=None):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        if cache: self.send_header('Cache-Control', cache)
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        path = self.path.split('?')[0]
        if path.startswith('/api/'):
            data = {'/api/users/me': dict(id=1, username='tester', role='editor', can_manage_items=True),
                    '/api/sites': [site], '/api/sites/1/floorplans': [fp], '/api/floorplans/1': fp,
                    '/api/equipment': [equipment], '/api/rooms': [room], '/api/tickets': []}
            self.send(json.dumps(data.get(path, [])).encode())
        elif path == '/uploads/test.svg':
            self.send(b'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="1000" height="700" fill="white"/></svg>', 'image/svg+xml')
        elif path.startswith('/uploads/entity-photos/'):
            file = Path(folder.name) / path.removeprefix('/uploads/')
            self.send(file.read_bytes(), 'image/webp', 'no-store' if '.preview.' in path else 'public, max-age=31536000, immutable')
        else:
            if not (Path(self.directory) / path.lstrip('/')).is_file(): self.path = '/index.html'
            super().do_GET()
    def do_POST(self):
        data = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        if self.path.endswith('/photo'):
            message = BytesParser(policy=default).parsebytes(('Content-Type: '+self.headers['Content-Type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+data)
            part = next(message.iter_parts())
            path = process_photo(part.get_payload(decode=True), folder.name)
            item = room if '/rooms/' in self.path else equipment
            item.update(photo_path=path, photo_thumbnail_path=path.replace('.preview.', '.thumb.'))
            self.send(json.dumps({k:item[k] for k in ['photo_path', 'photo_thumbnail_path']}).encode())
        else: self.send(b'{"urls_to_update": []}')
    def do_DELETE(self):
        item = room if '/rooms/' in self.path else equipment
        item.update(photo_path=None, photo_thumbnail_path=None)
        self.send(b'{"photo_path":null,"photo_thumbnail_path":null}')

print('Photo fixture listening on http://127.0.0.1:4187', flush=True)
ThreadingHTTPServer(('127.0.0.1', 4187), Handler).serve_forever()
