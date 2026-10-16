"""
OAuth 2.0 Token Exchange — the verifier, and the attacks it must refuse.

This endpoint takes a JWT from a customer's identity provider and hands back a
token that authenticates as that customer's organization. So the tests that
matter are not "does a valid token work". They are the ways a forged or
confused token could be made to resolve to an org it has no right to, each
written to fail against the verifier exactly as it ships:

  * a token signed by a key the issuer never published;
  * an issuer nobody configured (no discovery fallback);
  * a token valid for org A used against org B (cross-tenant);
  * `alg: none`, and the HS256/public-key confusion attack;
  * wrong audience, expired, not-yet-valid, missing subject;
  * the SSRF surface on the one URL the server fetches (JWKS);
  * a lockout that concurrency cannot slip under.

Every signing key here is generated in-process. No network, no real IdP, no
secret on disk — the only `HMAC_SECRET` is the throwaway the suite already
requires.

Requires the same environment as the rest of the suite: DATABASE_URL, HMAC_SECRET.
"""
from __future__ import annotations

import os
import sys
import time
import uuid

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402

from saas_layer import oauth_exchange, user_auth  # noqa: E402
from saas_layer.auth import create_org  # noqa: E402
from saas_layer.db import get_conn  # noqa: E402
from saas_layer.gateway import app, get_current_org  # noqa: E402

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"
)

TOKEN_URL = "/saas/auth/token"
GRANT = oauth_exchange.GRANT_TYPE_TOKEN_EXCHANGE
STT = oauth_exchange.SUBJECT_TOKEN_TYPE_JWT


# ── Key + issuer scaffolding ──────────────────────────────────────────────────

class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJWKS:
    """Stands in for PyJWKClient: returns our in-process public key instead of
    fetching the issuer's. The SSRF guard would block a localhost jwks_uri
    anyway, so a real fetch is neither possible nor wanted here."""
    def __init__(self, public_key):
        self._public = public_key

    def get_signing_key_from_jwt(self, token):
        return _FakeSigningKey(self._public)


@pytest.fixture
def rsa_keys():
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    pub_pem = priv.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return {"private_pem": priv_pem, "public_pem": pub_pem,
            "public_key": priv.public_key()}


@pytest.fixture(autouse=True)
def _no_real_jwks(monkeypatch, rsa_keys):
    """Every issuer's JWKS client returns the test public key. Autouse so no
    test can accidentally reach the network."""
    monkeypatch.setattr(
        oauth_exchange, "_jwks_client_for",
        lambda issuer_id, jwks_uri: _FakeJWKS(rsa_keys["public_key"]),
    )


@pytest.fixture(autouse=True)
def _clear_oauth_throttle():
    """TestClient presents one constant peer IP, so a failed exchange in one
    test would charge the `oauth-ip:testclient` bucket for every later test and
    eventually lock the whole suite out. Clear the oauth throttle keys before
    each test so each starts from a clean lockout state. (The login path's own
    `ip:`/`email:` buckets are untouched.)"""
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                "DELETE FROM login_throttle WHERE throttle_key LIKE %s",
                ("oauth-%",))
    finally:
        conn.close()
    yield


def _hs256_token(secret_bytes, claims):
    """Hand-craft an HS256 JWT. PyJWT's own `encode` refuses to sign HS256 with
    a PEM key — which is the library defending against exactly this attack — so
    an attacker building the confusion token does it manually, and so must the
    test that proves we reject it."""
    import base64
    import hashlib
    import hmac
    import json

    def seg(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=")

    signing_input = seg({"alg": "HS256", "typ": "JWT"}) + b"." + seg(claims)
    sig = hmac.new(secret_bytes, signing_input, hashlib.sha256).digest()
    return (signing_input + b"." + base64.urlsafe_b64encode(sig).rstrip(b"=")).decode()


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=True)


def _org():
    return create_org(f"OAuth Co {uuid.uuid4().hex[:8]}", "free")


