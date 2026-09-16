"""Regression tests for Stripe webhook fail-closed behaviour (Phase 0.3).

An unverified Stripe webhook is attacker-controlled input that can grant plan
entitlements (checkout.session.completed, invoice.paid). It must be rejected,
never processed, when the signature cannot be verified.
"""

import json

import pytest

from saas_layer.stripe_billing import (
    StripeWebhookVerificationError,
    handle_webhook,
)

# A forged event that, if processed, would grant a paid plan.
FORGED = json.dumps({
    "id": "evt_forged_0001",
    "type": "invoice.paid",
    "data": {"object": {"metadata": {"nhid_org_id": "victim-org", "nhid_plan": "L3"}}},
}).encode()


def test_missing_secret_rejects_instead_of_processing(monkeypatch):
    """The previous behaviour warned and processed the event anyway."""
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    with pytest.raises(StripeWebhookVerificationError):
        handle_webhook(FORGED, "t=1,v1=whatever")


def test_empty_secret_rejects(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "")
    with pytest.raises(StripeWebhookVerificationError):
        handle_webhook(FORGED, "t=1,v1=whatever")


def test_missing_signature_header_rejects(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")
    with pytest.raises(StripeWebhookVerificationError):
        handle_webhook(FORGED, "")


def test_invalid_signature_rejects(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")
    with pytest.raises(StripeWebhookVerificationError):
        handle_webhook(FORGED, "t=1,v1=0000000000000000000000000000000000000000")


def test_rejection_message_does_not_leak_the_secret(monkeypatch):
    secret = "whsec_super_secret_value"
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)
    with pytest.raises(StripeWebhookVerificationError) as exc:
        handle_webhook(FORGED, "t=1,v1=bad")
    assert secret not in str(exc.value)


def test_valid_signature_is_accepted(monkeypatch):
    """A correctly signed event still verifies — fail-closed must not mean
    fail-always."""
    stripe = pytest.importorskip("stripe")

    import hashlib
    import hmac
    import time

    secret = "whsec_test_secret"
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)

    payload = json.dumps({
        "id": "evt_valid_0001",
        "type": "customer.subscription.updated",
        "data": {"object": {}},
    }).encode()

    ts = int(time.time())
    signed = f"{ts}.".encode() + payload
    sig = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    header = f"t={ts},v1={sig}"

    # Verification must pass. Downstream handling may still fail on a missing
    # database, which is not what this test is asserting.
    try:
        handle_webhook(payload, header)
    except StripeWebhookVerificationError:
        pytest.fail("a validly signed webhook was rejected")
    except Exception:
        pass  # verification succeeded; later processing is out of scope here
