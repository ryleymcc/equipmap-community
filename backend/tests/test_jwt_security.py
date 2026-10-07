"""Regression coverage for the JWT library migration and token rejection."""

import base64
import hashlib
import hmac
import json
import time

import pytest
import jwt

from utils import SECRET_KEY


def legacy_token(payload, secret=SECRET_KEY, algorithm="HS256"):
    # Construct the existing python-jose wire format without retaining that dependency.
    def encode(value):
        return base64.urlsafe_b64encode(
            json.dumps(value, separators=(",", ":")).encode()
        ).rstrip(b"=")

    message = encode({"alg": algorithm, "typ": "JWT"}) + b"." + encode(payload)
    signature = hmac.new(secret.encode(), message, hashlib.sha256).digest()
    return (message + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")).decode()


@pytest.mark.asyncio
async def test_existing_hs256_token_still_authenticates(client, viewer_token):
    payload = jwt.decode(viewer_token, SECRET_KEY, algorithms=["HS256"])
    token = legacy_token(payload)
    response = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["username"] == "viewer_test"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["expired", "signature", "algorithm", "malformed", "subject"])
async def test_invalid_tokens_return_401(client, kind):
    payload = {"sub": "viewer_test", "exp": int(time.time()) + 300}
    if kind == "expired":
        payload["exp"] = int(time.time()) - 300
    if kind == "subject":
        payload["sub"] = 123
    token = legacy_token(
        payload,
        secret="incorrect-signing-key" if kind == "signature" else SECRET_KEY,
        algorithm="none" if kind == "algorithm" else "HS256",
    )
    if kind == "malformed":
        token = "not-a-token"
    response = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
