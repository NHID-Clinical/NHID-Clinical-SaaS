"""The organization activity log: who changed what, exportable by the customer.

Before this, key, member and purge actions went only to server logs, which a
customer cannot see. An auditor's first request is "show me every
administrative change in the period", so each such action now leaves a row
the organization can read and export (JSON or CSV), and nobody can edit.

Driven through the public HTTP API only.
"""
from __future__ import annotations

import csv
import io
import os
import sys
import uuid

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas_layer import user_auth  # noqa: E402
from saas_layer.auth import create_org  # noqa: E402
from saas_layer.gateway import SESSION_COOKIE, app  # noqa: E402

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"
)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("EMAIL_BACKEND", "log")
    return TestClient(app)


@pytest.fixture
def org():
    return create_org(f"Activity Co {uuid.uuid4().hex[:8]}", "free")


@pytest.fixture
def owner(org):
    address = f"owner-{uuid.uuid4().hex[:12]}@example.org"
    user = user_auth.create_user(address)
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_OWNER)
    return {"email": address, "session": user_auth.create_session(user["user_id"])}


def _as_owner(client, org, owner):
    client.headers.update({"X-API-Key": org["api_key"]})
    client.cookies.set(SESSION_COOKIE, owner["session"])


def _activity(client, org):
    resp = client.get("/saas/orgs/activity", headers={"X-API-Key": org["api_key"]})
    assert resp.status_code == 200, resp.text
    return resp.json()["events"]


def test_minting_a_key_is_recorded_with_who_did_it_and_no_secret(client, org, owner):
    _as_owner(client, org, owner)
    minted = client.post("/saas/orgs/keys", json={"label": "pipeline", "scope": "ingest",
                                                  "expires_in_days": 30}).json()
    events = _activity(client, org)
    created = [e for e in events if e["action"] == "key.created"]
    assert len(created) == 1
    assert created[0]["actor"] == owner["email"]
    assert created[0]["target"] == minted["key_id"]
    assert created[0]["detail"]["scope"] == "ingest"
    assert minted["api_key"] not in str(events)


def test_revoking_adding_and_removing_are_recorded(client, org, owner):
    _as_owner(client, org, owner)
    key_id = client.post("/saas/orgs/keys", json={"label": "x", "scope": "read",
                                                  "expires_in_days": 30}).json()["key_id"]
    client.delete(f"/saas/orgs/keys/{key_id}")
    invited = client.post("/saas/orgs/members", json={
        "email": f"aud-{uuid.uuid4().hex[:8]}@example.org", "role": "auditor"}).json()
    assert client.delete(f"/saas/orgs/members/{invited['user_id']}").status_code == 200
    actions = [e["action"] for e in _activity(client, org)]
    for expected in ("key.revoked", "member.added", "member.removed"):
        assert expected in actions, actions
    added = next(e for e in _activity(client, org) if e["action"] == "member.added")
    assert added["detail"]["role"] == "auditor"


def test_purging_transcripts_is_recorded(client, org, owner):
    _as_owner(client, org, owner)
    assert client.post("/saas/monitor/retention/purge", json={}).status_code == 200
    purge = next(e for e in _activity(client, org) if e["action"] == "transcripts.purged")
    assert purge["actor"] == owner["email"]


def test_rotating_the_primary_key_is_recorded_as_the_machine_that_did_it(client, org):
    rotated = client.post("/saas/orgs/rotate-key", headers={"X-API-Key": org["api_key"]}).json()
    org = dict(org, api_key=rotated["api_key"])
    event = next(e for e in _activity(client, org) if e["action"] == "primary_key.rotated")
    assert event["actor"] == "api-key:primary"


def test_the_log_exports_as_csv_for_an_auditor(client, org, owner):
    _as_owner(client, org, owner)
    client.post("/saas/orgs/keys", json={"label": "x", "scope": "read", "expires_in_days": 30})
    resp = client.get("/saas/orgs/activity?format=csv")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "attachment" in resp.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(resp.text)))
    assert rows[0].keys() >= {"occurred_at", "actor", "action", "target", "detail"}
    assert any(r["action"] == "key.created" for r in rows)


def test_another_organization_sees_none_of_it(client, org, owner):
    _as_owner(client, org, owner)
    client.post("/saas/orgs/keys", json={"label": "x", "scope": "read", "expires_in_days": 30})
    other = create_org(f"Other {uuid.uuid4().hex[:8]}", "free")
    client.headers.pop("X-API-Key", None)
    client.cookies.clear()
    assert _activity(client, other) == []


def test_a_read_key_can_export_and_an_ingest_key_cannot(client, org, owner):
    _as_owner(client, org, owner)
    read = client.post("/saas/orgs/keys", json={"label": "r", "scope": "read",
                                                "expires_in_days": 30}).json()["api_key"]
    ingest = client.post("/saas/orgs/keys", json={"label": "i", "scope": "ingest",
                                                  "expires_in_days": 30}).json()["api_key"]
    client.headers.pop("X-API-Key", None)
    client.cookies.clear()
    assert client.get("/saas/orgs/activity", headers={"X-API-Key": read}).status_code == 200
    assert client.get("/saas/orgs/activity", headers={"X-API-Key": ingest}).status_code == 403


@pytest.mark.parametrize("method", ["DELETE", "PATCH", "PUT", "POST"])
def test_nobody_can_edit_the_log(client, org, owner, method):
    _as_owner(client, org, owner)
    assert client.request(method, "/saas/orgs/activity").status_code == 405


# ── The trust-center summary the console's Security page reads ─────────────

def test_the_security_summary_reports_keys_members_retention_and_gaps(client, org, owner):
    _as_owner(client, org, owner)
    client.post("/saas/orgs/keys", json={"label": "soon", "scope": "read", "expires_in_days": 7})
    client.post("/saas/orgs/keys", json={"label": "later", "scope": "ingest", "expires_in_days": 90})
    client.post("/saas/orgs/members", json={"email": f"a-{uuid.uuid4().hex[:8]}@example.org",
                                            "role": "auditor"})
    summary = client.get("/saas/orgs/security").json()
    assert summary["keys"]["active"] == 2
    assert summary["keys"]["expiring_within_14_days"] == 1
    assert summary["keys"]["by_scope"] == {"read": 1, "ingest": 1}
    assert summary["members"]["by_role"] == {"owner": 1, "auditor": 1}
    assert summary["retention"]["effective_days"] >= 1
    assert summary["activity"]["events_last_30_days"] >= 3
    # The page states what is not in place, not only what is.
    gap_ids = {g["id"] for g in summary["gaps"]}
    assert {"soc2", "baa", "pentest"} <= gap_ids
