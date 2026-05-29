"""
NHID-Clinical SaaS — Usage tracking per org.
Backed by Replit PostgreSQL.
"""
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from saas_layer.db import get_conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_request(
    org_id: str,
    endpoint: str,
    method: str = "POST",
    status_code: Optional[int] = None,
    session_id: Optional[str] = None,
) -> None:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO usage_log (org_id, endpoint, method, status_code, session_id, timestamp) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (org_id, endpoint, method, status_code, session_id, _now()),
            )
    finally:
        conn.close()


def get_usage_summary(org_id: str) -> Dict[str, Any]:
    conn = get_conn()
    try:
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) AS cnt FROM usage_log WHERE org_id = %s", (org_id,))
        total = cur.fetchone()["cnt"]

        cur.execute(
            "SELECT endpoint, COUNT(*) AS count FROM usage_log WHERE org_id = %s "
            "GROUP BY endpoint ORDER BY count DESC",
            (org_id,),
        )
        by_endpoint = [dict(r) for r in cur.fetchall()]

        # today_requests: ISO timestamp prefix comparison (stored as text)
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM usage_log "
            "WHERE org_id = %s AND timestamp >= to_char(CURRENT_DATE, 'YYYY-MM-DD')",
            (org_id,),
        )
        today_count = cur.fetchone()["cnt"]

        return {
            "total_requests": total,
            "today_requests": today_count,
            "by_endpoint": by_endpoint,
        }
    finally:
        conn.close()


def get_recent_activity(org_id: Optional[str], limit: int = 20) -> List[Dict[str, Any]]:
    """Return recent usage_log rows. Pass org_id=None to get activity across all orgs."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        if org_id is None:
            cur.execute(
                "SELECT * FROM usage_log ORDER BY id DESC LIMIT %s", (limit,)
            )
        else:
            cur.execute(
                "SELECT * FROM usage_log WHERE org_id = %s ORDER BY id DESC LIMIT %s",
                (org_id, limit),
            )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def get_global_stats() -> Dict[str, Any]:
    conn = get_conn()
    try:
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) AS cnt FROM usage_log")
        total_requests = cur.fetchone()["cnt"]

        cur.execute(
            "SELECT COUNT(DISTINCT org_id) AS cnt FROM usage_log "
            "WHERE timestamp >= to_char(CURRENT_DATE, 'YYYY-MM-DD')"
        )
        orgs_active_today = cur.fetchone()["cnt"]

        cur.execute("SELECT COUNT(*) AS cnt FROM orgs WHERE active = TRUE")
        total_orgs = cur.fetchone()["cnt"]

        cur.execute(
            "SELECT plan, COUNT(*) AS cnt FROM orgs WHERE active = TRUE GROUP BY plan"
        )
        plan_rows = cur.fetchall()

        return {
            "total_requests": total_requests,
            "total_orgs": total_orgs,
            "orgs_active_today": orgs_active_today,
            "orgs_by_plan": {r["plan"]: r["cnt"] for r in plan_rows},
        }
    finally:
        conn.close()
