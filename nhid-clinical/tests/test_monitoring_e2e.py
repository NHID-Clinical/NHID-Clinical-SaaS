"""End-to-end tests for the monitoring and evidence product.

Drives the whole loop against a real Postgres:

    upload -> normalize -> evaluate -> finding -> evidence -> review -> report

Eight fixtures cover the cases a payer QA analyst actually sees, including the
three that most products quietly get wrong:

  * an escalation that was requested and never completed
  * an escalation whose outcome nobody recorded (reported UNKNOWN, not passed)
  * an interaction whose transcription quality is unattested

The last one matters because every other finding in this product rests on a
transcript it did not produce.
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas_layer.auth import create_org, init_db  # noqa: E402
from saas_layer import monitoring, normalization  # noqa: E402
from saas_layer.db import get_conn  # noqa: E402


# ── Fixtures: eight interactions, each a case a reviewer must be able to work ──

def _turn(speaker, text, offset_ms=None):
    return {"speaker": speaker, "text": text, "offset_ms": offset_ms}


ATTESTED = {"status": "measured", "wer": 0.11, "source": "internal evaluation"}

CASES = {
    # 1. Compliant: discloses on the opening turn, PHI only afterwards.
    "compliant": {
        "external_id": "CALL-0001",
        "occurred_at": "2026-09-01T14:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": ATTESTED,
        "turns": [
            _turn("agent", "Hello, I am an automated system calling on behalf of "
                           "Northside Clinic about a prior authorization.", 0),
            _turn("human", "Okay, go ahead."),
            _turn("agent", "Can you confirm the member ID on file?", 8000),
            _turn("human", "It's on the referral."),
        ],
    },
    # 2. Never disclosed at all.
    "missing_disclosure": {
        "external_id": "CALL-0002",
        "occurred_at": "2026-09-01T15:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": ATTESTED,
        "turns": [
            _turn("agent", "Hi, I'm calling about a prior authorization.", 0),
            _turn("human", "Sure, which member?"),
            _turn("agent", "Thanks, I'll hold.", 5000),
        ],
    },
    # 3. Disclosed, but three turns in rather than on the opening turn.
    "delayed_disclosure": {
        "external_id": "CALL-0003",
        "occurred_at": "2026-09-01T16:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": ATTESTED,
        "turns": [
            _turn("agent", "Good morning, calling about an authorization.", 0),
            _turn("human", "Who's calling?"),
            _turn("agent", "I should mention I am an AI assistant for the clinic.", 12000),
        ],
    },
    # 4. Asked for member data before saying what it was.
    "phi_before_disclosure": {
        "external_id": "CALL-0004",
        "occurred_at": "2026-09-01T17:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": ATTESTED,
        "turns": [
            _turn("agent", "Hello, can you give me the member ID and date of birth?", 0),
            _turn("human", "Who am I speaking with?"),
            _turn("agent", "I am an automated assistant.", 9000),
        ],
    },
    # 5. Escalation requested and completed.
    "escalation_completed": {
        "external_id": "CALL-0005",
        "occurred_at": "2026-09-01T18:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": ATTESTED,
        "turns": [
            _turn("agent", "I am an AI assistant calling about a claim.", 0),
            _turn("human", "I want to speak to a human about this."),
            _turn("agent", "Of course, transferring you to a representative now.", 6000),
        ],
    },
    # 6. Escalation requested and refused. The governance failure that matters.
    "escalation_not_completed": {
        "external_id": "CALL-0006",
        "occurred_at": "2026-09-01T19:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": ATTESTED,
        "turns": [
            _turn("agent", "I am an automated system calling about a denial.", 0),
            _turn("human", "Can you transfer me to a real person?"),
            _turn("agent", "I can help you with that instead. What is the claim number?", 7000),
        ],
    },
    # 7. Escalation requested; the recording ends. Nobody knows what happened.
    "escalation_outcome_unknown": {
        "external_id": "CALL-0007",
        "occurred_at": "2026-09-01T20:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": ATTESTED,
        "turns": [
            _turn("agent", "I am an AI assistant for the clinic.", 0),
            _turn("human", "Please get me a supervisor."),
        ],
    },
    # 8. Structurally fine, but nobody has stated how good the transcript is.
    "unattested_transcription": {
        "external_id": "CALL-0008",
        "occurred_at": "2026-09-01T21:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": None,
        "turns": [
            _turn("agent", "I am an automated system calling about eligibility.", 0),
            _turn("human", "Go ahead."),
        ],
    },
}


@pytest.fixture(scope="module")
def org():
    init_db()
    monitoring.init_monitoring_tables()
    record = create_org("E2E Monitoring Test Org")
    yield record
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            for table in ("review_events", "time_entries", "findings",
                          "evaluations", "interactions", "assessments"):
                cur.execute(f"DELETE FROM {table} WHERE org_id = %s", (record["org_id"],))
            cur.execute("DELETE FROM orgs WHERE org_id = %s", (record["org_id"],))
    finally:
        conn.close()


@pytest.fixture(scope="module")
def loaded(org):
    """Ingest and evaluate all eight fixtures once."""
    assessment = monitoring.create_assessment(
        org["org_id"], "Q3 baseline", "2026-09-01", "2026-09-30", is_synthetic=True
    )
    ids = {}
    for name, payload in CASES.items():
        canonical = normalization.normalize(payload, "generic")
        ids[name] = monitoring.ingest_interaction(
            org["org_id"], assessment["assessment_id"], canonical, is_synthetic=True
        )
    monitoring.evaluate_assessment(org["org_id"], assessment["assessment_id"])
    return {"assessment": assessment, "ids": ids, "org_id": org["org_id"]}


def _result_for(detail, control):
    return next(e["result"] for e in detail["evaluations"] if e["control_id"] == control)


# ── Normalization ─────────────────────────────────────────────────────────────

def test_vendor_payloads_reach_one_canonical_shape():
    """The governance engine must never see a vendor-specific payload."""
    twilio = normalization.normalize({
        "CallSid": "CA123", "StartTime": "2026-09-01T10:00:00Z",
        "segments": [{"channel": "1", "text": "I am an automated system."},
                     {"channel": "2", "text": "Go ahead."}],
    }, "twilio")
    vapi = normalization.normalize({
        "message": {"call": {"id": "V123", "createdAt": "2026-09-01T10:00:00Z"},
                    "transcript": [{"role": "assistant", "message": "I am an AI assistant."},
                                   {"role": "user", "message": "Okay."}]},
    }, "vapi")
    for shape in (twilio, vapi):
        assert set(shape) >= {"external_id", "occurred_at", "turns", "ai_assessment",
                              "transcription_attestation"}
        assert shape["turns"][0]["speaker"] == normalization.SPEAKER_AGENT
        assert shape["turns"][1]["speaker"] == normalization.SPEAKER_HUMAN


def test_unknown_vendor_is_refused_not_guessed():
    with pytest.raises(normalization.NormalizationError):
        normalization.normalize({"external_id": "x"}, "nope")


def test_attestation_without_a_figure_is_downgraded_to_unattested():
    """Claiming 'measured' with no WER asserts a precision nobody reported."""
    att = normalization.normalize_attestation({"status": "measured", "wer": None})
    assert att["status"] == "unattested"


# ── Evaluation: each fixture lands where it should ────────────────────────────

def test_compliant_interaction_passes_every_control(loaded):
    detail = monitoring.get_interaction(loaded["org_id"], loaded["ids"]["compliant"])
    assert _result_for(detail, "IDG-01") == monitoring.RESULT_PASS
    assert _result_for(detail, "PDX-01") == monitoring.RESULT_PASS
    assert _result_for(detail, "EIT-01") == monitoring.RESULT_PASS
    assert detail["facts"]["impersonation_latency_turns"] == 0
    assert detail["findings"] == []


def test_missing_disclosure_raises_a_finding(loaded):
    detail = monitoring.get_interaction(loaded["org_id"], loaded["ids"]["missing_disclosure"])
    assert _result_for(detail, "IDG-01") == monitoring.RESULT_EXCEPTION
    assert any(f["category"] == monitoring.CAT_DISCLOSURE_MISSING for f in detail["findings"])


def test_delayed_disclosure_reports_its_impersonation_latency(loaded):
    detail = monitoring.get_interaction(loaded["org_id"], loaded["ids"]["delayed_disclosure"])
    assert _result_for(detail, "IDG-01") == monitoring.RESULT_EXCEPTION
    assert detail["facts"]["impersonation_latency_turns"] == 2
    assert detail["facts"]["impersonation_latency_seconds"] == 12.0


def test_phi_before_disclosure_raises_a_finding(loaded):
    detail = monitoring.get_interaction(loaded["org_id"], loaded["ids"]["phi_before_disclosure"])
    assert _result_for(detail, "PDX-01") == monitoring.RESULT_EXCEPTION
    assert any(f["category"] == monitoring.CAT_PHI_BEFORE_DISCLOSURE
               for f in detail["findings"])


def test_completed_escalation_passes(loaded):
    detail = monitoring.get_interaction(loaded["org_id"], loaded["ids"]["escalation_completed"])
    assert _result_for(detail, "EIT-01") == monitoring.RESULT_PASS
    assert detail["facts"]["escalation_state"] == "escalation_completed"


def test_refused_escalation_is_an_exception(loaded):
    detail = monitoring.get_interaction(
        loaded["org_id"], loaded["ids"]["escalation_not_completed"])
    assert _result_for(detail, "EIT-01") == monitoring.RESULT_EXCEPTION
    assert any(f["category"] == monitoring.CAT_ESCALATION_NOT_COMPLETED
               for f in detail["findings"])


def test_unrecorded_escalation_outcome_is_unknown_not_pass(loaded):
    """The whole point of a four-state result. Reporting this as a pass would
    assert a completion nobody observed."""
    detail = monitoring.get_interaction(
        loaded["org_id"], loaded["ids"]["escalation_outcome_unknown"])
    assert _result_for(detail, "EIT-01") == monitoring.RESULT_UNKNOWN
    assert any(f["category"] == monitoring.CAT_ESCALATION_OUTCOME_UNKNOWN
               for f in detail["findings"])


def test_unattested_transcription_is_surfaced_not_ignored(loaded):
    detail = monitoring.get_interaction(
        loaded["org_id"], loaded["ids"]["unattested_transcription"])
    assert _result_for(detail, "ATR-01") == monitoring.RESULT_UNKNOWN
    assert any(f["category"] == monitoring.CAT_TRANSCRIPTION_UNATTESTED
               for f in detail["findings"])


def test_every_evaluation_carries_an_explanation(loaded):
    """A user must be able to answer 'why did NHID flag this?' without reading code."""
    for iid in loaded["ids"].values():
        detail = monitoring.get_interaction(loaded["org_id"], iid)
        for evaluation in detail["evaluations"]:
            assert len(evaluation["explanation"]) > 20


# ── Review workflow ───────────────────────────────────────────────────────────

def test_a_finding_can_be_reviewed_and_resolved(loaded):
    findings = monitoring.list_findings(
        loaded["org_id"], assessment_id=loaded["assessment"]["assessment_id"],
        status=monitoring.FINDING_OPEN)
    assert findings
    target = findings[0]["finding_id"]

    monitoring.update_finding(loaded["org_id"], target,
                              status=monitoring.FINDING_UNDER_REVIEW,
                              reviewer="qa.analyst", notes="Checking the recording.")
    monitoring.update_finding(loaded["org_id"], target,
                              status=monitoring.FINDING_RESOLVED,
                              resolution=monitoring.RESOLUTION_REMEDIATED,
                              reviewer="qa.analyst",
                              remediation="Vendor updated the opening script.")

    resolved = monitoring.get_finding(loaded["org_id"], target)
    assert resolved["status"] == monitoring.FINDING_RESOLVED
    assert resolved["resolution"] == monitoring.RESOLUTION_REMEDIATED
    assert resolved["resolved_at"] is not None
    # The review history is evidence, not metadata about evidence.
    assert len(resolved["review_history"]) >= 2
    assert resolved["review_history"][0]["reviewer"] == "qa.analyst"


def test_invalid_status_is_refused(loaded):
    findings = monitoring.list_findings(loaded["org_id"])
    with pytest.raises(ValueError):
        monitoring.update_finding(loaded["org_id"], findings[0]["finding_id"],
                                  status="wontfix")


def test_reviewer_effort_is_recorded_without_claiming_a_saving(loaded):
    monitoring.record_time(loaded["org_id"], loaded["assessment"]["assessment_id"],
                           "finding_review", 12.5, reviewer="qa.analyst")
    metrics = monitoring.compute_metrics(
        loaded["org_id"], loaded["assessment"]["assessment_id"])
    assert metrics["review_effort_minutes"] >= 12.5
    # Measurement infrastructure only: no computed saving anywhere in the payload.
    assert "savings" not in metrics and "roi" not in metrics


# ── Metrics and report ────────────────────────────────────────────────────────

def test_metrics_are_computed_from_rows_with_stated_denominators(loaded):
    metrics = monitoring.compute_metrics(
        loaded["org_id"], loaded["assessment"]["assessment_id"])
    assert metrics["interactions_analyzed"] == len(CASES)
    assert metrics["non_human_interactions"] == len(CASES)
    # 7 of 8 disclose; only "missing_disclosure" does not.
    assert metrics["disclosure"]["disclosed"] == 7
    assert metrics["disclosure"]["denominator"] == 8
    assert metrics["escalation"]["requested"] == 3
    assert metrics["escalation"]["completed"] == 1
    assert metrics["escalation"]["not_completed"] == 1
    assert metrics["escalation"]["outcome_unknown"] == 1
    assert metrics["phi_before_disclosure"]["count"] == 1
    assert metrics["transcription_attestation"]["unattested"] == 1


def test_no_composite_score_anywhere_in_metrics(loaded):
    """There is no trust score, no tier and no blended grade. Ever."""
    metrics = monitoring.compute_metrics(
        loaded["org_id"], loaded["assessment"]["assessment_id"])
    flat = str(metrics).lower()
    for banned in ("verified trust", "conditional trust", "badge", "trust_score",
                   "cas", "grade", "safety score"):
        assert banned not in flat, f"a withdrawn score concept reappeared: {banned}"


def test_impersonation_latency_is_reported_with_its_non_claims(loaded):
    metrics = monitoring.compute_metrics(
        loaded["org_id"], loaded["assessment"]["assessment_id"])
    il = metrics["impersonation_latency"]
    assert il["disclosed_on_opening_turn"] >= 1
    definition = il["definition"].lower()
    assert "disclosure timing only" in definition
    assert "neither impersonation" in definition


def test_report_states_its_limitations_and_never_certifies(loaded):
    report = monitoring.build_report(
        loaded["org_id"], loaded["assessment"]["assessment_id"])
    assert report["title"] == "Healthcare Voice-AI Governance Assessment"
    assert report["metrics"]["interactions_analyzed"] == len(CASES)
    assert report["synthetic_records"] == len(CASES)

    joined = " ".join(report["limitations"]).lower()
    assert "not a certification" in joined
    assert "does not perform speech recognition" in joined
    assert "synthetic" in joined

    # Scan everything except the limitations, which legitimately contain these
    # words in order to disclaim them ("...or an approval of any party").
    body = {k: v for k, v in report.items() if k != "limitations"}
    blob = str(body).lower()
    for banned in ("certified", "compliance certificate", "verified trust",
                   "approval of", "trust score", "badge"):
        assert banned not in blob, f"report implies {banned}"


def test_repeated_assessments_are_independent(org):
    """A monitoring service runs again next quarter; the two must not mix."""
    second = monitoring.create_assessment(org["org_id"], "Q4 baseline", is_synthetic=True)
    canonical = normalization.normalize(CASES["compliant"], "generic")
    monitoring.ingest_interaction(org["org_id"], second["assessment_id"], canonical, True)
    monitoring.evaluate_assessment(org["org_id"], second["assessment_id"])

    q4 = monitoring.compute_metrics(org["org_id"], second["assessment_id"])
    assert q4["interactions_analyzed"] == 1


def test_ingestion_is_idempotent(org):
    """Re-uploading the same export must not double-count."""
    assessment = monitoring.create_assessment(org["org_id"], "Dedup", is_synthetic=True)
    canonical = normalization.normalize(CASES["compliant"], "generic")
    first = monitoring.ingest_interaction(org["org_id"], assessment["assessment_id"],
                                          canonical, True)
    second = monitoring.ingest_interaction(org["org_id"], assessment["assessment_id"],
                                           canonical, True)
    assert first == second
    metrics = monitoring.compute_metrics(org["org_id"], assessment["assessment_id"])
    assert metrics["interactions_analyzed"] == 1


def test_tenant_isolation(org):
    """One org must never see another's interactions."""
    other = create_org("Other Monitoring Org")
    try:
        assert monitoring.list_interactions(other["org_id"]) == []
        assert monitoring.list_findings(other["org_id"]) == []
        assert monitoring.compute_metrics(other["org_id"])["interactions_analyzed"] == 0
    finally:
        conn = get_conn()
        try:
            with conn:
                conn.cursor().execute("DELETE FROM orgs WHERE org_id = %s", (other["org_id"],))
        finally:
            conn.close()


