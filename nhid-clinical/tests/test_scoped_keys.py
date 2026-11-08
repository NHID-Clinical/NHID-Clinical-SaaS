"""Scoped, expiring organization API keys, and the read-only auditor role.

One org-wide key that never expires is what a payer security review flags
first: a key handed to an ingest pipeline can also resolve findings, purge
nothing (owner session is still required) but read everything, and it lives
forever. These tests drive the public HTTP API only:

  * an owner mints keys with a scope (`ingest`, `read`, `full`) and an expiry;
  * a `read` key reads and cannot write; an `ingest` key writes evidence and
    cannot read it back; an expired or revoked key is refused;
  * a member whose role is `auditor` can look and cannot change anything.

Requires the same environment as the rest of the suite: DATABASE_URL, HMAC_SECRET.
"""
from __future__ import annotations

import os
import sys
import uuid

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas_layer import user_auth  # noqa: E402
from saas_layer.auth import create_org  # noqa: E402
from saas_layer.db import get_conn  # noqa: E402
from saas_layer.gateway import SESSION_COOKIE, app  # noqa: E402

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"
)

ASSESSMENT = {"name": "Scoped key fixture", "period_start": "2026-09-01",
              "period_end": "2026-09-30", "is_synthetic": True}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("EMAIL_BACKEND", "log")
    return TestClient(app)


@pytest.fixture
def org():
    return create_org(f"Scoped Co {uuid.uuid4().hex[:8]}", "free")


def _member(org, role):
    address = f"{role}-{uuid.uuid4().hex[:12]}@example.org"
    user = user_auth.create_user(address)
    user_auth.add_member(org["org_id"], user["user_id"], role)
    return {"email": address, "session": user_auth.create_session(user["user_id"])}


@pytest.fixture
def owner(org):
    return _member(org, user_auth.ROLE_OWNER)


def _as_owner(client, org, owner):
    client.headers.update({"X-API-Key": org["api_key"]})
    client.cookies.set(SESSION_COOKIE, owner["session"])


def _mint(client, org, owner, **body):
    _as_owner(client, org, owner)
    resp = client.post("/saas/orgs/keys", json=body)
    client.headers.pop("X-API-Key", None)
    client.cookies.clear()
    return resp


def test_a_read_key_reads_and_cannot_ingest(client, org, owner):
    minted = _mint(client, org, owner, label="auditor laptop", scope="read",
                   expires_in_days=30)
    assert minted.status_code == 201, minted.text
    key = minted.json()["api_key"]

    assert client.get("/saas/monitor/findings", headers={"X-API-Key": key}).status_code == 200
    refused = client.post("/saas/monitor/assessments", headers={"X-API-Key": key}, json=ASSESSMENT)
    assert refused.status_code == 403
    assert "read" in refused.json()["detail"]


def test_an_ingest_key_writes_evidence_and_cannot_read_it_back(client, org, owner):
    key = _mint(client, org, owner, label="pipeline", scope="ingest",
                expires_in_days=90).json()["api_key"]
    headers = {"X-API-Key": key}
    assert client.post("/saas/monitor/assessments", headers=headers, json=ASSESSMENT).status_code == 200
    assert client.get("/saas/monitor/findings", headers=headers).status_code == 403
    assert client.get("/saas/orgs/keys", headers=headers).status_code == 403


def _expire(key_id):
    """Move a key's expiry into the past. Written directly: waiting a day is the
    only other way through the public interface."""
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                "UPDATE org_api_keys SET expires_at = NOW() - INTERVAL '1 second' "
                "WHERE key_id = %s", (key_id,))
    finally:
        conn.close()


def test_an_expired_key_is_refused(client, org, owner):
    minted = _mint(client, org, owner, label="short", scope="read", expires_in_days=1).json()
    _expire(minted["key_id"])
    resp = client.get("/saas/monitor/findings", headers={"X-API-Key": minted["api_key"]})
    assert resp.status_code == 403


def test_a_revoked_key_is_refused_and_listed_as_inactive(client, org, owner):
    minted = _mint(client, org, owner, label="laptop", scope="read", expires_in_days=30).json()
    _as_owner(client, org, owner)
    assert client.delete(f"/saas/orgs/keys/{minted['key_id']}").status_code == 200
    listed = {k["key_id"]: k for k in client.get("/saas/orgs/keys").json()["keys"]}
    assert listed[minted["key_id"]]["active"] is False
    assert listed[minted["key_id"]]["revoked_by"] == owner["email"]
    client.headers.pop("X-API-Key", None)
    client.cookies.clear()
    assert client.get("/saas/monitor/findings",
                      headers={"X-API-Key": minted["api_key"]}).status_code == 403


