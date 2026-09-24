"""
saas_layer/normalization.py — one canonical interaction shape, thin vendor adapters.

The governance engine must never see a vendor-specific payload. A payer receives
calls from many AI voice vendors, each with its own transcript format, and the
alternative to a normalization boundary is a per-vendor fork of the evaluation
logic — which is how a governance product ends up with six subtly different
definitions of "disclosure".

So there is exactly one canonical shape, defined here, and adapters are small
pure functions that produce it. Adding a vendor means adding an adapter. It never
means touching an evaluator.

Three adapters ship: ``generic`` (the canonical shape itself, for customers who
can export it), ``twilio`` and ``vapi``. That is deliberately not six. The
boundary is the deliverable; a long vendor list is not.

What normalization does NOT do
------------------------------
It does not transcribe, and it does not assess transcription quality. Text
arrives already transcribed by a path this product does not own. Whatever is
known about that path's accuracy travels alongside the interaction as a
``transcription_attestation``, and every downstream finding inherits it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

#: Speaker roles in a canonical turn. "agent" is the non-human caller under
#: evaluation; "human" is the person receiving the call. The distinction is
#: load-bearing: EIT-01 escalation requests come from the human, while IDG-01
#: disclosure comes from the agent.
SPEAKER_AGENT = "agent"
SPEAKER_HUMAN = "human"
SPEAKER_UNKNOWN = "unknown"

#: What is known about the transcription path. No default is assumed — absent
#: means "unattested", and a report must say so rather than imply precision.
ATTESTATION_MEASURED = "measured"
ATTESTATION_ATTESTED = "attested"
ATTESTATION_UNATTESTED = "unattested"
ATTESTATION_STATES = (ATTESTATION_MEASURED, ATTESTATION_ATTESTED, ATTESTATION_UNATTESTED)

#: Whether the caller was a non-human actor. "unknown" is a real answer: on a
#: recording with no disclosure and no vendor metadata, nobody knows.
AI_NON_HUMAN = "non_human"
AI_HUMAN = "human"
AI_UNKNOWN = "unknown"
AI_STATES = (AI_NON_HUMAN, AI_HUMAN, AI_UNKNOWN)


class NormalizationError(ValueError):
    """Raised when a payload cannot be turned into a canonical interaction."""


def _utc(value: Any) -> Optional[str]:
    """Coerce a timestamp to an ISO-8601 UTC string, or None."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    text = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def normalize_attestation(raw: Any) -> Dict[str, Any]:
    """Normalize a transcription-quality attestation.

    Anything unrecognised becomes ``unattested`` with a null WER rather than an
    optimistic default. Claiming a precision nobody reported is the failure this
    field exists to prevent.
    """
    if not isinstance(raw, dict):
        return {"status": ATTESTATION_UNATTESTED, "wer": None, "source": None}

    status = str(raw.get("status") or "").strip().lower()
    if status not in ATTESTATION_STATES:
        status = ATTESTATION_UNATTESTED

    wer = raw.get("wer")
    try:
        wer = float(wer) if wer is not None else None
    except (TypeError, ValueError):
        wer = None
    if wer is not None and not (0.0 <= wer <= 1.0):
        wer = None

    # A status asserting a figure without one is downgraded, not trusted.
    if status in (ATTESTATION_MEASURED, ATTESTATION_ATTESTED) and wer is None:
        status = ATTESTATION_UNATTESTED

    source = raw.get("source")
    return {
        "status": status,
        "wer": wer,
        "source": str(source) if source else None,
    }


def _turn(speaker: str, text: str, offset_ms: Any = None, at: Any = None) -> Dict[str, Any]:
    speaker = speaker if speaker in (SPEAKER_AGENT, SPEAKER_HUMAN) else SPEAKER_UNKNOWN
    try:
        offset = int(offset_ms) if offset_ms is not None else None
    except (TypeError, ValueError):
        offset = None
    return {
        "speaker": speaker,
        "text": (text or "").strip(),
        "offset_ms": offset,
        "at": _utc(at),
    }


