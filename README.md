# NHID-Clinical SaaS

**A healthcare voice-AI governance monitoring and evidence platform.**

It monitors healthcare voice-AI interactions an organization *already receives*
against the [NHID-Clinical](https://github.com/NHID-Clinical/NHID-Clinical)
controls, and gives it the evidence and workflow to investigate what happened.
Nothing in production changes, no provider has to issue a credential, and no
vendor has to integrate.

> **BUSINESS HYPOTHESIS — NEEDS CUSTOMER VALIDATION.**
> There are **zero deployments, zero pilots and zero validated
> willingness-to-pay**. The buyer, the workflow and the pricing are hypotheses.
> Nothing in this repository, the application or its UI may be presented to
> anyone as evidence of demand.

## The loop

```
Ingest → Normalize → Evaluate → Monitor → Investigate → Review → Report
```

| Step | Where |
|---|---|
| Ingest | `POST /saas/monitor/ingest` — transcripts or event exports |
| Normalize | `saas_layer/normalization.py` — one canonical shape; `generic`, `twilio`, `vapi` |
| Evaluate | `saas_layer/monitoring.py` — **IDG-01, PDX-01, EIT-01, ATR-01** |
| Monitor | `GET /saas/monitor/metrics`, the Overview screen |
| Investigate | Interaction detail: transcript, per-control result, the reason for each |
| Review | Findings queue: open → under review → resolved |
| Report | `GET /saas/monitor/assessments/{id}/report` |

A control returns one of four results: `pass`, `exception`, `unknown` or
`not_assessable`. `unknown` exists because forcing a binary verdict onto an
interaction that cannot support one is how a governance record becomes fiction —
if a human asks for a person and the recording ends, completion was neither
observed nor refused. See [`docs/MONITORING_PRODUCT.md`](docs/MONITORING_PRODUCT.md)
for the full product description, the free-vs-commercial boundary, local setup
and the demo path.

**DBC-01 is not part of the monitoring product.** It is evaluated by the older
real-time voice-webhook path (`saas_layer/voice_policy.py`), not by
`monitoring.py`.

## Evidence and limitations

The same limits that bound the framework bound this product, because it runs the
framework's controls over the same kind of evidence.

- **It evaluates transcript and event evidence.** A disclosure that was spoken
  but mis-transcribed reads as a missing disclosure. An escalation request that
  was mis-transcribed produces **no finding at all**, and the record then
  attests to a compliant interaction — the one failure mode the evidence cannot
  reveal on its own.
- **Transcription accuracy is not established here.** The product performs no
  speech recognition and does not independently establish ASR accuracy. Every
  interaction carries an attestation of `measured`, `attested` or `unattested`,
  and an unattested one raises a finding rather than being quietly treated as
  fine. Assuring transcription quality, including across speaker groups, is the
  deploying organization's job.
- **Population-level fairness stratification is not implemented.** `language`
  and `interpreter_present` are recorded so an organization can run its own
  reporting; nothing here stratifies.
- **No score.** No composite, no tier, no grade. The former Call Authorization
  Score, its "Verified Trust" / "Conditional Trust" tiers and its badges are
  withdrawn, and nothing reintroduces them under another name.
- **Not a certification**, not a compliance badge, not a clinical safety
  validation system, and not a universal measure of AI safety. Findings are
  *governance exceptions*, not regulatory violations. Standards work is
  **mapped, not certified**.
- **Impersonation Latency** measures the elapsed time between interaction start
  and the point at which a non-human actor discloses its non-human identity to
  the human recipient. It measures disclosure timing. It does *not* determine
  that impersonation occurred, determine intent, detect an impersonator, prevent
  impersonation, establish authentication, or establish authorization.

All demonstration records are flagged `is_synthetic` in the database, in the UI
and in the report. They are not customer data, not observed traffic and not a
pilot.

The dashboard is published to GitHub Pages by `.github/workflows/pages.yml`.
What it shows is a **recorded demonstration**: with no backend reachable, the
Governance Ops screens replay output the real evaluator produced over ten
authored interactions, and every screen says so. Publishing that page is not a
deployment in the sense the notice above disclaims — there is still no
organization running this against traffic of its own. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Related repositories

| Repository | What it is |
|---|---|
| **[NHID-Clinical](https://github.com/NHID-Clinical/NHID-Clinical)** | The open framework: controls, the deterministic engine, the conformance suite, the event schema, the shadow-evaluation method. Free, and the governance verdict is never paywalled. |
| **NHID-Clinical-SaaS** (this one) | The commercial product above. What is paid for is the cost of *running a service* — hosted ingestion at volume, cross-vendor normalization, retained evidence with access control, the findings workflow, dashboards and reporting — never a capability withheld from the framework to force a sale. |
| **[Simulator](https://github.com/NHID-Clinical/Simulator)** | A teaching site that walks through the controls interactively. Not the framework, not this product, not a certification. |

`nhid-clinical/` in this repository is the SaaS backend. It vendors a snapshot
of the framework engine (`nhid-clinical/src/`) alongside `saas_layer/`; the
framework repository is the source of truth for the controls themselves.

## Current status

NHID-Clinical SaaS is an active development repository.

Implemented areas include:

- the monitoring and evidence product above — assessments, ingestion,
  normalization, per-control evaluation, findings workflow, reviewer time
  capture, metrics and reporting (`saas_layer/monitoring.py`,
  `saas_layer/normalization.py`, the `/saas/monitor/*` endpoints, and the
  Governance Ops screens in `artifacts/nhid-saas`)
- organization and API-key management, with keys **hashed at rest**
  (`saas_layer/api_keys.py`): the database stores a SHA-256 of the key and a
  short non-secret prefix, never the key, so a dump or a logged row yields
  nothing replayable. A lost key is replaced via `POST /saas/orgs/rotate-key`
  rather than re-read
- Stripe billing integration
- voice webhook ingestion (Retell, Vapi, Twilio, generic)
- transcript disclosure-policy evaluation
- audit-chain generation and verification (HMAC-SHA256, constant-time)
- provider-signed agent authorization (Ed25519 delegation with NPI binding,
  agent co-signature, call-SID replay binding, and durable revocation)
- internal operations tooling

Agent authorization is integrated into the runtime path: an agent may present a
provider-signed delegation, the gateway verifies it against a public key the
organization registered for the NPI being claimed, and the verdict is enforced
by the `REQUIRE_AGENT_AUTHORIZATION` policy rule on every turn.

It ships **permissive by default** (`required: false`): a call presenting no
credential is allowed through, while a credential that fails verification is
denied. Refusing unauthenticated agents outright is a per-organization opt-in,
because enabling it stops calls. See `docs/AGENT_AUTHORIZATION.md` for what a
verified passport does and does not prove, and for the operator runbook.

Before commercial deployment, the project requires:

- credential hardening
- CI enforcement
- backend and frontend consolidation
- webhook **signature** verification — provider-signed payloads from Vapi,
  Retell and Twilio are not yet verified. (API-key *authentication* on those
  endpoints is done: `saas_layer/webhook_auth.py` requires the
  `X-NHID-API-Key` header and only tolerates `?api_key=` for existing
  registrations, with a deprecation warning.)
- tenant-isolation testing
- NPPES validation of registered NPIs (format is checked; the number is not
  looked up)
- delegation-chain support through the gateway (implemented in the framework,
  not yet exposed)
- PHI handling and retention controls
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
| `docs/DEPLOYMENT.md` | How the dashboard is published to GitHub Pages, why the published build shows a recorded demonstration, and why it cannot show live data |
| `docs/CONSOLIDATION_CANDIDATES.md` | Packages proposed for retirement — **nothing deleted yet** |
| `docs/POLICY_ENGINE_RECONCILIATION.md` | The Python and TypeScript control implementations compared |
| `docs/MONITORING_PRODUCT.md` | **The commercial product**: the loop, the four result states, the ASR dependency, the free-vs-commercial boundary, local setup, the demo path |
| `docs/AGENT_AUTHORIZATION.md` | What a verified passport does and does not prove, and the operator runbook |
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
