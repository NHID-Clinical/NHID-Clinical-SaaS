"""
saas_layer/monitoring.py — the monitoring and evidence product.

This is the commercial layer: a payer already receives AI voice calls from
provider vendors and cannot say how many were AI, whether they disclosed, or
whether member data moved before they did. This module ingests interactions the
customer already has, evaluates them against the NHID controls, raises findings a
human can work, and preserves evidence of what happened.

The loop: Ingest -> Normalize -> Evaluate -> Monitor -> Investigate -> Review -> Report.

BUSINESS HYPOTHESIS / NEEDS CUSTOMER VALIDATION
------------------------------------------------
There are zero deployments, zero pilots and zero validated willingness-to-pay for
this product. The buyer, the workflow and the pricing are hypotheses. Nothing in
this module, its API or its UI may represent them as validated, and no fixture in
this repository is customer data.

Design commitments
------------------
*   **Four result states, and "unknown" is one of them.** A control is `pass`,
    `exception`, `unknown` or `not_assessable`. Forcing a binary verdict onto an
    interaction that cannot support one is how a governance record becomes
    fiction. `not_assessable` means the evidence needed was never present;
    `unknown` means it was present and inconclusive.

*   **No score.** There is no composite, no tier, no grade and no percentage that
    blends unlike denominators. Every number this module reports carries the
    denominator it was computed over.

*   **Findings are governance exceptions, not violations.** An exception is
    something a human should look at. Calling it a regulatory violation asserts a
    legal conclusion this product cannot reach.

*   **Evidence reuses the audit chain.** Nothing here invents a second evidence
    store: `saas_layer.audit` already provides hash-chained, HMAC-signed,
    append-only records with Postgres triggers, and evidence rows reference it.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from saas_layer.db import get_conn
from saas_layer.normalization import (
    AI_NON_HUMAN,
    AI_UNKNOWN,
    ATTESTATION_UNATTESTED,
    SPEAKER_AGENT,
    SPEAKER_HUMAN,
)

# ── Vocabulary ────────────────────────────────────────────────────────────────

RESULT_PASS = "pass"
RESULT_EXCEPTION = "exception"
RESULT_UNKNOWN = "unknown"
RESULT_NOT_ASSESSABLE = "not_assessable"
RESULTS = (RESULT_PASS, RESULT_EXCEPTION, RESULT_UNKNOWN, RESULT_NOT_ASSESSABLE)

CONTROLS = ("IDG-01", "PDX-01", "EIT-01", "ATR-01")

FINDING_OPEN = "open"
FINDING_UNDER_REVIEW = "under_review"
FINDING_RESOLVED = "resolved"
FINDING_STATUSES = (FINDING_OPEN, FINDING_UNDER_REVIEW, FINDING_RESOLVED)

RESOLUTION_ACCEPTED = "accepted"
RESOLUTION_NOT_APPLICABLE = "not_applicable"
RESOLUTION_REMEDIATED = "remediated"
RESOLUTIONS = (RESOLUTION_ACCEPTED, RESOLUTION_NOT_APPLICABLE, RESOLUTION_REMEDIATED)

# Finding categories. Deliberately operational language.
CAT_DISCLOSURE_MISSING = "disclosure_missing"
CAT_DISCLOSURE_DELAYED = "disclosure_delayed"
CAT_PHI_BEFORE_DISCLOSURE = "phi_before_disclosure"
CAT_ESCALATION_NOT_COMPLETED = "escalation_not_completed"
CAT_ESCALATION_OUTCOME_UNKNOWN = "escalation_outcome_unknown"
CAT_INSUFFICIENT_EVIDENCE = "insufficient_evidence"
CAT_TRANSCRIPTION_UNATTESTED = "transcription_quality_unattested"

#: Impersonation Latency reporting bands. A reporting convention, not an
#: enforcement threshold — no control imposes a seconds-based deadline. The
#: normative target is disclosure before any data request (IL = 0 turns).
IL_BAND_SECONDS = 10.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


# ── Detection helpers ─────────────────────────────────────────────────────────
#
# These read transcript text. NHID does not transcribe and does not establish ASR
# accuracy, so every result below is valid only to the precision of the
# transcription path — which is why the attestation travels with the interaction
# and appears on every report.

_DISCLOSURE_PATTERNS = (
    r"\bi am an? (?:ai|a\.i\.|automated|virtual|artificial)\b",
    r"\bi'm an? (?:ai|a\.i\.|automated|virtual|artificial)\b",
    r"\bthis is an? (?:ai|a\.i\.|automated|virtual)\b",
    r"\bautomated (?:system|assistant|agent)\b",
    r"\bai (?:assistant|agent|system)\b",
    r"\bnot a human\b",
    r"\bnot a live (?:person|agent|representative)\b",
    r"\bvirtual assistant\b",
)

_PHI_REQUEST_PATTERNS = (
    r"\bmember (?:id|number|i\.d\.)\b",
    r"\bdate of birth\b",
    r"\bdob\b",
    r"\bsocial security\b",
    r"\bssn\b",
    r"\bpolicy number\b",
    r"\bsubscriber id\b",
    r"\bclaim number\b",
    r"\bpatient(?:'s)? (?:name|record|chart)\b",
    r"\bdiagnosis code\b",
)

_ESCALATION_REQUEST_PATTERNS = (
    r"\bspeak (?:to|with) (?:a )?(?:human|person|representative|someone|agent)\b",
    r"\btalk to (?:a )?(?:human|person|representative|someone)\b",
    r"\btransfer me\b",
    r"\bget me (?:a )?(?:human|person|supervisor|manager)\b",
    r"\breal person\b",
    r"\bsupervisor\b",
)

_ESCALATION_COMPLETED_PATTERNS = (
    r"\btransferring you\b",
    r"\bconnecting you\b",
    r"\bone moment while i transfer\b",
    r"\bputting you through\b",
    r"\bhanding you (?:over|off)\b",
)

_ESCALATION_REFUSED_PATTERNS = (
    r"\bi (?:can|cannot|can't) (?:not )?transfer\b",
    r"\bunable to transfer\b",
    r"\bi can help you with that instead\b",
    r"\bno one (?:is )?available\b",
    r"\blet me (?:just )?finish\b",
)


def _matches(text: str, patterns) -> bool:
    lowered = (text or "").lower()
    return any(re.search(p, lowered) for p in patterns)


def _normalize_for_match(text: str) -> str:
    """Fold ASR spelling variants so 'A.I.', 'A I' and 'AI' are one token.

    Mirrors the framework engine. It handles orthography, not recognition error:
    a genuinely mis-transcribed disclosure is not recoverable here, which is
    exactly why findings carry a transcription attestation.
    """
    t = (text or "").lower()
    for variant in ("a.i.", "a. i.", " a i ", "a-i"):
        t = t.replace(variant, " ai ")
    return re.sub(r"\s+", " ", t)


def analyze_interaction(interaction: Dict[str, Any]) -> Dict[str, Any]:
    """Derive the observable facts from a canonical interaction.

    Pure: no database, no clock. Returns the measurements the control
    evaluations and the report are both computed from, so a number on a
    dashboard and a number in a report can never disagree.
    """
    turns = interaction.get("turns") or []
    agent_turns = [t for t in turns if t.get("speaker") == SPEAKER_AGENT]
    human_turns = [t for t in turns if t.get("speaker") == SPEAKER_HUMAN]

    disclosure_turn_index: Optional[int] = None
    disclosure_offset_ms: Optional[int] = None
    for idx, turn in enumerate(turns):
        if turn.get("speaker") != SPEAKER_AGENT:
            continue
        if _matches(_normalize_for_match(turn.get("text", "")), _DISCLOSURE_PATTERNS):
            disclosure_turn_index = idx
            disclosure_offset_ms = turn.get("offset_ms")
            break

    # PHI requested by the agent, and whether any of it preceded disclosure.
    phi_turn_indices = [
        idx for idx, t in enumerate(turns)
        if t.get("speaker") == SPEAKER_AGENT
        and _matches(t.get("text", ""), _PHI_REQUEST_PATTERNS)
    ]
    phi_before_disclosure = bool(phi_turn_indices) and (
        disclosure_turn_index is None
        or min(phi_turn_indices) < disclosure_turn_index
    )

    # Escalation is requested by the HUMAN. This is the asymmetry that matters:
    # a mis-transcribed human request produces no finding at all, and the record
    # then attests to a compliant interaction.
    escalation_request_idx = None
    for idx, turn in enumerate(turns):
        if turn.get("speaker") != SPEAKER_HUMAN:
            continue
        if _matches(turn.get("text", ""), _ESCALATION_REQUEST_PATTERNS):
            escalation_request_idx = idx
            break

    escalation_state = "escalation_not_requested"
    if escalation_request_idx is not None:
        after = turns[escalation_request_idx + 1:]
        agent_after = " ".join(
            t.get("text", "") for t in after if t.get("speaker") == SPEAKER_AGENT
        )
        explicit = interaction.get("metadata", {}).get("escalation_outcome")
        if explicit in ("completed", "transferred", "connected", "honored"):
            escalation_state = "escalation_completed"
        elif explicit in ("deflected", "denied", "not_honored", "ignored"):
            escalation_state = "escalation_not_completed"
        elif _matches(agent_after, _ESCALATION_COMPLETED_PATTERNS):
            escalation_state = "escalation_completed"
        elif _matches(agent_after, _ESCALATION_REFUSED_PATTERNS):
            escalation_state = "escalation_not_completed"
        elif not after:
            # The recording ends at the request. Nobody knows what happened.
            escalation_state = "escalation_outcome_unknown"
        else:
            escalation_state = "escalation_outcome_unknown"

    # Impersonation Latency — the elapsed interval between interaction start and
    # the point of disclosure. It measures disclosure timing. It does not
    # establish that impersonation occurred, intent, the presence of an
    # impersonator, authentication or authorization.
    il_turns = disclosure_turn_index if disclosure_turn_index is not None else None
    il_seconds = None
    if disclosure_offset_ms is not None:
        il_seconds = round(disclosure_offset_ms / 1000.0, 2)

    attestation = interaction.get("transcription_attestation") or {}
    return {
        "turn_count": len(turns),
        "agent_turn_count": len(agent_turns),
        "human_turn_count": len(human_turns),
        "disclosed": disclosure_turn_index is not None,
        "disclosure_turn_index": disclosure_turn_index,
        "impersonation_latency_turns": il_turns,
        "impersonation_latency_seconds": il_seconds,
        "phi_requested": bool(phi_turn_indices),
        "phi_before_disclosure": phi_before_disclosure,
        "escalation_requested": escalation_request_idx is not None,
        "escalation_state": escalation_state,
        "transcription_status": attestation.get("status", ATTESTATION_UNATTESTED),
        "transcription_wer": attestation.get("wer"),
    }


def evaluate_controls(interaction: Dict[str, Any], facts: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Evaluate the four controls, returning one result per control.

    Each result carries an explanation, because a user must be able to answer
    "why did NHID flag this?" without reading source.
    """
    results: List[Dict[str, Any]] = []
    ai = interaction.get("ai_assessment", AI_UNKNOWN)
    has_agent_turns = facts["agent_turn_count"] > 0

    # ── IDG-01: did the non-human actor disclose? ────────────────────────────
    if ai == AI_UNKNOWN and not facts["disclosed"]:
        # No disclosure and no vendor signal: we cannot tell whether this was an
        # AI at all, so the control does not apply rather than failing.
        results.append(_result(
            "IDG-01", RESULT_NOT_ASSESSABLE,
            "No disclosure was detected and no vendor metadata identifies this "
            "caller as non-human, so whether IDG-01 applies cannot be determined "
            "from this interaction alone.",
        ))
    elif not has_agent_turns:
        results.append(_result(
            "IDG-01", RESULT_NOT_ASSESSABLE,
            "The transcript contains no turns attributed to the calling agent.",
        ))
    elif facts["disclosed"]:
        il = facts["impersonation_latency_turns"]
        if il == 0:
            results.append(_result(
                "IDG-01", RESULT_PASS,
                "Disclosure occurred on the opening turn "
                "(Impersonation Latency = 0 turns).",
            ))
        else:
            results.append(_result(
                "IDG-01", RESULT_EXCEPTION,
                f"Disclosure occurred at turn {il} rather than the opening turn "
                f"(Impersonation Latency = {il} turns).",
                category=CAT_DISCLOSURE_DELAYED,
            ))
    else:
        results.append(_result(
            "IDG-01", RESULT_EXCEPTION,
            "The caller is identified as non-human but no disclosure was "
            "detected anywhere in the transcript.",
            category=CAT_DISCLOSURE_MISSING,
        ))

    # ── PDX-01: did protected data move before disclosure? ───────────────────
    if not facts["phi_requested"]:
        results.append(_result(
            "PDX-01", RESULT_PASS,
            "No request for protected data was detected in the transcript.",
        ))
    elif facts["phi_before_disclosure"]:
        results.append(_result(
            "PDX-01", RESULT_EXCEPTION,
            "The agent requested protected data before any disclosure was made.",
            category=CAT_PHI_BEFORE_DISCLOSURE,
        ))
    else:
        results.append(_result(
            "PDX-01", RESULT_PASS,
            "Protected data was requested only after disclosure.",
        ))

    # ── EIT-01: was escalation requested, and was it completed? ──────────────
    state = facts["escalation_state"]
    if state == "escalation_not_requested":
        results.append(_result(
            "EIT-01", RESULT_PASS,
            "No escalation request was detected from the human recipient.",
        ))
    elif state == "escalation_completed":
        results.append(_result(
            "EIT-01", RESULT_PASS,
            "The human requested escalation and the transcript shows it completed.",
        ))
    elif state == "escalation_not_completed":
        results.append(_result(
            "EIT-01", RESULT_EXCEPTION,
            "The human requested escalation and the agent did not complete it.",
            category=CAT_ESCALATION_NOT_COMPLETED,
        ))
    else:
        results.append(_result(
            "EIT-01", RESULT_UNKNOWN,
            "The human requested escalation and the transcript does not show "
            "whether it completed. This is reported as unknown rather than "
            "resolved either way: completion was neither observed nor refused.",
            category=CAT_ESCALATION_OUTCOME_UNKNOWN,
        ))

    # ── ATR-01: is the evidence complete enough to rely on? ──────────────────
    missing = []
    if not interaction.get("occurred_at"):
        missing.append("occurred_at")
    if not interaction.get("external_id"):
        missing.append("external_id")
    if facts["turn_count"] == 0:
        missing.append("turns")
    unattested = facts["transcription_status"] == ATTESTATION_UNATTESTED

    if missing:
        results.append(_result(
            "ATR-01", RESULT_EXCEPTION,
            "The audit record is incomplete; missing: " + ", ".join(missing) + ".",
            category=CAT_INSUFFICIENT_EVIDENCE,
        ))
    elif unattested:
        results.append(_result(
            "ATR-01", RESULT_UNKNOWN,
            "The audit record is structurally complete, but the accuracy of the "
            "transcription path that produced it is unattested. Every finding on "
            "this interaction is valid only to a precision nobody has stated.",
            category=CAT_TRANSCRIPTION_UNATTESTED,
        ))
    else:
        wer = facts["transcription_wer"]
        results.append(_result(
            "ATR-01", RESULT_PASS,
            "The audit record is complete and the transcription path is "
            f"attested at WER {wer:.1%}." if wer is not None else
            "The audit record is complete and the transcription path is attested.",
        ))

    return results


