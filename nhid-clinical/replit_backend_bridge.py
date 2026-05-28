"""
replit_backend_bridge.py

NHID-Clinical HTTP API layer.
Exposes both read and write operations over nhid_event_store via HTTP.
Does NOT modify any core files, tests, schema, or database schema.
This is the sole HTTP interface the SaaS gateway uses to reach NHID core.
"""

import json
import sys
from pathlib import Path

_REPO_DIR = Path(__file__).resolve().parent
if str(_REPO_DIR) not in sys.path:
    sys.path.insert(0, str(_REPO_DIR))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── nhid_event_store (read + write) ──────────────────────────────────────────
try:
    from nhid_event_store import get_events, get_session_trace, append_events_batch
    _EVENT_STORE_OK = True
    _EVENT_STORE_ERR = ""
except Exception as _e:
    _EVENT_STORE_OK = False
    _EVENT_STORE_ERR = str(_e)
    def get_events(*a, **kw): raise RuntimeError(_EVENT_STORE_ERR)
    def get_session_trace(*a, **kw): raise RuntimeError(_EVENT_STORE_ERR)
    def append_events_batch(*a, **kw): raise RuntimeError(_EVENT_STORE_ERR)

# ── nhid_engine (state graph, read-only) ─────────────────────────────────────
try:
    from nhid_engine import VALID_STATES, VALID_TRANSITIONS
    _ENGINE_OK = True
    _ENGINE_ERR = ""
except Exception as _e:
    _ENGINE_OK = False
    _ENGINE_ERR = str(_e)
    VALID_STATES = []
    VALID_TRANSITIONS = {}

# ── nhid_policy (metadata only, no writes) ───────────────────────────────────
try:
    from nhid_policy import NHIDPolicyEngine as _PE
    _POLICY_VERSION = _PE().POLICY_VERSION
    _POLICY_OK = True
    _POLICY_ERR = ""
except Exception as _e:
    _POLICY_OK = False
    _POLICY_ERR = str(_e)
    _POLICY_VERSION = "NHID-POLICY-UNKNOWN"

_SCHEMA_PATH = _REPO_DIR / "schema" / "nhid_trace_schema_v1.json"

