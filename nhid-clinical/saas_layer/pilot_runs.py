"""
pilot_runs.py — the registry of Tier 0 runs somebody chose to tell us about.

WHAT THIS IS NOT
----------------
This is **not** telemetry. The Tier 0 kit
(``docs/pilot-kit/measure_pilot.py`` in the framework repository) makes zero
network calls, and it must stay that way: "it runs in your environment and
nothing reaches us" is the reason its security review is short and the reason
Tier 0 needs no BAA. Adding a beacon would trade the product's best property
for a number on a dashboard.

So nothing here observes a run. Every row arrives because a person exported a
report and submitted it on purpose.

THREE DISTINCTIONS THE CODE KEEPS, NOT JUST THE DOCS
----------------------------------------------------
1. **Self-reported is not verified.** Every row is ``self_reported``. No
   mechanism in this repository can independently confirm that a run happened
   as described, so nothing writes ``verified`` — see ``VERIFICATION_SELF``.
2. **Their clock is not ours.** ``executed_at`` is what the submitter says;
   ``ingested_at`` is what we observed. Only the second is ours to assert.
3. **Missing evidence is not a pass.** ``inconclusive`` and ``not_evaluated``
   are first-class results. An assertion nobody could evaluate has somewhere
   honest to go, so it never rounds up.

WHAT IS REFUSED
---------------
Structured evaluation results only. A payload carrying transcript text, turn
content or anything that looks like conversational material is **rejected**,
not quietly stripped: a submitter who thinks they sent a transcript and got a
200 would reasonably believe we are holding it. See ``PROHIBITED_KEYS``.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from saas_layer.db import get_conn

_logger = logging.getLogger(__name__)

# ── Vocabulary ────────────────────────────────────────────────────────────────

RESULT_PASS = "pass"
RESULT_FAIL = "fail"
RESULT_INCONCLUSIVE = "inconclusive"
RESULT_NOT_EVALUATED = "not_evaluated"
RESULTS = (RESULT_PASS, RESULT_FAIL, RESULT_INCONCLUSIVE, RESULT_NOT_EVALUATED)

# The only value anything in this codebase writes. `verified` is reserved for a
# mechanism that does not exist yet; defining it here without using it is the
# point, so the rows written before it exists stay correctly labelled after.
VERIFICATION_SELF = "self_reported"
VERIFICATION_VERIFIED = "verified"

# Control decision outcomes we will count. Anything else in a submission is
# ignored rather than stored, so a submitter cannot invent a control.
COUNTABLE_DECISIONS = (
    "CONTINUE_AI", "DENY_DATA", "ESCALATE_HUMAN", "LOG_ONLY", "DISCLOSE_IDENTITY",
)

# Keys that indicate conversational content. Their presence fails the
# submission. The list is deliberately broad: a false rejection costs the
# submitter one edit, a false acceptance costs them a PHI incident.
PROHIBITED_KEYS = (
    "transcript", "transcripts", "turns", "utterance", "utterances",
    "speech_text", "message", "messages", "dialogue", "conversation",
    "audio", "recording", "recordings", "member_id", "patient", "phi",
)

MAX_PAYLOAD_BYTES = 256 * 1024

# A country code, or nothing. Never derived — only accepted when the submitter
# typed it. Inferring a pilot's location from an IP, an email domain, a website
# visit or a clone would be fabricated telemetry wearing a map.
_COUNTRY_RE = re.compile(r"^[A-Z]{2}$")


class SubmissionRejected(ValueError):
    """The payload was refused. The message is safe to return to the caller."""


# ── Validation ────────────────────────────────────────────────────────────────

def _walk_keys(obj: Any, depth: int = 0):
    """Every key in a nested structure. Depth-capped against hostile nesting."""
    if depth > 12:
        return
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield str(key).lower()
            yield from _walk_keys(value, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            yield from _walk_keys(item, depth + 1)


def validate_payload(payload: Dict[str, Any]) -> None:
    """Raise SubmissionRejected if this must not be stored.

    Rejects rather than redacts. A submitter who believes they sent a
    transcript and received a 200 would reasonably conclude we are holding one;
    a clear refusal tells them the truth and leaves the data with them.
    """
    encoded = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    if len(encoded) > MAX_PAYLOAD_BYTES:
        raise SubmissionRejected(
            f"Report exceeds {MAX_PAYLOAD_BYTES // 1024} KB. Submit the summary "
            "metrics rather than the full evaluation output."
        )

    found = sorted({k for k in _walk_keys(payload) if k in PROHIBITED_KEYS})
    if found:
        raise SubmissionRejected(
            "Report contains conversational or identifying fields and was not "
            f"stored: {', '.join(found)}. Submit structured results only — "
            "counts, rates and evidence references. Transcripts stay with you."
        )

    status = payload.get("result_status", RESULT_NOT_EVALUATED)
    if status not in RESULTS:
        raise SubmissionRejected(
            f"result_status must be one of {', '.join(RESULTS)}."
        )

    country = payload.get("reported_country")
    if country is not None and not _COUNTRY_RE.match(str(country)):
        raise SubmissionRejected(
            "reported_country must be a two-letter uppercase country code, or "
            "omitted. It is never inferred."
        )


def canonical_hash(payload: Dict[str, Any]) -> str:
    """SHA-256 of the canonical payload.

    Proves the stored record matches what was submitted. Proves nothing about
    whether the submission was true, and must never be presented as if it did.
    """
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        .encode("utf-8")
    ).hexdigest()


def _countable(decisions: Any) -> Dict[str, int]:
    """Keep only recognised control decisions with integer counts."""
    if not isinstance(decisions, dict):
        return {}
    out: Dict[str, int] = {}
    for name in COUNTABLE_DECISIONS:
        value = decisions.get(name)
        if isinstance(value, bool):
            continue  # bool is an int in Python; a flag is not a count
        if isinstance(value, int) and value >= 0:
            out[name] = value
    return out


# ── Writes ────────────────────────────────────────────────────────────────────

def record_run(org_id: str, payload: Dict[str, Any], *,
               submitted_by: Optional[str] = None) -> Dict[str, Any]:
    """Store one submitted pilot report. Returns the created record.

    Raises SubmissionRejected if the payload must not be stored. The caller
    maps that to a 422 and records the rejection.
    """
    validate_payload(payload)

    run_id = f"run_{uuid.uuid4().hex[:20]}"
    executed_at = payload.get("executed_at")
    digest = canonical_hash(payload)

    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO pilot_runs
                     (run_id, org_id, executed_at, executed_tz, scenario_id,
                      scenario_version, evaluator_version, kit_version, completed,
                      result_status, failure_reason, verification, evidence_source,
                      control_decisions, metrics, payload_sha256, reported_country,
                      submitted_by)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   RETURNING *""",
                (run_id, org_id, executed_at, payload.get("executed_tz"),
                 payload.get("scenario_id"), payload.get("scenario_version"),
                 payload.get("evaluator_version"), payload.get("kit_version"),
                 payload.get("completed"),
                 payload.get("result_status", RESULT_NOT_EVALUATED),
                 payload.get("failure_reason"),
                 # Always self-reported. Not read from the payload: a submitter
                 # must not be able to mark their own run verified.
                 VERIFICATION_SELF,
                 payload.get("evidence_source"),
                 json.dumps(_countable(payload.get("control_decisions"))),
                 json.dumps(payload.get("metrics") or {}),
                 digest, payload.get("reported_country"), submitted_by),
            )
            row = dict(cur.fetchone())
    finally:
        conn.close()

    _logger.info("PILOT: run recorded org=%s run=%s status=%s by=%s",
                 org_id, run_id, row.get("result_status"), submitted_by)
    return row


