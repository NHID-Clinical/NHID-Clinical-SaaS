"""
NHID-Clinical SaaS — Multi-tenant auth.
Manages orgs, API keys. No changes to NHID core.
"""
import os
import sqlite3
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "saas.db")


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = _get_conn()
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS orgs (
                org_id                  TEXT PRIMARY KEY,
                org_name                TEXT NOT NULL,
                api_key                 TEXT NOT NULL UNIQUE,
                plan                    TEXT NOT NULL DEFAULT 'free',
                status                  TEXT NOT NULL DEFAULT 'active',
                stripe_customer_id      TEXT,
                stripe_subscription_id  TEXT,
                created_at              TEXT NOT NULL,
                usage_count             INTEGER NOT NULL DEFAULT 0,
                active                  INTEGER NOT NULL DEFAULT 1
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS usage_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id      TEXT NOT NULL,
                endpoint    TEXT NOT NULL,
                method      TEXT NOT NULL DEFAULT 'POST',
                status_code INTEGER,
                session_id  TEXT,
                timestamp   TEXT NOT NULL
            )
        """)
    conn.close()

    # Add billing columns to existing DBs (idempotent)
    from saas_layer.stripe_billing import migrate_billing_columns
    migrate_billing_columns()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_org(org_name: str, plan: str = "free") -> Dict[str, Any]:
    org_id = str(uuid.uuid4())
    api_key = "nhid_" + secrets.token_hex(24)
    conn = _get_conn()
    with conn:
        conn.execute(
            """INSERT INTO orgs
               (org_id, org_name, api_key, plan, status, created_at)
               VALUES (?, ?, ?, ?, 'active', ?)""",
            (org_id, org_name, api_key, plan, _now()),
        )
    conn.close()
    return {"org_id": org_id, "org_name": org_name, "api_key": api_key, "plan": plan}


def validate_api_key(api_key: str) -> Optional[Dict[str, Any]]:
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM orgs WHERE api_key = ? AND active = 1", (api_key,)
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return dict(row)


def get_org(org_id: str) -> Optional[Dict[str, Any]]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM orgs WHERE org_id = ?", (org_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def list_orgs() -> list:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM orgs ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def increment_usage(org_id: str) -> None:
    conn = _get_conn()
    with conn:
        conn.execute(
            "UPDATE orgs SET usage_count = usage_count + 1 WHERE org_id = ?",
            (org_id,),
        )
    conn.close()
