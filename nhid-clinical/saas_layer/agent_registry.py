"""
saas_layer/agent_registry.py — Provider signing keys and revocation state.

This is the persistence half of the Agent Registry. It answers two questions
that agent authorization depends on and that nothing else in the SaaS layer
could answer before:

  1. "Which public keys may sign a delegation claiming to act for NPI X,
      on behalf of this organisation?"   -> provider_keys
  2. "Has this agent or this specific delegation been revoked?"
                                          -> agent_revocations

Why revocation lives in Postgres rather than in AgentIdentityManager
--------------------------------------------------------------------
``src/agent_identity.AgentIdentityManager`` tracks revocations in two instance
dicts. That is correct for the reference implementation and for its unit tests,
but it is not a usable control in this deployment: the state is lost on every
restart and is not shared between Uvicorn workers, so revoking an agent on one
worker would leave it authorized on the others. Revocation is checked here,
against the database, before the cryptographic verification is trusted.

The signature verification itself is still the open framework's code. This
module adds no crypto of its own.
"""

import base64
import logging
import uuid
from typing import Any, Dict, List, Optional

from src.agent_identity import NPI_RE
from saas_layer.db import get_conn

logger = logging.getLogger(__name__)

#: Ed25519 raw public keys are exactly 32 bytes.
_ED25519_PUBLIC_KEY_BYTES = 32

SUBJECT_TYPES = ("agent", "delegation")

STATUS_ACTIVE = "active"
STATUS_REVOKED = "revoked"


class RegistryError(ValueError):
    """Raised when a caller supplies an invalid NPI, key, or subject type."""


# ── Schema ────────────────────────────────────────────────────────────────────

def init_agent_registry_tables() -> None:
    """
    Idempotent schema bootstrap, following the same pattern as auth.init_db().
    Safe to call on every startup.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS provider_keys (
                    key_id         TEXT PRIMARY KEY,
                    org_id         TEXT NOT NULL,
                    provider_npi   TEXT NOT NULL,
                    public_key_b64 TEXT NOT NULL,
                    label          TEXT,
                    status         TEXT NOT NULL DEFAULT 'active',
                    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    revoked_at     TIMESTAMPTZ
                )
            """)
            # One org may register the same key for one NPI exactly once.
            cur.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_pk_org_npi_key
                    ON provider_keys (org_id, provider_npi, public_key_b64)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_pk_lookup
                    ON provider_keys (org_id, provider_npi, status)
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS agent_revocations (
                    org_id       TEXT NOT NULL,
                    subject_type TEXT NOT NULL,
                    subject_id   TEXT NOT NULL,
                    reason       TEXT,
                    revoked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (org_id, subject_type, subject_id)
                )
            """)
    finally:
        conn.close()


# ── Validation ────────────────────────────────────────────────────────────────

def validate_npi(provider_npi: str) -> str:
    """Return *provider_npi* unchanged, or raise RegistryError."""
    if not NPI_RE.match(provider_npi or ""):
        raise RegistryError("ERR_INVALID_NPI")
    return provider_npi


def validate_public_key_b64(public_key_b64: str) -> str:
    """
    Return *public_key_b64* unchanged if it decodes to a 32-byte Ed25519 raw
    public key, otherwise raise RegistryError.

    Checking the length here means a typo is rejected at registration time
    rather than surfacing later as an indistinguishable signature failure.
    """
    try:
        raw = base64.b64decode(public_key_b64 or "", validate=True)
    except Exception:
        raise RegistryError("ERR_INVALID_PUBLIC_KEY")
    if len(raw) != _ED25519_PUBLIC_KEY_BYTES:
        raise RegistryError("ERR_INVALID_PUBLIC_KEY")
    return public_key_b64


# ── Provider keys ─────────────────────────────────────────────────────────────

def register_provider_key(
    org_id: str,
    provider_npi: str,
    public_key_b64: str,
    label: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Register an Ed25519 public key as authorised to sign delegations for
    *provider_npi* on behalf of *org_id*.

    Re-registering an existing (org, npi, key) triple reactivates it rather than
    creating a duplicate, so a key revoked in error can be restored without
    inventing a second row.
    """
    validate_npi(provider_npi)
    validate_public_key_b64(public_key_b64)

    key_id = f"pk_{uuid.uuid4().hex}"
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO provider_keys (key_id, org_id, provider_npi, public_key_b64, label, status)
                VALUES (%s, %s, %s, %s, %s, 'active')
                ON CONFLICT (org_id, provider_npi, public_key_b64) DO UPDATE
                    SET status     = 'active',
                        revoked_at = NULL,
                        label      = COALESCE(EXCLUDED.label, provider_keys.label)
                RETURNING key_id, org_id, provider_npi, public_key_b64, label, status, created_at, revoked_at
                """,
                (key_id, org_id, provider_npi, public_key_b64, label),
            )
            return dict(cur.fetchone())
    finally:
        conn.close()


def get_active_provider_keys(org_id: str, provider_npi: str) -> List[str]:
    """
    Return the base64 public keys currently authorised to sign for
    *provider_npi* under *org_id*. Empty list means no key is registered —
    which is a denial, not an error.

    More than one key may be active at once so that a provider can rotate keys
    without a gap in which live calls fail.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT public_key_b64
            FROM provider_keys
            WHERE org_id = %s AND provider_npi = %s AND status = 'active'
            ORDER BY created_at
            """,
            (org_id, provider_npi),
        )
        return [r["public_key_b64"] for r in cur.fetchall()]
    finally:
        conn.close()


def list_provider_keys(
    org_id: str,
    provider_npi: Optional[str] = None,
    include_revoked: bool = False,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    """Return provider key rows for *org_id*, newest first."""
    limit = min(max(1, limit), 500)
    filters = ["org_id = %s"]
    params: List[Any] = [org_id]
    if provider_npi:
        filters.append("provider_npi = %s")
        params.append(provider_npi)
    if not include_revoked:
        filters.append("status = 'active'")
    params.append(limit)
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT key_id, org_id, provider_npi, public_key_b64, label, status, created_at, revoked_at
            FROM provider_keys
            WHERE {' AND '.join(filters)}
            ORDER BY created_at DESC
            LIMIT %s
            """,
            params,
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def revoke_provider_key(org_id: str, key_id: str) -> bool:
    """
    Mark a provider key revoked. Returns True if a row was updated, False if the
    key does not exist, does not belong to *org_id*, or was already revoked.

    Revoking a signing key invalidates every delegation it signed, including
    delegations that have not yet expired.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE provider_keys
                SET status = 'revoked', revoked_at = NOW()
                WHERE org_id = %s AND key_id = %s AND status = 'active'
                """,
                (org_id, key_id),
            )
            return cur.rowcount > 0
    finally:
        conn.close()


