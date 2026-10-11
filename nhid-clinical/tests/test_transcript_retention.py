"""Transcript retention: text expires, evidence does not.

`interactions.transcript` can carry PHI — member identifiers, names, dates of
birth, claim details. Before this module it was stored with no retention limit,
no purge and no deletion path, while `voice_sessions` had all three. The honest
answer to the first question a payer security review asks was "indefinitely,
and there is no way to."

So the tests that matter are not "does the purge run". They are:

  * the text goes and the row stays, because `findings` and `evaluations`
    reference `interaction_id` and are the product;
  * a purge is provable — a NULL transcript that might just mean "none supplied"
    is not evidence of deletion;
  * a per-org policy beats the server default, in both directions;
  * purging is idempotent, so a second sweep is not a second write;
  * an API key cannot destroy the evidence it was used to create.

Requires the same environment as the rest of the suite: DATABASE_URL, HMAC_SECRET.
"""
from __future__ import annotations

import os
import sys
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

TRANSCRIPT = "Agent: This is an automated assistant. Caller: Member ID 12345."


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("EMAIL_BACKEND", "log")
    monkeypatch.setenv("APP_BASE_URL", "http://localhost:3000")
    return TestClient(app)


@pytest.fixture
def org():
    return create_org(f"Retention Co {uuid.uuid4().hex[:8]}", "free")


@pytest.fixture
def owner(org):
    address = f"owner-{uuid.uuid4().hex[:12]}@example.org"
    user = user_auth.create_user(address)
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_OWNER)
    return {"user": user, "email": address,
            "session": user_auth.create_session(user["user_id"])}


