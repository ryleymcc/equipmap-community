# CMMS release validation

Validated October 8, 2026 using a separate empty PostgreSQL installation and
an isolated local Docker Compose stack. The original checkout/deployment was
not modified.

- Backend: **209 passed**, including native work orders, PM recurrence, tasks,
  trades, notification APIs, viewer write restrictions, concurrent creation,
  and TMA route exclusion. Five dependency deprecation/settings warnings remain.
- Production frontend build passed; the existing large-bundle warning remains.
- Focused ESLint: 71 changed/new JavaScript files, zero errors and 11 hook/
  Fast Refresh warnings. Viewer JavaScript tests: 12 passed.
- Compose configuration parsed; production images built and started, with
  successful database initialization and administrator sign-in.
- Browser: created a work order, recorded labor and discussion, completed it,
  verified calendar entries; created a checklist task sheet, linked a monthly
  PM plan, previewed recurrence, manually generated and completed its work order.
- Browser: submitted a synthetic public request, triaged it, set trade/category,
  and assigned a technician. Checked work-order print preview.
- Desktop and 390px work-order layouts were inspected with no document overflow.
  Order details use keyboard focus containment, Tab wraps inside the dialog,
  and Space updates checklist progress. No console errors in the final paths.
- Reused shared modal/button/input/panel classes and EntitySearchSelector.
  Added a shared useDialogFocus hook for details and completion dialogs.
- Removed unused TMA styles as well as runtime integration code. No vendor
  credentials, imports, production database, or private source history included.
- Gitleaks scanned the exported Git index with no findings. Five test-fixture
  strings were reviewed and replaced with clearly synthetic values; their 17
  affected tests passed again.

Browser validation bypassed the local service-worker cache to inspect the
current build. Full PWA upgrades, arbitrary historical database migrations,
physical printing, public HTTPS issuance, backup restoration, live external
push, and external ChatGPT integration were not exercised. See SECURITY.md for
the public floorplan/asset-read boundary and CMMS.md for deployment constraints.

Validation data, local secrets, generated files, and helper scripts are excluded
from Git. The new CMMS screenshot uses synthetic records only.

## Earlier mapping-only release validation

Validated on October 6, 2026 in an isolated local Docker deployment.

- Production frontend build passed (existing large-bundle warning).
- Focused ESLint passed with no errors and six existing hook dependency warnings.
- Backend suite: 150 passed, including community API exclusion checks.
- ChatGPT viewer JavaScript suites: 12 passed.
- npm audit after compatible patches: zero reported vulnerabilities.
- Compose configuration parsed and images built; PostgreSQL became healthy and
  backend logs confirmed database initialization.
- Browser: administrator sign-in; create site; synthetic SVG upload and automatic
  room extraction; equipment placement and search; equipment and room list editing.
- Desktop and 390px layouts inspected; narrow room layout had no document overflow.
  Keyboard Tab moved between edit fields. No console errors in the final path.
- Shared buttons, inputs, panels, and card/table layouts were reused. Pagination
  now uses shared list classes consumed by equipment, rooms, and tickets.
- The removed WebTMA login endpoint returned 404; no TMA routes appear in OpenAPI.

Earlier test runs intermittently rejected fresh tokens with 401 while Docker
builds ran concurrently. The final full run passed. JWT validation was not
relaxed; exception-class logging was added for future diagnosis. This remains
an observation rather than a confirmed root cause or resolved timing defect.

Browser validation bypassed a stale local service-worker cache to check the
current build. The full PWA upgrade lifecycle was not tested. Public HTTPS
certificate issuance, backup restoration, production deployments, live push,
and external ChatGPT integration were not exercised.

Synthetic validation data and local environment secrets are excluded from Git.
See SECURITY.md for the application's public-read deployment boundary.