# ── Revocation ────────────────────────────────────────────────────────────────

def revoke_subject(
    org_id: str,
    subject_type: str,
    subject_id: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Revoke an agent (all its delegations) or a single delegation.

    *subject_type* must be "agent" or "delegation". Revoking twice is not an
    error; the original revoked_at is preserved so the audit record of when
    access was withdrawn is not silently moved forward.
    """
    if subject_type not in SUBJECT_TYPES:
        raise RegistryError("ERR_INVALID_SUBJECT_TYPE")
    if not subject_id:
        raise RegistryError("ERR_INVALID_SUBJECT_ID")

    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO agent_revocations (org_id, subject_type, subject_id, reason)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (org_id, subject_type, subject_id) DO UPDATE
                    SET reason = COALESCE(EXCLUDED.reason, agent_revocations.reason)
                RETURNING org_id, subject_type, subject_id, reason, revoked_at
                """,
                (org_id, subject_type, subject_id, reason),
            )
            return dict(cur.fetchone())
    finally:
        conn.close()


def is_revoked(
    org_id: str,
    agent_id: Optional[str] = None,
    delegation_id: Optional[str] = None,
) -> Optional[str]:
    """
    Return "agent" or "delegation" naming which revocation matched, or None if
    neither subject is revoked for this org.

    The agent is checked first: revoking an agent is the broader action, and
    reporting it is more useful to an operator than naming one of its
    delegations.
    """
    pairs = []
    if agent_id:
        pairs.append(("agent", agent_id))
    if delegation_id:
        pairs.append(("delegation", delegation_id))
    if not pairs:
        return None

    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT subject_type
            FROM agent_revocations
            WHERE org_id = %s
              AND (subject_type, subject_id) IN %s
            """,
            (org_id, tuple(pairs)),
        )
        found = {r["subject_type"] for r in cur.fetchall()}
    finally:
        conn.close()

    if "agent" in found:
        return "agent"
    if "delegation" in found:
        return "delegation"
    return None


def list_revocations(org_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    """Return revocation rows for *org_id*, most recently revoked first."""
    limit = min(max(1, limit), 500)
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT org_id, subject_type, subject_id, reason, revoked_at
            FROM agent_revocations
            WHERE org_id = %s
            ORDER BY revoked_at DESC
            LIMIT %s
            """,
            (org_id, limit),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
