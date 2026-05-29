"""
Seed NHID Stripe products and prices.
Run once: cd nhid-clinical && python seed_stripe_products.py

Idempotent: skips creation if a product with the matching nhid_plan metadata
already exists. Writes price IDs to stripe_price_ids.json for reference and
prints instructions for updating PLAN_CATALOG in stripe_billing.py.
"""
import json
import os
import sys

# Make saas_layer importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from saas_layer.stripe_client import get_stripe_client, get_secret_key

PLANS = [
    {"key": "l1", "name": "NHID L1 — Starter",    "amount_cents": 29900,  "description": "Up to 10k events/day, 100 req/min"},
    {"key": "l2", "name": "NHID L2 — Professional","amount_cents": 79900,  "description": "Up to 100k events/day, 500 req/min"},
    {"key": "l3", "name": "NHID L3 — Enterprise",  "amount_cents": 199900, "description": "Unlimited events, 2000 req/min, SLA"},
]

PLAN_METADATA_KEY = "nhid_plan"
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "stripe_price_ids.json")


def find_existing(client, plan_key: str):
    """Return (product_id, price_id) if already seeded, else (None, None)."""
    products = client.v1.products.list({"limit": 100})
    for product in products.data:
        try:
            meta = product.metadata.to_dict() if hasattr(product.metadata, "to_dict") else dict(product.metadata)
        except Exception:
            meta = {}
        if meta.get(PLAN_METADATA_KEY) == plan_key:
            prices = client.v1.prices.list({"product": product.id, "active": True, "limit": 10})
            for price in prices.data:
                if price.recurring and price.recurring.interval == "month":
                    return product.id, price.id
    return None, None


def main():
    try:
        secret = get_secret_key()
    except Exception as exc:
        print(f"ERROR: Could not get Stripe secret key: {exc}")
        sys.exit(1)

    mode = "LIVE" if secret.startswith("sk_live_") else "TEST"
    print(f"Using Stripe {mode} mode key: {secret[:12]}…")
    print()

    client = get_stripe_client()
    results = {}

    for plan in PLANS:
        key = plan["key"]
        print(f"[{key.upper()}] Checking for existing product…")

        prod_id, price_id = find_existing(client, key)

        if price_id:
            print(f"  ✓ Already exists — product {prod_id}, price {price_id}")
        else:
            print(f"  Creating product '{plan['name']}'…")
            product = client.v1.products.create(params={
                "name": plan["name"],
                "description": plan["description"],
                "metadata": {PLAN_METADATA_KEY: key},
            })
            prod_id = product.id
            print(f"  Created product {prod_id}")

            print(f"  Creating price ${plan['amount_cents'] / 100:.2f}/month…")
            price = client.v1.prices.create(params={
                "product": prod_id,
                "unit_amount": plan["amount_cents"],
                "currency": "usd",
                "recurring": {"interval": "month"},
            })
            price_id = price.id
            print(f"  Created price {price_id}")

        results[key] = {"product_id": prod_id, "price_id": price_id}
        print()

    with open(OUTPUT_FILE, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Wrote price IDs to {OUTPUT_FILE}")
    print()
    print("─" * 60)
    print("Add these price IDs to PLAN_CATALOG in saas_layer/stripe_billing.py:")
    for key, ids in results.items():
        print(f"  {key.upper()}: stripe_price_id = \"{ids['price_id']}\"")
    print("─" * 60)
    return results


if __name__ == "__main__":
    main()
