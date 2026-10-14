"""Pilot run registry: self-reported, never observed, never rounded up.

The Tier 0 kit runs offline and sends nothing. That is the product's strongest
claim, so this registry exists instead of telemetry — a person exports a report
and submits it deliberately.

The tests that matter are therefore not "does the insert work". They are the
three distinctions the whole design rests on, each of which a future change
could quietly erase:

  * self-reported never becomes verified, including when the submitter says so;
  * the submitter's clock never becomes ours;
  * missing evidence never becomes a pass;

plus the refusal that protects the submitter: a payload carrying conversational
content is rejected, not stored.

Requires the same environment as the rest of the suite: DATABASE_URL, HMAC_SECRET.
"""
from __future__ import annotations

import os
import sys
import uuid

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas_layer import pilot_runs, user_auth  # noqa: E402
from saas_layer.auth import create_org  # noqa: E402
from saas_layer.gateway import SESSION_COOKIE, app  # noqa: E402

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"
)

GOOD = {
    "executed_at": "2026-10-10T14:00:00Z",
    "executed_tz": "America/New_York",
    "scenario_id": "tier0-baseline",
    "scenario_version": "1.0",
    "evaluator_version": "1.3",
    "completed": True,
    "result_status": "pass",
    "control_decisions": {"DENY_DATA": 3, "ESCALATE_HUMAN": 1},
    "metrics": {"calls_evaluated": 120},
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("EMAIL_BACKEND", "log")
    monkeypatch.setenv("APP_BASE_URL", "http://localhost:3000")
    return TestClient(app)


@pytest.fixture
def org():
    return create_org(f"Pilot Co {uuid.uuid4().hex[:8]}", "free")


@pytest.fixture
def owner(org):
    address = f"owner-{uuid.uuid4().hex[:12]}@example.org"
    user = user_auth.create_user(address)
    user_auth.add_member(org["org_id"], user["user_id"], user_auth.ROLE_OWNER)
    return {"user": user, "email": address,
            "session": user_auth.create_session(user["user_id"])}


def _sign_in(client, org, owner) -> None:
    client.headers.update({"X-API-Key": org["api_key"]})
    client.cookies.set(SESSION_COOKIE, owner["session"])


# ── The three distinctions ────────────────────────────────────────────────────

def test_a_submission_is_always_self_reported(client, org, owner):
    """Nothing in this system can confirm a run happened. Nothing may claim to."""
    _sign_in(client, org, owner)
    body = client.post("/saas/pilot/runs", json=GOOD).json()
    assert body["verification"] == pilot_runs.VERIFICATION_SELF


def test_a_submitter_cannot_mark_their_own_run_verified(client, org, owner):
    """The obvious attack on a trust label: claim it in the payload."""
    _sign_in(client, org, owner)
    body = client.post("/saas/pilot/runs",
                       json={**GOOD, "verification": "verified"}).json()
    assert body["verification"] == pilot_runs.VERIFICATION_SELF

    run = pilot_runs.get_run(org["org_id"], body["run_id"])
    assert run["verification"] == pilot_runs.VERIFICATION_SELF


def test_their_execution_time_is_kept_apart_from_our_ingestion_time(client, org, owner):
    _sign_in(client, org, owner)
    run_id = client.post("/saas/pilot/runs", json=GOOD).json()["run_id"]

    run = pilot_runs.get_run(org["org_id"], run_id)
    assert run["executed_at"] is not None
    assert run["ingested_at"] is not None
    # Reported 2026-10-10; ingested now. Collapsing these would present the
    # submitter's clock as this service's observation.
    assert run["executed_at"] != run["ingested_at"]
    assert run["executed_tz"] == "America/New_York"


def test_missing_result_does_not_become_a_pass(client, org, owner):
    _sign_in(client, org, owner)
    minimal = {"scenario_id": "tier0-baseline"}
    body = client.post("/saas/pilot/runs", json=minimal).json()
    assert body["result_status"] == pilot_runs.RESULT_NOT_EVALUATED


def test_inconclusive_is_storable_as_itself(client, org, owner):
    """An assertion nobody could evaluate needs somewhere honest to go."""
    _sign_in(client, org, owner)
    body = client.post("/saas/pilot/runs", json={
        **GOOD, "result_status": "inconclusive",
        "failure_reason": "no transfer event available from the integration",
    }).json()
    assert body["result_status"] == "inconclusive"


def test_an_unknown_result_status_is_refused(client, org, owner):
    _sign_in(client, org, owner)
    r = client.post("/saas/pilot/runs", json={**GOOD, "result_status": "green"})
    assert r.status_code == 422


# ── Protecting the submitter ──────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [
    {"transcript": "Agent: hello. Caller: member ID 12345"},
    {"results": {"turns": [{"speech_text": "member ID 12345"}]}},
    {"audio": "base64..."},
    {"member_id": "A123456789"},
])
def test_conversational_content_is_rejected_not_stored(client, org, owner, bad):
    """Rejected, not redacted.

    A submitter who sends a transcript and gets a 200 would reasonably believe
    we are holding it. A refusal tells them the truth and leaves the data with
    them.
    """
    _sign_in(client, org, owner)
    before = pilot_runs.summary(org["org_id"])["total_runs"]

    response = client.post("/saas/pilot/runs", json={**GOOD, **bad})

    assert response.status_code == 422
    assert "not stored" in response.json()["detail"]
    assert pilot_runs.summary(org["org_id"])["total_runs"] == before