# ── Over real HTTP, through the gateway ───────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from saas_layer.gateway import app
    return TestClient(app)


def test_full_loop_over_http(client, org):
    """upload -> normalize -> evaluate -> finding -> evidence -> review -> report,
    entirely through the public API surface."""
    headers = {"X-API-Key": org["api_key"]}

    created = client.post("/saas/monitor/assessments",
                          json={"name": "HTTP loop", "is_synthetic": True}, headers=headers)
    assert created.status_code == 200, created.text
    assessment_id = created.json()["assessment_id"]

    ingested = client.post("/saas/monitor/ingest", headers=headers, json={
        "assessment_id": assessment_id, "vendor": "generic", "is_synthetic": True,
        "interactions": [CASES["escalation_not_completed"], CASES["missing_disclosure"]],
    })
    assert ingested.status_code == 200, ingested.text
    assert ingested.json()["ingested"] == 2
    assert ingested.json()["errors"] == []

    evaluated = client.post(
        f"/saas/monitor/assessments/{assessment_id}/evaluate", headers=headers)
    assert evaluated.status_code == 200
    assert evaluated.json()["evaluated"] == 2
    assert evaluated.json()["findings_created"] >= 2

    listing = client.get(f"/saas/monitor/interactions?assessment_id={assessment_id}",
                         headers=headers)
    assert listing.status_code == 200
    assert len(listing.json()["interactions"]) == 2

    detail = client.get(
        f"/saas/monitor/interactions/{listing.json()['interactions'][0]['interaction_id']}",
        headers=headers)
    assert detail.status_code == 200
    assert detail.json()["evaluations"]
    assert all(e["explanation"] for e in detail.json()["evaluations"])

    findings = client.get(f"/saas/monitor/findings?assessment_id={assessment_id}",
                          headers=headers)
    assert findings.status_code == 200
    finding_id = findings.json()["findings"][0]["finding_id"]

    reviewed = client.patch(f"/saas/monitor/findings/{finding_id}", headers=headers, json={
        "status": "resolved", "resolution": "remediated",
        "reviewer": "qa.analyst", "notes": "Confirmed on the recording.",
    })
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "resolved"

    assert client.post("/saas/monitor/time-entries", headers=headers, json={
        "assessment_id": assessment_id, "activity": "finding_review", "minutes": 9,
    }).status_code == 200

    report = client.get(f"/saas/monitor/assessments/{assessment_id}/report", headers=headers)
    assert report.status_code == 200
    body = report.json()
    assert body["title"] == "Healthcare Voice-AI Governance Assessment"
    assert body["metrics"]["interactions_analyzed"] == 2
    assert body["synthetic_records"] == 2
    assert any("not a certification" in l.lower() for l in body["limitations"])


def test_monitoring_endpoints_require_a_key(client):
    for path in ("/saas/monitor/assessments", "/saas/monitor/interactions",
                 "/saas/monitor/findings", "/saas/monitor/metrics"):
        assert client.get(path).status_code == 401, path


def test_the_withdrawn_badge_endpoint_is_gone(client, org):
    """A public 'NHID Verified' SVG tied to subscription tier, not measurement."""
    assert client.get(f"/saas/badge/{org['org_id']}").status_code == 404
