---
name: Stripe Python SDK v15 quirks
description: Gotchas when using stripe-python v15.x StripeClient vs older module-level API.
---

# Stripe Python SDK v15.x — StripeClient API Quirks

## Rules

1. **Class name**: `stripe.StripeClient(secret_key)` — NOT `stripe.Stripe` (doesn't exist in v15).

2. **Namespace**: Use `client.v1.*` for all resource access to avoid deprecation warnings:
   - `client.v1.prices.list({...})`
   - `client.v1.customers.create({...})`
   - `client.v1.checkout.sessions.create({...})`
   - `client.v1.subscriptions.retrieve(id)`
   - `client.v1.products.list({...})`
   - `client.v1.products.create({...})`
   - Old `client.checkout`, `client.prices` etc. still work but are deprecated.

3. **Params are dicts, not keyword args**: `client.v1.checkout.sessions.create({"customer": ..., "mode": "subscription", ...})` — not `create(customer=..., mode=...)`.

4. **StripeObject.metadata** is NOT a plain dict. It is a `StripeObject`:
   - `dict(obj.metadata)` → FAILS (KeyError: 0 — iterates as list)
   - `obj.metadata.get("key")` → FAILS (AttributeError: get — StripeObject has no .get())
   - **CORRECT**: `obj.metadata.to_dict().get("key")` or `obj.metadata["key"]` with try/except KeyError

5. **Webhook handling**: `stripe.Webhook.construct_event(payload, sig_header, secret)` — module-level, still works in v15. Do NOT use `stripe.Event.construct_from(...)` for dev/no-sig fallback — it may not exist. Parse raw JSON with `json.loads(payload)` instead.

6. **Always get a fresh client**: Call `get_stripe_client()` fresh each time — don't cache `StripeClient` instances across requests.

**Why:** stripe-python 15.x introduced the `StripeClient` class with a `v1` sub-namespace and changed the API contract significantly from the module-level approach used in earlier versions. `StripeObject` uses `__getattr__` to proxy dict key lookups, so calling `.get()` fails because it looks for a key named "get" in the data dict.

**How to apply:** Any time metadata is accessed on a Stripe SDK object (Product, Subscription, etc.), use `.to_dict()` to convert the metadata StripeObject to a plain Python dict first.