def _owner(org):
    user = user_auth.create_user(f"owner-{uuid.uuid4().hex[:10]}@example.org")
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_OWNER)
    return user


def _issuer_for(org, *, actor):
    """Configure a unique issuer/audience for an org and return the row."""
    tag = uuid.uuid4().hex[:10]
    return oauth_exchange.configure_issuer(
        org["org_id"],
        issuer=f"https://idp-{tag}.example.com",
        jwks_uri=f"https://idp-{tag}.example.com/jwks",
        audience=f"nhid-{tag}",
        actor_user_id=actor["user_id"],
    )


def _mint(rsa_keys, issuer_row, *, alg="RS256", key=None, **overrides):
    now = int(time.time())
    claims = {
        "iss": issuer_row["issuer"],
        "aud": issuer_row["audience"],
        "sub": "idp-user-123",
        "iat": now,
        "exp": now + 300,
    }
    claims.update(overrides)
    signing_key = key if key is not None else rsa_keys["private_pem"]
    return jwt.encode(claims, signing_key, algorithm=alg)


def _exchange(client, subject_token, **form):
    body = {"grant_type": GRANT, "subject_token": subject_token,
            "subject_token_type": STT}
    body.update(form)
    return client.post(TOKEN_URL, data=body)


# ── The happy path, so the matrix has a positive anchor ──────────────────────

def test_a_valid_token_exchanges_and_the_bearer_authenticates(client, rsa_keys):
    org = _org()
    issuer = _issuer_for(org, actor=_owner(org))
    r = _exchange(client, _mint(rsa_keys, issuer))
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["token_type"] == "Bearer"
    assert payload["issued_token_type"] == oauth_exchange.ISSUED_TOKEN_TYPE_ACCESS
    assert payload["expires_in"] == oauth_exchange.EXCHANGED_TOKEN_TTL_SECONDS

    # The returned token resolves to exactly this org, through the same
    # dependency every protected route uses.
    resolved = get_current_org(x_api_key=None,
                               authorization=f"Bearer {payload['access_token']}")
    assert resolved["org_id"] == org["org_id"]


def test_the_bearer_works_on_an_existing_protected_route(client, rsa_keys):
    org = _org()
    issuer = _issuer_for(org, actor=_owner(org))
    token = _exchange(client, _mint(rsa_keys, issuer)).json()["access_token"]
    r = client.get("/saas/orgs/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["org_id"] == org["org_id"]


def test_the_static_api_key_still_works_unchanged(client):
    org = _org()
    r = client.get("/saas/orgs/me", headers={"X-API-Key": org["api_key"]})
    assert r.status_code == 200
    assert r.json()["org_id"] == org["org_id"]


def test_a_request_with_both_credentials_is_authenticated_by_the_key(client, rsa_keys):
    """X-API-Key is checked first; a Bearer alongside it is ignored. One
    credential decides, so a stale Bearer cannot override a good key."""
    org_a = _org()
    org_b = _org()
    issuer_b = _issuer_for(org_b, actor=_owner(org_b))
    bearer_b = _exchange(client, _mint(rsa_keys, issuer_b)).json()["access_token"]
    r = client.get("/saas/orgs/me", headers={
        "X-API-Key": org_a["api_key"],
        "Authorization": f"Bearer {bearer_b}",
    })
    assert r.status_code == 200
    assert r.json()["org_id"] == org_a["org_id"]


# ── Forgery and confusion: the verifier must refuse, as it ships ─────────────

def test_a_token_signed_by_a_foreign_key_is_refused(client, rsa_keys):
    org = _org()
    issuer = _issuer_for(org, actor=_owner(org))
    stranger = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    stranger_pem = stranger.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption())
    r = _exchange(client, _mint(rsa_keys, issuer, key=stranger_pem))
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


