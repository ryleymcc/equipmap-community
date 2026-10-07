"""Opt-in, explicit public URLs for the read-only ChatGPT connection."""

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

SCOPE = "equipmap.read"


def public_url(value: str, *, origin_only: bool = False) -> str:
    parsed = urlsplit(value)
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (parsed.scheme != "https" and not (parsed.scheme == "http" and local)) or not parsed.netloc:
        raise ValueError("ChatGPT URLs must use HTTPS (HTTP is allowed only on loopback for development)")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("ChatGPT public URLs cannot contain credentials, queries, or fragments")
    if origin_only and parsed.path not in {"", "/"}:
        raise ValueError("CHATGPT_PUBLIC_URL must be an origin without a path")
    return value.rstrip("/")


@dataclass(frozen=True)
class ChatGPTSettings:
    public_url: str
    frontend_url: str
    client_id: str
    redirect_uris: tuple[str, ...]

    @property
    def resource(self) -> str:
        return f"{self.public_url}/mcp"


def get_chatgpt_settings() -> ChatGPTSettings | None:
    if os.getenv("CHATGPT_ENABLED", "false").lower() != "true":
        return None
    origin = public_url(os.environ.get("CHATGPT_PUBLIC_URL", ""), origin_only=True)
    frontend = public_url(os.getenv("CHATGPT_FRONTEND_URL", origin))
    redirects = tuple(uri.strip() for uri in os.getenv(
        "CHATGPT_REDIRECT_URIS", "https://chatgpt.com/connector_platform_oauth_redirect"
    ).split(",") if uri.strip())
    for uri in redirects:
        public_url(uri)  # Validate, but preserve trailing slashes for exact redirect matching.
    client_id = os.getenv("CHATGPT_CLIENT_ID", "equipmap-chatgpt").strip()
    if not redirects or not client_id:
        raise ValueError("ChatGPT requires a client ID and at least one exact redirect URI")
    return ChatGPTSettings(origin, frontend, client_id, redirects)
