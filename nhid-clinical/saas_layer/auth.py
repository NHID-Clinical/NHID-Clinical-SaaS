"""
NHID-Clinical SaaS — Multi-tenant auth.
Manages orgs, API keys. Backed by Replit PostgreSQL (persistent).
No changes to NHID core.
"""
import os
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import time as _time

from saas_layer.db import get_conn
from saas_layer.api_keys import (
    generate_key, hash_key, key_prefix,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    """
    Idempotent schema bootstrap. Creates all tables and Postgres append-only
    triggers for audit_traces. Safe to call on every startup.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS orgs (
                    org_id                  TEXT PRIMARY KEY,
                    org_name                TEXT NOT NULL,
                    -- The key itself is never stored. api_key_sha256 is the
                    -- lookup index; api_key_prefix is a non-secret fragment
                    -- kept only so a human can tell two keys apart.
                    -- Uniqueness comes from orgs_api_key_sha256_idx, created
                    -- by migrate_api_keys_to_hashed(), so a fresh database and
                    -- a migrated one end up with identical schema rather than
                    -- a constraint here and an index there.
                    api_key_sha256          TEXT,
                    api_key_prefix          TEXT,
                    plan                    TEXT NOT NULL DEFAULT 'free',
                    status                  TEXT NOT NULL DEFAULT 'active',
                    stripe_customer_id      TEXT,
                    stripe_subscription_id  TEXT,
                    created_at              TEXT NOT NULL,
                    usage_count             INTEGER NOT NULL DEFAULT 0,
                    active                  BOOLEAN NOT NULL DEFAULT TRUE,
                    replit_user_id          TEXT
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS usage_log (
                    id          SERIAL PRIMARY KEY,
                    org_id      TEXT NOT NULL,
                    endpoint    TEXT NOT NULL,
                    method      TEXT NOT NULL DEFAULT 'POST',
                    status_code INTEGER,
                    session_id  TEXT,
                    timestamp   TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS admin_sessions (
                    token      TEXT PRIMARY KEY,
                    expires_at DOUBLE PRECISION NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS processed_events (
                    event_id     TEXT PRIMARY KEY,
                    processed_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS audit_traces (
                    event_id        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
                    session_id      TEXT NOT NULL,
                    org_id          TEXT NOT NULL,
                    seq_num         INTEGER NOT NULL,
                    event_type      TEXT NOT NULL,
                    state_before    TEXT NOT NULL,
                    state_after     TEXT NOT NULL,
                    input_text      TEXT,
                    policy_action   TEXT,
                    reason_code     TEXT,
                    response_text   TEXT,
                    policy_version  TEXT,
                    model_version   TEXT,
                    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    prev_hash       TEXT NOT NULL,
                    event_hash      TEXT NOT NULL,
                    hmac_signature  TEXT NOT NULL,
                    created_at      TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_at_org_seq
                    ON audit_traces (org_id, seq_num)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_at_org_session
                    ON audit_traces (org_id, session_id, seq_num)
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS voice_sessions (
                    session_id           TEXT PRIMARY KEY,
                    org_id               TEXT NOT NULL,
                    disclosure_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
                    escalated            BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    provider             TEXT NOT NULL DEFAULT 'api'
                )
            """)
            cur.execute("""
                ALTER TABLE voice_sessions
                    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'api'
            """)
            # Agent authorization verdict for the session (NHID-Auth v2).
            # auth_verified IS NULL means no passport was ever presented, which
            # is distinct from FALSE (a passport was presented and rejected).
            # The policy engine treats the two differently: NULL defers to the
            # rule's `required` flag, FALSE always denies.
            for column, ddl_type in (
                ("auth_verified", "BOOLEAN"),
                ("auth_reason", "TEXT"),
                ("auth_agent_id", "TEXT"),
                ("auth_provider_npi", "TEXT"),
                ("auth_delegation_id", "TEXT"),
                ("auth_scope", "TEXT"),
                ("auth_verified_at", "TIMESTAMPTZ"),
                # The delegation's own expiry, carried onto the session so that
                # every later turn can re-check it. Without this the expiry is
                # enforced once, at presentation, and a short-lived delegation
                # would keep authorising turns for the whole session TTL.
                ("auth_expires_at", "TIMESTAMPTZ"),
            ):
                cur.execute(
                    f"ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS {column} {ddl_type}"
                )
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_vs_org
                    ON voice_sessions (org_id)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_vs_created_at
                    ON voice_sessions (created_at)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_usage_org
                    ON usage_log (org_id, timestamp)
            """)
            # Append-only trigger function
            cur.execute("""
                CREATE OR REPLACE FUNCTION enforce_audit_append_only()
                RETURNS TRIGGER LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'audit_traces is append-only: % not permitted', TG_OP;
                    RETURN NULL;
                END;
                $$
            """)
            # DROP + CREATE because CREATE TRIGGER IF NOT EXISTS requires PG17+
            cur.execute("DROP TRIGGER IF EXISTS audit_traces_no_update ON audit_traces")
            cur.execute("""
                CREATE TRIGGER audit_traces_no_update
                    BEFORE UPDATE ON audit_traces
                    FOR EACH ROW EXECUTE FUNCTION enforce_audit_append_only()
            """)
            cur.execute("DROP TRIGGER IF EXISTS audit_traces_no_delete ON audit_traces")
            cur.execute("""
                CREATE TRIGGER audit_traces_no_delete
                    BEFORE DELETE ON audit_traces
                    FOR EACH ROW EXECUTE FUNCTION enforce_audit_append_only()
            """)
    finally:
        conn.close()

    # Idempotent column additions for any existing rows missing new columns
    migrate_billing_columns()
    migrate_api_keys_to_hashed()


def migrate_billing_columns() -> None:
    """Add any columns that may be missing from older Postgres schema (idempotent)."""
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            for stmt in [
                "ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT",
                "ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT",
                "ALTER TABLE orgs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'",
                "ALTER TABLE orgs ADD COLUMN IF NOT EXISTS replit_user_id TEXT",
                "ALTER TABLE orgs ADD COLUMN IF NOT EXISTS voice_session_ttl_hours INTEGER",
            ]:
                cur.execute(stmt)
    finally:
        conn.close()


def migrate_api_keys_to_hashed() -> None:
    """Move an existing database off plaintext API keys, once and idempotently.

    Before this, `orgs.api_key` held the live credential in cleartext and
    authentication was a raw equality match on it. Any read of the table --
    a backup, a dump, a logged row, a SELECT through an injection flaw --
    handed over working credentials for every tenant at once.

    The whole thing runs in one transaction, in this order, and the order is
    the point:

      1. add the two new columns,
      2. backfill a hash and a display prefix for every row that lacks one,
      3. *verify* no row was left without a hash,
      4. only then drop the plaintext column.

    A failure at any step rolls back, and because the plaintext is dropped
    last, a rollback cannot lose a key. The alternative -- dropping first and
    backfilling after -- would turn a mid-migration crash into every customer
    locked out permanently.

    Idempotent: on a database that has already migrated, the ALTERs are
    no-ops, there is nothing to backfill, and the plaintext column is gone.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()

            cur.execute(
                "ALTER TABLE orgs ADD COLUMN IF NOT EXISTS api_key_sha256 TEXT"
            )
            cur.execute(
                "ALTER TABLE orgs ADD COLUMN IF NOT EXISTS api_key_prefix TEXT"
            )

            # Does the legacy plaintext column still exist on this database?
            cur.execute(
                """SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'orgs' AND column_name = 'api_key'"""
            )
            has_plaintext = cur.fetchone() is not None

            if has_plaintext:
                # Backfill in Python rather than SQL so this does not depend on
                # pgcrypto or on a particular server's sha256() availability.
                cur.execute(
                    """SELECT org_id, api_key FROM orgs
                       WHERE api_key IS NOT NULL AND api_key_sha256 IS NULL"""
                )
                pending = [(r["org_id"], r["api_key"]) for r in cur.fetchall()]
                for org_id, plaintext in pending:
                    cur.execute(
                        """UPDATE orgs
                           SET api_key_sha256 = %s, api_key_prefix = %s
                           WHERE org_id = %s""",
                        (hash_key(plaintext), key_prefix(plaintext), org_id),
                    )

                # Step 3. Refuse to drop the plaintext while any row would be
                # left unauthenticatable. This is the check that makes the
                # drop below safe rather than merely hopeful.
                cur.execute(
                    """SELECT count(*) AS n FROM orgs
                       WHERE api_key IS NOT NULL AND api_key_sha256 IS NULL"""
                )
                unmigrated = cur.fetchone()["n"]
                if unmigrated:
                    raise RuntimeError(
                        f"API key migration aborted: {unmigrated} org(s) still "
                        "have no hash. Rolling back rather than dropping the "
                        "plaintext column and locking them out."
                    )

                cur.execute("ALTER TABLE orgs DROP COLUMN api_key")

            cur.execute(
                """CREATE UNIQUE INDEX IF NOT EXISTS orgs_api_key_sha256_idx
                   ON orgs (api_key_sha256)"""
            )
    finally:
        conn.close()