app = FastAPI(
    title="NHID-Clinical Bridge API",
    description=(
        "Complete HTTP API layer over NHID-Clinical core. "
        "Provides read and write access to nhid_event_store. "
        "Does not modify any NHID core files, tests, or schema."
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_json(data) -> JSONResponse:
    return JSONResponse(content=data)


def _error(message: str, status: int = 500) -> JSONResponse:
    return JSONResponse(content={"ok": False, "error": message}, status_code=status)


# ── GET /health ───────────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
def health():
    """Operational status of the bridge and its upstream NHID modules."""
    return _safe_json({
        "ok": True,
        "bridge": "nhid-clinical-bridge",
        "version": "2.0.0",
        "modules": {
            "nhid_event_store": "ok" if _EVENT_STORE_OK else f"error: {_EVENT_STORE_ERR}",
            "nhid_engine": "ok" if _ENGINE_OK else f"error: {_ENGINE_ERR}",
            "nhid_policy": "ok" if _POLICY_OK else f"error: {_POLICY_ERR}",
        },
        "schema_file_exists": _SCHEMA_PATH.exists(),
    })


# ── GET /policy ───────────────────────────────────────────────────────────────

@app.get("/policy", tags=["System"])
def get_policy():
    """Return NHID policy metadata (version string). Read-only."""
    return _safe_json({
        "ok": _POLICY_OK,
        "policy_version": _POLICY_VERSION,
        "error": _POLICY_ERR if not _POLICY_OK else None,
    })


# ── POST /events  (write) ─────────────────────────────────────────────────────

@app.post("/events", tags=["Events"])
async def write_events(request: Request):
    """
    Append one or more events to the NHID event store for a session.
    Body: { session_id, events: [...], request_id, mark_processed? }
    Delegates entirely to nhid_event_store.append_events_batch().
    """
    if not _EVENT_STORE_OK:
        return _error(f"nhid_event_store unavailable: {_EVENT_STORE_ERR}")

    try:
        body = await request.json()
    except Exception:
        return _error("Invalid JSON body", status=400)

    session_id = body.get("session_id")
    events = body.get("events", [])
    request_id = body.get("request_id", "bridge-write")
    mark_processed = bool(body.get("mark_processed", False))

    if not session_id:
        return _error("session_id is required", status=400)
    if not isinstance(events, list) or len(events) == 0:
        return _error("events must be a non-empty list", status=400)

    try:
        append_events_batch(session_id, events, request_id, mark_processed=mark_processed)
        return _safe_json({"ok": True, "session_id": session_id, "events_written": len(events)})
    except Exception as exc:
        return _error(f"append_events_batch failed: {exc}", status=500)


# ── GET /events/{session_id}  (read) ──────────────────────────────────────────

@app.get("/events/{session_id}", tags=["Events"])
def read_events(session_id: str):
    """
    Return raw events list for a session.
    Delegates to nhid_event_store.get_events().
    """
    if not _EVENT_STORE_OK:
        return _error(f"nhid_event_store unavailable: {_EVENT_STORE_ERR}")
    try:
        events = get_events(session_id)
        return _safe_json({"ok": True, "session_id": session_id, "events": events, "event_count": len(events)})
    except Exception as exc:
        return _error(f"get_events failed for '{session_id}': {exc}", status=404)


# ── GET /trace/{session_id} ───────────────────────────────────────────────────

@app.get("/trace/{session_id}", tags=["Traces"])
def get_trace(session_id: str):
    """
    Full session trace. Delegates to nhid_event_store.get_session_trace().
    """
    if not _EVENT_STORE_OK:
        return _error(f"nhid_event_store unavailable: {_EVENT_STORE_ERR}")
    try:
        trace = get_session_trace(session_id)
        return _safe_json({"ok": True, "session_id": session_id, "trace": trace})
    except Exception as exc:
        return _error(f"get_session_trace failed for '{session_id}': {exc}", status=404)


# ── GET /proof/{session_id} ───────────────────────────────────────────────────

@app.get("/proof/{session_id}", tags=["Proof"])
def get_proof(session_id: str):
    """
    Ordered event list with lightweight chain-integrity flag.
    Reads events via nhid_event_store.get_events() — no writes.
    """
    if not _EVENT_STORE_OK:
        return _error(f"nhid_event_store unavailable: {_EVENT_STORE_ERR}")

    try:
        events = get_events(session_id)
    except Exception as exc:
        return _error(f"get_events failed for '{session_id}': {exc}", status=404)

    if not events:
        return JSONResponse(
            content={"ok": False, "error": f"no events found for session '{session_id}'"},
            status_code=404,
        )

    chain_valid = True
    if _ENGINE_OK:
        for i in range(1, len(events)):
            prev_state = events[i - 1].get("state_after") or "INIT"
            curr_state = events[i].get("state_before") or prev_state
            if prev_state != curr_state:
                chain_valid = False
                break

    return _safe_json({
        "ok": True,
        "session_id": session_id,
        "event_count": len(events),
        "chain_valid": chain_valid,
        "events": events,
    })


# ── GET /schema ───────────────────────────────────────────────────────────────

@app.get("/schema", tags=["Schema"])
def get_schema():
    """Returns nhid_trace_schema_v1.json verbatim."""
    if not _SCHEMA_PATH.exists():
        return _error(f"schema file not found at {_SCHEMA_PATH}", status=404)
    try:
        with open(_SCHEMA_PATH, "r", encoding="utf-8") as f:
            schema = json.load(f)
        return _safe_json({"ok": True, "schema": schema})
    except Exception as exc:
        return _error(f"could not read schema file: {exc}")
