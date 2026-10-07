# Initial community release

This source snapshot intentionally starts a new Git history. The original
repository history was not copied because it contains private operational files.

Excluded: browser authentication state, SQLite database, TMA exports and discovery
scripts, deployment/database synchronization scripts, production reverse-proxy
configuration, third-party API captures, facility demonstration recordings, and
generated development service workers.

Included: current application source, including local ChatGPT review changes,
tests, UI guidance, generic hosting configuration, and dependency lockfiles.
Those local application changes are not represented as previously released.

Community-specific changes:
- Monitoring destinations are empty by default.
- WebTMA routes, frontend controls, cache/session code, and integration tests are removed.
- Production authentication settings are passed into the API.
- One worker and persistent backend data are used.
- A standalone Caddy proxy routes API, uploads, MCP discovery, and SPA requests.
- Demo footage from a real facility is omitted.

See SECURITY.md for remaining deployment limitations. This preparation is not a
complete security audit or certification. Before publishing, inspect the staged
file list, scan for credentials and private data, and run the validation steps in
CONTRIBUTING.md. Keep the original repository private; use only this fresh history.
