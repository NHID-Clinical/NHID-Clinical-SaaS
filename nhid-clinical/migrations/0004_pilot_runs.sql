-- 0004 — a registry of pilot runs that were actually reported.
--
-- The question this answers is "who ran the Tier 0 kit", and the honest answer
-- is that we cannot know. `docs/pilot-kit/measure_pilot.py` in the framework
-- repository makes zero network calls, and that is the product's strongest
-- claim: it runs in the customer's environment and nothing reaches us. It is
-- why Tier 0 needs no BAA and why its security review is short.
--
-- So this table does NOT observe runs. It records the ones somebody chose to
-- send us. Every row is self-reported until a verification mechanism exists
-- that can say otherwise, and the schema is built to keep that distinction
-- impossible to lose:
--
--   * `verification` defaults to 'self_reported' and is CHECK-constrained. A
--     row cannot quietly become 'verified' because a later writer forgot what
--     the column meant.
--   * `executed_at` (when they ran it, as they report it) is separate from
--     `ingested_at` (when we received it, which we observe). Collapsing those
--     two would present their clock as ours.
--   * `result_status` allows 'inconclusive' and 'not_evaluated' as first-class
--     values. Missing evidence must never round up to a pass.
--
-- A website visit, a repository clone, a download, a pip install or a contact
-- form submission is NOT a pilot run and must never create a row here.

CREATE TABLE IF NOT EXISTS pilot_runs (
    run_id            TEXT PRIMARY KEY,
    org_id            TEXT NOT NULL,

    -- What they say happened, in their timezone, from the submitted report.
    executed_at       TIMESTAMPTZ,
    executed_tz       TEXT,
    -- What we observed: the moment the submission reached us. Always ours.
    ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    scenario_id       TEXT,
    scenario_version  TEXT,
    evaluator_version TEXT,
    kit_version       TEXT,

    -- Did the run finish, as reported. NULL means they did not say.
    completed         BOOLEAN,

    -- pass | fail | inconclusive | not_evaluated.
    -- 'inconclusive' and 'not_evaluated' exist so that an assertion nobody
    -- could evaluate has somewhere honest to go.
    result_status     TEXT NOT NULL DEFAULT 'not_evaluated'
        CHECK (result_status IN ('pass', 'fail', 'inconclusive', 'not_evaluated')),
    failure_reason    TEXT,

    -- How much weight this row can carry. Nothing writes 'verified' today:
    -- no mechanism in this repository can independently confirm that a run
    -- happened as described. The value exists so that when one is built, the
    -- rows predating it stay correctly labelled.
    verification      TEXT NOT NULL DEFAULT 'self_reported'
        CHECK (verification IN ('self_reported', 'verified')),
    evidence_source   TEXT,

    -- Aggregate counts of control decisions, as submitted. Structured results
    -- only -- no transcripts, no turn text, no PHI. See pilot_runs.py, which
    -- rejects a payload carrying conversational content rather than storing
    -- it and hoping.
    control_decisions JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics           JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- SHA-256 of the canonical submitted payload. This proves the record has
    -- not changed since ingestion. It does NOT prove the submission was true,
    -- and nothing in the UI may present it as if it did.
    payload_sha256    TEXT,

    -- Country only, and only when the submitter supplied it deliberately.
    -- Never derived from an IP address, an email domain, a website visit or a
    -- repository clone -- inferring a pilot's location from an unrelated
    -- signal would be fabricated telemetry wearing a map.
    reported_country  TEXT,

    submitted_by      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pilot_runs_org_ingested
    ON pilot_runs (org_id, ingested_at DESC);