def canonical_interaction(
    *,
    external_id: str,
    occurred_at: Any,
    turns: List[Dict[str, Any]],
    source_vendor: str = "generic",
    source_type: str = "upload",
    ai_assessment: str = AI_UNKNOWN,
    language: Optional[str] = None,
    interpreter_present: Optional[bool] = None,
    transcription_attestation: Any = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build (and validate) the canonical shape every evaluator reads."""
    if not external_id:
        raise NormalizationError("external_id is required")
    if not isinstance(turns, list) or not turns:
        raise NormalizationError("at least one turn is required")

    occurred = _utc(occurred_at)
    if occurred is None:
        raise NormalizationError("occurred_at must be a parseable timestamp")

    if ai_assessment not in AI_STATES:
        ai_assessment = AI_UNKNOWN

    return {
        "external_id": str(external_id),
        "occurred_at": occurred,
        "source_vendor": str(source_vendor or "generic"),
        "source_type": str(source_type or "upload"),
        "ai_assessment": ai_assessment,
        "language": str(language) if language else None,
        "interpreter_present": (
            bool(interpreter_present) if interpreter_present is not None else None
        ),
        "transcription_attestation": normalize_attestation(transcription_attestation),
        "turns": [t for t in turns if t.get("text")],
        "metadata": metadata or {},
    }


# ── Adapters ──────────────────────────────────────────────────────────────────

def from_generic(payload: Dict[str, Any]) -> Dict[str, Any]:
    """The canonical shape itself, for customers who can export it directly."""
    turns = [
        _turn(t.get("speaker"), t.get("text"), t.get("offset_ms"), t.get("at"))
        for t in (payload.get("turns") or [])
    ]
    return canonical_interaction(
        external_id=payload.get("external_id") or payload.get("id"),
        occurred_at=payload.get("occurred_at") or payload.get("timestamp"),
        turns=turns,
        source_vendor=payload.get("source_vendor", "generic"),
        source_type=payload.get("source_type", "upload"),
        ai_assessment=payload.get("ai_assessment", AI_UNKNOWN),
        language=payload.get("language"),
        interpreter_present=payload.get("interpreter_present"),
        transcription_attestation=payload.get("transcription_attestation"),
        metadata=payload.get("metadata"),
    )


def from_twilio(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Twilio-derived transcript.

    Twilio identifies the call by CallSid and carries transcript segments with a
    channel number: channel 1 is the inbound leg (the caller, i.e. the agent
    under evaluation) and channel 2 the outbound leg.
    """
    turns = []
    for seg in payload.get("segments") or payload.get("transcript") or []:
        channel = seg.get("channel", seg.get("Channel"))
        speaker = SPEAKER_AGENT if str(channel) in ("1", "inbound") else SPEAKER_HUMAN
        turns.append(_turn(speaker, seg.get("text") or seg.get("Text"),
                           seg.get("offset_ms") or seg.get("StartTime")))
    return canonical_interaction(
        external_id=payload.get("CallSid") or payload.get("call_sid"),
        occurred_at=payload.get("StartTime") or payload.get("start_time")
        or payload.get("occurred_at"),
        turns=turns,
        source_vendor="twilio",
        source_type="recording_transcript",
        ai_assessment=payload.get("ai_assessment", AI_UNKNOWN),
        language=payload.get("language"),
        interpreter_present=payload.get("interpreter_present"),
        transcription_attestation=payload.get("transcription_attestation"),
        metadata={"from": payload.get("From"), "to": payload.get("To")},
    )


def from_vapi(payload: Dict[str, Any]) -> Dict[str, Any]:
    """VAPI-derived transcript.

    VAPI wraps the call in a ``message`` envelope and labels each transcript
    entry with role ``assistant`` (the AI) or ``user`` (the human).
    """
    message = payload.get("message") or payload
    call = message.get("call") or {}
    turns = []
    for entry in message.get("transcript") or message.get("messages") or []:
        role = str(entry.get("role") or "").lower()
        speaker = SPEAKER_AGENT if role in ("assistant", "bot", "ai") else SPEAKER_HUMAN
        turns.append(_turn(speaker, entry.get("message") or entry.get("content"),
                           entry.get("secondsFromStart") and
                           int(float(entry["secondsFromStart"]) * 1000)))
    return canonical_interaction(
        external_id=call.get("id") or message.get("id") or payload.get("external_id"),
        occurred_at=call.get("createdAt") or message.get("timestamp")
        or payload.get("occurred_at"),
        turns=turns,
        source_vendor="vapi",
        source_type="event_stream",
        # A VAPI call is an AI assistant by construction; this is the one place a
        # vendor tells us directly rather than us inferring it from disclosure.
        ai_assessment=payload.get("ai_assessment", AI_NON_HUMAN),
        language=payload.get("language"),
        interpreter_present=payload.get("interpreter_present"),
        transcription_attestation=payload.get("transcription_attestation"),
        metadata={"assistant_id": call.get("assistantId")},
    )


ADAPTERS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    "generic": from_generic,
    "twilio": from_twilio,
    "vapi": from_vapi,
}


def normalize(payload: Dict[str, Any], vendor: str = "generic") -> Dict[str, Any]:
    """Normalize one vendor payload into the canonical interaction shape."""
    adapter = ADAPTERS.get((vendor or "generic").lower())
    if adapter is None:
        raise NormalizationError(
            f"no adapter for vendor {vendor!r}; known: {sorted(ADAPTERS)}"
        )
    return adapter(payload)
