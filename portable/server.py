"""Same-origin, loopback-only host for the existing EquipMap API and UI."""
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.responses import JSONResponse


class LocalOnly:
    def __init__(self, app, origin):
        self.app, self.origin = app, origin
        self.host = origin.split('://', 1)[1]

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http':
            headers = dict(scope['headers'])
            host = headers.get(b'host', b'').decode('latin-1')
            origin = headers.get(b'origin', b'').decode('latin-1')
            if host != self.host or (origin and origin != self.origin) or headers.get(b'sec-fetch-site') == b'cross-site':
                await JSONResponse({'detail': 'Local EquipMap requests only'}, status_code=403)(scope, receive, send)
                return
            if scope['path'].startswith(('/api/chatgpt/', '/docs', '/swagger', '/redoc', '/swag', '/api-docs')):
                await JSONResponse({'detail': 'External integrations are unavailable in the offline edition'}, status_code=503)(scope, receive, send)
                return

        async def local_headers(message):
            if message['type'] == 'http.response.start':
                message['headers'].append((b'content-security-policy', (
                    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
                    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                    "font-src 'self'; connect-src 'self'; worker-src 'self' blob:; "
                    "object-src 'none'; frame-src 'self' blob:; base-uri 'self'; frame-ancestors 'none'"
                ).encode()))
            await send(message)

        await self.app(scope, receive, local_headers)


def create_app(frontend: Path, origin: str, shared=None):
    from main import app

    @app.get('/{path:path}', include_in_schema=False)
    async def frontend_file(path: str):
        if path.startswith(('api/', 'uploads/', '.well-known/', 'mcp')):
            raise HTTPException(404)
        target = (frontend / path).resolve()
        if not target.is_relative_to(frontend.resolve()):
            raise HTTPException(404)
        if not target.is_file():
            if Path(path).suffix:
                raise HTTPException(404)
            target = frontend / 'index.html'
        return FileResponse(target, headers={'Cache-Control': 'no-cache'})

    if shared is not None:
        from shared_store import SharedRequests
        startup_handlers = list(app.router.on_startup)
        async def shared_startup():
            async with shared.transaction():
                for handler in startup_handlers:
                    await handler()
        app.router.on_startup = [shared_startup]
        return LocalOnly(SharedRequests(app, shared), origin)
    return LocalOnly(app, origin)
