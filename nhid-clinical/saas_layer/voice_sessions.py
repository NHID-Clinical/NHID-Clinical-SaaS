"""
saas_layer/voice_sessions.py — PostgreSQL-backed voice session state.

Replaces the in-memory _voice_sessions dict in gateway.py.
All operations use get_conn() from db.py and are safe across restarts
and multiple Uvicorn workers.

Transactional read-modify-write pattern (used by voice_transcript):
    conn = get_conn()
    try:
        with conn:  # auto-commit on clean exit, rollback on exception
            row = get_voice_session_for_update(conn, session_id)
            # ... validate, run policy, write audit ...
            update_voice_session_in_tx(conn, session_id, new_disclosure, new_escalated)
        # transaction committed here
    finally:
        conn.close()

SELECT ... FOR UPDATE serialises concurrent requests for the same session_id
so no two workers can make conflicting policy decisions simultaneously.
"""
import logging
from typing import Dict, Any, Optional
from saas_layer.db import get_conn

logger = logging.getLogger(__name__)


def create_voice_session(session_id: str, org_id: str, provider: str = "api") -> None:
    """
    Insert a new voice session row with default state.

    *provider* identifies the telephony integration that originated the call:
    ``"api"`` (direct REST call), ``"retell"``, ``"vapi"``, ``"twilio"``, or
    ``"generic"`` (unrecognised webhook payload).

    Raises if the session_id already exists (primary key violation).
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO voice_sessions (session_id, org_id, disclosure_confirmed, escalated, provider)
                VALUES (%s, %s, FALSE, FALSE, %s)
                """,
                (session_id, org_id, provider),
            )
    finally:
        conn.close()


def get_voice_session_for_update(
    conn,
    session_id: str,
) -> Optional[Dict[str, Any]]:
    """
    SELECT the session row with a row-level lock (FOR UPDATE) within *conn*'s
    current transaction. Blocks concurrent callers for the same session_id until
    the transaction commits or rolls back.

    Returns the row as a dict, or None if not found.
    Must be called inside an active ``with conn:`` block managed by the caller.
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT session_id, org_id, disclosure_confirmed, escalated, created_at, provider "
        "FROM voice_sessions WHERE session_id = %s FOR UPDATE",
        (session_id,),
    )
    row = cur.fetchone()
    return dict(row) if row is not None else None


def update_voice_session_in_tx(
    conn,
    session_id: str,
    disclosure_confirmed: bool,
    escalated: bool,
) -> None:
    """
    UPDATE the mutable state columns within *conn*'s current transaction.
    Must be called inside the same ``with conn:`` block as get_voice_session_for_update.
    """
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE voice_sessions
        SET disclosure_confirmed = %s,
            escalated            = %s
        WHERE session_id = %s
        """,
        (disclosure_confirmed, escalated, session_id),
    )


def list_voice_sessions(
    org_id: Optional[str] = None,
    limit: int = 100,
    escalated_only: bool = False,
    undisclosed_only: bool = False,
) -> list:
    """
    Return recent voice_sessions rows ordered by created_at DESC.

    Parameters
    ----------
    org_id : str, optional
        Restrict to one organisation.
    limit : int
        Maximum rows (capped at 500).
    escalated_only : bool
        Only return sessions where escalated = TRUE.
    undisclosed_only : bool
        Only return sessions where disclosure_confirmed = FALSE.
    """
    limit = min(max(1, limit), 500)
    filters, params = [], []
    if org_id:
        filters.append("org_id = %s")
        params.append(org_id)
    if escalated_only:
        filters.append("escalated = TRUE")
    if undisclosed_only:
        filters.append("disclosure_confirmed = FALSE")
    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    params.append(limit)
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                f"""
                SELECT session_id, org_id, disclosure_confirmed, escalated, created_at, provider
                FROM voice_sessions
                {where}
                ORDER BY created_at DESC
                LIMIT %s
                """,
                params,
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def extend_session(session_id: str) -> bool:
    """
    Reset created_at to NOW() so the session gets a fresh TTL window.

    Call this when an escalated session needs more time before it is purged.
    Returns True if the session existed and was updated, False if not found.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE voice_sessions SET created_at = NOW() WHERE session_id = %s",
                (session_id,),
            )
            return cur.rowcount > 0
    finally:
        conn.close()


def delete_voice_session(session_id: str) -> None:
    """
    Delete a voice session row.  Used for failure compensation in voice_incoming
    when the audit trace write fails after the session row has already been inserted.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM voice_sessions WHERE session_id = %s",
                (session_id,),
            )
    finally:
        conn.close()


def purge_old_sessions(ttl_hours: int = 24) -> int:
    """
    Delete voice_sessions rows whose created_at is older than *ttl_hours*.

    Uses the ``idx_vs_created_at`` index so the DELETE is efficient even on
    large tables.  Returns the number of rows deleted.

    This function opens and closes its own connection and is safe to call
    from any thread or asyncio task without holding any application lock.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """
                DELETE FROM voice_sessions
                WHERE created_at < NOW() - INTERVAL '%s hours'
                """,
                (ttl_hours,),
            )
            deleted = cur.rowcount
    finally:
        conn.close()
    if deleted:
        logger.info("voice_sessions purge: removed %d rows older than %dh", deleted, ttl_hours)
    return deleted