def test_an_unconfigured_issuer_is_refused_not_discovered(client, rsa_keys):
    # A well-formed, correctly self-signed token — but no issuer row exists.
    now = int(time.time())
    fake = {"issuer": "https://attacker.example.com", "audience": "nhid-x"}
    token = jwt.encode(
        {"iss": fake["issuer"], "aud": fake["audience"], "sub": "x",
         "iat": now, "exp": now + 300},
        rsa_keys["private_pem"], algorithm="RS256")
    r = _exchange(client, token)
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


def test_cross_org_a_token_for_org_a_cannot_mint_for_org_b(client, rsa_keys):
    org_a, org_b = _org(), _org()
    issuer_a = _issuer_for(org_a, actor=_owner(org_a))
    token = _exchange(client, _mint(rsa_keys, issuer_a)).json()["access_token"]
    # The minted token resolves to org A, never org B.
    resolved = get_current_org(x_api_key=None, authorization=f"Bearer {token}")
    assert resolved["org_id"] == org_a["org_id"]
    assert resolved["org_id"] != org_b["org_id"]


def test_two_orgs_cannot_share_one_issuer_audience(client):
    org_a, org_b = _org(), _org()
    tag = uuid.uuid4().hex[:10]
    args = dict(issuer=f"https://idp-{tag}.example.com",
                jwks_uri=f"https://idp-{tag}.example.com/jwks",
                audience=f"nhid-{tag}")
    oauth_exchange.configure_issuer(org_a["org_id"], actor_user_id=_owner(org_a)["user_id"], **args)
    with pytest.raises(Exception) as exc:
        oauth_exchange.configure_issuer(org_b["org_id"], actor_user_id=_owner(org_b)["user_id"], **args)
    assert "unique" in str(exc.value).lower() or "duplicate" in str(exc.value).lower()


def test_alg_none_is_refused(client, rsa_keys):
    org = _org()
    issuer = _issuer_for(org, actor=_owner(org))
    now = int(time.time())
    token = jwt.encode(
        {"iss": issuer["issuer"], "aud": issuer["audience"], "sub": "x",
         "iat": now, "exp": now + 300},
        key="", algorithm="none")
    r = _exchange(client, token)
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


def test_hs256_signed_with_the_public_key_is_refused(client, rsa_keys):
    """The algorithm-confusion attack: sign HS256 using the issuer's PUBLIC
    key (which a real deployment publishes via JWKS) as the HMAC secret. The
    allowlist rejects HS256 at the header, before any key is in play."""
    org = _org()
    issuer = _issuer_for(org, actor=_owner(org))
    now = int(time.time())
    token = _hs256_token(
        rsa_keys["public_pem"],
        {"iss": issuer["issuer"], "aud": issuer["audience"], "sub": "x",
         "iat": now, "exp": now + 300})
    r = _exchange(client, token)
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


@pytest.mark.parametrize("overrides", [
    {"aud": "wrong-audience"},
    {"exp": int(time.time()) - 60},
    {"nbf": int(time.time()) + 3600},
])
def test_claim_failures_are_each_invalid_grant_with_one_body(client, rsa_keys, overrides):
    org = _org()
    issuer = _issuer_for(org, actor=_owner(org))
    r = _exchange(client, _mint(rsa_keys, issuer, **overrides))
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


def test_a_token_missing_its_subject_is_refused(client, rsa_keys):
    org = _org()
    issuer = _issuer_for(org, actor=_owner(org))
    # No `sub`. Required-claim set omits it (subject_claim is configurable), so
    # the explicit subject check after decode is what catches this.
    now = int(time.time())
    token = jwt.encode(
        {"iss": issuer["issuer"], "aud": issuer["audience"],
         "iat": now, "exp": now + 300},
        rsa_keys["private_pem"], algorithm="RS256")
    r = _exchange(client, token)
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


# ── The exchange contract ────────────────────────────────────────────────────

