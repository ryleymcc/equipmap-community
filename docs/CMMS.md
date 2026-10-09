# Native CMMS edition

This branch is the full work-order edition of EquipMap Community, under
AGPL-3.0-only. Work orders, PM schedules, task sheets, categories, task types,
trades, assignments, comments, and labor live in your own PostgreSQL database.
No TMA login, proxy, import tools, facility exports, or external CMMS is included.

## Install

Clone `--branch cmms` and follow [HOSTING.md](HOSTING.md). Use fresh PostgreSQL
and upload storage for a new installation. Docker Compose runs one backend
worker, including the PM scheduler. The public release starts empty; configure
sites, floorplans, rooms, equipment, task sheets, and staff yourself.

1. Set strong `DB_PASSWORD`, `SECRET_KEY`, and `INITIAL_ADMIN_PASSWORD` in `.env`.
2. Start Docker Compose and sign in as `admin`.
3. Add a site and upload its floorplans. Place rooms and equipment on the map.
4. Use User Management to create staff and assign their roles and permissions.
5. Manage trades in User Management. The initial suggestions are generic;
   add your own names and codes.
6. Use Task Templates to configure task sheets, task types, categories,
   linked assets, and checklists before creating recurring work.

## Work-order flow

- **Request:** `/request` lets people submit a maintenance request without an
  account. Requests enter the triage queue. It is rate limited, but does not
  include CAPTCHA or email verification; restrict its access if needed.
- **Create:** staff can create work orders from the dashboard or map, optionally
  linking a task sheet, rooms, equipment, assignees, and planned dates.
- **Triage and dispatch:** staff with triage/assignment permissions review the
  request, set its priority/trade, and assign technicians. Dashboard filters
  distinguish PM work, public requests, staff-created work, status, and ownership.
- **Perform:** record comments, checklist progress, and labor against the order.
  Labor can be recorded before completion. The order retains its linked assets.
- **Complete:** record completion notes and labor, then close the order. Completed
  work is available in history. List/calendar and print views support dispatch.
- **Bulk work:** authorized users can assign, close, or delete selected orders;
  each operation checks permissions and returns changed record IDs and counts.

Viewers can read the authenticated work-order collections but cannot modify
work orders, even if an older database retained permission flags. Administrators
manage users, trades, and all work. Technician/editor capabilities and ownership
are checked by the API; the dashboard shows only permitted actions.

## Preventive maintenance

Open Preventive Maintenance Schedules from Work Orders. Configure the recurrence,
timezone, start/end conditions, task sheet/checklist, linked assets, and assignees.
Preview upcoming occurrences before saving. Schedules can be edited or paused,
and authorized users can manually trigger generation.

The backend scans due schedules every 60 seconds, starting shortly after database
initialization. Keep the backend running for automatic generation. Occurrence
uniqueness prevents duplicate PM orders; PostgreSQL transaction locks serialize
work-order number allocation. Keep the provided **one-worker** Compose command.
Multi-instance/high-availability scheduling is outside the tested deployment.

## Push notifications

Notifications are optional. Users explicitly enable them in a compatible browser;
HTTPS is required on public hosts. VAPID keys are generated into private backend
storage and must persist across upgrades. Back up `backend_data` as described in
HOSTING.md. Set `VAPID_CLAIMS_SUB` to your operator contact (for example,
`mailto:maintenance@example.org`) in `.env`. No vendor Sentry destination is used
unless the operator configures one. Live external push delivery was not verified
for this release; subscription/API behavior is covered by automated tests.

## Existing databases and upgrades

This edition uses additive startup schema changes, rather than a versioned
migration framework. Back up the database, uploads, and private backend data
before switching from `main` or another checkout. Test the upgrade on a restored
copy first. The release was verified with fresh PostgreSQL; arbitrary historical
production schemas are not certified. Rollback requires restoring the backup,
not simply changing the Git branch.

Use `git pull --ff-only origin cmms` for this edition. Read [SECURITY.md](../SECURITY.md)
before exposing a host: facility reads and upload URLs remain public, and the
request portal accepts unauthenticated submissions. Restrict sensitive facilities
with a VPN or access gateway. Authentication of work orders does not protect the
public floorplan and asset endpoints.
