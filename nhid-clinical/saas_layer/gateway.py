"""
NHID-Clinical SaaS Gateway.
Wraps the NHID core engine with multi-tenant auth, usage tracking, and Stripe billing.
Core files (app.py, nhid_engine, nhid_policy, nhid_event_store) are NOT modified.
"""
import logging
import os
import sys
import uuid
import time
import urllib.request
import urllib.error

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
_logger = logging.getLogger("nhid.saas")

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
    create_admin_session, validate_admin_session,
    delete_admin_session, purge_expired_admin_sessions,
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

# ── Admin credentials — deterministic, no env-var dependency ─────────────────
# These are intentionally hardcoded so the portal is always accessible.
_ADMIN_USER = "admin"
_ADMIN_PASS = "nhidclinical1626"
_ADMIN_SESSION_TTL = 8 * 3600  # 8 hours

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
    """Validate an admin session token (SQLite-backed, survives restarts)."""
    if not x_admin_session:
        raise HTTPException(status_code=401, detail="Admin session token required (X-Admin-Session header)")
    if not validate_admin_session(x_admin_session):
        raise HTTPException(status_code=401, detail="Admin session expired or invalid. Please log in again.")
    return x_admin_session


def subscription_gated_org(org: Dict = Depends(get_current_org)) -> Dict[str, Any]:
    """
    Resolves the org AND enforces billing gate.
    Blocks any org with status != 'active' (402 Payment Required).
    Admin routes bypass this — they use require_admin_session instead.
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
    Flat system status: nhid/saas/stripe state + org count + today's usage.
    Used by monitoring and the admin portal.
    """
    nhid_reachable = _probe_nhid()
    stripe_status = _probe_stripe()
    stats = get_global_stats()
    return {
        "nhid": "up" if nhid_reachable == "reachable" else "down",
        "saas": "up",
        "stripe": "ok" if stripe_status == "configured" else "error",
        "org_count": stats.get("total_orgs", 0),
        "usage_today": stats.get("orgs_active_today", 0),
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


@app.post("/admin/login", tags=["Admin"])
async def admin_login(body: AdminLoginRequest):
    """
    Issue a persistent admin session token (SQLite-backed, 8-hour TTL).
    Credentials are deterministic — never locked out by missing env vars.
    """
    if body.username != _ADMIN_USER or body.password != _ADMIN_PASS:
        _logger.warning("ADMIN_LOGIN_FAILED username=%s", body.username)
        raise HTTPException(status_code=401, detail="Invalid admin credentials")

    token = str(uuid.uuid4())
    expires_at = time.time() + _ADMIN_SESSION_TTL
    create_admin_session(token, expires_at)
    purge_expired_admin_sessions()

    _logger.info("ADMIN_LOGIN_SUCCESS username=%s", body.username)
    return {
        "admin_session_token": token,
        "expires_in": _ADMIN_SESSION_TTL,
        "expires_at": expires_at,
    }


@app.post("/admin/logout", tags=["Admin"])
async def admin_logout(token: str = Depends(require_admin_session)):
    """Invalidate the current admin session token immediately."""
    delete_admin_session(token)
    _logger.info("ADMIN_LOGOUT token_prefix=%s", token[:8])
    return {"ok": True, "message": "Logged out successfully"}


@app.get("/admin/session", tags=["Admin"])
async def admin_session(token: str = Depends(require_admin_session)):
    """Validate the current admin session. Returns 200 if valid, 401 if expired."""
    return {"ok": True, "valid": True, "token_prefix": token[:8]}


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
