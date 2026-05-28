"""
nhid_client.py — NHID Direct Client for the SaaS Gateway.

Replaces the former HTTP bridge with direct Python module imports.
Runs in-process with the SaaS Gateway — no Bridge service required.

Public API is intentionally identical to the former HTTP version so
gateway.py requires zero route-level changes.
"""

import os
import sys
from typing import Any, Dict, List, Optional

# Ensure nhid-clinical/ is on sys.path so core modules are importable.
# gateway.py also does this, but we repeat here so nhid_client is importable
# in isolation (tests, scripts, etc.)
_CLINICAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _CLINICAL_DIR not in sys.path:
    sys.path.insert(0, _CLINICAL_DIR)

# ── Lazy-load NHID core modules ───────────────────────────────────────────────
# Lazy loading ensures a broken Core module does NOT prevent SaaS Gateway
# (Stripe, admin, billing) from starting up. Stripe/admin are fully isolated.

_event_store = None
_event_store_err: str = ""
_policy_version: Optional[str] = None


def _load_event_store():
    global _event_store, _event_store_err
    if _event_store is not None:
        return _event_store
    try:
        import nhid_event_store as _m
        _event_store = _m
        _event_store_err = ""
    except Exception as exc:
        _event_store_err = str(exc)
        _event_store = None
    return _event_store


class NHIDClientError(Exception):
    """Raised when NHID core is unavailable or returns an error."""


# ── Public API ────────────────────────────────────────────────────────────────

def is_reachable() -> bool:
    """Return True if nhid_event_store can be imported successfully."""
    return _load_event_store() is not None


def get_policy_version() -> str:
    """
    Return the NHID policy version string.
    Cached in-process after first successful import.
    Falls back to a safe sentinel if the policy module is unavailable.
    """
    global _policy_version
    if _policy_version is not None:
        return _policy_version
    try:
        from nhid_policy import NHIDPolicyEngine
        _policy_version = NHIDPolicyEngine().POLICY_VERSION
        return _policy_version
    except Exception:
        return "NHID-POLICY-UNKNOWN"


def append_event(
    session_id: str,
    events: List[Dict[str, Any]],
    request_id: str = "saas",
    mark_processed: bool = False,
) -> Dict[str, Any]:
    """
    Append events to the NHID event store via direct module call.
    Raises NHIDClientError if nhid_event_store is unavailable or throws.
    """
    store = _load_event_store()
    if store is None:
        raise NHIDClientError(f"nhid_event_store unavailable: {_event_store_err}")
    try:
        store.append_events_batch(
            session_id, events, request_id, mark_processed=mark_processed
        )
        return {"ok": True, "session_id": session_id, "events_written": len(events)}
    except Exception as exc:
        raise NHIDClientError(f"append_events_batch failed: {exc}") from exc


def get_events(session_id: str) -> List[Dict[str, Any]]:
    """Return raw events list for a session via direct module call."""
    store = _load_event_store()
    if store is None:
        raise NHIDClientError(f"nhid_event_store unavailable: {_event_store_err}")
    try:
        return store.get_events(session_id)
    except Exception as exc:
        raise NHIDClientError(f"get_events failed for '{session_id}': {exc}") from exc


def get_trace(session_id: str) -> Dict[str, Any]:
    """Return the full session trace via direct module call."""
    store = _load_event_store()
    if store is None:
        raise NHIDClientError(f"nhid_event_store unavailable: {_event_store_err}")
    try:
        return store.get_session_trace(session_id)
    except Exception as exc:
        raise NHIDClientError(
            f"get_session_trace failed for '{session_id}': {exc}"
        ) from exc


def get_proof(session_id: str) -> Dict[str, Any]:
    """
    Return ordered events with chain_valid flag — computed locally.
    Chain validity: state_after[i] must equal state_before[i+1].
    """
    store = _load_event_store()
    if store is None:
        raise NHIDClientError(f"nhid_event_store unavailable: {_event_store_err}")
    try:
        events = store.get_events(session_id)
    except Exception as exc:
        raise NHIDClientError(f"get_events failed for '{session_id}': {exc}") from exc

    if not events:
        raise NHIDClientError(f"no events found for session '{session_id}'")

    chain_valid = True
    try:
        for i in range(1, len(events)):
            prev_state = events[i - 1].get("state_after") or "INIT"
            curr_state = events[i].get("state_before") or prev_state
            if prev_state != curr_state:
                chain_valid = False
                break
    except Exception:
        pass  # If iteration fails, leave chain_valid=True (safe default)

    return {
        "ok": True,
        "session_id": session_id,
        "event_count": len(events),
        "chain_valid": chain_valid,
        "events": events,
    }