def test_an_oversized_report_is_refused():
    with pytest.raises(pilot_runs.SubmissionRejected) as exc:
        pilot_runs.validate_payload({"metrics": {"x": "y" * (300 * 1024)}})
    assert "KB" in str(exc.value)


def test_only_recognised_control_decisions_are_counted(client, org, owner):
    """A submitter cannot invent a control by naming one."""
    _sign_in(client, org, owner)
    run_id = client.post("/saas/pilot/runs", json={
        **GOOD,
        "control_decisions": {"DENY_DATA": 2, "TOTALLY_FINE": 99, "LOG_ONLY": True},
    }).json()["run_id"]

    decisions = pilot_runs.get_run(org["org_id"], run_id)["control_decisions"]
    assert decisions == {"DENY_DATA": 2}  # invented name dropped; bool is not a count


# ── Location ──────────────────────────────────────────────────────────────────

def test_country_is_accepted_only_as_a_two_letter_code(client, org, owner):
    _sign_in(client, org, owner)
    assert client.post("/saas/pilot/runs",
                       json={**GOOD, "reported_country": "Ohio"}).status_code == 422
    assert client.post("/saas/pilot/runs",
                       json={**GOOD, "reported_country": "US"}).status_code == 201


def test_a_country_with_one_run_is_suppressed_in_the_summary(client, org, owner):
    """One run plus a country is close enough to naming the organization."""
    _sign_in(client, org, owner)
    client.post("/saas/pilot/runs", json={**GOOD, "reported_country": "CA"})

    countries = pilot_runs.summary(org["org_id"])["countries"]
    assert all(c["country"] != "CA" for c in countries)


def test_no_location_is_invented_when_none_is_supplied(client, org, owner):
    _sign_in(client, org, owner)
    run_id = client.post("/saas/pilot/runs", json=GOOD).json()["run_id"]
    assert pilot_runs.get_run(org["org_id"], run_id)["reported_country"] is None


# ── Authorization ─────────────────────────────────────────────────────────────

def test_an_api_key_alone_cannot_submit_a_run(client, org):
    """A person attests that they ran this; a pipeline credential cannot."""
    response = client.post("/saas/pilot/runs", json=GOOD,
                           headers={"X-API-Key": org["api_key"]})
    assert response.status_code in (401, 403)


