"""
saas_layer/voice_policy.py — Real-time voice policy enforcement for NHID Clinical.

The engine evaluates an ordered list of rules against each transcript chunk.
Rules are loaded from per-org DB config at runtime; if no custom config exists
the hardcoded DEFAULT_RULESET (from voice_policy_store) is used as the fallback.

Supported rule types
  builtin      : REQUIRE_UPFRONT_DISCLOSURE — first-turn AI identity disclosure
  phrase_match : HUMAN_ESCALATION_REQUESTED — escalate on trigger phrases

New rule types (e.g. HIPAA_TOPIC_DETECTION, MEDICATION_REFUSAL_DETECTION) can
be added to _RULE_EVALUATORS without touching the run_voice_policy call site.

Backward-compatibility note
  The legacy `phrases` and `policy_version` keyword arguments still work so that
  the 49-test suite continues to pass without modification.
"""

from typing import Any, Callable, Dict, List, Optional

POLICY_VERSION = "VOICE-POLICY-v1.0"

# ── Legacy defaults (used when no ruleset/phrases arg is supplied) ─────────────
_ESCALATION_PHRASES = [
    "speak to a human",
    "real person",
    "agent please",
    "transfer me",
    "human agent",
    "talk to someone",
]

# ── Deceptive-artifact defaults (DBC-01) ──────────────────────────────────────
# Prohibited audio/presence cues whose only purpose is to imply a human is
# present. Detection is driven by explicit signals (structured flags or
# annotated transcript markers) so it is deterministic and false-positive free.
_DECEPTIVE_ARTIFACT_FLAGS = [
    "synthetic_breathing",
    "fake_typing",
    "artificial_hesitation",
    "call_center_noise",
    "scripted_filler",
]

_DECEPTIVE_TRANSCRIPT_MARKERS = [
    "[breathing]",
    "[typing]",
    "[sigh]",
    "[keyboard]",
]


# ── Low-level rule evaluators ─────────────────────────────────────────────────

def check_disclosure(session_state: Dict[str, Any]) -> bool:
    """
    Return True (disclosure needed) when the opening disclosure has not yet
    been confirmed for this session.
    """
    return not session_state.get("disclosure_confirmed", False)


def check_escalation(
    transcript_text: str,
    phrases: Optional[List[str]] = None,
) -> bool:
    """
    Return True (escalation needed) when the transcript contains any trigger phrase.
    Comparison is case-insensitive.
    If `phrases` is None the module-level hardcoded list is used.
    """
    phrase_list = phrases if phrases is not None else _ESCALATION_PHRASES
    lower = transcript_text.lower()
    return any(phrase in lower for phrase in phrase_list)


def check_deceptive_artifacts(
    transcript_text: str,
    session_state: Dict[str, Any],
    prohibited_flags: Optional[List[str]] = None,
    markers: Optional[List[str]] = None,
) -> List[str]:
    """
    Return a sorted list of deceptive-artifact reasons detected (DBC-01).
    An empty list means no deceptive artifacts were detected.

    Detection sources (all deterministic, signal-driven — no guessing):
      1. Structured flags in session_state["audio_artifacts"] that intersect the
         prohibited set.
      2. Annotated cue markers present in the transcript text (e.g. "[breathing]").
      3. A human name presented with no AI qualifier:
         session_state["human_name_used"] is True AND
         session_state["ai_qualifier_present"] is not True.
    """
    flag_set = prohibited_flags if prohibited_flags is not None else _DECEPTIVE_ARTIFACT_FLAGS
    marker_set = markers if markers is not None else _DECEPTIVE_TRANSCRIPT_MARKERS

    detected: List[str] = []

    artifacts = session_state.get("audio_artifacts", []) or []
    for a in artifacts:
        if a in flag_set:
            detected.append(f"flag:{a}")

    lower = transcript_text.lower()
    for m in marker_set:
        if m.lower() in lower:
            detected.append(f"marker:{m}")

    if session_state.get("human_name_used") and not session_state.get("ai_qualifier_present"):
        detected.append("human_name_without_ai_qualifier")

    return sorted(set(detected))


def check_authorization(
    session_state: Dict[str, Any],
    required_scope: Optional[str] = None,
    required: bool = True,
) -> Dict[str, Any]:
    """
    Evaluate the agent authorization verdict carried in session_state (anti-spoof).

    The verdict is expected at session_state["authorization"], a plain dict of
    shape {"verified": bool, "reason": str, "agent_id": str, "scope": [str, ...]}.

    Returns {"ok": bool, "reason_code": str|None, "detail": str}.
    """
    verdict = session_state.get("authorization")

    if verdict is None:
        if required:
            return {"ok": False, "reason_code": "AGENT_NOT_AUTHORIZED",
                    "detail": "No agent authorization presented"}
        return {"ok": True, "reason_code": None, "detail": "Authorization not required"}

    if not verdict.get("verified", False):
        return {"ok": False, "reason_code": "AGENT_NOT_AUTHORIZED",
                "detail": verdict.get("reason", "Authorization not verified")}

    if required_scope is not None:
        scope = verdict.get("scope") or []
        if required_scope not in scope:
            return {"ok": False, "reason_code": "AGENT_SCOPE_INSUFFICIENT",
                    "detail": f"Scope '{required_scope}' not granted"}

    return {"ok": True, "reason_code": None, "detail": "Authorized"}


