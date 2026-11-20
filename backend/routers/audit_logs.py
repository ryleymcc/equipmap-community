from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db
import models
import schemas
from utils import require_editor, log_action

router = APIRouter(tags=["audit_logs"])

async def _restore_drawings(db, floorplan_id, snapshots):
    for snapshot in snapshots:
        values = {key: value for key, value in snapshot.items() if key not in ('id', 'floorplan_id', 'created_at')}
        drawing_id = snapshot.get('id')
        if await _is_id_available(db, models.FloorplanDrawing, drawing_id):
            values['id'] = drawing_id
        db.add(models.FloorplanDrawing(floorplan_id=floorplan_id, **values))

async def _is_id_available(db: AsyncSession, model_class, entity_id: Optional[int]) -> bool:
    if entity_id is None:
        return False
    res = await db.execute(select(model_class.id).where(model_class.id == entity_id))
    return res.scalar() is None

async def _sync_sequences(db: AsyncSession, tables: List[str]):
    await db.flush()
    for tbl in tables:
        try:
            sql = f"""
            DO $$
            DECLARE
                seq_name text;
                max_val bigint;
            BEGIN
                seq_name := pg_get_serial_sequence('{tbl}', 'id');
                IF seq_name IS NOT NULL THEN
                    SELECT max(id) INTO max_val FROM {tbl};
                    IF max_val IS NOT NULL THEN
                        PERFORM setval(seq_name, max_val, true);
                    ELSE
                        PERFORM setval(seq_name, 1, false);
                    END IF;
                END IF;
            END $$;
            """
            await db.execute(text(sql))
        except Exception:
            pass

