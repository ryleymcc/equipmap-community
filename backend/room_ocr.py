"""Bounded, local floorplan OCR and conservative room identity matching."""
import csv
import base64
import io
import math
import re
import shutil
import subprocess
import time
from collections import defaultdict

import fitz


OCR_TILE = 3600
OCR_OVERLAP = 240


def room_key(name):
    # Normalize numeric runs, not letters: 1EN01 == 1en1, but EN != EM.
    return re.sub(r"\d+", lambda m: str(int(m[0])), re.sub(r"[\s_-]+", "", name.upper()))


def is_code(name):
    return 2 <= len(name) <= 24 and bool(re.fullmatch(r'(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*', name))


def propose(detections, rooms, floorplan_id):
    groups = defaultdict(list)
    for item in detections:
        groups[room_key(item['name'])].append(item)
    result = []
    for key, items in sorted(groups.items()):
        best = max(items, key=lambda d: d['confidence'])
        # Tile overlap is merged; repeated codes at distinct locations need review.
        distinct = any(math.hypot(i['x_coordinate'] - best['x_coordinate'],
                                  i['y_coordinate'] - best['y_coordinate']) > 12 for i in items)
        matches = [r for r in rooms if room_key(r['name']) == key]
        local = [r for r in matches if r['floorplan_id'] == floorplan_id]
        row = dict(best, id=len(result), room_id=None, selected=False)
        overlapping = any(other != key and any(math.hypot(i['x_coordinate'] - best['x_coordinate'], i['y_coordinate'] - best['y_coordinate']) < 12 for i in alternatives) for other, alternatives in groups.items())
        if overlapping:
            row.update(action='review', reason='Conflicting text readings at this location')
        elif distinct:
            row.update(action='review', reason='Label appears in multiple locations')
        elif len(local) == 1:
            row.update(action='move', room_id=local[0]['id'], existing_name=local[0]['name'],
                       reason='Move existing room; keep its name and linked records', selected=best['confidence'] >= 80)
        elif matches:
            row.update(action='review', reason='Multiple existing rooms or a match on another floorplan')
        else:
            row.update(action='create', reason='Create a new room', selected=False)
        result.append(row)
    return result


def scan(path, dpi, progress):
    if not shutil.which('tesseract'):
        raise ValueError('OCR is not installed. Rebuild the backend image to enable room scanning.')
    started = time.monotonic()
    with fitz.open(path) as original:
        # Conversion also handles image files using their original aspect ratio.
        converted = None
        try:
            doc = original
            if not original.is_pdf:
                converted = fitz.open('pdf', original.convert_to_pdf())
                doc = converted
            page = doc[0]  # The map displays page one only.
            rect = page.rect
            detections = []
            # Prefer embedded text when available: OCR can confuse O and zero.
            for word in page.get_text('words'):
                name = word[4].strip().strip('.,:;()[]')
                if is_code(name):
                    box = fitz.Rect(word[:4]) * page.rotation_matrix
                    detections.append(dict(name=name.upper(), confidence=100,
                        x_coordinate=(box.x0 + box.x1) / 2 / rect.width * 2000,
                        y_coordinate=(box.y0 + box.y1) / 2 / rect.width * 2000))
            native = list(detections)

            scale = dpi / 72
            width, height = math.ceil(rect.width * scale), math.ceil(rect.height * scale)
            xs = range(0, width, OCR_TILE - OCR_OVERLAP)
            ys = range(0, height, OCR_TILE - OCR_OVERLAP)
            positions = [(x, y) for y in ys for x in xs]
            for index, (x, y) in enumerate(positions):
                if time.monotonic() - started > 600:
                    raise ValueError('Scan reached the ten-minute limit. Crop the drawing and retry.')
                clip = fitz.Rect(x / scale, y / scale, min(x + OCR_TILE, width) / scale,
                                 min(y + OCR_TILE, height) / scale)
                pix = page.get_pixmap(dpi=dpi, clip=clip, colorspace=fitz.csGRAY, alpha=False)
                output = subprocess.run(
                    ['tesseract', 'stdin', 'stdout', '-l', 'eng', '--psm', '11', 'tsv'],
                    input=pix.tobytes('png'), capture_output=True, timeout=60, check=True,
                )
                for word in csv.DictReader(io.StringIO(output.stdout.decode()), delimiter='\t', quoting=csv.QUOTE_NONE):
                    name = word.get('text', '').strip().strip('.,:;()[]')
                    confidence = float(word['conf'])
                    # Codes only; avoid room descriptions, dimensions and general notes.
                    if confidence < 35 or not is_code(name):
                        continue
                    found = dict(name=name.upper(), confidence=round(confidence),
                        x_coordinate=(pix.x + float(word['left']) + float(word['width']) / 2) / (rect.width * scale) * 2000,
                        y_coordinate=(pix.y + float(word['top']) + float(word['height']) / 2) / (rect.width * scale) * 2000)
                    if not any(math.hypot(found['x_coordinate'] - d['x_coordinate'], found['y_coordinate'] - d['y_coordinate']) < 12 for d in native):
                        detections.append(found)
                progress(round((index + 1) / len(positions) * 100))
            preview = page.get_pixmap(matrix=fitz.Matrix(2400 / rect.width, 2400 / rect.width), alpha=False)
            return dict(detections=detections, image='data:image/png;base64,' + base64.b64encode(preview.tobytes('png')).decode(), height=rect.height / rect.width * 2000, dpi=dpi)
        finally:
            if converted:
                converted.close()
