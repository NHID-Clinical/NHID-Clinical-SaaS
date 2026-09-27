"""Cross-workspace isolation for the org-scoped API.

One organization's evaluations, findings and evidence must never be reachable
with another organization's API key. That is the security boundary the whole
multi-tenant product rests on, and it had no test.

The approach is deliberately empirical rather than a reading of each handler.
Every org-scoped route takes its `org_id` from the authenticated dependency and
passes it to a query that filters on it -- but "every" is a claim about code
nobody re-checks after the next route is added. So this file creates two real
organizations, gives one of them real data through the real evaluation engine,
and then tries to reach that data with the other one's key, by identifier, on
every route that accepts one.

A route added later without its org filter fails here.

Requires the same environment as the rest of the suite: DATABASE_URL, HMAC_SECRET.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas_layer.auth import create_org, init_db  # noqa: E402
from saas_layer.db import get_conn  # noqa: E402
from saas_layer import monitoring  # noqa: E402
from saas_layer.gateway import app  # noqa: E402


ATTESTED = {"status": "measured", "wer": 0.09, "source": "internal evaluation"}

# Two interactions: one that passes every control and one that raises a finding,
# so the victim org owns both an interaction id and a finding id to try to reach.
INTERACTIONS = [
    {
        "external_id": "ISO-0001",
        "occurred_at": "2026-09-02T10:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": ATTESTED,
        "turns": [
            {"speaker": "agent", "offset_ms": 0,
             "text": "Hello, I am an automated system calling on behalf of "
                     "Northside Clinic about a prior authorization."},
            {"speaker": "human", "offset_ms": None, "text": "Go ahead."},
        ],
    },
    {
        "external_id": "ISO-0002",
        "occurred_at": "2026-09-02T11:00:00Z",
        "ai_assessment": "non_human",
        "transcription_attestation": ATTESTED,
        "turns": [
            {"speaker": "agent", "offset_ms": 0,
             "text": "Hi, I'm calling about a prior authorization for member "
                     "A123456789."},
            {"speaker": "human", "offset_ms": None, "text": "Which member?"},
        ],
    },
]


def _drop_org(org_id: str) -> None:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            for table in ("review_events", "time_entries", "findings",
                          "evaluations", "interactions", "assessments",
                          "usage_log"):
                cur.execute(f"DELETE FROM {table} WHERE org_id = %s", (org_id,))
            cur.execute("DELETE FROM orgs WHERE org_id = %s", (org_id,))
    finally:
        conn.close()


@pytest.fixture(scope="module")
def client():
    init_db()
    monitoring.init_monitoring_tables()
    return TestClient(app)


@pytest.fixture(scope="module")
def tenants(client):
    """Two organizations. `owner` holds real evaluated data; `intruder` holds none.

    The data is produced by driving the real ingest-and-evaluate path, not by
    inserting rows, so the identifiers under test are the ones the product
    actually issues.
    """
    owner = create_org("Isolation Owner Org")
    intruder = create_org("Isolation Intruder Org")

    owner_headers = {"X-API-Key": owner["api_key"]}
    created = client.post(
        "/saas/monitor/assessments",
        headers=owner_headers,
        json={"name": "Isolation fixture", "period_start": "2026-09-01",
              "period_end": "2026-09-30", "is_synthetic": True},
    )
    assert created.status_code == 200, created.text
    assessment_id = created.json()["assessment_id"]

    ingested = client.post(
        "/saas/monitor/ingest",
        headers=owner_headers,
        json={"assessment_id": assessment_id, "vendor": "generic",
              "interactions": INTERACTIONS, "is_synthetic": True},
    )
    assert ingested.status_code == 200, ingested.text
    assert not ingested.json().get("errors"), ingested.json()["errors"]

    evaluated = client.post(
        f"/saas/monitor/assessments/{assessment_id}/evaluate",
        headers=owner_headers,
    )
    assert evaluated.status_code == 200, evaluated.text

    rows = client.get(
        f"/saas/monitor/interactions?assessment_id={assessment_id}",
        headers=owner_headers,
    ).json()["interactions"]
    assert rows, "the fixture produced no interactions to test isolation against"

    findings = client.get(
        f"/saas/monitor/findings?assessment_id={assessment_id}",
        headers=owner_headers,
    ).json()["findings"]
    assert findings, "the fixture produced no findings to test isolation against"

    context = {
        "owner_key": owner["api_key"],
        "intruder_key": intruder["api_key"],
        "owner_org_id": owner["org_id"],
        "intruder_org_id": intruder["org_id"],
        "assessment_id": assessment_id,
        "interaction_id": rows[0]["interaction_id"],
        "finding_id": findings[0]["finding_id"],
    }
    yield context

    _drop_org(owner["org_id"])
    _drop_org(intruder["org_id"])


def _owner(t):
    return {"X-API-Key": t["owner_key"]}


def _intruder(t):
    return {"X-API-Key": t["intruder_key"]}


# ── The owner can reach its own data ──────────────────────────────────────────
#
# Stated first so that a failure of the isolation tests below cannot be
# explained away as "the route was broken for everyone".

def test_the_owner_can_read_its_own_interaction(client, tenants):
    r = client.get(f"/saas/monitor/interactions/{tenants['interaction_id']}",
                   headers=_owner(tenants))
    assert r.status_code == 200
    assert r.json()["external_id"] in {"ISO-0001", "ISO-0002"}


def test_the_owner_can_read_its_own_finding(client, tenants):
    r = client.get(f"/saas/monitor/findings/{tenants['finding_id']}",
                   headers=_owner(tenants))
    assert r.status_code == 200


def test_the_owner_can_read_its_own_report(client, tenants):
    r = client.get(f"/saas/monitor/assessments/{tenants['assessment_id']}/report",
                   headers=_owner(tenants))
    assert r.status_code == 200


# ── The intruder cannot, by identifier ────────────────────────────────────────

def test_another_org_cannot_read_the_interaction(client, tenants):
    r = client.get(f"/saas/monitor/interactions/{tenants['interaction_id']}",
                   headers=_intruder(tenants))
    assert r.status_code == 404, (
        "an interaction belonging to another organization was served"
    )
    assert "ISO-000" not in r.text


def test_another_org_cannot_read_the_finding(client, tenants):
    r = client.get(f"/saas/monitor/findings/{tenants['finding_id']}",
                   headers=_intruder(tenants))
    assert r.status_code == 404, (
        "a finding belonging to another organization was served"
    )


def test_another_org_cannot_modify_the_finding(client, tenants):
    """The write path needs its own test: a read filter does not imply a write filter."""
    r = client.patch(
        f"/saas/monitor/findings/{tenants['finding_id']}",
        headers=_intruder(tenants),
        json={"status": "resolved", "resolution": "not_applicable",
              "reviewer": "intruder", "notes": "cross-tenant write attempt"},
    )
    assert r.status_code == 404, (
        "another organization was able to act on a finding it does not own"
    )

    # And the finding is genuinely untouched, not merely reported as missing.
    after = client.get(f"/saas/monitor/findings/{tenants['finding_id']}",
                       headers=_owner(tenants)).json()
    assert after.get("status", after.get("finding", {}).get("status")) != "resolved"


def test_another_org_cannot_read_the_report(client, tenants):
    r = client.get(
        f"/saas/monitor/assessments/{tenants['assessment_id']}/report",
        headers=_intruder(tenants),
    )
    assert r.status_code in (403, 404), (
        "an assessment report belonging to another organization was served"
    )
    assert "ISO-000" not in r.text


def test_another_org_cannot_evaluate_the_assessment(client, tenants):
    r = client.post(
        f"/saas/monitor/assessments/{tenants['assessment_id']}/evaluate",
        headers=_intruder(tenants),
    )
    # Either refused outright, or a no-op that touched nothing of the owner's.
    if r.status_code == 200:
        assert r.json()["evaluated"] == 0, (
            "another organization drove evaluation over data it does not own"
        )
    else:
        assert r.status_code in (403, 404)


def test_another_org_cannot_ingest_into_the_assessment(client, tenants):
    r = client.post(
        "/saas/monitor/ingest",
        headers=_intruder(tenants),
        json={"assessment_id": tenants["assessment_id"], "vendor": "generic",
              "interactions": [INTERACTIONS[0]], "is_synthetic": True},
    )
    assert r.status_code in (400, 403, 404), (
        "another organization wrote interactions into an assessment it does not own"
    )

    # The owner's queue must not have grown.
    rows = client.get(
        f"/saas/monitor/interactions?assessment_id={tenants['assessment_id']}",
        headers=_owner(tenants),
    ).json()["interactions"]
    assert len(rows) == len(INTERACTIONS)


# ── Listings are scoped, not merely filtered on request ───────────────────────

def test_listings_are_empty_for_an_org_with_no_data(client, tenants):
    """Asking for the owner's assessment_id must not widen the intruder's scope."""
    for path in (
        "/saas/monitor/interactions",
        "/saas/monitor/findings",
        f"/saas/monitor/interactions?assessment_id={tenants['assessment_id']}",
        f"/saas/monitor/findings?assessment_id={tenants['assessment_id']}",
    ):
        r = client.get(path, headers=_intruder(tenants))
        assert r.status_code == 200, path
        body = r.json()
        rows = body.get("interactions", body.get("findings"))
        assert rows == [], f"{path} leaked rows to an organization with no data"
        assert "ISO-000" not in r.text


def test_assessment_listing_shows_only_own_assessments(client, tenants):
    r = client.get("/saas/monitor/assessments", headers=_intruder(tenants))
    assert r.status_code == 200
    names = [a["name"] for a in r.json()["assessments"]]
    assert "Isolation fixture" not in names


def test_metrics_are_computed_per_org(client, tenants):
    """Aggregates leak too: a count computed across every tenant is a disclosure."""
    owner = client.get("/saas/monitor/metrics", headers=_owner(tenants)).json()
    intruder = client.get("/saas/monitor/metrics", headers=_intruder(tenants)).json()

    assert owner["interactions_evaluated"] >= len(INTERACTIONS)
    assert intruder["interactions_evaluated"] == 0, (
        "metrics counted another organization's interactions"
    )


# ── The key itself ────────────────────────────────────────────────────────────

def test_no_key_is_refused(client, tenants):
    r = client.get(f"/saas/monitor/interactions/{tenants['interaction_id']}")
    assert r.status_code in (401, 403)


def test_a_fabricated_key_is_refused(client, tenants):
    r = client.get(
        f"/saas/monitor/interactions/{tenants['interaction_id']}",
        headers={"X-API-Key": "nhid_" + "0" * 48},
    )
    assert r.status_code in (401, 403)


def test_a_revoked_key_stops_working(client, tenants):
    """Rotation must actually invalidate the old key, not just issue a new one."""
    fresh = create_org("Isolation Rotation Org")
    old_key = fresh["api_key"]
    try:
        assert client.get("/saas/orgs/me",
                          headers={"X-API-Key": old_key}).status_code == 200

        rotated = client.post("/saas/orgs/rotate-key",
                              headers={"X-API-Key": old_key})
        assert rotated.status_code == 200, rotated.text
        new_key = rotated.json()["api_key"]
        assert new_key != old_key

        assert client.get("/saas/orgs/me",
                          headers={"X-API-Key": old_key}).status_code in (401, 403)
        assert client.get("/saas/orgs/me",
                          headers={"X-API-Key": new_key}).status_code == 200
    finally:
        _drop_org(fresh["org_id"])
