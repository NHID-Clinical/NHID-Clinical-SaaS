"""
NHID-Clinical SaaS — Stripe product seeder.
Run once to create the three NHID subscription tiers in Stripe.
Safe to run multiple times (idempotent — skips existing products).

Uses stripe 15.x StripeClient v1 namespace.

Usage:
    cd nhid-clinical
    python -m saas_layer.seed_products
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from saas_layer.stripe_client import get_stripe_client

PRODUCTS = [
    {
        "slug": "l1",
        "name": "NHID L1",
        "description": "NHID Clinical SaaS — L1 tier. 10,000 API calls/day, audit trail, basic proof.",
        "price_cents": 9900,
    },
    {
        "slug": "l2",
        "name": "NHID L2",
        "description": "NHID Clinical SaaS — L2 tier. 100,000 API calls/day, full policy engine, replay, SSO-ready.",
        "price_cents": 49900,
    },
    {
        "slug": "l3",
        "name": "NHID L3",
        "description": "NHID Clinical SaaS — L3 tier. Unlimited API calls, enterprise SLA, priority support.",
        "price_cents": 250000,
    },
]

PLAN_METADATA_KEY = "nhid_plan"


def seed() -> None:
    client = get_stripe_client()
    print("Fetching existing products from Stripe...")

    existing = client.v1.products.list({"active": True})
    existing_slugs = {
        p.metadata.to_dict().get(PLAN_METADATA_KEY)
        for p in existing.data
        if p.metadata.to_dict().get(PLAN_METADATA_KEY)
    }

    for product_def in PRODUCTS:
        slug = product_def["slug"]
        if slug in existing_slugs:
            print(f"  [skip] {product_def['name']} already exists (slug={slug})")
            continue

        print(f"  [create] {product_def['name']} @ ${product_def['price_cents']/100:.2f}/mo ...")
        product = client.v1.products.create({
            "name": product_def["name"],
            "description": product_def["description"],
            "metadata": {PLAN_METADATA_KEY: slug},
        })
        price = client.v1.prices.create({
            "product": product.id,
            "unit_amount": product_def["price_cents"],
            "currency": "usd",
            "recurring": {"interval": "month"},
        })
        print(f"    product_id={product.id}  price_id={price.id}")

    print("Done.")


if __name__ == "__main__":
    seed()
