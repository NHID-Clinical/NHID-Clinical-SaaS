"""Endpoint tests for the admin console's backend (`/admin/*`).

`tests/test_admin_auth.py` covers credential loading and hashing as units. These
cover the HTTP surface, which had no coverage at all, and in particular the three
properties whose absence let real defects ship:

  * **No `/admin/*` route serves an unauthenticated caller.** Parametrised over
    every protected route, so a route added without its dependency fails here.

  * **`GET /admin/orgs` never returns a usable API key.** The plaintext column
    was dropped when keys moved to SHA-256, and the admin page went on rendering
    `org.api_key` — which crashed the whole page the moment an org existed.
    Nothing tested the payload's shape, so nothing caught it.

  * **Logging out invalidates the token server-side.** The frontend only cleared
    localStorage, leaving the token usable for the rest of its 8-hour TTL.

Requires the same environment as the rest of the suite: DATABASE_URL, HMAC_SECRET.
"""
from __future__ import annotations

import os
import re
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas_layer import auth, gateway  # noqa: E402
from saas_layer.admin_auth import AdminCredentials, hash_password  # noqa: E402
from saas_layer.auth import create_org, init_db  # noqa: E402
from saas_layer.db import get_conn  # noqa: E402


TEST_USERNAME = "test-admin"
TEST_PASSWORD = "test-only-admin-password-not-for-any-deployment"

# What a real key looks like: "nhid_" + secrets.token_hex(24).
FULL_KEY = re.compile(r"nhid_[0-9a-f]{48}")

# Every /admin/* route that requires a session, with a request body where one is
# needed so that a missing dependency cannot be mistaken for a 422. `/admin/login`
# is absent deliberately: it is the route that issues the session.
PROTECTED_ROUTES = [
    ("POST", "/admin/logout", None),
    ("GET", "/admin/session", None),
    ("GET", "/admin/orgs", None),
    ("GET", "/admin/usage", None),
    ("GET", "/admin/voice/sessions", None),
    ("POST", "/admin/voice/sessions/no-such-session/extend", None),
    ("DELETE", "/admin/voice/sessions/no-such-session", None),
    ("PATCH", "/admin/orgs/no-such-org/session-retention",
     {"voice_session_ttl_hours": 24}),
    ("GET", "/admin/org/no-such-org", None),
]


@pytest.fixture(scope="module")
def client():
    """A client with a known admin credential.

    `_ADMIN_CREDS` is set directly rather than through the lifespan so the tests
    know the password they are testing against, instead of depending on whatever
    the surrounding environment configured. The lifespan's own loading — and its
    refusal to start without a credential — is covered by
    `scripts/check_startup.py` and `tests/test_admin_auth.py`.
    """
    init_db()
    previous = gateway._ADMIN_CREDS
    gateway._ADMIN_CREDS = AdminCredentials(
        username=TEST_USERNAME, password_hash=hash_password(TEST_PASSWORD)
    )
    try:
        yield TestClient(app=gateway.app)
    finally:
        gateway._ADMIN_CREDS = previous


@pytest.fixture(autouse=True)
def clean_throttle():
    """Clear the failed-attempt counter around every test.

    The throttle is keyed on the client address, and every request from
    `TestClient` shares one. Without this, whichever test ran first to five
    failures would lock out the rest of the file.
    """
    _clear_all_attempts()
    yield
    _clear_all_attempts()


def _clear_all_attempts() -> None:
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute("DELETE FROM admin_login_attempts")
    finally:
        conn.close()