def test_a_wrong_grant_type_is_unsupported(client, rsa_keys):
    org = _org(); issuer = _issuer_for(org, actor=_owner(org))
    r = client.post(TOKEN_URL, data={"grant_type": "password",
                                     "subject_token": _mint(rsa_keys, issuer),
                                     "subject_token_type": STT})
    assert r.status_code == 400
    assert r.json()["error"] == "unsupported_grant_type"


def test_a_wrong_subject_token_type_is_invalid_request(client, rsa_keys):
    org = _org(); issuer = _issuer_for(org, actor=_owner(org))
    r = client.post(TOKEN_URL, data={
        "grant_type": GRANT, "subject_token": _mint(rsa_keys, issuer),
        "subject_token_type": "urn:ietf:params:oauth:token-type:access_token"})
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_request"


def test_a_malformed_subject_token_is_invalid_request(client):
    r = _exchange(client, "not-a-jwt")
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_request"


def test_a_foreign_requested_token_type_is_invalid_request(client, rsa_keys):
    org = _org(); issuer = _issuer_for(org, actor=_owner(org))
    r = _exchange(client, _mint(rsa_keys, issuer),
                  requested_token_type="urn:ietf:params:oauth:token-type:saml2")
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_request"


# ── SSRF surface on the fetched URL ──────────────────────────────────────────

@pytest.mark.parametrize("bad", [
    "http://idp.example.com/jwks",      # not https
    "https://127.0.0.1/jwks",           # loopback
    "https://10.0.0.5/jwks",            # private
    "https://169.254.169.254/jwks",     # link-local (cloud metadata)
    "https://[::1]/jwks",               # ipv6 loopback
])
def test_a_dangerous_jwks_uri_is_refused(bad):
    org = _org()
    with pytest.raises(oauth_exchange.IssuerConfigError):
        oauth_exchange.configure_issuer(
            org["org_id"], issuer="https://idp.example.com",
            jwks_uri=bad, audience="nhid-x",
            actor_user_id=_owner(org)["user_id"])


def test_a_non_https_issuer_is_refused():
    org = _org()
    with pytest.raises(oauth_exchange.IssuerConfigError):
        oauth_exchange.configure_issuer(
            org["org_id"], issuer="http://idp.example.com",
            jwks_uri="https://idp.example.com/jwks", audience="nhid-x",
            actor_user_id=_owner(org)["user_id"])


# ── Token lifecycle ──────────────────────────────────────────────────────────

def test_an_expired_token_stops_resolving(client, rsa_keys, monkeypatch):
    org = _org(); issuer = _issuer_for(org, actor=_owner(org))
    monkeypatch.setattr(oauth_exchange, "EXCHANGED_TOKEN_TTL_SECONDS", -1)
    token = _exchange(client, _mint(rsa_keys, issuer)).json()["access_token"]
    assert oauth_exchange.resolve_token(token) is None


def test_revoking_an_org_drops_its_tokens(client, rsa_keys):
    org = _org(); issuer = _issuer_for(org, actor=_owner(org))
    token = _exchange(client, _mint(rsa_keys, issuer)).json()["access_token"]
    assert oauth_exchange.resolve_token(token) is not None
    assert oauth_exchange.revoke_tokens_for_org(org["org_id"]) >= 1
    assert oauth_exchange.resolve_token(token) is None


def test_purge_removes_expired_tokens(client, rsa_keys, monkeypatch):
    org = _org(); issuer = _issuer_for(org, actor=_owner(org))
    monkeypatch.setattr(oauth_exchange, "EXCHANGED_TOKEN_TTL_SECONDS", -1)
    _exchange(client, _mint(rsa_keys, issuer))
    assert oauth_exchange.purge_expired_tokens() >= 1


def test_deactivating_an_issuer_is_immediate(client, rsa_keys):
    """Both senses of immediate: outstanding tokens stop resolving, and a new
    subject token from that issuer is refused on the next request — not after
    the JWKS cache lifespan."""
    org = _org(); owner = _owner(org)
    issuer = _issuer_for(org, actor=owner)
    token = _exchange(client, _mint(rsa_keys, issuer)).json()["access_token"]
    assert oauth_exchange.resolve_token(token) is not None

    oauth_exchange.deactivate_issuer(org["org_id"], issuer["issuer_id"],
                                     actor_user_id=owner["user_id"])
    assert oauth_exchange.resolve_token(token) is None
    r = _exchange(client, _mint(rsa_keys, issuer))
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_grant"


