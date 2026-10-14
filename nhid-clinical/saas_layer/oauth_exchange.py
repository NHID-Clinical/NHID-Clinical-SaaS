"""
OAuth 2.0 Token Exchange (RFC 8693) — trade an enterprise IdP token for a
scoped, short-lived NHID API token.

The two halves, and why only one needs cryptography
---------------------------------------------------
The token we *receive* is a JWT signed by the customer's identity provider.
Verifying it is real cryptographic work: fetch the issuer's public keys, check
the signature, the audience, the expiry. `verify_subject_token` does that.

The token we *issue* is opaque — random bytes, stored only as a SHA-256 hash,
exactly as `orgs.api_key_sha256` and `user_sessions.session_sha256` already
work. RFC 8693 permits this: the response carries
`issued_token_type: urn:ietf:params:oauth:token-type:access_token`, and
nothing in the RFC requires the issued token to be a JWT. The payoff is that
there is no signing key to hold, rotate, or leak, and revocation is a row
delete rather than a denylist.

The three things this module refuses to do, each a security property
----------------------------------------------------------------------
1. It never trusts an unverified claim as authorization. The unverified `iss`
   and `aud` are read only to *select* a configured issuer row; the token is
   then verified against that row's key, and the verified `iss` must match.

2. It never accepts an issuer nobody configured. No row → no token. There is
   no discovery fallback and no "any valid signature will do".

3. It never lets a verified token resolve to more than one organization. That
   is the DB-enforced UNIQUE (issuer, audience) from migration 0005; this
   module relies on it rather than re-checking in Python.

See migration 0005_oauth_token_exchange.sql for the schema and the longer
rationale.
"""
from __future__ import annotations

import ipaddress
import logging
import secrets
import threading
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

import jwt
from jwt import PyJWKClient

from saas_layer.db import get_conn
from saas_layer.user_auth import _now, _uid, hash_secret

_logger = logging.getLogger("nhid.oauth_exchange")

# ── Constants ─────────────────────────────────────────────────────────────────

#: One hour. Short by design, and it is also UDAP's own ceiling for a B2B
#: access token ("a lifetime no longer than 60 minutes") — convenient to be
#: able to say in a security review. A client re-exchanges when it expires.
EXCHANGED_TOKEN_TTL_SECONDS = 60 * 60

#: Entropy for the opaque token. `token_urlsafe(32)` is 32 random bytes,
#: matching SESSION_ENTROPY_BYTES in user_auth.
TOKEN_ENTROPY_BYTES = 32

#: The ONLY signature algorithms we will verify an IdP token with. This is a
#: hard allowlist, checked against the token's own header BEFORE any key is
#: fetched, and it is what defeats two attacks at once:
#:   * `alg: none` — an unsigned token claiming to need no verification.
#:   * algorithm confusion — a token signed HS256 using the issuer's PUBLIC
#:     RSA/EC key (which we publish via JWKS) as if it were an HMAC secret.
#: Neither `none` nor any HS* algorithm is on this list, so neither is ever
#: passed to `jwt.decode`.
ALLOWED_ALGORITHMS = ("RS256", "ES256")

#: RFC 8693 grant and token-type URNs.
GRANT_TYPE_TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"
SUBJECT_TOKEN_TYPE_JWT = "urn:ietf:params:oauth:token-type:jwt"
ISSUED_TOKEN_TYPE_ACCESS = "urn:ietf:params:oauth:token-type:access_token"


class IssuerConfigError(ValueError):
    """A proposed issuer configuration is unacceptable — bad URL, SSRF risk."""


# ── JWKS client cache ───────────────────────────────────────────────────────
#
# One PyJWKClient per issuer, keyed by issuer_id, so repeated exchanges reuse a
# fetched key set (PyJWKClient caches internally for `lifespan` seconds). The
# cache bounds how stale a *key* may be; it must NOT bound how stale *trust* is,
# so configure_issuer and deactivate_issuer evict their entry. A config change
# then takes effect on the next request, not after the lifespan elapses.

_jwks_clients: Dict[str, PyJWKClient] = {}
_jwks_lock = threading.Lock()


def _jwks_client_for(issuer_id: str, jwks_uri: str) -> PyJWKClient:
    with _jwks_lock:
        client = _jwks_clients.get(issuer_id)
        if client is None:
            client = PyJWKClient(
                jwks_uri, cache_jwk_set=True, lifespan=300, timeout=10
            )
            _jwks_clients[issuer_id] = client
        return client


def _evict_jwks_client(issuer_id: str) -> None:
    with _jwks_lock:
        _jwks_clients.pop(issuer_id, None)


# ── SSRF guard ────────────────────────────────────────────────────────────────