# ── Reads ─────────────────────────────────────────────────────────────────────

def list_runs(org_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT * FROM pilot_runs WHERE org_id = %s
                   ORDER BY ingested_at DESC LIMIT %s""",
                (org_id, max(1, min(limit, 500))),
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def get_run(org_id: str, run_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM pilot_runs WHERE org_id = %s AND run_id = %s",
                (org_id, run_id),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def summary(org_id: str) -> Dict[str, Any]:
    """Counts for the dashboard's pilot panel.

    Deliberately returns zeros rather than omitting fields when there is
    nothing: an honest empty state is a number, and the UI needs something to
    render "no pilot runs reported yet" from.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """SELECT
                     COUNT(*)                                               AS total,
                     COUNT(*) FILTER (WHERE verification = 'self_reported') AS self_reported,
                     COUNT(*) FILTER (WHERE verification = 'verified')      AS verified,
                     COUNT(*) FILTER (WHERE result_status = 'pass')         AS passed,
                     COUNT(*) FILTER (WHERE result_status = 'fail')         AS failed,
                     COUNT(*) FILTER (WHERE result_status = 'inconclusive') AS inconclusive,
                     COUNT(*) FILTER (WHERE result_status = 'not_evaluated') AS not_evaluated,
                     MAX(ingested_at)                                       AS last_ingested_at
                   FROM pilot_runs WHERE org_id = %s""",
                (org_id,),
            )
            totals = dict(cur.fetchone() or {})
            # Country aggregation, and only from what submitters typed. A
            # country with a single run is suppressed: one row plus a country
            # is close enough to naming the organization.
            cur.execute(
                """SELECT reported_country AS country, COUNT(*) AS runs
                   FROM pilot_runs
                   WHERE org_id = %s AND reported_country IS NOT NULL
                   GROUP BY reported_country HAVING COUNT(*) > 1
                   ORDER BY runs DESC""",
                (org_id,),
            )
            countries = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    last = totals.get("last_ingested_at")
    return {
        "source": "self-reported pilot submissions",
        "is_telemetry": False,
        "note": ("The Tier 0 kit runs offline and reports nothing. These are "
                 "runs a person chose to submit, and none has been "
                 "independently verified."),
        "total_runs": totals.get("total") or 0,
        "self_reported": totals.get("self_reported") or 0,
        "verified": totals.get("verified") or 0,
        "by_result": {
            "pass": totals.get("passed") or 0,
            "fail": totals.get("failed") or 0,
            "inconclusive": totals.get("inconclusive") or 0,
            "not_evaluated": totals.get("not_evaluated") or 0,
        },
        "countries": countries,
        "country_aggregation": "reported country only; singletons suppressed",
        "last_ingested_at": last.isoformat() if last else None,
    }


