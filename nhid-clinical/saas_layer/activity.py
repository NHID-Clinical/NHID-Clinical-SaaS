"""The organization activity log (migrations/0008_org_activity.sql).

Append-only from the application's side: `record` inserts, `list_events` reads,
and nothing updates or deletes. Recording never raises into the request that
caused it: a failed audit write is logged loudly, because refusing a key
revocation because its log row failed would leave the key live.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from saas_layer.db import get_conn

_logger = logging.getLogger(__name__)

# Every action this log records, so the UI and an auditor know the vocabulary.
ACTIONS = (
    "key.created", "key.revoked", "primary_key.rotated",
    "member.added", "member.removed",
    "transcripts.purged", "transcript.purged",
    "sso.configured", "sso.removed", "sso.signed_in", "member.joined_via_sso",
)


def actor_for(org: Dict[str, Any], user: Optional[Dict[str, Any]] = None) -> str:
    """A person's email when one acted, otherwise the credential that did."""
    if user and user.get("email"):
        return user["email"]
    return f"api-key:{org.get('_key_id') or 'primary'}"


def record(org_id: str, *, actor: str, action: str, target: Optional[str] = None,
           detail: Optional[Dict[str, Any]] = None) -> None:
    if action not in ACTIONS:
        raise ValueError(f"unknown activity action {action!r}")
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                """INSERT INTO org_activity (activity_id, org_id, actor, action, target, detail)
                   VALUES (%s, %s, %s, %s, %s, %s::jsonb)""",
                (f"act_{uuid.uuid4().hex[:20]}", org_id, actor, action, target,
                 json.dumps(detail or {})),
            )
    except Exception:  # noqa: BLE001
        _logger.exception("ACTIVITY: failed to record org=%s action=%s target=%s",
                          org_id, action, target)
    finally:
        conn.close()


def list_events(org_id: str, *, limit: int = 1000, since: Optional[str] = None) -> List[Dict[str, Any]]:
    limit = max(1, min(int(limit), 10_000))
    params: List[Any] = [org_id]
    extra = ""
    if since:
        extra = " AND occurred_at >= %s"
        params.append(since)
    params.append(limit)
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT activity_id, occurred_at, actor, action, target, detail "
            "FROM org_activity WHERE org_id = %s" + extra +
            " ORDER BY occurred_at DESC, activity_id DESC LIMIT %s",
            tuple(params),
        )
        rows = []
        for row in cur.fetchall():
            item = dict(row)
            item["occurred_at"] = item["occurred_at"].isoformat()
            rows.append(item)
        return rows
    finally:
        conn.close()