def test_one_org_cannot_read_anothers_runs(client, org, owner):
    _sign_in(client, org, owner)
    run_id = client.post("/saas/pilot/runs", json=GOOD).json()["run_id"]

    other = create_org(f"Other Co {uuid.uuid4().hex[:8]}", "free")
    assert pilot_runs.get_run(other["org_id"], run_id) is None


# ── Evidence record ───────────────────────────────────────────────────────────

def test_the_evidence_record_carries_its_own_limitations(client, org, owner):
    _sign_in(client, org, owner)
    run_id = client.post("/saas/pilot/runs", json=GOOD).json()["run_id"]

    report = client.get(f"/saas/pilot/runs/{run_id}/evidence").json()

    assert report["provenance"]["verification"] == pilot_runs.VERIFICATION_SELF
    assert report["provenance"]["payload_sha256"]
    # The document outlives this conversation and will be read by someone who
    # was not here. It has to say what it is on its own.
    blob = " ".join(report["limitations"]).lower()
    assert "self-reported" in blob
    assert "not a pass" in blob
    assert "enforced" in blob
    assert "does not attest" in report["provenance"]["integrity_note"]


def test_the_hash_is_stable_for_the_same_payload():
    first = pilot_runs.canonical_hash(GOOD)
    assert first == pilot_runs.canonical_hash(dict(reversed(list(GOOD.items()))))
    assert first != pilot_runs.canonical_hash({**GOOD, "result_status": "fail"})


def test_missing_run_is_404(client, org, owner):
    _sign_in(client, org, owner)
    assert client.get("/saas/pilot/runs/run_nope/evidence").status_code == 404


# ── Honest empty state ────────────────────────────────────────────────────────

def test_an_org_with_no_runs_reports_zero_not_nothing(org):
    """The dashboard needs something to render "none reported yet" from."""
    s = pilot_runs.summary(org["org_id"])
    assert s["total_runs"] == 0
    assert s["by_result"] == {"pass": 0, "fail": 0, "inconclusive": 0,
                              "not_evaluated": 0}
    assert s["countries"] == []
    assert s["last_ingested_at"] is None
    assert s["is_telemetry"] is False


def test_the_summary_says_it_is_not_telemetry(client, org, owner):
    _sign_in(client, org, owner)
    client.post("/saas/pilot/runs", json=GOOD)

    body = client.get("/saas/pilot/summary").json()

    assert body["is_telemetry"] is False
    assert body["verified"] == 0
    assert "offline" in body["note"].lower()


# ── The pre-submission notice ─────────────────────────────────────────────────

def test_the_notice_is_readable_before_anyone_submits(client):
    """Someone deciding whether to submit should not need credentials to read
    what submitting would transmit."""
    response = client.get("/saas/pilot/submission-notice")
    assert response.status_code == 200
    body = response.json()
    assert body["what_is_transmitted"]
    joined = " ".join(body["what_is_never_transmitted"]).lower()
    assert "transcript" in joined and "phi" in joined
    assert "no network calls" in body["the_kit_itself"].lower()


# ── Data classification ────────────────────────────────────────────────────────
# A separate axis from verification: what *kind* of data the run was scored on.
# The submitter declares it; it defaults to the most conservative tier; it never
# rounds up; and it never becomes evidence of verification.

def test_classification_defaults_to_synthetic_when_omitted(client, org, owner):
    """A silent row is labelled synthetic — the most conservative tier, and what
    the offline Tier 0 kit actually produces. It never defaults to something
    stronger than the submitter claimed."""
    _sign_in(client, org, owner)
    body = client.post("/saas/pilot/runs", json=GOOD).json()
    assert body["data_classification"] == pilot_runs.CLASSIFICATION_SYNTHETIC
    run = pilot_runs.get_run(org["org_id"], body["run_id"])
    assert run["data_classification"] == "synthetic"


