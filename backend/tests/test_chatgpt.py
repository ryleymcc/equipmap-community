"""Isolated real-DB tests for linking, retrieval, image grounding, and MCP."""

import base64
import asyncio
import hashlib
import json
import os
from pathlib import Path
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import fitz
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

import models
from chatgpt_config import ChatGPTSettings, SCOPE, get_chatgpt_settings
from chatgpt_data import LocationUnavailable, drawing_path, render_location, search_records, nearby_records
from chatgpt_mcp import create_mcp_server, install_chatgpt
from chatgpt_models import ChatGPTAuthorization, ChatGPTGrant
from routers.chatgpt import credential_hash, utcnow

VERIFIER = "a" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
CONFIG = ChatGPTSettings("https://equipmap.example", "https://equipmap.example", "equipmap-chatgpt", ("https://chatgpt.com/connector_platform_oauth_redirect",))


@pytest.fixture(autouse=True)
def plugin_configuration(monkeypatch):
    monkeypatch.setenv("CHATGPT_ENABLED", "true")
    monkeypatch.setenv("CHATGPT_PUBLIC_URL", CONFIG.public_url)
    monkeypatch.setenv("CHATGPT_FRONTEND_URL", CONFIG.frontend_url)
    monkeypatch.setenv("CHATGPT_CLIENT_ID", CONFIG.client_id)
    monkeypatch.setenv("CHATGPT_REDIRECT_URIS", CONFIG.redirect_uris[0])


def parameters(**overrides):
    return dict(client_id=CONFIG.client_id, redirect_uri=CONFIG.redirect_uris[0], response_type="code",
        resource=CONFIG.resource, scope=SCOPE, code_challenge=CHALLENGE, code_challenge_method="S256",
        state="a state & with punctuation", **overrides)


async def authorize(client):
    response = await client.get("/api/chatgpt/oauth/authorize", params=parameters())
    assert response.status_code == 307
    assert response.headers["cache-control"] == "no-store"
    return parse_qs(urlsplit(response.headers["location"]).query)["request"][0]


async def link(client, native_token):
    handle = await authorize(client)
    response = await client.post(f"/api/chatgpt/requests/{handle}", json={"approve": True}, headers={"Authorization": f"Bearer {native_token}"})
    assert response.status_code == 200
    callback = parse_qs(urlsplit(response.json()["redirect_url"]).query)
    assert callback["state"] == ["a state & with punctuation"]
    assert callback["iss"] == [CONFIG.public_url]
    code = callback["code"][0]
    data = dict(grant_type="authorization_code", client_id=CONFIG.client_id, resource=CONFIG.resource,
        redirect_uri=CONFIG.redirect_uris[0], code=code, code_verifier=VERIFIER)
    response = await client.post("/api/chatgpt/oauth/token", data=data)
    assert response.status_code == 200, response.text
    return response.json(), data, handle


