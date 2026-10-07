# Contributing

Use a feature branch and keep changes focused. Never commit facility records,
uploads, session state, credentials, database exports, or screenshots of real data.

Follow AGENTS.md and docs/UI_STYLE_GUIDE.md for UI work. Use synthetic fixtures.

## Validation

Frontend (Node 22 recommended):

```sh
cd frontend
npm ci
npm run build
npx eslint src/path/to/changed-file.jsx
```

Backend tests use a disposable PostgreSQL database and DROP its public schema.
Never point this harness at production:

```sh
docker compose -p equipmap-tests -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-test
docker compose -p equipmap-tests -f docker-compose.test.yml down
```

Viewer tests:

```sh
node --test backend/tests/*viewer.test.cjs
```

Report the checks you actually performed, including browser verification for UI
changes. Existing lint warnings do not justify adding new ones.
