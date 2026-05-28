"""
NHID-Clinical SaaS Gateway.
Wraps the NHID core engine with multi-tenant auth, usage tracking, and Stripe billing.
Core files (app.py, nhid_engine, nhid_policy, nhid_event_store) are NOT modified.
"""
import os
import sys
import uuid
import time
import urllib.request
import urllib.error

# Ensure nhid-clinical/ is on the path so core modules are importable
_CLINICAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _CLINICAL_DIR not in sys.path:
    sys.path.insert(0, _CLINICAL_DIR)

from fastapi import FastAPI, HTTPException, Header, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from typing import Optional, Any, Dict

from saas_layer.auth import (
    init_db, create_org, validate_api_key, get_org,
    list_orgs, increment_usage,
)
from saas_layer.usage import log_request, get_usage_summary, get_recent_activity, get_global_stats
from saas_layer.billing import get_plan, check_rate_limit, get_upgrade_path
from saas_layer.stripe_billing import (
    check_subscription_gate,
    create_checkout_session,
    handle_webhook,
    get_prices,
    migrate_billing_columns,
)
from saas_layer.stripe_client import get_publishable_key

# All NHID access goes through HTTP (nhid_client → Bridge port 8001).
# No direct nhid_event_store / nhid_policy imports in the SaaS layer.
from saas_layer import nhid_client

_ADMIN_KEY = os.environ.get("SAAS_ADMIN_KEY", "nhid-admin-key-dev")

# ── NHID core base URL (SaaS pings core via HTTP for health checks) ───────────
_NHID_BASE_URL = os.environ.get("NHID_BASE_URL", "http://localhost:8000")

# ── Admin portal credentials (read from env; safe defaults for dev) ───────────
_ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
_ADMIN_PASS = os.environ.get("ADMIN_PASS", "nhid-admin-2026")
_ADMIN_SESSION_TTL = 8 * 3600  # 8 hours

# In-memory session store: token → expiry_timestamp
_admin_sessions: Dict[str, float] = {}

app = FastAPI(
    title="NHID-Clinical SaaS API",
    description="Multi-tenant audit platform powered by NHID core engine.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()
migrate_billing_columns()


# ── Dependencies ──────────────────────────────────────────────────────────────

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


def require_admin_session(x_admin_session: Optional[str] = Header(default=None)) -> str:
    """Validate an admin session token issued by POST /admin/login."""
    if not x_admin_session:
        raise HTTPException(status_code=401, detail="Admin session token required (X-Admin-Session header)")
    expiry = _admin_sessions.get(x_admin_session)
    if expiry is None or time.time() > expiry:
        _admin_sessions.pop(x_admin_session, None)
        raise HTTPException(status_code=401, detail="Admin session expired or invalid. Please log in again.")
    return x_admin_session


def subscription_gated_org(org: Dict = Depends(get_current_org)) -> Dict[str, Any]:
    """
    Resolves the org AND enforces Stripe subscription state.
    Raises HTTP 402 if the org has a paid plan with an inactive subscription.
    Free orgs pass unconditionally (usage limits enforced separately).
    """
    block = check_subscription_gate(org)
    if block:
        raise HTTPException(status_code=block["status_code"], detail=block["detail"])
    return org


# ── Internal helpers ──────────────────────────────────────────────────────────

def _probe_nhid() -> str:
    """
    HTTP reachability probe for NHID core.
    Any response (including 404/405) means the server is up.
    Only a connection-level failure means unreachable.
    """
    try:
        urllib.request.urlopen(f"{_NHID_BASE_URL}/", timeout=2)
        return "reachable"
    except urllib.error.HTTPError:
        # Got an HTTP response — server is up even if endpoint is unknown
        return "reachable"
    except Exception:
        return "unreachable"


def _probe_stripe() -> str:
    try:
        key = get_publishable_key()
        return "configured" if key else "missing"
    except Exception:
        return "missing"


# ── Health endpoints ──────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"])
async def health():
    """
    SaaS gateway health check (spec endpoint).
    Probes NHID core reachability and Stripe configuration.
    """
    stats = get_global_stats()
    return {
        "status": "ok",
        "nhid_core": _probe_nhid(),
        "stripe": _probe_stripe(),
        "org_count": stats.get("total_orgs", 0),
        "requests_today": stats.get("orgs_active_today", 0),
    }


@app.get("/saas/health", tags=["Health"])
async def saas_health():
    """Backward-compatible alias for /health."""
    return await health()


@app.get("/saas/system/status", tags=["Health"])
async def system_status():
    """
    Full system status: NHID core, SaaS layer, and Stripe.
    Used by monitoring and the admin portal to surface service health.
    """
    nhid_status = _probe_nhid()
    stripe_status = _probe_stripe()
    stats = get_global_stats()
    return {
        "nhid": {
            "status": "up" if nhid_status == "reachable" else "down",
            "url": _NHID_BASE_URL,
        },
        "saas": {
            "status": "up",
            "orgs": stats.get("total_orgs", 0),
            "requests_today": stats.get("orgs_active_today", 0),
            "total_requests": stats.get("total_requests", 0),
        },
        "stripe": {
            "status": stripe_status,
        },
    }


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
        "status": org.get("status", "active"),
        "stripe_customer_id": org.get("stripe_customer_id"),
        "stripe_subscription_id": org.get("stripe_subscription_id"),
        "plan_details": plan,
        "created_at": org["created_at"],
        "usage_count": org["usage_count"],
        "rate_limit": rate,
        "upgrade": upgrade,
    }


