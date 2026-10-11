-- 0003 — a retention limit on stored transcripts.
--
-- `interactions.transcript` holds transcript text. For provider-to-payer
-- administrative calls that text can contain PHI: member identifiers, names,
-- dates of birth, claim details. Until this migration it was stored with no
-- retention limit, no purge and no deletion path, while `voice_sessions`
-- already had all three (purge_old_sessions, 24h-7d per org). So the answer to
-- the first question a payer security review asks -- "how long do you keep our
-- transcripts, and how do we have them deleted?" -- was "indefinitely, and
-- there is no way to."
--
-- WHY THIS REDACTS RATHER THAN DELETES
--
-- `evaluations` and `findings` both reference `interaction_id`. Deleting the
-- row would destroy the audit trail, which is the product -- a governance
-- platform that loses the evidence it produced is worse than useless. So
-- retention nulls the transcript text and keeps the record: external_id,
-- occurred_at, the transcription attestation, every evaluation and finding
-- derived from it, and a timestamp proving when the text went.
--
-- WHY THE CLOCK IS created_at, NOT occurred_at
--
-- `occurred_at` is supplied by the client. Letting it drive deletion would let
-- a caller set the retention schedule for data we hold, the same way trusting
-- the Host header would let a caller choose where a sign-in link points. A
-- retention policy governs how long WE possess the text, so it runs from when
-- we received it. A backfill of year-old calls is therefore held for the
-- window from ingest, not purged on arrival.

-- Purging means writing NULL, so the column can no longer be NOT NULL.
-- NULL now carries a meaning: "no transcript text is held". Whether that is
-- because it was purged or never supplied is answered by transcript_purged_at.
ALTER TABLE interactions ALTER COLUMN transcript DROP NOT NULL;

ALTER TABLE interactions
    ADD COLUMN IF NOT EXISTS transcript_purged_at TIMESTAMPTZ;

-- Per-org override. NULL means "use the server-wide default"
-- (TRANSCRIPT_RETENTION_DAYS, default 30), matching how
-- orgs.voice_session_ttl_hours already works.
ALTER TABLE orgs
    ADD COLUMN IF NOT EXISTS transcript_retention_days INTEGER;

-- Partial index: the purge only ever looks for rows that still hold text, and
-- that set shrinks to nothing as the purge keeps up. A full index on created_at
-- would carry every historical row forever to answer a question that is only
-- ever asked about the unpurged tail.
CREATE INDEX IF NOT EXISTS idx_interactions_unpurged_created_at
    ON interactions (created_at)
    WHERE transcript IS NOT NULL;