def test_minting_needs_an_owner_session(client, org, owner):
    body = {"label": "x", "scope": "read", "expires_in_days": 30}
    assert client.post("/saas/orgs/keys", headers={"X-API-Key": org["api_key"]},
                       json=body).status_code == 401
    member = _member(org, user_auth.ROLE_MEMBER)
    client.cookies.set(SESSION_COOKIE, member["session"])
    assert client.post("/saas/orgs/keys", headers={"X-API-Key": org["api_key"]},
                       json=body).status_code == 403


@pytest.mark.parametrize("days", [0, 366, -5])
def test_every_scoped_key_expires_within_a_year(client, org, owner, days):
    assert _mint(client, org, owner, label="x", scope="read",
                 expires_in_days=days).status_code == 422


def test_an_unknown_scope_is_refused(client, org, owner):
    assert _mint(client, org, owner, label="x", scope="admin",
                 expires_in_days=30).status_code == 422


def test_the_key_list_holds_no_secret(client, org, owner):
    minted = _mint(client, org, owner, label="x", scope="read", expires_in_days=30).json()
    _as_owner(client, org, owner)
    body = client.get("/saas/orgs/keys").text
    assert minted["api_key"] not in body
    assert minted["key_prefix"] in body


def test_a_scoped_key_cannot_rotate_the_primary_key(client, org, owner):
    key = _mint(client, org, owner, label="x", scope="full", expires_in_days=30).json()["api_key"]
    assert client.post("/saas/orgs/rotate-key", headers={"X-API-Key": key}).status_code == 403
    # The primary key still works: nothing was rotated.
    assert client.get("/saas/orgs/keys", headers={"X-API-Key": org["api_key"]}).status_code == 200


def test_a_read_key_cannot_mint_keys_even_with_an_owner_session(client, org, owner):
    key = _mint(client, org, owner, label="x", scope="read", expires_in_days=30).json()["api_key"]
    client.cookies.set(SESSION_COOKIE, owner["session"])
    resp = client.post("/saas/orgs/keys", headers={"X-API-Key": key},
                       json={"label": "y", "scope": "full", "expires_in_days": 365})
    assert resp.status_code == 403


def test_another_organization_cannot_revoke_this_one_s_key(client, org, owner):
    minted = _mint(client, org, owner, label="x", scope="read", expires_in_days=30).json()
    other = create_org(f"Other Co {uuid.uuid4().hex[:8]}", "free")
    other_owner = _member(other, user_auth.ROLE_OWNER)
    _as_owner(client, other, other_owner)
    assert client.delete(f"/saas/orgs/keys/{minted['key_id']}").status_code == 404
    client.headers.pop("X-API-Key", None)
    client.cookies.clear()
    assert client.get("/saas/monitor/findings",
                      headers={"X-API-Key": minted["api_key"]}).status_code == 200


def test_a_read_key_cannot_feed_the_voice_webhook(client, org, owner):
    key = _mint(client, org, owner, label="x", scope="read", expires_in_days=30).json()["api_key"]
    resp = client.post("/saas/voice/webhook/incoming",
                       headers={"X-NHID-API-Key": key}, json={"call_id": "c1"})
    assert resp.status_code == 403
    # Refused for its scope, before the plan check (a free org is also refused).
    assert "scope is 'read'" in resp.json()["detail"]


# ── The auditor role ────────────────────────────────────────────────────────

def test_an_auditor_can_look_and_cannot_change_anything(client, org, owner):
    auditor = _member(org, user_auth.ROLE_AUDITOR)
    client.headers.update({"X-API-Key": org["api_key"]})
    client.cookies.set(SESSION_COOKIE, auditor["session"])
    assert client.get("/saas/monitor/findings").status_code == 200
    assert client.get("/saas/monitor/retention").status_code == 200
    refused = client.post("/saas/monitor/assessments", json=ASSESSMENT)
    assert refused.status_code == 403
    assert "read-only" in refused.json()["detail"]
    assert client.patch("/saas/monitor/findings/fnd_any",
                        json={"status": "resolved"}).status_code == 403


def test_an_owner_can_invite_an_auditor(client, org, owner):
    _as_owner(client, org, owner)
    resp = client.post("/saas/orgs/members",
                       json={"email": f"audit-{uuid.uuid4().hex[:8]}@example.org",
                             "role": "auditor"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["role"] == "auditor"
