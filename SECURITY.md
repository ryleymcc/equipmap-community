# Security policy

Report vulnerabilities privately through GitHub's private vulnerability reporting
on this repository when enabled. Do not post secrets or facility data in public
issues. If that channel is unavailable, ask the maintainer for a private channel
without including exploit details or private data.

## Deployment boundaries

Use HTTPS, strong independent passwords, restricted server access, and off-host
encrypted backups. Keep .env, uploads, backend/data, and database volumes private.

Current limitations:
- Facility read endpoints and upload URLs allow unauthenticated viewing.
- CORS currently accepts HTTP(S) origins broadly.
- Rate-limit/session caches are process-local; the supplied deployment uses one
  API worker. Horizontal scaling is not validated.
- Database startup errors are logged while /health can still return success.
- Schema changes use startup code rather than a versioned migration framework.
- PWA/browser caches can retain operational data.
- Push subscription registration accepts unauthenticated requests tied to user
  IDs. Keep push endpoints behind the deployment's access gateway as well.

Public maintenance requests record requester contact fields, IP address,
user-agent, and submitted device details for triage. Set an appropriate retention
policy and explain this collection to requesters.

For sensitive deployments, use a VPN or access gateway in front of the entire
application. URL knowledge must not be treated as authorization. Public source
availability does not make facility data public.

Monitoring is opt-in. Before enabling your own Sentry destinations, review what
logs, errors, request metadata, and replay data may be collected.
