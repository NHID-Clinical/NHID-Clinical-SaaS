"""Enterprise single sign-on: OpenID Connect, authorization code flow with PKCE.

Schema and rationale: migrations/0009_org_sso.sql.

The flow:
  1. `start(org_id, return_to)` stores a fresh state, nonce and PKCE verifier
     and returns the provider's authorization URL.
  2. The person signs in at their provider, which redirects back with a code.
  3. `finish(state, code)` consumes the state (once, atomically, unexpired),
     exchanges the code with the verifier, verifies the id_token, and returns
     the verified email. The caller provisions membership and the session.

Every check in `_verify_id_token` is a property an attacker could otherwise
vary: the signature algorithm (allowlist, checked before any key is used), the
signature, issuer, audience, expiry, nonce, a verified email, and the email's
domain. A failure raises `SSOError` with a short code, and the HTTP layer maps
that to a redirect carrying only the code, never the reason in detail.

Network calls (the token request, the signing keys) go through two small
functions so the tests can stand in for the identity provider there and
nowhere else.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

import jwt
from cryptography.fernet import Fernet, InvalidToken

from saas_layer.db import get_conn
from saas_layer.oauth_exchange import (
    ALLOWED_ALGORITHMS, IssuerConfigError, _reject_unsafe_url,
)

STATE_TTL_SECONDS = 10 * 60
SSO_ROLES = ("member", "auditor")


class SSOError(Exception):
    """A sign-in that must not complete. `code` is safe to show; nothing else is."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


# ── Secrets at rest ────────────────────────────────────────────────────────

def _fernet() -> Fernet:
    secret = os.environ.get("HMAC_SECRET", "")
    if not secret:
        raise RuntimeError("HMAC_SECRET is required to store an SSO client secret")
    digest = hashlib.sha256(b"nhid-sso-client-secret:" + secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:  # the key changed since it was stored
        raise SSOError("client_secret_unreadable") from exc


# ── Network boundary (replaced in tests) ───────────────────────────────────

def _post_token_request(token_endpoint: str, form: Dict[str, str]) -> Dict[str, Any]:
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(token_endpoint, data=data, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded",
                                          "Accept": "application/json"})
    # https only, SSRF-screened when the endpoint was configured.
    with urllib.request.urlopen(req, timeout=10) as resp:  # nosec B310
        return json.loads(resp.read())


_jwks_cache: Dict[str, Any] = {}


def _jwks_client(jwks_uri: str):
    client = _jwks_cache.get(jwks_uri)
    if client is None:
        client = jwt.PyJWKClient(jwks_uri, cache_jwk_set=True, lifespan=300, timeout=10)
        _jwks_cache[jwks_uri] = client
    return client


# ── Configuration ──────────────────────────────────────────────────────────

def configure(org_id: str, *, issuer: str, client_id: str, client_secret: Optional[str],
              authorization_endpoint: str, token_endpoint: str, jwks_uri: str,
              allowed_domains: List[str], default_role: str, updated_by: str) -> Dict[str, Any]:
    issuer = (issuer or "").strip().rstrip("/")
    for field, url in (("issuer", issuer), ("authorization_endpoint", authorization_endpoint),
                       ("token_endpoint", token_endpoint), ("jwks_uri", jwks_uri)):
        _reject_unsafe_url((url or "").strip(), field=field)
    if not (client_id or "").strip():
        raise IssuerConfigError("client_id is required")
    domains = sorted({d.strip().lower().lstrip("@") for d in (allowed_domains or []) if d.strip()})
    if not domains:
        raise IssuerConfigError("allowed_domains must name at least one email domain")
    if any("." not in d or "/" in d or " " in d for d in domains):
        raise IssuerConfigError("allowed_domains must be plain domains, e.g. example.org")
    if default_role not in SSO_ROLES:
        raise IssuerConfigError(f"default_role must be one of {list(SSO_ROLES)}")
    secret_enc = _encrypt(client_secret) if client_secret else None
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                """INSERT INTO org_sso (org_id, issuer, client_id, client_secret_enc,
                       authorization_endpoint, token_endpoint, jwks_uri, allowed_domains,
                       default_role, updated_at, updated_by)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),%s)
                   ON CONFLICT (org_id) DO UPDATE SET
                       issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id,
                       client_secret_enc = COALESCE(EXCLUDED.client_secret_enc, org_sso.client_secret_enc),
                       authorization_endpoint = EXCLUDED.authorization_endpoint,
                       token_endpoint = EXCLUDED.token_endpoint, jwks_uri = EXCLUDED.jwks_uri,
                       allowed_domains = EXCLUDED.allowed_domains,
                       default_role = EXCLUDED.default_role,
                       updated_at = NOW(), updated_by = EXCLUDED.updated_by""",
                (org_id, issuer, client_id.strip(), secret_enc, authorization_endpoint.strip(),
                 token_endpoint.strip(), jwks_uri.strip(), domains, default_role, updated_by),
            )
    finally:
        conn.close()
    return public_config(org_id)


