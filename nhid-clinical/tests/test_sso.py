"""Enterprise single sign-on: OpenID Connect, authorization code with PKCE.

An owner points the organization at its identity provider (Okta, Entra ID,
Google Workspace...). A person then signs in there instead of by email link.
These tests stand in for the identity provider at the network boundary only
(the token endpoint and the signing keys) and drive everything else through
the public HTTP API:

  * a person from an allowed email domain signs in and gets a session, and is
    added to the organization with its default role if new;
  * everything an attacker could vary is refused: another domain, a replayed or
    expired state, a wrong nonce or audience, a forged signature, an
    unverified email, a return address on another site;
  * configuring SSO needs an owner, never echoes the client secret, and refuses
    URLs a server-side fetch should not reach.
"""
from __future__ import annotations

import base64
import hashlib
import os
import sys
import time
import uuid
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas_layer import sso, user_auth  # noqa: E402
from saas_layer.auth import create_org  # noqa: E402
from saas_layer.gateway import SESSION_COOKIE, app  # noqa: E402

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"
)

ISSUER = "https://idp.example.org"
CLIENT_ID = "nhid-console"


def _pem(key):
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


class FakeIdP:
    """The identity provider's side: it remembers the authorization request and
    answers the token request with an id_token it signs."""

    def __init__(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.claims = {}
        self.sign_with = None
        self.last_token_request = None
        self.last_authorize = None

    def id_token(self, nonce):
        now = int(time.time())
        claims = {"iss": ISSUER, "aud": CLIENT_ID, "sub": "user-123", "iat": now,
                  "exp": now + 300, "nonce": nonce, "email": "dana@lakeside.example",
                  "email_verified": True}
        claims.update(self.claims)
        claims = {k: v for k, v in claims.items() if v is not None}
        return jwt.encode(claims, _pem(self.sign_with or self.key), algorithm="RS256",
                          headers={"kid": "k1"})

    def exchange(self, token_endpoint, form):
        self.last_token_request = dict(form)
        nonce = parse_qs(urlsplit(self.last_authorize).query)["nonce"][0]
        return {"id_token": self.id_token(nonce), "token_type": "Bearer"}


class _FakeJWKS:
    def __init__(self, public_key):
        self._key = public_key

    def get_signing_key_from_jwt(self, token):
        return type("K", (), {"key": self._key})()


@pytest.fixture
def idp(monkeypatch):
    provider = FakeIdP()
    monkeypatch.setattr(sso, "_post_token_request", provider.exchange)
    monkeypatch.setattr(sso, "_jwks_client", lambda uri: _FakeJWKS(provider.key.public_key()))
    return provider


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "https://app.example.org")
    monkeypatch.setenv("EMAIL_BACKEND", "log")
    return TestClient(app, follow_redirects=False)


@pytest.fixture
def org():
    return create_org(f"SSO Co {uuid.uuid4().hex[:8]}", "free")


@pytest.fixture
def owner(org):
    address = f"owner-{uuid.uuid4().hex[:10]}@lakeside.example"
    user = user_auth.create_user(address)
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_OWNER)
    return {"email": address, "session": user_auth.create_session(user["user_id"])}


CONFIG = {
    "issuer": ISSUER,
    "client_id": CLIENT_ID,
    "client_secret": "s3cret-from-the-idp",
    "authorization_endpoint": "https://idp.example.org/oauth2/v1/authorize",
    "token_endpoint": "https://idp.example.org/oauth2/v1/token",
    "jwks_uri": "https://idp.example.org/oauth2/v1/keys",
    "allowed_domains": ["lakeside.example"],
    "default_role": "auditor",
}


def _configure(client, org, owner, **overrides):
    client.cookies.set(SESSION_COOKIE, owner["session"])
    resp = client.put("/saas/orgs/sso", headers={"X-API-Key": org["api_key"]},
                      json={**CONFIG, **overrides})
    client.cookies.clear()
    return resp


def _sign_in(client, org, idp, *, return_to="/dashboard"):
    """Start at our API, 'visit' the IdP, and come back to the callback."""
    start = client.get("/saas/auth/sso/start", params={"org_id": org["org_id"],
                                                       "return_to": return_to})
    assert start.status_code == 302, start.text
    idp.last_authorize = start.headers["location"]
    state = parse_qs(urlsplit(idp.last_authorize).query)["state"][0]
    return client.get("/saas/auth/sso/callback", params={"state": state, "code": "auth-code-1"}), state


