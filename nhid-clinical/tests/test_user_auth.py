"""Magic-link sign-in: single use, no enumeration, and a name on every review.

The product exists to answer *who did this, under whose authority*. Until this
module it could not answer that about its own users: one API key per
organization, shared by a team, and a `reviewer` column holding whatever string
the client sent, defaulting to the literal "unknown".

So the tests that matter here are not "does login work". They are:

  * a link works exactly once, and expires;
  * an address that has no account is indistinguishable from one that does;
  * a session for org A cannot read org B;
  * a resolved finding carries the identity of the person who resolved it, and
    an API-key-only action says so rather than claiming a nameless person.

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

from saas_layer import monitoring, user_auth  # noqa: E402
from saas_layer.auth import create_org  # noqa: E402
from saas_layer.db import get_conn  # noqa: E402
from saas_layer.gateway import SESSION_COOKIE, app  # noqa: E402

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"
)


def _email() -> str:
    return f"user-{uuid.uuid4().hex[:12]}@example.org"


@pytest.fixture
def client(monkeypatch):
    # The log backend keeps the whole flow testable with no provider account
    # and no network. The link is read back out of the database, not the log,
    # so nothing here depends on log formatting.
    monkeypatch.setenv("EMAIL_BACKEND", "log")
    monkeypatch.setenv("APP_BASE_URL", "http://localhost:3000")
    return TestClient(app)


@pytest.fixture
def org():
    return create_org(f"Isolation Co {uuid.uuid4().hex[:8]}", "free")


@pytest.fixture
def member(org):
    """A user who owns `org` and holds a live session."""
    address = _email()
    user = user_auth.create_user(address)
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_OWNER)
    return {"user": user, "email": address,
            "session": user_auth.create_session(user["user_id"])}


# ── Tokens ────────────────────────────────────────────────────────────────────

def test_a_link_works_exactly_once():
    user = user_auth.create_user(_email())
    raw = user_auth.issue_login_token(user["user_id"])

    assert user_auth.consume_login_token(raw) == user["user_id"]
    # The second redemption is the one that matters: a link sitting in a
    # mailbox, a browser prefetch, or a mail scanner following it must not
    # leave a usable credential behind.
    assert user_auth.consume_login_token(raw) is None


def test_an_expired_link_is_refused(monkeypatch):
    user = user_auth.create_user(_email())
    monkeypatch.setattr(user_auth, "LOGIN_TOKEN_TTL_SECONDS", -1)
    raw = user_auth.issue_login_token(user["user_id"])
    assert user_auth.consume_login_token(raw) is None


def test_a_fabricated_token_is_refused():
    assert user_auth.consume_login_token("not-a-real-token") is None
    assert user_auth.consume_login_token("") is None


def test_the_raw_token_is_never_stored():
    user = user_auth.create_user(_email())
    raw = user_auth.issue_login_token(user["user_id"])
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT token_sha256 FROM login_tokens WHERE user_id = %s",
                    (user["user_id"],))
        stored = [r["token_sha256"] for r in cur.fetchall()]
    finally:
        conn.close()
    assert stored
    assert raw not in stored
    assert user_auth.hash_secret(raw) in stored


# ── Sessions ──────────────────────────────────────────────────────────────────

def test_a_session_resolves_to_its_user_and_stops_when_deleted():
    user = user_auth.create_user(_email())
    raw = user_auth.create_session(user["user_id"])

    assert user_auth.resolve_session(raw)["user_id"] == user["user_id"]
    user_auth.delete_session(raw)
    assert user_auth.resolve_session(raw) is None


def test_an_expired_session_does_not_resolve(monkeypatch):
    user = user_auth.create_user(_email())
    monkeypatch.setattr(user_auth, "SESSION_TTL_SECONDS", -1)
    raw = user_auth.create_session(user["user_id"])
    assert user_auth.resolve_session(raw) is None


def test_the_raw_session_is_never_stored():
    user = user_auth.create_user(_email())
    raw = user_auth.create_session(user["user_id"])
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT session_sha256 FROM user_sessions WHERE user_id = %s",
                    (user["user_id"],))
        stored = [r["session_sha256"] for r in cur.fetchall()]
    finally:
        conn.close()
    assert raw not in stored
    assert user_auth.hash_secret(raw) in stored


# ── No enumeration ────────────────────────────────────────────────────────────

def test_known_and_unknown_addresses_are_indistinguishable(client, org):
    """The whole point of the endpoint's shape.

    A difference in status or body between a real address and an invented one
    tells an attacker which members of a payer's compliance team hold accounts,
    which is the reconnaissance step before a phishing run.
    """
    known = _email()
    user = user_auth.create_user(known)
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_MEMBER)

    real = client.post("/saas/auth/request-link", json={"email": known})
    invented = client.post("/saas/auth/request-link", json={"email": _email()})
    malformed = client.post("/saas/auth/request-link", json={"email": "not-an-address"})

    assert real.status_code == invented.status_code == malformed.status_code == 202
    assert real.json() == invented.json() == malformed.json()


def test_an_address_with_no_org_gets_no_link(client):
    """A user row without a membership is not a way in.

    Nobody signs themselves up: membership comes from an invitation. A user
    that exists but belongs to no organization has nothing to sign in to, and
    issuing a link would create a credential for an empty account.
    """
    address = _email()
    user_auth.create_user(address)
    assert user_auth.request_login_link(address, base_url="http://x") is None


def test_request_link_does_not_leak_through_a_send_failure(client, org, monkeypatch):
    """A provider outage must not become an oracle.

    If delivery failures surfaced to the caller, a known address would answer
    differently from an unknown one the moment the mail provider was down.
    """
    address = _email()
    user = user_auth.create_user(address)
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_MEMBER)

    def explode(*_args, **_kwargs):
        raise RuntimeError("provider is down")

    monkeypatch.setattr("saas_layer.gateway.email_svc.send_login_link", explode)
    broken = client.post("/saas/auth/request-link", json={"email": address})
    unknown = client.post("/saas/auth/request-link", json={"email": _email()})

    assert broken.status_code == 202
    assert broken.json() == unknown.json()


# ── The dev email backend ─────────────────────────────────────────────────────

def test_the_dev_backend_emits_a_usable_link(capsys, monkeypatch):
    """The link must survive log redaction, because it is the whole point.

    `log_redaction.py` rewrites any `token=` it sees to `<redacted>` — correct,
    since a sign-in token in a log is a credential. Routing the development
    link through the logger therefore produced a link with its token stripped:
    a working security control quietly defeating the one affordance that makes
    this flow testable without a mail provider. It goes to stderr instead.
    """
    from saas_layer import email as email_svc

    monkeypatch.setenv("EMAIL_BACKEND", "log")
    link = "http://localhost:3000/auth/verify?token=a-real-looking-token-value"
    email_svc.send_login_link("someone@example.org", link)

    printed = capsys.readouterr().err
    assert link in printed
    assert "<redacted>" not in printed


def test_production_refuses_to_start_without_a_sender(monkeypatch):
    """Fail closed. A deployment that cannot send mail locks everyone out.

    It would answer 202 to every sign-in request and deliver nothing, with no
    error anywhere. Startup is the last cheap moment to notice.
    """
    from saas_layer import email as email_svc

    monkeypatch.delenv("EMAIL_BACKEND", raising=False)
    with pytest.raises(email_svc.EmailNotConfigured):
        email_svc.verify_configured(production=True)

    monkeypatch.setenv("EMAIL_BACKEND", "resend")
    monkeypatch.delenv("EMAIL_API_KEY", raising=False)
    monkeypatch.setenv("EMAIL_FROM", "sign-in@example.org")
    with pytest.raises(email_svc.EmailNotConfigured):
        email_svc.verify_configured(production=True)

    monkeypatch.setenv("EMAIL_API_KEY", "not-a-real-key")
    email_svc.verify_configured(production=True)  # configured: no raise


# ── Throttling ────────────────────────────────────────────────────────────────

def test_the_throttle_locks_after_the_threshold():
    key = f"test:{uuid.uuid4().hex}"
    try:
        for _ in range(user_auth.LOGIN_MAX_FAILURES - 1):
            assert user_auth.record_attempt(key) is None
        locked_until = user_auth.record_attempt(key)
        assert locked_until is not None and locked_until > time.time()
        assert user_auth.throttle_locked_until(key) is not None
    finally:
        user_auth.clear_attempts(key)
    assert user_auth.throttle_locked_until(key) is None


def test_the_throttle_does_not_share_a_lockout_with_admin_login():
    """Two doors, two buckets.

    An attacker hammering the customer sign-in must not be able to lock the
    operator out of /admin, which is the console used to investigate them.
    """
    from saas_layer import auth as admin_auth_module

    key = f"ip:{uuid.uuid4().hex}"
    try:
        for _ in range(user_auth.LOGIN_MAX_FAILURES):
            user_auth.record_attempt(key)
        assert user_auth.throttle_locked_until(key) is not None
        assert admin_auth_module.admin_login_locked_until(key.split(":", 1)[1]) is None
    finally:
        user_auth.clear_attempts(key)


# ── The HTTP flow, end to end ─────────────────────────────────────────────────

def test_verify_opens_a_session_and_logout_closes_it(client, org):
    address = _email()
    user = user_auth.create_user(address)
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_OWNER)
    raw = user_auth.issue_login_token(user["user_id"])

    opened = client.post("/saas/auth/verify", json={"token": raw})
    assert opened.status_code == 200
    assert opened.json()["user"]["email"] == address
    assert [o["org_id"] for o in opened.json()["orgs"]] == [org["org_id"]]
    assert SESSION_COOKIE in client.cookies

    me = client.get("/saas/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["user_id"] == user["user_id"]

    assert client.post("/saas/auth/logout").status_code == 200
    assert client.get("/saas/auth/me").status_code == 401


def test_the_session_cookie_is_httponly(client, org):
    address = _email()
    user = user_auth.create_user(address)
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_MEMBER)
    raw = user_auth.issue_login_token(user["user_id"])

    response = client.post("/saas/auth/verify", json={"token": raw})
    cookie_header = response.headers["set-cookie"]
    # The property `localStorage` never had: script on the page cannot read it,
    # so an XSS flaw cannot exfiltrate the session.
    assert "httponly" in cookie_header.lower()
    assert "samesite=lax" in cookie_header.lower()


def test_me_refuses_a_fabricated_cookie(client):
    client.cookies.set(SESSION_COOKIE, "not-a-real-session")
    assert client.get("/saas/auth/me").status_code == 401


def test_a_spent_link_is_refused_by_the_endpoint(client, org):
    user = user_auth.create_user(_email())
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_MEMBER)
    raw = user_auth.issue_login_token(user["user_id"])

    assert client.post("/saas/auth/verify", json={"token": raw}).status_code == 200
    assert client.post("/saas/auth/verify", json={"token": raw}).status_code == 401


# ── Membership ────────────────────────────────────────────────────────────────

def test_only_an_owner_can_invite(client, org, member):
    plain = user_auth.create_user(_email())
    user_auth.add_member(org["org_id"], plain["user_id"], user_auth.ROLE_MEMBER)

    client.cookies.set(SESSION_COOKIE, user_auth.create_session(plain["user_id"]))
    refused = client.post("/saas/orgs/members",
                          headers={"X-API-Key": org["api_key"]},
                          json={"email": _email()})
    assert refused.status_code == 403

    client.cookies.set(SESSION_COOKIE, member["session"])
    allowed = client.post("/saas/orgs/members",
                          headers={"X-API-Key": org["api_key"]},
                          json={"email": _email()})
    assert allowed.status_code == 201


def test_listing_members_needs_both_credentials(client, org, member):
    """An API key alone is not enough to read a customer's roster.

    That key is shared by the whole team and pasted into browsers; it should not
    also disclose the names and addresses of everyone on it.
    """
    assert client.get("/saas/orgs/members",
                      headers={"X-API-Key": org["api_key"]}).status_code == 401

    client.cookies.set(SESSION_COOKIE, member["session"])
    assert client.get("/saas/orgs/members").status_code == 401  # session but no key

    listed = client.get("/saas/orgs/members", headers={"X-API-Key": org["api_key"]})
    assert listed.status_code == 200
    assert member["email"] in [m["email"] for m in listed.json()["members"]]


def test_the_last_owner_cannot_be_removed(client, org, member):
    client.cookies.set(SESSION_COOKIE, member["session"])
    refused = client.delete(f"/saas/orgs/members/{member['user']['user_id']}",
                            headers={"X-API-Key": org["api_key"]})
    # An org with no owner can never invite anyone again, and recovering from
    # that needs an operator on the database.
    assert refused.status_code == 400


def test_removing_a_member_ends_their_sessions(client, org, member):
    other = user_auth.create_user(_email())
    user_auth.add_member(org["org_id"], other["user_id"], user_auth.ROLE_MEMBER)
    other_session = user_auth.create_session(other["user_id"])
    assert user_auth.resolve_session(other_session) is not None

    client.cookies.set(SESSION_COOKIE, member["session"])
    removed = client.delete(f"/saas/orgs/members/{other['user_id']}",
                            headers={"X-API-Key": org["api_key"]})
    assert removed.status_code == 200
    # Revoking membership without revoking the session leaves a live credential.
    assert user_auth.resolve_session(other_session) is None


# ── Isolation ─────────────────────────────────────────────────────────────────

def test_a_session_does_not_cross_organizations(client, org, member):
    """The security boundary, restated for the new credential.

    `test_workspace_isolation.py` proves an API key cannot reach another org's
    data. A session must not become a second way in: it carries an identity,
    not an authorization to a workspace.
    """
    other = create_org(f"Other Co {uuid.uuid4().hex[:8]}", "free")

    client.cookies.set(SESSION_COOKIE, member["session"])
    reached = client.get("/saas/orgs/members",
                         headers={"X-API-Key": other["api_key"]})
    assert reached.status_code == 403
    assert user_auth.get_membership(other["org_id"], member["user"]["user_id"]) is None


def test_orgs_for_user_lists_only_their_own(org, member):
    create_org(f"Unrelated Co {uuid.uuid4().hex[:8]}", "free")
    listed = user_auth.orgs_for_user(member["user"]["user_id"])
    assert [o["org_id"] for o in listed] == [org["org_id"]]


# ── Attribution: the reason this exists ───────────────────────────────────────

def _one_finding(client: TestClient, org: dict) -> str:
    """A finding produced by the real evaluator, not a hand-written row.

    Attribution is only worth testing on something the engine actually decided,
    so this goes through the same ingest and evaluate routes a customer uses.
    """
    headers = {"X-API-Key": org["api_key"]}
    assessment_id = client.post(
        "/saas/monitor/assessments", headers=headers,
        json={"name": "Attribution fixture", "is_synthetic": True},
    ).json()["assessment_id"]

    ingested = client.post(
        "/saas/monitor/ingest", headers=headers,
        json={"assessment_id": assessment_id, "vendor": "generic", "is_synthetic": True,
              "interactions": [{
                  "external_id": f"ATTR-{uuid.uuid4().hex[:8]}",
                  "occurred_at": "2026-09-02T10:00:00Z",
                  "ai_assessment": "non_human",
                  "turns": [
                      # No disclosure anywhere in the call, so IDG-01 raises.
                      {"speaker": "agent", "text": "Hello, calling about a claim.",
                       "offset_ms": 0},
                      {"speaker": "human", "text": "Who is this?", "offset_ms": 1500},
                  ],
              }]},
    )
    assert ingested.status_code == 200, ingested.text
    assert not ingested.json().get("errors"), ingested.json()["errors"]

    evaluated = client.post(
        f"/saas/monitor/assessments/{assessment_id}/evaluate", headers=headers)
    assert evaluated.status_code == 200, evaluated.text

    findings = monitoring.list_findings(org["org_id"], assessment_id=assessment_id)
    assert findings, "the engine raised no finding to attribute"
    return findings[0]["finding_id"]


def test_a_resolved_finding_carries_the_person_who_resolved_it(client, org, member):
    finding_id = _one_finding(client, org)

    client.cookies.set(SESSION_COOKIE, member["session"])
    updated = client.patch(
        f"/saas/monitor/findings/{finding_id}",
        headers={"X-API-Key": org["api_key"]},
        json={"status": "under_review", "notes": "Listening to the recording."},
    )
    assert updated.status_code == 200

    history = monitoring.get_finding(org["org_id"], finding_id)["review_history"]
    assert history[-1]["reviewer_user_id"] == member["user"]["user_id"]
    assert history[-1]["reviewer"] == member["email"]
    # The string this replaced. A record that says "unknown" reads like a
    # person whose name went missing, which is the failure this change exists
    # to end.
    assert history[-1]["reviewer"] != "unknown"


def test_a_client_supplied_reviewer_is_ignored(client, org, member):
    """The body cannot name someone else.

    Before this change the reviewer was whatever the client sent, so any holder
    of the shared API key could sign a review decision with a colleague's name.
    """
    finding_id = _one_finding(client, org)

    client.cookies.set(SESSION_COOKIE, member["session"])
    updated = client.patch(
        f"/saas/monitor/findings/{finding_id}",
        headers={"X-API-Key": org["api_key"]},
        json={"status": "under_review", "reviewer": "somebody.else@example.org"},
    )
    assert updated.status_code == 200

    history = monitoring.get_finding(org["org_id"], finding_id)["review_history"]
    assert history[-1]["reviewer"] == member["email"]
    assert "somebody.else" not in (history[-1]["reviewer"] or "")


def test_an_api_key_action_says_it_is_unattributed(client, org):
    """A machine action is recorded as a machine action.

    Pipelines resolve findings too, and that is legitimate. What is not
    legitimate is recording it as a nameless person: an auditor reading
    "unknown" cannot tell a missing name from an absent one.
    """
    finding_id = _one_finding(client, org)

    updated = client.patch(
        f"/saas/monitor/findings/{finding_id}",
        headers={"X-API-Key": org["api_key"]},
        json={"status": "under_review"},
    )
    assert updated.status_code == 200

    history = monitoring.get_finding(org["org_id"], finding_id)["review_history"]
    assert history[-1]["reviewer_user_id"] is None
    assert history[-1]["reviewer"] == monitoring.UNATTRIBUTED_MACHINE
    assert history[-1]["reviewer"] != "unknown"


def test_a_session_from_another_org_attributes_nothing(client, org):
    """A cookie for org B signing an action in org A is not attribution.

    The API key already authorized the request, so it is not an error -- but
    the name on it must be nobody's, not the outsider's.
    """
    outsider_org = create_org(f"Outsider Co {uuid.uuid4().hex[:8]}", "free")
    outsider = user_auth.create_user(_email())
    user_auth.add_member(outsider_org["org_id"], outsider["user_id"], user_auth.ROLE_OWNER)

    finding_id = _one_finding(client, org)
    client.cookies.set(SESSION_COOKIE, user_auth.create_session(outsider["user_id"]))
    updated = client.patch(
        f"/saas/monitor/findings/{finding_id}",
        headers={"X-API-Key": org["api_key"]},
        json={"status": "under_review"},
    )
    assert updated.status_code == 200

    history = monitoring.get_finding(org["org_id"], finding_id)["review_history"]
    assert history[-1]["reviewer_user_id"] is None
    assert history[-1]["reviewer"] == monitoring.UNATTRIBUTED_MACHINE


# ── Registration bootstrap ────────────────────────────────────────────────────

def test_registering_with_an_email_creates_the_first_owner(client):
    address = _email()
    created = client.post("/saas/orgs/register",
                          json={"org_name": "Bootstrap Co", "email": address})
    assert created.status_code == 200
    body = created.json()
    assert body["owner_invited"] is True
    assert body["api_key"].startswith("nhid_")

    user = user_auth.get_user_by_email(address)
    membership = user_auth.get_membership(body["org_id"], user["user_id"])
    assert membership["role"] == user_auth.ROLE_OWNER


def test_registering_without_an_email_still_works(client):
    created = client.post("/saas/orgs/register", json={"org_name": "Machine Only Co"})
    assert created.status_code == 200
    assert created.json()["owner_invited"] is False
    # A key and no humans: usable by a pipeline, nobody can sign in to it.
    assert user_auth.list_members(created.json()["org_id"]) == []
