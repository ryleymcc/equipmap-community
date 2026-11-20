"""Build-machine only: download redistributables, never executed on user PCs."""
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / 'cache'


def fetch(url, name):
    path = CACHE / name
    if not path.exists():
        temporary = path.with_suffix('.part')
        print(f'Downloading {name}', flush=True)
        urllib.request.urlretrieve(url, temporary)
        temporary.replace(path)
    return path


def main():
    CACHE.mkdir(exist_ok=True)
    pg = fetch('https://sbp.enterprisedb.com/getfile.jsp?fileid=1260673', 'postgresql-15.20.zip')
    if not (CACHE / 'pgsql/bin/postgres.exe').exists():
        with zipfile.ZipFile(pg) as archive:
            # Exclude pgAdmin and optional installers, retain PostgreSQL tools,
            # extension files, runtime DLLs, and upstream license notices.
            for member in archive.infolist():
                if member.filename.startswith(('pgsql/bin/', 'pgsql/lib/', 'pgsql/share/')) or member.filename == 'pgsql/license.txt':
                    archive.extract(member, CACHE)
    fonts = ROOT.parent / 'frontend/src/assets/fonts'
    fonts.mkdir(parents=True, exist_ok=True)
    for name, remote in [('Outfit.ttf', 'Outfit%5Bwght%5D.ttf'), ('OFL.txt', 'OFL.txt')]:
        source = fetch(f'https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/{remote}', name)
        (fonts / name).write_bytes(source.read_bytes())
    # 7zr extracts the 7-Zip self-extractor; full 7z then unpacks the NSIS
    # Tesseract installer as an archive. Neither installer is executed.
    seven = fetch('https://www.7-zip.org/a/7zr.exe', '7zr.exe')
    installer = fetch('https://www.7-zip.org/a/7z2600-x64.exe', '7z-x64.exe')
    seven_dir = CACHE / '7zip'
    if not (seven_dir / '7z.exe').exists():
        subprocess.run([str(seven), 'x', str(installer), f'-o{seven_dir}', '-y'], check=True)
    tess = fetch('https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-5.5.3.20260724.exe', 'tesseract.exe')
    if not (CACHE / 'tesseract/tesseract.exe').exists():
        subprocess.run([str(seven_dir / '7z.exe'), 'x', str(tess), f'-o{CACHE / "tesseract"}', '-y'], check=True)
    # The installer normally downloads language data during installation.
    # Bundle the English model explicitly instead.
    english = fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata', 'eng.traineddata')
    (CACHE / 'tesseract/tessdata/eng.traineddata').write_bytes(english.read_bytes())
    records = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in CACHE.iterdir()
               if p.is_file() and p.name != 'download-sha256.json'}
    (CACHE / 'download-sha256.json').write_text(json.dumps(records, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