def migrate_audit_traces() -> None:
    """No-op: audit_traces schema is managed by init_db(). Kept for call-site compatibility."""
    pass


def create_org(org_name: str, plan: str = "free") -> Dict[str, Any]:
    org_id = str(uuid.uuid4())
    api_key = generate_key()
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO orgs
                   (org_id, org_name, api_key_sha256, api_key_prefix,
                    plan, status, created_at)
                   VALUES (%s, %s, %s, %s, %s, 'active', %s)""",
                (org_id, org_name, hash_key(api_key), key_prefix(api_key),
                 plan, _now()),
            )
    finally:
        conn.close()
    # The only moment the plaintext exists outside the caller's request: it is
    # returned from memory, never read back from the database, because after
    # this function returns nothing can recover it.
    return {"org_id": org_id, "org_name": org_name, "api_key": api_key, "plan": plan}


def validate_api_key(api_key: str) -> Optional[Dict[str, Any]]:
    """Resolve a presented key to its org, or None.

    The presented key is hashed and the hash is what is matched, so the
    database never holds anything replayable. This is still a single indexed
    equality lookup -- the hash *is* the index -- so it costs what the old
    plaintext comparison cost.
    """
    if not api_key:
        return None
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM orgs WHERE api_key_sha256 = %s AND active = TRUE",
            (hash_key(api_key),),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def rotate_api_key(org_id: str) -> Optional[str]:
    """Mint a new key for an org, invalidating the old one. Returns the
    plaintext once, or None if the org does not exist.

    This exists because hashing removes the ability to re-read a lost key.
    Without it, losing a key would mean losing the account.
    """
    api_key = generate_key()
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE orgs
                   SET api_key_sha256 = %s, api_key_prefix = %s
                   WHERE org_id = %s""",
                (hash_key(api_key), key_prefix(api_key), org_id),
            )
            if cur.rowcount == 0:
                return None
    finally:
        conn.close()
    return api_key


