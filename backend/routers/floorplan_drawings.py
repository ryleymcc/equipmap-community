"""Independent reference drawings, registered to a specific base-floorplan revision."""
from pathlib import Path
from uuid import uuid4
from typing import Annotated
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from svg_parser import validate_svg
from database import get_db
import models
from utils import UPLOAD_DIR, log_action, require_editor, require_user

router = APIRouter(prefix='/api/floorplans/{floorplan_id}/drawings', tags=['floorplan drawings'])
Finite = Annotated[float, Field(allow_inf_nan=False)]
MAX_BYTES = 50 * 1024 * 1024
STANDARD_DISCIPLINES = {'hvac', 'plumbing', 'electrical', 'other'}


def validate_source(path, suffix, page_number):
    if suffix == '.pdf':
        import fitz
        try:
            with fitz.open(path) as document:
                if document.needs_pass or page_number > document.page_count:
                    raise HTTPException(400, 'Choose an unlocked PDF and a page that exists in the document.')
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(400, 'The PDF could not be read. Choose a valid PDF drawing.')
    elif suffix == '.svg':
        validate_svg(path)


class DrawingMetadata(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=160)
    discipline: str = Field(min_length=1, max_length=80, pattern=r'^[^\x00-\x1f\x7f]+$')
    sheet_number: str = Field(default='', max_length=80)
    project: str = Field(default='', max_length=160)
    drawing_date: str = Field(default='', max_length=10, pattern=r'^$|^\d{4}-\d{2}-\d{2}$')
    revision: str = Field(default='', max_length=80)
    page_number: int = Field(default=1, ge=1, le=10000)

    @model_validator(mode='after')
    def valid_date(self):
        if self.drawing_date:
            try:
                date.fromisoformat(self.drawing_date)
            except ValueError:
                raise ValueError('Use a valid drawing date in YYYY-MM-DD format.')
        return self


class Coverage(BaseModel):
    model_config = ConfigDict(extra='forbid')
    x: Annotated[Finite, Field(ge=0, le=100)]
    y: Annotated[Finite, Field(ge=0, le=100)]
    width: Annotated[Finite, Field(gt=0, le=100)]
    height: Annotated[Finite, Field(gt=0, le=100)]

    @model_validator(mode='after')
    def inside_floor(self):
        if self.x + self.width > 100.00001 or self.y + self.height > 100.00001:
            raise ValueError('Coverage must stay inside the floorplan.')
        return self


class MatchPoint(BaseModel):
    model_config = ConfigDict(extra='forbid')
    x: Annotated[Finite, Field(ge=0, le=100)]
    y: Annotated[Finite, Field(ge=0, le=100)]


class DrawingMatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: MatchPoint
    target: MatchPoint


class Placement(BaseModel):
    model_config = ConfigDict(extra='forbid')
    base_file_path: str = Field(max_length=1024)
    x: Annotated[Finite, Field(ge=-200, le=200)] = 0
    y: Annotated[Finite, Field(ge=-200, le=200)] = 0
    scale: Annotated[Finite, Field(ge=0.01, le=10)] = 1
    rotation: Annotated[Finite, Field(ge=-180, le=180)] = 0
    crop: Coverage = Field(default_factory=lambda: Coverage(x=0, y=0, width=100, height=100))
    coverage: Coverage
    matches: list[DrawingMatch] = Field(default_factory=list, max_length=16)

    @model_validator(mode='after')
    def validate_matches(self):
        if self.matches and len(self.matches) < 4:
            raise ValueError('Match at least four landmarks.')
        for side in ('source', 'target'):
            points = [getattr(pair, side) for pair in self.matches]
            if len({(point.x, point.y) for point in points}) != len(points):
                raise ValueError('Choose different landmarks for each pair.')
        return self


class DrawingResponse(DrawingMetadata):
    model_config = ConfigDict(from_attributes=True)
    id: int
    floorplan_id: int
    filename: str
    file_path: str
    file_type: str
    size_bytes: int
    placement: Placement | None


async def floor(db, floorplan_id, *, lock=False):
    statement = select(models.Floorplan).where(models.Floorplan.id == floorplan_id)
    if lock:
        statement = statement.with_for_update()
    item = (await db.execute(statement)).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, 'Floorplan not found.')
    return item


async def drawing(db, floorplan_id, drawing_id):
    item = await db.get(models.FloorplanDrawing, drawing_id)
    if not item or item.floorplan_id != floorplan_id:
        raise HTTPException(404, 'Drawing not found on this floorplan.')
    return item


async def resolve_discipline(db, floorplan_id, name, *, excluding_id=None):
    label = ' '.join(name.split())
    key = label.casefold()
    if key == 'mechanical / hvac':
        return 'hvac'
    if key in STANDARD_DISCIPLINES:
        return key
    drawings = models.FloorplanDrawing
    statement = select(drawings.discipline).where(drawings.floorplan_id == floorplan_id).order_by(drawings.id)
    if excluding_id is not None:
        statement = statement.where(drawings.id != excluding_id)
    labels = (await db.scalars(statement)).all()
    return next((existing for existing in labels if existing.casefold() == key), label)


@router.get('', response_model=list[DrawingResponse])
async def list_drawings(floorplan_id: int, db: AsyncSession = Depends(get_db), user=Depends(require_user)):
    await floor(db, floorplan_id)
    return (await db.execute(select(models.FloorplanDrawing).where(
        models.FloorplanDrawing.floorplan_id == floorplan_id).order_by(models.FloorplanDrawing.id.desc()))).scalars().all()


