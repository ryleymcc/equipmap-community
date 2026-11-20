# Room and equipment photos

One replaceable photo per saved item is available in the floorplan right drawer and through the thumbnail beside the name in equipment/room tables and mobile cards. Create the item first, then add its photo. Photos save immediately, independently of the text form. Existing item-management permission is required; viewers can see photos.

The **Full screen** button opens a viewport-sized viewer with zoom in/out, fit-to-screen, mouse-wheel zoom, drag-to-pan and touch pinch gestures. Escape or Close exits and returns focus to the opener. Online it uses the highest stored derivative (1280px maximum), not the discarded original; offline it enlarges only the saved thumbnail. No additional full-resolution downloads or offline caches are introduced. The viewer reuses the existing `react-zoom-pan-pinch` library and shared button/header styles.

## Processing and storage

- Accept JPEG, PNG and non-animated WebP. Input limit: 12 MiB and 24 million pixels; unsupported formats (including HEIC/SVG) are rejected.
- Decode on a worker thread, with at most two concurrent processing jobs per backend worker. Correct EXIF orientation, strip metadata, never upscale and retain aspect ratio.
- Store two WebP derivatives in the existing persistent `uploads/entity-photos/` volume: longest edge 160px (quality 65) and 1280px (quality 78). Discard the original. Table images are lazy-loaded and decoded asynchronously. A full 1280px image needs at most about 6.25 MiB of decoded RGBA memory; a thumbnail about 100 KiB.
- UUID filenames change on every replacement. Existing equipment `photo_path` is reused; startup adds nullable `rooms.photo_path`. Both API schemas expose `photo_thumbnail_path`. Existing ETag hashes include row versions, so photo updates invalidate entity/floorplan data.
- Photo upload/removal is audited. Old derivatives are retained for audit undo; removing the photo clears its association, not copies already on CDN/browser caches. Storage cleanup and CDN purge for permanent erasure require a separate retention policy. Legacy original-only equipment photos are not loaded by the new UI; replace them to generate bounded derivatives.

## Offline behavior

The service worker caches only thumbnails, never preview images. The dedicated thumbnail cache is limited to 600 entries and a 30-day runtime TTL. Background offline sync fetches thumbnails sequentially with low priority; viewed thumbnails also enter this cache. Devices retain the most recently cached subset rather than an unlimited photo library. Browser storage quotas/eviction still apply.

The drawer and table dialog use the saved thumbnail while offline, with upload/removal disabled. A failed online preview falls back to its thumbnail. Auth network failures preserve the existing offline caches instead of clearing them. Offline reload does not grant editing privileges.

## Hosting

Rebuild both Compose images and preserve the uploads directory. Caddy forwards
the backend cache headers. Thumbnail responses allow immutable caching and
preview responses send browser Cache-Control: no-store. Photos use the same
public upload access as floorplans.

## Local verification



- From `backend`: `python -m unittest test_photo_support -v` (uses isolated SQLite, requires aiosqlite for tests; production stays on PostgreSQL).
- From `frontend`: `node --test tests/*.test.js` and `npm run build`.
- Start `python frontend/tests/photo-browser-fixture.py` from the repository root; then run `node tests/photo-browser.cjs` from `frontend`. This serves the production build with synthetic records and photos at localhost:4187. It exercises table dialogs and map drawers at 1440x900, 1024x768 and 390x844, keyboard dismissal/focus return, replace/remove, and offline reload with thumbnail-only cache inspection. It needs the installed Edge browser. No production services or data are used.

Reused UI: shared input/button/modal classes, Outfit and Lucide icons. `EntityPhoto` is the new shared photo primitive, immediately consumed by both forms, both tables and both mobile cards.