def test_a_person_from_an_allowed_domain_signs_in_and_joins_with_the_default_role(client, org, owner, idp):
    assert _configure(client, org, owner).status_code == 200
    callback, _ = _sign_in(client, org, idp)
    assert callback.status_code == 302
    assert callback.headers["location"] == "https://app.example.org/dashboard"
    session = callback.cookies.get(SESSION_COOKIE)
    assert session
    me = client.get("/saas/auth/me", cookies={SESSION_COOKIE: session}).json()
    assert me["user"]["email"] == "dana@lakeside.example"
    roles = {o["org_id"]: o["role"] for o in me["orgs"]}
    assert roles[org["org_id"]] == "auditor"


def _refused(callback, code):
    assert callback.status_code == 302
    assert callback.headers["location"] == f"https://app.example.org/signin?sso_error={code}"
    assert SESSION_COOKIE not in callback.cookies


def test_an_email_at_another_domain_is_refused_even_if_the_provider_vouches(client, org, owner, idp):
    _configure(client, org, owner)
    stranger = f"mallory-{uuid.uuid4().hex[:8]}@elsewhere.example"
    idp.claims = {"email": stranger}
    callback, _ = _sign_in(client, org, idp)
    _refused(callback, "domain_not_allowed")
    assert user_auth.get_user_by_email(stranger) is None


def test_a_replayed_callback_is_refused(client, org, owner, idp):
    _configure(client, org, owner)
    first, state = _sign_in(client, org, idp)
    assert SESSION_COOKIE in first.cookies
    again = client.get("/saas/auth/sso/callback", params={"state": state, "code": "auth-code-1"})
    _refused(again, "invalid_state")


def test_an_unknown_state_is_refused(client, org, owner, idp):
    _configure(client, org, owner)
    _refused(client.get("/saas/auth/sso/callback", params={"state": "made-up", "code": "c"}),
             "invalid_state")


def test_a_token_with_the_wrong_nonce_is_refused(client, org, owner, idp, monkeypatch):
    _configure(client, org, owner)
    monkeypatch.setattr(idp, "exchange", lambda endpoint, form: {"id_token": idp.id_token("other-nonce")})
    monkeypatch.setattr(sso, "_post_token_request", idp.exchange)
    callback, _ = _sign_in(client, org, idp)
    _refused(callback, "invalid_nonce")


def test_a_token_for_another_application_is_refused(client, org, owner, idp):
    _configure(client, org, owner)
    idp.claims = {"aud": "some-other-app"}
    _refused(_sign_in(client, org, idp)[0], "invalid_id_token")


def test_a_token_from_another_issuer_is_refused(client, org, owner, idp):
    _configure(client, org, owner)
    idp.claims = {"iss": "https://evil.example"}
    _refused(_sign_in(client, org, idp)[0], "invalid_id_token")


def test_a_token_signed_with_a_foreign_key_is_refused(client, org, owner, idp):
    _configure(client, org, owner)
    idp.sign_with = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    _refused(_sign_in(client, org, idp)[0], "invalid_id_token")


def test_an_expired_token_is_refused(client, org, owner, idp):
    _configure(client, org, owner)
    idp.claims = {"exp": int(time.time()) - 3600, "iat": int(time.time()) - 7200}
    _refused(_sign_in(client, org, idp)[0], "invalid_id_token")


def test_an_unsigned_token_is_refused(client, org, owner, idp, monkeypatch):
    _configure(client, org, owner)

    def unsigned(endpoint, form):
        nonce = parse_qs(urlsplit(idp.last_authorize).query)["nonce"][0]
        claims = {"iss": ISSUER, "aud": CLIENT_ID, "sub": "x", "iat": int(time.time()),
                  "exp": int(time.time()) + 300, "nonce": nonce,
                  "email": "dana@lakeside.example", "email_verified": True}
        return {"id_token": jwt.encode(claims, None, algorithm="none")}
    monkeypatch.setattr(sso, "_post_token_request", unsigned)
    _refused(_sign_in(client, org, idp)[0], "invalid_id_token")


def test_an_unverified_email_is_refused(client, org, owner, idp):
    _configure(client, org, owner)
    idp.claims = {"email_verified": False}
    _refused(_sign_in(client, org, idp)[0], "email_not_verified")


