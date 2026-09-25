"""
NHID-Clinical SaaS — Stripe billing integration.
Handles checkout session creation, webhook processing, and subscription-to-plan mapping.
Does NOT touch NHID core. Backed by Replit PostgreSQL.

Uses stripe 15.x StripeClient v1 namespace:
    client.v1.prices.list({"active": True})
    client.v1.customers.create({"name": ..., "metadata": ...})
    client.v1.checkout.sessions.create({...})
    client.v1.subscriptions.retrieve(id)
"""
import logging
import os
import json
import stripe
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from saas_layer.stripe_client import get_stripe_client, get_secret_key
from saas_layer.db import get_conn

_logger = logging.getLogger("nhid.saas.billing")

PLAN_METADATA_KEY = "nhid_plan"

PLAN_SLUGS = {
    "l1": "NHID L1",
    "l2": "NHID L2",
    "l3": "NHID L3",
}

FREE_DAILY_LIMIT = 100


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def migrate_billing_columns() -> None:
    """No-op: column additions are handled by auth.migrate_billing_columns(). Kept for compatibility."""
    pass


# ── Idempotency helpers ────────────────────────────────────────────────────────

def _is_processed(event_id: str) -> bool:
    if not event_id:
        return False
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM processed_events WHERE event_id = %s", (event_id,)
        )
        return cur.fetchone() is not None
    finally:
        conn.close()


def _mark_processed(event_id: str) -> None:
    if not event_id:
        return
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO processed_events (event_id, processed_at) VALUES (%s, %s) "
                "ON CONFLICT (event_id) DO NOTHING",
                (event_id, _now_iso()),
            )
    finally:
        conn.close()


def _stripe_metadata(obj: Any) -> Dict[str, str]:
    try:
        return obj.metadata.to_dict()
    except Exception:
        return {}


def get_prices() -> list:
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
    plan: str,
    success_url: str,
    cancel_url: str,
) -> str:
    client = get_stripe_client()

    prices = get_prices()
    matching = [p for p in prices if p["plan"] == plan]
    if not matching:
        raise ValueError(
            f"No Stripe price found for plan '{plan}'. Run seed_products.py first."
        )
    price_id = matching[0]["price_id"]

    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT stripe_customer_id FROM orgs WHERE org_id = %s", (org_id,)
        )
        row = cur.fetchone()
    finally:
        conn.close()

    existing_customer_id = row["stripe_customer_id"] if row else None

    if existing_customer_id:
        customer_id = existing_customer_id
    else:
        customer = client.v1.customers.create({
            "name": org_name,
            # nhid_api_key was written here and never read back -- every
            # webhook handler reconciles on nhid_org_id. Shipping a live
            # credential into a third party's metadata store for nothing.
            "metadata": {"nhid_org_id": org_id},
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


class StripeWebhookVerificationError(Exception):
    """Raised when a Stripe webhook cannot be cryptographically verified.

    Covers a missing STRIPE_WEBHOOK_SECRET, a missing Stripe-Signature header,
    and a signature that does not validate. All three are treated identically:
    the event is rejected and never processed.
    """


def handle_webhook(payload: bytes, sig_header: str) -> Dict[str, Any]:
    """Verify and process a Stripe webhook.

    Fails closed. Without a verified signature the event is rejected rather
    than processed, because an unverified webhook is attacker-controlled input
    that can grant plan entitlements (checkout.session.completed, invoice.paid).
    """
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

    if not webhook_secret:
        _logger.error(
            "STRIPE_WEBHOOK_REJECTED reason=secret_not_configured — "
            "set STRIPE_WEBHOOK_SECRET to process webhooks"
        )
        raise StripeWebhookVerificationError(
            "Webhook signature verification is not configured."
        )

    if not sig_header:
        _logger.warning("STRIPE_WEBHOOK_REJECTED reason=missing_signature_header")
        raise StripeWebhookVerificationError("Missing Stripe-Signature header.")

    import stripe as _stripe
    try:
        _stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except Exception as exc:
        # Do not echo the underlying message back to the caller; it can vary
        # with the signature contents.
        _logger.warning(
            "STRIPE_WEBHOOK_REJECTED reason=signature_invalid type=%s",
            type(exc).__name__,
        )
        raise StripeWebhookVerificationError("Invalid webhook signature.") from exc

    parsed = json.loads(payload)
    event_id = parsed.get("id", "")
    event_type = parsed.get("type", "")
    data_object = parsed.get("data", {}).get("object", {})

    _logger.info("STRIPE_WEBHOOK_RECEIVED event_type=%s event_id=%s", event_type, event_id)

    if _is_processed(event_id):
        _logger.info("STRIPE_WEBHOOK_DUPLICATE event_id=%s — skipped", event_id)
        return {"handled": True, "event_type": event_type, "idempotent": True}

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(data_object)
    elif event_type == "invoice.paid":
        _handle_invoice_paid(data_object)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(data_object)
    elif event_type == "customer.subscription.updated":
        _handle_subscription_updated(data_object)

    _mark_processed(event_id)
    return {"handled": True, "event_type": event_type}


# ── Private webhook handlers ───────────────────────────────────────────────────

def _handle_checkout_completed(session: Dict) -> None:
    org_id = session.get("metadata", {}).get("nhid_org_id")
    plan = session.get("metadata", {}).get("nhid_plan")
    subscription_id = session["subscription"]
    customer_id = session["customer"]
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
    subscription_id = invoice["subscription"]
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
    subscription_id = subscription["id"]
    org_id = subscription["metadata"]["nhid_org_id"] if subscription.get("metadata") else None
    if org_id:
        _update_org_stripe(org_id, status="canceled", plan="free")
    elif subscription_id:
        conn = get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT org_id FROM orgs WHERE stripe_subscription_id = %s",
                (subscription_id,),
            )
            row = cur.fetchone()
        finally:
            conn.close()
        if row:
            _update_org_stripe(row["org_id"], status="canceled", plan="free")


def _handle_subscription_updated(subscription: Dict) -> None:
    org_id = subscription["metadata"]["nhid_org_id"] if subscription.get("metadata") else None
    status_map = {
        "active": "active",
        "past_due": "past_due",
        "canceled": "canceled",
        "incomplete": "past_due",
        "incomplete_expired": "canceled",
        "trialing": "active",
        "unpaid": "past_due",
    }
    stripe_status = subscription["status"]
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
    sets, vals = [], []
    if stripe_customer_id is not None:
        sets.append("stripe_customer_id = %s")
        vals.append(stripe_customer_id)
    if stripe_subscription_id is not None:
        sets.append("stripe_subscription_id = %s")
        vals.append(stripe_subscription_id)
    if plan is not None:
        sets.append("plan = %s")
        vals.append(plan)
    if status is not None:
        sets.append("status = %s")
        vals.append(status)
    if not sets:
        return
    vals.append(org_id)
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(f"UPDATE orgs SET {', '.join(sets)} WHERE org_id = %s", vals)
    finally:
        conn.close()
    _logger.info(
        "ORG_STATUS_UPDATED org_id=%s status=%s plan=%s",
        org_id, status or "(unchanged)", plan or "(unchanged)",
    )


def check_subscription_gate(org: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    status = org["status"]
    plan = org["plan"]
    org_id = org.get("org_id", "?")

    if status != "active":
        _logger.warning(
            "BILLING_BLOCK_APPLIED org_id=%s plan=%s status=%s",
            org_id, plan, status,
        )
        return {
            "status_code": 402,
            "detail": (
                f"Account inactive (status={status}). "
                "Please update your payment method or contact support."
            ),
        }
    return None