def _row(org_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM org_sso WHERE org_id = %s", (org_id,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def public_config(org_id: str) -> Optional[Dict[str, Any]]:
    """The configuration without the secret: `has_client_secret` instead."""
    row = _row(org_id)
    if row is None:
        return None
    row["has_client_secret"] = row.pop("client_secret_enc") is not None
    row["allowed_domains"] = list(row["allowed_domains"])
    row["updated_at"] = row["updated_at"].isoformat()
    return row


def org_for_email(email: str) -> str:
    """The one organization whose SSO accepts this email's domain.

    Reveals only whether a domain uses SSO here, which is what every
    "sign in with SSO" page reveals. Two organizations claiming one domain is
    refused rather than guessed between.
    """
    value = (email or "").strip().lower()
    if "@" not in value:
        raise SSOError("sso_not_configured")
    domain = value.rsplit("@", 1)[1]
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT org_id FROM org_sso WHERE %s = ANY(allowed_domains)", (domain,))
        rows = cur.fetchall()
    finally:
        conn.close()
    if not rows:
        raise SSOError("sso_not_configured")
    if len(rows) > 1:
        raise SSOError("sso_ambiguous")
    return rows[0]["org_id"]


def remove(org_id: str) -> bool:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM org_sso WHERE org_id = %s", (org_id,))
            return cur.rowcount == 1
    finally:
        conn.close()


# ── The sign-in flow ───────────────────────────────────────────────────────

def safe_return_path(return_to: Optional[str]) -> str:
    """Only a path on our own app: `/x`, never `//host`, `/\\host` or a URL."""
    value = (return_to or "/dashboard").strip()
    if not value.startswith("/") or value.startswith("//") or value.startswith("/\\") \
            or "\r" in value or "\n" in value:
        raise SSOError("invalid_return_to")
    return value


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def start(org_id: str, return_to: Optional[str], redirect_uri: str) -> str:
    """Store a pending sign-in and return the provider's authorization URL."""
    config = _row(org_id)
    if config is None:
        raise SSOError("sso_not_configured")
    path = safe_return_path(return_to)
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                """INSERT INTO sso_login_states (state_sha256, org_id, nonce, code_verifier,
                       return_to, expires_at)
                   VALUES (%s,%s,%s,%s,%s, NOW() + make_interval(secs => %s))""",
                (_sha256(state), org_id, nonce, verifier, path, STATE_TTL_SECONDS),
            )
    finally:
        conn.close()
    query = urllib.parse.urlencode({
        "response_type": "code", "client_id": config["client_id"], "redirect_uri": redirect_uri,
        "scope": "openid email profile", "state": state, "nonce": nonce,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    sep = "&" if "?" in config["authorization_endpoint"] else "?"
    return f"{config['authorization_endpoint']}{sep}{query}"


def _consume_state(state: str) -> Dict[str, Any]:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """UPDATE sso_login_states SET consumed_at = NOW()
                   WHERE state_sha256 = %s AND consumed_at IS NULL AND expires_at > NOW()
                   RETURNING org_id, nonce, code_verifier, return_to""",
                (_sha256(state or ""),),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if row is None:
        raise SSOError("invalid_state")
    return dict(row)


def _verify_id_token(id_token: str, config: Dict[str, Any], nonce: str) -> str:
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError as exc:
        raise SSOError("invalid_id_token") from exc
    if header.get("alg") not in ALLOWED_ALGORITHMS:
        raise SSOError("invalid_id_token")
    try:
        key = _jwks_client(config["jwks_uri"]).get_signing_key_from_jwt(id_token).key
        claims = jwt.decode(id_token, key, algorithms=list(ALLOWED_ALGORITHMS),
                            audience=config["client_id"], issuer=config["issuer"],
                            options={"require": ["exp", "iat", "iss", "aud", "sub"]}, leeway=30)
    except jwt.PyJWTError as exc:
        raise SSOError("invalid_id_token") from exc
    if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise SSOError("invalid_nonce")
    email = str(claims.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise SSOError("no_email")
    if claims.get("email_verified") is False:
        raise SSOError("email_not_verified")
    if email.rsplit("@", 1)[1] not in set(config["allowed_domains"]):
        raise SSOError("domain_not_allowed")
    return email


def finish(state: str, code: str, redirect_uri: str) -> Dict[str, Any]:
    """Complete a sign-in. Returns {org_id, email, return_to, default_role, issuer}."""
    pending = _consume_state(state)
    config = _row(pending["org_id"])
    if config is None:
        raise SSOError("sso_not_configured")
    if not code:
        raise SSOError("missing_code")
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
            "client_id": config["client_id"], "code_verifier": pending["code_verifier"]}
    if config.get("client_secret_enc"):
        form["client_secret"] = _decrypt(config["client_secret_enc"])
    try:
        tokens = _post_token_request(config["token_endpoint"], form)
    except Exception as exc:  # noqa: BLE001 - any transport or provider error
        raise SSOError("token_exchange_failed") from exc
    id_token = tokens.get("id_token") if isinstance(tokens, dict) else None
    if not id_token:
        raise SSOError("invalid_id_token")
    email = _verify_id_token(id_token, config, pending["nonce"])
    return {"org_id": pending["org_id"], "email": email, "return_to": pending["return_to"],
            "default_role": config["default_role"], "issuer": config["issuer"]}
