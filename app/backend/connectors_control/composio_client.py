# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Thin sync wrapper around the Composio v1 SDK. View code calls these via
`asyncio.to_thread` from async handlers.

Composio holds OAuth tokens for us — we never see them. The only state we
keep server-side is what Composio itself stores (connection nanoid +
status). Our backend is stateless beyond what Composio remembers.
"""

import logging
import os
from functools import lru_cache

logger = logging.getLogger(__name__)


class ComposioNotConfigured(RuntimeError):
    """Raised when COMPOSIO_API_KEY is missing or sentinel-valued."""


class ComposioError(RuntimeError):
    """Raised for any error response from Composio that should reach the user."""


_PLACEHOLDER_VALUES = {
    "",
    "composio-api-key-not-configured",
    "your-composio-api-key",
}


def _api_key() -> str:
    value = os.environ.get("COMPOSIO_API_KEY", "").strip()
    if value in _PLACEHOLDER_VALUES:
        raise ComposioNotConfigured(
            "COMPOSIO_API_KEY is not set. Configure it in the backend env to "
            "enable connectors."
        )
    return value


@lru_cache(maxsize=1)
def _client():
    _api_key()  # raises if unset
    from composio import Composio
    return Composio()


def initiate_oauth(user_id: str, auth_config_id: str, callback_url: str) -> dict:
    """Start an OAuth flow for the given user against an auth_config.

    Returns ``{"id": nanoid, "redirect_url": url, "status": status}``.
    """
    client = _client()
    try:
        req = client.connected_accounts.initiate(
            user_id=user_id,
            auth_config_id=auth_config_id,
            callback_url=callback_url,
        )
    except Exception as e:
        logger.exception("Composio initiate_oauth failed")
        raise ComposioError(str(e)) from e
    return {
        "id": req.id,
        "redirect_url": req.redirect_url,
        "status": req.status,
    }


def list_connections(user_id: str, toolkit_slugs: list[str] | None = None) -> list[dict]:
    """Return all connected accounts for a user, optionally filtered by toolkit."""
    client = _client()
    try:
        kwargs: dict = {"user_ids": [user_id]}
        if toolkit_slugs:
            kwargs["toolkit_slugs"] = toolkit_slugs
        response = client.connected_accounts.list(**kwargs)
    except Exception as e:
        logger.exception("Composio list_connections failed")
        raise ComposioError(str(e)) from e

    items = getattr(response, "items", None) or []
    out = []
    for item in items:
        out.append(
            {
                "id": getattr(item, "id", None),
                "status": getattr(item, "status", None),
                "toolkit_slug": _extract_toolkit_slug(item),
            }
        )
    return out


def _extract_toolkit_slug(item) -> str | None:
    """Composio nests toolkit slug under .toolkit.slug; fall back to known aliases."""
    toolkit = getattr(item, "toolkit", None)
    if toolkit is None:
        return None
    slug = getattr(toolkit, "slug", None)
    if isinstance(slug, str):
        return slug.upper()
    return None


def delete_connection(connection_id: str) -> None:
    client = _client()
    try:
        client.connected_accounts.delete(nanoid=connection_id)
    except Exception as e:
        logger.exception("Composio delete_connection failed")
        raise ComposioError(str(e)) from e
