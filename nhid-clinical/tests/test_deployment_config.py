"""The production-configuration surface: migrations, CORS, and request limits.

These cover the parts that only matter once the application is deployed
somewhere, and which therefore had no tests while it only ever ran locally:

  * the schema can be built from nothing, and building it twice is a no-op
  * CORS is driven by configuration rather than a wildcard
  * an oversized or empty upload is refused rather than absorbed

Requires DATABASE_URL, HMAC_SECRET.
"""
from __future__ import annotations

import importlib
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas_layer import migrations  # noqa: E402
from saas_layer.auth import create_org  # noqa: E402
from saas_layer.db import get_conn  # noqa: E402
from saas_layer.gateway import app  # noqa: E402


# ── Migrations ────────────────────────────────────────────────────────────────

def test_the_ledger_exists_and_records_the_baseline():
    applied = migrations.applied_versions()
    assert "0001" in applied, (
        "the baseline migration is not recorded, so the database cannot say "
        "what schema version it is at"
    )


def test_nothing_is_pending_after_the_app_has_started():
    """Importing the gateway runs ensure_schema, so the database is current."""
    assert migrations.pending() == []


def test_running_migrations_again_applies_nothing():
    """Idempotence is the property that makes this safe to call on every boot."""
    assert migrations.run_migrations() == []


def test_every_migration_version_is_unique_and_ordered():
    versions = [m.version for m in migrations.all_migrations()]
    assert len(versions) == len(set(versions)), "duplicate migration version"
    assert versions == sorted(versions), (
        "migrations are applied in list order; a version out of order would be "
        "applied out of order"
    )


def test_the_baseline_creates_every_table_the_application_uses():
    """A fresh database must end up with the full schema, not most of it.

    The table list is asserted explicitly rather than counted, so dropping a
    table from the bootstrap fails here with its name.
    """
    expected = {
        "admin_login_attempts", "admin_sessions", "agent_revocations",
        "assessments", "audit_traces", "evaluations", "findings",
        "interactions", "orgs", "processed_events", "provider_keys",
        "review_events", "schema_migrations", "time_entries", "usage_log",
        "voice_policy_configs", "voice_sessions",
    }
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )
        present = {r["tablename"] for r in cur.fetchall()}
    finally:
        conn.close()

    missing = expected - present
    assert not missing, f"the schema is missing: {sorted(missing)}"


# ── CORS ──────────────────────────────────────────────────────────────────────

def test_cors_origins_come_from_the_environment(monkeypatch):
    monkeypatch.setenv(
        "CORS_ALLOWED_ORIGINS",
        "https://app.example.org, https://example.org/",
    )
    from saas_layer.gateway import _cors_origins

    origins = _cors_origins()
    assert origins == ["https://app.example.org", "https://example.org"], (
        "origins must be split, trimmed and stripped of trailing slashes"
    )


def test_cors_is_never_a_wildcard(monkeypatch):
    """A wildcard would let any page on the internet script this API."""
    from saas_layer.gateway import _cors_origins

    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    assert "*" not in _cors_origins()

    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.org")
    assert "*" not in _cors_origins()


def test_unset_cors_falls_back_to_local_dev_origins(monkeypatch):
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    from saas_layer.gateway import _cors_origins

    origins = _cors_origins()
    assert all(o.startswith("http://localhost") or o.startswith("http://127.0.0.1")
               for o in origins), origins


def test_an_unlisted_origin_is_not_echoed_back(monkeypatch):
    """The browser only honours CORS if the server names the origin."""
    client = TestClient(app)
    r = client.get("/health", headers={"Origin": "https://attacker.example"})
    assert r.headers.get("access-control-allow-origin") != "https://attacker.example"
    assert r.headers.get("access-control-allow-origin") != "*"


# ── Request limits ────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def org():
    record = create_org("Deployment Config Test Org")
    yield record
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            for table in ("interactions", "assessments", "usage_log"):
                cur.execute(f"DELETE FROM {table} WHERE org_id = %s",
                            (record["org_id"],))
            cur.execute("DELETE FROM orgs WHERE org_id = %s", (record["org_id"],))
    finally:
        conn.close()


@pytest.fixture(scope="module")
def assessment(org):
    client = TestClient(app)
    r = client.post(
        "/saas/monitor/assessments",
        headers={"X-API-Key": org["api_key"]},
        json={"name": "Limits", "period_start": "2026-09-01",
              "period_end": "2026-09-30", "is_synthetic": True},
    )
    return r.json()["assessment_id"]


def test_an_oversized_interaction_list_is_refused(org, assessment):
    """Every interaction is evaluated synchronously, so the list length decides
    how much work one request can demand of the instance."""
    from saas_layer.gateway import MAX_INTERACTIONS_PER_REQUEST

    client = TestClient(app)
    payload = [{"external_id": f"OVER-{i}"} for i in range(MAX_INTERACTIONS_PER_REQUEST + 1)]
    r = client.post(
        "/saas/monitor/ingest",
        headers={"X-API-Key": org["api_key"]},
        json={"assessment_id": assessment, "vendor": "generic",
              "interactions": payload, "is_synthetic": True},
    )
    assert r.status_code == 422, (
        f"an upload of {len(payload)} interactions was accepted"
    )


def test_an_empty_interaction_list_is_refused(org, assessment):
    """Reporting "ingested 0" as success hides a client that sent nothing."""
    client = TestClient(app)
    r = client.post(
        "/saas/monitor/ingest",
        headers={"X-API-Key": org["api_key"]},
        json={"assessment_id": assessment, "vendor": "generic",
              "interactions": [], "is_synthetic": True},
    )
    assert r.status_code == 422


def test_an_oversized_body_is_refused_with_413(org, assessment):
    from saas_layer.gateway import MAX_REQUEST_BYTES

    client = TestClient(app)
    r = client.post(
        "/saas/monitor/ingest",
        headers={
            "X-API-Key": org["api_key"],
            "Content-Length": str(MAX_REQUEST_BYTES + 1),
            "Content-Type": "application/json",
        },
        content=b"{}",
    )
    assert r.status_code == 413
    assert str(MAX_REQUEST_BYTES) in r.text


def test_malformed_interactions_are_reported_not_silently_dropped(org, assessment):
    """A record the normalizer rejects must come back as an error.

    Answering 200 with `ingested: 0` and an empty `errors` list would tell a
    caller their upload succeeded when nothing was stored.
    """
    client = TestClient(app)
    r = client.post(
        "/saas/monitor/ingest",
        headers={"X-API-Key": org["api_key"]},
        json={"assessment_id": assessment, "vendor": "generic",
              "interactions": [{"nonsense": True}], "is_synthetic": True},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ingested"] == 0
    assert body["errors"], "a rejected record produced no error"
    assert body["errors"][0]["index"] == 0


# ── Health ────────────────────────────────────────────────────────────────────

def test_health_needs_no_credential_and_leaks_no_business_metrics():
    """It must answer for an uptime monitor, and say nothing about customers."""
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "org_count" not in body, (
        "the public health endpoint reports how many customers this deployment has"
    )


def test_system_status_requires_an_admin_session():
    client = TestClient(app)
    r = client.get("/saas/system/status")
    assert r.status_code == 401, (
        "tenant counts are served to unauthenticated callers"
    )
