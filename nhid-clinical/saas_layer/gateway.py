"""
NHID-Clinical SaaS Gateway — single-service production architecture.

This is the ONLY backend service that runs in production.

NHID core (nhid_event_store, nhid_policy, nhid_engine) is accessed via
direct Python imports inside nhid_client — no Bridge HTTP service required.

Production execution graph:
  Frontend (/nhid-saas/) → SaaS Gateway (port 8010) → nhid_client (in-process)
                                                      → Stripe (HTTPS)
                                                      → PostgreSQL (Replit managed)

Core files (app.py, nhid_engine, nhid_policy, nhid_event_store, tests/) are
never modified by this layer.
"""
import asyncio
import logging
import os
import sys
import uuid
import time
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
_logger = logging.getLogger("nhid.saas")

# Keep credential-bearing query parameters out of log output (including
# uvicorn's access log). Installed before any request is served.
from saas_layer.log_redaction import install_log_redaction  # noqa: E402
from saas_layer.webhook_auth import (  # noqa: E402
    WEBHOOK_API_KEY_HEADER,
    resolve_webhook_api_key as _resolve_webhook_api_key,
)
install_log_redaction()

# Ensure nhid-clinical/ is on the path so core modules are importable
_CLINICAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _CLINICAL_DIR not in sys.path:
    sys.path.insert(0, _CLINICAL_DIR)

from fastapi import FastAPI, HTTPException, Header, Request, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel
from typing import Optional, Any, Dict, List

from saas_layer.auth import (
    init_db, create_org, validate_api_key, get_org,
    list_orgs, increment_usage,
    create_admin_session, validate_admin_session,
    delete_admin_session, purge_expired_admin_sessions,
    link_org_to_user, get_org_by_user,
)
from saas_layer.usage import log_request, get_usage_summary, get_recent_activity, get_global_stats
from saas_layer.billing import get_plan, check_rate_limit, get_upgrade_path, plan_allows_voice_webhook
from saas_layer.stripe_billing import (
    check_subscription_gate,
    create_checkout_session,
    handle_webhook,
    get_prices,
    migrate_billing_columns,
)
from saas_layer.stripe_client import get_publishable_key
from saas_layer.admin_auth import (
    AdminCredentials,
    AdminCredentialError,
    load_admin_credentials,
    verify_password,
    verify_username,
)
from saas_layer import audit as audit_svc
from saas_layer.voice_policy import run_voice_policy
from saas_layer import voice_policy_store
from saas_layer.voice_sessions import (
    create_voice_session,
    delete_voice_session,
    extend_session as extend_voice_session,
    get_voice_session_for_update,
    list_voice_sessions,
    purge_old_sessions,
    update_voice_session_in_tx,
)
from saas_layer.db import get_conn

# NHID core is accessed via direct Python import (no Bridge HTTP dependency).
from saas_layer import nhid_client

# Maps provider call_id (Retell/Vapi/Twilio) → NHID session_id (in-memory).
# Protected by _call_id_lock. Allows /webhook/transcript to look up sessions
# using the provider's own call identifier instead of our internal UUID.
# Voice session state itself is persisted to PostgreSQL (voice_sessions table).
_call_id_map: Dict[str, str] = {}
_call_id_lock = threading.Lock()


# ── Admin credentials ─────────────────────────────────────────────────────────
# No defaults. Credentials are loaded from the environment during startup by
# _lifespan(); if they are absent the gateway refuses to start rather than
# falling back to a known password. See saas_layer/admin_auth.py.
_ADMIN_CREDS: Optional[AdminCredentials] = None
_ADMIN_SESSION_TTL = 8 * 3600  # 8 hours

# ── Voice session TTL config ───────────────────────────────────────────────────
# Sessions older than _VOICE_SESSION_TTL_HOURS are eligible for purging.
# _VOICE_SESSION_PURGE_INTERVAL is how often (in seconds) the background task
# wakes up to run the purge.  Both are configurable via environment variables.
_VOICE_SESSION_TTL_HOURS: int = int(os.environ.get("VOICE_SESSION_TTL_HOURS", "24"))
_VOICE_SESSION_PURGE_INTERVAL: int = int(
    os.environ.get("VOICE_SESSION_PURGE_INTERVAL_SECS", str(6 * 3600))
)

_logger = logging.getLogger(__name__)


