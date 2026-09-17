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
import json
import logging
from typing import Dict, Any, Optional
from saas_layer.db import get_conn

logger = logging.getLogger(__name__)


def _authorization_from_row(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Assemble the authorization verdict that voice_policy.check_authorization
    reads from ``session_state["authorization"]``.

    Returns None when no passport was ever presented for this session
    (auth_verified IS NULL). That is deliberately distinct from a verdict with
    ``verified: False``: None lets the policy rule's ``required`` flag decide,
    whereas False is an explicit rejection that always denies.
    """
    if row.get("auth_verified") is None:
        return None

    raw_scope = row.get("auth_scope")
    try:
        scope = json.loads(raw_scope) if raw_scope else []
    except (TypeError, ValueError):
        # A row we cannot parse must not read as "wide open". Fall back to no
        # scope, which denies every scoped rule.
        logger.warning(
            "voice_sessions: unparseable auth_scope for session=%s; treating as empty",
            row.get("session_id"),
        )
        scope = []
    if not isinstance(scope, list):
        scope = []

    return {
        "verified": bool(row["auth_verified"]),
        "reason": row.get("auth_reason") or "",
        "agent_id": row.get("auth_agent_id"),
        "provider_npi": row.get("auth_provider_npi"),
        "delegation_id": row.get("auth_delegation_id"),
        "scope": scope,
    }


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
        "SELECT session_id, org_id, disclosure_confirmed, escalated, created_at, provider, "
        "auth_verified, auth_reason, auth_agent_id, auth_provider_npi, "
        "auth_delegation_id, auth_scope, auth_verified_at "
        "FROM voice_sessions WHERE session_id = %s FOR UPDATE",
        (session_id,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    state = dict(row)
    state["authorization"] = _authorization_from_row(state)
    return state


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


def set_voice_session_authorization_in_tx(
    conn,
    session_id: str,
    verdict: Dict[str, Any],
) -> None:
    """
    Record an agent authorization verdict on the session, inside *conn*'s
    current transaction.

    *verdict* is the reduced dict produced by
    ``agent_authorization.verdict_for_session``. Writing a failed verdict is as
    important as writing a successful one — it is what makes a rejected
    impersonation attempt visible afterwards instead of vanishing.
    """
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE voice_sessions
        SET auth_verified      = %s,
            auth_reason        = %s,
            auth_agent_id      = %s,
            auth_provider_npi  = %s,
            auth_delegation_id = %s,
            auth_scope         = %s,
            auth_verified_at   = NOW()
        WHERE session_id = %s
        """,
        (
            bool(verdict.get("verified", False)),
            verdict.get("reason", ""),
            verdict.get("agent_id"),
            verdict.get("provider_npi"),
            verdict.get("delegation_id"),
            json.dumps(list(verdict.get("scope") or [])),
            session_id,
        ),
    )


def set_voice_session_authorization(session_id: str, verdict: Dict[str, Any]) -> None:
    """Standalone-transaction wrapper around set_voice_session_authorization_in_tx."""
    conn = get_conn()
    try:
        with conn:
            set_voice_session_authorization_in_tx(conn, session_id, verdict)
    finally:
        conn.close()


def get_voice_session(session_id: str) -> Optional[Dict[str, Any]]:
    """
    Read a session row without taking a lock, including its assembled
    ``authorization`` verdict. For read-only callers; the transactional path
    must use get_voice_session_for_update.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT session_id, org_id, disclosure_confirmed, escalated, created_at, provider, "
            "auth_verified, auth_reason, auth_agent_id, auth_provider_npi, "
            "auth_delegation_id, auth_scope, auth_verified_at "
            "FROM voice_sessions WHERE session_id = %s",
            (session_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        state = dict(row)
        state["authorization"] = _authorization_from_row(state)
        return state
    finally:
        conn.close()


def list_voice_sessions(
    org_id: Optional[str] = None,
    limit: int = 100,
    escalated_only: bool = False,
    undisclosed_only: bool = False,
    oldest_first: bool = False,
) -> list:
    """
    Return voice_sessions rows within the requested constraints.

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
    oldest_first : bool
        When True, order by created_at ASC so that sessions nearest their
        TTL expiry are returned first and the LIMIT does not exclude them.
        When False (default), order by created_at DESC (newest first).
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
    order = "ASC" if oldest_first else "DESC"
    params.append(limit)
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                f"""
                SELECT session_id, org_id, disclosure_confirmed, escalated, created_at, provider,
                       auth_verified, auth_reason, auth_agent_id, auth_provider_npi
                FROM voice_sessions
                {where}
                ORDER BY created_at {order}
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


def purge_old_sessions(default_ttl_hours: int = 24) -> int:
    """
    Delete voice_sessions rows using per-org TTL where configured, falling
    back to *default_ttl_hours* for orgs that have not set a custom policy.

    Two DELETE statements are issued inside one transaction:
      1. Orgs with a non-null ``voice_session_ttl_hours`` — uses the org's
         own value via ``make_interval(hours => o.voice_session_ttl_hours)``.
      2. Orgs with ``voice_session_ttl_hours IS NULL`` — uses *default_ttl_hours*.

    Uses the ``idx_vs_created_at`` index so both DELETEs are efficient even on
    large tables.  Returns the total number of rows deleted.

    This function opens and closes its own connection and is safe to call
    from any thread or asyncio task without holding any application lock.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            # 1. Orgs with a custom TTL
            cur.execute(
                """
                DELETE FROM voice_sessions vs
                USING orgs o
                WHERE vs.org_id = o.org_id
                  AND o.voice_session_ttl_hours IS NOT NULL
                  AND vs.created_at < NOW() - make_interval(hours => o.voice_session_ttl_hours)
                """
            )
            deleted_custom = cur.rowcount
            # 2. Orgs using the server-wide default TTL
            cur.execute(
                """
                DELETE FROM voice_sessions vs
                USING orgs o
                WHERE vs.org_id = o.org_id
                  AND o.voice_session_ttl_hours IS NULL
                  AND vs.created_at < NOW() - make_interval(hours => %s)
                """,
                (default_ttl_hours,),
            )
            deleted_default = cur.rowcount
            deleted = deleted_custom + deleted_default
    finally:
        conn.close()
    if deleted:
        logger.info(
            "voice_sessions purge: removed %d rows (default_ttl=%dh, custom=%d, default=%d)",
            deleted, default_ttl_hours, deleted_custom, deleted_default,
        )
    return deleted
