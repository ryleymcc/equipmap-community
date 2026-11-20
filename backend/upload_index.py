"""Persistent upload catalog, rebuilt at startup and maintained per changed entity."""
import stat as stat_mode
from pathlib import Path
from sqlalchemy import select, delete, insert, inspect, text
from starlette.concurrency import run_in_threadpool
import models
from upload_inventory import inventory, references, MEDIA, DOCUMENTS, file_fingerprint


def file_row(root, relative):
    parts = Path(relative).parts
    if (len(parts) != 1 and not (len(parts) == 2 and parts[0] in ('entity-photos', 'equipment-documents', 'floorplan-drawings'))) or '..' in parts:
        return None
    path = Path(root) / relative
    allowed = DOCUMENTS if len(parts) == 2 and parts[0] == 'equipment-documents' else MEDIA
    if path.suffix.lower() not in allowed or path.is_symlink() or (len(parts) == 2 and path.parent.is_symlink()):
        return None
    if not path.resolve().is_relative_to(Path(root).resolve()):
        return None
    try:
        stat = path.stat(follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat_mode.S_ISREG(stat.st_mode):
        return None
    return dict(path=relative, size_bytes=stat.st_size, modified=stat.st_mtime,
                fingerprint=file_fingerprint(relative, stat))


def source_paths(obj):
    if isinstance(obj, models.EquipmentDocument):
        return references(obj.path)
    if isinstance(obj, models.FloorplanDrawing):
        return references(obj.file_path)
    if isinstance(obj, (models.Room, models.Equipment)):
        return references(obj.photo_path)
    if isinstance(obj, models.Floorplan):
        return references(obj.file_path) | references(obj.previous_file_path)
    if obj.undo_unavailable_reason:
        return set()
    return references(obj.old_values) | references(obj.new_values)


def before_flush(session, *_):
    changed = []
    types = (models.Room, models.Equipment, models.Floorplan, models.FloorplanDrawing, models.EquipmentDocument, models.AuditLog)
    for obj in set(session.new) | set(session.dirty) | set(session.deleted):
        if not isinstance(obj, types):
            continue
        fields = ('old_values', 'new_values', 'undo_unavailable_reason') if isinstance(obj, models.AuditLog) else (
            ('file_path', 'previous_file_path') if isinstance(obj, models.Floorplan) else ('file_path',) if isinstance(obj, models.FloorplanDrawing) else ('path',) if isinstance(obj, models.EquipmentDocument) else ('photo_path',))
        if obj in session.new or obj in session.deleted or any(inspect(obj).attrs[field].history.has_changes() for field in fields):
            changed.append((obj, obj in session.deleted))
    session.info.setdefault('upload_index_changes', []).extend(changed)


def after_flush(session, *_):
    changes = session.info.pop('upload_index_changes', [])
    if not changes:
        return
    from utils import UPLOAD_DIR
    root = session.info.get('upload_root', UPLOAD_DIR)
    conn = session.connection()
    dialect = conn.dialect.name
    if dialect == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert as upsert
    elif dialect == 'sqlite':
        from sqlalchemy.dialects.sqlite import insert as upsert
    else:
        raise RuntimeError('Upload catalog requires PostgreSQL or SQLite')
    # Sort sources/paths consistently to reduce lock-order conflicts.
    for obj, removed in sorted(changes, key=lambda item: (item[0].__tablename__, item[0].id or 0)):
        kind = obj.__tablename__
        category = 'history' if isinstance(obj, models.AuditLog) else 'live'
        conn.execute(delete(models.UploadReference).where(
            models.UploadReference.source_type == kind, models.UploadReference.source_id == obj.id))
        if removed:
            continue
        for path in sorted(source_paths(obj)):
            conn.execute(insert(models.UploadReference).values(source_type=kind, source_id=obj.id, path=path, category=category))
            # Audit rows usually reference an already cataloged asset. Only live
            # changes or missing catalog rows require a targeted filesystem stat.
            existing = conn.execute(select(models.UploadAsset.path).where(models.UploadAsset.path == path)).first()
            if category == 'history' and existing:
                continue
            row = file_row(root, path)
            if row:
                statement = upsert(models.UploadAsset).values(**row)
                conn.execute(statement.on_conflict_do_update(index_elements=['path'], set_={k:v for k,v in row.items() if k != 'path'}))



async def collect_references(db):
    live, history = set(), set()
    for column in [models.Room.photo_path, models.Equipment.photo_path,
                   models.Floorplan.file_path, models.Floorplan.previous_file_path, models.EquipmentDocument.path, models.FloorplanDrawing.file_path]:
        for value in (await db.execute(select(column))).scalars():
            live.update(references(value))
    for old, new in await db.execute(select(models.AuditLog.old_values, models.AuditLog.new_values).where(models.AuditLog.undo_unavailable_reason.is_(None))):
        history.update(references(old))
        history.update(references(new))
    return live, history


async def reconcile(db, root):
    # Consistent snapshot across startup workers and in-flight entity changes.
    if db.bind.dialect.name == 'postgresql':
        await db.execute(text('SELECT pg_advisory_xact_lock(192837465)'))
        await db.execute(text('LOCK TABLE rooms, equipment, floorplans, floorplan_drawings, equipment_documents, audit_logs, upload_assets, upload_references IN SHARE ROW EXCLUSIVE MODE'))
    rows = await run_in_threadpool(inventory, root, set(), set())
    ref_rows = []
    for model in [models.Room, models.Equipment, models.Floorplan, models.FloorplanDrawing, models.EquipmentDocument, models.AuditLog]:
        for obj in (await db.execute(select(model))).scalars():
            for path in source_paths(obj):
                ref_rows.append(dict(source_type=model.__tablename__, source_id=obj.id, path=path,
                                     category='history' if model is models.AuditLog else 'live'))
    await db.execute(delete(models.UploadReference))
    await db.execute(delete(models.UploadAsset))
    if rows:
        await db.execute(insert(models.UploadAsset), [dict(path=r['path'], size_bytes=r['bytes'], modified=r['modified'], fingerprint=r['fingerprint']) for r in rows])
    if ref_rows:
        await db.execute(insert(models.UploadReference), ref_rows)
    await db.commit()
    return len(rows)


async def indexed_inventory(db):
    # No filesystem access on page loads.
    live = set((await db.execute(select(models.UploadReference.path).where(models.UploadReference.category == 'live'))).scalars())
    history = set((await db.execute(select(models.UploadReference.path).where(models.UploadReference.category == 'history'))).scalars())
    files = []
    document_names = {path.removeprefix('/uploads/'): filename for path, filename in
                      await db.execute(select(models.EquipmentDocument.path, models.EquipmentDocument.filename))}
    document_names.update({path.removeprefix('/uploads/'): filename for path, filename in
                          await db.execute(select(models.FloorplanDrawing.file_path, models.FloorplanDrawing.filename))})
    # Audit snapshots preserve names after uploads have been detached.
    photo_names = {}
    events = (await db.execute(select(models.AuditLog.old_values, models.AuditLog.new_values,
                                    models.AuditLog.target_name).order_by(models.AuditLog.id.desc()))).all()
    for old, new, target_name in events:
        for snapshot in (new, old):
            if not isinstance(snapshot, dict):
                continue
            if snapshot.get('path') and snapshot.get('filename'):
                document_names.setdefault(snapshot['path'].removeprefix('/uploads/'), snapshot['filename'])
            for path in references(snapshot.get('photo_path')):
                label = snapshot.get('photo_filename') or (f'{target_name} photo' if target_name else None)
                if label:
                    photo_names.setdefault(path, label)
    # Prefer the actual upload filename over later removal/undo labels.
    for old, new, target_name in events:
        if isinstance(new, dict) and new.get('photo_filename'):
            for path in references(new.get('photo_path')):
                photo_names[path] = new['photo_filename']
    for model in (models.Room, models.Equipment):
        for path, name in await db.execute(select(model.photo_path, model.name)):
            for relative in references(path):
                photo_names.setdefault(relative, f'{name} photo')
    document_names.update(photo_names)
    columns = (models.UploadAsset.path, models.UploadAsset.size_bytes, models.UploadAsset.modified, models.UploadAsset.fingerprint)
    for row in await db.execute(select(*columns)):
        status = ('in_use' if row.path in live else 'history' if row.path in history
                  else 'unused')
        files.append(dict(path=row.path, filename=document_names.get(row.path), bytes=row.size_bytes, modified=row.modified, fingerprint=row.fingerprint, status=status))
    return sorted(files, key=lambda row: (row['status'] != 'unused', row['path']))
