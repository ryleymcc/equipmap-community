# Release preparation validation

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