# ── Throttle ─────────────────────────────────────────────────────────────────

def test_repeated_forgeries_lock_the_issuer_bucket(client, rsa_keys):
    org = _org(); issuer = _issuer_for(org, actor=_owner(org))
    stranger = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    stranger_pem = stranger.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption())
    forged = _mint(rsa_keys, issuer, key=stranger_pem)

    seen_429 = False
    for _ in range(user_auth.LOGIN_MAX_FAILURES + 2):
        r = _exchange(client, forged)
        if r.status_code == 429:
            seen_429 = True
    assert seen_429, "the lockout never engaged after repeated forgeries"

    # A success does not reset the lockout: a genuine token from the same
    # address is still refused with 429 while the window holds.
    r = _exchange(client, _mint(rsa_keys, issuer))
    assert r.status_code == 429


def test_concurrent_forgeries_cannot_slip_under_the_limit(client, rsa_keys):
    """Twelve simultaneous forgeries. The property being proven is not that a
    429 appears mid-burst — a cold-start burst can all clear the lock pre-check
    before any failure commits, which is ordinary check-then-act and not a
    bypass, because none of those requests succeeds. What must hold is:

      * no forgery is ever accepted (every one is a 400 — no token minted);
      * every failure is counted, because record_attempt is one atomic SQL
        statement, so the bucket ends locked rather than under-counting the
        concurrent attempts; and
      * the lock then holds against the next request.
    """
    import threading
    org = _org(); issuer = _issuer_for(org, actor=_owner(org))
    stranger = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    stranger_pem = stranger.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption())
    forged = _mint(rsa_keys, issuer, key=stranger_pem)

    codes = []
    lock = threading.Lock()

    def hit():
        r = _exchange(client, forged)
        with lock:
            codes.append(r.status_code)

    threads = [threading.Thread(target=hit) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Not one forgery got through: every response is a refusal, never a token.
    assert all(c in (400, 429) for c in codes), codes
    # The atomic increment counted them all, so the bucket is now locked...
    assert user_auth.throttle_locked_until(f"oauth-iss:{issuer['issuer']}") is not None
    # ...and the next attempt is refused outright.
    assert _exchange(client, forged).status_code == 429


# ── Issuer administration: owner-only, audited ───────────────────────────────

def test_configuring_an_issuer_writes_an_audit_row(client):
    org = _org(); owner = _owner(org)
    issuer = _issuer_for(org, actor=owner)
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT * FROM oauth_issuer_audit
                WHERE issuer_id = %s AND action = 'configured'""",
            (issuer["issuer_id"],))
        row = cur.fetchone()
    finally:
        conn.close()
    assert row is not None
    assert row["actor_user_id"] == owner["user_id"]


def test_a_non_owner_cannot_configure_an_issuer(client):
    org = _org()
    member = user_auth.create_user(f"m-{uuid.uuid4().hex[:10]}@example.org")
    user_auth.add_member(org["org_id"], member["user_id"], user_auth.ROLE_MEMBER)
    session = user_auth.create_session(member["user_id"])
    r = client.post(
        "/saas/orgs/oauth-issuers",
        headers={"X-API-Key": org["api_key"]},
        cookies={"nhid_session": session},
        json={"issuer": "https://idp.example.com",
              "jwks_uri": "https://idp.example.com/jwks", "audience": "nhid-x"},
    )
    assert r.status_code == 403
    # No row written for a refused attempt.
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS n FROM oauth_issuers WHERE org_id = %s",
                    (org["org_id"],))
        assert cur.fetchone()["n"] == 0
    finally:
        conn.close()
