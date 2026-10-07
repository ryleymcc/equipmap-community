import os
import logging

logger = logging.getLogger("backend.config")

# Environment mode: development, test, staging, production
ENVIRONMENT = os.getenv("ENVIRONMENT", os.getenv("APP_ENV", "development")).lower().strip()
IS_PRODUCTION = ENVIRONMENT in ("production", "prod")
IS_TEST = ENVIRONMENT in ("test", "testing")

# Known insecure/default secrets and placeholders
INSECURE_SECRET_KEYS = {
    "your-secret-key-change-it-in-production",
    "test-secret-key",
    "secret",
    "changeme",
    "password",
    "admin",
    "123456",
    "default-secret-key",
}

# Known default database passwords / placeholders
INSECURE_DB_PATTERNS = [
    ":mypassword@",
    ":password@",
    ":postgres@",
    ":root@",
    ":admin@",
    ":changeme@",
]

DEV_FALLBACK_DATABASE_URL = "postgresql+asyncpg://myuser:mypassword@localhost:5432/floorplan_db"
DEV_FALLBACK_SECRET_KEY = "dev-insecure-secret-key-only-for-local-testing-do-not-use-in-production"

def get_database_url() -> str:
    """
    Retrieve and validate the database connection URL.
    In production environments, fails fast if DATABASE_URL is missing or contains default credentials.
    """
    db_url = os.getenv("DATABASE_URL", "").strip()

    if IS_PRODUCTION:
        if not db_url:
            error_msg = (
                "FATAL CONFIGURATION ERROR: DATABASE_URL environment variable must be set in production. "
                "Application startup aborted."
            )
            logger.critical(error_msg)
            raise RuntimeError(error_msg)

        # Check for known default passwords in connection string
        for pattern in INSECURE_DB_PATTERNS:
            if pattern in db_url:
                error_msg = (
                    f"FATAL SECURITY ERROR: DATABASE_URL in production appears to use a default or insecure password "
                    f"(matched '{pattern}'). Application startup aborted."
                )
                logger.critical(error_msg)
                raise RuntimeError(error_msg)

        return db_url

    if not db_url:
        logger.warning(
            "DATABASE_URL not set; using local development fallback. "
            "DO NOT run with this configuration in production."
        )
        return DEV_FALLBACK_DATABASE_URL

    return db_url


def get_secret_key() -> str:
    """
    Retrieve and validate the JWT/Session SECRET_KEY.
    In production environments, fails fast if SECRET_KEY is missing, too short (< 32 chars), or matches known insecure defaults.
    """
    secret = os.getenv("SECRET_KEY", "").strip()

    if IS_PRODUCTION:
        if not secret:
            error_msg = (
                "FATAL CONFIGURATION ERROR: SECRET_KEY environment variable is required in production. "
                "Application startup aborted."
            )
            logger.critical(error_msg)
            raise RuntimeError(error_msg)

        if secret.lower() in INSECURE_SECRET_KEYS or len(secret) < 32:
            error_msg = (
                "FATAL SECURITY ERROR: Production SECRET_KEY is insecure. It must be at least 32 characters long "
                "and cannot use default placeholder values. Application startup aborted."
            )
            logger.critical(error_msg)
            raise RuntimeError(error_msg)

        return secret

    if not secret or secret.lower() in INSECURE_SECRET_KEYS:
        logger.warning(
            "Using insecure fallback SECRET_KEY for development/testing. "
            "Set a secure SECRET_KEY in production."
        )
        return DEV_FALLBACK_SECRET_KEY

    return secret


def get_initial_admin_password() -> str | None:
    """
    Retrieve optional initial admin password for bootstrapping.
    In production, returns None if not explicitly configured or if set to an insecure default.
    """
    admin_pw = os.getenv("INITIAL_ADMIN_PASSWORD", os.getenv("ADMIN_PASSWORD", "")).strip()
    if IS_PRODUCTION:
        if not admin_pw or admin_pw.lower() in ("admin", "password", "123456", "changeme"):
            return None
        return admin_pw

    # In dev/test, if not specified, return default "admin"
    return admin_pw if admin_pw else "admin"
