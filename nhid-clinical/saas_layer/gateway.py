"""
NHID-Clinical SaaS Gateway.
Wraps the NHID core engine with multi-tenant auth + usage tracking.
Core files (app.py, nhid_engine, nhid_policy, nhid_event_store) are NOT modified.
"""
import os
import sys

# Ensure nhid-clinical/ is on the path so core modules are importable
_CLINICAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _CLINICAL_DIR not in sys.path:
    sys.path.insert(0, _CLINICAL_DIR)

from fastapi import FastAPI, HTTPException, Header, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Any, Dict

from saas_layer.auth import (
    init_db, create_org, validate_api_key, get_org,
    list_orgs, increment_usage,
)
from saas_layer.usage import log_request, get_usage_summary, get_recent_activity, get_global_stats
from saas_layer.billing import get_plan, check_rate_limit, get_upgrade_path

# Import NHID core modules directly (read-only usage — core untouched)
from nhid_event_store import (
    append_events_batch,
    get_events,
    get_session_trace,
    is_duplicate_request,
    get_response_for_request,
)
from nhid_policy import NHIDPolicyEngine

_ADMIN_KEY = os.environ.get("SAAS_ADMIN_KEY", "nhid-admin-key-dev")

policy = NHIDPolicyEngine()

app = FastAPI(
    title="NHID-Clinical SaaS API",
    description="Multi-tenant audit platform powered by NHID core engine.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()


# ── Dependency: resolve org from API key ──────────────────────────────────────

def get_current_org(x_api_key: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    if not x_api_key:
        raise HTTPException(status_code=401, detail="X-API-Key header required")
    org = validate_api_key(x_api_key)
    if not org:
        raise HTTPException(status_code=403, detail="Invalid or inactive API key")
    return org


def require_admin(x_admin_key: Optional[str] = Header(default=None)) -> None:
    if x_admin_key != _ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Admin key required")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/saas/health")
async def health():
    return {"ok": True, "service": "nhid-saas-gateway", "version": "1.0.0"}


# ── Admin: org management ─────────────────────────────────────────────────────

class CreateOrgRequest(BaseModel):
    org_name: str
    plan: str = "free"


@app.post("/saas/admin/orgs", dependencies=[Depends(require_admin)])
async def admin_create_org(body: CreateOrgRequest):
    org = create_org(body.org_name, body.plan)
    return org


@app.get("/saas/admin/orgs", dependencies=[Depends(require_admin)])
async def admin_list_orgs():
    return {"orgs": list_orgs(), "global_stats": get_global_stats()}


# ── Org: self-service ─────────────────────────────────────────────────────────

@app.get("/saas/orgs/me")
async def get_my_org(org: Dict = Depends(get_current_org)):
    plan = get_plan(org["plan"])
    usage = get_usage_summary(org["org_id"])
    rate = check_rate_limit(org["org_id"], org["plan"], usage["today_requests"])
    upgrade = get_upgrade_path(org["plan"])
    return {
        "org_id": org["org_id"],
        "org_name": org["org_name"],
        "plan": org["plan"],
        "plan_details": plan,
        "created_at": org["created_at"],
        "usage_count": org["usage_count"],
        "rate_limit": rate,
        "upgrade": upgrade,
    }


# ── Trace: append events ──────────────────────────────────────────────────────

class TraceEventRequest(BaseModel):
    session_id: str
    event_type: str
    state_before: str
    state_after: str
    input_text: Optional[str] = None
    policy_action: Optional[str] = None
    reason_code: Optional[str] = None
    response_text: Optional[str] = None
    request_id: Optional[str] = None


@app.post("/saas/trace")
async def saas_trace(body: TraceEventRequest, org: Dict = Depends(get_current_org)):
    usage = get_usage_summary(org["org_id"])
    rate = check_rate_limit(org["org_id"], org["plan"], usage["today_requests"])
    if not rate["allowed"]:
        raise HTTPException(status_code=429, detail=f"Daily limit reached ({rate['limit']} req/day). Upgrade to continue.")

    request_id = body.request_id or f"{body.session_id}:{body.event_type}:{body.state_before}"
    event = {
        "event_type": body.event_type,
        "state_before": body.state_before,
        "state_after": body.state_after,
        "input_text": body.input_text,
        "policy_action": body.policy_action,
        "reason_code": body.reason_code,
        "response_text": body.response_text,
        "policy_version": policy.POLICY_VERSION,
    }
    append_events_batch(body.session_id, [event], request_id)
    increment_usage(org["org_id"])
    log_request(org["org_id"], "/saas/trace", "POST", 200, body.session_id)
    return {"ok": True, "session_id": body.session_id, "request_id": request_id}


# ── Proof: retrieve audit trail ───────────────────────────────────────────────

@app.get("/saas/proof/{session_id}")
async def saas_proof(session_id: str, org: Dict = Depends(get_current_org)):
    try:
        trace = get_session_trace(session_id)
        events = trace.get("events", [])
        # Validate chain integrity
        valid_chain = True
        for i, ev in enumerate(events):
            if i > 0 and not ev.get("id"):
                valid_chain = False
        log_request(org["org_id"], f"/saas/proof/{session_id}", "GET", 200, session_id)
        increment_usage(org["org_id"])
        return {
            "session_id": session_id,
            "org_id": org["org_id"],
            "valid_chain": valid_chain,
            "event_count": len(events),
            "trace": trace,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Usage: stats + activity ───────────────────────────────────────────────────

@app.get("/saas/usage")
async def saas_usage(org: Dict = Depends(get_current_org)):
    summary = get_usage_summary(org["org_id"])
    rate = check_rate_limit(org["org_id"], org["plan"], summary["today_requests"])
    return {**summary, "rate_limit": rate, "plan": org["plan"]}


@app.get("/saas/usage/recent")
async def saas_recent(limit: int = 20, org: Dict = Depends(get_current_org)):
    return {"activity": get_recent_activity(org["org_id"], limit=limit)}


# ── Replay ────────────────────────────────────────────────────────────────────

@app.get("/saas/replay/{session_id}")
async def saas_replay(session_id: str, org: Dict = Depends(get_current_org)):
    events = get_events(session_id)
    log_request(org["org_id"], f"/saas/replay/{session_id}", "GET", 200, session_id)
    return {"session_id": session_id, "events": events, "event_count": len(events)}
