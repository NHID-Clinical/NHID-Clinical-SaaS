"""
NHID-Clinical SaaS — Stripe client.
Fetches credentials from the Replit connectors API (same pattern as the
Node.js blueprint snippet, ported to Python).
Never cache the returned client — always call get_stripe_client() fresh.
"""
import os
import stripe
from typing import Tuple


def _get_credentials() -> Tuple[str, str]:
    """Fetch publishable + secret keys from the Replit connectors proxy."""
    hostname = os.environ.get("REPLIT_CONNECTORS_HOSTNAME")
    repl_identity = os.environ.get("REPL_IDENTITY")
    web_repl_renewal = os.environ.get("WEB_REPL_RENEWAL")

    if repl_identity:
        token = f"repl {repl_identity}"
    elif web_repl_renewal:
        token = f"depl {web_repl_renewal}"
    else:
        token = None

    # Fallback: allow direct env-var override for local dev / tests
    if not hostname or not token:
        secret = os.environ.get("STRIPE_SECRET_KEY", "")
        publishable = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
        if not secret:
            raise RuntimeError(
                "Stripe credentials not available: REPLIT_CONNECTORS_HOSTNAME/"
                "REPL_IDENTITY not set and STRIPE_SECRET_KEY env var not provided."
            )
        return publishable, secret

    import urllib.request, urllib.parse, json as _json

    is_production = os.environ.get("REPLIT_DEPLOYMENT") == "1"
    environment = "production" if is_production else "development"

    params = urllib.parse.urlencode({
        "include_secrets": "true",
        "connector_names": "stripe",
        "environment": environment,
    })
    url = f"https://{hostname}/api/v2/connection?{params}"

    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "X-Replit-Token": token},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = _json.loads(resp.read())

    items = data.get("items", [])
    if not items:
        raise RuntimeError(f"Stripe {environment} connection not found in Replit connectors response.")

    settings = items[0].get("settings", {})
    secret = settings.get("secret", "")
    publishable = settings.get("publishable", "")
    if not secret:
        raise RuntimeError(f"Stripe secret key missing from connectors response.")

    return publishable, secret


def get_stripe_client() -> stripe.StripeClient:
    """Return a fresh authenticated Stripe client. Do NOT cache."""
    _, secret_key = _get_credentials()
    client = stripe.StripeClient(secret_key)
    return client


def get_publishable_key() -> str:
    publishable, _ = _get_credentials()
    return publishable


def get_secret_key() -> str:
    _, secret = _get_credentials()
    return secret