def _reject_unsafe_url(url: str, *, field: str) -> None:
    """Refuse a URL that is not https, or that points somewhere a server-side
    fetch should never go.

    This guards `jwks_uri`, which the server fetches. It does NOT defend
    against DNS rebinding — a hostname that resolves safely now and to
    127.0.0.1 at fetch time — which is out of scope here and stated so plainly.
    What it does catch is the configuration that is unsafe on its face: a
    non-https scheme, or a host that is a private, loopback or link-local IP
    literal.
    """
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise IssuerConfigError(f"{field} must be an https URL")
    host = parts.hostname
    if not host:
        raise IssuerConfigError(f"{field} has no host")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        # A hostname, not an IP literal. Accepted — see the DNS-rebinding note.
        return
    if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved:
        raise IssuerConfigError(
            f"{field} must not point at a private, loopback or link-local address"
        )


# ── Issuer configuration ────────────────────────────────────────────────────

def configure_issuer(
    org_id: str,
    issuer: str,
    jwks_uri: str,
    audience: str,
    *,
    actor_user_id: str,
    subject_claim: str = "sub",
) -> Dict[str, Any]:
    """Register an IdP this org will accept subject tokens from.

    Validates before it writes. `issuer` and `jwks_uri` must both be https,
    and `jwks_uri` is additionally SSRF-screened. The write and its audit row
    happen in one transaction, and the JWKS client cache entry is evicted so a
    re-point takes effect immediately.
    """
    issuer = (issuer or "").strip()
    jwks_uri = (jwks_uri or "").strip()
    audience = (audience or "").strip()
    if not issuer or not audience:
        raise IssuerConfigError("issuer and audience are required")
    if urlsplit(issuer).scheme != "https":
        raise IssuerConfigError("issuer must be an https URL")
    _reject_unsafe_url(jwks_uri, field="jwks_uri")

    issuer_id = _uid("iss")
    now = _now()
    after = {
        "issuer_id": issuer_id, "org_id": org_id, "issuer": issuer,
        "jwks_uri": jwks_uri, "audience": audience,
        "subject_claim": subject_claim, "active": True,
    }
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO oauth_issuers
                       (issuer_id, org_id, issuer, jwks_uri, audience,
                        subject_claim, active, created_at, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, TRUE, %s, %s)""",
                (issuer_id, org_id, issuer, jwks_uri, audience,
                 subject_claim, now, actor_user_id),
            )
            _write_audit(cur, org_id, issuer_id, "configured",
                         actor_user_id, None, after, now)
    finally:
        conn.close()

    _evict_jwks_client(issuer_id)
    _logger.info("OAUTH: issuer configured org=%s issuer_id=%s by user=%s",
                 org_id, issuer_id, actor_user_id)
    return after


def list_issuers(org_id: str) -> List[Dict[str, Any]]:
    """Every issuer row for an org, active or not. No secrets to redact —
    there are none in this table."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM oauth_issuers WHERE org_id = %s ORDER BY created_at",
            (org_id,),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def deactivate_issuer(org_id: str, issuer_id: str, *, actor_user_id: str) -> bool:
    """Turn an issuer off and revoke every token minted through it.

    Deactivation is immediate in both senses: the row flips `active = FALSE`
    so no new token can be minted, its outstanding tokens are deleted so none
    keeps resolving, and the JWKS cache entry is evicted so the next request
    re-reads trust. Scoped to the org so one org cannot touch another's issuer.
    """
    now = _now()
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM oauth_issuers WHERE issuer_id = %s AND org_id = %s",
                (issuer_id, org_id),
            )
            before = cur.fetchone()
            if before is None:
                return False
            before = dict(before)
            cur.execute(
                "UPDATE oauth_issuers SET active = FALSE WHERE issuer_id = %s",
                (issuer_id,),
            )
            cur.execute(
                "DELETE FROM oauth_tokens WHERE issuer_id = %s", (issuer_id,)
            )
            after = {**before, "active": False}
            _write_audit(cur, org_id, issuer_id, "deactivated",
                         actor_user_id, before, after, now)
    finally:
        conn.close()

    _evict_jwks_client(issuer_id)
    _logger.info("OAUTH: issuer deactivated org=%s issuer_id=%s by user=%s",
                 org_id, issuer_id, actor_user_id)
    return True


