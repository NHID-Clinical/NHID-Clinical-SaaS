"""
NHID-Clinical SaaS — Stripe billing integration.
Handles checkout session creation, webhook processing, and subscription-to-plan mapping.
Does NOT touch NHID core.

Uses stripe 15.x StripeClient v1 namespace:
    client.v1.prices.list({"active": True})
    client.v1.customers.create({"name": ..., "metadata": ...})
    client.v1.checkout.sessions.create({...})
    client.v1.subscriptions.retrieve(id)
"""
import os
import json
import sqlite3
import stripe
from typing import Optional, Dict, Any

from saas_layer.stripe_client import get_stripe_client, get_secret_key

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "saas.db")

PLAN_METADATA_KEY = "nhid_plan"

PLAN_SLUGS = {
    "l1": "NHID L1",
    "l2": "NHID L2",
    "l3": "NHID L3",
}

FREE_DAILY_LIMIT = 100


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def migrate_billing_columns() -> None:
    """Add Stripe columns to orgs table if they don't exist yet (idempotent)."""
    conn = _get_conn()
    with conn:
        existing = {
            row[1]
            for row in conn.execute("PRAGMA table_info(orgs)").fetchall()
        }
        if "stripe_customer_id" not in existing:
            conn.execute("ALTER TABLE orgs ADD COLUMN stripe_customer_id TEXT")
        if "stripe_subscription_id" not in existing:
            conn.execute("ALTER TABLE orgs ADD COLUMN stripe_subscription_id TEXT")
        if "status" not in existing:
            conn.execute(
                "ALTER TABLE orgs ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"
            )
    conn.close()


def _stripe_metadata(obj: Any) -> Dict[str, str]:
    """Convert a Stripe StripeObject metadata field to a plain dict safely."""
    try:
        return obj.metadata.to_dict()
    except Exception:
        return {}


def get_prices() -> list[Dict[str, Any]]:
    """List active NHID prices from Stripe (those with nhid_plan metadata)."""
    client = get_stripe_client()
    prices = client.v1.prices.list({"active": True, "expand": ["data.product"]})
    result = []
    for price in prices.data:
        product = price.product
        if isinstance(product, str):
            continue
        meta = _stripe_metadata(product)
        plan = meta.get(PLAN_METADATA_KEY)
        if not plan:
            continue
        result.append({
            "price_id": price.id,
            "plan": plan,
            "name": product.name,
            "amount_cents": price.unit_amount,
            "currency": price.currency,
            "interval": price.recurring.interval if price.recurring else None,
        })
    return result


def create_checkout_session(
    org_id: str,
    org_name: str,
    api_key: str,
    plan: str,
    success_url: str,
    cancel_url: str,
) -> str:
    """Create a Stripe Checkout session for the given plan. Returns the checkout URL."""
    client = get_stripe_client()

    prices = get_prices()
    matching = [p for p in prices if p["plan"] == plan]
    if not matching:
        raise ValueError(
            f"No Stripe price found for plan '{plan}'. Run seed_products.py first."
        )
    price_id = matching[0]["price_id"]

    conn = _get_conn()
    row = conn.execute(
        "SELECT stripe_customer_id FROM orgs WHERE org_id = ?", (org_id,)
    ).fetchone()
    conn.close()
    existing_customer_id = row["stripe_customer_id"] if row else None

    if existing_customer_id:
        customer_id = existing_customer_id
    else:
        customer = client.v1.customers.create({
            "name": org_name,
            "metadata": {"nhid_org_id": org_id, "nhid_api_key": api_key},
        })
        customer_id = customer.id
        _update_org_stripe(org_id, stripe_customer_id=customer_id)

    session = client.v1.checkout.sessions.create({
        "customer": customer_id,
        "payment_method_types": ["card"],
        "line_items": [{"price": price_id, "quantity": 1}],
        "mode": "subscription",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": {"nhid_org_id": org_id, "nhid_plan": plan},
        "subscription_data": {
            "metadata": {"nhid_org_id": org_id, "nhid_plan": plan}
        },
    })
    return session.url


