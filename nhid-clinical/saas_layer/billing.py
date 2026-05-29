"""
NHID-Clinical SaaS — Plan definitions and rate-limit enforcement.
L1/L2/L3 are Stripe-backed. free is the default unauthenticated tier.
"""
from typing import Dict, Any, Optional

# Canonical plan catalogue — Stripe is the billing source of truth,
# but these caps drive the gateway's request gating.
PLANS: Dict[str, Dict[str, Any]] = {
    "free": {
        "name": "Free",
        "daily_limit": 100,
        "monthly_limit": 1_000,
        "rate_limit_rpm": 10,
        "features": ["audit_trail", "basic_proof", "simulated_voice"],
        "price_usd": 0,
        "stripe_plan": False,
    },
    "l1": {
        "name": "NHID L1",
        "daily_limit": 10_000,
        "monthly_limit": 200_000,
        "rate_limit_rpm": 100,
        "features": ["audit_trail", "basic_proof", "replay", "policy_engine", "api_access", "simulated_voice"],
        "price_usd": 99,
        "stripe_plan": True,
    },
    "l2": {
        "name": "NHID L2",
        "daily_limit": 100_000,
        "monthly_limit": 2_000_000,
        "rate_limit_rpm": 500,
        "features": [
            "audit_trail", "basic_proof", "replay", "policy_engine",
            "api_access", "sso_ready", "priority_support", "voice_webhook",
        ],
        "price_usd": 499,
        "stripe_plan": True,
    },
    "l3": {
        "name": "NHID L3",
        "daily_limit": None,          # unlimited
        "monthly_limit": None,
        "rate_limit_rpm": 2_000,
        "features": [
            "audit_trail", "basic_proof", "replay", "policy_engine",
            "api_access", "sso", "enterprise_sla", "dedicated_support", "voice_webhook",
        ],
        "price_usd": 2_500,
        "stripe_plan": True,
    },
}

# Plans that include live voice webhook integrations (Retell, Vapi, Twilio, etc.)
_VOICE_WEBHOOK_PLANS: frozenset = frozenset({"l2", "l3"})

# Keep legacy aliases so existing orgs created with old plan names still work
_ALIAS: Dict[str, str] = {
    "pro": "l1",
    "enterprise": "l3",
}


def get_plan(plan_name: str) -> Dict[str, Any]:
    canonical = _ALIAS.get(plan_name, plan_name)
    return PLANS.get(canonical, PLANS["free"])


def check_rate_limit(org_id: str, plan_name: str, today_count: int) -> Dict[str, Any]:
    plan = get_plan(plan_name)
    limit = plan["daily_limit"]
    if limit is None:
        return {"allowed": True, "remaining": None, "limit": None}
    remaining = max(0, limit - today_count)
    return {
        "allowed": today_count < limit,
        "remaining": remaining,
        "limit": limit,
        "plan": plan_name,
    }


def plan_allows_voice_webhook(plan_name: str) -> bool:
    """Return True if the plan includes live voice webhook integrations (L2+)."""
    canonical = _ALIAS.get(plan_name, plan_name)
    return canonical in _VOICE_WEBHOOK_PLANS


def get_upgrade_path(current_plan: str) -> Dict[str, Any]:
    order = ["free", "l1", "l2", "l3"]
    canonical = _ALIAS.get(current_plan, current_plan)
    try:
        idx = order.index(canonical)
    except ValueError:
        idx = 0
    if idx >= len(order) - 1:
        return {"upgrade_available": False}
    next_plan = order[idx + 1]
    return {
        "upgrade_available": True,
        "next_plan": next_plan,
        "next_plan_details": PLANS[next_plan],
        "stripe_checkout_url": None,   # filled in by the /billing/checkout endpoint
    }