def _write_audit(cur, org_id, issuer_id, action, actor_user_id,
                 before, after, at) -> None:
    import json
    cur.execute(
        """INSERT INTO oauth_issuer_audit
               (audit_id, org_id, issuer_id, action, actor_user_id,
                before, after, at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (_uid("oaud"), org_id, issuer_id, action, actor_user_id,
         json.dumps(before) if before is not None else None,
         json.dumps(after) if after is not None else None, at),
    )


# ── Subject-token verification ────────────────────────────────────────────────

def verify_subject_token(raw_token: str) -> Optional[Dict[str, Any]]:
    """Verify an IdP JWT and return {org_id, issuer_id, subject}, or None.

    The order is the whole security argument:

      1. Read the token's own header and reject unless `alg` is on the hard
         allowlist — BEFORE any key is fetched. `alg: none` and the HS256
         public-key-confusion attack die here.
      2. Read the UNVERIFIED `iss`/`aud` only as a lookup key into the
         configured, active issuer rows. No row → None. These claims authorize
         nothing; they only choose which row we will try to verify against.
      3. Verify the signature against that row's JWKS key, with the algorithm
         allowlist, the row's audience and issuer, a small leeway, and the
         standard claims required. The verified `iss` must equal the row's.
      4. Return identity from the VERIFIED payload.

    Any failure returns None — one outcome, so a caller cannot distinguish
    "unconfigured issuer" from "bad signature" from "expired", which is what
    keeps the endpoint's error responses uniform.
    """
    if not raw_token:
        return None
    try:
        header = jwt.get_unverified_header(raw_token)
    except jwt.PyJWTError:
        return None
    if header.get("alg") not in ALLOWED_ALGORITHMS:
        return None

    try:
        unverified = jwt.decode(raw_token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return None
    claimed_iss = unverified.get("iss")
    claimed_aud = unverified.get("aud")
    if not claimed_iss or not claimed_aud:
        return None
    # `aud` may be a list in a JWT; the lookup needs a single string. Only a
    # scalar audience is supported, by design — a per-org audience is one value.
    if not isinstance(claimed_iss, str) or not isinstance(claimed_aud, str):
        return None

    row = _active_issuer_by_iss_aud(claimed_iss, claimed_aud)
    if row is None:
        return None

    try:
        signing_key = _jwks_client_for(
            row["issuer_id"], row["jwks_uri"]
        ).get_signing_key_from_jwt(raw_token)
        claims = jwt.decode(
            raw_token,
            signing_key.key,
            algorithms=list(ALLOWED_ALGORITHMS),
            audience=row["audience"],
            issuer=row["issuer"],
            leeway=30,
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
    except jwt.PyJWTError:
        return None
    except Exception as exc:  # JWKS fetch failure, network, malformed key set
        _logger.warning("OAUTH: subject-token verification error issuer_id=%s: %s",
                        row["issuer_id"], exc)
        return None

    subject = claims.get(row["subject_claim"])
    if not subject:
        return None
    return {
        "org_id": row["org_id"],
        "issuer_id": row["issuer_id"],
        "subject": str(subject),
    }


def _active_issuer_by_iss_aud(issuer: str, audience: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT * FROM oauth_issuers
                WHERE issuer = %s AND audience = %s AND active = TRUE""",
            (issuer, audience),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ── Issued-token lifecycle ────────────────────────────────────────────────────

def issue_token(org_id: str, issuer_id: str, subject: str) -> str:
    """Mint an opaque Bearer token for the org. Returns the raw token — the
    only copy; the database holds only its hash."""
    raw = secrets.token_urlsafe(TOKEN_ENTROPY_BYTES)
    now = _now()
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                """INSERT INTO oauth_tokens
                       (token_sha256, org_id, issuer_id, subject,
                        expires_at, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (hash_secret(raw), org_id, issuer_id, subject,
                 now + EXCHANGED_TOKEN_TTL_SECONDS, now),
            )
    finally:
        conn.close()
    return raw


def resolve_token(raw_token: str) -> Optional[Dict[str, Any]]:
    """Resolve a live Bearer token to its org, or None.

    Expiry is enforced in the SQL (`expires_at > now`), not by a Python check a
    later edit could drop. One indexed lookup on the hash, exactly as
    validate_api_key does for the static key.
    """
    if not raw_token:
        return None
    conn = get_conn()
    try:
        cur = conn.cursor()
        # `o.*` only, so this returns exactly the shape validate_api_key
        # returns for the X-API-Key path. get_current_org must not be able to
        # tell which credential resolved the org, or a downstream route could
        # come to depend on a field only one path supplies.
        cur.execute(
            """SELECT o.*
                 FROM oauth_tokens t
                 JOIN orgs o ON o.org_id = t.org_id
                WHERE t.token_sha256 = %s AND t.expires_at > %s
                  AND o.active = TRUE""",
            (hash_secret(raw_token), _now()),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def revoke_tokens_for_org(org_id: str) -> int:
    """Delete every exchanged token for an org. Returns the count removed."""
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM oauth_tokens WHERE org_id = %s", (org_id,))
            return cur.rowcount
    finally:
        conn.close()


def purge_expired_tokens() -> int:
    """Delete tokens past their expiry. Returns the count removed. Expiry is
    already enforced at resolve time; this just keeps the table from growing."""
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM oauth_tokens WHERE expires_at <= %s", (_now(),))
            return cur.rowcount
    finally:
        conn.close()
