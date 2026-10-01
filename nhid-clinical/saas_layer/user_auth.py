"""
user_auth.py — human identity, alongside the organization's API key.

Why this exists
---------------
Before this module the product had one credential per organization: an API key
in ``localStorage``, shared by everyone on a compliance team. `review_events`
recorded a `reviewer` string the client supplied, defaulting to the literal
``"unknown"``. So a tool built to answer *who did this, under whose authority*
could not answer it about its own users, which is the first question an auditor
asks of an audit trail.

Two credentials now, for two different callers:

    machine   org API key         ingest pipelines, scripts, CI
    human     magic-link session  people opening /ops in a browser

Both resolve to an ``org_id``, and every org-scoped query keeps taking that
``org_id`` from the resolved credential, never from a request body. The session
adds a *user*, which is what attribution needs.

Why magic links and not passwords
---------------------------------
A password is a stored secret to protect, a reset flow to build, a strength
policy to argue about, and a reuse liability the product inherits from every
other site the person has an account on. A link to a verified mailbox proves
the same thing — control of that address — and the mailbox is a credential the
user is already maintaining.

What is hashed
--------------
Both the link token and the session id are 256-bit random values, stored as
SHA-256 (see ``api_keys.py`` for why a single fast hash is correct for a
high-entropy secret and a slow KDF is not). The raw token exists only in the
email; the raw session id only in the cookie. A database dump yields hashes.

What this deliberately does not do
----------------------------------
No passwords, no SSO or SAML, no roles beyond owner/member, no per-user API
keys. Each of those is a real thing a customer may eventually need and none of
them is needed to put a name on a review action.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time as _time
import uuid
from typing import Any, Dict, List, Optional

from saas_layer.db import get_conn

_logger = logging.getLogger("nhid.saas.user_auth")

# 15 minutes. Long enough to walk to another device and open the mail; short
# enough that a link sitting in a mailbox backup is not a standing key.
LOGIN_TOKEN_TTL_SECONDS = 15 * 60

# 7 days. A browser session for a tool someone uses during a working week.
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

TOKEN_ENTROPY_BYTES = 32
SESSION_ENTROPY_BYTES = 32

ROLE_OWNER = "owner"
ROLE_MEMBER = "member"
ROLES = (ROLE_OWNER, ROLE_MEMBER)

# Throttling. Mirrors ADMIN_LOGIN_* in auth.py, on its own table so that an
# attacker hammering the customer sign-in cannot lock the operator out of
# /admin, or the reverse.
LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_LOCKOUT_SECONDS = 15 * 60


# ── Small helpers ─────────────────────────────────────────────────────────────

def _now() -> float:
    return _time.time()


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def normalize_email(email: str) -> str:
    """Trim and lower-case. The stored spelling is preserved separately.

    Nothing cleverer: stripping dots or ``+tag`` suffixes is a provider-specific
    guess that silently merges two addresses their owner considers distinct.
    """
    return (email or "").strip().lower()


def looks_like_email(email: str) -> bool:
    """A deliberately shallow check.

    Whether an address is deliverable is settled by delivering to it, which is
    exactly what this flow does. A stricter regex here rejects valid addresses
    and proves nothing about the ones it lets through.
    """
    value = normalize_email(email)
    if not value or len(value) > 254 or " " in value:
        return False
    local, _, domain = value.partition("@")
    return bool(local) and bool(domain) and "." in domain


def hash_secret(raw: str) -> str:
    """SHA-256 hex, as stored and looked up for both tokens and sessions."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ── Users ─────────────────────────────────────────────────────────────────────

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    value = normalize_email(email)
    if not value:
        return None
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM users WHERE lower(email) = %s", (value,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM users WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_user(email: str) -> Dict[str, Any]:
    """Create a user, or return the existing one for that address.

    Idempotent by design: an invite sent twice, or to someone who already
    belongs to another organization, must not fail or fork the identity.
    """
    existing = get_user_by_email(email)
    if existing:
        return existing

    user_id = _uid("usr")
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO users (user_id, email, created_at)
                   VALUES (%s, %s, %s)
                   ON CONFLICT DO NOTHING""",
                (user_id, (email or "").strip(), _now()),
            )
    finally:
        conn.close()
    # Re-read rather than trusting the insert: ON CONFLICT DO NOTHING means a
    # concurrent request may have won, and that request's user_id is the real
    # one.
    created = get_user_by_email(email)
    if created is None:
        raise RuntimeError("user creation did not persist")
    return created


def touch_user(user_id: str) -> None:
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                "UPDATE users SET last_seen_at = %s WHERE user_id = %s",
                (_now(), user_id),
            )
    finally:
        conn.close()


# ── Membership ────────────────────────────────────────────────────────────────

def add_member(org_id: str, user_id: str, role: str = ROLE_MEMBER) -> None:
    if role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}")
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                """INSERT INTO org_members (org_id, user_id, role, created_at)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (org_id, user_id) DO NOTHING""",
                (org_id, user_id, role, _now()),
            )
    finally:
        conn.close()


def remove_member(org_id: str, user_id: str) -> bool:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM org_members WHERE org_id = %s AND user_id = %s",
                (org_id, user_id),
            )
            return cur.rowcount > 0
    finally:
        conn.close()


def get_membership(org_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM org_members WHERE org_id = %s AND user_id = %s",
            (org_id, user_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_members(org_id: str) -> List[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT m.user_id, m.role, m.created_at, u.email, u.last_seen_at
                 FROM org_members m
                 JOIN users u ON u.user_id = m.user_id
                WHERE m.org_id = %s
             ORDER BY m.created_at""",
            (org_id,),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def orgs_for_user(user_id: str) -> List[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT o.org_id, o.org_name, o.plan, o.status, m.role
                 FROM org_members m
                 JOIN orgs o ON o.org_id = m.org_id
                WHERE m.user_id = %s
             ORDER BY o.org_name""",
            (user_id,),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def count_owners(org_id: str) -> int:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = %s AND role = %s",
            (org_id, ROLE_OWNER),
        )
        return int(cur.fetchone()["n"])
    finally:
        conn.close()


# ── Sign-in tokens ────────────────────────────────────────────────────────────

def issue_login_token(user_id: str, requested_ip: Optional[str] = None) -> str:
    """Mint a single-use link token. Returns the raw value — the only copy."""
    raw = secrets.token_urlsafe(TOKEN_ENTROPY_BYTES)
    now = _now()
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                """INSERT INTO login_tokens
                       (token_sha256, user_id, expires_at, requested_ip, created_at)
                   VALUES (%s, %s, %s, %s, %s)""",
                (hash_secret(raw), user_id, now + LOGIN_TOKEN_TTL_SECONDS,
                 requested_ip, now),
            )
    finally:
        conn.close()
    return raw


def consume_login_token(raw_token: str) -> Optional[str]:
    """Redeem a token exactly once. Returns the user_id, or None.

    The UPDATE is the guard, not a preceding SELECT: two requests arriving with
    the same token both match the row, but only one satisfies
    ``consumed_at IS NULL`` and gets a row back. Checking first and writing
    second would let both through.
    """
    if not raw_token:
        return None
    now = _now()
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE login_tokens
                      SET consumed_at = %s
                    WHERE token_sha256 = %s
                      AND consumed_at IS NULL
                      AND expires_at > %s
                RETURNING user_id""",
                (now, hash_secret(raw_token), now),
            )
            row = cur.fetchone()
            return row["user_id"] if row else None
    finally:
        conn.close()


