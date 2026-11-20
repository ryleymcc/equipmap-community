"""Portable Windows entry point. No service, installer, elevation, or shell scripts."""
import argparse
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import queue
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
PROCESS_JOB = None


def contain_child_processes():
    """Have Windows reap bundled database/OCR children if the launcher crashes."""
    import win32api
    import win32job
    global PROCESS_JOB
    PROCESS_JOB = win32job.CreateJobObject(None, f'Local\\EquipMap-{os.getpid()}-{secrets.token_hex(8)}')
    limits = win32job.QueryInformationJobObject(PROCESS_JOB, win32job.JobObjectExtendedLimitInformation)
    limits['BasicLimitInformation']['LimitFlags'] |= win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    win32job.SetInformationJobObject(PROCESS_JOB, win32job.JobObjectExtendedLimitInformation, limits)
    win32job.AssignProcessToJobObject(PROCESS_JOB, win32api.GetCurrentProcess())


def free_port(preferred=0):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', preferred))
        return sock.getsockname()[1]


def run(command, **kwargs):
    result = subprocess.run([str(part) for part in command], capture_output=True, text=True,
                            creationflags=subprocess.CREATE_NO_WINDOW, timeout=120, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{Path(command[0]).name} failed: {result.stderr or result.stdout}')
    return result.stdout


class Runtime:
    @staticmethod
    def local_data_path(data, cache=None):
        return data

    def __init__(self, data, notify):
        self.data, self.notify = data, notify
        self.stop = threading.Event()
        self.server = self.db_process = self.lock = None
        self.pg = ROOT / 'postgres/bin'
        self.instance = secrets.token_hex(16)
        self.config = {}

    def initialize(self, password):
        import msvcrt
        self.data.mkdir(parents=True, exist_ok=True)
        self.lock = (self.data / 'instance.lock').open('a+b')
        self.lock.seek(0)
        if self.lock.read(1) == b'':
            self.lock.write(b'0')
            self.lock.flush()
        self.lock.seek(0)
        try:
            msvcrt.locking(self.lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise RuntimeError('EquipMap is already running with this data folder. Use its existing launcher window.')
        os.chdir(self.data)
        logs = self.data / 'logs'
        logs.mkdir(exist_ok=True)
        handler = RotatingFileHandler(logs / 'equipmap.log', maxBytes=2_000_000, backupCount=3, encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
        logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
        contain_child_processes()
        config_path = self.data / 'settings.json'
        if config_path.exists():
            self.config = json.loads(config_path.read_text(encoding='utf-8'))
        else:
            if not password:
                raise RuntimeError('Enter a password for the local administrator account.')
            self.config = dict(db_password=secrets.token_urlsafe(36), secret_key=secrets.token_urlsafe(48),
                               web_port=free_port(), db_port=free_port())
            temporary = config_path.with_suffix('.tmp')
            temporary.write_text(json.dumps(self.config, indent=2), encoding='utf-8')
            temporary.replace(config_path)
        # Reuse the browser origin across restarts; fail clearly if another app
        # owns the port rather than changing origin and losing browser state.
        free_port(self.config['web_port'])
        free_port(self.config['db_port'])
        self.origin = f'http://127.0.0.1:{self.config["web_port"]}'
        self.pg_env = {**os.environ, 'PGPASSWORD': self.config['db_password'],
                       'PGHOST': '127.0.0.1', 'PGPORT': str(self.config['db_port']), 'PGUSER': 'equipmap'}
        # Override inherited development/production configuration explicitly.
        os.environ.update(ENVIRONMENT='production', EQUIPMAP_PORTABLE='1', SENTRY_DSN='', CHATGPT_ENABLED='false',
                          SECRET_KEY=self.config['secret_key'], INITIAL_ADMIN_PASSWORD=password or '',
                          RATE_LIMIT_ENABLED='true', RATE_LIMIT_STORAGE_URI='memory://',
                          DATABASE_URL=f'postgresql+asyncpg://equipmap:{self.config["db_password"]}@127.0.0.1:{self.config["db_port"]}/equipmap')
        os.environ['PATH'] = str(ROOT / 'ocr') + os.pathsep + os.environ.get('PATH', '')
        os.environ['TESSDATA_PREFIX'] = str(ROOT / 'ocr/tessdata')
        self.notify('Initializing the local database…')
        cluster = self.data / 'database'
        if not (cluster / 'PG_VERSION').exists():
            pwfile = self.data / '.db-init-password'
            try:
                pwfile.write_text(self.config['db_password'], encoding='utf-8')
                run([self.pg / 'initdb.exe', '-D', cluster, '-U', 'equipmap', '--encoding=UTF8', '--locale=C',
                     '--auth=scram-sha-256', f'--pwfile={pwfile}'])
            finally:
                pwfile.unlink(missing_ok=True)
        # Start postgres directly as an ordinary child, never register a service.
        self.pg_log = (logs / 'postgres.log').open('ab')
        self.db_process = subprocess.Popen([str(self.pg / 'postgres.exe'), '-D', str(cluster),
                                            '-h', '127.0.0.1', '-p', str(self.config['db_port']),
                                            '-c', 'max_connections=30', '-c', 'shared_buffers=64MB',
                                            '-c', 'password_encryption=scram-sha-256'],
                                           stdout=self.pg_log, stderr=self.pg_log,
                                           creationflags=subprocess.CREATE_NO_WINDOW)
        import psycopg2
        deadline = time.monotonic() + 90
        while True:
            try:
                connection = psycopg2.connect(host='127.0.0.1', port=self.config['db_port'],
                    user='equipmap', password=self.config['db_password'], dbname='postgres', connect_timeout=2)
                break
            except psycopg2.OperationalError:
                if self.db_process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(f'Database did not start. See {logs / "postgres.log"}')
                time.sleep(.25)
        try:
            connection.autocommit = True
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1 FROM pg_database WHERE datname='equipmap'")
                if cursor.fetchone() is None:
                    cursor.execute('CREATE DATABASE equipmap')
        finally:
            connection.close()
        self.notify('Starting EquipMap…')
        if not getattr(sys, 'frozen', False):
            sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
            frontend = Path(__file__).resolve().parents[1] / 'frontend/dist'
        else:
            frontend = ROOT / 'frontend'
        from server import create_app
        import uvicorn
        self.server = uvicorn.Server(uvicorn.Config(create_app(frontend, self.origin), host='127.0.0.1',
                                    port=self.config['web_port'], proxy_headers=False, workers=1,
                                    log_config=None, access_log=False, loop='asyncio'))
        self.server_thread = threading.Thread(target=self.server.run, daemon=True)
        self.server_thread.start()
        deadline = time.monotonic() + 90
        while not self.server.started:
            if not self.server_thread.is_alive() or time.monotonic() > deadline:
                raise RuntimeError(f'EquipMap failed to initialize. See {logs / "equipmap.log"}')
            time.sleep(.1)
        (self.data / 'ready.json').write_text(json.dumps(dict(url=self.origin, pid=os.getpid(),
            database_pid=self.db_process.pid, instance=self.instance, db_port=self.config['db_port'])), encoding='utf-8')
        self.notify(f'Running at {self.origin}')
        (self.data / 'setup.complete').touch()

    def serve(self, password, open_browser):
        try:
            self.initialize(password)
            if open_browser:
                webbrowser.open(self.origin)
            while not self.stop.wait(.5):
                stop_file = self.data / 'stop.request'
                if stop_file.exists() and stop_file.read_text() == self.instance:
                    stop_file.unlink()
                    break
                if not self.server_thread.is_alive() or (self.db_process is not None and self.db_process.poll() is not None):
                    raise RuntimeError('A local server stopped unexpectedly. See the logs folder.')
        finally:
            self.close()

    def close(self):
        self.notify('Stopping EquipMap…')
        # Only the lock owner may remove ready state or stop the database.
        if self.server:
            self.server.should_exit = True
            if hasattr(self, 'server_thread'):
                self.server_thread.join(timeout=30)
        if self.db_process:
            run([self.pg / 'pg_ctl.exe', 'stop', '-D', self.data / 'database', '-m', 'fast', '-w', '-t', '30'])
            self.db_process.wait(timeout=35)
            self.pg_log.close()
        ready = self.data / 'ready.json'
        if ready.exists() and json.loads(ready.read_text()).get('instance') == self.instance:
            ready.unlink()
        if self.lock:
            self.lock.close()
        self.notify('Stopped. Your data has been saved.')


def main(runtime_type=Runtime, default_data_dir=None, setup_marker='setup.complete', window_title='EquipMap Portable'):
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, default=default_data_dir or Path(os.environ['LOCALAPPDATA']) / 'EquipMap Portable')
    parser.add_argument('--cache-dir', type=Path, help='Override local cache folder for shared-edition validation')
    parser.add_argument('--headless', action='store_true', help='For automated validation only')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--initial-admin-password-file', type=Path, help='For automated first-run validation')
    parser.add_argument('--stop', action='store_true', help='Stop this data folder instance cleanly')
    args = parser.parse_args()
    args.data_dir = args.data_dir.resolve()
    local_data = runtime_type.local_data_path(args.data_dir, args.cache_dir)
    if args.stop:
        state = json.loads((local_data / 'ready.json').read_text())
        (local_data / 'stop.request').write_text(state['instance'])
        return
    password = args.initial_admin_password_file.read_text().strip() if args.initial_admin_password_file else None
    if args.headless:
        runtime = runtime_type(args.data_dir, lambda status: None, **({'cache': args.cache_dir} if args.cache_dir else {}))
        signal.signal(signal.SIGINT, lambda *_: runtime.stop.set())
        signal.signal(signal.SIGTERM, lambda *_: runtime.stop.set())
        runtime.serve(password, not args.no_browser)
        return
    import tkinter as tk
    from tkinter import messagebox, simpledialog, ttk
    root = tk.Tk()
    root.title(window_title)
    root.resizable(False, False)
    root.withdraw()
    if not (args.data_dir / setup_marker).exists():
        while True:
            password = simpledialog.askstring('EquipMap first start',
                'Set a password for the local admin account (any length).', show='*', parent=root)
            if password is None:
                root.destroy()
                return
            if not password:
                messagebox.showerror('Enter a password', 'Enter a password of any length.', parent=root)
                continue
            confirmation = simpledialog.askstring('Confirm password', 'Enter the password again.', show='*', parent=root)
            if confirmation == password:
                break
            messagebox.showerror('Passwords differ', 'The passwords did not match. Try again.', parent=root)
    root.deiconify()
    frame = ttk.Frame(root, padding=18)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text=window_title, font=('Segoe UI', 14, 'bold')).pack(anchor='w')
    status = tk.StringVar(value='Starting…')
    ttk.Label(frame, textvariable=status, wraplength=460).pack(anchor='w', pady=12)
    ttk.Label(frame, text=f'Local account: admin\nData folder: {args.data_dir}', wraplength=460).pack(anchor='w')
    events = queue.Queue()
    runtime = runtime_type(args.data_dir, events.put, **({'cache': args.cache_dir} if args.cache_dir else {}))
    def stop():
        runtime.stop.set()
        stop_button.config(state='disabled')
        status.set('Stopping and saving data…')
    buttons = ttk.Frame(frame)
    buttons.pack(fill='x', pady=(18, 0))
    open_button = ttk.Button(buttons, text='Open EquipMap', state='disabled', command=lambda: webbrowser.open(runtime.origin))
    open_button.pack(side='left')
    stop_button = ttk.Button(buttons, text='Stop and exit', command=stop)
    stop_button.pack(side='right')
    def worker():
        try:
            runtime.serve(password, not args.no_browser)
        except Exception as exc:
            logging.exception('Portable startup or shutdown failed')
            events.put(exc)
        finally:
            events.put(None)
    def poll():
        try:
            while True:
                event = events.get_nowait()
                if event is None:
                    root.destroy()
                    return
                if isinstance(event, Exception):
                    messagebox.showerror('EquipMap could not run', str(event), parent=root)
                else:
                    status.set(event)
                    if event.startswith('Running at'):
                        open_button.config(state='normal')
        except queue.Empty:
            root.after(200, poll)
    root.protocol('WM_DELETE_WINDOW', stop)
    threading.Thread(target=worker, daemon=True).start()
    poll()
    root.mainloop()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        logging.exception('Portable launcher failed')
        if '--headless' not in sys.argv:
            from tkinter import messagebox
            messagebox.showerror('EquipMap could not run', 'Startup failed. See the data folder logs for details.')
        sys.exit(1)