# ── Billing: Stripe checkout + webhook ────────────────────────────────────────

class CheckoutRequest(BaseModel):
    plan: str
    success_url: str
    cancel_url: str


@app.post("/saas/billing/checkout")
async def billing_checkout(body: CheckoutRequest, org: Dict = Depends(get_current_org)):
    """Create a Stripe Checkout session for the requested plan. Returns checkout_url."""
    allowed_plans = {"l1", "l2", "l3"}
    if body.plan not in allowed_plans:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan '{body.plan}'. Must be one of: {', '.join(sorted(allowed_plans))}",
        )
    try:
        url = create_checkout_session(
            org_id=org["org_id"],
            org_name=org["org_name"],
            api_key=org["api_key"],
            plan=body.plan,
            success_url=body.success_url,
            cancel_url=body.cancel_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Stripe error: {exc}")
    return {"checkout_url": url, "plan": body.plan}


@app.post("/saas/billing/webhook")
async def billing_webhook(request: Request):
    """
    Stripe webhook receiver.
    Handles: checkout.session.completed, invoice.paid,
             customer.subscription.deleted, customer.subscription.updated
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        result = handle_webhook(payload, sig_header)
    except Exception as exc:
        # Return 400 so Stripe retries; log locally
        return JSONResponse(status_code=400, content={"error": str(exc)})
    return result


@app.get("/saas/billing/plans")
async def billing_plans():
    """List available NHID plans with Stripe price IDs (if seeded)."""
    from saas_layer.billing import PLANS
    try:
        stripe_prices = get_prices()
        price_map = {p["plan"]: p for p in stripe_prices}
    except Exception:
        price_map = {}

    result = []
    for slug, plan in PLANS.items():
        entry = {**plan, "plan": slug}
        if slug in price_map:
            entry["price_id"] = price_map[slug]["price_id"]
            entry["amount_cents"] = price_map[slug]["amount_cents"]
        result.append(entry)
    return {"plans": result}


@app.get("/saas/billing/publishable-key")
async def billing_publishable_key():
    """Return the Stripe publishable key for client-side Stripe.js usage."""
    try:
        key = get_publishable_key()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Stripe credentials unavailable: {exc}")
    return {"publishable_key": key}


# ── Trace: append events (subscription-gated) ─────────────────────────────────

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
async def saas_trace(body: TraceEventRequest, org: Dict = Depends(subscription_gated_org)):
    usage = get_usage_summary(org["org_id"])
    rate = check_rate_limit(org["org_id"], org["plan"], usage["today_requests"])
    if not rate["allowed"]:
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit reached ({rate['limit']} req/day). Upgrade to continue.",
        )

    request_id = body.request_id or f"{body.session_id}:{body.event_type}:{body.state_before}"
    event = {
        "event_type": body.event_type,
        "state_before": body.state_before,
        "state_after": body.state_after,
        "input_text": body.input_text,
        "policy_action": body.policy_action,
        "reason_code": body.reason_code,
        "response_text": body.response_text,
        "policy_version": nhid_client.get_policy_version(),
    }
    nhid_client.append_event(body.session_id, [event], request_id)
    increment_usage(org["org_id"])
    log_request(org["org_id"], "/saas/trace", "POST", 200, body.session_id)
    return {"ok": True, "session_id": body.session_id, "request_id": request_id}


# ── Proof: retrieve audit trail (subscription-gated) ─────────────────────────

@app.get("/saas/proof/{session_id}")
async def saas_proof(session_id: str, org: Dict = Depends(subscription_gated_org)):
    try:
        proof = nhid_client.get_proof(session_id)
        events = proof.get("events", [])
        log_request(org["org_id"], f"/saas/proof/{session_id}", "GET", 200, session_id)
        increment_usage(org["org_id"])
        return {
            "session_id": session_id,
            "org_id": org["org_id"],
            "valid_chain": proof.get("chain_valid", True),
            "event_count": proof.get("event_count", len(events)),
            "trace": {"events": events},
        }
    except nhid_client.NHIDClientError as exc:
        raise HTTPException(status_code=502, detail=f"NHID Bridge error: {exc}")
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


# ── Replay (subscription-gated) ───────────────────────────────────────────────

@app.get("/saas/replay/{session_id}")
async def saas_replay(session_id: str, org: Dict = Depends(subscription_gated_org)):
    try:
        events = nhid_client.get_events(session_id)
    except nhid_client.NHIDClientError as exc:
        raise HTTPException(status_code=502, detail=f"NHID Bridge error: {exc}")
    log_request(org["org_id"], f"/saas/replay/{session_id}", "GET", 200, session_id)
    return {"session_id": session_id, "events": events, "event_count": len(events)}


# ── Admin portal: session auth ────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    username: str
    password: str


@app.post("/admin/login")
async def admin_login(body: AdminLoginRequest):
    """
    Issue an admin session token.
    Credentials: ADMIN_USER / ADMIN_PASS (hardcoded, internal only).
    """
    if body.username != _ADMIN_USER or body.password != _ADMIN_PASS:
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    token = str(uuid.uuid4())
    _admin_sessions[token] = time.time() + _ADMIN_SESSION_TTL
    # Purge expired sessions to keep memory tidy
    expired = [k for k, exp in _admin_sessions.items() if time.time() > exp]
    for k in expired:
        del _admin_sessions[k]
    return {"admin_session_token": token, "expires_in": _ADMIN_SESSION_TTL}


# ── Admin portal: protected endpoints ────────────────────────────────────────

@app.get("/admin/orgs")
async def admin_portal_orgs(_token: str = Depends(require_admin_session)):
    """List all orgs enriched with per-org usage totals."""
    orgs = list_orgs()
    enriched = []
    for org in orgs:
        usage = get_usage_summary(org["org_id"])
        enriched.append({
            **org,
            "today_requests": usage.get("today_requests", 0),
            "total_requests": usage.get("total_requests", 0),
        })
    return {
        "orgs": enriched,
        "global_stats": get_global_stats(),
    }


@app.get("/admin/usage")
async def admin_portal_usage(_token: str = Depends(require_admin_session)):
    """Global usage stats and recent activity across all orgs."""
    stats = get_global_stats()
    # Collect recent activity across all orgs (last 50 events)
    activity = get_recent_activity(org_id=None, limit=50)
    return {
        "global_stats": stats,
        "recent_activity": activity,
    }


@app.get("/admin/org/{org_id}")
async def admin_portal_org(org_id: str, _token: str = Depends(require_admin_session)):
    """Single org detail with full usage breakdown and recent activity."""
    org = get_org(org_id)
    if not org:
        raise HTTPException(status_code=404, detail=f"Org '{org_id}' not found")
    usage = get_usage_summary(org_id)
    rate = check_rate_limit(org_id, org["plan"], usage["today_requests"])
    activity = get_recent_activity(org_id=org_id, limit=20)
    return {
        **org,
        "usage": {**usage, "rate_limit": rate},
        "recent_activity": activity,
    }
