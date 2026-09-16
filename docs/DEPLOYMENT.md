# Deployment

Current state of deployment configuration, what is wrong with it, and what can
only be fixed outside this repository.

## Intended topology

```
Browser
   │
   │  GET /            → static assets
   │  /saas-api/*      → rewritten by Vercel
   ▼
Vercel  (root: artifacts/nhid-saas, output: dist)
   │
   │  rewrite /saas-api/:path*  →  https://<backend-domain>/saas-api/:path*
   │  (the /saas-api prefix is PRESERVED across the rewrite)
   ▼
Python SaaS gateway   (Docker: uvicorn saas_main:app, $PORT, default 8010)
   │
   │  _strip_path_prefix middleware removes /saas-api
   ▼
FastAPI routes: /saas/..., /admin/...
```

The frontend always calls relative paths (`src/lib/api.ts`: `const BASE =
"/saas-api"`). It has no hardcoded backend host, which is correct — the host is
resolved entirely by the Vercel rewrite.

The gateway accepts both prefixed and unprefixed paths, so the same routes serve
the React frontend (`/saas-api/saas/...`) and direct callers such as Stripe
webhooks (`/saas/billing/webhook`).

## Two problems, neither fixable from this repository alone

### 1. The Vercel Root Directory points at the wrong package

Confirmed from the Vercel status payload on PR #8:

```json
"rootDirectory": "artifacts/api-server"
```

`artifacts/api-server` is a deprecated authentication scaffold. It has no
`index.html`, no `vercel.json`, and its build emits a Node server bundle
(`platform: "node"`, `format: "esm"`) rather than static output. The only
`vercel.json` in the repository lives in `artifacts/nhid-saas` and is therefore
**never read**.

**Required change — Vercel dashboard, not a commit:**

> Project `nhid-clinical-saas` → Settings → General → Root Directory
> `artifacts/api-server` → `artifacts/nhid-saas`

Once set, `artifacts/nhid-saas/vercel.json` takes effect and its `buildCommand`
and `outputDirectory` apply.

**Verified locally** (so the repository side is known good):

```
PORT=3000 BASE_PATH=/ pnpm -C artifacts/nhid-saas run build   → exit 0
pnpm -C artifacts/nhid-saas run typecheck                     → exit 0
```

`PORT` and `BASE_PATH` are required by `vite.config.ts`; the build fails without
them. They are already correct in `vercel.json`'s `buildCommand`.

**Ordering constraint:** `artifacts/api-server` must not be removed until the
Root Directory has been repointed. Removing it first breaks the deployment
outright, because Vercel would be building a directory that no longer exists.

### 2. The backend domain is an unfilled placeholder

`artifacts/nhid-saas/vercel.json` contains:

```json
"destination": "https://REPLACE_WITH_RAILWAY_BACKEND_DOMAIN/saas-api/:path*"
```

`REPLACE_WITH_RAILWAY_BACKEND_DOMAIN` is meant to be the public domain of the
Python gateway deployed from `nhid-clinical/Dockerfile` — on Railway, per the
name, though nothing in the repository pins it to that provider.

**No value has been invented here.** The correct domain depends on
infrastructure that this repository cannot observe. Until it is set, every
`/saas-api/*` request from the deployed frontend fails, so the frontend would
deploy but not function.

Note that `vercel.json` rewrites do not interpolate environment variables, so
this cannot be parameterised in-file. It must be either edited at deploy time or
configured as a rewrite in the Vercel dashboard.

## Backend configuration

The gateway refuses to start without these (see README):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `HMAC_SECRET` | Audit-chain signing secret |
| `ADMIN_PASS_HASH` *(preferred)* or `ADMIN_PASS` | Admin credential — no default |
| `STRIPE_WEBHOOK_SECRET` | Required to process Stripe webhooks; absent, they are rejected |

`PORT` is supplied by the platform; the Dockerfile defaults to 8010.

## Pre-deployment checklist

- [ ] Vercel Root Directory set to `artifacts/nhid-saas`
- [ ] `REPLACE_WITH_RAILWAY_BACKEND_DOMAIN` replaced with the real gateway domain
- [ ] Backend deployed and reachable at that domain
- [ ] `/saas-api/health` returns 200 through the Vercel rewrite
- [ ] All four required backend variables set
- [ ] `ADMIN_PASS_HASH` used rather than plaintext `ADMIN_PASS`
- [ ] Webhook registrations migrated to the `X-NHID-API-Key` header
- [ ] Confirmed the deployment is not represented as production-ready or
      HIPAA-compliant

## Other deployment artifacts present

| Path | Purpose |
|---|---|
| `nhid-clinical/Dockerfile` | Python gateway image |
| `nhid-clinical/start_{saas,nhid,frontend}.sh` | Local start scripts |
| `artifacts/*/.replit-artifact/artifact.toml` | Replit artifact descriptors |

These are untouched. The Replit descriptors are relevant to the separate Replit
workspace noted in `docs/CONSOLIDATION_CANDIDATES.md`.