def purge_expired_login_tokens(retain_seconds: int = 7 * 24 * 60 * 60) -> int:
    """Drop tokens well past expiry.

    Consumed and expired rows are kept for a week rather than deleted on use:
    a replayed link should be distinguishable from one that never existed when
    someone is investigating a suspected mailbox compromise.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM login_tokens WHERE expires_at < %s",
                        (_now() - retain_seconds,))
            return cur.rowcount
    finally:
        conn.close()


# ── Sessions ──────────────────────────────────────────────────────────────────

def create_session(user_id: str) -> str:
    """Start a browser session. Returns the raw id — the only copy."""
    raw = secrets.token_urlsafe(SESSION_ENTROPY_BYTES)
    now = _now()
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                """INSERT INTO user_sessions
                       (session_sha256, user_id, expires_at, created_at)
                   VALUES (%s, %s, %s, %s)""",
                (hash_secret(raw), user_id, now + SESSION_TTL_SECONDS, now),
            )
    finally:
        conn.close()
    return raw


def resolve_session(raw_session: str) -> Optional[Dict[str, Any]]:
    """Return the user for a live session, or None."""
    if not raw_session:
        return None
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT u.*
                 FROM user_sessions s
                 JOIN users u ON u.user_id = s.user_id
                WHERE s.session_sha256 = %s AND s.expires_at > %s""",
            (hash_secret(raw_session), _now()),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def delete_session(raw_session: str) -> None:
    if not raw_session:
        return
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                "DELETE FROM user_sessions WHERE session_sha256 = %s",
                (hash_secret(raw_session),),
            )
    finally:
        conn.close()


