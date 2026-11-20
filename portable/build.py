"""Run using portable/build-env/Scripts/python.exe on the build machine."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent


def main():
    shared = '--shared' in sys.argv
    name = 'EquipMap-Shared' if shared else 'EquipMap'
    output = ROOT / 'dist' / name
    if (output / 'EquipMap Data').exists():
        raise RuntimeError('This build folder contains user data. Build into a separate staging directory; never replace this folder automatically.')
    env = {**os.environ, 'VITE_PORTABLE': 'true', 'VITE_API_URL': '', 'VITE_SENTRY_DSN': ''}
    frontend = ROOT / 'build/frontend'
    subprocess.run(['node', 'node_modules/vite/bin/vite.js', 'build', '--outDir', str(frontend)], cwd=REPO / 'frontend', env=env, check=True)
    libraries = REPO / 'frontend/node_modules/three/examples/jsm/libs'
    for source, destination in [('draco/gltf', 'draco'), ('basis', 'basis')]:
        shutil.copytree(libraries / source, frontend / 'model-decoders' / destination, dirs_exist_ok=True)
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--windowed',
               '--name', name, '--distpath', str(ROOT / 'dist'), '--workpath', str(ROOT / 'build'),
               '--specpath', str(ROOT), '--paths', str(REPO / 'backend'),
               '--add-data', f'{frontend};frontend',
               '--hidden-import', 'asyncpg.pgproto.pgproto', '--hidden-import', 'sqlalchemy.dialects.postgresql.asyncpg',
               '--hidden-import', 'sqlalchemy.dialects.sqlite.aiosqlite',
               '--hidden-import', 'aiosqlite',
               '--hidden-import', 'uvicorn.logging', '--hidden-import', 'uvicorn.loops.asyncio',
               '--hidden-import', 'uvicorn.protocols.http.h11_impl', '--hidden-import', 'uvicorn.lifespan.on',
               '--hidden-import', 'passlib.handlers.bcrypt', '--hidden-import', 'PIL._webp',
               '--collect-all', 'pymupdf', '--collect-submodules', 'asyncpg',
               '--copy-metadata', 'limits', '--copy-metadata', 'slowapi',
               '--exclude-module', 'pytest', '--exclude-module', 'onnxruntime',
               str(ROOT / ('shared_launcher.py' if shared else 'launcher.py'))]
    if '--package-only' not in sys.argv:
        subprocess.run(command, check=True)
    runtime = output / '_internal'
    if not shared:
        shutil.copytree(ROOT / 'cache/pgsql', runtime / 'postgres', dirs_exist_ok=True)
    # App-local VC runtimes: PostgreSQL must not depend on a redistributable
    # having been installed on the destination Windows machine.
    if not shared:
        for dll in ('MSVCP140.dll', 'VCRUNTIME140.dll', 'VCRUNTIME140_1.dll'):
            source = next(p for p in runtime.iterdir() if p.name.lower() == dll.lower())
            shutil.copy2(source, runtime / 'postgres/bin' / dll)
    tess = runtime / 'ocr'
    tess.mkdir(exist_ok=True)
    source = ROOT / 'cache/tesseract'
    for item in source.iterdir():
        if item.suffix.lower() == '.dll' or item.name in ('tesseract.exe', 'LICENSE', 'COPYING', 'LICENSE.txt'):
            shutil.copy2(item, tess / item.name)
    shutil.copytree(source / 'tessdata', tess / 'tessdata', dirs_exist_ok=True)
    shutil.copytree(source / 'doc', tess / 'doc', dirs_exist_ok=True)
    shutil.copy2(ROOT / ('README-SHARED.md' if shared else 'README.md'), output / 'README.txt')
    shutil.copy2(REPO / 'frontend/src/assets/fonts/OFL.txt', output / 'Outfit-OFL.txt')
    shutil.copy2(ROOT / 'cache/download-sha256.json', output / 'redistributable-download-sha256.json')
    shutil.copy2(Path(sys.base_prefix) / 'LICENSE.txt', output / 'Python-LICENSE.txt')
    for distribution in importlib.metadata.distributions():
        for item in distribution.files or []:
            if Path(item).name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE')):
                source = distribution.locate_file(item)
                if source.is_file():
                    target = output / 'licenses' / distribution.metadata['Name'] / str(item).replace('../', '').replace('..\\', '')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)
    dependencies = subprocess.check_output([sys.executable, '-m', 'pip', 'freeze'], text=True)
    (output / 'python-dependencies.txt').write_text(dependencies, encoding='utf-8')
    (ROOT / 'requirements.lock.txt').write_text(dependencies, encoding='utf-8')
    files = {str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in output.rglob('*') if p.is_file() and p.name != 'SHA256SUMS.json'}
    (output / 'SHA256SUMS.json').write_text(json.dumps(files, indent=2), encoding='utf-8')
    archive = ROOT / 'dist' / (name + '-Windows-x64.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for path in output.rglob('*'):
            if path.is_file():
                zip_file.write(path, path.relative_to(output.parent))
    print(f'Built {archive} ({archive.stat().st_size / 1024**2:.1f} MiB)', flush=True)
    archive.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')


if __name__ == '__main__':
    main()
