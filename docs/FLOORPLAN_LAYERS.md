# Floorplan drawing layers

Open a two-dimensional floorplan and select **Layers**. The base floorplan and its equipment, room and work-order coordinates remain the primary map. Drawings are separate reference records grouped by Mechanical / HVAC, Plumbing, Electrical and Other.

Users with the existing item-management permission can upload PDF, SVG, PNG, JPEG and WebP files up to 50 MB. Record a title, drawing number, project/area, date, revision and PDF page. Uploads initially remain reference documents; choose **Align & coverage** to display them on the map.

Use **Move drawing** to drag the sheet, or use the offset, scale and rotation fields to align it. **Coverage points** shows a shaded rectangle on the floorplan; drag its four numbered corner points to choose where the drawing appears. **Crop points** shows a separate rectangle on the uploaded sheet; drag those points to trim margins. Arrow keys adjust a focused point, and Shift uses a larger step. Coverage coordinates and independent crop **Left**, **Top**, **Right** and **Bottom** percentages stay synchronized with dragging. **Show coverage** / **Show crop** brings the active boundary and its handles into view, including on narrow screens. Save the placement. Coverage clips the visible overlay; source cropping removes margins within the uploaded sheet. These are independent settings.

With Layers open, coverage labels select sheets. Clicking an empty map location lists all mapped sheets covering that point; pins keep their normal interaction. One sheet displays by default. When coverage overlaps, **Compare with** adds a second sheet, and the opacity slider crossfades between them. **Floorplan only** clears overlays. Closing the panel preserves the selected drawing and its source label.

No drawing is automatically treated as authoritative based on its date. Coverage describes what the sheet depicts, not necessarily the renovation's area of work. Replacing the base floorplan marks existing placements **Alignment needs review** and prevents their display until reviewed. Changing a PDF page clears its placement.

Drawing uploads, edits, alignments and removals are audited and support guarded Undo. Removed files remain in upload history. The upload catalog protects attached drawings from cleanup, including after restart, and shows their owning floorplan. Floorplan/site deletion snapshots also retain drawing records for restoration. The new table is created by normal database initialization; there are no changes to existing floorplan, pin or calibration payloads.

This first version supports rectangular coverage and manual alignment. It does not combine sheets into an authoritative composite, infer renovation scope, or provide polygon coverage or automatic registration. Large/distorted scans may require preparation before alignment. Offline drawing catalogs are not currently provided; existing offline floorplan behavior is unchanged.

Validation:

- `cd backend; python -m unittest test_floorplan_drawings test_upload_inventory -q` uses isolated SQLite databases and temporary upload directories.
- Build the frontend, then start `python backend/tests/drawing_browser_fixture.py`. It serves the built UI and real drawing APIs on `http://127.0.0.1:8768` with a temporary database and files. It never opens the application database.
- In `frontend`, run `node tests/floorplan-layers-browser.cjs` against that fixture for upload, placement, coverage, comparison, PDF-page/image rendering, keyboard and responsive checks.

The preview also supplies dashboard list endpoints and returns JSON errors for unsupported APIs. For an interactive preview, `DRAWING_PREVIEW_DATA` can point to a dedicated sample-data directory to retain preview records across restarts. `/api/fixture/recover` removes invalid equipment/room/ticket cache entries and returns to the sample dashboard without deleting drawings.

The UI reuses Outfit, Lucide, shared button/input/form/modal classes, `TiledFloorplan` and `BoundedImageFloorplan`. `TiledFloorplan` accepts an optional page number, defaulting to its existing first-page behavior. The feature's `DrawingRegionEditor` is reused immediately by the coverage and crop editors, including their drag, keyboard and zoom behavior.