def _login(client) -> str:
    response = client.post(
        "/admin/login",
        json={"username": TEST_USERNAME, "password": TEST_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["admin_session_token"]


def _bad_login(client):
    return client.post(
        "/admin/login",
        json={"username": TEST_USERNAME, "password": "wrong-password"},
    )


def _request(client, method: str, path: str, body=None, token: str | None = None):
    headers = {"X-Admin-Session": token} if token else {}
    return client.request(method, path, json=body, headers=headers)


# ── Every route is behind the session ─────────────────────────────────────────

@pytest.mark.parametrize("method,path,body", PROTECTED_ROUTES)
def test_route_refuses_an_unauthenticated_request(client, method, path, body):
    response = _request(client, method, path, body)
    assert response.status_code == 401, (
        f"{method} {path} answered {response.status_code}, not 401 — it is "
        f"serving callers with no admin session"
    )


@pytest.mark.parametrize("method,path,body", PROTECTED_ROUTES)
def test_route_refuses_a_fabricated_token(client, method, path, body):
    response = _request(client, method, path, body, token="not-a-real-session-token")
    assert response.status_code == 401


# ── Login ─────────────────────────────────────────────────────────────────────

def test_correct_credentials_issue_a_session(client):
    response = client.post(
        "/admin/login",
        json={"username": TEST_USERNAME, "password": TEST_PASSWORD},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["admin_session_token"]
    assert body["expires_in"] > 0


def test_wrong_password_is_refused(client):
    assert _bad_login(client).status_code == 401


def test_wrong_username_is_refused(client):
    response = client.post(
        "/admin/login",
        json={"username": "not-the-admin", "password": TEST_PASSWORD},
    )
    assert response.status_code == 401


def test_the_refusal_does_not_say_which_field_was_wrong(client):
    """A caller must not be able to confirm a username by its error message."""
    bad_password = _bad_login(client)
    bad_username = client.post(
        "/admin/login",
        json={"username": "not-the-admin", "password": "wrong-password"},
    )
    assert bad_password.json()["detail"] == bad_username.json()["detail"]
    detail = bad_password.json()["detail"].lower()
    for leak in ("username", "user name", "password", "unknown", "no such"):
        assert leak not in detail, f"the refusal names {leak!r}"


# ── Logout actually invalidates ───────────────────────────────────────────────

def test_logout_invalidates_the_token_server_side(client):
    token = _login(client)
    assert client.get("/admin/session", headers={"X-Admin-Session": token}).status_code == 200

    assert client.post("/admin/logout", headers={"X-Admin-Session": token}).status_code == 200

    after = client.get("/admin/session", headers={"X-Admin-Session": token})
    assert after.status_code == 401, (
        "the token still works after logout — logging out cleared only the "
        "browser's copy"
    )


# ── Throttling ────────────────────────────────────────────────────────────────

def test_repeated_failures_are_throttled(client):
    for attempt in range(auth.ADMIN_LOGIN_MAX_FAILURES):
        assert _bad_login(client).status_code == 401, f"attempt {attempt + 1}"

    throttled = _bad_login(client)
    assert throttled.status_code == 429
    assert int(throttled.headers["Retry-After"]) > 0


def test_a_throttled_caller_is_refused_even_with_the_right_password(client):
    """The lock is checked before the credential, so it cannot be guessed past."""
    for _ in range(auth.ADMIN_LOGIN_MAX_FAILURES):
        _bad_login(client)

    response = client.post(
        "/admin/login",
        json={"username": TEST_USERNAME, "password": TEST_PASSWORD},
    )
    assert response.status_code == 429


def test_the_throttle_response_does_not_leak_the_credential(client):
    for _ in range(auth.ADMIN_LOGIN_MAX_FAILURES):
        _bad_login(client)

    detail = _bad_login(client).json()["detail"]
    assert TEST_PASSWORD not in detail
    assert TEST_USERNAME not in detail


def test_a_successful_login_clears_the_counter(client):
    for _ in range(auth.ADMIN_LOGIN_MAX_FAILURES - 1):
        assert _bad_login(client).status_code == 401

    _login(client)

    # Were the counter still standing at four, this single failure would lock.
    assert _bad_login(client).status_code == 401


def test_the_counter_survives_a_fresh_connection(client):
    """It is table-backed, not per-process: a restart must not reset it."""
    for _ in range(auth.ADMIN_LOGIN_MAX_FAILURES):
        _bad_login(client)

    assert auth.admin_login_locked_until("testclient") is not None


# ── The regression: /admin/orgs must not carry a key ──────────────────────────

@pytest.fixture
def org():
    record = create_org("Admin Endpoint Test Org")
    yield record
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                "DELETE FROM orgs WHERE org_id = %s", (record["org_id"],)
            )
    finally:
        conn.close()


def test_admin_orgs_returns_the_prefix_and_not_the_key(client, org):
    """The defect that blanked /admin: the row has no `api_key` to render.

    `create_org` returns the plaintext key exactly once, at creation. The stored
    row holds a SHA-256 and a short non-secret prefix, so a listing that appeared
    to carry `api_key` could only be carrying None.
    """
    token = _login(client)
    response = client.get("/admin/orgs", headers={"X-Admin-Session": token})
    assert response.status_code == 200

    rows = response.json()["orgs"]
    row = next(r for r in rows if r["org_id"] == org["org_id"])

    assert "api_key" not in row, "the listing still advertises an api_key field"
    assert row["api_key_prefix"], "the listing carries no prefix to display"
    assert org["api_key"].startswith(row["api_key_prefix"])


def test_no_field_anywhere_in_the_listing_holds_a_full_key(client, org):
    """Checked against the whole serialised payload, not a field allowlist.

    A field-by-field assertion only covers the fields someone thought to name;
    this covers a key reintroduced under any name at any depth.
    """
    token = _login(client)
    response = client.get("/admin/orgs", headers={"X-Admin-Session": token})

    assert org["api_key"] not in response.text
    leaked = FULL_KEY.findall(response.text)
    assert not leaked, f"the listing contains {len(leaked)} full API key(s)"


def test_the_org_detail_route_does_not_serve_a_key_either(client, org):
    token = _login(client)
    response = client.get(
        f"/admin/org/{org['org_id']}", headers={"X-Admin-Session": token}
    )
    assert response.status_code == 200
    assert org["api_key"] not in response.text
    assert not FULL_KEY.findall(response.text)
