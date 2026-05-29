"""
saas_layer/voice_policy.py — Real-time voice policy enforcement for NHID Clinical.

Two rules run synchronously on every transcript chunk:
  1. REQUIRE_UPFRONT_DISCLOSURE  — first-turn enforcement: if the opening
     disclosure has not yet been confirmed, return `disclose` immediately.
  2. HUMAN_ESCALATION_REQUESTED — trigger phrase detection: if the caller
     uses any recognised escalation phrase, return `escalate`.

If both rules pass, the chunk is `allow`ed.

Per-org phrase customisation is supported via the optional `phrases` parameter
on `run_voice_policy`.  When `phrases` is None the hardcoded defaults below
are used, preserving backward-compatibility with callers (and tests) that do
not pass a phrases argument.
"""

from typing import Any, Dict, List, Optional

POLICY_VERSION = "VOICE-POLICY-v1.0"

_ESCALATION_PHRASES = [
    "speak to a human",
    "real person",
    "agent please",
    "transfer me",
    "human agent",
    "talk to someone",
]


def check_disclosure(session_state: Dict[str, Any]) -> bool:
    """
    Return True (needs disclosure) if the opening disclosure has not yet
    been confirmed for this session.
    """
    return not session_state.get("disclosure_confirmed", False)


def check_escalation(
    transcript_text: str,
    phrases: Optional[List[str]] = None,
) -> bool:
    """
    Return True (escalation needed) if the transcript contains any trigger phrase.
    Comparison is case-insensitive.

    If `phrases` is None the module-level hardcoded list is used.
    """
    phrase_list = phrases if phrases is not None else _ESCALATION_PHRASES
    lower = transcript_text.lower()
    return any(phrase in lower for phrase in phrase_list)


def run_voice_policy(
    transcript_text: str,
    session_state: Dict[str, Any],
    phrases: Optional[List[str]] = None,
    policy_version: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run both policy rules in priority order and return the enforcement decision.

    Parameters
    ----------
    transcript_text  : caller transcript chunk to evaluate
    session_state    : dict with at least {"disclosure_confirmed": bool}
    phrases          : override escalation phrases; None → use hardcoded defaults
    policy_version   : version string to embed in the result; None → POLICY_VERSION

    Returns a dict with keys:
      action         — one of "disclose", "escalate", "allow"
      reason_code    — machine-readable code for logging (None on allow)
      policy_version — version string recorded in the audit trail
    """
    version = policy_version if policy_version is not None else POLICY_VERSION

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

    return {
        "action": "allow",
        "reason_code": None,
        "policy_version": version,
    }