async def _voice_session_cleanup_loop() -> None:
    """
    Background coroutine: purges voice_sessions rows older than
    _VOICE_SESSION_TTL_HOURS.  Runs once at startup (with a short initial
    delay so the server is fully up) then every _VOICE_SESSION_PURGE_INTERVAL
    seconds.
    """
    await asyncio.sleep(10)  # let startup finish before first purge
    while True:
        try:
            deleted = await asyncio.get_event_loop().run_in_executor(
                None, purge_old_sessions, _VOICE_SESSION_TTL_HOURS
            )
            _logger.info(
                "voice_session_cleanup: purged %d sessions (ttl=%dh, next in %ds)",
                deleted,
                _VOICE_SESSION_TTL_HOURS,
                _VOICE_SESSION_PURGE_INTERVAL,
            )
        except Exception as exc:
            _logger.warning("voice_session_cleanup error (will retry): %s", exc)
        await asyncio.sleep(_VOICE_SESSION_PURGE_INTERVAL)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Load required credentials, start background cleanup, then serve.

    Admin credentials are mandatory. If they are missing or malformed this
    raises, FastAPI aborts startup, and the gateway never serves a request —
    deliberately, so that a misconfigured deployment cannot expose /admin/*
    behind a default password.
    """
    global _ADMIN_CREDS
    _ADMIN_CREDS = load_admin_credentials()
    _logger.info("ADMIN: credentials loaded (user=%s)", _ADMIN_CREDS.username)

    task = asyncio.create_task(_voice_session_cleanup_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="NHID-Clinical SaaS API",
    description="Multi-tenant audit platform powered by NHID core engine.",
    version="2.0.0",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _strip_path_prefix(request: Request, call_next):
    """
    Strip /saas-api prefix when present.

    The Vite dev proxy already rewrites /saas-api/* → /* before hitting port 8010,
    so in development this middleware is a no-op.

    In production the Replit reverse-proxy routes /saas-api/* to this service
    WITHOUT rewriting the path, so we strip it here before FastAPI routing runs.
    This lets the same route definitions serve both:
      - Direct access:  /saas/billing/webhook  (Stripe webhook calls)
      - Prefixed access: /saas-api/saas/...    (React frontend in production)
    """
    path = request.scope.get("path", "")
    if path.startswith("/saas-api"):
        new_path = path[len("/saas-api"):] or "/"
        request.scope["path"] = new_path
        request.scope["raw_path"] = new_path.encode("latin-1")
    return await call_next(request)


init_db()
migrate_billing_columns()
voice_policy_store.init_voice_policy_table()


# ── Dependencies ──────────────────────────────────────────────────────────────

def get_current_org(x_api_key: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    if not x_api_key:
        raise HTTPException(status_code=401, detail="X-API-Key header required")
    org = validate_api_key(x_api_key)
    if not org:
        raise HTTPException(status_code=403, detail="Invalid or inactive API key")
    return org



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
    Import-based reachability check for NHID core.
    Returns 'reachable' if nhid_event_store can be imported in-process.
    No HTTP call — works in production with no Bridge service running.
    """
    return "reachable" if nhid_client.is_reachable() else "unreachable"


def _probe_stripe() -> str:
    """Return 'live', 'test', or 'missing' based on the Stripe key prefix."""
    try:
        from saas_layer.stripe_client import get_secret_key
        key = get_secret_key()
        if not key:
            return "missing"
        if key.startswith("sk_live_"):
            return "live"
        if key.startswith("sk_test_"):
            return "test"
        return "configured"
    except Exception:
        return "missing"


def _probe_db() -> bool:
    """Return True if the PostgreSQL database is accessible."""
    try:
        from saas_layer.auth import list_orgs
        list_orgs()
        return True
    except Exception:
        return False


def _is_production() -> bool:
    return (
        os.environ.get("APP_ENV", "").lower() == "production"
        or os.environ.get("REPLIT_DEPLOYMENT") == "1"
    )


# ── Root redirect ─────────────────────────────────────────────────────────────
# "/" is owned by this gateway in production so that the NHID Audit Core
# Dashboard is never the first thing a visitor sees. Redirect cleanly to the
# SaaS product UI.

@app.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/nhid-saas/", status_code=301)


# ── Health endpoints ──────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"])
async def health():
    """
    SaaS gateway health check — production-safe format.
    No internal structure leakage.
    """
    stripe_mode = _probe_stripe()
    nhid_ok = nhid_client.is_reachable()
    db_ok = _probe_db()
    stats = get_global_stats()
    return {
        "status": "ok",
        "environment": "production" if _is_production() else "development",
        "nhid_core": "in-process" if nhid_ok else "unavailable",
        "stripe": stripe_mode,
        "db": "healthy" if db_ok else "error",
        "admin": "active",
        "org_count": stats.get("total_orgs", 0),
    }


@app.get("/saas/health", tags=["Health"])
async def saas_health():
    """Backward-compatible alias for /health."""
    return await health()


@app.get("/saas/system/status", tags=["Health"])
async def system_status():
    """
    Flat system status used by monitoring and the admin portal.
    """
    stripe_mode = _probe_stripe()
    nhid_ok = nhid_client.is_reachable()
    stats = get_global_stats()
    return {
        "nhid": "up" if nhid_ok else "down",
        "saas": "up",
        "stripe": "ok" if stripe_mode in ("live", "test", "configured") else "error",
        "stripe_mode": stripe_mode,
        "org_count": stats.get("total_orgs", 0),
        "usage_today": stats.get("orgs_active_today", 0),
    }


# ── Admin: org management ─────────────────────────────────────────────────────

class CreateOrgRequest(BaseModel):
    org_name: str
    plan: str = "free"


@app.post("/saas/admin/orgs")
async def admin_create_org(body: CreateOrgRequest, _token: str = Depends(require_admin_session)):
    """Create an org with a specific plan. Session auth required."""
    org = create_org(body.org_name, body.plan)
    return org


@app.get("/saas/admin/orgs")
async def admin_list_orgs(_token: str = Depends(require_admin_session)):
    """List all orgs. Session auth required."""
    return {"orgs": list_orgs(), "global_stats": get_global_stats()}


# ── Org: public self-service registration ─────────────────────────────────────

class RegisterOrgRequest(BaseModel):
    org_name: str


@app.post("/saas/orgs/register", tags=["Org"])
async def register_org(body: RegisterOrgRequest):
    """
    Public org registration — no admin key required.
    Creates a free-tier org immediately. Upgrade via Stripe after login.
    Rate-limited by free-tier plan limits from the moment of creation.
    """
    name = (body.org_name or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Organization name must be at least 2 characters.")
    if len(name) > 120:
        raise HTTPException(status_code=400, detail="Organization name must be 120 characters or fewer.")
    try:
        org = create_org(name, "free")
    except Exception:
        raise HTTPException(status_code=500, detail="Could not create organization. Please try again.")
    return {
        "org_id": org["org_id"],
        "org_name": org["org_name"],
        "api_key": org["api_key"],
        "plan": org["plan"],
    }


# ── Org: user ↔ org linkage ───────────────────────────────────────────────────

class LinkOrgRequest(BaseModel):
    replit_user_id: str


@app.post("/saas/org/link", tags=["Org"])
async def link_org(body: LinkOrgRequest, org: Dict = Depends(get_current_org)):
    """
    Associate a Replit user ID with the caller's org (identified by API key).
    Idempotent — safe to call on every login. Returns the updated org summary.
    """
    uid = (body.replit_user_id or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="replit_user_id is required.")
    ok = link_org_to_user(org["org_id"], uid)
    if not ok:
        raise HTTPException(status_code=404, detail="Org not found.")
    return {
        "org_id": org["org_id"],
        "org_name": org["org_name"],
        "replit_user_id": uid,
        "linked": True,
    }


@app.get("/saas/org/by-user/{replit_user_id}", tags=["Org"])
async def get_org_for_user(replit_user_id: str):
    """
    Look up an org by Replit user ID. Returns org summary or 404.
    Used by the frontend after login to auto-restore the session.
    """
    uid = (replit_user_id or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="replit_user_id is required.")
    org = get_org_by_user(uid)
    if not org:
        raise HTTPException(status_code=404, detail="No org found for this user.")
    return {
        "org_id": org["org_id"],
        "org_name": org["org_name"],
        "api_key": org["api_key"],
        "plan": org["plan"],
        "status": org.get("status", "active"),
    }


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
        "billing_active": bool(org.get("stripe_subscription_id")),
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
    # In live mode, block checkout if webhook secret is not configured.
    # Without webhook verification, subscription events cannot be trusted.
    try:
        _secret_key = get_secret_key()
        if _secret_key and _secret_key.startswith("sk_live_") and not os.environ.get("STRIPE_WEBHOOK_SECRET"):
            raise HTTPException(
                status_code=503,
                detail="Billing is not fully configured. Please contact support.",
            )
    except HTTPException:
        raise
    except Exception:
        pass
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


@app.get("/saas/billing/webhook/status")
async def billing_webhook_status():
    """
    Diagnostic: confirm webhook endpoint config without triggering a real event.
    Safe to call at any time — no DB writes, no Stripe API calls.
    """
    secret_set = bool(os.environ.get("STRIPE_WEBHOOK_SECRET"))
    return {
        "webhook_url_path": "/saas/billing/webhook",
        "signature_verification": "enabled" if secret_set else "disabled — set STRIPE_WEBHOOK_SECRET",
        "secret_configured": secret_set,
        "handled_events": [
            "checkout.session.completed",
            "invoice.paid",
            "customer.subscription.deleted",
            "customer.subscription.updated",
        ],
        "idempotency": "enabled (processed_events table)",
        "note": "Configure this path as your Stripe webhook endpoint in the Stripe dashboard.",
    }


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
        return JSONResponse(status_code=200, content=result)
    except Exception as exc:
        import traceback; traceback.print_exc()
        return JSONResponse(status_code=400, content={"error": str(exc)})


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


# ── Compliance badge (public, no auth) ────────────────────────────────────────
# Vendors embed this SVG in their documentation to signal NHID compliance.
# Only active paid-tier orgs (L1/L2/L3) receive a badge; free/inactive return 404.

_TIER_ACCENT: dict = {"l1": "#00c2a8", "l2": "#38bdf8", "l3": "#c084fc"}
_TIER_LOGO_FG: dict = {"l1": "#042f2e", "l2": "#082f49", "l3": "#2e1065"}
_TIER_LEVEL: dict = {"l1": "L1", "l2": "L2", "l3": "L3"}


def _build_badge_svg(org_name: str, tier: str, org_id: str = "") -> str:
    accent = _TIER_ACCENT.get(tier, "#00c2a8")
    logo_fg = _TIER_LOGO_FG.get(tier, "#042f2e")
    tier_level = _TIER_LEVEL.get(tier, tier.upper())
    safe_name = (org_name[:26] + "…") if len(org_name) > 26 else org_name

    # Unique IDs prevent conflicts when multiple badges appear on one page
    uid = (org_id or tier or "nhid")[:8].replace("-", "")

    # Layout constants
    left_w = 74    # NHID branding section (bar + logo + label)
    # Right section width: wide enough for "✓ L2 VERIFIED" + org name
    right_w = max(114, len(safe_name) * 5 + 32)
    total_w = left_w + right_w
    tx = left_w + 10   # x-start for right-section text

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="30"'
        f' role="img" aria-label="NHID Clinical {tier_level} Verified — {safe_name}">'
        f"<title>NHID Clinical {tier_level} Verified — {safe_name}</title>"
        "<defs>"
        f'<linearGradient id="bg{uid}" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="#1e293b"/>'
        f'<stop offset="1" stop-color="#0f172a"/>'
        "</linearGradient>"
        f'<clipPath id="cp{uid}"><rect width="{total_w}" height="30" rx="5"/></clipPath>'
        "</defs>"
        # Card background + tinted right section + border
        f'<g clip-path="url(#cp{uid})">'
        f'<rect width="{total_w}" height="30" fill="url(#bg{uid})"/>'
        f'<rect width="3" height="30" fill="{accent}"/>'
        f'<rect x="{left_w}" width="{right_w}" height="30" fill="{accent}" fill-opacity="0.10"/>'
        f'<rect width="{total_w}" height="30" rx="5" fill="none" stroke="{accent}" stroke-width="0.8" stroke-opacity="0.30"/>'
        "</g>"
        # N logo mark
        f'<rect x="9" y="7" width="16" height="16" rx="3" fill="{accent}"/>'
        f'<text x="17" y="18.5" text-anchor="middle"'
        f' font-family="\'Arial Black\',Arial,sans-serif" font-size="10" font-weight="900" fill="{logo_fg}">N</text>'
        # NHID / Clinical label (two lines)
        f'<text x="30" y="13" font-family="Arial,Helvetica,sans-serif" font-size="7.5"'
        f' font-weight="700" fill="{accent}" letter-spacing="0.8">NHID</text>'
        f'<text x="30" y="24" font-family="Arial,Helvetica,sans-serif" font-size="7"'
        f' fill="#475569" letter-spacing="0.3">Clinical</text>'
        # Divider
        f'<line x1="{left_w}" y1="6" x2="{left_w}" y2="24" stroke="{accent}" stroke-width="0.5" stroke-opacity="0.35"/>'
        # ✓ TIER VERIFIED (top line)
        f'<text x="{tx}" y="14" font-family="Arial,Helvetica,sans-serif" font-size="8.5"'
        f' font-weight="700" fill="{accent}">&#x2713; {tier_level} VERIFIED</text>'
        # Org name (bottom line)
        f'<text x="{tx}" y="25" font-family="Arial,Helvetica,sans-serif" font-size="7.5"'
        f' fill="#94a3b8">{safe_name}</text>'
        "</svg>"
    )


@app.get("/saas/badge/{org_id}", tags=["Badge"])
async def compliance_badge(org_id: str):
    """
    Return an SVG compliance badge for a paid-tier org.

    Publicly accessible — no API key required. Vendors embed the URL:
      <img src="https://<host>/saas/badge/<org_id>" alt="NHID Verified"/>

    Returns 404 for free-tier or inactive orgs so badge URLs go dark
    when a subscription lapses.
    """
    org = get_org(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Org not found.")

    plan = org.get("plan", "free")
    status = org.get("status", "active")

    if plan not in _TIER_LABEL or status != "active":
        raise HTTPException(
            status_code=404,
            detail="Badge not available for this org (free tier or inactive subscription).",
        )

    svg = _build_badge_svg(org["org_name"], plan, org_id)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "no-cache, max-age=0",
            "X-NHID-Plan": plan,
            "X-NHID-Org": org_id,
        },
    )


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
    policy_version = nhid_client.get_policy_version()
    event = {
        "event_type": body.event_type,
        "state_before": body.state_before,
        "state_after": body.state_after,
        "input_text": body.input_text,
        "policy_action": body.policy_action,
        "reason_code": body.reason_code,
        "response_text": body.response_text,
        "policy_version": policy_version,
    }
    nhid_client.append_event(body.session_id, [event], request_id)

    # Write HMAC-signed record to SaaS audit_traces (append-only, tamper-evident).
    # Hard failure: if audit write fails the whole request fails (500).
    # The event reached NHID core above, but the caller must know the tamper-evident
    # record was not created so they can retry rather than proceed silently.
    try:
        audit_result = audit_svc.append_trace(
            org_id=org["org_id"],
            session_id=body.session_id,
            event=event,
        )
    except Exception as exc:
        _logger.error(
            "audit_svc.append_trace FAILED — returning 500 org=%s session=%s: %s",
            org["org_id"], body.session_id, exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Audit trace write failed. Event was not recorded in the tamper-evident log.",
        )

    increment_usage(org["org_id"])
    log_request(org["org_id"], "/saas/trace", "POST", 200, body.session_id)
    return {
        "ok": True,
        "session_id": body.session_id,
        "request_id": request_id,
        "event_id": audit_result.get("event_id"),
        "event_hash": audit_result.get("event_hash"),
        "seq_num": audit_result.get("seq_num"),
    }


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
    except nhid_client.NHIDClientError:
        raise HTTPException(status_code=502, detail="Audit service temporarily unavailable.")
    except Exception:
        raise HTTPException(status_code=500, detail="An error occurred retrieving the audit trail.")


# ── Audit: cryptographic verify + enhanced proof ──────────────────────────────

@app.get("/saas/audit/verify/{session_id}", tags=["Audit"])
async def audit_verify(session_id: str, org: Dict = Depends(subscription_gated_org)):
    """
    Full cryptographic chain verification for a session.

    Re-derives every event_hash and HMAC signature from stored data and
    compares them against the stored values using constant-time comparison.
    Returns a list of breaks (empty means the chain is intact).

    Rate-limited: 10 calls per org per 60 seconds.
    """
    if not audit_svc.check_verify_rate_limit(org["org_id"]):
        raise HTTPException(
            status_code=429,
            detail="Verify rate limit exceeded (10 calls/min). Please wait before retrying.",
        )
    try:
        result = audit_svc.verify_chain(org["org_id"], session_id)
    except Exception as exc:
        _logger.error("audit_verify error org=%s session=%s: %s", org["org_id"], session_id, exc)
        raise HTTPException(status_code=500, detail="Chain verification failed.")

    log_request(org["org_id"], f"/saas/audit/verify/{session_id}", "GET", 200, session_id)
    return {
        "session_id": session_id,
        "org_id": org["org_id"],
        "chain_valid": result["chain_valid"],
        "hmac_valid": result["hmac_valid"],
        "event_count": result["event_count"],
        "breaks": result["breaks"],
    }


@app.get("/saas/audit/proof/{session_id}", tags=["Audit"])
async def audit_proof(session_id: str, org: Dict = Depends(subscription_gated_org)):
    """
    Enhanced audit proof — includes hmac_signature and per-event verification
    status alongside the full event payload.

    Use /saas/proof/{session_id} for the lightweight version (no HMAC fields).
    Use this endpoint when you need cryptographic attestation per event.
    """
    try:
        result = audit_svc.verify_chain(org["org_id"], session_id)
    except Exception as exc:
        _logger.error("audit_proof error org=%s session=%s: %s", org["org_id"], session_id, exc)
        raise HTTPException(status_code=500, detail="Audit proof retrieval failed.")

    if result["event_count"] == 0:
        raise HTTPException(status_code=404, detail=f"No audit trace found for session '{session_id}' in this org.")

    log_request(org["org_id"], f"/saas/audit/proof/{session_id}", "GET", 200, session_id)
    increment_usage(org["org_id"])
    return {
        "session_id": session_id,
        "org_id": org["org_id"],
        "chain_valid": result["chain_valid"],
        "hmac_valid": result["hmac_valid"],
        "event_count": result["event_count"],
        "breaks": result["breaks"],
        "events": result["events"],
    }


# ── Voice: incoming call + transcript enforcement ─────────────────────────────

class VoiceIncomingRequest(BaseModel):
    caller_id: Optional[str] = None
    org_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class VoiceTranscriptRequest(BaseModel):
    session_id: str
    transcript_text: str
    turn_number: int = 1


@app.post("/saas/voice/incoming", tags=["Voice"])
async def voice_incoming(body: VoiceIncomingRequest, org: Dict = Depends(get_current_org)):
    """
    Register an inbound voice call.
    Creates a session, appends a voice_session_start audit event,
    and returns the required opening disclosure script.
    """
    session_id = str(uuid.uuid4())
    create_voice_session(session_id, org["org_id"], provider="api")

    event = {
        "event_type": "voice_session_start",
        "state_before": "idle",
        "state_after": "active",
        "input_text": body.caller_id,
        "policy_action": "disclose",
        "reason_code": "REQUIRE_UPFRONT_DISCLOSURE",
        "response_text": None,
        "policy_version": "VOICE-POLICY-v1.0",
    }
    try:
        nhid_client.append_event(session_id, [event], f"voice:start:{session_id}")
    except nhid_client.NHIDClientError as exc:
        _logger.warning("voice_incoming nhid append skipped: %s", exc)

    try:
        audit_svc.append_trace(org_id=org["org_id"], session_id=session_id, event=event)
    except Exception as exc:
        _logger.error("voice_incoming audit_svc.append_trace FAILED org=%s session=%s: %s",
                      org["org_id"], session_id, exc)
        try:
            delete_voice_session(session_id)
        except Exception as del_exc:
            _logger.warning("voice_incoming cleanup failed for session=%s: %s", session_id, del_exc)
        raise HTTPException(
            status_code=500,
            detail="Audit trace write failed. Voice session was not recorded in the tamper-evident log.",
        )

    log_request(org["org_id"], "/saas/voice/incoming", "POST", 200, session_id)
    disclosure_text = (
        f"This call is handled by an AI system operating on behalf of {org['org_name']}. "
        "You may request a human agent at any time."
    )
    return {
        "session_id": session_id,
        "action": "disclose",
        "disclosure_text": disclosure_text,
    }


@app.post("/saas/voice/transcript", tags=["Voice"])
async def voice_transcript(body: VoiceTranscriptRequest, org: Dict = Depends(get_current_org)):
    """
    Process a transcript chunk through the voice policy engine.
    Appends the enforcement decision to the tamper-evident audit trail.
    Returns action, reason_code, session_id, and event_hash.
    """
    # ── Transactional read-modify-write ──────────────────────────────────────
    # Open a single connection and hold it open for the full operation.
    # SELECT ... FOR UPDATE serialises concurrent requests for the same session,
    # guaranteeing that policy evaluation and state update are atomic.
    conn = get_conn()
    try:
        with conn:
            # Lock the row for the duration of this transaction.
            session_state = get_voice_session_for_update(conn, body.session_id)
            if session_state is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Voice session '{body.session_id}' not found.",
                )
            if session_state["org_id"] != org["org_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Voice session does not belong to your organisation.",
                )

            org_policy = voice_policy_store.get_effective_policy(org["org_id"])
            decision = run_voice_policy(
                body.transcript_text,
                session_state,
                ruleset=org_policy["rules"],
                policy_version=org_policy["version"],
            )
            action = decision["action"]
            reason_code = decision["reason_code"]
            policy_version = decision["policy_version"]

            event = {
                "event_type": "voice_transcript",
                "state_before": "active",
                "state_after": "escalated" if action == "escalate" else "active",
                "input_text": body.transcript_text[:500],
                "policy_action": action,
                "reason_code": reason_code,
                "response_text": None,
                "policy_version": policy_version,
            }

            try:
                nhid_client.append_event(
                    body.session_id, [event],
                    f"voice:transcript:{body.session_id}:{body.turn_number}",
                )
            except nhid_client.NHIDClientError as exc:
                _logger.warning("voice_transcript nhid append skipped: %s", exc)

            try:
                result = audit_svc.append_trace(
                    org_id=org["org_id"],
                    session_id=body.session_id,
                    event=event,
                )
                event_hash = result.get("event_hash", "")
            except Exception as exc:
                _logger.error(
                    "voice_transcript audit_svc.append_trace FAILED org=%s session=%s: %s",
                    org["org_id"], body.session_id, exc,
                )
                raise HTTPException(
                    status_code=500,
                    detail="Audit trace write failed. Enforcement decision was not recorded in the tamper-evident log.",
                )

            new_disclosure = session_state["disclosure_confirmed"]
            new_escalated = session_state["escalated"]
            if action in ("allow", "disclose"):
                new_disclosure = True
            elif action == "escalate":
                new_disclosure = True
                new_escalated = True
            update_voice_session_in_tx(conn, body.session_id, new_disclosure, new_escalated)
            # transaction commits here on clean `with conn:` exit
    finally:
        conn.close()

    log_request(org["org_id"], "/saas/voice/transcript", "POST", 200, body.session_id)
    return {
        "action": action,
        "reason_code": reason_code,
        "session_id": body.session_id,
        "event_hash": event_hash,
    }


@app.get("/saas/voice/policy", tags=["Voice"])
async def get_voice_policy(org: Dict = Depends(get_current_org)):
    """
    Return the org's current voice policy configuration (full rule list).
    If no custom config has been saved, returns the system defaults.
    Also includes the last 10 saved ruleset versions for the history view.
    Also exposes the built-in rule registry so the UI can describe each rule type.
    """
    effective = voice_policy_store.get_effective_policy(org["org_id"])
    history = voice_policy_store.get_policy_history(org["org_id"], limit=10)
    return {
        "org_id": org["org_id"],
        "rules": effective["rules"],
        "version": effective["version"],
        "is_custom": effective["is_custom"],
        "created_at": effective.get("created_at"),
        "history": history,
        "registry": voice_policy_store.BUILTIN_RULE_REGISTRY,
    }


class VoicePolicyRuleBody(BaseModel):
    rule_key: str
    rule_type: str
    label: str
    enabled: bool = True
    priority: int = 0
    params: dict = {}


class VoicePolicyUpdateBody(BaseModel):
    rules: List[VoicePolicyRuleBody]


@app.put("/saas/voice/policy", tags=["Voice"])
async def update_voice_policy(
    body: VoicePolicyUpdateBody,
    org: Dict = Depends(get_current_org),
):
    """
    Save a new ruleset for the org.
    Each save creates an append-only version row for audit purposes.
    Returns the newly active policy.
    """
    if not body.rules:
        raise HTTPException(status_code=422, detail="rules must be a non-empty list.")
    if len(body.rules) > 20:
        raise HTTPException(status_code=422, detail="Maximum 20 rules allowed.")

    ruleset = []
    for r in body.rules:
        rule: Dict[str, Any] = {
            "rule_key": r.rule_key,
            "rule_type": r.rule_type,
            "label": r.label,
            "enabled": r.enabled,
            "priority": r.priority,
            "params": dict(r.params),
        }
        # Normalise and validate phrase_match params
        if r.rule_type == "phrase_match":
            raw = r.params.get("phrases", [])
            if not isinstance(raw, list):
                raise HTTPException(
                    status_code=422,
                    detail=f"Rule '{r.rule_key}': params.phrases must be a list of strings.",
                )
            phrases = [p.strip().lower() for p in raw if isinstance(p, str) and p.strip()]
            if r.enabled and not phrases:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Rule '{r.rule_key}' is enabled but has no trigger phrases. "
                        "Either add at least one phrase or disable the rule."
                    ),
                )
            rule["params"] = {"phrases": phrases}
        ruleset.append(rule)

    saved = voice_policy_store.save_ruleset(org["org_id"], ruleset)
    log_request(org["org_id"], "/saas/voice/policy", "PUT", 200, None)
    return saved


# ── Voice webhook: provider normalisation ─────────────────────────────────────
#
# Retell AI    — top-level "call_id" + "event" fields
# Vapi         — top-level "message" dict with "type" field
# Twilio       — "CallSid" field (form-encoded or JSON)
# Generic      — our own format (caller_id / session_id)
#
# Webhook authentication:
#
#   Preferred — send the key as a header:
#     X-NHID-API-Key: <key>
#
#   Deprecated — ?api_key=<key> in the URL. Still accepted so existing
#   registrations keep working, but query strings are recorded by access logs,
#   proxies and monitoring systems. Query-param use logs a deprecation warning
#   and will be removed after the migration window.
#
# Neither mechanism authenticates the *sender*: a valid key proves the caller
# holds the org credential, not that the payload originated from Retell, Vapi
# or Twilio. Per-vendor signature verification is a separate, unimplemented
# control — do not describe this as vendor signature verification.

def _detect_webhook_provider(body: Dict[str, Any]) -> str:
    if "call_id" in body and ("event" in body or "event_type" in body):
        return "retell"
    if isinstance(body.get("message"), dict) and "type" in body.get("message", {}):
        return "vapi"
    if "CallSid" in body:
        return "twilio"
    return "generic"


def _normalize_incoming_webhook(body: Dict[str, Any]) -> Dict[str, Any]:
    p = _detect_webhook_provider(body)
    if p == "retell":
        return {
            "caller_id": body.get("from_number") or body.get("call_id"),
            "provider_call_id": body.get("call_id"),
            "provider": "retell",
            "metadata": {k: body[k] for k in ("agent_id", "call_type", "from_number", "to_number") if body.get(k)},
        }
    if p == "vapi":
        msg = body.get("message") or {}
        call = msg.get("call") or body.get("call") or {}
        customer = call.get("customer") or {}
        return {
            "caller_id": customer.get("number") or call.get("id"),
            "provider_call_id": call.get("id"),
            "provider": "vapi",
            "metadata": {k: v for k, v in {
                "assistant_id": call.get("assistantId"),
                "call_type": call.get("type"),
                "phone_number_id": call.get("phoneNumberId"),
            }.items() if v},
        }
    if p == "twilio":
        return {
            "caller_id": body.get("From"),
            "provider_call_id": body.get("CallSid"),
            "provider": "twilio",
            "metadata": {k: body[k] for k in ("To", "CallStatus", "Direction") if body.get(k)},
        }
    return {
        "caller_id": body.get("caller_id"),
        "provider_call_id": None,
        "provider": "generic",
        "metadata": body.get("metadata") or {},
    }


def _normalize_transcript_webhook(body: Dict[str, Any]) -> Dict[str, Any]:
    p = _detect_webhook_provider(body)
    if p == "retell":
        call_id = body.get("call_id")
        transcript = body.get("transcript") or []
        if isinstance(transcript, list) and transcript:
            last = transcript[-1] if isinstance(transcript[-1], dict) else {}
            text: str = last.get("content") or last.get("text") or ""
            turn_num: int = len(transcript)
        elif isinstance(transcript, str):
            text = transcript
            turn_num = body.get("turn_number") or 1
        else:
            text = body.get("content") or ""
            turn_num = body.get("turn_number") or 1
        return {"provider_call_id": call_id, "transcript_text": text, "turn_number": turn_num, "provider": "retell"}
    if p == "vapi":
        msg = body.get("message") or {}
        call = msg.get("call") or body.get("call") or {}
        return {
            "provider_call_id": call.get("id"),
            "transcript_text": msg.get("transcript") or msg.get("text") or "",
            "turn_number": msg.get("sequenceId") or 1,
            "provider": "vapi",
        }
    if p == "twilio":
        return {
            "provider_call_id": body.get("CallSid"),
            "transcript_text": body.get("SpeechResult") or body.get("TranscriptionText") or "",
            "turn_number": int(body.get("SequenceNumber") or 1),
            "provider": "twilio",
        }
    return {
        "provider_call_id": None,
        "transcript_text": body.get("transcript_text") or "",
        "turn_number": body.get("turn_number") or 1,
        "provider": "generic",
    }


@app.post("/saas/voice/webhook/incoming", tags=["Voice Webhooks"])
async def voice_webhook_incoming(
    request: Request,
    api_key: Optional[str] = Query(default=None),
    x_nhid_api_key: Optional[str] = Header(default=None, alias=WEBHOOK_API_KEY_HEADER),
):
    """
    Webhook receiver for incoming calls from Retell AI, Vapi, Twilio, or any
    platform that can POST to a URL.  Auto-detects the provider from the payload
    shape, creates an NHID session, and returns the required AI disclosure.

    Auth: send X-NHID-API-Key: <your-key>. The ?api_key= query parameter is
    still accepted for existing registrations but is deprecated — query strings
    are captured by access logs and proxies.

    Retell:  call_id + event at top level
    Vapi:    message.type + message.call.id
    Twilio:  CallSid field
    Generic: caller_id or session_id fields

    Returns { session_id, provider_call_id, provider, action, disclosure_text }.
    Use provider_call_id to correlate subsequent transcript events.
    """
    api_key = _resolve_webhook_api_key(
        x_nhid_api_key, api_key, "/saas/voice/webhook/incoming"
    )
    org = validate_api_key(api_key)
    if not org:
        raise HTTPException(status_code=401, detail="Invalid or expired API key.")

    if not plan_allows_voice_webhook(org.get("plan", "free")):
        raise HTTPException(
            status_code=403,
            detail=(
                f"Live voice webhook integrations require an L2 or higher plan. "
                f"Current plan: '{org.get('plan', 'free')}'. "
                "Upgrade at /billing to connect Retell, Vapi, Twilio, or other voice platforms."
            ),
        )

    try:
        body: Dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON.")

    norm = _normalize_incoming_webhook(body)
    provider = norm["provider"]
    caller_id = norm.get("caller_id")
    provider_call_id = norm.get("provider_call_id")

    session_id = str(uuid.uuid4())
    create_voice_session(session_id, org["org_id"], provider=provider)
    if provider_call_id:
        with _call_id_lock:
            _call_id_map[provider_call_id] = session_id

    event = {
        "event_type": "voice_session_start",
        "state_before": "idle",
        "state_after": "active",
        "input_text": caller_id,
        "policy_action": "disclose",
        "reason_code": "REQUIRE_UPFRONT_DISCLOSURE",
        "response_text": None,
        "policy_version": "VOICE-POLICY-v1.0",
    }
    try:
        nhid_client.append_event(session_id, [event], f"voice:start:{session_id}")
    except nhid_client.NHIDClientError as exc:
        _logger.warning("voice_webhook_incoming nhid append skipped: %s", exc)

    try:
        audit_svc.append_trace(org_id=org["org_id"], session_id=session_id, event=event)
    except Exception as exc:
        _logger.error("voice_webhook_incoming audit FAILED org=%s session=%s: %s",
                      org["org_id"], session_id, exc)
        try:
            delete_voice_session(session_id)
        except Exception as del_exc:
            _logger.warning("voice_webhook_incoming cleanup failed session=%s: %s", session_id, del_exc)
        if provider_call_id:
            with _call_id_lock:
                _call_id_map.pop(provider_call_id, None)
        raise HTTPException(
            status_code=500,
            detail="Audit trace write failed. Voice session was not recorded in the tamper-evident log.",
        )

    log_request(org["org_id"], "/saas/voice/webhook/incoming", "POST", 200, session_id)
    disclosure_text = (
        f"This call is handled by an AI system operating on behalf of {org['org_name']}. "
        "You may request a human agent at any time."
    )
    return {
        "session_id": session_id,
        "provider": provider,
        "provider_call_id": provider_call_id,
        "action": "disclose",
        "disclosure_text": disclosure_text,
        "normalized": {"caller_id": caller_id, "metadata": norm.get("metadata")},
    }


@app.post("/saas/voice/webhook/transcript", tags=["Voice Webhooks"])
async def voice_webhook_transcript(
    request: Request,
    api_key: Optional[str] = Query(default=None),
    x_nhid_api_key: Optional[str] = Header(default=None, alias=WEBHOOK_API_KEY_HEADER),
):
    """
    Webhook receiver for real-time transcript events from Retell, Vapi, Twilio, etc.

    Auth: send X-NHID-API-Key: <your-key>. The ?api_key= query parameter is
    still accepted but deprecated.

    Session lookup order:
      1. provider_call_id from the normalised payload → looked up in _call_id_map
         (populated when /webhook/incoming was called for this call)
      2. session_id field present directly in the body (generic / custom format)

    Returns the same { action, reason_code, session_id, event_hash } shape as
    /saas/voice/transcript, plus provider and provider_call_id echo-back.
    """
    api_key = _resolve_webhook_api_key(
        x_nhid_api_key, api_key, "/saas/voice/webhook/transcript"
    )
    org = validate_api_key(api_key)
    if not org:
        raise HTTPException(status_code=401, detail="Invalid or expired API key.")

    if not plan_allows_voice_webhook(org.get("plan", "free")):
        raise HTTPException(
            status_code=403,
            detail=(
                f"Live voice webhook integrations require an L2 or higher plan. "
                f"Current plan: '{org.get('plan', 'free')}'. "
                "Upgrade at /billing to connect Retell, Vapi, Twilio, or other voice platforms."
            ),
        )

    try:
        body: Dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON.")

    norm = _normalize_transcript_webhook(body)
    provider = norm["provider"]
    provider_call_id = norm.get("provider_call_id")
    transcript_text: str = norm.get("transcript_text") or ""
    turn_number: int = norm.get("turn_number") or 1

    with _call_id_lock:
        if provider_call_id:
            session_id = _call_id_map.get(provider_call_id)
        else:
            session_id = body.get("session_id")

    if not session_id:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No NHID session found for provider_call_id='{provider_call_id}'. "
                "Call POST /saas/voice/webhook/incoming first to register the call."
            ),
        )

    conn = get_conn()
    try:
        with conn:
            session_state = get_voice_session_for_update(conn, session_id)
            if session_state is None:
                raise HTTPException(status_code=404, detail=f"Voice session '{session_id}' not found.")
            if session_state["org_id"] != org["org_id"]:
                raise HTTPException(status_code=403, detail="Voice session does not belong to your organisation.")

            org_policy = voice_policy_store.get_effective_policy(org["org_id"])
            decision = run_voice_policy(
                transcript_text,
                session_state,
                ruleset=org_policy["rules"],
                policy_version=org_policy["version"],
            )
            action = decision["action"]
            reason_code = decision["reason_code"]
            policy_version = decision["policy_version"]

            event = {
                "event_type": "voice_transcript",
                "state_before": "active",
                "state_after": "escalated" if action == "escalate" else "active",
                "input_text": transcript_text[:500],
                "policy_action": action,
                "reason_code": reason_code,
                "response_text": None,
                "policy_version": policy_version,
            }
            try:
                nhid_client.append_event(session_id, [event], f"voice:transcript:{session_id}:{turn_number}")
            except nhid_client.NHIDClientError as exc:
                _logger.warning("voice_webhook_transcript nhid append skipped: %s", exc)

            try:
                result = audit_svc.append_trace(org_id=org["org_id"], session_id=session_id, event=event)
                event_hash = result.get("event_hash", "")
            except Exception as exc:
                _logger.error("voice_webhook_transcript audit FAILED org=%s session=%s: %s",
                              org["org_id"], session_id, exc)
                raise HTTPException(
                    status_code=500,
                    detail="Audit trace write failed. Enforcement decision was not recorded.",
                )

            new_disclosure = session_state["disclosure_confirmed"]
            new_escalated = session_state["escalated"]
            if action in ("allow", "disclose"):
                new_disclosure = True
            elif action == "escalate":
                new_disclosure = True
                new_escalated = True
            update_voice_session_in_tx(conn, session_id, new_disclosure, new_escalated)
    finally:
        conn.close()

    log_request(org["org_id"], "/saas/voice/webhook/transcript", "POST", 200, session_id)
    return {
        "action": action,
        "reason_code": reason_code,
        "session_id": session_id,
        "provider": provider,
        "provider_call_id": provider_call_id,
        "event_hash": event_hash,
        "normalized": {"transcript_text": transcript_text, "turn_number": turn_number},
    }


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
    except nhid_client.NHIDClientError:
        raise HTTPException(status_code=502, detail="Audit service temporarily unavailable.")
    log_request(org["org_id"], f"/saas/replay/{session_id}", "GET", 200, session_id)
    return {"session_id": session_id, "events": events, "event_count": len(events)}


# ── Admin portal: session auth ────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    username: str
    password: str


class OrgSessionRetentionBody(BaseModel):
    voice_session_ttl_hours: Optional[int]  # None → revert to server default


@app.post("/admin/login", tags=["Admin"])
async def admin_login(body: AdminLoginRequest):
    """
    Issue a persistent admin session token (SQLite-backed, 8-hour TTL).

    Credentials are required configuration: the gateway refuses to start
    without them, so there is no default-password path into /admin/*.
    """
    creds = _ADMIN_CREDS
    if creds is None:
        # Startup should have made this impossible; fail closed regardless.
        _logger.error("ADMIN_LOGIN_UNAVAILABLE: credentials not loaded")
        raise HTTPException(status_code=503, detail="Admin authentication unavailable")

    user_ok = verify_username(body.username, creds.username)
    pass_ok = verify_password(body.password, creds.password_hash)
    if not (user_ok and pass_ok):
        # Log the attempt, never the supplied or expected credential.
        _logger.warning("ADMIN_LOGIN_FAILED")
        raise HTTPException(status_code=401, detail="Invalid admin credentials")

    token = str(uuid.uuid4())
    expires_at = time.time() + _ADMIN_SESSION_TTL
    create_admin_session(token, expires_at)
    purge_expired_admin_sessions()

    _logger.info("ADMIN_LOGIN_SUCCESS username=%s", creds.username)
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


def _enrich_with_ttl(session: dict, ttl_hours: int) -> dict:
    """Add age_hours and hours_until_purge to a voice session row dict."""
    created_at = session.get("created_at")
    if isinstance(created_at, datetime):
        now = datetime.now(timezone.utc) if created_at.tzinfo else datetime.utcnow()
        age_h = (now - created_at).total_seconds() / 3600
    else:
        age_h = 0.0
    return {
        **session,
        "created_at": created_at.isoformat() if isinstance(created_at, datetime) else created_at,
        "age_hours": round(age_h, 2),
        "hours_until_purge": round(max(0.0, ttl_hours - age_h), 2),
        "effective_ttl_hours": ttl_hours,
    }


def _build_org_ttl_map() -> dict:
    """
    Return a dict mapping org_id → effective TTL hours.
    Orgs with a null voice_session_ttl_hours fall back to _VOICE_SESSION_TTL_HOURS.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT org_id, voice_session_ttl_hours FROM orgs")
        return {
            r["org_id"]: (r["voice_session_ttl_hours"] or _VOICE_SESSION_TTL_HOURS)
            for r in cur.fetchall()
        }
    finally:
        conn.close()


@app.get("/admin/voice/sessions", tags=["Admin"])
async def admin_voice_sessions(
    org_id: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    escalated_only: bool = Query(default=False),
    undisclosed_only: bool = Query(default=False),
    _token: str = Depends(require_admin_session),
):
    """
    List voice sessions with policy state and TTL metadata.

    - Filter by org_id, escalated=True, or disclosure_confirmed=False.
    - Each row includes age_hours and hours_until_purge so the UI can
      surface sessions that are about to be cleaned up.
    - hours_until_purge honours the per-org TTL (voice_session_ttl_hours on the
      org row), falling back to the server default when not set.
    - Results are ordered oldest-first (nearest TTL expiry first), capped at *limit* (max 500).
    """
    sessions = list_voice_sessions(
        org_id=org_id or None,
        limit=limit,
        escalated_only=escalated_only,
        undisclosed_only=undisclosed_only,
        oldest_first=True,  # ensures LIMIT captures the sessions most at risk of purge
    )
    org_ttl_map = _build_org_ttl_map()
    enriched = [
        _enrich_with_ttl(s, org_ttl_map.get(s["org_id"], _VOICE_SESSION_TTL_HOURS))
        for s in sessions
    ]
    escalated_count = sum(1 for s in enriched if s.get("escalated"))
    return {
        "sessions": enriched,
        "total": len(enriched),
        "escalated_count": escalated_count,
        "filter_org_id": org_id or None,
        "ttl_hours": _VOICE_SESSION_TTL_HOURS,
    }


@app.post("/admin/voice/sessions/{session_id}/extend", tags=["Admin"])
async def admin_extend_voice_session(
    session_id: str,
    _token: str = Depends(require_admin_session),
):
    """
    Reset a voice session's created_at to NOW(), giving it a fresh TTL window.

    Useful when an escalated session needs more time before auto-purge.
    Returns the updated session row with recalculated TTL fields.
    """
    found = extend_voice_session(session_id)
    if not found:
        raise HTTPException(status_code=404, detail=f"Voice session '{session_id}' not found.")
    # Re-fetch the single updated row for accurate timestamps
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT session_id, org_id, disclosure_confirmed, escalated, created_at, provider "
                "FROM voice_sessions WHERE session_id = %s",
                (session_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail=f"Voice session '{session_id}' not found after extend.")
    org_ttl_map = _build_org_ttl_map()
    row_dict = dict(row)
    effective_ttl = org_ttl_map.get(row_dict["org_id"], _VOICE_SESSION_TTL_HOURS)
    return _enrich_with_ttl(row_dict, effective_ttl)


@app.delete("/admin/voice/sessions/{session_id}", tags=["Admin"])
async def admin_delete_voice_session(
    session_id: str,
    _token: str = Depends(require_admin_session),
):
    """
    Force-delete a voice session row.

    Use when a session is stale or was created in error and should not wait
    for the scheduled TTL purge.  This is permanent and cannot be undone.
    """
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM voice_sessions WHERE session_id = %s",
                (session_id,),
            )
            deleted = cur.rowcount
    finally:
        conn.close()
    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"Voice session '{session_id}' not found.")
    return {"deleted": True, "session_id": session_id}


_VALID_TTL_VALUES = {4, 24, 72, 168}  # 4h, 24h, 72h, 7 days


@app.patch("/admin/orgs/{org_id}/session-retention", tags=["Admin"])
async def admin_set_org_session_retention(
    org_id: str,
    body: OrgSessionRetentionBody,
    _token: str = Depends(require_admin_session),
):
    """
    Set the per-org voice session retention window (TTL in hours).

    Allowed values: 4, 24, 72, 168 (7 days), or null to revert to the
    server-wide default (VOICE_SESSION_TTL_HOURS env var, default 24h).

    The new TTL is honoured by the next scheduled purge_old_sessions() run
    and by hours_until_purge calculations in the voice sessions list.
    """
    org = get_org(org_id)
    if not org:
        raise HTTPException(status_code=404, detail=f"Org '{org_id}' not found")
    hours = body.voice_session_ttl_hours
    if hours is not None and hours not in _VALID_TTL_VALUES:
        raise HTTPException(
            status_code=422,
            detail=f"voice_session_ttl_hours must be one of {sorted(_VALID_TTL_VALUES)} or null",
        )
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE orgs SET voice_session_ttl_hours = %s WHERE org_id = %s",
                (hours, org_id),
            )
    finally:
        conn.close()
    _logger.info("ADMIN_SET_RETENTION org_id=%s voice_session_ttl_hours=%s", org_id, hours)
    return {
        "org_id": org_id,
        "voice_session_ttl_hours": hours,
        "effective_ttl_hours": hours if hours is not None else _VOICE_SESSION_TTL_HOURS,
        "server_default_hours": _VOICE_SESSION_TTL_HOURS,
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