def delete_sessions_for_user(user_id: str) -> int:
    """Sign a user out everywhere. Used when their membership is revoked."""
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM user_sessions WHERE user_id = %s", (user_id,))
            return cur.rowcount
    finally:
        conn.close()


def purge_expired_sessions() -> int:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM user_sessions WHERE expires_at < %s", (_now(),))
            return cur.rowcount
    finally:
        conn.close()


# ── Throttling ────────────────────────────────────────────────────────────────
#
# Same shape as auth.py's admin throttle, and the same honest limits: it is
# keyed on what the request presents, so a caller spread across many source
# addresses gets the full allowance from each. Its job is to stop one address
# being mailed a hundred links, not to stop a distributed attacker.

def throttle_locked_until(key: str) -> Optional[float]:
    if not key:
        return None
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT locked_until FROM login_throttle WHERE throttle_key = %s",
                    (key,))
        row = cur.fetchone()
        if row is None or row["locked_until"] is None:
            return None
        return row["locked_until"] if row["locked_until"] > _now() else None
    finally:
        conn.close()


def record_attempt(key: str) -> Optional[float]:
    """Count one attempt against `key`; return the lock expiry if it locks.

    One statement rather than read-then-write, so simultaneous requests cannot
    both observe the pre-increment count and each conclude they are under the
    threshold.
    """
    if not key:
        return None
    now = _now()
    params = {
        "key": key,
        "now": now,
        "window_start": now - LOGIN_WINDOW_SECONDS,
        "threshold": LOGIN_MAX_FAILURES,
        "locked_until": now + LOGIN_LOCKOUT_SECONDS,
    }
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO login_throttle
                       (throttle_key, failed_count, window_start, locked_until)
                VALUES (%(key)s, 1, %(now)s, NULL)
                ON CONFLICT (throttle_key) DO UPDATE SET
                    failed_count = CASE
                        WHEN login_throttle.window_start < %(window_start)s THEN 1
                        ELSE login_throttle.failed_count + 1
                    END,
                    window_start = CASE
                        WHEN login_throttle.window_start < %(window_start)s
                        THEN %(now)s
                        ELSE login_throttle.window_start
                    END,
                    locked_until = CASE
                        WHEN login_throttle.window_start >= %(window_start)s
                         AND login_throttle.failed_count + 1 >= %(threshold)s
                        THEN %(locked_until)s
                        ELSE NULL
                    END
                RETURNING failed_count, locked_until
                """,
                params,
            )
            row = cur.fetchone()
            return row["locked_until"] if row else None
    finally:
        conn.close()


def clear_attempts(key: str) -> None:
    if not key:
        return
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                "DELETE FROM login_throttle WHERE throttle_key = %s", (key,))
    finally:
        conn.close()


def purge_stale_attempts() -> None:
    now = _now()
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                """DELETE FROM login_throttle
                    WHERE window_start < %s
                      AND (locked_until IS NULL OR locked_until < %s)""",
                (now - LOGIN_WINDOW_SECONDS, now),
            )
    finally:
        conn.close()


# ── The flow ──────────────────────────────────────────────────────────────────

def request_login_link(email: str, *, base_url: str,
                       requested_ip: Optional[str] = None) -> Optional[str]:
    """Issue a link for an existing user. Returns the URL, or None.

    Returns None — silently — when the address belongs to nobody, or to
    somebody who is not a member of any organization. The caller responds 202
    either way. Signing up is by invitation from an organization; an endpoint
    that created an account for any address posted to it would let a stranger
    fill the users table and would leak, through its own response, which
    addresses already exist.
    """
    user = get_user_by_email(email)
    if user is None:
        return None
    if not orgs_for_user(user["user_id"]):
        return None

    raw = issue_login_token(user["user_id"], requested_ip=requested_ip)
    return login_url(base_url, raw)


def login_url(base_url: str, raw_token: str) -> str:
    from urllib.parse import quote

    return f"{base_url.rstrip('/')}/auth/verify?token={quote(raw_token, safe='')}"


def verify_and_start_session(raw_token: str) -> Optional[Dict[str, Any]]:
    """Redeem a link and open a session. Returns ``{session, user, orgs}``."""
    user_id = consume_login_token(raw_token)
    if user_id is None:
        return None
    user = get_user(user_id)
    if user is None:
        return None
    touch_user(user_id)
    return {
        "session": create_session(user_id),
        "user": user,
        "orgs": orgs_for_user(user_id),
    }


def tokens_match(presented: str, expected: str) -> bool:
    """Constant-time comparison, for the few places a raw value is compared."""
    return hmac.compare_digest(presented or "", expected or "")