# ── Per-rule-type evaluator functions ─────────────────────────────────────────
# Signature: (rule, transcript_text, session_state) -> decision dict or None
# Return None to pass through (rule did not trigger).

def _eval_builtin_disclosure(
    rule: Dict[str, Any],
    transcript_text: str,
    session_state: Dict[str, Any],
    policy_version: str,
) -> Optional[Dict[str, Any]]:
    if check_disclosure(session_state):
        return {
            "action": "disclose",
            "reason_code": rule.get("rule_key", "REQUIRE_UPFRONT_DISCLOSURE"),
            "policy_version": policy_version,
        }
    return None


def _eval_phrase_match(
    rule: Dict[str, Any],
    transcript_text: str,
    session_state: Dict[str, Any],
    policy_version: str,
) -> Optional[Dict[str, Any]]:
    # Use the stored phrases list authoritatively.
    # An empty list means "no triggers configured" — match nothing.
    # Only fall back to hardcoded defaults in the legacy (non-ruleset) path.
    phrases_val = rule.get("params", {}).get("phrases")
    phrases: List[str] = phrases_val if isinstance(phrases_val, list) else []
    if check_escalation(transcript_text, phrases):
        return {
            "action": "escalate",
            "reason_code": rule.get("rule_key", "HUMAN_ESCALATION_REQUESTED"),
            "policy_version": policy_version,
        }
    return None


def _eval_authorization(
    rule: Dict[str, Any],
    transcript_text: str,
    session_state: Dict[str, Any],
    policy_version: str,
) -> Optional[Dict[str, Any]]:
    params = rule.get("params", {}) or {}
    result = check_authorization(
        session_state,
        required_scope=params.get("required_scope"),
        required=params.get("required", True),
    )
    if not result["ok"]:
        return {
            "action": "deny",
            "reason_code": result["reason_code"],
            "policy_version": policy_version,
            "detail": result["detail"],
        }
    return None


def _eval_deceptive_artifacts(
    rule: Dict[str, Any],
    transcript_text: str,
    session_state: Dict[str, Any],
    policy_version: str,
) -> Optional[Dict[str, Any]]:
    params = rule.get("params", {}) or {}
    detected = check_deceptive_artifacts(
        transcript_text,
        session_state,
        prohibited_flags=params.get("prohibited_flags"),
        markers=params.get("markers"),
    )
    if detected:
        return {
            "action": "deny",
            "reason_code": rule.get("rule_key", "PROHIBIT_DECEPTIVE_ARTIFACTS"),
            "policy_version": policy_version,
            "detail": ",".join(detected),
        }
    return None


# Map rule_key → evaluator; rule_type is used as fallback.
_RULE_EVALUATORS: Dict[str, Callable] = {
    "REQUIRE_UPFRONT_DISCLOSURE": _eval_builtin_disclosure,
    "HUMAN_ESCALATION_REQUESTED": _eval_phrase_match,
    "REQUIRE_AGENT_AUTHORIZATION": _eval_authorization,
    "PROHIBIT_DECEPTIVE_ARTIFACTS": _eval_deceptive_artifacts,
    # rule_type aliases
    "builtin": _eval_builtin_disclosure,
    "phrase_match": _eval_phrase_match,
    "authorization": _eval_authorization,
    "artifact_detection": _eval_deceptive_artifacts,
}


def _evaluate_rule(
    rule: Dict[str, Any],
    transcript_text: str,
    session_state: Dict[str, Any],
    policy_version: str,
) -> Optional[Dict[str, Any]]:
    """Dispatch a single rule to its evaluator, return decision dict or None."""
    key = rule.get("rule_key", "")
    rtype = rule.get("rule_type", "")
    evaluator = _RULE_EVALUATORS.get(key) or _RULE_EVALUATORS.get(rtype)
    if evaluator is None:
        return None
    return evaluator(rule, transcript_text, session_state, policy_version)


# ── Public entry point ────────────────────────────────────────────────────────

