import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


def compose_config(extra):
    if not shutil.which('docker'):
        pytest.skip('Docker Compose CLI is unavailable')
    environment = dict(os.environ, DB_USER='synthetic', DB_PASSWORD='synthetic-random-db-password', DB_NAME='synthetic')
    environment.pop('SECRET_KEY', None)
    environment.pop('CADDY_PROXY_IP', None)
    environment.pop('EQUIPMAP_PORTABLE', None)
    environment.update(extra)
    return subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env.example'), '-f', str(ROOT / 'compose.yaml'),
        'config', '--format', 'json'], env=environment, capture_output=True, text=True)


def test_production_compose_requires_signing_key():
    assert compose_config({}).returncode != 0


def test_production_compose_supplies_enforced_auth_and_shared_storage():
    key = 'synthetic-key-' * 3
    result = compose_config({'SECRET_KEY': key,
        'CADDY_PROXY_IP': '172.31.252.2', 'ENVIRONMENT': 'development'})
    assert result.returncode == 0, result.stderr
    services = json.loads(result.stdout)['services']
    backend = services['backend']
    assert backend['environment']['ENVIRONMENT'] == 'production'
    assert backend['environment']['SECRET_KEY'] == key
    assert backend['environment']['RATE_LIMIT_STORAGE_URI'] == 'redis://rate-limit:6379/0'
    proxy = services['proxy']['networks']['default']
    assert f"--forwarded-allow-ips={proxy['ipv4_address']}" in backend['command']
    assert not services['rate-limit'].get('ports')


def test_other_production_runners_cannot_silently_use_process_local_counters():
    environment = dict(os.environ, ENVIRONMENT='production', RATE_LIMIT_STORAGE_URI='memory://', RATE_LIMIT_ENABLED='true')
    result = subprocess.run([sys.executable, '-c', 'import limiter'], cwd=Path(__file__).resolve().parents[1],
        env=environment, capture_output=True, text=True)
    assert result.returncode != 0
    assert 'Production rate limiting requires shared Redis storage' in result.stderr


def test_two_limiter_instances_share_redis_counters():
    storage_uri = os.getenv('SECURITY_TEST_REDIS_URL')
    if not storage_uri:
        pytest.skip('Set SECURITY_TEST_REDIS_URL to an isolated Redis instance')
    from limits import parse
    from limits.storage import storage_from_string
    from limits.strategies import FixedWindowRateLimiter
    import uuid

    first = FixedWindowRateLimiter(storage_from_string(storage_uri))
    second = FixedWindowRateLimiter(storage_from_string(storage_uri))
    limit = parse('2/minute')
    key = 'security-regression-' + uuid.uuid4().hex
    assert first.hit(limit, key)
    assert second.hit(limit, key)
    assert not first.hit(limit, key)
    assert not second.hit(limit, key)
