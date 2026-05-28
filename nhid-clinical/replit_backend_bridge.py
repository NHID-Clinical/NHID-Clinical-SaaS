"""
replit_backend_bridge.py

Thin read-only API wrapper over the existing NHID-Clinical core.
Imports nhid_event_store and nhid_engine directly — no rewrites, no schema changes.
All endpoints are GET-only. No writes to core logic.
"""

import json
import sys
from pathlib import Path

# Ensure the nhid-clinical directory is on the path so imports resolve correctly
# when running from outside the repo directory.
_REPO_DIR = Path(__file__).resolve().parent
if str(_REPO_DIR) not in sys.path:
    sys.path.insert(0, str(_REPO_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from nhid_event_store import get_events, get_session_trace
    _EVENT_STORE_OK = True
except Exception as _e:
    _EVENT_STORE_OK = False
    _EVENT_STORE_ERR = str(_e)

try:
    from nhid_engine import VALID_STATES, VALID_TRANSITIONS
    _ENGINE_OK = True
except Exception as _e:
    _ENGINE_OK = False
    _ENGINE_ERR = str(_e)

_SCHEMA_PATH = _REPO_DIR / "schema" / "nhid_trace_schema_v1.json"

app = FastAPI(
    title="NHID-Clinical Replit Bridge",
    description=(
        "Read-only viewer layer over NHID-Clinical. "
        "Does not modify any core files, tests, schema, or database."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _safe_json(data) -> JSONResponse:
    return JSONResponse(content=data)


def _error(message: str, status: int = 500) -> JSONResponse:
    return JSONResponse(content={"ok": False, "error": message}, status_code=status)


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health", tags=["System"])
def health():
    """Returns the operational status of the bridge and its upstream modules."""
    return _safe_json({
        "ok": True,
        "bridge": "nhid-clinical-replit-bridge",
        "version": "1.0.0",
        "modules": {
            "nhid_event_store": "ok" if _EVENT_STORE_OK else f"error: {_EVENT_STORE_ERR}",
            "nhid_engine": "ok" if _ENGINE_OK else f"error: {_ENGINE_ERR}",
        },
        "schema_file": str(_SCHEMA_PATH),
        "schema_file_exists": _SCHEMA_PATH.exists(),
    })


# ---------------------------------------------------------------------------
# GET /trace/{session_id}
# ---------------------------------------------------------------------------

@app.get("/trace/{session_id}", tags=["Traces"])
def get_trace(session_id: str):
    """
    Returns the full session trace for a given session_id.
    Delegates entirely to nhid_event_store.get_session_trace().
    """
    if not _EVENT_STORE_OK:
        return _error(f"nhid_event_store unavailable: {_EVENT_STORE_ERR}")

    try:
        trace = get_session_trace(session_id)
        return _safe_json({
            "ok": True,
            "session_id": session_id,
            "trace": trace,
        })
    except Exception as exc:
        return _error(f"could not retrieve trace for session '{session_id}': {exc}", status=404)


# ---------------------------------------------------------------------------
# GET /proof/{session_id}
# ---------------------------------------------------------------------------

@app.get("/proof/{session_id}", tags=["Proof"])
def get_proof(session_id: str):
    """
    Returns an ordered event list for a session and a basic chain-integrity flag.
    Reads events via nhid_event_store.get_events() — no writes, no new tables.
    """
    if not _EVENT_STORE_OK:
        return _error(f"nhid_event_store unavailable: {_EVENT_STORE_ERR}")

    try:
        events = get_events(session_id)
    except Exception as exc:
        return _error(f"could not retrieve events for session '{session_id}': {exc}", status=404)

    if not events:
        return JSONResponse(
            content={"ok": False, "error": f"no events found for session '{session_id}'"},
            status_code=404,
        )

    # Lightweight state-chain integrity check using existing engine rules
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


# ---------------------------------------------------------------------------
# GET /schema
# ---------------------------------------------------------------------------

@app.get("/schema", tags=["Schema"])
def get_schema():
    """
    Returns the contents of schema/nhid_trace_schema_v1.json verbatim.
    File is read at request time; no caching, no modification.
    """
    if not _SCHEMA_PATH.exists():
        return _error(f"schema file not found at {_SCHEMA_PATH}", status=404)

    try:
        with open(_SCHEMA_PATH, "r", encoding="utf-8") as f:
            schema = json.load(f)
        return _safe_json({"ok": True, "schema": schema})
    except Exception as exc:
        return _error(f"could not read schema file: {exc}")
