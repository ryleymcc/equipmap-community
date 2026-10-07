import pytest
import os
import importlib
import sys

# Ensure backend path is on sys.path
backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

import config


def test_production_fails_when_secret_key_missing(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("SECRET_KEY", raising=False)

    # Reload config or re-evaluate with monkeypatched env
    monkeypatch.setattr(config, "IS_PRODUCTION", True)

    with pytest.raises(RuntimeError, match="SECRET_KEY environment variable is required in production"):
        config.get_secret_key()


def test_production_fails_when_secret_key_is_default(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SECRET_KEY", "your-secret-key-change-it-in-production")
    monkeypatch.setattr(config, "IS_PRODUCTION", True)

    with pytest.raises(RuntimeError, match="Production SECRET_KEY is insecure"):
        config.get_secret_key()


def test_production_fails_when_secret_key_too_short(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SECRET_KEY", "too-short")
    monkeypatch.setattr(config, "IS_PRODUCTION", True)

    with pytest.raises(RuntimeError, match="must be at least 32 characters long"):
        config.get_secret_key()


def test_production_accepts_valid_strong_secret_key(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    strong_key = "a" * 32 + "super_secure_random_key_entropy_123"
    monkeypatch.setenv("SECRET_KEY", strong_key)
    monkeypatch.setattr(config, "IS_PRODUCTION", True)

    assert config.get_secret_key() == strong_key


def test_production_fails_when_database_url_missing(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(config, "IS_PRODUCTION", True)

    with pytest.raises(RuntimeError, match="DATABASE_URL environment variable must be set in production"):
        config.get_database_url()


def test_production_fails_when_database_url_uses_insecure_default_password(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://myuser:mypassword@db:5432/floorplan_db")
    monkeypatch.setattr(config, "IS_PRODUCTION", True)

    with pytest.raises(RuntimeError, match="appears to use a default or insecure password"):
        config.get_database_url()


def test_production_accepts_valid_database_url(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    valid_url = "postgresql+asyncpg://app_user:9k#mP$7vL@qW2!xZ@prod-db.internal:5432/equipmap_prod"
    monkeypatch.setenv("DATABASE_URL", valid_url)
    monkeypatch.setattr(config, "IS_PRODUCTION", True)

    assert config.get_database_url() == valid_url


def test_development_allows_fallback_values(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.setattr(config, "IS_PRODUCTION", False)

    db_url = config.get_database_url()
    assert db_url == config.DEV_FALLBACK_DATABASE_URL

    secret = config.get_secret_key()
    assert secret == config.DEV_FALLBACK_SECRET_KEY


def test_initial_admin_password_in_production_vs_development(monkeypatch):
    # In production, default insecure passwords return None
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "admin")
    monkeypatch.setattr(config, "IS_PRODUCTION", True)
    assert config.get_initial_admin_password() is None

    # In production, custom secure password is returned
    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "StrongCustomAdminPass123!")
    assert config.get_initial_admin_password() == "StrongCustomAdminPass123!"

    # In development, fallback default is provided
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("INITIAL_ADMIN_PASSWORD", raising=False)
    monkeypatch.setattr(config, "IS_PRODUCTION", False)
    assert config.get_initial_admin_password() == "admin"


if __name__ == "__main__":
    import pytest
    class SimpleMonkeyPatch:
        def __init__(self):
            self._env_backup = dict(os.environ)
            self._attr_backup = {}
        def setenv(self, k, v):
            os.environ[k] = v
        def delenv(self, k, raising=True):
            os.environ.pop(k, None)
        def setattr(self, obj, attr, val):
            if (id(obj), attr) not in self._attr_backup:
                self._attr_backup[(id(obj), attr)] = (obj, attr, getattr(obj, attr))
            setattr(obj, attr, val)
        def undo(self):
            os.environ.clear()
            os.environ.update(self._env_backup)
            for (oid, attr), (obj, name, orig_val) in self._attr_backup.items():
                setattr(obj, name, orig_val)

    tests = [
        test_production_fails_when_secret_key_missing,
        test_production_fails_when_secret_key_is_default,
        test_production_fails_when_secret_key_too_short,
        test_production_accepts_valid_strong_secret_key,
        test_production_fails_when_database_url_missing,
        test_production_fails_when_database_url_uses_insecure_default_password,
        test_production_accepts_valid_database_url,
        test_development_allows_fallback_values,
        test_initial_admin_password_in_production_vs_development,
    ]
    for test in tests:
        mp = SimpleMonkeyPatch()
        try:
            test(mp)
            print(f"PASSED: {test.__name__}")
        finally:
            mp.undo()
    print("\nAll 9 environment security checks passed successfully!")