def handle_webhook(payload: bytes, sig_header: str) -> Dict[str, Any]:
    """
    Verify and process a Stripe webhook. Returns {"handled": True, "event_type": ...}.
    Raises stripe.error.SignatureVerificationError on bad signature.
    """
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

    if webhook_secret:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
        event_type = event["type"]
        data_object = event["data"]["object"]
    else:
        import warnings
        warnings.warn(
            "STRIPE_WEBHOOK_SECRET not set — skipping signature verification (dev only).",
            stacklevel=2,
        )
        parsed = json.loads(payload)
        event_type = parsed.get("type", "")
        data_object = parsed.get("data", {}).get("object", {})

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(data_object)
    elif event_type == "invoice.paid":
        _handle_invoice_paid(data_object)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(data_object)
    elif event_type == "customer.subscription.updated":
        _handle_subscription_updated(data_object)

    return {"handled": True, "event_type": event_type}


# ── Private webhook handlers ───────────────────────────────────────────────────

def _handle_checkout_completed(session: Dict) -> None:
    org_id = session.get("metadata", {}).get("nhid_org_id")
    plan = session.get("metadata", {}).get("nhid_plan")
    subscription_id = session.get("subscription")
    customer_id = session.get("customer")
    if not org_id:
        return
    _update_org_stripe(
        org_id,
        stripe_customer_id=customer_id,
        stripe_subscription_id=subscription_id,
        plan=plan,
        status="active",
    )


def _handle_invoice_paid(invoice: Dict) -> None:
    subscription_id = invoice.get("subscription")
    if not subscription_id:
        return
    client = get_stripe_client()
    try:
        sub = client.v1.subscriptions.retrieve(subscription_id)
        meta = _stripe_metadata(sub)
        org_id = meta.get("nhid_org_id")
        plan = meta.get("nhid_plan")
        if org_id:
            _update_org_stripe(
                org_id,
                stripe_subscription_id=subscription_id,
                status="active",
                plan=plan,
            )
    except Exception:
        pass


def _handle_subscription_deleted(subscription: Dict) -> None:
    subscription_id = subscription.get("id")
    org_id = subscription.get("metadata", {}).get("nhid_org_id")
    if org_id:
        _update_org_stripe(org_id, status="canceled", plan="free")
    elif subscription_id:
        conn = _get_conn()
        row = conn.execute(
            "SELECT org_id FROM orgs WHERE stripe_subscription_id = ?",
            (subscription_id,),
        ).fetchone()
        conn.close()
        if row:
            _update_org_stripe(row["org_id"], status="canceled", plan="free")


def _handle_subscription_updated(subscription: Dict) -> None:
    org_id = subscription.get("metadata", {}).get("nhid_org_id")
    status_map = {
        "active": "active",
        "past_due": "past_due",
        "canceled": "canceled",
        "incomplete": "past_due",
        "incomplete_expired": "canceled",
        "trialing": "active",
        "unpaid": "past_due",
    }
    stripe_status = subscription.get("status", "")
    status = status_map.get(stripe_status, "past_due")
    if org_id:
        _update_org_stripe(org_id, status=status)


# ── DB helpers ────────────────────────────────────────────────────────────────

def _update_org_stripe(
    org_id: str,
    *,
    stripe_customer_id: Optional[str] = None,
    stripe_subscription_id: Optional[str] = None,
    plan: Optional[str] = None,
    status: Optional[str] = None,
) -> None:
    conn = _get_conn()
    sets, vals = [], []
    if stripe_customer_id is not None:
        sets.append("stripe_customer_id = ?")
        vals.append(stripe_customer_id)
    if stripe_subscription_id is not None:
        sets.append("stripe_subscription_id = ?")
        vals.append(stripe_subscription_id)
    if plan is not None:
        sets.append("plan = ?")
        vals.append(plan)
    if status is not None:
        sets.append("status = ?")
        vals.append(status)
    if not sets:
        conn.close()
        return
    vals.append(org_id)
    with conn:
        conn.execute(f"UPDATE orgs SET {', '.join(sets)} WHERE org_id = ?", vals)
    conn.close()


def check_subscription_gate(org: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Returns None if org is allowed through. Returns a 402 error dict if blocked.
    Free orgs are always allowed (subject to usage limits in billing.py).
    Paid orgs must have status=active.
    """
    plan = org.get("plan", "free")
    status = org.get("status", "active")
    if plan == "free":
        return None
    if status != "active":
        return {
            "status_code": 402,
            "detail": (
                f"Subscription inactive (status={status}). "
                "Please update your payment method or resubscribe."
            ),
        }
    return None