@router.post('', response_model=DrawingResponse)
async def upload_drawing(floorplan_id: int, title: str = Form(...), discipline: str = Form(...),
                         file: UploadFile = File(...), sheet_number: str = Form(''), project: str = Form(''),
                         drawing_date: str = Form(''), revision: str = Form(''), page_number: int = Form(1),
                         db: AsyncSession = Depends(get_db), user=Depends(require_editor)):
    await floor(db, floorplan_id)
    try:
        metadata = DrawingMetadata(title=title, discipline=discipline, sheet_number=sheet_number,
            project=project, drawing_date=drawing_date, revision=revision, page_number=page_number)
    except ValueError as error:
        raise HTTPException(422, str(error))
    filename = (file.filename or '').replace('\\', '/').split('/')[-1]
    suffix = Path(filename).suffix.lower()
    if suffix not in {'.pdf', '.svg', '.png', '.jpg', '.jpeg', '.webp'} or len(filename) > 255:
        raise HTTPException(400, 'Choose a PDF, SVG, PNG, JPG or WebP drawing.')
    if suffix != '.pdf' and metadata.page_number != 1:
        raise HTTPException(422, 'Page selection is available for PDFs only.')
    folder = Path(UPLOAD_DIR) / 'floorplan-drawings'
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (uuid4().hex + suffix)
    size = 0
    try:
        with path.open('xb') as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, 'Choose a drawing under 50 MB.')
                output.write(chunk)
        if not size:
            raise HTTPException(400, 'The drawing is empty.')
        await run_in_threadpool(validate_source, path, suffix, metadata.page_number)
        base = await floor(db, floorplan_id, lock=True)
        metadata.discipline = await resolve_discipline(db, floorplan_id, metadata.discipline)
        item = models.FloorplanDrawing(floorplan_id=floorplan_id, **metadata.model_dump(),
            filename=filename, file_path='/uploads/floorplan-drawings/' + path.name,
            file_type='pdf' if suffix == '.pdf' else 'svg' if suffix == '.svg' else 'image', size_bytes=size)
        db.add(item)
        await db.flush()
        await log_action(db, 'upload_drawing', 'floorplan', base.id, base.name,
            new_values={**DrawingResponse.model_validate(item).model_dump(), 'placement': None},
            message=f"Added drawing '{metadata.title}' to '{base.name}'", user=user)
        await db.commit()
        await db.refresh(item)
        return item
    except Exception:
        await db.rollback()
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@router.put('/{drawing_id}', response_model=DrawingResponse)
async def update_drawing(floorplan_id: int, drawing_id: int, data: DrawingMetadata,
                         db: AsyncSession = Depends(get_db), user=Depends(require_editor)):
    base = await floor(db, floorplan_id, lock=True)
    item = await drawing(db, floorplan_id, drawing_id)
    if item.file_type != 'pdf' and data.page_number != 1:
        raise HTTPException(422, 'Page selection is available for PDFs only.')
    if item.file_type == 'pdf' and item.page_number != data.page_number:
        await run_in_threadpool(validate_source, Path(UPLOAD_DIR) / item.file_path.removeprefix('/uploads/'), '.pdf', data.page_number)
    old = DrawingResponse.model_validate(item).model_dump()
    data.discipline = await resolve_discipline(db, floorplan_id, data.discipline, excluding_id=item.id)
    if item.page_number != data.page_number:
        item.placement = None
    for field, value in data.model_dump().items():
        setattr(item, field, value)
    await log_action(db, 'update_drawing', 'floorplan', base.id, base.name, old_values=old,
        new_values=DrawingResponse.model_validate(item).model_dump(), message=f"Updated drawing '{item.title}'", user=user)
    await db.commit()
    return item


@router.put('/{drawing_id}/placement', response_model=DrawingResponse)
async def place_drawing(floorplan_id: int, drawing_id: int, data: Placement,
                        db: AsyncSession = Depends(get_db), user=Depends(require_editor)):
    base = await floor(db, floorplan_id, lock=True)
    if base.file_path != data.base_file_path:
        raise HTTPException(409, 'The floorplan drawing changed. Reload before saving alignment.')
    item = await drawing(db, floorplan_id, drawing_id)
    if data.matches and item.file_type != 'image':
        raise HTTPException(422, 'Match points are available for image drawings.')
    old = item.placement
    item.placement = data.model_dump()
    await log_action(db, 'align_drawing', 'floorplan', base.id, base.name,
        old_values={'drawing_id': item.id, 'placement': old},
        new_values={'drawing_id': item.id, 'placement': item.placement},
        message=f"Aligned drawing '{item.title}'", user=user)
    await db.commit()
    return item


@router.delete('/{drawing_id}')
async def remove_drawing(floorplan_id: int, drawing_id: int,
                         db: AsyncSession = Depends(get_db), user=Depends(require_editor)):
    base = await floor(db, floorplan_id, lock=True)
    item = await drawing(db, floorplan_id, drawing_id)
    await log_action(db, 'remove_drawing', 'floorplan', base.id, base.name,
        old_values=DrawingResponse.model_validate(item).model_dump(),
        message=f"Removed drawing '{item.title}' from '{base.name}'", user=user)
    await db.delete(item)
    await db.commit()
    return {'message': 'Drawing removed. The source file is retained in upload history.'}
