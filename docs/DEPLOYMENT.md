# Deployment

How the dashboard is published, what it can and cannot show, and what the
backend needs if it is ever deployed.

## The dashboard is published to GitHub Pages

`.github/workflows/pages.yml` builds `artifacts/nhid-saas` and publishes
`dist/public`. That is the deployment path. **Vercel is not used**, and the
`vercel.json` that used to sit in `artifacts/nhid-saas` has been removed rather
than left behind as configuration for a provider this project does not deploy
to.

```
Browser
   │
   │  GET /NHID-Clinical-SaaS/...  → static assets from GitHub Pages
   ▼
GitHub Pages  (artifacts/nhid-saas/dist/public)
   │
   └── no server, no rewrite layer, no backend
```

Two details in the workflow are load-bearing:

**`BASE_PATH`.** `vite.config.ts` requires it and uses it as `base`; `App.tsx`
feeds the same value to wouter through `import.meta.env.BASE_URL`. The workflow
sets it to `/<repository name>/`, which is the project-page subpath. Build at
`/` instead and every asset 404s, the server returns `index.html` in their
place, and the browser refuses it for the wrong MIME type — the classic blank
deploy.

**`404.html`.** Pages serves static files and has no rewrite rule, so a deep
link such as `/ops/findings` would 404 on reload. The workflow copies
`index.html` to `404.html`, which hands routing back to wouter.

## What the published page shows, and why

The Governance Ops screens are entirely API-driven. With no backend reachable
they would render empty tables, and a visitor could not even obtain a key,
because registration is itself an API call.

So the published build shows a **recorded demonstration**:
`nhid-clinical/scripts/build_demo_fixture.py` drives the real FastAPI app and
the real `saas_layer/monitoring.py` evaluator over the committed demo
interactions and records the responses verbatim into
`artifacts/nhid-saas/src/pages/ops/demo-fixture.json`. The frontend replays
that recording when it holds no organization key, and every Ops screen says so.

`build_demo_fixture.py --check` fails the moment the recording and the engine
disagree, so the published figures cannot drift away from what the evaluator
actually produces.

This is a recording, not a reimplementation. The alternative — a second control
engine written in TypeScript — is how an engine acquires a second opinion about
its own controls and then drifts from it.

## The published page cannot show live data

This is a consequence of dropping the rewrite layer, and it is worth stating
plainly rather than discovering later.

The frontend calls relative paths. `src/lib/api.ts` and
`src/lib/monitoring-api.ts` each declare `const BASE = "/saas-api"`, and about
eight further call sites (`src/components/layout.tsx`, `src/pages/settings.tsx`,
`src/pages/onboarding.tsx`, `src/pages/pricing.tsx`, `src/pages/billing.tsx`)
fetch `/saas-api/...` directly. Under a platform with rewrites, that prefix was
resolved to a backend host by configuration. GitHub Pages has no such layer, so
those requests resolve against the Pages origin and cannot reach a gateway.

Serving live data from the Pages build would therefore require an **absolute
API base fixed at build time** — a single configurable origin threaded through
those call sites — not a rewrite. That change has not been made, because no
backend is deployed for it to point at. Until one is, the published dashboard
is the recorded demonstration and nothing else.

## Backend configuration

If the gateway (`nhid-clinical/Dockerfile`, `uvicorn saas_main:app`, `$PORT`,
default 8010) is deployed, it refuses to start without these:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `HMAC_SECRET` | Audit-chain signing secret |
| `ADMIN_PASS_HASH` *(preferred)* or `ADMIN_PASS` | Admin credential — no default |
| `STRIPE_WEBHOOK_SECRET` | Required to process Stripe webhooks; absent, they are rejected |

The gateway's `_strip_path_prefix` middleware accepts both prefixed and
unprefixed paths, so the same routes serve a frontend calling
`/saas-api/saas/...` and direct callers such as Stripe webhooks calling
`/saas/billing/webhook`.

## Checklist

For the published dashboard:

- [x] Pages workflow builds `artifacts/nhid-saas` with the project-page `BASE_PATH`
- [x] `404.html` fallback so deep links survive a reload
- [x] Recorded fixture regenerated from the real evaluator and guarded by `--check`
- [x] Every Ops screen states that the figures are synthetic and recorded
- [ ] Pages enabled with **GitHub Actions** as the source in repository settings

If a backend is ever deployed:

- [ ] All four required variables set
- [ ] `ADMIN_PASS_HASH` used rather than plaintext `ADMIN_PASS`
- [ ] An absolute API base threaded through the frontend's call sites
- [ ] Webhook registrations migrated to the `X-NHID-API-Key` header
- [ ] Confirmed the deployment is not represented as production-ready, HIPAA-compliant or clinically validated

## Other deployment artifacts present

| Path | Purpose |
|---|---|
| `nhid-clinical/Dockerfile` | Python gateway image |
| `nhid-clinical/start_{saas,nhid,frontend}.sh` | Local start scripts |
| `artifacts/*/.replit-artifact/artifact.toml` | Replit artifact descriptors |

These are untouched.

One constraint has now lifted: `artifacts/api-server`, a deprecated
authentication scaffold, previously could not be removed before a provider
setting was repointed away from it. Nothing deploys from it any more, so that
ordering constraint is gone and its retirement is an ordinary consolidation
decision — see `docs/CONSOLIDATION_CANDIDATES.md`, where nothing has been
deleted yet.
