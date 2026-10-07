"""Authorization-code + S256 PKCE linking using the existing EquipMap login.

This integration uses a predefined public OAuth client, not open registration.
Its opaque, audience-bound tokens cannot authenticate to the normal write API.
"""

import base64
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from chatgpt_review_models import ReviewDecision
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import models
from chatgpt_config import SCOPE, ChatGPTSettings, get_chatgpt_settings
from chatgpt_models import ChatGPTAuthorization, ChatGPTGrant, ChatGPTUsedRefreshToken
from database import get_db
from limiter import limiter
from utils import require_user

router = APIRouter(tags=["ChatGPT"])
PRIVATE = {"Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer"}


def utcnow():
    return datetime.now(timezone.utc)


def credential_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def settings() -> ChatGPTSettings:
    value = get_chatgpt_settings()
    if value is None:
        raise HTTPException(503, "The ChatGPT connection is not enabled.")
    return value


def oauth_error(error: str, description: str):
    return JSONResponse({"error": error, "error_description": description}, status_code=400, headers=PRIVATE)


def callback(config, params, **values):
    query = dict(values, iss=config.public_url)
    if params.get("state") is not None:
        query["state"] = params["state"]
    return params["redirect_uri"] + "?" + urlencode(query)


@router.get("/.well-known/oauth-authorization-server", include_in_schema=False)
async def authorization_metadata(config: ChatGPTSettings = Depends(settings)):
    return JSONResponse({
        "issuer": config.public_url,
        "authorization_endpoint": f"{config.public_url}/api/chatgpt/oauth/authorize",
        "token_endpoint": f"{config.public_url}/api/chatgpt/oauth/token",
        "revocation_endpoint": f"{config.public_url}/api/chatgpt/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": [SCOPE],
        "authorization_response_iss_parameter_supported": True,
    }, headers=PRIVATE)


@router.get("/.well-known/oauth-protected-resource", include_in_schema=False)
async def resource_metadata(config: ChatGPTSettings = Depends(settings)):
    return JSONResponse({"resource": config.resource, "authorization_servers": [config.public_url],
        "scopes_supported": [SCOPE], "bearer_methods_supported": ["header"]}, headers=PRIVATE)


