"""
voice_policy_store.py — Per-org policy configuration persistence.

Each org can customise their escalation trigger phrases.  If no custom config
exists the policy engine falls back to the hardcoded defaults in voice_policy.py.
All saves are append-only (audit-friendly): every change creates a new row so
the full version history is always queryable.
"""

import json
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from saas_layer.db import get_conn

DEFAULT_VERSION = "VOICE-POLICY-v1.0"
_DEFAULT_PHRASES = [
    "speak to a human",
    "real person",
    "agent please",
    "transfer me",
    "human agent",
    "talk to someone",
]


def init_voice_policy_table() -> None:
    """Idempotent schema bootstrap for the voice policy config table."""
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS voice_policy_configs (
                    id         SERIAL PRIMARY KEY,
                    org_id     TEXT NOT NULL,
                    phrases    TEXT NOT NULL,
                    version    TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_vpc_org_created
                ON voice_policy_configs (org_id, created_at DESC)
            """)
    finally:
        conn.close()


def get_current_policy(org_id: str) -> Optional[Dict[str, Any]]:
    """
    Return the latest policy config for org_id, or None if no custom config exists.
    Callers that receive None should use the hardcoded defaults.

    Return shape:
        {"phrases": [...], "version": "VOICE-POLICY-v...", "created_at": "...", "is_custom": True}
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT phrases, version, created_at
            FROM voice_policy_configs
            WHERE org_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (org_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "phrases": json.loads(row["phrases"]),
            "version": row["version"],
            "created_at": row["created_at"],
            "is_custom": True,
        }
    finally:
        conn.close()


def get_effective_policy(org_id: str) -> Dict[str, Any]:
    """
    Return the effective policy for org_id, falling back to defaults.
    Always returns a usable dict — never None.
    """
    custom = get_current_policy(org_id)
    if custom:
        return custom
    return {
        "phrases": list(_DEFAULT_PHRASES),
        "version": DEFAULT_VERSION,
        "created_at": None,
        "is_custom": False,
    }


def save_policy(org_id: str, phrases: List[str]) -> Dict[str, Any]:
    """
    Append a new policy version for org_id and return the saved config.
    Version format: VOICE-POLICY-v<unix_epoch>
    """
    version = f"VOICE-POLICY-v{int(time.time())}"
    created_at = datetime.now(timezone.utc).isoformat()
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO voice_policy_configs (org_id, phrases, version, created_at)
                VALUES (%s, %s, %s, %s)
                """,
                (org_id, json.dumps(phrases), version, created_at),
            )
    finally:
        conn.close()
    return {
        "phrases": phrases,
        "version": version,
        "created_at": created_at,
        "is_custom": True,
    }


def get_policy_history(org_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Return up to `limit` recent policy versions for org_id, newest first.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, phrases, version, created_at
            FROM voice_policy_configs
            WHERE org_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (org_id, limit),
        )
        rows = cur.fetchall()
        return [
            {
                "id": r["id"],
                "phrases": json.loads(r["phrases"]),
                "version": r["version"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    finally:
        conn.close()