def _result(control: str, result: str, explanation: str,
            category: Optional[str] = None) -> Dict[str, Any]:
    return {
        "control_id": control,
        "result": result,
        "explanation": explanation,
        "finding_category": category,
    }


# ── Schema ────────────────────────────────────────────────────────────────────

def init_monitoring_tables() -> None:
    """Idempotent schema bootstrap. Safe on every startup."""
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS assessments (
                    assessment_id TEXT PRIMARY KEY,
                    org_id        TEXT NOT NULL,
                    name          TEXT NOT NULL,
                    period_start  TIMESTAMPTZ,
                    period_end    TIMESTAMPTZ,
                    status        TEXT NOT NULL DEFAULT 'open',
                    is_synthetic  BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS interactions (
                    interaction_id  TEXT PRIMARY KEY,
                    org_id          TEXT NOT NULL,
                    assessment_id   TEXT NOT NULL,
                    external_id     TEXT NOT NULL,
                    occurred_at     TIMESTAMPTZ NOT NULL,
                    source_vendor   TEXT NOT NULL,
                    source_type     TEXT NOT NULL,
                    ai_assessment   TEXT NOT NULL,
                    language        TEXT,
                    interpreter_present BOOLEAN,
                    transcription_status TEXT NOT NULL DEFAULT 'unattested',
                    transcription_wer    DOUBLE PRECISION,
                    transcript      TEXT NOT NULL,
                    facts           TEXT,
                    evaluation_status TEXT NOT NULL DEFAULT 'pending',
                    is_synthetic    BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (org_id, assessment_id, external_id)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS evaluations (
                    evaluation_id  TEXT PRIMARY KEY,
                    org_id         TEXT NOT NULL,
                    interaction_id TEXT NOT NULL,
                    control_id     TEXT NOT NULL,
                    result         TEXT NOT NULL,
                    explanation    TEXT NOT NULL,
                    evaluated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (interaction_id, control_id)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS findings (
                    finding_id     TEXT PRIMARY KEY,
                    org_id         TEXT NOT NULL,
                    interaction_id TEXT NOT NULL,
                    assessment_id  TEXT NOT NULL,
                    control_id     TEXT NOT NULL,
                    category       TEXT NOT NULL,
                    summary        TEXT NOT NULL,
                    evidence_event_id TEXT,
                    status         TEXT NOT NULL DEFAULT 'open',
                    resolution     TEXT,
                    reviewer       TEXT,
                    notes          TEXT,
                    remediation    TEXT,
                    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    resolved_at    TIMESTAMPTZ
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS review_events (
                    review_event_id TEXT PRIMARY KEY,
                    org_id          TEXT NOT NULL,
                    finding_id      TEXT NOT NULL,
                    action          TEXT NOT NULL,
                    reviewer        TEXT NOT NULL,
                    note            TEXT,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS time_entries (
                    time_entry_id TEXT PRIMARY KEY,
                    org_id        TEXT NOT NULL,
                    assessment_id TEXT NOT NULL,
                    finding_id    TEXT,
                    activity      TEXT NOT NULL,
                    minutes       DOUBLE PRECISION NOT NULL,
                    reviewer      TEXT,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            for stmt in (
                "CREATE INDEX IF NOT EXISTS idx_int_org_assess ON interactions (org_id, assessment_id)",
                "CREATE INDEX IF NOT EXISTS idx_eval_interaction ON evaluations (interaction_id)",
                "CREATE INDEX IF NOT EXISTS idx_find_org_status ON findings (org_id, status)",
                "CREATE INDEX IF NOT EXISTS idx_find_assessment ON findings (assessment_id)",
                "CREATE INDEX IF NOT EXISTS idx_review_finding ON review_events (finding_id)",
            ):
                cur.execute(stmt)
    finally:
        conn.close()


# ── Assessments ───────────────────────────────────────────────────────────────

def create_assessment(org_id: str, name: str, period_start: Optional[str] = None,
                      period_end: Optional[str] = None,
                      is_synthetic: bool = False) -> Dict[str, Any]:
    """Create a named, date-ranged monitoring run.

    Assessments are what make this a monitoring service rather than a one-off
    report generator: the same organisation runs one this quarter and another
    next quarter, and the two are comparable.
    """
    assessment_id = _uid("asmt")
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO assessments
                   (assessment_id, org_id, name, period_start, period_end, is_synthetic)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (assessment_id, org_id, name, period_start, period_end, is_synthetic),
            )
    finally:
        conn.close()
    return {"assessment_id": assessment_id, "org_id": org_id, "name": name,
            "period_start": period_start, "period_end": period_end,
            "is_synthetic": is_synthetic}


def list_assessments(org_id: str) -> List[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT a.*,
                      (SELECT COUNT(*) FROM interactions i
                        WHERE i.assessment_id = a.assessment_id) AS interaction_count,
                      (SELECT COUNT(*) FROM findings f
                        WHERE f.assessment_id = a.assessment_id AND f.status <> 'resolved')
                        AS open_findings
                 FROM assessments a
                WHERE a.org_id = %s
                ORDER BY a.created_at DESC""",
            (org_id,),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── Ingestion ─────────────────────────────────────────────────────────────────

def ingest_interaction(org_id: str, assessment_id: str, canonical: Dict[str, Any],
                       is_synthetic: bool = False) -> str:
    """Store one canonical interaction. Returns its interaction_id."""
    interaction_id = _uid("int")
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            att = canonical.get("transcription_attestation") or {}
            cur.execute(
                """INSERT INTO interactions
                   (interaction_id, org_id, assessment_id, external_id, occurred_at,
                    source_vendor, source_type, ai_assessment, language,
                    interpreter_present, transcription_status, transcription_wer,
                    transcript, is_synthetic)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (org_id, assessment_id, external_id) DO NOTHING
                   RETURNING interaction_id""",
                (interaction_id, org_id, assessment_id, canonical["external_id"],
                 canonical["occurred_at"], canonical["source_vendor"],
                 canonical["source_type"], canonical["ai_assessment"],
                 canonical.get("language"), canonical.get("interpreter_present"),
                 att.get("status", ATTESTATION_UNATTESTED), att.get("wer"),
                 json.dumps(canonical), is_synthetic),
            )
            row = cur.fetchone()
            if row is None:
                # Already ingested under this assessment; ingestion is idempotent
                # so a re-upload does not duplicate or double-count.
                cur.execute(
                    """SELECT interaction_id FROM interactions
                        WHERE org_id=%s AND assessment_id=%s AND external_id=%s""",
                    (org_id, assessment_id, canonical["external_id"]),
                )
                return cur.fetchone()["interaction_id"]
            return row["interaction_id"]
    finally:
        conn.close()


# ── Evaluation ────────────────────────────────────────────────────────────────

def evaluate_stored_interaction(org_id: str, interaction_id: str) -> Dict[str, Any]:
    """Evaluate one stored interaction, persist results, and raise findings."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM interactions WHERE org_id=%s AND interaction_id=%s",
            (org_id, interaction_id),
        )
        row = cur.fetchone()
    finally:
        conn.close()
    if row is None:
        raise LookupError(f"interaction {interaction_id} not found for org {org_id}")

    canonical = json.loads(row["transcript"])
    facts = analyze_interaction(canonical)
    results = evaluate_controls(canonical, facts)

    created_findings: List[str] = []
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            for res in results:
                cur.execute(
                    """INSERT INTO evaluations
                       (evaluation_id, org_id, interaction_id, control_id, result, explanation)
                       VALUES (%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (interaction_id, control_id) DO UPDATE
                         SET result = EXCLUDED.result,
                             explanation = EXCLUDED.explanation,
                             evaluated_at = NOW()""",
                    (_uid("eval"), org_id, interaction_id, res["control_id"],
                     res["result"], res["explanation"]),
                )
                # Exceptions and unknowns both deserve a human. An unknown is not
                # a pass: it is an interaction whose outcome nobody established.
                if res["result"] in (RESULT_EXCEPTION, RESULT_UNKNOWN) and res["finding_category"]:
                    finding_id = _uid("find")
                    cur.execute(
                        """INSERT INTO findings
                           (finding_id, org_id, interaction_id, assessment_id,
                            control_id, category, summary, status)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,'open')""",
                        (finding_id, org_id, interaction_id, row["assessment_id"],
                         res["control_id"], res["finding_category"], res["explanation"]),
                    )
                    created_findings.append(finding_id)
            cur.execute(
                "UPDATE interactions SET evaluation_status='evaluated', facts=%s "
                "WHERE interaction_id=%s",
                (json.dumps(facts), interaction_id),
            )
    finally:
        conn.close()

    return {"interaction_id": interaction_id, "facts": facts,
            "results": results, "findings_created": created_findings}


def evaluate_assessment(org_id: str, assessment_id: str) -> Dict[str, Any]:
    """Evaluate every pending interaction in an assessment."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT interaction_id FROM interactions
                WHERE org_id=%s AND assessment_id=%s AND evaluation_status='pending'""",
            (org_id, assessment_id),
        )
        pending = [r["interaction_id"] for r in cur.fetchall()]
    finally:
        conn.close()

    findings = 0
    for iid in pending:
        findings += len(evaluate_stored_interaction(org_id, iid)["findings_created"])
    return {"evaluated": len(pending), "findings_created": findings}


# ── Queues and detail ─────────────────────────────────────────────────────────

def list_interactions(org_id: str, assessment_id: Optional[str] = None,
                      search: Optional[str] = None, status: Optional[str] = None,
                      limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    """The interaction queue: what a QA analyst works through."""
    clauses = ["i.org_id = %s"]
    params: List[Any] = [org_id]
    if assessment_id:
        clauses.append("i.assessment_id = %s")
        params.append(assessment_id)
    if status:
        clauses.append("i.evaluation_status = %s")
        params.append(status)
    if search:
        clauses.append("(i.external_id ILIKE %s OR i.source_vendor ILIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])
    params.extend([limit, offset])

    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""SELECT i.interaction_id, i.external_id, i.occurred_at, i.source_vendor,
                       i.ai_assessment, i.language, i.interpreter_present,
                       i.transcription_status, i.transcription_wer,
                       i.evaluation_status, i.is_synthetic, i.facts,
                       (SELECT COUNT(*) FROM findings f
                         WHERE f.interaction_id = i.interaction_id
                           AND f.status <> 'resolved') AS open_findings
                  FROM interactions i
                 WHERE {' AND '.join(clauses)}
                 ORDER BY i.occurred_at DESC
                 LIMIT %s OFFSET %s""",
            tuple(params),
        )
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            row["facts"] = json.loads(row["facts"]) if row.get("facts") else None
            rows.append(row)
        return rows
    finally:
        conn.close()


def get_interaction(org_id: str, interaction_id: str) -> Optional[Dict[str, Any]]:
    """Everything the detail screen needs to answer 'why did NHID flag this?'."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM interactions WHERE org_id=%s AND interaction_id=%s",
            (org_id, interaction_id),
        )
        row = cur.fetchone()
        if row is None:
            return None
        interaction = dict(row)
        canonical = json.loads(interaction.pop("transcript"))
        interaction["facts"] = json.loads(interaction["facts"]) if interaction.get("facts") else None
        interaction["turns"] = canonical.get("turns", [])
        interaction["transcription_attestation"] = canonical.get("transcription_attestation")

        cur.execute(
            "SELECT control_id, result, explanation, evaluated_at FROM evaluations "
            "WHERE interaction_id=%s ORDER BY control_id",
            (interaction_id,),
        )
        interaction["evaluations"] = [dict(r) for r in cur.fetchall()]

        cur.execute(
            "SELECT * FROM findings WHERE interaction_id=%s ORDER BY created_at",
            (interaction_id,),
        )
        interaction["findings"] = [dict(r) for r in cur.fetchall()]
        return interaction
    finally:
        conn.close()


def list_findings(org_id: str, assessment_id: Optional[str] = None,
                  status: Optional[str] = None, category: Optional[str] = None,
                  limit: int = 200) -> List[Dict[str, Any]]:
    clauses = ["f.org_id = %s"]
    params: List[Any] = [org_id]
    for column, value in (("f.assessment_id", assessment_id),
                          ("f.status", status), ("f.category", category)):
        if value:
            clauses.append(f"{column} = %s")
            params.append(value)
    params.append(limit)
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""SELECT f.*, i.external_id, i.occurred_at, i.source_vendor,
                       i.transcription_status
                  FROM findings f
                  JOIN interactions i ON i.interaction_id = f.interaction_id
                 WHERE {' AND '.join(clauses)}
                 ORDER BY f.created_at DESC
                 LIMIT %s""",
            tuple(params),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def get_finding(org_id: str, finding_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT f.*, i.external_id, i.occurred_at, i.source_vendor,
                      i.transcription_status, i.transcription_wer
                 FROM findings f
                 JOIN interactions i ON i.interaction_id = f.interaction_id
                WHERE f.org_id=%s AND f.finding_id=%s""",
            (org_id, finding_id),
        )
        row = cur.fetchone()
        if row is None:
            return None
        finding = dict(row)
        cur.execute(
            "SELECT * FROM review_events WHERE finding_id=%s ORDER BY created_at",
            (finding_id,),
        )
        finding["review_history"] = [dict(r) for r in cur.fetchall()]
        return finding
    finally:
        conn.close()


# ── Review and remediation ────────────────────────────────────────────────────

def update_finding(org_id: str, finding_id: str, *, status: Optional[str] = None,
                   resolution: Optional[str] = None, reviewer: Optional[str] = None,
                   notes: Optional[str] = None,
                   remediation: Optional[str] = None) -> Dict[str, Any]:
    """Move a finding through open -> under_review -> resolved.

    Deliberately not an ITSM workflow. Three states and an optional resolution
    is what a QA analyst needs to record a decision; anything more is a product
    nobody asked for.
    """
    if status and status not in FINDING_STATUSES:
        raise ValueError(f"status must be one of {FINDING_STATUSES}")
    if resolution and resolution not in RESOLUTIONS:
        raise ValueError(f"resolution must be one of {RESOLUTIONS}")

    sets, params = [], []
    for column, value in (("status", status), ("resolution", resolution),
                          ("reviewer", reviewer), ("notes", notes),
                          ("remediation", remediation)):
        if value is not None:
            sets.append(f"{column} = %s")
            params.append(value)
    if status == FINDING_RESOLVED:
        sets.append("resolved_at = NOW()")
    if not sets:
        raise ValueError("nothing to update")
    params.extend([org_id, finding_id])

    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                f"UPDATE findings SET {', '.join(sets)} "
                "WHERE org_id=%s AND finding_id=%s RETURNING *",
                tuple(params),
            )
            row = cur.fetchone()
            if row is None:
                raise LookupError(f"finding {finding_id} not found")
            # Every state change is recorded. The review history is part of the
            # evidence, not metadata about it.
            cur.execute(
                """INSERT INTO review_events
                   (review_event_id, org_id, finding_id, action, reviewer, note)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (_uid("rev"), org_id, finding_id,
                 status or resolution or "updated", reviewer or "unknown", notes),
            )
            return dict(row)
    finally:
        conn.close()


def record_time(org_id: str, assessment_id: str, activity: str, minutes: float,
                finding_id: Optional[str] = None,
                reviewer: Optional[str] = None) -> str:
    """Record reviewer or remediation effort.

    Measurement infrastructure, not an ROI claim. This records what was spent;
    it does not compute a saving, and no part of this product asserts one.
    """
    entry_id = _uid("time")
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO time_entries
                   (time_entry_id, org_id, assessment_id, finding_id, activity, minutes, reviewer)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (entry_id, org_id, assessment_id, finding_id, activity, minutes, reviewer),
            )
    finally:
        conn.close()
    return entry_id


# ── Metrics and report ────────────────────────────────────────────────────────

def compute_metrics(org_id: str, assessment_id: Optional[str] = None) -> Dict[str, Any]:
    """Every metric the product reports, each with its denominator.

    There is no composite score here and there must never be one. A reader can
    reconstruct any figure below from the counts beside it.
    """
    rows = list_interactions(org_id, assessment_id=assessment_id, limit=100000)
    total = len(rows)
    evaluated = [r for r in rows if r["evaluation_status"] == "evaluated" and r["facts"]]

    non_human = [r for r in evaluated if r["ai_assessment"] == AI_NON_HUMAN]
    disclosed = [r for r in non_human if r["facts"]["disclosed"]]
    il_turns = [r["facts"]["impersonation_latency_turns"] for r in disclosed
                if r["facts"]["impersonation_latency_turns"] is not None]
    il_seconds = [r["facts"]["impersonation_latency_seconds"] for r in disclosed
                  if r["facts"]["impersonation_latency_seconds"] is not None]

    phi_before = [r for r in evaluated if r["facts"]["phi_before_disclosure"]]
    esc_requested = [r for r in evaluated if r["facts"]["escalation_requested"]]
    esc_completed = [r for r in esc_requested
                     if r["facts"]["escalation_state"] == "escalation_completed"]
    esc_not_completed = [r for r in esc_requested
                         if r["facts"]["escalation_state"] == "escalation_not_completed"]
    esc_unknown = [r for r in esc_requested
                   if r["facts"]["escalation_state"] == "escalation_outcome_unknown"]

    attested = [r for r in rows if r["transcription_status"] != ATTESTATION_UNATTESTED]

    conn = get_conn()
    try:
        cur = conn.cursor()
        params = [org_id] + ([assessment_id] if assessment_id else [])
        extra = " AND assessment_id = %s" if assessment_id else ""
        cur.execute(
            f"SELECT status, COUNT(*) AS n FROM findings WHERE org_id=%s{extra} GROUP BY status",
            tuple(params),
        )
        by_status = {r["status"]: r["n"] for r in cur.fetchall()}
        cur.execute(
            f"SELECT category, COUNT(*) AS n FROM findings WHERE org_id=%s{extra} GROUP BY category",
            tuple(params),
        )
        by_category = {r["category"]: r["n"] for r in cur.fetchall()}
        cur.execute(
            f"SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE org_id=%s{extra}",
            tuple(params),
        )
        review_minutes = float(cur.fetchone()["m"] or 0)
    finally:
        conn.close()

    def rate(numerator: int, denominator: int):
        return round(numerator / denominator, 4) if denominator else None

    return {
        "interactions_analyzed": total,
        "interactions_evaluated": len(evaluated),
        "non_human_interactions": len(non_human),
        "non_human_denominator": len(evaluated),
        "disclosure": {
            "disclosed": len(disclosed),
            "denominator": len(non_human),
            "rate": rate(len(disclosed), len(non_human)),
        },
        "impersonation_latency": {
            "definition": (
                "Elapsed interval between interaction start and the point at which "
                "a non-human actor discloses its non-human identity. Measures "
                "disclosure timing only; establishes neither impersonation, intent, "
                "authentication nor authorization."
            ),
            "measured_over": len(il_turns),
            "turns_median": _median(il_turns),
            "turns_max": max(il_turns) if il_turns else None,
            "disclosed_on_opening_turn": sum(1 for v in il_turns if v == 0),
            "seconds_median": _median(il_seconds),
        },
        "phi_before_disclosure": {
            "count": len(phi_before), "denominator": len(evaluated),
            "rate": rate(len(phi_before), len(evaluated)),
        },
        "escalation": {
            "requested": len(esc_requested),
            "completed": len(esc_completed),
            "not_completed": len(esc_not_completed),
            "outcome_unknown": len(esc_unknown),
            "completion_rate": rate(len(esc_completed), len(esc_requested)),
        },
        "findings": {
            "open": by_status.get(FINDING_OPEN, 0),
            "under_review": by_status.get(FINDING_UNDER_REVIEW, 0),
            "resolved": by_status.get(FINDING_RESOLVED, 0),
            "by_category": by_category,
        },
        "evidence_completeness": {
            "evaluated": len(evaluated), "denominator": total,
            "fraction": rate(len(evaluated), total),
        },
        "transcription_attestation": {
            "attested": len(attested), "denominator": total,
            "unattested": total - len(attested),
            "fraction_attested": rate(len(attested), total),
        },
        "review_effort_minutes": review_minutes,
    }


def _median(values: List[float]):
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return round((ordered[mid - 1] + ordered[mid]) / 2, 2)


def build_report(org_id: str, assessment_id: str) -> Dict[str, Any]:
    """Healthcare Voice-AI Governance Assessment.

    An assessment of observed governance controls over a stated set of
    interactions. It is not a certification, a compliance certificate, a trust
    assessment or an approval, and it does not become one by being printed.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM assessments WHERE org_id=%s AND assessment_id=%s",
            (org_id, assessment_id),
        )
        assessment = cur.fetchone()
    finally:
        conn.close()
    if assessment is None:
        raise LookupError(f"assessment {assessment_id} not found")

    metrics = compute_metrics(org_id, assessment_id)
    rows = list_interactions(org_id, assessment_id=assessment_id, limit=100000)
    synthetic = sum(1 for r in rows if r["is_synthetic"])
    unattested = metrics["transcription_attestation"]["unattested"]

    limitations = [
        "This is an assessment of observed governance controls over the "
        "interactions supplied. It is not a certification, a compliance "
        "determination, or an approval of any party.",
        "NHID evaluates transcript and event data. It does not perform speech "
        "recognition and does not establish the accuracy of the transcription "
        "path. Disclosure and escalation findings are valid only to the "
        "precision of that path.",
        "Controls are evaluated from what appears in the transcript. An "
        "interaction whose audio was mis-transcribed may be scored incorrectly, "
        "and a missed escalation request produces no finding at all.",
        "No finding here is a statement about intent, impersonation, "
        "authentication or authorization.",
    ]
    if unattested:
        limitations.insert(1, (
            f"{unattested} of {metrics['interactions_analyzed']} interactions carry "
            "no transcription-quality attestation. For those, the precision of "
            "every finding is unstated."
        ))
    if synthetic:
        limitations.insert(0, (
            f"{synthetic} of {len(rows)} interactions in this assessment are "
            "SYNTHETIC demonstration records, not observed traffic."
        ))

    return {
        "title": "Healthcare Voice-AI Governance Assessment",
        "assessment": dict(assessment),
        "generated_at": _now(),
        "metrics": metrics,
        "methodology": (
            "Interactions supplied by the organisation were normalized to a "
            "single canonical shape, then evaluated against NHID-Clinical "
            "controls IDG-01 (identity disclosure), PDX-01 (protected-data "
            "sequencing), EIT-01 (escalation) and ATR-01 (audit record). Each "
            "control returns pass, exception, unknown or not assessable; "
            "'unknown' is reported rather than resolved in either direction."
        ),
        "limitations": limitations,
        "synthetic_records": synthetic,
    }
