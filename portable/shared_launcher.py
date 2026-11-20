"""Shared-folder edition: each PC runs a loopback server and a local cache."""
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import msvcrt
import os
from pathlib import Path
import sys
import threading
import time

import launcher
from shared_store import SharedStore, SharedTransactions


class SharedRuntime(launcher.Runtime):
    @staticmethod
    def local_data_path(data, cache=None):
        if cache is not None:
            return Path(cache).resolve()
        identity = hashlib.sha256(str(Path(data).resolve()).casefold().encode()).hexdigest()[:24]
        return Path(os.environ['LOCALAPPDATA']) / 'EquipMap Shared Cache' / identity

    def __init__(self, data, notify, cache=None):
        self.shared_root = Path(data).resolve()
        super().__init__(self.local_data_path(data, cache), notify)

    def initialize(self, password):
        self.data.mkdir(parents=True, exist_ok=True)
        self.lock = (self.data / 'instance.lock').open('a+b')
        self.lock.seek(0, 2)
        if self.lock.tell() == 0:
            self.lock.write(b'0')
            self.lock.flush()
        self.lock.seek(0)
        try:
            msvcrt.locking(self.lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise RuntimeError('This Windows session already has this shared EquipMap open.')
        logs = self.data / 'logs'
        logs.mkdir(exist_ok=True)
        handler = RotatingFileHandler(logs / 'equipmap.log', maxBytes=2_000_000, backupCount=3, encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
        logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
        launcher.contain_child_processes()
        os.chdir(self.data)
        self.notify('Opening shared data…')
        store = SharedStore(self.shared_root)
        if store.read_current() is None and not password:
            raise RuntimeError('Choose the first local admin password before creating the shared database.')
        settings = self.data / 'settings.json'
        if settings.exists():
            self.config = json.loads(settings.read_text())
        else:
            self.config = dict(web_port=launcher.free_port())
            settings.write_text(json.dumps(self.config), encoding='utf-8')
        launcher.free_port(self.config['web_port'])
        self.origin = f'http://127.0.0.1:{self.config["web_port"]}'
        database = self.data / 'cache.sqlite3'
        os.environ.update(ENVIRONMENT='production', EQUIPMAP_PORTABLE='1', EQUIPMAP_SHARED_FOLDER='1',
                          DATABASE_URL='sqlite+aiosqlite:///' + database.as_posix(),
                          SECRET_KEY=store.settings['secret_key'], INITIAL_ADMIN_PASSWORD=password or '',
                          SENTRY_DSN='', CHATGPT_ENABLED='false', RATE_LIMIT_ENABLED='true',
                          RATE_LIMIT_STORAGE_URI='memory://')
        runtime_root = launcher.ROOT if getattr(sys, 'frozen', False) else Path(__file__).parent / 'dist/EquipMap/_internal'
        os.environ['PATH'] = str(runtime_root / 'ocr') + os.pathsep + os.environ.get('PATH', '')
        os.environ['TESSDATA_PREFIX'] = str(runtime_root / 'ocr/tessdata')
        if not getattr(sys, 'frozen', False):
            sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
            frontend = Path(__file__).parent / 'build/frontend'
        else:
            frontend = launcher.ROOT / 'frontend'
        transactions = SharedTransactions(store, database, self.data / 'uploads')
        from server import create_app
        import uvicorn
        self.server = uvicorn.Server(uvicorn.Config(create_app(frontend, self.origin, shared=transactions),
                                    host='127.0.0.1', port=self.config['web_port'], proxy_headers=False,
                                    workers=1, log_config=None, access_log=False, loop='asyncio'))
        self.server_thread = threading.Thread(target=self.server.run, daemon=True)
        self.server_thread.start()
        deadline = time.monotonic() + 90
        while not self.server.started:
            if not self.server_thread.is_alive() or time.monotonic() > deadline:
                raise RuntimeError(f'Shared EquipMap failed to initialize. See {logs / "equipmap.log"}')
            time.sleep(.1)
        (self.data / 'ready.json').write_text(json.dumps(dict(url=self.origin, pid=os.getpid(),
            database_pid=None, instance=self.instance, shared_root=str(self.shared_root))), encoding='utf-8')
        self.notify(f'Running at {self.origin}')


if __name__ == '__main__':
    try:
        executable_folder = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).parent
        launcher.main(SharedRuntime, executable_folder / 'EquipMap Data', setup_marker='current.json', window_title='EquipMap Shared')
    except Exception as exc:
        logging.exception('Shared launcher failed')
        if '--headless' not in sys.argv:
            from tkinter import messagebox
            messagebox.showerror('EquipMap Shared could not run', str(exc))
        sys.exit(1)