def evidence_report(org_id: str, run_id: str) -> Dict[str, Any]:
    """A downloadable evidence record for one run.

    Carries its own provenance and limitations, because this document will
    outlive the conversation that produced it and will be read by someone who
    was not here. A reader must be able to tell, from the file alone, that
    these are the submitter's claims and not our measurements.
    """
    run = get_run(org_id, run_id)
    if run is None:
        raise LookupError(run_id)

    def _iso(value):
        return value.isoformat() if hasattr(value, "isoformat") else value

    return {
        "title": "NHID-Clinical Tier 0 pilot — submitted evidence record",
        "run_id": run["run_id"],
        "scenario": {
            "scenario_id": run.get("scenario_id"),
            "scenario_version": run.get("scenario_version"),
            "evaluator_version": run.get("evaluator_version"),
            "kit_version": run.get("kit_version"),
        },
        "timing": {
            "executed_at": _iso(run.get("executed_at")),
            "executed_tz": run.get("executed_tz"),
            "ingested_at": _iso(run.get("ingested_at")),
            "note": ("executed_at is reported by the submitter. ingested_at is "
                     "observed by this service. They are not interchangeable."),
        },
        "result": {
            "status": run.get("result_status"),
            "completed": run.get("completed"),
            "failure_reason": run.get("failure_reason"),
        },
        "control_decisions": run.get("control_decisions") or {},
        "metrics": run.get("metrics") or {},
        "provenance": {
            "verification": run.get("verification"),
            "evidence_source": run.get("evidence_source"),
            "payload_sha256": run.get("payload_sha256"),
            "integrity_note": ("The hash proves this record matches what was "
                               "submitted. It does not attest that the run "
                               "occurred or that the results are correct."),
        },
        "limitations": [
            "Self-reported. The Tier 0 kit runs offline and sends nothing, so "
            "this service cannot observe a run or confirm one happened.",
            "No independent verification mechanism exists in this system; "
            "every record is labelled self_reported for that reason.",
            "A result of 'inconclusive' or 'not_evaluated' means the assertion "
            "could not be evaluated. It is not a pass.",
            "A recorded control decision is a decision, not proof that a "
            "receiving integration enforced it.",
            "Location, where present, is a country the submitter supplied. It "
            "is never inferred from an address, a domain or site activity.",
        ],
    }
