import asyncio

import pytest
from fastapi import HTTPException

import models
from main import app
from database import get_db
from tests.conftest import TestingSessionLocal
from utils import require_work_order_user, require_manage_pm, require_triage


@pytest.mark.asyncio
async def test_native_cmms_collections_require_sign_in(client):
    for path in ("/api/work-orders", "/api/pm-schedules", "/api/tasks", "/api/trades"):
        response = await client.get(path)
        assert response.status_code == 401, (path, response.text)


@pytest.mark.asyncio
async def test_viewer_cannot_write_with_legacy_permission_flags():
    viewer = models.User(role="viewer", can_triage=True, can_create_pm=True)
    for guard in (require_work_order_user, require_manage_pm, require_triage):
        with pytest.raises(HTTPException) as error:
            await guard(viewer)
        assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_viewer_native_writes_are_denied_by_api(client, viewer_token):
    headers = {"Authorization": f"Bearer {viewer_token}"}
    writes = (
        ("/api/work-orders", {"title": "Viewer request"}),
        ("/api/work-orders/bulk/delete", {"ids": [1]}),
        ("/api/pm-schedules/check-due", None),
        ("/api/tasks", {"code": "VIEWER", "description": "Viewer procedure"}),
    )
    for path, payload in writes:
        response = await client.post(path, headers=headers, json=payload)
        assert response.status_code == 403, (path, response.text)


@pytest.mark.asyncio
async def test_parallel_work_order_creation_allocates_unique_numbers(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    # The regular fixture shares a session; real parallel requests each own one.
    async def request_session():
        async with TestingSessionLocal() as session:
            yield session

    previous = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = request_session
    try:
        responses = await asyncio.gather(*(
            client.post("/api/work-orders", headers=headers, json={
                "title": f"Concurrent maintenance request {i}",
                "description": "Synthetic release validation",
            }) for i in range(3)
        ))
    finally:
        app.dependency_overrides[get_db] = previous
    assert all(response.status_code == 200 for response in responses), [r.text for r in responses]
    assert len({response.json()["order_number"] for response in responses}) == 3
