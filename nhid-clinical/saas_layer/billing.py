"""
NHID-Clinical SaaS — Billing stubs.
Stripe-ready structure. No actual Stripe integration yet.
"""
from typing import Dict, Any

PLANS: Dict[str, Dict[str, Any]] = {
    "free": {
        "name": "Free",
        "daily_limit": 100,
        "monthly_limit": 1000,
        "rate_limit_rpm": 10,
        "features": ["audit_trail", "basic_proof"],
        "price_usd": 0,
    },
    "pro": {
        "name": "Pro",
        "daily_limit": 10_000,
        "monthly_limit": 200_000,
        "rate_limit_rpm": 100,
        "features": ["audit_trail", "basic_proof", "replay", "policy_engine", "api_access"],
        "price_usd": 49,
    },
    "enterprise": {
        "name": "Enterprise",
        "daily_limit": None,
        "monthly_limit": None,
        "rate_limit_rpm": 1000,
        "features": ["audit_trail", "basic_proof", "replay", "policy_engine", "api_access", "sso", "sla"],
        "price_usd": None,
    },
}


def get_plan(plan_name: str) -> Dict[str, Any]:
    return PLANS.get(plan_name, PLANS["free"])


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


def get_upgrade_path(current_plan: str) -> Dict[str, Any]:
    """Returns the next plan tier — Stripe checkout hook point."""
    upgrade_map = {"free": "pro", "pro": "enterprise", "enterprise": None}
    next_plan = upgrade_map.get(current_plan)
    if next_plan is None:
        return {"upgrade_available": False}
    return {
        "upgrade_available": True,
        "next_plan": next_plan,
        "next_plan_details": PLANS[next_plan],
        "stripe_checkout_url": None,
    }
