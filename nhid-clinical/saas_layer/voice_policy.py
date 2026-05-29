"""
saas_layer/voice_policy.py — Real-time voice policy enforcement for NHID Clinical.

Two rules run synchronously on every transcript chunk:
  1. REQUIRE_UPFRONT_DISCLOSURE  — first-turn enforcement: if the opening
     disclosure has not yet been confirmed, return `disclose` immediately.
  2. HUMAN_ESCALATION_REQUESTED — trigger phrase detection: if the caller
     uses any recognised escalation phrase, return `escalate`.

If both rules pass, the chunk is `allow`ed.
"""

from typing import Any, Dict

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


def check_escalation(transcript_text: str) -> bool:
    """
    Return True (escalation needed) if the transcript contains any trigger phrase.
    Comparison is case-insensitive.
    """
    lower = transcript_text.lower()
    return any(phrase in lower for phrase in _ESCALATION_PHRASES)


def run_voice_policy(
    transcript_text: str,
    session_state: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Run both policy rules in priority order and return the enforcement decision.

    Returns a dict with keys:
      action         — one of "disclose", "escalate", "allow"
      reason_code    — machine-readable code for logging
      policy_version — version string for the audit trail
    """
    if check_disclosure(session_state):
        return {
            "action": "disclose",
            "reason_code": "REQUIRE_UPFRONT_DISCLOSURE",
            "policy_version": POLICY_VERSION,
        }

    if check_escalation(transcript_text):
        return {
            "action": "escalate",
            "reason_code": "HUMAN_ESCALATION_REQUESTED",
            "policy_version": POLICY_VERSION,
        }

    return {
        "action": "allow",
        "reason_code": None,
        "policy_version": POLICY_VERSION,
    }
