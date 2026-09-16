"""
webhook_auth.py — credential resolution for the voice webhook endpoints.

Kept separate from gateway.py so it can be tested without a database
connection, and so the auth rule lives in one place for both webhooks.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import HTTPException

_logger = logging.getLogger("nhid.saas")

WEBHOOK_API_KEY_HEADER = "X-NHID-API-Key"


def resolve_webhook_api_key(
    header_key: Optional[str], query_key: Optional[str], endpoint: str
) -> str:
    """Return the webhook API key, preferring the header over the query string.

    Raises 401 when absent. Query-string use is still accepted so existing
    provider registrations keep working, but it logs a deprecation warning.
    The key itself is never logged.
    """
    if header_key:
        return header_key
    if query_key:
        _logger.warning(
            "WEBHOOK_AUTH_DEPRECATED endpoint=%s reason=api_key_in_query_string "
            "action=migrate_to_%s",
            endpoint,
            WEBHOOK_API_KEY_HEADER,
        )
        return query_key
    raise HTTPException(
        status_code=401,
        detail=(
            f"Missing API key. Send it as the {WEBHOOK_API_KEY_HEADER} header. "
            "The ?api_key= query parameter is deprecated and will be removed."
        ),
    )