def _add_interaction(org_id: str, *, age_days: float = 0.0) -> str:
    """Insert one interaction holding a transcript, created `age_days` ago.

    Written directly rather than through the ingest path because the age is the
    variable under test, and ingest necessarily stamps `created_at` as now.
    """
    interaction_id = f"int_{uuid.uuid4().hex[:16]}"
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO interactions
                   (interaction_id, org_id, assessment_id, external_id, occurred_at,
                    source_vendor, source_type, ai_assessment, transcript,
                    transcription_status, created_at)
                   VALUES (%s,%s,%s,%s, NOW(), 'test', 'inbound', 'non_human', %s,
                           'unattested', NOW() - make_interval(secs => %s))""",
                (interaction_id, org_id, f"asmt_{uuid.uuid4().hex[:8]}",
                 f"ext_{uuid.uuid4().hex[:8]}", TRANSCRIPT, age_days * 86400),
            )
    finally:
        conn.close()
    return interaction_id


def _sign_in(client, org, owner) -> None:
    """Present both credentials: the org key identifies the tenant, the session
    identifies the person.

    `get_current_org` reads X-API-Key only (gateway.py:356), so a session cookie
    alone cannot resolve an organization — which is why these routes take both,
    matching the member-management routes.
    """
    client.headers.update({"X-API-Key": org["api_key"]})
    client.cookies.set(SESSION_COOKIE, owner["session"])


def _row(interaction_id: str):
    """The row as a dict.

    `saas_layer.db.get_conn` sets RealDictCursor, so a row is dict-like and
    unpacking one yields its keys, not its values — which is how the first run
    of these tests "found" a transcript equal to the string "transcript".
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT transcript, transcript_purged_at, external_id,
                          transcription_status
                   FROM interactions WHERE interaction_id = %s""",
                (interaction_id,),
            )
            return cur.fetchone()
    finally:
        conn.close()


def _set_policy(org_id: str, days):
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE orgs SET transcript_retention_days = %s WHERE org_id = %s",
                (days, org_id),
            )
    finally:
        conn.close()


# ── The scheduled sweep ───────────────────────────────────────────────────────

def test_text_past_the_window_is_redacted_and_the_row_survives(org):
    """The whole design in one assertion: text gone, evidence intact."""
    old = _add_interaction(org["org_id"], age_days=40)
    monitoring.purge_old_transcripts(default_retention_days=30)

    row = _row(old)
    assert row["transcript"] is None
    assert row["transcript_purged_at"] is not None, "a purge must be provable, not inferred from NULL"
    # Everything a finding or an auditor needs is still here.
    assert row["external_id"]
    assert row["transcription_status"] == "unattested"


def test_text_inside_the_window_is_left_alone(org):
    recent = _add_interaction(org["org_id"], age_days=5)
    monitoring.purge_old_transcripts(default_retention_days=30)

    row = _row(recent)
    assert row["transcript"] == TRANSCRIPT
    assert row["transcript_purged_at"] is None


def test_a_per_org_policy_overrides_the_server_default(org):
    """Both directions, because an override that only ever shortens is half a feature."""
    _set_policy(org["org_id"], 7)
    older_than_org_policy = _add_interaction(org["org_id"], age_days=10)
    inside_org_policy = _add_interaction(org["org_id"], age_days=3)

    # The server default of 90 would keep both; the org's 7 days must win.
    monitoring.purge_old_transcripts(default_retention_days=90)

    assert _row(older_than_org_policy)["transcript"] is None
    assert _row(inside_org_policy)["transcript"] == TRANSCRIPT


def test_a_longer_per_org_policy_also_wins(org):
    _set_policy(org["org_id"], 365)
    old = _add_interaction(org["org_id"], age_days=100)

    monitoring.purge_old_transcripts(default_retention_days=30)

    assert _row(old)["transcript"] == TRANSCRIPT, "a 365-day policy must survive a 30-day default"


def test_the_sweep_is_idempotent(org):
    """A second sweep over the same window must not rewrite purged_at."""
    old = _add_interaction(org["org_id"], age_days=40)
    first = monitoring.purge_old_transcripts(default_retention_days=30)
    purged_at = _row(old)["transcript_purged_at"]

    second = monitoring.purge_old_transcripts(default_retention_days=30)

    assert first["purged"] >= 1
    assert second["purged"] == 0, "WHERE transcript IS NOT NULL should make this a no-op"
    assert _row(old)["transcript_purged_at"] == purged_at


def test_the_sweep_reports_which_policy_did_the_work(org):
    _set_policy(org["org_id"], 7)
    _add_interaction(org["org_id"], age_days=10)
    counts = monitoring.purge_old_transcripts(default_retention_days=30)
    assert counts["per_org_policy"] >= 1
    assert set(counts) == {"purged", "per_org_policy", "default_policy"}


# ── Deletion on request ───────────────────────────────────────────────────────

def test_an_owner_can_purge_everything_now(client, org, owner):
    """Deletion on request is a different promise from deletion after N days."""
    fresh = _add_interaction(org["org_id"], age_days=0)
    _sign_in(client, org, owner)

    response = client.post("/saas/monitor/retention/purge", json={})

    assert response.status_code == 200
    assert response.json()["purged"] >= 1
    assert response.json()["requested_by"] == owner["email"]
    assert _row(fresh)["transcript"] is None


def test_before_days_limits_what_a_request_purges(client, org, owner):
    old = _add_interaction(org["org_id"], age_days=10)
    recent = _add_interaction(org["org_id"], age_days=1)
    _sign_in(client, org, owner)

    response = client.post("/saas/monitor/retention/purge", json={"before_days": 7})

    assert response.status_code == 200
    assert _row(old)["transcript"] is None
    assert _row(recent)["transcript"] == TRANSCRIPT, "a bounded request must not purge everything"


def test_a_single_interaction_can_be_purged(client, org, owner):
    target = _add_interaction(org["org_id"], age_days=0)
    bystander = _add_interaction(org["org_id"], age_days=0)
    _sign_in(client, org, owner)

    response = client.delete(f"/saas/monitor/interactions/{target}/transcript")

    assert response.status_code == 200
    assert response.json()["purged"] is True
    assert _row(target)["transcript"] is None
    assert _row(bystander)["transcript"] == TRANSCRIPT


def test_purging_an_already_purged_interaction_reports_false(client, org, owner):
    target = _add_interaction(org["org_id"], age_days=0)
    _sign_in(client, org, owner)
    client.delete(f"/saas/monitor/interactions/{target}/transcript")

    again = client.delete(f"/saas/monitor/interactions/{target}/transcript")

    assert again.status_code == 200
    assert again.json()["purged"] is False


def test_an_api_key_alone_cannot_purge(client, org):
    """The credential that creates evidence must not be able to destroy it.

    An ingest key lives in pipelines and CI. If it leaked, irreversible deletion
    should not be among the things it can do — and a deletion this permanent
    should carry a person's name.
    """
    fresh = _add_interaction(org["org_id"], age_days=0)

    response = client.post("/saas/monitor/retention/purge", json={},
                           headers={"X-API-Key": org["api_key"]})

    assert response.status_code in (401, 403)
    assert _row(fresh)["transcript"] == TRANSCRIPT


def test_another_orgs_interaction_is_not_purgeable(client, owner, org):
    """Tenant isolation on the destructive path, not just the read paths."""
    other = create_org(f"Other Co {uuid.uuid4().hex[:8]}", "free")
    theirs = _add_interaction(other["org_id"], age_days=0)
    _sign_in(client, org, owner)

    response = client.delete(f"/saas/monitor/interactions/{theirs}/transcript")

    assert response.status_code == 200
    assert response.json()["purged"] is False
    assert _row(theirs)["transcript"] == TRANSCRIPT


# ── Disclosure ────────────────────────────────────────────────────────────────

def test_retention_status_answers_what_do_you_have_on_us(client, org, owner):
    _add_interaction(org["org_id"], age_days=0)
    purged = _add_interaction(org["org_id"], age_days=40)
    monitoring.purge_old_transcripts(default_retention_days=30)
    _sign_in(client, org, owner)

    body = client.get("/saas/monitor/retention").json()

    assert body["retention_days"] == monitoring.DEFAULT_TRANSCRIPT_RETENTION_DAYS
    assert body["policy_source"] == "server_default"
    assert body["transcripts_held"] >= 1
    assert body["transcripts_purged"] >= 1
    assert body["oldest_held_at"] is not None
    # The disclosure itself must not leak what it is reporting on.
    assert TRANSCRIPT not in str(body)


def test_retention_status_names_an_org_policy_as_the_source(client, org, owner):
    _set_policy(org["org_id"], 14)
    _sign_in(client, org, owner)

    body = client.get("/saas/monitor/retention").json()

    assert body["retention_days"] == 14
    assert body["policy_source"] == "organization"


def test_the_default_is_thirty_days():
    """A constant worth pinning: it is quoted to customers."""
    assert monitoring.DEFAULT_TRANSCRIPT_RETENTION_DAYS == 30