@router.get("/api/chatgpt/oauth/authorize", include_in_schema=False)
@limiter.limit("20/minute")
async def authorize(request: Request, db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    params = dict(request.query_params)
    if len(request.query_params.multi_items()) != len(params):
        return oauth_error("invalid_request", "Repeated OAuth parameters are not supported.")
    if params.get("client_id") != config.client_id or params.get("redirect_uri") not in config.redirect_uris:
        return oauth_error("invalid_request", "Unrecognized client or redirect URI.")
    if params.get("response_type") != "code" or params.get("resource") != config.resource:
        return oauth_error("invalid_request", "Use response_type=code and the advertised MCP resource.")
    if params.get("scope", SCOPE).split() != [SCOPE]:
        return oauth_error("invalid_scope", "Only read-only EquipMap access is available.")
    if params.get("code_challenge_method") != "S256" or not re.fullmatch(r"[A-Za-z0-9_-]{43}", params.get("code_challenge", "")):
        return oauth_error("invalid_request", "An S256 PKCE challenge is required.")
    if len(params.get("state", "")) > 2048:
        return oauth_error("invalid_request", "The state parameter is too long.")
    await db.execute(delete(ChatGPTAuthorization).where(ChatGPTAuthorization.expires_at < utcnow()))
    await db.execute(delete(ChatGPTUsedRefreshToken).where(ChatGPTUsedRefreshToken.expires_at < utcnow()))
    handle = secrets.token_urlsafe(32)
    db.add(ChatGPTAuthorization(request_hash=credential_hash(handle), parameters={
        key: params[key] for key in ("client_id", "redirect_uri", "resource", "code_challenge", "state") if key in params
    }, expires_at=utcnow() + timedelta(minutes=10)))
    await db.commit()
    return RedirectResponse(f"{config.frontend_url}/connect/chatgpt?{urlencode({'request': handle})}", headers=PRIVATE)


async def authorization_request(db, handle, *, lock=False):
    statement = select(ChatGPTAuthorization).where(ChatGPTAuthorization.request_hash == credential_hash(handle))
    if lock:
        statement = statement.with_for_update()
    row = (await db.execute(statement)).scalar_one_or_none()
    if row is None or row.expires_at <= utcnow() or row.code_hash is not None:
        raise HTTPException(410, "This connection request expired or has already been used. Start again from ChatGPT.")
    return row


@router.get("/api/chatgpt/requests/{handle}")
async def consent_details(handle: str, user: models.User = Depends(require_user), db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    row = await authorization_request(db, handle)
    if row.parameters["client_id"] != config.client_id or row.parameters["redirect_uri"] not in config.redirect_uris:
        raise HTTPException(410, "The connection configuration changed. Start again from ChatGPT.")
    return JSONResponse({"client_name": "ChatGPT", "username": user.username, "scope": SCOPE,
        "expires_at": row.expires_at.isoformat()}, headers=PRIVATE)


class Consent(BaseModel):
    approve: bool


@router.post("/api/chatgpt/requests/{handle}")
@limiter.limit("20/minute")
async def complete_consent(handle: str, body: Consent, request: Request, user: models.User = Depends(require_user), db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    row = await authorization_request(db, handle, lock=True)
    if (row.parameters["client_id"] != config.client_id or row.parameters["redirect_uri"] not in config.redirect_uris
            or row.parameters["resource"] != config.resource):
        raise HTTPException(410, "The connection configuration changed. Start again from ChatGPT.")
    if body.approve:
        code = secrets.token_urlsafe(32)
        row.code_hash = credential_hash(code)
        row.user_id = user.id
        row.token_version = user.token_version
        row.expires_at = utcnow() + timedelta(minutes=5)
        url = callback(config, row.parameters, code=code)
    else:
        url = callback(config, row.parameters, error="access_denied")
        await db.delete(row)
    await db.commit()
    return JSONResponse({"redirect_url": url}, headers=PRIVATE)


def new_tokens(grant):
    access, refresh = secrets.token_urlsafe(48), secrets.token_urlsafe(48)
    grant.access_hash, grant.refresh_hash = credential_hash(access), credential_hash(refresh)
    grant.access_expires_at = min(utcnow() + timedelta(hours=1), grant.expires_at)
    return {"access_token": access, "token_type": "Bearer", "expires_in": max(1, int((grant.access_expires_at - utcnow()).total_seconds())),
        "refresh_token": refresh, "scope": SCOPE}


@router.post("/api/chatgpt/oauth/token", include_in_schema=False)
@limiter.limit("30/minute")
async def token(request: Request, db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    form = await request.form()
    if len(form.multi_items()) != len(form) or form.get("client_id") != config.client_id or form.get("resource") != config.resource:
        return oauth_error("invalid_request", "Use the configured client ID and MCP resource.")
    if form.get("grant_type") == "authorization_code":
        row = (await db.execute(select(ChatGPTAuthorization).where(
            ChatGPTAuthorization.code_hash == credential_hash(str(form.get("code", "")))
        ).with_for_update())).scalar_one_or_none()
        verifier = str(form.get("code_verifier", ""))
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        if (row is None or row.expires_at <= utcnow() or row.parameters["client_id"] != config.client_id
                or row.parameters["resource"] != config.resource or row.parameters["redirect_uri"] != form.get("redirect_uri")
                or not re.fullmatch(r"[A-Za-z0-9._~-]{43,128}", verifier)
                or not hmac.compare_digest(challenge, row.parameters["code_challenge"])):
            return oauth_error("invalid_grant", "The authorization code or PKCE verifier is invalid or expired.")
        user = await db.get(models.User, row.user_id)
        if user is None or not user.is_active or user.token_version != row.token_version:
            return oauth_error("invalid_grant", "The EquipMap account is no longer authorized.")
        grant = ChatGPTGrant(id=secrets.token_hex(16), user_id=user.id, client_id=config.client_id,
            resource=config.resource, token_version=user.token_version, created_at=utcnow(), expires_at=utcnow() + timedelta(days=30))
        data = new_tokens(grant)
        db.add(grant)
        await db.delete(row)
    elif form.get("grant_type") == "refresh_token":
        refresh_digest = credential_hash(str(form.get("refresh_token", "")))
        grant = (await db.execute(select(ChatGPTGrant).where(
            ChatGPTGrant.refresh_hash == refresh_digest
        ).with_for_update())).scalar_one_or_none()
        if grant is None:
            used = await db.get(ChatGPTUsedRefreshToken, refresh_digest)
            if used is not None:
                replayed = (await db.execute(select(ChatGPTGrant).where(ChatGPTGrant.id == used.grant_id).with_for_update())).scalar_one_or_none()
                if replayed and replayed.client_id == config.client_id and replayed.resource == config.resource:
                    replayed.revoked_at = utcnow()
                    await db.commit()
            return oauth_error("invalid_grant", "The refresh token is invalid or has already been used. Reconnect your account.")
        if grant is None or grant.revoked_at or grant.expires_at <= utcnow() or grant.client_id != config.client_id or grant.resource != config.resource:
            return oauth_error("invalid_grant", "The connection has expired or been revoked.")
        user = await db.get(models.User, grant.user_id)
        if user is None or not user.is_active or user.token_version != grant.token_version:
            return oauth_error("invalid_grant", "The EquipMap account is no longer authorized.")
        if form.get("scope") is not None and str(form["scope"]).split() != [SCOPE]:
            return oauth_error("invalid_scope", "The connection only supports read-only access.")
        db.add(ChatGPTUsedRefreshToken(token_hash=refresh_digest, grant_id=grant.id, expires_at=grant.expires_at))
        data = new_tokens(grant)
    else:
        return oauth_error("unsupported_grant_type", "Use authorization_code or refresh_token.")
    await db.commit()
    return JSONResponse(data, headers=PRIVATE)


@router.post("/api/chatgpt/oauth/revoke", include_in_schema=False)
@limiter.limit("30/minute")
async def revoke(request: Request, db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    form = await request.form()
    if form.get("client_id") != config.client_id:
        return oauth_error("invalid_client", "Unrecognized client.")
    digest = credential_hash(str(form.get("token", "")))
    grant = (await db.execute(select(ChatGPTGrant).where(or_(
        ChatGPTGrant.access_hash == digest, ChatGPTGrant.refresh_hash == digest
    ), ChatGPTGrant.client_id == config.client_id).with_for_update())).scalar_one_or_none()
    if grant is not None:
        grant.revoked_at = utcnow()
        await db.commit()
    return JSONResponse({}, headers=PRIVATE)


@router.get("/api/chatgpt/connections")
async def connections(user: models.User = Depends(require_user), db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    rows = (await db.execute(select(ChatGPTGrant).where(ChatGPTGrant.user_id == user.id,
        ChatGPTGrant.revoked_at.is_(None), ChatGPTGrant.expires_at > utcnow(),
        ChatGPTGrant.token_version == user.token_version, ChatGPTGrant.resource == config.resource,
        ChatGPTGrant.client_id == config.client_id).order_by(ChatGPTGrant.created_at.desc()))).scalars().all()
    return JSONResponse([{"id": row.id, "created_at": row.created_at.isoformat(), "expires_at": row.expires_at.isoformat()} for row in rows], headers=PRIVATE)


@router.delete("/api/chatgpt/connections/{grant_id}")
async def disconnect(grant_id: str, user: models.User = Depends(require_user), db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    row = (await db.execute(select(ChatGPTGrant).where(ChatGPTGrant.id == grant_id, ChatGPTGrant.user_id == user.id).with_for_update())).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Connection not found.")
    row.revoked_at = utcnow()
    await db.commit()
    return JSONResponse({"disconnected": True}, headers=PRIVATE)


@router.get("/api/chatgpt/changes/{handle}")
async def change_review(handle: str, user: models.User = Depends(require_user), db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    from chatgpt_changes import review
    return JSONResponse(await review(db, handle, user, config), headers=PRIVATE)


@router.get("/api/chatgpt/pending-changes")
async def pending_change_list(user: models.User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    from chatgpt_changes import pending_changes
    from utils import require_editor
    await require_editor(user)
    config = get_chatgpt_settings()
    data = {"results": [], "has_more": False} if config is None else (await pending_changes(db, user, config, audit=True))[0]
    # Native audit browsing does not need or expose the chat approval capability.
    return JSONResponse(data, headers=PRIVATE)


@router.get("/api/chatgpt/review-view")
async def native_review_view(user: models.User = Depends(require_user)):
    from utils import require_editor
    from chatgpt_mcp import review_document
    await require_editor(user)
    return HTMLResponse(review_document(native=True), headers=PRIVATE)


@router.get("/api/chatgpt/review-pending")
async def native_pending_review(user: models.User = Depends(require_user), db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    from chatgpt_changes import pending_changes
    from utils import require_editor
    await require_editor(user)
    data, tokens = await pending_changes(db, user, config, audit=True)
    return JSONResponse({"structuredContent": data, "_meta": {"approval_tokens": tokens}}, headers=PRIVATE)


class NativeReviewSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decisions: list[ReviewDecision] = Field(min_length=1, max_length=20)


@router.post("/api/chatgpt/review-pending")
@limiter.limit("20/minute")
async def native_submit_reviews(body: NativeReviewSubmission, request: Request, user: models.User = Depends(require_user), db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    from chatgpt_changes import submit_reviews
    from utils import require_editor
    await require_editor(user)
    try:
        result = await submit_reviews(db, None, user.id, config, body.decisions)
        return JSONResponse({"structuredContent": result}, headers=PRIVATE)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/api/chatgpt/changes/{handle}")
@limiter.limit("20/minute")
async def confirm_change(handle: str, body: Consent, request: Request, user: models.User = Depends(require_user), db: AsyncSession = Depends(get_db), config: ChatGPTSettings = Depends(settings)):
    from chatgpt_changes import review
    return JSONResponse(await review(db, handle, user, config, approve=body.approve), headers=PRIVATE)