def run_voice_policy(
    transcript_text: str,
    session_state: Dict[str, Any],
    phrases: Optional[List[str]] = None,
    policy_version: Optional[str] = None,
    ruleset: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Run the voice policy engine and return an enforcement decision.

    Parameters
    ----------
    transcript_text : caller transcript chunk
    session_state   : at minimum {"disclosure_confirmed": bool}
    phrases         : (legacy) override escalation phrases; used when `ruleset` is None
    policy_version  : (legacy) version string to embed; defaults to POLICY_VERSION
    ruleset         : (preferred) full ordered rule list from voice_policy_store;
                      when provided the rule-based evaluation path is used

    Returns
    -------
    dict with keys: action, reason_code, policy_version
      action      — "disclose" | "escalate" | "allow"
      reason_code — rule key on trigger, None on allow
    """
    version = policy_version if policy_version is not None else POLICY_VERSION

    if ruleset is not None:
        # ── Rule-based evaluation (preferred path) ────────────────────────────
        # Rules are evaluated in ascending priority order; first trigger wins.
        for rule in sorted(ruleset, key=lambda r: r.get("priority", 0)):
            if not rule.get("enabled", True):
                continue
            decision = _evaluate_rule(rule, transcript_text, session_state, version)
            if decision is not None:
                return decision
        return {"action": "allow", "reason_code": None, "policy_version": version}

    # ── Legacy path (backward-compat; used by existing tests) ────────────────
    if check_disclosure(session_state):
        return {
            "action": "disclose",
            "reason_code": "REQUIRE_UPFRONT_DISCLOSURE",
            "policy_version": version,
        }

    if check_escalation(transcript_text, phrases):
        return {
            "action": "escalate",
            "reason_code": "HUMAN_ESCALATION_REQUESTED",
            "policy_version": version,
        }

    return {"action": "allow", "reason_code": None, "policy_version": version}


# ── Default full ruleset (all five conformance controls) ──────────────────────

def default_full_ruleset(
    escalation_phrases: Optional[List[str]] = None,
    required_scope: Optional[str] = None,
    require_authorization: bool = True,
) -> List[Dict[str, Any]]:
    """
    Build an ordered ruleset enforcing all five NHID conformance controls.

    Priority order (first trigger wins):
      0. Authorization (anti-spoof) — deny unverified/out-of-scope agents
      1. Deceptive artifacts (DBC-01) — deny human-presence deception
      2. Disclosure (IDG-01/PDX-01) — disclose before data exchange
      3. Escalation (EIT-01) — hand off to a human on request
    """
    phrases = escalation_phrases if escalation_phrases is not None else list(_ESCALATION_PHRASES)
    return [
        {
            "rule_key": "REQUIRE_AGENT_AUTHORIZATION",
            "rule_type": "authorization",
            "enabled": True,
            "priority": 0,
            "params": {"required": require_authorization, "required_scope": required_scope},
        },
        {
            "rule_key": "PROHIBIT_DECEPTIVE_ARTIFACTS",
            "rule_type": "artifact_detection",
            "enabled": True,
            "priority": 1,
            "params": {},
        },
        {
            "rule_key": "REQUIRE_UPFRONT_DISCLOSURE",
            "rule_type": "builtin",
            "enabled": True,
            "priority": 2,
            "params": {},
        },
        {
            "rule_key": "HUMAN_ESCALATION_REQUESTED",
            "rule_type": "phrase_match",
            "enabled": True,
            "priority": 3,
            "params": {"phrases": phrases},
        },
    ]


# ── ATR-01: structured audit-record emission ──────────────────────────────────

AUDIT_REQUIRED_FIELDS = (
    "session_id",
    "turn_number",
    "timestamp",
    "action",
    "reason_code",
    "policy_version",
    "transcript_excerpt",
    "agent_id",
)


def build_audit_record(
    decision: Dict[str, Any],
    *,
    session_id: str,
    transcript_text: str,
    turn_number: Optional[int] = None,
    agent_id: Optional[str] = None,
    timestamp: Optional[int] = None,
    excerpt_len: int = 120,
) -> Dict[str, Any]:
    """
    Build a deterministic, structured audit record for a single policy decision
    (ATR-01). Pure: given the same inputs (including an explicit timestamp) it
    always produces the same record. Pass an explicit timestamp for reproducible
    records; otherwise current epoch seconds are used.
    """
    if timestamp is None:
        import time as _time
        timestamp = int(_time.time())

    record = {
        "session_id": session_id,
        "turn_number": turn_number,
        "timestamp": timestamp,
        "action": decision.get("action"),
        "reason_code": decision.get("reason_code"),
        "policy_version": decision.get("policy_version"),
        "transcript_excerpt": transcript_text[:excerpt_len],
        "agent_id": agent_id,
    }
    if "detail" in decision:
        record["detail"] = decision["detail"]
    return record


def run_voice_policy_audited(
    transcript_text: str,
    session_state: Dict[str, Any],
    *,
    session_id: str,
    turn_number: Optional[int] = None,
    agent_id: Optional[str] = None,
    timestamp: Optional[int] = None,
    phrases: Optional[List[str]] = None,
    policy_version: Optional[str] = None,
    ruleset: Optional[List[Dict[str, Any]]] = None,
):
    """
    Convenience wrapper: run the policy engine AND emit an ATR-01 audit record.
    Returns a tuple (decision, audit_record).
    """
    decision = run_voice_policy(
        transcript_text,
        session_state,
        phrases=phrases,
        policy_version=policy_version,
        ruleset=ruleset,
    )
    audit = build_audit_record(
        decision,
        session_id=session_id,
        transcript_text=transcript_text,
        turn_number=turn_number,
        agent_id=agent_id,
        timestamp=timestamp,
    )
    return decision, audit