def test_an_expired_sign_in_is_refused(client, org, owner, idp, monkeypatch):
    _configure(client, org, owner)
    monkeypatch.setattr(sso, "STATE_TTL_SECONDS", -1)
    _refused(_sign_in(client, org, idp)[0], "invalid_state")


@pytest.mark.parametrize("target", ["https://evil.example/", "//evil.example/x",
                                    "/\\evil.example", "javascript:alert(1)"])
def test_the_return_address_must_be_on_our_own_app(client, org, owner, idp, target):
    _configure(client, org, owner)
    resp = client.get("/saas/auth/sso/start", params={"org_id": org["org_id"], "return_to": target})
    assert resp.status_code == 400


def test_pkce_s256_is_used_and_the_verifier_reaches_the_token_request(client, org, owner, idp):
    _configure(client, org, owner)
    _sign_in(client, org, idp)
    query = parse_qs(urlsplit(idp.last_authorize).query)
    assert query["code_challenge_method"] == ["S256"]
    verifier = idp.last_token_request["code_verifier"]
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert query["code_challenge"] == [expected]
    assert idp.last_token_request["client_secret"] == CONFIG["client_secret"]


def test_an_existing_member_keeps_their_role(client, org, owner, idp):
    _configure(client, org, owner)
    idp.claims = {"email": owner["email"]}
    callback, _ = _sign_in(client, org, idp)
    me = client.get("/saas/auth/me", cookies={SESSION_COOKIE: callback.cookies[SESSION_COOKIE]}).json()
    assert {o["org_id"]: o["role"] for o in me["orgs"]}[org["org_id"]] == "owner"


def test_sign_ins_and_joins_reach_the_activity_log(client, org, owner, idp):
    _configure(client, org, owner)
    _sign_in(client, org, idp)
    events = client.get("/saas/orgs/activity", headers={"X-API-Key": org["api_key"]}).json()["events"]
    actions = {e["action"] for e in events}
    assert {"sso.configured", "member.joined_via_sso", "sso.signed_in"} <= actions


# ── Configuration ──────────────────────────────────────────────────────────

def test_configuring_needs_an_owner(client, org, owner):
    assert client.put("/saas/orgs/sso", headers={"X-API-Key": org["api_key"]},
                      json=CONFIG).status_code == 401
    member = user_auth.create_user(f"m-{uuid.uuid4().hex[:8]}@lakeside.example")
    user_auth.add_member(org["org_id"], member["user_id"], user_auth.ROLE_MEMBER)
    client.cookies.set(SESSION_COOKIE, user_auth.create_session(member["user_id"]))
    assert client.put("/saas/orgs/sso", headers={"X-API-Key": org["api_key"]},
                      json=CONFIG).status_code == 403


def test_the_client_secret_is_never_returned(client, org, owner):
    put = _configure(client, org, owner)
    got = client.get("/saas/orgs/sso", headers={"X-API-Key": org["api_key"]})
    for resp in (put, got):
        assert CONFIG["client_secret"] not in resp.text
    assert got.json()["sso"]["has_client_secret"] is True


@pytest.mark.parametrize("field,value", [
    ("token_endpoint", "http://idp.example.org/token"),
    ("jwks_uri", "https://127.0.0.1/keys"),
    ("jwks_uri", "https://10.0.0.5/keys"),
    ("allowed_domains", []),
    ("default_role", "owner"),
])
def test_unsafe_or_incomplete_configuration_is_refused(client, org, owner, field, value):
    assert _configure(client, org, owner, **{field: value}).status_code == 422


def test_starting_without_sso_configured_is_a_404(client, org):
    assert client.get("/saas/auth/sso/start", params={"org_id": org["org_id"]}).status_code == 404


def test_a_person_can_start_from_their_work_email(client, org, owner, idp):
    domain = f"{uuid.uuid4().hex[:8]}.example"
    _configure(client, org, owner, allowed_domains=[domain])
    resp = client.get("/saas/auth/sso/start", params={"email": f"dana@{domain}"})
    assert resp.status_code == 302
    assert resp.headers["location"].startswith(CONFIG["authorization_endpoint"])


def test_an_email_whose_domain_has_no_sso_is_a_404(client):
    resp = client.get("/saas/auth/sso/start", params={"email": f"x@{uuid.uuid4().hex[:8]}.example"})
    assert resp.status_code == 404
