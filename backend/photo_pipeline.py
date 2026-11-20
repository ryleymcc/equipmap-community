"""Bounded, metadata-free photo derivatives; never persist the uploaded original."""
from io import BytesIO
from pathlib import Path
import asyncio
import uuid
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 24_000_000
PHOTO_SLOTS = asyncio.Semaphore(2)


def process_photo(data: bytes, upload_dir: str) -> str:
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Choose an image under 12 MB.")
    outputs = []
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data), formats=['JPEG', 'PNG', 'WEBP']) as source:
                if source.width * source.height > MAX_PIXELS:
                    raise HTTPException(413, "Choose an image no larger than 24 megapixels.")
                if getattr(source, 'is_animated', False):
                    raise HTTPException(415, "Animated images are not supported.")
                source.load()
                image = ImageOps.exif_transpose(source).convert('RGB')
                image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
                # A fresh image carries no EXIF, GPS, XMP or ICC metadata.
                clean = Image.new('RGB', image.size)
                clean.paste(image)
                folder = Path(upload_dir) / 'entity-photos'
                folder.mkdir(parents=True, exist_ok=True)
                key = uuid.uuid4().hex
                for variant, edge, quality in [('preview', 1280, 78), ('thumb', 160, 65)]:
                    resized = clean.copy()
                    resized.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                    output = folder / f'{key}.{variant}.webp'
                    outputs.append(output)
                    resized.save(output, 'WEBP', quality=quality, method=4)
                return f'/uploads/entity-photos/{key}.preview.webp'
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        for output in outputs:
            output.unlink(missing_ok=True)
        raise HTTPException(415, "Choose a valid JPEG, PNG or WebP image.")


async def save_photo(upload, upload_dir):
    # Bound simultaneous reads and CPU-heavy decodes across both upload paths.
    async with PHOTO_SLOTS:
        data = await upload.read(MAX_UPLOAD_BYTES + 1)
        return await run_in_threadpool(process_photo, data, upload_dir)