async def mcp_request(client, token, method, params=None):
    headers = {"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = await client.post("/mcp", headers=headers,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
    return response


@pytest.fixture
async def equipment_fixture(db_session, tmp_path):
    site = models.Site(name="Plugin fixture site")
    db_session.add(site)
    await db_session.flush()
    # Use a non-square drawing with a clearly identifiable panel landmark.
    drawing = fitz.open()
    page = drawing.new_page(width=1000, height=600)
    page.draw_rect(fitz.Rect(480, 230, 620, 380), color=(0, 0, 0))
    page.insert_text((490, 270), "ELECTRICAL ROOM - EMCC 5")
    file_path = tmp_path / "panel.pdf"
    drawing.save(file_path)
    drawing.close()
    floorplan = models.Floorplan(site_id=site.id, name="Main floor", file_type="pdf", file_path="/uploads/panel.pdf")
    db_session.add(floorplan)
    await db_session.flush()
    motor = models.Equipment(name="P39", description="Pump", floorplan_id=floorplan.id, x_coordinate=300, y_coordinate=800)
    panel = models.Equipment(name="EMCC 5", description="Motor control panel feeding P39 and P40. P39 breaker is bucket 7.", floorplan_id=floorplan.id, x_coordinate=1100, y_coordinate=600)
    false_match = models.Equipment(name="P390", description="Feeds P390 only", floorplan_id=floorplan.id, x_coordinate=100, y_coordinate=100)
    db_session.add_all([motor, panel, false_match])
    await db_session.commit()
    site_id, floorplan_id = site.id, floorplan.id
    yield site, floorplan, motor, panel, tmp_path
    await db_session.execute(delete(models.Room).where(models.Room.floorplan_id == floorplan_id))
    await db_session.execute(delete(models.Equipment).where(models.Equipment.floorplan_id == floorplan_id))
    await db_session.execute(delete(models.Floorplan).where(models.Floorplan.id == floorplan_id))
    await db_session.execute(delete(models.Site).where(models.Site.id == site_id))
    await db_session.commit()


async def test_metadata_and_consent_are_private(client, viewer_token):
    response = await client.get("/.well-known/oauth-authorization-server")
    assert response.json()["code_challenge_methods_supported"] == ["S256"]
    assert response.json()["authorization_response_iss_parameter_supported"] is True
    handle = await authorize(client)
    assert (await client.get(f"/api/chatgpt/requests/{handle}")).status_code == 401
    response = await client.get(f"/api/chatgpt/requests/{handle}", headers={"Authorization": f"Bearer {viewer_token}"})
    assert response.json()["scope"] == SCOPE
    assert response.headers["cache-control"] == "no-store"
    assert "etag" not in response.headers


@pytest.mark.parametrize("key,value", [("redirect_uri", "https://evil.example/callback"), ("client_id", "other"),
    ("code_challenge_method", "plain"), ("resource", "https://other.example/mcp"), ("scope", "equipmap.write"),
    ("code_challenge", "short"), ("response_type", "token")])
async def test_reject_invalid_oauth_requests(client, key, value):
    params = parameters()
    params[key] = value
    response = await client.get("/api/chatgpt/oauth/authorize", params=params)
    assert response.status_code == 400
    assert "location" not in response.headers


async def test_denied_consent_and_one_time_handle(client, viewer_token):
    handle = await authorize(client)
    headers = {"Authorization": f"Bearer {viewer_token}"}
    response = await client.post(f"/api/chatgpt/requests/{handle}", json={"approve": False}, headers=headers)
    assert parse_qs(urlsplit(response.json()["redirect_url"]).query)["error"] == ["access_denied"]
    assert (await client.post(f"/api/chatgpt/requests/{handle}", json={"approve": True}, headers=headers)).status_code == 410


async def test_code_replay_and_native_api_token_isolation(client, viewer_token, db_session):
    tokens, exchange, handle = await link(client, viewer_token)
    assert tokens["scope"] == SCOPE
    assert (await client.post("/api/chatgpt/oauth/token", data=exchange)).status_code == 400
    assert (await client.get(f"/api/chatgpt/requests/{handle}", headers={"Authorization": f"Bearer {viewer_token}"})).status_code == 410
    assert (await client.get("/api/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})).status_code == 401
    assert (await client.post("/api/sites", json={"name": "must not create"}, headers={"Authorization": f"Bearer {tokens['access_token']}"})).status_code == 401
    rows = (await db_session.execute(select(ChatGPTGrant).where(ChatGPTGrant.access_hash == credential_hash(tokens["access_token"])))).scalars().all()
    assert len(rows) == 1
    assert rows[0].access_hash != tokens["access_token"]
    assert rows[0].refresh_hash != tokens["refresh_token"]


async def test_pkce_wrong_verifier_resource_and_expired_request(client, viewer_token, db_session):
    handle = await authorize(client)
    response = await client.post(f"/api/chatgpt/requests/{handle}", json={"approve": True}, headers={"Authorization": f"Bearer {viewer_token}"})
    code = parse_qs(urlsplit(response.json()["redirect_url"]).query)["code"][0]
    exchange = dict(grant_type="authorization_code", client_id=CONFIG.client_id, resource=CONFIG.resource,
        redirect_uri=CONFIG.redirect_uris[0], code=code, code_verifier="b" * 64)
    assert (await client.post("/api/chatgpt/oauth/token", data=exchange)).json()["error"] == "invalid_grant"
    exchange.update(code_verifier=VERIFIER, resource="https://evil.example/mcp")
    assert (await client.post("/api/chatgpt/oauth/token", data=exchange)).status_code == 400
    handle2 = await authorize(client)
    row = await db_session.get(ChatGPTAuthorization, credential_hash(handle2))
    row.expires_at = utcnow() - timedelta(seconds=1)
    await db_session.commit()
    assert (await client.get(f"/api/chatgpt/requests/{handle2}", headers={"Authorization": f"Bearer {viewer_token}"})).status_code == 410


async def test_refresh_rotation_and_owner_only_disconnect(client, viewer_token, admin_token):
    tokens, _, _ = await link(client, viewer_token)
    data = dict(grant_type="refresh_token", client_id=CONFIG.client_id, resource=CONFIG.resource, refresh_token=tokens["refresh_token"])
    refreshed = await client.post("/api/chatgpt/oauth/token", data=data)
    assert refreshed.status_code == 200
    assert refreshed.json()["refresh_token"] != tokens["refresh_token"]
    headers = {"Authorization": f"Bearer {viewer_token}"}
    items = (await client.get("/api/chatgpt/connections", headers=headers)).json()
    grant_id = items[0]["id"]
    assert (await client.delete(f"/api/chatgpt/connections/{grant_id}", headers={"Authorization": f"Bearer {admin_token}"})).status_code == 404
    assert (await client.delete(f"/api/chatgpt/connections/{grant_id}", headers=headers)).status_code == 200
    data["refresh_token"] = refreshed.json()["refresh_token"]
    assert (await client.post("/api/chatgpt/oauth/token", data=data)).status_code == 400


async def test_refresh_replay_revokes_the_rotated_connection(client, viewer_token):
    tokens, _, _ = await link(client, viewer_token)
    data = dict(grant_type="refresh_token", client_id=CONFIG.client_id, resource=CONFIG.resource, refresh_token=tokens["refresh_token"])
    refreshed = await client.post("/api/chatgpt/oauth/token", data=data)
    assert refreshed.status_code == 200
    assert (await client.post("/api/chatgpt/oauth/token", data=data)).status_code == 400
    data["refresh_token"] = refreshed.json()["refresh_token"]
    assert (await client.post("/api/chatgpt/oauth/token", data=data)).status_code == 400


async def test_description_search_keeps_related_panel_and_excludes_p390(db_session, equipment_fixture):
    site, floorplan, motor, panel, _ = equipment_fixture
    data = await search_records(db_session, "P39", CONFIG.frontend_url, site.id)
    assert [row["id"] for row in data["results"]] == [motor.id, panel.id]
    assert data["results"][1]["matched_fields"] == ["description"]
    assert "bucket 7" in data["results"][1]["evidence"]
    assert f"highlightType=equipment&highlightId={panel.id}" in data["results"][1]["url"]
    first = await search_records(db_session, "P39", CONFIG.frontend_url, limit=1)
    second = await search_records(db_session, "P39", CONFIG.frontend_url, cursor=first["next_cursor"], limit=1)
    assert first["results"][0]["id"] == motor.id
    assert second["results"][0]["id"] == panel.id
    assert (await search_records(db_session, "P39", CONFIG.frontend_url, site_id=999999))["results"] == []


@pytest.mark.parametrize("query", ["P-39", "P 39", "p39"])
async def test_identifier_separators(db_session, equipment_fixture, query):
    assert len((await search_records(db_session, query, CONFIG.frontend_url))["results"]) == 2


def test_crop_alignment_and_source_preserved(tmp_path):
    path = tmp_path / "drawing.pdf"
    document = fitz.open()
    page = document.new_page(width=1000, height=600)
    page.insert_text((520, 300), "EMCC 5")
    document.save(path)
    document.close()
    before = path.read_bytes()
    image, crop = render_location("/uploads/drawing.pdf", "pdf", 1100, 600, "EMCC 5", upload_dir=tmp_path)
    pix = fitz.Pixmap(image)
    assert pix.width == 1200 and pix.height <= 1000
    left, top, right, bottom = crop["crop_drawing_units"]
    pixel_x = int((1100 - left) / (right - left) * pix.width)
    pixel_y = int((600 - top) / (bottom - top) * (pix.height - 56)) + 56
    # Sample inside the blue circle, away from its black crosshair.
    rgb = pix.pixel(pixel_x + 5, pixel_y + 5)
    assert rgb[2] > rgb[0] + 100
    assert path.read_bytes() == before


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_rotated_pdf_pin_alignment(tmp_path, rotation):
    document = fitz.open()
    page = document.new_page(width=1000, height=600)
    page.set_rotation(rotation)
    document.save(tmp_path / "rotated.pdf")
    document.close()
    image, crop = render_location("/uploads/rotated.pdf", "pdf", 1000, 700, "Panel", upload_dir=tmp_path)
    pix = fitz.Pixmap(image)
    left, top, right, bottom = crop["crop_drawing_units"]
    px = int((1000 - left) / (right - left) * pix.width)
    py = int((700 - top) / (bottom - top) * (pix.height - 56)) + 56
    rgb = pix.pixel(px + 5, py + 5)
    assert rgb[2] > rgb[0] + 100


def test_svg_edges_missing_pins_and_path_escape(tmp_path):
    (tmp_path / "map.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600"><rect x="10" y="10" width="900" height="500" fill="white" stroke="black"/></svg>')
    image, crop = render_location("/uploads/map.svg", "svg", 20, 20, "Panel", "wide", upload_dir=tmp_path)
    assert image.startswith(b"\x89PNG")
    assert crop["crop_drawing_units"][:2] == [0, 0]
    for x, y in [(None, 100), (5000, 100), (100, float("nan"))]:
        with pytest.raises(LocationUnavailable):
            render_location("/uploads/map.svg", "svg", x, y, "Panel", upload_dir=tmp_path)
    with pytest.raises(LocationUnavailable):
        drawing_path("/uploads/../secret.pdf", upload_dir=tmp_path)
    (tmp_path / "external.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///secret.png"/></svg>')
    with pytest.raises(LocationUnavailable):
        render_location("/uploads/external.svg", "svg", 20, 20, "Panel", upload_dir=tmp_path)


async def test_authenticated_mcp_search_read_crop_and_revoke(client, viewer_token, db_session, equipment_fixture, monkeypatch):
    _, floorplan, motor, panel, upload_root = equipment_fixture
    import chatgpt_mcp
    original_renderer = chatgpt_mcp.render_location
    monkeypatch.setattr(chatgpt_mcp, "render_location", lambda *args: original_renderer(*args, upload_dir=upload_root))
    # Give each MCP DB operation a real isolated test connection, avoiding nested native-API sessions.
    from tests.conftest import TestingSessionLocal
    server = create_mcp_server(CONFIG, TestingSessionLocal)
    application = server.streamable_http_app()
    tokens, _, _ = await link(client, viewer_token)
    async with server.session_manager.run():
        async with AsyncClient(transport=ASGITransport(app=application), base_url=CONFIG.public_url) as mcp_client:
            response = await mcp_request(mcp_client, None, "tools/list")
            assert response.status_code == 401
            assert "oauth-protected-resource/mcp" in response.headers["www-authenticate"]
            assert (await mcp_request(mcp_client, viewer_token, "tools/list")).status_code == 401
            metadata = (await mcp_client.get("/.well-known/oauth-protected-resource/mcp")).json()
            assert metadata["resource"] == CONFIG.resource
            tools = (await mcp_request(mcp_client, tokens["access_token"], "tools/list")).json()["result"]["tools"]
            assert len(tools) == 11
            denied = await mcp_request(mcp_client, tokens["access_token"], "tools/call", {"name": "propose_record_edit", "arguments": {"equipment_id": panel.id, "changes": {"description": "Denied"}}})
            assert denied.json()["result"]["isError"]
            assert all(tool["annotations"]["readOnlyHint"] for tool in tools if not tool["name"].startswith("propose_") and tool["name"] != "submit_change_reviews")
            assert all(tool["securitySchemes"] == [{"type": "oauth2", "scopes": [SCOPE]}] for tool in tools)
            structured_tools = {"propose_record_edit", "propose_equipment_relationship", "get_change_status", "get_equipment", "get_nearby"}
            image_tools = {"search_equipment", "find_locations", "get_location_image", "get_location_images"}
            assert all(tool["outputSchema"]["type"] == "object" for tool in tools if tool["name"] in structured_tools)
            assert all("outputSchema" not in tool for tool in tools if tool["name"] in image_tools)
            propose_tool = next(tool for tool in tools if tool["name"] == "propose_record_edit")
            assert "$defs" not in json.dumps(propose_tool["inputSchema"])
            assert "$ref" not in json.dumps(propose_tool["inputSchema"])
            image_tool = next(tool for tool in tools if tool["name"] == "get_location_image")
            for tool in tools:
                if tool["name"] in image_tools:
                    assert "openai/outputTemplate" not in tool.get("_meta", {})
            template_uri = image_tool["_meta"]["ui"]["resourceUri"]
            finder_tool = next(tool for tool in tools if tool["name"] == "find_locations")
            assert "ui" not in finder_tool["_meta"]
            assert "include_images" not in finder_tool["inputSchema"]["properties"]
            assert "openai/outputTemplate" not in finder_tool["_meta"]
            assert "image_policy" not in finder_tool["inputSchema"]["properties"]
            search_tool = next(tool for tool in tools if tool["name"] == "search_equipment")
            assert "openai/outputTemplate" not in search_tool.get("_meta", {})
            search_props = search_tool["inputSchema"]["properties"]
            assert not {"include_images", "image_policy", "image_zoom", "max_images"} & search_props.keys()
            batch_tool = next(tool for tool in tools if tool["name"] == "get_location_images")
            assert batch_tool["_meta"]["ui"]["resourceUri"] == template_uri
            assert "$defs" not in json.dumps(batch_tool["inputSchema"])
            assert "$ref" not in json.dumps(batch_tool["inputSchema"])
            batch_props = batch_tool["inputSchema"]["properties"]
            assert batch_tool["inputSchema"]["required"] == ["records"]
            assert batch_props["records"]["minItems"] == 1 and batch_props["records"]["maxItems"] == 50
            assert batch_props["records"]["items"]["type"] == "object"
            assert batch_props["records"]["items"]["properties"]["id"]["type"] == "integer"
            assert batch_props["records"]["items"]["properties"]["type"]["enum"] == ["equipment", "room"]
            assert batch_props["zoom"]["default"] == "context"
            assert batch_props["max_images"]["minimum"] == 1 and batch_props["max_images"]["maximum"] == 5 and batch_props["max_images"]["default"] == 5
            assert batch_props["max_images"]["type"] == "number"
            resource = (await mcp_request(mcp_client, tokens["access_token"], "resources/read", {"uri": template_uri})).json()["result"]["contents"][0]
            assert resource["mimeType"] == "text/html;profile=mcp-app"
            assert "ui/initialize" in resource["text"] and "EQUIPMAP_JS" not in resource["text"]
            assert resource["_meta"]["ui"]["csp"]["connectDomains"] == []
            legacy = await mcp_request(mcp_client, tokens["access_token"], "resources/read", {"uri": "ui://equipmap/location-v1.html"})
            assert legacy.json()["result"]["contents"][0]["text"] == resource["text"]
            response = await mcp_request(mcp_client, tokens["access_token"], "tools/call", {"name": "search_equipment", "arguments": {"query": "P39"}})
            data = response.json()["result"]["structuredContent"]
            assert [item["id"] for item in data["results"]] == [motor.id, panel.id]
            response = await mcp_request(mcp_client, tokens["access_token"], "tools/call", {"name": "get_equipment", "arguments": {"equipment_id": panel.id}})
            assert response.json()["result"]["structuredContent"]["record"]["name"] == "EMCC 5"
            response = await mcp_request(mcp_client, tokens["access_token"], "tools/call", {"name": "get_nearby", "arguments": {"equipment_id": panel.id, "limit": 1}})
            assert response.json()["result"]["structuredContent"]["results"][0]["id"] == motor.id
            response = await mcp_request(mcp_client, tokens["access_token"], "tools/call", {"name": "get_location_image", "arguments": {"equipment_id": panel.id}})
            data = response.json()["result"]
            assert not data.get("isError")
            assert data["structuredContent"]["crop"]["pin_drawing_units"] == [1100, 600]
            assert "_file_path" not in data["structuredContent"]["record"]
            image_content = next(item for item in data["content"] if item["type"] == "image")
            png = base64.b64decode(image_content["data"])
            assert any(item["type"] == "text" for item in data["content"])
            assert base64.b64decode(data["_meta"]["imagePng"]) == png
            assert fitz.Pixmap(png).width == 1200
            response = await client.post("/api/chatgpt/oauth/revoke", data={"client_id": CONFIG.client_id, "token": tokens["access_token"]})
            assert response.status_code == 200
            assert (await mcp_request(mcp_client, tokens["access_token"], "tools/list")).status_code == 401


async def test_mcp_rejects_expiry_wrong_audience_and_offboarding(client, viewer_token, db_session):
    from tests.conftest import TestingSessionLocal
    tokens, _, _ = await link(client, viewer_token)
    server = create_mcp_server(CONFIG, TestingSessionLocal)
    verifier = server._token_verifier
    assert await verifier.verify_token(tokens["access_token"]) is not None
    row = (await db_session.execute(select(ChatGPTGrant).where(ChatGPTGrant.access_hash == credential_hash(tokens["access_token"])))).scalar_one()
    row.resource = "https://wrong.example/mcp"
    await db_session.commit()
    assert await verifier.verify_token(tokens["access_token"]) is None
    row.resource = CONFIG.resource
    row.access_expires_at = utcnow() - timedelta(seconds=1)
    await db_session.commit()
    assert await verifier.verify_token(tokens["access_token"]) is None
    row.access_expires_at = utcnow() + timedelta(minutes=10)
    row.token_version -= 1
    await db_session.commit()
    assert await verifier.verify_token(tokens["access_token"]) is None


def test_plugin_configuration_fails_closed(monkeypatch):
    monkeypatch.setenv("CHATGPT_ENABLED", "false")
    assert get_chatgpt_settings() is None
    monkeypatch.setenv("CHATGPT_ENABLED", "true")
    monkeypatch.setenv("CHATGPT_PUBLIC_URL", "http://public.example")
    with pytest.raises(ValueError):
        get_chatgpt_settings()


def test_redirect_trailing_slash_is_preserved(monkeypatch):
    uri = "https://chatgpt.com/callback/"
    monkeypatch.setenv("CHATGPT_REDIRECT_URIS", uri)
    assert get_chatgpt_settings().redirect_uris == (uri,)


async def test_mcp_install_preserves_later_feature_routes(client, viewer_token):
    from fastapi import FastAPI
    from slowapi.middleware import SlowAPIMiddleware
    from limiter import limiter
    from tests.conftest import TestingSessionLocal
    tokens, _, _ = await link(client, viewer_token)
    application = FastAPI()
    application.state.limiter = limiter
    application.add_middleware(SlowAPIMiddleware)
    install_chatgpt(application, TestingSessionLocal)

    @application.get("/api/later-feature")
    async def later_feature():
        return {"works": True}

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=ASGITransport(app=application), base_url=CONFIG.public_url) as http:
            assert (await http.get("/api/later-feature")).json() == {"works": True}
            assert (await http.get("/.well-known/oauth-protected-resource/mcp")).json()["resource"] == CONFIG.resource
            assert (await mcp_request(http, None, "tools/list")).status_code == 401
            assert (await mcp_request(http, tokens["access_token"], "tools/list")).status_code == 200


async def test_nearby_landmarks(db_session, equipment_fixture):
    site, floorplan, motor, panel, _ = equipment_fixture
    other_floor = models.Floorplan(site_id=site.id, name="Other floor", file_type="pdf", file_path="/uploads/other.pdf")
    db_session.add(other_floor)
    await db_session.flush()
    room = models.Room(name="Electrical room", floorplan_id=floorplan.id, x_coordinate=1100, y_coordinate=610)
    missing = models.Room(name="Unplaced", floorplan_id=floorplan.id)
    other = models.Equipment(name="Different floor", floorplan_id=other_floor.id, x_coordinate=1100, y_coordinate=600)
    db_session.add_all([room, missing, other])
    await db_session.flush()
    try:
        data = await nearby_records(db_session, panel.id, "equipment", CONFIG.frontend_url)
        assert [r["name"] for r in data["results"]] == ["Electrical room", "P39", "P390"]
        assert data["results"][0]["distance_drawing_units"] == 10
        assert data["results"][0]["offset_drawing_units"] == {"x": 0, "y": 10}
        assert "highlightType=room" in data["results"][0]["url"]
        assert "not room boundaries" in data["guidance"]
        assert len((await nearby_records(db_session, panel.id, "equipment", CONFIG.frontend_url, "equipment", 1))["results"]) == 1
        assert (await nearby_records(db_session, room.id, "room", CONFIG.frontend_url, "room"))["results"] == []
        with pytest.raises(LocationUnavailable):
            await nearby_records(db_session, missing.id, "room", CONFIG.frontend_url)
        with pytest.raises(ValueError):
            await nearby_records(db_session, panel.id, "equipment", CONFIG.frontend_url, limit=21)
    finally:
        await db_session.execute(delete(models.Room).where(models.Room.floorplan_id == floorplan.id))
        await db_session.execute(delete(models.Equipment).where(models.Equipment.floorplan_id == other_floor.id))
        await db_session.delete(other_floor)
        await db_session.commit()


async def make_edit_proposal(client, native_token, db_session, panel, changes):
    from chatgpt_changes import propose_edit, RecordChanges
    tokens, _, _ = await link(client, native_token)
    grant = (await db_session.execute(select(ChatGPTGrant).where(ChatGPTGrant.access_hash == credential_hash(tokens["access_token"])))).scalar_one()
    return await propose_edit(db_session, grant, panel.id, "equipment", RecordChanges(**changes), CONFIG.frontend_url), grant


def review_handle(proposal):
    return parse_qs(urlsplit(proposal["review_url"]).query)["change"][0]


async def test_confirmed_edit_audit_pin_and_replay(client, editor_token, db_session, equipment_fixture):
    _, _, _, panel, _ = equipment_fixture
    original_pin = (panel.x_coordinate, panel.y_coordinate)
    proposal, _ = await make_edit_proposal(client, editor_token, db_session, panel, {"description": "Confirmed maintenance details"})
    handle = review_handle(proposal)
    headers = {"Authorization": f"Bearer {editor_token}"}
    assert (await client.post(f"/api/chatgpt/changes/{handle}", json={"approve": True})).status_code == 401
    response = await client.get(f"/api/chatgpt/changes/{handle}", headers=headers)
    assert response.json()["status"] == "pending"
    assert response.headers["cache-control"] == "no-store"
    await db_session.refresh(panel)
    assert panel.description != "Confirmed maintenance details"
    response = await client.post(f"/api/chatgpt/changes/{handle}", json={"approve": True}, headers=headers)
    assert response.status_code == 200, response.text
    audit_id = response.json()["audit_id"]
    await db_session.refresh(panel)
    assert panel.description == "Confirmed maintenance details"
    assert (panel.x_coordinate, panel.y_coordinate) == original_pin
    audit = await db_session.get(models.AuditLog, audit_id)
    assert audit.username == "editor_test" and audit.old_values["description"] == proposal["preview"]["before"]["description"]
    response = await client.post(f"/api/chatgpt/changes/{handle}", json={"approve": True}, headers=headers)
    assert response.json()["audit_id"] == audit_id


async def test_edit_cancel_stale_owner_and_revoked_grant(client, editor_token, viewer_token, db_session, equipment_fixture):
    _, _, _, panel, _ = equipment_fixture
    proposal, grant = await make_edit_proposal(client, editor_token, db_session, panel, {"description": "Proposed"})
    handle = review_handle(proposal)
    headers = {"Authorization": f"Bearer {editor_token}"}
    assert (await client.get(f"/api/chatgpt/changes/{handle}", headers={"Authorization": f"Bearer {viewer_token}"})).status_code == 404
    panel.description = "Another user updated this"
    await db_session.commit()
    assert (await client.post(f"/api/chatgpt/changes/{handle}", json={"approve": True}, headers=headers)).status_code == 409
    assert (await client.post(f"/api/chatgpt/changes/{handle}", json={"approve": False}, headers=headers)).json()["status"] == "cancelled"
    proposal, grant = await make_edit_proposal(client, editor_token, db_session, panel, {"name": "Proposed name"})
    grant.revoked_at = utcnow()
    await db_session.commit()
    assert (await client.post(f"/api/chatgpt/changes/{review_handle(proposal)}", json={"approve": True}, headers=headers)).status_code == 409


async def test_viewer_cannot_propose_and_fields_are_bounded(client, viewer_token, db_session, equipment_fixture):
    from pydantic import ValidationError
    from chatgpt_changes import RecordChanges
    _, _, _, panel, _ = equipment_fixture
    with pytest.raises(Exception) as error:
        await make_edit_proposal(client, viewer_token, db_session, panel, {"description": "Not permitted"})
    assert error.value.status_code == 403
    with pytest.raises(ValidationError):
        RecordChanges(x_coordinate=100)
    with pytest.raises(ValidationError):
        RecordChanges(manufacturer="Unsupported field")


async def test_relationship_confirm_read_and_remove(client, editor_token, db_session, equipment_fixture):
    from chatgpt_changes import propose_relationship, relationships_for
    from chatgpt_models import EquipmentRelationship
    _, _, motor, panel, _ = equipment_fixture
    _, grant = await make_edit_proposal(client, editor_token, db_session, panel, {"description": "Pending edit"})
    proposal = await propose_relationship(db_session, grant, motor.id, panel.id, "fed_by", "Bucket 7 documented by user", "add", CONFIG.frontend_url)
    assert not (await db_session.execute(select(EquipmentRelationship))).scalars().all()
    headers = {"Authorization": f"Bearer {editor_token}"}
    response = await client.post(f"/api/chatgpt/changes/{review_handle(proposal)}", json={"approve": True}, headers=headers)
    assert response.status_code == 200, response.text
    relations, truncated = await relationships_for(db_session, panel.id, CONFIG.frontend_url)
    assert not truncated and relations[0]["source"]["id"] == motor.id
    assert relations[0]["target"]["id"] == panel.id
    assert relations[0]["relationship_type"] == "fed_by"
    proposal = await propose_relationship(db_session, grant, motor.id, panel.id, "fed_by", "", "remove", CONFIG.frontend_url)
    response = await client.post(f"/api/chatgpt/changes/{review_handle(proposal)}", json={"approve": True}, headers=headers)
    assert response.status_code == 200, response.text
    assert (await relationships_for(db_session, panel.id, CONFIG.frontend_url))[0] == []


async def test_edit_expiry_permission_loss_and_duplicate_name(client, editor_token, db_session, equipment_fixture):
    from chatgpt_models import ChatGPTChange
    _, _, motor, panel, _ = equipment_fixture
    headers = {"Authorization": f"Bearer {editor_token}"}
    proposal, _ = await make_edit_proposal(client, editor_token, db_session, panel, {"name": motor.name})
    path = f"/api/chatgpt/changes/{review_handle(proposal)}"
    assert (await client.post(path, json={"approve": True}, headers=headers)).status_code == 409
    row = await db_session.get(ChatGPTChange, proposal["change_id"])
    row.expires_at = utcnow() - timedelta(seconds=1)
    await db_session.commit()
    assert (await client.post(path, json={"approve": True}, headers=headers)).status_code == 410
    proposal, grant = await make_edit_proposal(client, editor_token, db_session, panel, {"description": "Should not save"})
    user = await db_session.get(models.User, grant.user_id)
    user.role = "viewer"
    await db_session.commit()
    try:
        assert (await client.post(f"/api/chatgpt/changes/{review_handle(proposal)}", json={"approve": True}, headers=headers)).status_code == 403
    finally:
        user.role = "editor"
        await db_session.commit()


async def test_mcp_edit_proposal_and_status(client, editor_token, db_session, equipment_fixture):
    from tests.conftest import TestingSessionLocal
    _, _, _, panel, _ = equipment_fixture
    server = create_mcp_server(CONFIG, TestingSessionLocal)
    tokens, _, _ = await link(client, editor_token)
    application = server.streamable_http_app()
    async with server.session_manager.run():
        async with AsyncClient(transport=ASGITransport(app=application), base_url=CONFIG.public_url) as http:
            response = await mcp_request(http, tokens["access_token"], "tools/call", {"name": "propose_record_edit", "arguments": {"equipment_id": panel.id, "changes": {"tools_required": "Meter"}}})
            proposal = response.json()["result"]["structuredContent"]
            assert proposal["status"] == "pending", proposal
            path = f"/api/chatgpt/changes/{review_handle(proposal)}"
            assert (await client.post(path, json={"approve": True}, headers={"Authorization": f"Bearer {tokens['access_token']}"})).status_code == 401
            saved = await client.post(path, json={"approve": True}, headers={"Authorization": f"Bearer {editor_token}"})
            assert saved.status_code == 200, saved.text
            status = await mcp_request(http, tokens["access_token"], "tools/call", {"name": "get_change_status", "arguments": {"change_id": proposal["change_id"]}})
            assert status.json()["result"]["structuredContent"]["status"] == "applied"


@pytest.fixture
async def review_mcp(client, editor_token, db_session, equipment_fixture):
    from tests.conftest import TestingSessionLocal
    from chatgpt_models import ChatGPTChange
    tokens, _, _ = await link(client, editor_token)
    grant = (await db_session.execute(select(ChatGPTGrant).where(ChatGPTGrant.access_hash == credential_hash(tokens["access_token"])))).scalar_one()
    grant_id = grant.id
    server = create_mcp_server(CONFIG, TestingSessionLocal)
    application = server.streamable_http_app()
    started, stopped = asyncio.Event(), asyncio.Event()
    async def manager():
        async with server.session_manager.run():
            started.set()
            await stopped.wait()
    task = asyncio.create_task(manager())
    try:
        await started.wait()
        async with AsyncClient(transport=ASGITransport(app=application), base_url=CONFIG.public_url) as http:
            async def call(name, **args):
                response = await mcp_request(http, tokens["access_token"], "tools/call", {"name": name, "arguments": args})
                if response.status_code == 401:
                    return {"isError": True, "http_status": 401, "structuredContent": {"error": "Connection revoked"}}
                assert response.status_code == 200, response.text
                return response.json()["result"]
            yield call, grant, server, http, tokens
    finally:
        stopped.set()
        await task
        await db_session.commit()
        await db_session.execute(delete(ChatGPTChange).where(ChatGPTChange.grant_id == grant_id))
        await db_session.commit()


async def review_proposals(call, records):
    ids = []
    for record, changes in records:
        response = await call("propose_record_edit", equipment_id=record.id, changes=changes)
        assert not response.get("isError"), response
        ids.append(response["structuredContent"]["change_id"])
    response = await call("review_pending_changes", change_ids=ids)
    assert not response.get("isError"), response
    return ids, response


def decision(review, change_id, **options):
    return {"change_id": change_id, "approval_token": review["_meta"]["approval_tokens"][change_id], "approve": True, **options}


async def test_chat_batch_edit_selection_audit_replay_and_private_tokens(review_mcp, equipment_fixture, db_session):
    call, _, server, http, tokens = review_mcp
    _, _, motor, panel, _ = equipment_fixture
    ids, review = await review_proposals(call, [(motor, {"description": "Proposed pump note"}), (panel, {"name": "Renamed panel", "tools_required": "Meter"})])
    private = review["_meta"]["approval_tokens"]
    for token in private.values():
        assert token not in json.dumps(review["structuredContent"])
        assert token not in json.dumps(review["content"])
    tools = (await mcp_request(http, tokens["access_token"], "tools/list")).json()["result"]["tools"]
    action = next(tool for tool in tools if tool["name"] == "submit_change_reviews")
    assert action["_meta"]["ui"]["visibility"] == ["app"]
    assert "resourceUri" not in action["_meta"]["ui"]
    assert "$ref" not in json.dumps(action["inputSchema"])
    viewer = next(tool for tool in tools if tool["name"] == "review_pending_changes")
    resource = (await mcp_request(http, tokens["access_token"], "resources/read", {"uri": viewer["_meta"]["ui"]["resourceUri"]})).json()["result"]["contents"][0]
    assert "Approve selected" in resource["text"] and "EQUIPMAP_JS" not in resource["text"]
    first = await call("submit_change_reviews", decisions=[decision(review, ids[0], changes={"description": "Edited by reviewer"})])
    assert first["structuredContent"]["results"][0]["status"] == "applied"
    await db_session.refresh(motor); await db_session.refresh(panel)
    assert motor.description == "Edited by reviewer" and panel.name == "EMCC 5"
    assert (await call("get_change_status", change_id=ids[1]))["structuredContent"]["status"] == "pending"
    retry = await call("submit_change_reviews", decisions=[decision(review, ids[0], changes={"description": "Ignored replay"}), decision(review, ids[1], changes={"name": "Reviewed panel", "tools_required": None})])
    outcomes = retry["structuredContent"]["results"]
    assert [entry["status"] for entry in outcomes] == ["applied", "applied"]
    assert outcomes[0]["audit_id"] == first["structuredContent"]["results"][0]["audit_id"]
    await db_session.refresh(panel); await db_session.refresh(motor)
    assert motor.description == "Edited by reviewer" and panel.name == "Reviewed panel" and panel.tools_required is None
    assert (panel.x_coordinate, panel.y_coordinate) == (1100, 600)
    audit = await db_session.get(models.AuditLog, outcomes[1]["audit_id"])
    assert audit.new_values == {"name": "Reviewed panel", "tools_required": None}


async def test_chat_batch_partial_failure_cancel_and_stale_records(review_mcp, equipment_fixture, db_session):
    call, *_ = review_mcp
    _, _, motor, panel, _ = equipment_fixture
    ids, review = await review_proposals(call, [(motor, {"description": "New pump note"}), (panel, {"description": "New panel note"})])
    panel.description = "Concurrent edit"
    await db_session.commit()
    response = await call("submit_change_reviews", decisions=[decision(review, ids[1]), decision(review, ids[0])])
    assert [entry["status"] for entry in response["structuredContent"]["results"]] == ["error", "applied"]
    await db_session.refresh(panel)
    assert panel.description == "Concurrent edit"
    response = await call("submit_change_reviews", decisions=[decision(review, ids[1], approve=False)])
    assert response["structuredContent"]["results"][0]["status"] == "cancelled"


@pytest.mark.parametrize("attack", ["token", "fields", "owner", "expired", "permission", "revoked"])
async def test_chat_approval_rejects_invalid_capabilities_and_permissions(review_mcp, equipment_fixture, db_session, attack):
    from chatgpt_models import ChatGPTChange
    call, grant, *_ = review_mcp
    _, _, _, panel, _ = equipment_fixture
    ids, review = await review_proposals(call, [(panel, {"description": "Must not save"})])
    selected = decision(review, ids[0])
    user = await db_session.get(models.User, grant.user_id)
    row = await db_session.get(ChatGPTChange, ids[0])
    if attack == "token": selected["approval_token"] = "guessed"
    if attack == "fields": selected["changes"] = {"name": "Unproposed field"}
    if attack == "owner": row.user_id = (await db_session.execute(select(models.User.id).where(models.User.username == "admin_test"))).scalar_one()
    if attack == "expired": row.expires_at = utcnow() - timedelta(seconds=1)
    if attack == "permission": user.role = "viewer"
    if attack == "revoked": grant.revoked_at = utcnow()
    await db_session.commit()
    try:
        response = await call("submit_change_reviews", decisions=[selected])
        assert response.get("isError") or response["structuredContent"]["results"][0]["status"] == "error"
        await db_session.refresh(panel)
        assert panel.description != "Must not save"
    finally:
        user.role = "editor"; grant.revoked_at = None
        await db_session.commit()


async def test_chat_review_parameter_validation(review_mcp, equipment_fixture):
    call, *_ = review_mcp
    _, _, _, panel, _ = equipment_fixture
    ids, review = await review_proposals(call, [(panel, {"description": "Pending"})])
    for decisions in [[], [decision(review, ids[0])] * 21, [decision(review, ids[0], changes={"x_coordinate": 5})], [decision(review, ids[0])] * 2]:
        response = await call("submit_change_reviews", decisions=decisions)
        assert response["isError"]


async def test_chat_approval_capability_refresh_and_connection_binding(review_mcp, equipment_fixture, db_session):
    call, grant, *_ = review_mcp
    _, _, _, panel, _ = equipment_fixture
    ids, old_review = await review_proposals(call, [(panel, {"description": "Reviewed after rotation"})])
    grant.refresh_hash = credential_hash("replacement private refresh credential")
    await db_session.commit()
    denied = await call("submit_change_reviews", decisions=[decision(old_review, ids[0])])
    assert denied["structuredContent"]["results"][0]["status"] == "error"
    new_review = await call("review_pending_changes", change_ids=ids)
    assert new_review["_meta"]["approval_tokens"] != old_review["_meta"]["approval_tokens"]
    saved = await call("submit_change_reviews", decisions=[decision(new_review, ids[0])])
    assert saved["structuredContent"]["results"][0]["status"] == "applied"


async def test_chat_relationship_detail_edit(review_mcp, equipment_fixture, db_session):
    from chatgpt_models import EquipmentRelationship
    call, *_ = review_mcp
    _, _, motor, panel, _ = equipment_fixture
    response = await call("propose_equipment_relationship", source_id=motor.id, target_id=panel.id, relationship_type="fed_by", detail="User supplied: original")
    change_id = response["structuredContent"]["change_id"]
    review = await call("review_pending_changes", change_ids=[change_id])
    response = await call("submit_change_reviews", decisions=[decision(review, change_id, detail="Reviewer supplied: bucket 7")])
    entry = response["structuredContent"]["results"][0]
    assert entry["status"] == "applied"
    assert entry["preview"]["after"]["relationship"] == "P39 is fed by EMCC 5: Reviewer supplied: bucket 7"
    saved = (await db_session.execute(select(EquipmentRelationship).where(EquipmentRelationship.source_id == motor.id))).scalar_one()
    assert saved.detail == "Reviewer supplied: bucket 7"


async def test_pending_audit_visibility_and_applied_removed(review_mcp, client, editor_token, admin_token, viewer_token, equipment_fixture, db_session):
    call, *_ = review_mcp
    _, _, motor, panel, _ = equipment_fixture
    ids, review = await review_proposals(call, [(panel, {"description": "Pending editor edit"})])
    admin_proposal, _ = await make_edit_proposal(client, admin_token, db_session, motor, {"description": "Pending admin edit"})
    from chatgpt_models import ChatGPTChange
    try:
        assert (await client.get("/api/chatgpt/pending-changes")).status_code == 401
        assert (await client.get("/api/chatgpt/pending-changes", headers={"Authorization": f"Bearer {viewer_token}"})).status_code == 403
        editor = await client.get("/api/chatgpt/pending-changes", headers={"Authorization": f"Bearer {editor_token}"})
        assert editor.headers["cache-control"] == "no-store"
        assert ids[0] in {entry["change_id"] for entry in editor.json()["results"]}
        assert admin_proposal["change_id"] not in {entry["change_id"] for entry in editor.json()["results"]}
        assert "approval_tokens" not in editor.text
        admin = await client.get("/api/chatgpt/pending-changes", headers={"Authorization": f"Bearer {admin_token}"})
        assert {ids[0], admin_proposal["change_id"]} <= {entry["change_id"] for entry in admin.json()["results"]}
        await call("submit_change_reviews", decisions=[decision(review, ids[0])])
        after = await client.get("/api/chatgpt/pending-changes", headers={"Authorization": f"Bearer {editor_token}"})
        assert ids[0] not in {entry["change_id"] for entry in after.json()["results"]}
    finally:
        await db_session.execute(delete(ChatGPTChange).where(ChatGPTChange.id == admin_proposal["change_id"]))
        await db_session.commit()


async def test_native_shared_review_batch_across_connections_and_owner_checks(review_mcp, client, editor_token, admin_token, viewer_token, equipment_fixture, db_session):
    from chatgpt_models import ChatGPTChange
    from chatgpt_mcp import review_document
    call, _, _, _, oauth = review_mcp
    _, _, motor, panel, _ = equipment_fixture
    ids, _ = await review_proposals(call, [(panel, {"description": "Native panel review"})])
    other, _ = await make_edit_proposal(client, editor_token, db_session, motor, {"description": "Native pump review"})
    headers = {"Authorization": f"Bearer {editor_token}"}
    try:
        for path in ["review-view", "review-pending"]:
            assert (await client.get(f"/api/chatgpt/{path}")).status_code == 401
            assert (await client.get(f"/api/chatgpt/{path}", headers={"Authorization": f"Bearer {viewer_token}"})).status_code == 403
            assert (await client.get(f"/api/chatgpt/{path}", headers={"Authorization": f"Bearer {oauth['access_token']}"})).status_code == 401
        html = await client.get("/api/chatgpt/review-view", headers=headers)
        assert html.text == review_document(native=True)
        assert html.headers["cache-control"] == "no-store"
        response = await client.get("/api/chatgpt/review-pending", headers=headers)
        review = response.json()
        selected = [decision(review, ids[0], changes={"description": "Edited in audit modal"}), decision(review, other["change_id"])]
        admin = (await client.get("/api/chatgpt/review-pending", headers={"Authorization": f"Bearer {admin_token}"})).json()
        assert ids[0] not in admin["_meta"]["approval_tokens"]
        denied = await client.post("/api/chatgpt/review-pending", json={"decisions": selected}, headers={"Authorization": f"Bearer {admin_token}"})
        assert [item["status"] for item in denied.json()["structuredContent"]["results"]] == ["error", "error"]
        for invalid in [[], selected[:1] * 2, [decision(review, ids[0], changes={"x_coordinate": 300})]]:
            assert (await client.post("/api/chatgpt/review-pending", json={"decisions": invalid}, headers=headers)).status_code == 422
        saved = await client.post("/api/chatgpt/review-pending", json={"decisions": selected}, headers=headers)
        entries = saved.json()["structuredContent"]["results"]
        assert [item["status"] for item in entries] == ["applied", "applied"]
        await db_session.refresh(panel); await db_session.refresh(motor)
        assert panel.description == "Edited in audit modal" and motor.description == "Native pump review"
        assert (panel.x_coordinate, panel.y_coordinate) == (1100, 600)
    finally:
        await db_session.execute(delete(ChatGPTChange).where(ChatGPTChange.id == other["change_id"]))
        await db_session.commit()

@pytest.fixture
async def image_mcp(client, viewer_token, equipment_fixture, monkeypatch):
    import chatgpt_mcp
    from tests.conftest import TestingSessionLocal
    renderer = chatgpt_mcp.render_location
    upload_root = equipment_fixture[-1]
    calls = []

    def render(*args):
        calls.append(args)
        return renderer(*args, upload_dir=upload_root)

    monkeypatch.setattr(chatgpt_mcp, "render_location", render)
    server = create_mcp_server(CONFIG, TestingSessionLocal)
    application = server.streamable_http_app()
    tokens, _, _ = await link(client, viewer_token)
    started, stopped = asyncio.Event(), asyncio.Event()

    async def run_manager():
        # pytest-asyncio resumes fixture teardown in another task. AnyIO requires
        # the session manager's cancel scope to enter/exit within the same task.
        async with server.session_manager.run():
            started.set()
            await stopped.wait()

    manager_task = asyncio.create_task(run_manager())
    try:
        await started.wait()
        async with AsyncClient(transport=ASGITransport(app=application), base_url=CONFIG.public_url) as transport:
            async def call(name, **arguments):
                response = await mcp_request(transport, tokens["access_token"], "tools/call", {"name": name, "arguments": arguments})
                assert response.status_code == 200
                return response.json()["result"]
            yield call, calls, server, tokens, transport
    finally:
        stopped.set()
        await manager_task


def assert_crop_images(response):
    assert not response.get("isError")
    data = response["structuredContent"]
    serialized = json.dumps(data)
    assert "_file_path" not in serialized and "_file_type" not in serialized
    assert "imagePng" not in serialized and "base64" not in serialized
    images = [item for item in response["content"] if item["type"] == "image"]
    if images:
        assert data["image_delivery"]["image_count"] == len(images)
        assert data["image_delivery"]["status"] == "delivered"
    included = [item for item in data["results"] if item["image_status"] == "included"]
    assert len(included) == len(images)
    for index, entry in enumerate(included):
        record = entry.get("record", entry)
        assert entry["presentation"]["image_index"] == index
        assert entry["presentation"]["image_ready"] is True
        png = base64.b64decode(images[index]["data"])
        assert png.startswith(b"\x89PNG")
        assert fitz.Pixmap(png).width == entry["crop"]["image_width"]
        assert base64.b64decode(response["_meta"]["images"][index]["imagePng"]) == png
        assert entry["crop"]["pin_drawing_units"] == [record["x_coordinate"], record["y_coordinate"]]
        assert f"highlightType={record['type']}&highlightId={record['id']}" in record["url"]
    return data


@pytest.mark.parametrize("options", [{}, {"include_images": True}, {"include_images": True, "zoom": "wide", "max_images": 1}])
async def test_find_locations_defaults_to_metadata_without_drawing_lookup(image_mcp, monkeypatch, options):
    import chatgpt_mcp
    call, calls, *_ = image_mcp
    baseline = (await call("search_equipment", query="P39"))["structuredContent"]

    async def no_drawing(*args, **kwargs):
        pytest.fail("Default location search must not retrieve drawings")

    monkeypatch.setattr(chatgpt_mcp, "get_record", no_drawing)
    response = await call("find_locations", query="P39", **options)
    assert response["structuredContent"] == baseline
    assert not calls
    assert not response.get("_meta")
    assert all(block["type"] != "image" for block in response["content"])


async def test_find_locations_then_one_explicit_batch(image_mcp):
    call, calls, *_ = image_mcp
    baseline = (await call("search_equipment", query="P39"))["structuredContent"]
    found = await call("find_locations", query="P39", include_images=True)
    assert found["structuredContent"] == baseline
    assert len(calls) == 0
    response = await call("get_location_images", records=[{"id": entry["id"], "type": entry["type"]} for entry in baseline["results"]], max_images=1)
    data = assert_crop_images(response)
    assert len(calls) == 1
    assert data["results"][0]["image_status"] == "included"
    assert data["results"][1]["image_status"] == "skipped"
    assert "ui" not in response["_meta"]
    assert "openai/outputTemplate" not in response["_meta"]
    for before, after in zip(baseline["results"], data["results"]):
        assert all(after["record"][key] == value for key, value in before.items() if key in after["record"])
    assert any("Delivered 1 location crops" in block.get("text", "") for block in response["content"])


@pytest.mark.parametrize("options", [{}, {"image_policy": "none"}, {"include_images": False}])
async def test_search_without_images_unchanged(image_mcp, equipment_fixture, monkeypatch, options):
    import chatgpt_mcp
    call, calls, *_ = image_mcp

    async def no_drawing(*args, **kwargs):
        pytest.fail("Image-free search must not retrieve drawings")

    monkeypatch.setattr(chatgpt_mcp, "get_record", no_drawing)
    response = await call("search_equipment", query="P39", **options)
    from tests.conftest import TestingSessionLocal
    async with TestingSessionLocal() as db:
        expected = await search_records(db, "P39", CONFIG.frontend_url)
    assert response["structuredContent"] == expected
    assert calls == []
    assert all(item["type"] == "text" for item in response["content"])


@pytest.mark.parametrize("options,query,count", [
    ({"image_policy": "always"}, "P39", 2),
    ({"image_policy": "auto"}, "EMCC 5", 1),
    ({"image_policy": "auto"}, "P39", 2),
    ({"include_images": True, "image_policy": "none"}, "P39", 2),
    ({"include_images": True, "image_policy": "auto"}, "P39", 2),
    ({"image_policy": "always", "max_images": 1, "limit": 1}, "P39", 1),
])
async def test_search_optional_crops(image_mcp, options, query, count):
    call, calls, *_ = image_mcp
    response = await call("search_equipment", query=query, **options)
    data = assert_crop_images(response)
    assert len(calls) == count
    assert all(item["image_status"] == "included" for item in data["results"])
    if options.get("limit") == 1:
        assert data["next_cursor"] == 1


async def test_search_max_images_preserves_results_and_metadata(image_mcp):
    call, calls, *_ = image_mcp
    baseline = (await call("search_equipment", query="P39"))["structuredContent"]
    data = assert_crop_images(await call("search_equipment", query="P39", image_policy="always", max_images=1, image_zoom="wide"))
    assert len(calls) == 1 and len(data["results"]) == 2
    assert data["next_cursor"] == baseline["next_cursor"]
    assert data["results"][0]["crop"]["zoom"] == "wide"
    assert data["results"][1]["image_skip_reason"] == "limit"
    for before, after in zip(baseline["results"], data["results"]):
        assert all(after[key] == value for key, value in before.items())


async def test_auto_global_probe_filters_and_pagination(image_mcp, db_session, equipment_fixture):
    call, calls, *_ = image_mcp
    site, floorplan, *_ = equipment_fixture
    db_session.add_all([models.Equipment(name=f"Probe {index}", floorplan_id=floorplan.id, x_coordinate=100, y_coordinate=100) for index in range(4)])
    await db_session.commit()
    for options in ({}, {"limit": 1}, {"cursor": 3, "limit": 1}):
        data = assert_crop_images(await call("search_equipment", query="Probe", image_policy="auto", **options))
        assert all(item["image_skip_reason"] == "policy" for item in data["results"])
    assert calls == []
    data = assert_crop_images(await call("search_equipment", query="Probe", include_images=True, image_policy="auto"))
    assert len(calls) == 4
    assert all(item["image_status"] == "included" for item in data["results"])
    empty = assert_crop_images(await call("search_equipment", query="Probe", image_policy="auto", site_id=site.id + 99999))
    assert empty["results"] == []
    filtered = assert_crop_images(await call("search_equipment", query="EMCC 5", image_policy="auto", site_id=site.id, floorplan_id=floorplan.id))
    assert len(filtered["results"]) == 1


@pytest.mark.parametrize("distance,mixed", [(20, False), (1400, False), (1400, True)])
async def test_batch_independent_crops(image_mcp, db_session, equipment_fixture, distance, mixed):
    call, calls, _, _, transport = image_mcp
    _, floorplan, motor, panel, _ = equipment_fixture
    panel.x_coordinate = motor.x_coordinate + distance
    panel.y_coordinate = motor.y_coordinate
    db_session.add(panel)
    records = [{"id": motor.id, "type": "equipment"}, {"id": panel.id, "type": "equipment"}]
    if mixed:
        room = models.Room(name="Room landmark", floorplan_id=floorplan.id, x_coordinate=1800, y_coordinate=200)
        db_session.add(room)
        await db_session.flush()
        records[1] = {"id": room.id, "type": "room"}
    await db_session.commit()
    response = await call("get_location_images", records=records)
    assert "ui" not in response["_meta"]
    assert "openai/outputTemplate" not in response["_meta"]
    data = assert_crop_images(response)
    assert len(calls) == 2
    assert [{"id": entry["id"], "type": entry["type"]} for entry in data["results"]] == records
    if distance > 1000:
        assert data["results"][0]["crop"]["crop_drawing_units"] != data["results"][1]["crop"]["crop_drawing_units"]
    # Optional real MCP payload capture for browser verification; never includes credentials.
    capture_dir = os.getenv("EQUIPMAP_VIEWER_CAPTURE_DIR")
    if capture_dir and mixed:
        root = Path(capture_dir)
        root.mkdir(parents=True, exist_ok=True)
        (root / "batch.json").write_text(json.dumps(response))
        resource = (await mcp_request(transport, image_mcp[3]["access_token"], "resources/read", {"uri": "ui://equipmap/location-v1.html"})).json()["result"]["contents"][0]
        (root / "viewer.html").write_text(resource["text"])
        search = await call("search_equipment", query="P39", image_policy="always")
        (root / "search.json").write_text(json.dumps(search))
        single = await call("get_location_image", equipment_id=motor.id)
        (root / "single.json").write_text(json.dumps(single))


async def test_batch_invalid_and_limit_status(image_mcp, equipment_fixture):
    call, calls, *_ = image_mcp
    motor, panel = equipment_fixture[2:4]
    records = [{"id": 99999999, "type": "room"}, {"id": motor.id, "type": "equipment"}, {"id": panel.id, "type": "equipment"}]
    data = assert_crop_images(await call("get_location_images", records=records, max_images=2))
    assert [entry["image_status"] for entry in data["results"]] == ["error", "included", "skipped"]
    assert "record" not in data["results"][0]
    assert data["results"][2]["record"]["name"] == panel.name
    assert data["results"][2]["image_skip_reason"] == "limit"
    assert len(calls) == 1


@pytest.mark.parametrize("tool,all_fail", [("search_equipment", False), ("get_location_images", False), ("get_location_images", True)])
async def test_image_failure_is_local(image_mcp, equipment_fixture, monkeypatch, tool, all_fail):
    import chatgpt_mcp
    call, calls, *_ = image_mcp
    original = chatgpt_mcp.render_location
    motor, panel = equipment_fixture[2:4]

    def fail(*args):
        if all_fail or args[4] == motor.name:
            raise LocationUnavailable("The drawing could not be rendered. Open it in EquipMap.")
        return original(*args)

    monkeypatch.setattr(chatgpt_mcp, "render_location", fail)
    arguments = {"query": "P39", "image_policy": "always"} if tool == "search_equipment" else {
        "records": [{"id": motor.id, "type": "equipment"}, {"id": panel.id, "type": "equipment"}]}
    data = assert_crop_images(await call(tool, **arguments))
    assert data["results"][0]["image_status"] == "error"
    assert data["results"][1]["image_status"] == ("error" if all_fail else "included")
    if not all_fail:
        assert data["results"][1]["presentation"]["image_index"] == 0
    # Failed attempts do not get replaced by the second record.
    arguments["max_images"] = 1
    data = assert_crop_images(await call(tool, **arguments))
    assert data["results"][1]["image_status"] == "skipped"


@pytest.mark.parametrize("tool,arguments", [
    ("search_equipment", {"query": "P39", "max_images": 0}),
    ("search_equipment", {"query": "P39", "max_images": 6}),
    ("search_equipment", {"query": "P39", "max_images": 1.5}),
    ("search_equipment", {"query": "P39", "image_policy": "bad"}),
    ("search_equipment", {"query": "P39", "image_zoom": "bad"}),
    ("get_location_images", {"records": []}),
    ("get_location_images", {"records": [{"id": 1, "type": "room"}] * 51}),
    ("get_location_images", {"records": [{"id": 0, "type": "room"}]}),
    ("get_location_images", {"records": [{"id": 1, "type": "invalid"}]}),
    ("get_location_images", {"records": [{"id": 1, "type": "room"}], "max_images": 6}),
])
async def test_image_parameter_validation(image_mcp, tool, arguments):
    call, calls, *_ = image_mcp
    assert (await call(tool, **arguments))["isError"]
    assert calls == []


@pytest.mark.parametrize("tool", ["search_equipment", "get_location_images", "get_location_image"])
async def test_revoke_while_rendering_returns_no_images(image_mcp, equipment_fixture, monkeypatch, tool):
    import chatgpt_mcp
    from tests.conftest import TestingSessionLocal
    call, calls, server, tokens, _ = image_mcp
    verify = server._token_verifier.verify_token
    original = chatgpt_mcp.render_location
    rendered = False

    def mark_rendered(*args):
        nonlocal rendered
        rendered = True
        return original(*args)

    async def revoke_after_render(token):
        if rendered:
            async with TestingSessionLocal() as db:
                grant = (await db.execute(select(ChatGPTGrant).where(ChatGPTGrant.access_hash == credential_hash(token)))).scalar_one()
                grant.revoked_at = utcnow()
                await db.commit()
        return await verify(token)

    monkeypatch.setattr(chatgpt_mcp, "render_location", mark_rendered)
    monkeypatch.setattr(server._token_verifier, "verify_token", revoke_after_render)
    motor = equipment_fixture[2]
    arguments = {"query": "P39", "image_policy": "always"} if tool == "search_equipment" else (
        {"records": [{"id": motor.id, "type": "equipment"}]} if tool == "get_location_images" else {"equipment_id": motor.id})
    response = await call(tool, **arguments)
    assert response["isError"]
    assert all(item["type"] != "image" for item in response["content"])
    assert "images" not in response.get("_meta", {})
    assert "imagePng" not in response.get("_meta", {})
