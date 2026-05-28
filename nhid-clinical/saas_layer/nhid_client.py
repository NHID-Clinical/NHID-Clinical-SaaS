"""
nhid_client.py — NHID HTTP Client for the SaaS Gateway.

All SaaS ↔ NHID communication goes through this module via HTTP calls
to the NHID Bridge API (default: http://localhost:8001).

NO direct SQLite access.
NO direct nhid_event_store / nhid_policy imports.

The SaaS gateway is fully isolated from NHID core at the Python module level.
"""

import json
import os
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional

# Base URL for the NHID Bridge API.
# Override in production: NHID_API_URL=http://nhid-bridge:8001
_NHID_API_URL = os.environ.get("NHID_API_URL", "http://localhost:8001")
_TIMEOUT = int(os.environ.get("NHID_CLIENT_TIMEOUT", "10"))

# Cached policy version (fetched once per process, re-fetched on failure)
_cached_policy_version: Optional[str] = None


# ── Low-level HTTP helpers ────────────────────────────────────────────────────

def _get(path: str) -> Dict[str, Any]:
    url = f"{_NHID_API_URL}{path}"
    try:
        with urllib.request.urlopen(url, timeout=_TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        body = {}
        try:
            body = json.loads(exc.read().decode())
        except Exception:
            pass
        raise NHIDClientError(
            f"NHID Bridge HTTP {exc.code} on GET {path}: {body.get('error', exc.reason)}"
        ) from exc
    except Exception as exc:
        raise NHIDClientError(f"NHID Bridge unreachable at {url}: {exc}") from exc


def _post(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{_NHID_API_URL}{path}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        body = {}
        try:
            body = json.loads(exc.read().decode())
        except Exception:
            pass
        raise NHIDClientError(
            f"NHID Bridge HTTP {exc.code} on POST {path}: {body.get('error', exc.reason)}"
        ) from exc
    except Exception as exc:
        raise NHIDClientError(f"NHID Bridge unreachable at {url}: {exc}") from exc


class NHIDClientError(Exception):
    """Raised when the NHID Bridge returns an error or is unreachable."""


# ── Public API ────────────────────────────────────────────────────────────────

def is_reachable() -> bool:
    """Return True if the NHID Bridge is responding."""
    try:
        _get("/health")
        return True
    except NHIDClientError:
        return False


def get_policy_version() -> str:
    """
    Return the NHID policy version string from the Bridge.
    Caches the value in-process; re-fetches if not yet set.
    Falls back to a safe default if the Bridge is unavailable.
    """
    global _cached_policy_version
    if _cached_policy_version is not None:
        return _cached_policy_version
    try:
        data = _get("/policy")
        version = data.get("policy_version", "NHID-POLICY-UNKNOWN")
        _cached_policy_version = version
        return version
    except NHIDClientError:
        return "NHID-POLICY-UNKNOWN"


def append_event(
    session_id: str,
    events: List[Dict[str, Any]],
    request_id: str = "saas",
    mark_processed: bool = False,
) -> Dict[str, Any]:
    """
    Append events to the NHID event store via HTTP POST /events.
    Raises NHIDClientError if the Bridge is unreachable or returns an error.
    """
    payload = {
        "session_id": session_id,
        "events": events,
        "request_id": request_id,
        "mark_processed": mark_processed,
    }
    result = _post("/events", payload)
    if not result.get("ok"):
        raise NHIDClientError(f"append_event failed: {result.get('error', 'unknown')}")
    return result


def get_events(session_id: str) -> List[Dict[str, Any]]:
    """Return raw events list for a session via HTTP GET /events/{session_id}."""
    data = _get(f"/events/{session_id}")
    return data.get("events", [])


def get_trace(session_id: str) -> Dict[str, Any]:
    """Return the full session trace via HTTP GET /trace/{session_id}."""
    data = _get(f"/trace/{session_id}")
    return data.get("trace", {})


def get_proof(session_id: str) -> Dict[str, Any]:
    """Return the proof (events + chain_valid) via HTTP GET /proof/{session_id}."""
    return _get(f"/proof/{session_id}")
