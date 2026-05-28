"""
NHID-Clinical SaaS — Usage tracking per org.
"""
import os
import sqlite3
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "saas.db")


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_request(
    org_id: str,
    endpoint: str,
    method: str = "POST",
    status_code: Optional[int] = None,
    session_id: Optional[str] = None,
) -> None:
    conn = _get_conn()
    with conn:
        conn.execute(
            "INSERT INTO usage_log (org_id, endpoint, method, status_code, session_id, timestamp) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (org_id, endpoint, method, status_code, session_id, _now()),
        )
    conn.close()


def get_usage_summary(org_id: str) -> Dict[str, Any]:
    conn = _get_conn()
    total = conn.execute(
        "SELECT COUNT(*) FROM usage_log WHERE org_id = ?", (org_id,)
    ).fetchone()[0]
    by_endpoint = conn.execute(
        "SELECT endpoint, COUNT(*) as count FROM usage_log WHERE org_id = ? GROUP BY endpoint ORDER BY count DESC",
        (org_id,),
    ).fetchall()
    today_count = conn.execute(
        "SELECT COUNT(*) FROM usage_log WHERE org_id = ? AND timestamp >= date('now')",
        (org_id,),
    ).fetchone()[0]
    conn.close()
    return {
        "total_requests": total,
        "today_requests": today_count,
        "by_endpoint": [dict(r) for r in by_endpoint],
    }


def get_recent_activity(org_id: Optional[str], limit: int = 20) -> List[Dict[str, Any]]:
    """Return recent usage_log rows. Pass org_id=None to get activity across all orgs."""
    conn = _get_conn()
    if org_id is None:
        rows = conn.execute(
            "SELECT * FROM usage_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM usage_log WHERE org_id = ? ORDER BY id DESC LIMIT ?",
            (org_id, limit),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_global_stats() -> Dict[str, Any]:
    conn = _get_conn()
    total_requests = conn.execute("SELECT COUNT(*) FROM usage_log").fetchone()[0]
    orgs_active_today = conn.execute(
        "SELECT COUNT(DISTINCT org_id) FROM usage_log WHERE timestamp >= date('now')"
    ).fetchone()[0]
    total_orgs = conn.execute("SELECT COUNT(*) FROM orgs WHERE active = 1").fetchone()[0]
    plan_rows = conn.execute(
        "SELECT plan, COUNT(*) as cnt FROM orgs WHERE active = 1 GROUP BY plan"
    ).fetchall()
    conn.close()
    return {
        "total_requests": total_requests,
        "total_orgs": total_orgs,
        "orgs_active_today": orgs_active_today,
        "orgs_by_plan": {r["plan"]: r["cnt"] for r in plan_rows},
    }