def get_org(org_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM orgs WHERE org_id = %s", (org_id,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_orgs() -> list:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM orgs ORDER BY created_at DESC")
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def increment_usage(org_id: str) -> None:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE orgs SET usage_count = usage_count + 1 WHERE org_id = %s",
                (org_id,),
            )
    finally:
        conn.close()


# ── Admin session management ──────────────────────────────────────────────────

def create_admin_session(token: str, expires_at: float) -> None:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO admin_sessions (token, expires_at) VALUES (%s, %s)
                   ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at""",
                (token, expires_at),
            )
    finally:
        conn.close()


def validate_admin_session(token: str) -> bool:
    if not token:
        return False
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT expires_at FROM admin_sessions WHERE token = %s", (token,)
        )
        row = cur.fetchone()
        if row is None:
            return False
        return _time.time() <= row["expires_at"]
    finally:
        conn.close()


def delete_admin_session(token: str) -> None:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM admin_sessions WHERE token = %s", (token,))
    finally:
        conn.close()


def purge_expired_admin_sessions() -> None:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM admin_sessions WHERE expires_at < %s", (_time.time(),)
            )
    finally:
        conn.close()


# ── User ↔ Org linkage ────────────────────────────────────────────────────────

def link_org_to_user(org_id: str, replit_user_id: str) -> bool:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE orgs SET replit_user_id = %s WHERE org_id = %s",
                (replit_user_id, org_id),
            )
            return cur.rowcount > 0
    finally:
        conn.close()


def get_org_by_user(replit_user_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM orgs WHERE replit_user_id = %s AND active = TRUE",
            (replit_user_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()
