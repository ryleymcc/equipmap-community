# Hosting EquipMap Community

This guide uses Docker Compose v2 and Caddy on a Linux server. The same stack
works locally with Docker Desktop. It does not use the original operator's VPS,
proxy network, deployment scripts, or data.

## 1. Prepare the server

Install Docker Engine and the Compose plugin using Docker's official instructions:
https://docs.docker.com/engine/install/

Use a host you administer. A small pilot can start with 2 CPU cores, 4 GB RAM,
and storage sized for your PDFs and backups; OCR workloads may need more.
Allow SSH only from trusted addresses. For public HTTPS, point your domain's
A record (and AAAA only if IPv6 works) at the server. Ports 80 and 443 must
reach Caddy for certificate issuance. Do not expose PostgreSQL or the API port.
If an existing proxy owns these ports, integrate deliberately rather than
stopping other services.

Clone the new community repository and enter it:

```sh
git clone https://github.com/ryleymcc/equipmap-community.git
cd equipmap-community
cp .env.example .env
chmod 600 .env
mkdir -p uploads
```



## 2. Configure secrets and domain

Generate three different values, running this command once for each:

```sh
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Put them in DB_PASSWORD, SECRET_KEY, and INITIAL_ADMIN_PASSWORD. Use hex for the
database password so reserved URL characters do not break DATABASE_URL.
Keep DB_USER and DB_NAME unchanged after the first initialization unless you
explicitly migrate the database.

For public hosting set:

```dotenv
EQUIPMAP_ADDRESS=equipmap.example.com
HTTP_BIND=0.0.0.0
HTTPS_BIND=0.0.0.0
```

Caddy automatically obtains and renews HTTPS certificates for the configured
domain. Keep its data volume; it holds certificate/account material.
https://caddyserver.com/docs/automatic-https

For a localhost pilot leave the example address and loopback bindings.
HTTP localhost is for local use; remote PWA/service-worker behavior needs HTTPS.

## 3. Start and verify

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 backend proxy
curl -fsS https://equipmap.example.com/health
```

Check backend logs for successful database initialization and administrator
bootstrapping. /health alone does not confirm database readiness.
Visit the domain, sign in as admin using INITIAL_ADMIN_PASSWORD, create a site,
upload a synthetic floorplan, add a room/equipment pin, search for it, and
refresh its direct map link. Verify the PDF worker loads without browser errors.

After successful sign-in, remove INITIAL_ADMIN_PASSWORD from .env and recreate
the API container:

```sh
docker compose up -d --force-recreate backend
```

That variable only creates an admin when there are no users; it does not reset
an existing password. Use User Management to create individual accounts.

## 4. Optional integrations

Sentry is off by default. Supply your own SENTRY_DSN and VITE_SENTRY_DSN to enable
it, review collection/privacy settings, and rebuild the frontend after changes.

For ChatGPT/MCP set CHATGPT_ENABLED=true, CHATGPT_PUBLIC_URL and
CHATGPT_FRONTEND_URL to your HTTPS origin, and CHATGPT_REDIRECT_URIS to the exact
trusted callback displayed by your connector setup. Recreate backend.
The proxy forwards /mcp, /.well-known/*, and /api/chatgpt/* without stripping
prefixes. Use one API worker because sessions/caches are process-local.
Do not share client credentials or tokens in public issues.

## 5. Back up and restore

Preserve PostgreSQL, uploads, backend_data (push keys), .env, and the source
revision. Treat every backup as
sensitive. Encrypt it, copy it off-host, set a retention policy, and test restore.

For a consistent manual backup, briefly stop API writes:

```sh
mkdir -p backups
chmod 700 backups
docker compose stop backend
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/database.dump
tar -czf backups/uploads.tar.gz uploads
docker compose run --rm --no-deps -v "$PWD/backups:/backup" --entrypoint sh backend -c 'tar -czf /backup/backend-data.tar.gz -C /app/data .'
cp .env backups/environment.env
git rev-parse HEAD > backups/revision.txt
docker compose start backend
```

Check every exit status; never replace a good backup with a failed/empty dump.
If a command fails, restart the backend and investigate. These commands are for
Linux shells; Windows redirection can alter binary output, so perform dumps on
the Linux host or use Docker's file copy workflow.

Restore into an isolated, empty deployment using the saved secrets/revision:

```sh
docker compose up -d db
# Wait for db to report healthy before the next command.
docker compose cp backups/database.dump db:/tmp/database.dump
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-ryleymcc --exit-on-error /tmp/database.dump'
tar -xzf backups/uploads.tar.gz
docker compose run --rm --no-deps -v "$PWD/backups:/backup" --entrypoint sh backend -c 'tar -xzf /backup/backend-data.tar.gz -C /app/data'
docker compose up -d --build
```

Restore only into an empty database, then verify login, record counts, map files,
and attachments. Never test restore against production. Retain SECRET_KEY and
push keys if preserving token/key continuity is desired.

## 6. Upgrade and rollback

Record the current commit and take a verified backup before updating. Review
release notes, fetch the desired release/commit, then:

```sh
docker compose up -d --build
docker compose logs --tail=100 backend
```

Recheck login, real data, PDFs, and direct links. PWA clients may need a refresh
to obtain the new shell. Schema updates currently run at startup; there is no
formal reversible migration system. A rollback may require both the prior source
revision and its matching database/uploads backup. Rebuilding the old image alone
does not undo schema changes.

Never use docker compose down -v on a deployment you want to retain.

## Troubleshooting

- Missing-variable error: populate DB_PASSWORD and SECRET_KEY in .env.
- Login fails on first boot: verify INITIAL_ADMIN_PASSWORD and database logs.
- 502: inspect backend logs and Compose service state.
- Certificate failure: check DNS, firewall, port conflicts, and Caddy logs.
- PDF blank: check the uploaded file and .mjs worker response/MIME type.
- Integration fails: verify HTTPS origins, trusted callbacks, and one worker.
- Monitor live operation with synthetic sign-in/read checks, disk usage, database
  health, and backup/restore checks; /health is only a liveness signal.

## Sensitive facilities

See SECURITY.md before hosting real floorplans. Upload URLs currently lack
application authentication, and CORS is broad. Restrict the whole deployment
behind a VPN/access gateway when facility records are sensitive. This hosting
guide does not claim the application is safe for unrestricted public data access.
