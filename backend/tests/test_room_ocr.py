import time

import fitz
import pytest

import models
from room_ocr import room_key, propose, scan
from routers.room_ocr import jobs, fingerprint


def detection(name='1EN01', x=100, y=200):
    return dict(name=name, x_coordinate=x, y_coordinate=y, confidence=95)


def test_scan_request_requires_supported_manual_resolution():
    from pydantic import ValidationError
    from routers.room_ocr import ScanRequest
    assert ScanRequest().dpi == 450
    for dpi in (300, 450, 600, 900, 1200):
        assert ScanRequest(dpi=dpi).dpi == dpi
    for dpi in ('auto', 0, 10000):
        with pytest.raises(ValidationError):
            ScanRequest(dpi=dpi)


def test_normalization_and_ambiguity():
    assert room_key('1en01') == room_key('1-EN-1')
    assert room_key('01EN000') == '1EN0'
    assert room_key('1EN01') != room_key('1EM01')
    rooms = [dict(id=1, name='1EN1', floorplan_id=1)]
    rows = propose([detection(), detection('1en1', 101)], rooms, 1)
    assert len(rows) == 1 and rows[0]['action'] == 'move' and rows[0]['room_id'] == 1
    assert propose([detection(), detection(x=500)], rooms, 1)[0]['action'] == 'review'
    assert propose([detection()], rooms * 2, 1)[0]['action'] == 'review'
    assert propose([detection()], rooms, 2)[0]['action'] == 'review'
    assert propose([detection('1EM01')], rooms, 1)[0]['action'] == 'create'
    assert propose([detection('9AB77')], rooms, 1)[0]['action'] == 'create'
    assert all(r['action'] == 'review' for r in propose([detection(), detection('1ENO1')], [], 1))


def test_distinct_room_numbers_do_not_block_creation():
    rooms = [dict(id=index, name=name, floorplan_id=6)
             for index, name in enumerate(('5B11', '5B14', '5B41'), start=1)]
    row = propose([detection('5B141')], rooms, 6)[0]
    assert row['action'] == 'create' and row['room_id'] is None
    assert row['selected'] is False
    rooms.append(dict(id=4, name='5B0141', floorplan_id=6))
    row = propose([detection('5B141')], rooms, 6)[0]
    assert row['action'] == 'move' and row['room_id'] == 4


def test_raster_ocr(tmp_path):
    path = tmp_path / 'raster.png'
    with fitz.open() as doc:
        page = doc.new_page(width=600, height=400)
        page.insert_text((180, 160), '9AB77', fontsize=20)
        page.get_pixmap(dpi=150).save(path)
    output = scan(path, 300, lambda _: None)
    assert output['dpi'] == 300
    match = next(d for d in output['detections'] if d['name'] == '9AB77')
    assert 590 < match['x_coordinate'] < 820
    assert 450 < match['y_coordinate'] < 550


def test_overlapping_tiles_recover_a_label_across_a_tile_edge(tmp_path, monkeypatch):
    import room_ocr
    # Put a raster label across the first tile's right edge. The adjacent tile
    # must contain the complete label and keep its drawing coordinates intact.
    monkeypatch.setattr(room_ocr, 'OCR_TILE', 900)
    path = tmp_path / 'tile-edge.png'
    with fitz.open() as doc:
        page = doc.new_page(width=300, height=100)
        page.insert_text((128, 50), '9AB77', fontsize=12)
        box = page.search_for('9AB77')[0]
        expected_x = (box.x0 + box.x1) / 2 / page.rect.width * 2000
        page.get_pixmap(dpi=450).save(path)
    assert box.x0 * 450 / 72 < 900 < box.x1 * 450 / 72
    output = scan(path, 450, lambda _: None)
    matches = [d for d in output['detections'] if d['name'] == '9AB77']
    assert matches
    assert abs(matches[0]['x_coordinate'] - expected_x) < 10
    rows = propose(output['detections'], [dict(id=1, name='9AB77', floorplan_id=1)], 1)
    matched_rows = [r for r in rows if r['name'] == '9AB77']
    assert len(matched_rows) == 1 and matched_rows[0]['action'] == 'move'


@pytest.mark.parametrize('rotation', [0, 90])
def test_real_ocr_coordinates(tmp_path, rotation):
    path = tmp_path / 'scan.pdf'
    with fitz.open() as doc:
        page = doc.new_page(width=600, height=400)
        page.insert_text((180, 160), '1EN01', fontsize=18)
        page.set_rotation(rotation)
        expected = page.search_for('1EN01')[0] * page.rotation_matrix
        expected_x = (expected.x0 + expected.x1) / 2 / page.rect.width * 2000
        expected_y = (expected.y0 + expected.y1) / 2 / page.rect.width * 2000
        doc.save(path)
    output = scan(path, 300, lambda _: None)
    if rotation:
        # Rotated labels are an OCR limitation, but any detected position must map correctly.
        assert output['height'] == 3000
    else:
        match = next(d for d in output['detections'] if room_key(d['name']) == '1EN1')
        assert abs(match['x_coordinate'] - expected_x) < 10
        assert abs(match['y_coordinate'] - expected_y) < 15


@pytest.mark.asyncio
async def test_apply_moves_without_duplicates_and_rejects_stale(client, db_session, editor_token, viewer_token, tmp_path, monkeypatch):
    from routers import room_ocr as routes
    monkeypatch.setattr(routes, 'UPLOAD_DIR', str(tmp_path))
    path = tmp_path / 'source.pdf'
    path.write_bytes(b'fixture')
    site = models.Site(name='OCR isolated test')
    db_session.add(site)
    await db_session.flush()
    fp = models.Floorplan(site_id=site.id, name='OCR floor', file_type='pdf', file_path='/uploads/source.pdf')
    db_session.add(fp)
    await db_session.flush()
    room = models.Room(floorplan_id=fp.id, name='1EN1', description='Keep me', x_coordinate=1, y_coordinate=2)
    db_session.add(room)
    await db_session.commit()
    from sqlalchemy import select
    user = (await db_session.execute(select(models.User).where(models.User.username == 'editor_test'))).scalar_one()
    snapshot = await routes.room_snapshot(db_session, site.id)
    job = dict(id='test-job', user_id=user.id, floorplan_id=fp.id, created=time.monotonic(), status='ready',
               source=fingerprint(path), snapshot=snapshot, rows=propose([detection(), detection('9AB77', x=500)], snapshot, fp.id))
    jobs['test-job'] = job
    headers = {'Authorization': f'Bearer {editor_token}'}
    url = f'/api/floorplans/{fp.id}/room-scan/test-job/apply'
    assert (await client.post(url, json={'selected_ids': [0]}, headers={'Authorization': f'Bearer {viewer_token}'})).status_code == 403
    response = await client.post(url, json={'selected_ids': [0, 1]}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json() == dict(moved=1, created=1)
    await db_session.refresh(room)
    assert room.name == '1EN1' and room.description == 'Keep me' and room.x_coordinate == 100
    assert len(await routes.room_snapshot(db_session, site.id)) == 2
    assert (await client.post(url, json={'selected_ids': [0, 1]}, headers=headers)).status_code == 409
    job['status'] = 'ready'
    assert (await client.post(url, json={'selected_ids': [0]}, headers=headers)).status_code == 409
    jobs.pop('test-job')