@router.get("/api/audit-logs", response_model=List[schemas.AuditLog], dependencies=[Depends(require_editor)])
async def get_audit_logs(response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    result = await db.execute(
        select(models.AuditLog)
        .options(selectinload(models.AuditLog.user))
        .order_by(models.AuditLog.timestamp.desc())
        .limit(200)
    )
    logs = result.scalars().all()
    return [
        {
            "id": l.id,
            "timestamp": l.timestamp,
            "user_id": l.user_id,
            "username": l.username,
            "user_full_name": (l.user.full_name or l.user.username) if l.user else l.username,
            "action": l.action,
            "target_type": l.target_type,
            "target_id": l.target_id,
            "target_name": l.target_name,
            "old_values": l.old_values,
            "new_values": l.new_values,
            "undo_unavailable_reason": l.undo_unavailable_reason,
            "message": l.message
        }
        for l in logs
    ]

@router.post("/api/audit-logs/{log_id}/undo")
async def undo_action(log_id: int, db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_editor)):
    # Acquire write-intent locks before reading undo state, so cleanup cannot
    # remove a required file while this action is being restored.
    if db.bind.dialect.name == 'postgresql':
        await db.execute(text('LOCK TABLE rooms, equipment, floorplans, floorplan_drawings, audit_logs IN ROW EXCLUSIVE MODE'))
    result = await db.execute(select(models.AuditLog).where(models.AuditLog.id == log_id).with_for_update())
    log = result.scalars().first()
    if not log:
        raise HTTPException(status_code=404, detail="Log entry not found")

    is_admin = current_user.role == "admin"
    can_undo_all = is_admin or bool(getattr(current_user, "can_undo_all_audit_logs", False))

    is_own_action = False
    if log.user_id is not None and log.user_id == current_user.id:
        is_own_action = True
    elif log.user_id is None and log.username and log.username == current_user.username:
        is_own_action = True

    if not can_undo_all and not is_own_action:
        raise HTTPException(
            status_code=403,
            detail="You only have permission to undo your own audit log actions."
        )

    if log.undo_unavailable_reason:
        raise HTTPException(409, log.undo_unavailable_reason)

    if log.action == 'cleanup':
        raise HTTPException(400, 'Upload cleanup is permanent and cannot be undone.')

    if log.action in ('upload_drawing', 'remove_drawing', 'update_drawing', 'align_drawing'):
        from routers.floorplan_drawings import DrawingResponse
        from pathlib import Path
        from utils import UPLOAD_DIR
        base = await db.get(models.Floorplan, log.target_id)
        if not base:
            raise HTTPException(409, 'Restore the floorplan before undoing a drawing change.')
        snapshot = log.new_values if log.action == 'upload_drawing' else log.old_values
        drawing_id = snapshot.get('drawing_id') if log.action == 'align_drawing' else snapshot.get('id')
        item = await db.get(models.FloorplanDrawing, drawing_id)
        if log.action == 'remove_drawing':
            if item:
                raise HTTPException(409, 'This drawing is already present or its ID is in use.')
            root = Path(db.info.get('upload_root', UPLOAD_DIR)).resolve()
            source = (root / snapshot['file_path'].removeprefix('/uploads/')).resolve()
            if not source.is_relative_to(root / 'floorplan-drawings') or not source.is_file():
                raise HTTPException(409, 'The drawing file is no longer available.')
            db.add(models.FloorplanDrawing(**snapshot))
            await db.flush()
            await _sync_sequences(db, ['floorplan_drawings'])
        else:
            if not item or item.floorplan_id != base.id:
                raise HTTPException(409, 'The drawing is no longer attached to this floorplan.')
            current = {'drawing_id': item.id, 'placement': item.placement} if log.action == 'align_drawing' else DrawingResponse.model_validate(item).model_dump()
            expected = log.new_values
            if log.action in ('upload_drawing', 'update_drawing') and expected.get('placement'):
                expected = {**expected, 'placement': {'matches': [], **expected['placement']}}
            if current != expected:
                raise HTTPException(409, 'The drawing changed after this event. Undo its later changes first.')
            if log.action == 'upload_drawing':
                await db.delete(item)
            elif log.action == 'align_drawing':
                item.placement = log.old_values['placement']
            else:
                for key, value in snapshot.items():
                    if key not in ('id', 'floorplan_id'):
                        setattr(item, key, value)
        await log_action(db, 'undo', 'floorplan', base.id, base.name, old_values=log.new_values,
                         new_values=log.old_values, message='Undid drawing change', user=current_user)
        await db.commit()
        return {'status': 'success', 'message': 'Drawing change undone'}

    if log.action in ('upload_document', 'remove_document'):
        snapshot = log.new_values if log.action == 'upload_document' else log.old_values
        if not snapshot or not snapshot.get('id') or snapshot.get('equipment_id') != log.target_id:
            raise HTTPException(409, 'This older document event has no restorable document details.')
        item = await db.get(models.Equipment, log.target_id)
        if not item:
            raise HTTPException(409, 'The equipment no longer exists.')
        doc = await db.get(models.EquipmentDocument, snapshot['id'])
        if log.action == 'upload_document':
            if not doc or doc.equipment_id != item.id or doc.path != snapshot['path']:
                raise HTTPException(409, 'The uploaded document is no longer attached to this equipment.')
            await db.delete(doc)
        else:
            if doc:
                raise HTTPException(409, 'The document ID is already in use.')
            from pathlib import Path
            from utils import UPLOAD_DIR
            root = Path(db.info.get('upload_root', UPLOAD_DIR)).resolve()
            path = (root / snapshot['path'].removeprefix('/uploads/')).resolve()
            if not path.is_relative_to(root / 'equipment-documents') or not path.is_file():
                raise HTTPException(409, 'The document file is no longer available.')
            db.add(models.EquipmentDocument(**{key: snapshot[key] for key in
                ('id', 'equipment_id', 'filename', 'path', 'size_bytes')}))
            await _sync_sequences(db, ['equipment_documents'])
        await log_action(db, 'undo', 'equipment', item.id, item.name,
                         old_values=log.new_values, new_values=log.old_values,
                         message=f"Undid document {'upload' if log.action == 'upload_document' else 'removal'}: {snapshot['filename']}",
                         user=current_user)
        await db.commit()
        return {'status': 'success', 'message': 'Document change undone'}

    if log.action == 'delete':
        if not log.old_values:
            raise HTTPException(status_code=400, detail="No old values found to restore")

        if log.target_type == 'site':
            name_to_check = log.old_values.get('name')
            if name_to_check:
                dup = await db.execute(select(models.Site).where(models.Site.name == name_to_check))
                if dup.scalars().first():
                    raise HTTPException(status_code=400, detail=f"Cannot undo: A site with name '{name_to_check}' already exists.")

            orig_site_id = log.old_values.get('id') or log.target_id
            site_data = {k: v for k, v in log.old_values.items() if k not in ['id', 'created_at', 'floorplans']}
            if await _is_id_available(db, models.Site, orig_site_id):
                db_site = models.Site(id=orig_site_id, **site_data)
            else:
                db_site = models.Site(**site_data)
            db.add(db_site)
            await db.flush()

            floorplans_data = log.old_values.get('floorplans', [])
            for fp_data in floorplans_data:
                orig_fp_id = fp_data.get('id')
                fp_clean = {k: v for k, v in fp_data.items() if k not in ['id', 'created_at', 'site_id', 'rooms', 'equipment', 'tickets', 'reference_points', 'drawing_layers']}
                if await _is_id_available(db, models.Floorplan, orig_fp_id):
                    db_fp = models.Floorplan(id=orig_fp_id, site_id=db_site.id, **fp_clean)
                else:
                    db_fp = models.Floorplan(site_id=db_site.id, **fp_clean)
                db.add(db_fp)
                await db.flush()

                await _restore_drawings(db, db_fp.id, fp_data.get('drawing_layers', []))

                for r_data in fp_data.get('rooms', []):
                    orig_r_id = r_data.get('id')
                    r_clean = {k: v for k, v in r_data.items() if k not in ['id', 'created_at', 'floorplan_id']}
                    if await _is_id_available(db, models.Room, orig_r_id):
                        db.add(models.Room(id=orig_r_id, floorplan_id=db_fp.id, **r_clean))
                    else:
                        db.add(models.Room(floorplan_id=db_fp.id, **r_clean))

                for eq_data in fp_data.get('equipment', []):
                    orig_eq_id = eq_data.get('id')
                    eq_clean = {k: v for k, v in eq_data.items() if k not in ['id', 'created_at', 'floorplan_id']}
                    if await _is_id_available(db, models.Equipment, orig_eq_id):
                        db.add(models.Equipment(id=orig_eq_id, floorplan_id=db_fp.id, **eq_clean))
                    else:
                        db.add(models.Equipment(floorplan_id=db_fp.id, **eq_clean))

                for t_data in fp_data.get('tickets', []):
                    orig_t_id = t_data.get('id')
                    t_clean = {k: v for k, v in t_data.items() if k not in ['id', 'created_at', 'floorplan_id']}
                    if await _is_id_available(db, models.Ticket, orig_t_id):
                        db.add(models.Ticket(id=orig_t_id, floorplan_id=db_fp.id, **t_clean))
                    else:
                        db.add(models.Ticket(floorplan_id=db_fp.id, **t_clean))

                for rp_data in fp_data.get('reference_points', []):
                    orig_rp_id = rp_data.get('id')
                    rp_clean = {k: v for k, v in rp_data.items() if k not in ['id', 'created_at', 'floorplan_id']}
                    if await _is_id_available(db, models.ReferencePoint, orig_rp_id):
                        db.add(models.ReferencePoint(id=orig_rp_id, floorplan_id=db_fp.id, **rp_clean))
                    else:
                        db.add(models.ReferencePoint(floorplan_id=db_fp.id, **rp_clean))

            await _sync_sequences(db, ['sites', 'floorplans', 'rooms', 'equipment', 'tickets', 'reference_points', 'floorplan_drawings'])
            await db.commit()
            await db.refresh(db_site)
            await log_action(db, "undo", "site", db_site.id, db_site.name, message=f"Restored deleted site '{db_site.name}' (ID: {db_site.id}) and all associated floorplans/equipment", user=current_user)
            await db.commit()
            return {"status": "success", "message": f"Restored site '{db_site.name}' (ID: {db_site.id}) and its floorplans/equipment"}

        elif log.target_type == 'floorplan':
            site_id = log.old_values.get('site_id')
            site_res = await db.execute(select(models.Site).where(models.Site.id == site_id))
            if not site_res.scalars().first():
                raise HTTPException(status_code=400, detail="Cannot undo: Associated site no longer exists. Restore the site first.")

            name_to_check = log.old_values.get('name')
            if name_to_check:
                dup = await db.execute(select(models.Floorplan).where(models.Floorplan.site_id == site_id, models.Floorplan.name == name_to_check))
                if dup.scalars().first():
                    raise HTTPException(status_code=400, detail=f"Cannot undo: A floorplan with name '{name_to_check}' already exists at this site.")

            orig_fp_id = log.old_values.get('id') or log.target_id
            fp_data = {k: v for k, v in log.old_values.items() if k not in ['id', 'created_at', 'rooms', 'equipment', 'tickets', 'reference_points', 'drawing_layers']}
            if await _is_id_available(db, models.Floorplan, orig_fp_id):
                db_fp = models.Floorplan(id=orig_fp_id, **fp_data)
            else:
                db_fp = models.Floorplan(**fp_data)
            db.add(db_fp)
            await db.flush()

            await _restore_drawings(db, db_fp.id, log.old_values.get('drawing_layers', []))

            for r_data in log.old_values.get('rooms', []):
                orig_r_id = r_data.get('id')
                r_clean = {k: v for k, v in r_data.items() if k not in ['id', 'created_at', 'floorplan_id']}
                if await _is_id_available(db, models.Room, orig_r_id):
                    db.add(models.Room(id=orig_r_id, floorplan_id=db_fp.id, **r_clean))
                else:
                    db.add(models.Room(floorplan_id=db_fp.id, **r_clean))

            for eq_data in log.old_values.get('equipment', []):
                orig_eq_id = eq_data.get('id')
                eq_clean = {k: v for k, v in eq_data.items() if k not in ['id', 'created_at', 'floorplan_id']}
                if await _is_id_available(db, models.Equipment, orig_eq_id):
                    db.add(models.Equipment(id=orig_eq_id, floorplan_id=db_fp.id, **eq_clean))
                else:
                    db.add(models.Equipment(floorplan_id=db_fp.id, **eq_clean))

            for t_data in log.old_values.get('tickets', []):
                orig_t_id = t_data.get('id')
                t_clean = {k: v for k, v in t_data.items() if k not in ['id', 'created_at', 'floorplan_id']}
                if await _is_id_available(db, models.Ticket, orig_t_id):
                    db.add(models.Ticket(id=orig_t_id, floorplan_id=db_fp.id, **t_clean))
                else:
                    db.add(models.Ticket(floorplan_id=db_fp.id, **t_clean))

            for rp_data in log.old_values.get('reference_points', []):
                orig_rp_id = rp_data.get('id')
                rp_clean = {k: v for k, v in rp_data.items() if k not in ['id', 'created_at', 'floorplan_id']}
                if await _is_id_available(db, models.ReferencePoint, orig_rp_id):
                    db.add(models.ReferencePoint(id=orig_rp_id, floorplan_id=db_fp.id, **rp_clean))
                else:
                    db.add(models.ReferencePoint(floorplan_id=db_fp.id, **rp_clean))

            await _sync_sequences(db, ['floorplans', 'rooms', 'equipment', 'tickets', 'reference_points', 'floorplan_drawings'])
            await db.commit()
            await db.refresh(db_fp)
            await log_action(db, "undo", "floorplan", db_fp.id, db_fp.name, message=f"Restored deleted floorplan '{db_fp.name}' (ID: {db_fp.id}) and all associated rooms/equipment", user=current_user)
            await db.commit()
            return {"status": "success", "message": f"Restored floorplan '{db_fp.name}' (ID: {db_fp.id}) and its rooms/equipment"}

        elif log.target_type in ['room', 'equipment', 'ticket']:
            fp_id = log.old_values.get('floorplan_id')
            fp_res = await db.execute(select(models.Floorplan).where(models.Floorplan.id == fp_id))
            if not fp_res.scalars().first():
                raise HTTPException(status_code=400, detail="Cannot undo: Associated floorplan no longer exists. Restore the floorplan first.")

            name_to_check = log.old_values.get('name')
            if log.target_type == 'equipment' and name_to_check:
                fp_site_res = await db.execute(select(models.Floorplan.site_id).where(models.Floorplan.id == fp_id))
                site_id = fp_site_res.scalar()
                if site_id:
                    dup = await db.execute(
                        select(models.Equipment)
                        .join(models.Floorplan)
                        .where(models.Floorplan.site_id == site_id, models.Equipment.name == name_to_check)
                    )
                    if dup.scalars().first():
                        raise HTTPException(status_code=400, detail=f"Cannot undo: An equipment with name '{name_to_check}' already exists at this site.")
            elif log.target_type == 'room' and name_to_check:
                dup = await db.execute(select(models.Room).where(models.Room.floorplan_id == fp_id, models.Room.name == name_to_check))
                if dup.scalars().first():
                    raise HTTPException(status_code=400, detail=f"Cannot undo: A room with name '{name_to_check}' already exists on this floorplan.")

            orig_id = log.old_values.get('id') or log.target_id
            data = {k: v for k, v in log.old_values.items() if k != 'id' and k != 'created_at'}

            if log.target_type == 'room':
                if await _is_id_available(db, models.Room, orig_id):
                    db_obj = models.Room(id=orig_id, **data)
                else:
                    db_obj = models.Room(**data)
            elif log.target_type == 'equipment':
                if await _is_id_available(db, models.Equipment, orig_id):
                    db_obj = models.Equipment(id=orig_id, **data)
                else:
                    db_obj = models.Equipment(**data)
            elif log.target_type == 'ticket':
                if await _is_id_available(db, models.Ticket, orig_id):
                    db_obj = models.Ticket(id=orig_id, **data)
                else:
                    db_obj = models.Ticket(**data)

            db.add(db_obj)
            await _sync_sequences(db, ['rooms', 'equipment', 'tickets'])
            await db.commit()
            await db.refresh(db_obj)
            await log_action(db, "undo", log.target_type, db_obj.id, log.target_name, message=f"Restored deleted {log.target_type} '{log.target_name}' (ID: {db_obj.id})", user=current_user)
            await db.commit()
            return {"status": "success", "message": f"Restored {log.target_type} (ID: {db_obj.id})"}

        else:
            raise HTTPException(status_code=400, detail=f"Undo for {log.target_type} not supported yet")

    elif log.action == 'update':
        if not log.old_values:
            raise HTTPException(status_code=400, detail="No old values found to restore")

        if log.target_type == 'room':
            model_class = models.Room
        elif log.target_type == 'equipment':
            model_class = models.Equipment
        elif log.target_type == 'ticket':
            model_class = models.Ticket
        elif log.target_type == 'floorplan':
            model_class = models.Floorplan
        elif log.target_type == 'site':
            model_class = models.Site
        else:
            raise HTTPException(status_code=400, detail=f"Undo for {log.target_type} not supported yet")

        res = await db.execute(select(model_class).where(model_class.id == log.target_id))
        db_obj = res.scalars().first()
        if not db_obj:
            raise HTTPException(status_code=404, detail=f"Target {log.target_type} not found. It might have been deleted.")

        current_values = {k: getattr(db_obj, k) for k in log.old_values.keys() if hasattr(db_obj, k)}
        for key, val in log.old_values.items():
            if hasattr(db_obj, key):
                setattr(db_obj, key, val)

        await log_action(db, "undo", log.target_type, db_obj.id, log.target_name, old_values=current_values, new_values=log.old_values, message=f"Undid update of {log.target_type} '{log.target_name}'", user=current_user)
        await db.commit()
        return {"status": "success", "message": f"Restored {log.target_type} values"}

    elif log.action == 'create':
        if log.target_type == 'room':
            model_class = models.Room
            stmt = select(model_class).where(model_class.id == log.target_id)
        elif log.target_type == 'equipment':
            model_class = models.Equipment
            stmt = select(model_class).where(model_class.id == log.target_id)
        elif log.target_type == 'ticket':
            model_class = models.Ticket
            stmt = select(model_class).where(model_class.id == log.target_id)
        elif log.target_type == 'floorplan':
            model_class = models.Floorplan
            stmt = select(model_class).options(
                selectinload(models.Floorplan.rooms),
                selectinload(models.Floorplan.equipment),
                selectinload(models.Floorplan.tickets),
                selectinload(models.Floorplan.reference_points)
            ).where(model_class.id == log.target_id)
        elif log.target_type == 'site':
            model_class = models.Site
            stmt = select(model_class).options(
                selectinload(models.Site.floorplans).selectinload(models.Floorplan.rooms),
                selectinload(models.Site.floorplans).selectinload(models.Floorplan.equipment),
                selectinload(models.Site.floorplans).selectinload(models.Floorplan.tickets),
                selectinload(models.Site.floorplans).selectinload(models.Floorplan.reference_points)
            ).where(model_class.id == log.target_id)
        else:
            raise HTTPException(status_code=400, detail=f"Undo for {log.target_type} not supported yet")

        res = await db.execute(stmt)
        db_obj = res.scalars().first()
        if db_obj:
            await db.delete(db_obj)
            await log_action(db, "undo", log.target_type, log.target_id, log.target_name, message=f"Undid creation of {log.target_type} '{log.target_name}' (deleted it)", user=current_user)
            await db.commit()
            return {"status": "success", "message": f"Removed created {log.target_type}"}
        else:
            return {"status": "success", "message": f"{log.target_type} already gone"}

    elif log.action == 'replace_file':
        if not log.old_values:
            raise HTTPException(status_code=400, detail="No old values found to restore")

        res = await db.execute(
            select(models.Floorplan)
            .options(
                selectinload(models.Floorplan.rooms),
                selectinload(models.Floorplan.equipment),
                selectinload(models.Floorplan.tickets),
                selectinload(models.Floorplan.reference_points)
            )
            .where(models.Floorplan.id == log.target_id)
        )
        floorplan = res.scalars().first()
        if not floorplan:
            raise HTTPException(status_code=404, detail="Target floorplan not found. It might have been deleted.")

        current_values = {
            "file_path": floorplan.file_path,
            "file_type": floorplan.file_type,
            "previous_file_path": floorplan.previous_file_path
        }

        # Restore previous drawing
        if log.old_values.get("file_path"):
            floorplan.file_path = log.old_values["file_path"]
        if log.old_values.get("file_type"):
            floorplan.file_type = log.old_values["file_type"]
        floorplan.previous_file_path = log.old_values.get("previous_file_path")

        # Restore coordinates if present
        if "equipment" in log.old_values:
            eq_map = {eq.id: eq for eq in floorplan.equipment}
            for item in log.old_values["equipment"]:
                eq = eq_map.get(item.get("id"))
                if eq:
                    eq.x_coordinate = item.get("x")
                    eq.y_coordinate = item.get("y")

        if "rooms" in log.old_values:
            r_map = {r.id: r for r in floorplan.rooms}
            for item in log.old_values["rooms"]:
                r = r_map.get(item.get("id"))
                if r:
                    r.x_coordinate = item.get("x")
                    r.y_coordinate = item.get("y")

        if "tickets" in log.old_values:
            t_map = {t.id: t for t in floorplan.tickets}
            for item in log.old_values["tickets"]:
                t = t_map.get(item.get("id"))
                if t:
                    t.x_coordinate = item.get("x")
                    t.y_coordinate = item.get("y")

        if "reference_points" in log.old_values:
            rp_map = {rp.id: rp for rp in floorplan.reference_points}
            for item in log.old_values["reference_points"]:
                rp = rp_map.get(item.get("id"))
                if rp:
                    rp.x_coordinate = item.get("x")
                    rp.y_coordinate = item.get("y")

        await log_action(
            db,
            "undo",
            "floorplan",
            floorplan.id,
            floorplan.name,
            old_values=current_values,
            new_values=log.old_values,
            message=f"Restored previous drawing for floorplan '{floorplan.name}'",
            user=current_user
        )
        await db.commit()
        await db.refresh(floorplan)

        from routers.floorplans import _floorplan_detail_cache, _site_floorplans_cache
        _floorplan_detail_cache.pop(floorplan.id, None)
        _site_floorplans_cache.pop(floorplan.site_id, None)

        return {"status": "success", "message": f"Restored previous drawing for floorplan '{floorplan.name}'"}

    elif log.action == 'rescale_floorplan':
        if not log.old_values:
            raise HTTPException(status_code=400, detail="No old values found to restore")

        res = await db.execute(
            select(models.Floorplan)
            .options(
                selectinload(models.Floorplan.rooms),
                selectinload(models.Floorplan.equipment),
                selectinload(models.Floorplan.tickets),
                selectinload(models.Floorplan.reference_points)
            )
            .where(models.Floorplan.id == log.target_id)
        )
        floorplan = res.scalars().first()
        if not floorplan:
            raise HTTPException(status_code=404, detail="Target floorplan not found. It might have been deleted.")

        current_values = {
            "equipment": [{"id": eq.id, "x": eq.x_coordinate, "y": eq.y_coordinate} for eq in floorplan.equipment],
            "rooms": [{"id": r.id, "x": r.x_coordinate, "y": r.y_coordinate} for r in floorplan.rooms],
            "tickets": [{"id": t.id, "x": t.x_coordinate, "y": t.y_coordinate} for t in floorplan.tickets],
            "reference_points": [{"id": rp.id, "x": rp.x_coordinate, "y": rp.y_coordinate} for rp in floorplan.reference_points]
        }

        if "equipment" in log.old_values:
            eq_map = {eq.id: eq for eq in floorplan.equipment}
            for item in log.old_values["equipment"]:
                eq = eq_map.get(item.get("id"))
                if eq:
                    eq.x_coordinate = item.get("x")
                    eq.y_coordinate = item.get("y")

        if "rooms" in log.old_values:
            r_map = {r.id: r for r in floorplan.rooms}
            for item in log.old_values["rooms"]:
                r = r_map.get(item.get("id"))
                if r:
                    r.x_coordinate = item.get("x")
                    r.y_coordinate = item.get("y")

        if "tickets" in log.old_values:
            t_map = {t.id: t for t in floorplan.tickets}
            for item in log.old_values["tickets"]:
                t = t_map.get(item.get("id"))
                if t:
                    t.x_coordinate = item.get("x")
                    t.y_coordinate = item.get("y")

        if "reference_points" in log.old_values:
            rp_map = {rp.id: rp for rp in floorplan.reference_points}
            for item in log.old_values["reference_points"]:
                rp = rp_map.get(item.get("id"))
                if rp:
                    rp.x_coordinate = item.get("x")
                    rp.y_coordinate = item.get("y")

        await log_action(
            db,
            "undo",
            "floorplan",
            floorplan.id,
            floorplan.name,
            old_values=current_values,
            new_values=log.old_values,
            message=f"Undid rescale for floorplan '{floorplan.name}'",
            user=current_user
        )
        await db.commit()
        await db.refresh(floorplan)

        from routers.floorplans import _floorplan_detail_cache, _site_floorplans_cache
        _floorplan_detail_cache.pop(floorplan.id, None)
        _site_floorplans_cache.pop(floorplan.site_id, None)

        return {"status": "success", "message": f"Restored previous coordinates for floorplan '{floorplan.name}'"}

    return {"status": "error", "message": "Action not undoable"}
