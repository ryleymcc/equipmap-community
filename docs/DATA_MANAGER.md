# Audit dashboard data manager

Admins can open **Audit history → Data manager** (`/audit-log/data`) and view upload storage. This feature never deletes automatically. It shows sizes and status, supports filtering and pagination, and deletes only explicitly selected files after permanent-deletion confirmation (at most 100 per request).

The default **Not in use** view includes all uploads no longer attached to active records, including those retained for undo and recent detached uploads. **Ready to delete** identifies unreferenced files, regardless of upload age; it is a separate filter, not the default. Removing a photo therefore leaves it visible in the default view with its retention status.

Click a filename to open a read-only preview in the page. Images and SVGs can be enlarged with the existing fullscreen zoom viewer; PDFs render one page at a time with page controls; GLB files use the existing interactive 3D viewer. Only the selected file is loaded, and closing releases the preview component. Escape closes the preview and restores focus to the filename. Protected files remain viewable without becoming eligible for deletion.

## Persistent upload index

`upload_assets` stores each file's size, timestamps and fingerprint. `upload_references` stores live-entity and audit-history references, including both photo variants. Startup reconciles the catalog once against the disk and domain/audit records. ORM create/update/delete events maintain affected references and file metadata in the same database transaction as the entity mutation; rollback rolls back the catalog too. Uploads, replacements, removals, cascades and audit undo are covered. Normal page loads and **Refresh uploads** read these tables without disk scans, nested audit JSON traversal, or a 30-second cache. Upload age is informational and does not restrict deletion.

For files added/removed by scripts or filesystem tools outside the application, restart the backend or POST to the admin-only `/api/data-manager/uploads/reconcile` endpoint. This explicit repair operation performs a full scan; ordinary refresh does not. Reconciliation is serialized with PostgreSQL advisory/table locks and commits atomically, so readers see a consistent catalog.

Deletion deliberately verifies current domain/history references directly and stats only the selected files (maximum 100); it does not rely on catalog accuracy or walk the whole directory. Successful deletion removes those catalog entries in the same request. HTTP/offline caching remains disabled.

## Protection rules

- Current floorplan files, previous floorplan revisions and room/equipment photos are protected. A managed photo reference protects both its preview and thumbnail.
- Nested old/new audit values are scanned across the entire audit history, including deleted entities, to retain files needed for undo. Undo-retained files of any age are selectable alongside other detached files, without an extra opt-in. The permanent-deletion confirmation explains the loss of affected undo actions. Affected audit records remain, but their undo action is disabled with an explanation; other undo records stay unchanged. Files that fail to delete do not disable their undo actions. Purging history or changing retention policy is outside this feature.
- There is no age-based cleanup block. Newly uploaded files can be deleted as soon as they are no longer actively referenced.
- Only media in the upload root and immediate `entity-photos` directory is scanned. Other folders, nonmedia files (including JSON caches/backups), symlinks and paths outside the upload root are excluded. The supported media extensions are PDF, SVG, PNG, JPEG/JPG, WebP and GLB.
- The server scans references again under PostgreSQL table locks before deleting. Selections include the file's size/modification/change-time fingerprint, so stale or changed selections are rejected with 409. The whole request is validated before any deletion; filesystem failures are reported per file.
- Catalog reads, reconciliation and deletion require the existing admin permission. Data-manager APIs are excluded from offline/service-worker and ETag caching, and return no-store.

Disabling an undo action releases its other file-retention references too, unless another active entity or enabled audit entry still requires them. Active files cannot be deleted through cleanup.

Cleanup is permanent at the origin. CDN/browser copies may persist until expiration or separate purge. Cleanup events record names and bytes freed in audit history; they cannot be undone. Previously cached files do not count toward origin disk space.

## Validation

`python -m unittest test_upload_inventory -v` from backend uses temporary files and isolated SQLite to check references, immediate deletion of recent detached files, file identity, permissions, stale scans, actual deletion and audit records. `node tests/data-manager-browser.cjs` from frontend exercises the actual page using synthetic network responses in Edge; deletion in this test does not touch real files. It covers desktop/tablet/phone layouts, pagination, selection, cancel/confirm, failure/empty states and restricted access. The local PostgreSQL catalog was also benchmarked, and incremental index updates plus rollback were exercised in a temporary transaction with no test changes committed. Real disk cleanup was not performed as part of performance verification.

UI reuses shared buttons, input fields, list tables and audit-page layout. `DataManager` and its styles are local to this page; no new global visual primitive was introduced.
