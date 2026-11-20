"""Conservative inventory: only supported files in known upload locations are eligible."""
import hashlib
import os
import stat as stat_mode
from pathlib import Path
from urllib.parse import unquote, urlsplit

DOCUMENTS = {'.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'}
MEDIA = {'.pdf', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.glb'}


def references(value):
    found = set()
    if isinstance(value, dict):
        for child in value.values():
            found.update(references(child))
    elif isinstance(value, list):
        for child in value:
            found.update(references(child))
    elif isinstance(value, str) and '/uploads/' in value:
        try:
            path = unquote(urlsplit(value).path)
        except ValueError:
            return found
        if path.startswith('/uploads/'):
            relative = path[len('/uploads/'):]
            found.add(relative)
            if relative.startswith('entity-photos/') and relative.endswith('.preview.webp'):
                found.add(relative.replace('.preview.webp', '.thumb.webp'))
    return found


def file_fingerprint(relative, stat):
    # Windows DirEntry.stat reports inode zero, unlike Path.stat. Size and
    # nanosecond modification/change timestamps are consistent across both APIs.
    return hashlib.sha256(f'{relative}:{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}'.encode()).hexdigest()


def inventory(upload_dir, live, history, now=None):
    root = Path(upload_dir).resolve()
    files = []
    # Scan only direct entries in known directories. DirEntry.stat caches its result;
    # avoid per-file resolve()/is_file()/is_symlink() round trips on mounted storage.
    directories = [(root, '')]
    for name in ('entity-photos', 'equipment-documents', 'floorplan-drawings'):
        directory = root / name
        if directory.is_dir() and not directory.is_symlink():
            directories.append((directory, name + '/'))
    for directory, prefix in directories:
        try:
            entries = os.scandir(directory)
        except FileNotFoundError:
            continue
        with entries:
            for entry in entries:
                if Path(entry.name).suffix.lower() not in (DOCUMENTS if prefix == 'equipment-documents/' else MEDIA):
                    continue
                try:
                    stat = entry.stat(follow_symlinks=False)
                except FileNotFoundError:
                    continue  # A concurrent upload/removal may change the directory.
                if not stat_mode.S_ISREG(stat.st_mode):
                    continue  # Includes symlinks and directories, without following either.
                relative = prefix + entry.name
                status = ('in_use' if relative in live else 'history' if relative in history
                          else 'unused')
                fingerprint = file_fingerprint(relative, stat)
                files.append(dict(path=relative, bytes=stat.st_size, modified=stat.st_mtime,
                                  status=status, fingerprint=fingerprint))
    return sorted(files, key=lambda row: (row['status'] != 'unused', row['path']))
