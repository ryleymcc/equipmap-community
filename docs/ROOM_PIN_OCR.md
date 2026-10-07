# Experimental room pin generation

Open **Floorplans → floorplan options → Generate room pins** as an editor.
PDFs (page one, matching the map) and images are supported. Choose **300, 450,
600, 900 or 1200 DPI** before scanning. The default is 450 DPI. Local Tesseract
scans once at exactly that resolution, using 3600-pixel tiles with a **240-pixel
overlap** between adjacent tiles, horizontally and vertically. There is no scout
pass, automatic resolution selection or automatic fallback. The selected DPI is
shown while scanning and in the results. Change the selection and use **Rescan
floorplan** to compare another resolution before applying pins.

Higher DPI is not always more accurate. On the actual Level 5 source, the previous
automatic scan chose 600 DPI and missed `5B141`; a full 450 DPI scan detects it with
92% OCR confidence. Enlarging a blurry raster source cannot restore missing detail.
Embedded PDF codes take precedence over OCR readings at the same location. Image
quality still limits what can be recognized; rotated raster text may be missed.

Review the drawing and select proposals before applying. Confident existing
matches are selected initially; new rooms and lower-confidence matches are not.
Application updates coordinates without replacing room IDs, names, descriptions,
or linked records. Positions use the map's 2000-unit drawing width.

Matching ignores case, whitespace, hyphens, underscores and leading zeros in
numeric runs (`1EN01` equals `1EN1`). Matching existing rooms is restricted to the
current floorplan. A match elsewhere in the same site, multiple existing matches,
repeated labels in distinct locations, or conflicting readings at one position
needs manual resolution and cannot be applied here. Other numbers and letters
identify distinct rooms: `5B141` is not a match for `5B11`, `5B14` or `5B41`.
Existing duplicate room records are not merged or deleted. No cross-site matching
is performed. Numeric notes can appear as proposals, so review new rooms carefully.

The server rechecks the source file and the site's room identity/position snapshot
before applying. Concurrent scan applications are serialized per floorplan and a
scan cannot be applied twice. Normal manual room creation remains unchanged.

Rebuild the backend image to install `tesseract-ocr` and English language data.
The local development container was also provisioned during implementation.
No external OCR service or API key is used.

Scans run in the background, one at a time, with at most four queued jobs, a
bounded tile rendering and a ten-minute processing limit. Previews expire
after one hour (or earlier when the bounded preview cache is full). Jobs are
in-memory and assume the existing single-worker backend; restarting the server
loses pending previews. Multi-worker deployment needs a shared job store first.

Validation: `pytest tests/test_room_ocr.py tests/test_floorplans.py
tests/test_rooms_equipment.py -q`, focused frontend lint and production build.

Manual-resolution validation passed eight focused OCR tests, frontend lint and
the production build. Tests cover accepted DPI values, rejection of `auto`, room
matching, preservation of existing rooms, repeat-application protection, and a
raster label crossing a tile boundary.

The signed-in **Level 5 → Generate room pins** path was exercised with the actual
source drawing, including a 450 DPI scan and rescans at 300 and 450 DPI. The DPI
selector and results were checked at 1440×900, 1024×768 and 390×844, with keyboard
focus wrapping, 44px phone controls, no page overflow and no console errors.
`5B141` is detected with 92% confidence at 450 DPI and is available to create
despite the distinct existing names `5B11`, `5B14` and `5B41`. No real room pins
were applied during validation.

Implementation references: [PyMuPDF page rendering](https://pymupdf.readthedocs.io/en/latest/page.html)
and [Tesseract sparse-text segmentation](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html).
