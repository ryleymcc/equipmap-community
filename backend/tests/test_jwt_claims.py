import asyncio
import time

import jwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from database import get_db
from main import app
import models
from tests.conftest import TestingSessionLocal
from utils import SECRET_KEY, JWT_AUDIENCE, JWT_ISSUER, hash_token, revoke_user_sessions


def claims(token):
    return jwt.decode(token, SECRET_KEY, algorithms=['HS256'], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)


def headers(payload):
    return {'Authorization': 'Bearer ' + jwt.encode(payload, SECRET_KEY, algorithm='HS256')}


@pytest.mark.asyncio
@pytest.mark.parametrize('missing', ['sub', 'exp', 'iat', 'jti', 'token_version', 'type', 'iss', 'aud'])
async def test_all_access_claims_are_required(client, viewer_token, missing):
    payload = claims(viewer_token)
    payload.pop(missing)
    response = await client.get('/api/users/me', headers=headers(payload))
    assert response.status_code == 401
    assert response.headers['www-authenticate'] == 'Bearer'


@pytest.mark.asyncio
@pytest.mark.parametrize(('field', 'value'), [
    ('sub', 'viewer_test'), ('sub', '0'), ('sub', '01'), ('sub', '2147483648'), ('sub', 1),
    ('exp', '4102444800'), ('exp', None), ('iat', '1'), ('iat', True),
    ('jti', ''), ('jti', 1), ('jti', ['invalid']),
    ('type', 'refresh'), ('type', None),
    ('iss', 'other-service'), ('aud', 'other-service'), ('aud', [JWT_AUDIENCE]),
    ('token_version', '1'), ('token_version', None), ('token_version', True),
    ('token_version', {}), ('token_version', 0), ('token_version', 2147483648),
])
async def test_invalid_claims_are_401_instead_of_500(client, viewer_token, field, value):
    payload = claims(viewer_token)
    payload[field] = value
    assert (await client.get('/api/users/me', headers=headers(payload))).status_code == 401


@pytest.mark.asyncio
async def test_future_token_version_is_not_a_revocation_bypass(client, viewer_token):
    payload = claims(viewer_token)
    payload['token_version'] += 1
    assert (await client.get('/api/users/me', headers=headers(payload))).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize('field', ['iat', 'nbf'])
async def test_future_time_claims_rejected(client, viewer_token, field):
    payload = claims(viewer_token)
    payload[field] = int(time.time()) + 3600
    assert (await client.get('/api/users/me', headers=headers(payload))).status_code == 401


@pytest.mark.asyncio
async def test_role_is_loaded_from_database(client, viewer_token):
    payload = claims(viewer_token)
    payload['role'] = 'admin'
    assert (await client.get('/api/users/me', headers=headers(payload))).json()['role'] == 'viewer'
    assert (await client.get('/api/users', headers=headers(payload))).status_code == 403


@pytest.mark.asyncio
async def test_username_reuse_cannot_transfer_token_to_another_account(client, admin_token):
    admin_headers = {'Authorization': f'Bearer {admin_token}'}
    first = (await client.post('/api/users', headers=admin_headers,
        json={'username': 'reused-identity', 'password': 'synthetic-password', 'role': 'technician'})).json()
    login = (await client.post('/api/token', data={'username': 'reused-identity', 'password': 'synthetic-password'})).json()
    assert claims(login['access_token'])['sub'] == str(first['id'])
    assert (await client.put(f"/api/users/{first['id']}", headers=admin_headers, json={'username': 'renamed-identity'})).status_code == 200
    replacement = (await client.post('/api/users', headers=admin_headers,
        json={'username': 'reused-identity', 'password': 'different-password', 'role': 'admin'})).json()
    old_headers = {'Authorization': 'Bearer ' + login['access_token']}
    profile = (await client.get('/api/users/me', headers=old_headers)).json()
    assert (profile['id'], profile['username'], profile['role']) == (first['id'], 'renamed-identity', 'technician')
    assert (await client.delete(f"/api/users/{first['id']}", headers=admin_headers)).status_code == 200
    assert (await client.get('/api/users/me', headers=old_headers)).status_code == 401
    await client.delete(f"/api/users/{replacement['id']}", headers=admin_headers)