@pytest.mark.parametrize("value", ["synthetic", "deidentified", "production_derived"])
def test_each_classification_round_trips(client, org, owner, value):
    _sign_in(client, org, owner)
    body = client.post("/saas/pilot/runs",
                       json={**GOOD, "data_classification": value}).json()
    assert body["data_classification"] == value
    assert pilot_runs.get_run(org["org_id"], body["run_id"])["data_classification"] == value


def test_an_unknown_classification_is_refused(client, org, owner):
    """An illegal tier is refused outright — not coerced to synthetic, which
    would hide a submitter's mistake, and not stored, which the DB CHECK would
    reject anyway."""
    _sign_in(client, org, owner)
    r = client.post("/saas/pilot/runs",
                    json={**GOOD, "data_classification": "real-ish"})
    assert r.status_code == 422
    assert "data_classification" in r.json()["detail"]


def test_classification_is_independent_of_verification(client, org, owner):
    """A run on production-derived data is still self-reported. The two axes
    must not bleed into each other — a higher data tier is not verification."""
    _sign_in(client, org, owner)
    body = client.post("/saas/pilot/runs",
                       json={**GOOD, "data_classification": "production_derived"}).json()
    assert body["data_classification"] == "production_derived"
    assert body["verification"] == pilot_runs.VERIFICATION_SELF


def test_evidence_record_carries_the_classification(client, org, owner):
    _sign_in(client, org, owner)
    run_id = client.post("/saas/pilot/runs",
                         json={**GOOD, "data_classification": "deidentified"}).json()["run_id"]
    report = client.get(f"/saas/pilot/runs/{run_id}/evidence").json()
    assert report["provenance"]["data_classification"] == "deidentified"
    assert "separate axis" in report["provenance"]["classification_note"].lower()


def test_summary_breaks_down_by_classification(client, org, owner):
    _sign_in(client, org, owner)
    client.post("/saas/pilot/runs", json={**GOOD, "data_classification": "synthetic"})
    client.post("/saas/pilot/runs", json={**GOOD, "data_classification": "deidentified"})
    by = client.get("/saas/pilot/summary").json()["by_data_classification"]
    assert by["synthetic"] >= 1
    assert by["deidentified"] >= 1


def test_empty_state_reports_zero_classifications_not_nothing(org):
    s = pilot_runs.summary(org["org_id"])
    assert s["by_data_classification"] == {
        "synthetic": 0, "deidentified": 0, "production_derived": 0,
    }


# ── Audit ─────────────────────────────────────────────────────────────────────

def _audit_events(org_id: str):
    from saas_layer.db import get_conn
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT event_type FROM audit_traces
                   WHERE org_id = %s AND session_id = 'pilot-submission'""",
                (org_id,),
            )
            return [r["event_type"] for r in cur.fetchall()]
    finally:
        conn.close()


def test_submission_and_rejection_both_reach_the_audit_chain(client, org, owner):
    """Regression test for a bug these tests found.

    The first version of this feature omitted `state_before`/`state_after`,
    which are NOT NULL on `audit_traces`. Every append_trace call failed and the
    error was swallowed by the handler that exists so a broken audit write
    cannot fail a request. The feature claimed audit events and wrote none.

    A swallowed error is invisible by construction, so the only way to know the
    chain is actually being written is to read it back.
    """
    _sign_in(client, org, owner)
    client.post("/saas/pilot/runs", json=GOOD)
    client.post("/saas/pilot/runs", json={**GOOD, "transcript": "nope"})

    events = _audit_events(org["org_id"])
    assert "pilot_run_submitted" in events
    assert "pilot_run_rejected" in events, "a refusal is a thing that happened"


def test_evidence_access_is_audited(client, org, owner):
    _sign_in(client, org, owner)
    run_id = client.post("/saas/pilot/runs", json=GOOD).json()["run_id"]
    client.get(f"/saas/pilot/runs/{run_id}/evidence")
    assert "pilot_evidence_accessed" in _audit_events(org["org_id"])
