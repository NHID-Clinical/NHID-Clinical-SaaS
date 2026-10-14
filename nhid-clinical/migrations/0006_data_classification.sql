-- 0006 — data_classification on pilot_runs.
--
-- A pilot run's weight depends on what data it was measured against, and until
-- now the registry could not record that. `verification` says whether we
-- independently confirmed the run happened (always 'self_reported' today);
-- `data_classification` says what *kind* of data the run was scored on, which
-- is a different axis and must not be conflated with it. A self-reported run on
-- synthetic data and a self-reported run on production-derived data are both
-- unverified, but they sit at very different tiers of evidence.
--
-- Three values, from the evidence-provenance ladder in the framework repo
-- (docs/validation/evidence-provenance-matrix.md):
--
--   * 'synthetic'          — hand-authored or generated fixtures; no real
--                            caller, no real PHI. What the Tier 0 kit produces.
--   * 'deidentified'       — derived from real traffic with identifiers
--                            removed under a documented process.
--   * 'production_derived' — real operational data. The highest tier, and the
--                            one that carries real-world obligations.
--
-- Default is 'synthetic' — the most conservative, and what every existing row
-- actually is: the Tier 0 kit runs on synthetic scenarios. A pre-existing row
-- backfilled to 'synthetic' is therefore labelled correctly, not optimistically.
-- Raising a row to a higher tier is a deliberate act by the submitter, never a
-- default and never inferred, exactly as 'verified' is never written on a
-- submitter's say-so.
--
-- Additive and forward-only (migrations/README.md): a new column with a safe
-- default and a CHECK constraint, applied idempotently. No existing column or
-- row is rewritten beyond the backfill the default performs.

ALTER TABLE pilot_runs
    ADD COLUMN IF NOT EXISTS data_classification TEXT NOT NULL DEFAULT 'synthetic';

-- Added separately and guarded, so re-running the migration does not fail on a
-- duplicate constraint (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pilot_runs_data_classification_check'
    ) THEN
        ALTER TABLE pilot_runs
            ADD CONSTRAINT pilot_runs_data_classification_check
            CHECK (data_classification IN ('synthetic', 'deidentified', 'production_derived'));
    END IF;
END$$;