@pytest.mark.asyncio
async def test_access_token_cannot_mint_refresh_credentials(client, viewer_token):
    for body in (None, {}, {'refresh_token': ''}):
        response = await client.post('/api/refresh-token', json=body,
            headers={'Authorization': 'Bearer ' + viewer_token})
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_inactive_account_cannot_refresh_with_matching_token_version(client, db_session):
    login = (await client.post('/api/token', data={'username': 'editor_test', 'password': 'editor_test'})).json()
    async with TestingSessionLocal() as db:
        user = (await db.execute(select(models.User).where(models.User.username == 'editor_test'))).scalar_one()
        user.is_active = False
        await db.commit()
    try:
        assert (await client.get('/api/users/me', headers={'Authorization': 'Bearer ' + login['access_token']})).status_code == 401
        assert (await client.post('/api/refresh-token', json={'refresh_token': login['refresh_token']})).status_code == 401
    finally:
        await db_session.rollback()
        async with TestingSessionLocal() as db:
            user = await db.get(models.User, user.id)
            user.is_active = True
            await db.commit()


@pytest.mark.asyncio
async def test_logout_is_idempotent_and_revokes_refresh_on_repeat(client):
    login = (await client.post('/api/token', data={'username': 'viewer_test', 'password': 'viewer_test'})).json()
    token_headers = {'Authorization': 'Bearer ' + login['access_token']}
    # Blacklist the JWT first, then submit the same JWT with a refresh credential.
    assert (await client.post('/api/auth/logout', headers=token_headers)).status_code == 200
    assert (await client.post('/api/auth/logout', headers=token_headers, json={'refresh_token': login['refresh_token']})).status_code == 200
    assert (await client.get('/api/users/me', headers=token_headers)).status_code == 401
    assert (await client.post('/api/refresh-token', json={'refresh_token': login['refresh_token']})).status_code == 401


@pytest.mark.asyncio
async def test_concurrent_refresh_cannot_spend_one_credential_twice(client):
    login = (await client.post('/api/token', data={'username': 'viewer_test', 'password': 'viewer_test'})).json()

    async def independent_session():
        async with TestingSessionLocal() as db:
            yield db

    original = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = independent_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as concurrent:
            responses = await asyncio.gather(*[
                concurrent.post('/api/refresh-token', json={'refresh_token': login['refresh_token']})
                for _ in range(2)
            ])
            assert sorted(response.status_code for response in responses) == [200, 401]
            issued = next(response.json() for response in responses if response.status_code == 200)
            assert (await concurrent.get('/api/users/me', headers={'Authorization': 'Bearer ' + issued['access_token']})).status_code == 401
            assert (await concurrent.post('/api/refresh-token', json={'refresh_token': issued['refresh_token']})).status_code == 401
    finally:
        app.dependency_overrides[get_db] = original


@pytest.mark.asyncio
async def test_future_refresh_version_is_rejected(client):
    login = (await client.post('/api/token', data={'username': 'viewer_test', 'password': 'viewer_test'})).json()
    async with TestingSessionLocal() as db:
        row = (await db.execute(select(models.RefreshToken).where(models.RefreshToken.token_hash == hash_token(login['refresh_token'])))).scalar_one()
        row.token_version += 1
        await db.commit()
    assert (await client.post('/api/refresh-token', json={'refresh_token': login['refresh_token']})).status_code == 401


@pytest.mark.asyncio
async def test_concurrent_revocations_do_not_lose_a_version_increment():
    async with TestingSessionLocal() as first, TestingSessionLocal() as second:
        user_one = (await first.execute(select(models.User).where(models.User.username == 'editor_test'))).scalar_one()
        user_two = await second.get(models.User, user_one.id)
        initial_version = user_one.token_version
        # Both sessions observed the same old version before either update.
        await asyncio.gather(revoke_user_sessions(user_one, first), revoke_user_sessions(user_two, second))
    async with TestingSessionLocal() as db:
        current = await db.get(models.User, user_one.id)
        assert current.token_version == initial_version + 2
