# NHID-Clinical SaaS

## Current status

NHID-Clinical SaaS is an active development repository.

Implemented areas include:

- organization and API-key management
- Stripe billing integration
- voice webhook ingestion (Retell, Vapi, Twilio, generic)
- transcript disclosure-policy evaluation
- audit-chain generation and verification (HMAC-SHA256, constant-time)
- internal operations tooling

The provider-signed agent authorization primitive exists in the NHID-Clinical
core (`nhid-clinical/src/agent_identity.py` — Ed25519 delegation with NPI
binding, agent co-signature and call-SID nonce) but is **not yet integrated**
into the SaaS authorization path. The gateway evaluates whether an AI caller
disclosed itself and behaved correctly; it does not yet verify that the caller
is authorized to represent the provider organization it claims.

Before commercial deployment, the project requires:

- credential hardening
- CI enforcement
- backend and frontend consolidation
- webhook signature verification
- API-key hashing at rest
- tenant-isolation testing
- provider/NPI authorization integration
- revocation enforcement
- PHI handling and retention controls
- end-to-end authorization tests
- deployment validation
- threat-model validation

**This repository should not currently be represented as production-ready or
HIPAA-compliant.**

## Architecture terminology

- `nhid-clinical/saas_layer/gateway.py` is the **current SaaS control-plane
  backend**.
- `artifacts/nhid-saas` is the **customer-facing frontend**.
- `artifacts/api-server` is a **deprecated authentication scaffold**. It
  contains no product endpoints and is not the API.
- `artifacts/nhid-clinical-operations` is **internal operations and testing
  tooling**. It is not customer-facing and must not become a second backend.
- `artifacts/nhid-audit-core` is a **superseded standalone audit service**,
  retained pending removal. `saas_layer/audit.py` is the audit implementation
  in use.

## Further documentation

| Document | Contents |
|---|---|
| `docs/DEPLOYMENT.md` | Deployment topology, the Vercel root-directory problem, the unfilled backend domain |
| `docs/CONSOLIDATION_CANDIDATES.md` | Packages proposed for retirement — **nothing deleted yet** |
| `docs/POLICY_ENGINE_RECONCILIATION.md` | The Python and TypeScript control implementations compared |
| `docs/trustlayer-module-architecture.md` | Module map from the public platform pages to code |

## Running the tests

Python (requires a live PostgreSQL — the gateway reads `DATABASE_URL` at import
time, so the suite cannot collect without one):

```bash
cd nhid-clinical
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nhid_dev
export HMAC_SECRET=<any-value-for-local-use>
export ADMIN_PASS=<any-value-for-local-use>
python scripts/check_startup.py     # required config + module imports
python -m pytest tests/ -q
```

TypeScript:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm -C artifacts/nhid-clinical-operations run test
PORT=3000 BASE_PATH=/ pnpm -C artifacts/nhid-saas run build
```

Both are run on every pull request by `.github/workflows/ci.yml`.

## Required configuration

The gateway refuses to start unless these are set. There are no defaults.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `HMAC_SECRET` | Audit-chain signing secret |
| `ADMIN_PASS_HASH` *(preferred)* or `ADMIN_PASS` | Admin credential |
| `STRIPE_WEBHOOK_SECRET` | Required to process Stripe webhooks; without it they are rejected |

Generate an admin password hash with:

```bash
python -c "from saas_layer.admin_auth import hash_password; print(hash_password('...'))"
```

Webhook authentication uses the `X-NHID-API-Key` header. The `?api_key=` query
parameter still works for existing provider registrations but is deprecated —
query strings are captured by access logs and proxies — and will be removed
after the migration window.
