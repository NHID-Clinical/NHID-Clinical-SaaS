# Deployment

How to deploy the NHID-Clinical SaaS application from a clean environment, and
what each piece actually does.

> **Nothing described here is deployed yet.** This document is the procedure, not
> a record. There is no running backend, no database and no `app.` or `api.`
> hostname at the time of writing. Every URL below is an example to substitute,
> not an address to visit. The one thing that *is* live is the public
> informational site — see [Two different things](#two-different-things).

---

## Two different things

| | Public site | SaaS application |
|---|---|---|
| What | Informational site: the framework, specification, FAQ | The product: workspaces, evaluations, findings, evidence |
| Where | GitHub Pages, `nhid-clinical.org` | Render (frontend + API) |
| Repository | `NHID-Clinical/NHID-Clinical` | this one |
| Backend | none — static files | FastAPI + PostgreSQL |
| Status | **live** | **not deployed** |

GitHub Pages is not, and must not become, the production backend. It serves
static files and has no server. This repository also publishes a Pages build of
the frontend (`.github/workflows/pages.yml`) — that build has no API to talk to
and therefore runs in **recorded demo mode**, which every Ops screen says on its
face. It is a demonstration, not the product.

---

## Architecture

```
    Browser
       │
       ├──────────────► Render static site   (frontend, the React app)
       │                app.nhid-clinical.org
       │                        │
       │                        │  VITE_API_BASE_URL, baked in at build time
       │                        ▼
       └──────────────► Render web service   (FastAPI, saas_main:app)
                        api.nhid-clinical.org
                                │
                                ▼
                        Supabase PostgreSQL
                                ▲
                                │  webhooks (signature-verified)
                             Stripe
```

The frontend and the API are **separate origins**. That is the single fact that
most of the configuration below exists to handle: it is why `VITE_API_BASE_URL`
must be set, and why `CORS_ALLOWED_ORIGINS` must name the frontend exactly.

---

## 1. Accounts and services you need

| Service | Why | Cost |
|---|---|---|
| **GitHub** | Source. Render deploys from it. | free |
| **Render** | Hosts the API (web service) and the frontend (static site). | API needs a paid instance; see below |
| **Supabase** *(or Render Postgres)* | Managed PostgreSQL. | free tier is enough to start |
| **Resend** *(or Postmark)* | Delivers sign-in links. Without it nobody inside a customer organization can sign in. | free tier is enough to start |
| **Stripe** | Only if you enable billing. | free until you charge |

**On the Render plan.** The API must not be on a free instance. Free instances
sleep when idle, and the first request after sleeping takes tens of seconds —
which for an evaluator clicking into the app is indistinguishable from broken.
The static frontend is fine on free.

---

## 2. Supabase (PostgreSQL)

1. Create a project. Save the database password it generates — it is shown once.
2. **Project Settings → Database → Connection string → URI.**
3. Take the **connection pooler** URI (port `6543`), not the direct one (`5432`).
   A web service opens and closes connections per request; the pooler is what
   that pattern needs, and the direct connection will exhaust its limit.
4. Keep `?sslmode=require`.

This is `DATABASE_URL`. It contains the password — it is a secret and never goes
in the repository.

No manual schema work. Do not paste DDL into the SQL editor. The schema is
applied by migrations in step 5.

---

## 3. Render — the API

Either apply the blueprint (`render.yaml` at the repository root, **New →
Blueprint**) or create the service by hand with these settings:

| Setting | Value |
|---|---|
| Type | Web Service |
| Runtime | Python 3 |
| Root Directory | `nhid-clinical` |
| Build Command | `pip install -r requirements.txt` |
| Pre-Deploy Command | `python scripts/migrate.py` |
| Start Command | `uvicorn saas_main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |

**The pre-deploy command is load-bearing.** It applies migrations once, before
any worker starts. Without it, every worker issues schema DDL on boot, at the
same time, with no record of what ran — which is what the application used to do
and why `saas_layer/migrations.py` exists.

### Environment variables — API

Set these under **Environment**. Values marked **secret** must never be
committed.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | **secret.** From step 2. |
| `HMAC_SECRET` | yes | **secret.** `openssl rand -hex 32`. Signs the audit chain. |
| `ADMIN_PASS_HASH` | yes | **secret.** See step 6. |
| `CORS_ALLOWED_ORIGINS` | yes in production | Exact frontend origin(s), comma-separated, no trailing slash. |
| `APP_ENV` | yes | `production` |
| `NHID_SKIP_SCHEMA_BOOTSTRAP` | yes | `1`, because migrations run pre-deploy |
| `ADMIN_USER` | no | defaults to `admin`; not a secret |
| `STRIPE_SECRET_KEY` | billing only | **secret** |
| `STRIPE_PUBLISHABLE_KEY` | billing only | not a secret |
| `STRIPE_WEBHOOK_SECRET` | billing only | **secret.** Without it webhooks are *rejected*, not trusted. |
| `MAX_REQUEST_BYTES` | no | default 10 MiB |
| `VOICE_SESSION_TTL_HOURS` | no | default 24 |

`nhid-clinical/.env.example` is the authoritative list and explains each one.

**The application fails closed.** It refuses to start without an admin
credential, and refuses to start in production without `CORS_ALLOWED_ORIGINS`.
That is deliberate: a misconfigured deployment should not serve.

---

## 4. Render — the frontend

| Setting | Value |
|---|---|
| Type | Static Site |
| Root Directory | `artifacts/nhid-saas` |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist/public` |
| Rewrite | `/*` → `/index.html` (required — it is a single-page app) |

### Environment variables — frontend

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://api.nhid-clinical.org` | your API origin, no trailing slash |
| `PORT` | `3000` | required by `vite.config.ts` or the build throws |
| `BASE_PATH` | `/` | `/` for a site root |

`VITE_API_BASE_URL` is **inlined into the bundle at build time**, not read at
runtime. Changing it requires a rebuild. It is not a secret — every visitor can
read it.

Without it the app falls back to `/saas-api`, which is correct only for local
development, where the Vite dev server proxies that path to `localhost:8010`.
Deployed without it, the app calls its own static host and nothing works.

---

## 5. Migrations

```bash
python scripts/migrate.py            # apply everything pending
python scripts/migrate.py --check    # list pending; exit 1 if any
python scripts/migrate.py --status   # what has been applied, and when
```

Applied migrations are recorded in `schema_migrations`. Running twice is a
no-op. Concurrent runs serialise on a Postgres advisory lock.

Migration `0001` is the baseline and is Python, not SQL: the `init_*` functions
it calls *are* the schema definition, and transcribing them into a SQL file
would create a second definition free to drift from the first. Later migrations
are SQL files in `nhid-clinical/migrations/`, named `NNNN_description.sql`,
applied in filename order. Write them forward-only — once a migration has run
against a deployed database, change the schema with a new file rather than by
editing that one.

---

## 6. The initial administrator, and rotating it

There is **no sign-up flow and no "create first admin" screen**. The admin
credential is deployment configuration. Creating an administrator and rotating
one are therefore the same operation.

```bash
cd nhid-clinical
python scripts/hash_admin_password.py
```

It prompts without echoing, and prints a hash. Set it as `ADMIN_PASS_HASH` and
restart the service.

- Prefer `ADMIN_PASS_HASH` over `ADMIN_PASS`. The plaintext variable works, but
  puts the password in the dashboard and in any process-environment dump.
- `ADMIN_USER` defaults to `admin` and is not secret.
- **To rotate:** generate a new hash, replace the variable, restart. The old
  password stops working immediately.
- **Existing sessions survive a rotation** — they are rows in `admin_sessions`
  with an 8-hour TTL, independent of the password. If the old password may be
  compromised, also clear them:
  ```sql
  DELETE FROM admin_sessions;
  ```
- **If you lose the password**, there is no recovery flow and no reset email.
  Generate a new hash and restart. Nothing is lost: the credential authenticates
  the operator, it does not encrypt anything.

Admin login is throttled server-side: five failures from one IP in fifteen
minutes returns `429` for fifteen minutes, checked *before* the password is
compared, so a locked caller learns nothing from a correct guess. To clear a
lockout you caused yourself: `DELETE FROM admin_login_attempts;`.

---

## 7. CORS

`CORS_ALLOWED_ORIGINS` must name the frontend origin **exactly** — scheme, host
and port, no trailing slash:

```
CORS_ALLOWED_ORIGINS=https://app.nhid-clinical.org
```

Several origins are comma-separated. It is not a wildcard and cannot be: a
wildcard would let any page on the internet script this API, including repeated
POSTs to `/admin/login`.

If the app loads but every request fails, check this first — a CORS failure
looks like a dead backend in the UI and is only obvious in the browser console.

---

## 7a. Sign-in links

There are two credentials, and they are not interchangeable:

| | credential | used by |
|---|---|---|
| **machine** | organization API key | ingest pipelines, scripts, CI |
| **human** | magic-link session | people opening `/ops` in a browser |

The API key is unchanged and still does everything it did. The session exists so
that a review decision carries the name of the person who made it — before it,
`review_events.reviewer` was free text the client supplied, defaulting to the
literal string `"unknown"`. An audit product that cannot say who resolved a
finding answers the first question an auditor asks with a shrug.

**This is required in production, and the gateway enforces it at startup.** With
`APP_ENV=production` and no sender configured the process refuses to boot. That
is deliberate: a deployment that silently cannot send mail accepts every sign-in
request, answers `202`, delivers nothing, and locks every user out with no error
anywhere. Startup is the last cheap moment to catch it.

### What to set up

1. **Create an account** at [Resend](https://resend.com) or
   [Postmark](https://postmarkapp.com). Both have a free tier that covers a pilot.
2. **Verify a sending domain.** The provider gives you DNS records — SPF and
   DKIM — to add at your registrar. Mail from an unverified domain is rejected
   or filed as spam, which looks exactly like a broken sign-in.
3. **Set four variables** on the API service:

```
EMAIL_BACKEND=resend                        # or postmark
EMAIL_API_KEY=<the provider's API key>      # secret
EMAIL_FROM=sign-in@your-verified-domain
APP_BASE_URL=https://app.<your-domain>      # the FRONTEND origin
```

`APP_BASE_URL` is where links point. It is read from configuration and never
from the request's `Host` header — honouring that header would let an attacker
POST a sign-in request with a host they control and have your user mailed a
genuine link to the attacker's domain.

4. **If the app and the API are on different subdomains**, scope the session
   cookie to the parent:

```
SESSION_COOKIE_DOMAIN=.your-domain.com
```

Without it a cookie set by `api.` is never sent to `app.`, and every request
reads as signed-out for reasons nothing in the UI can explain. Leave it unset if
both are served from one host.

### How anyone gets a first account

There is **no self-service sign-up**, on purpose. An endpoint that created an
account for any address posted to it would let a stranger fill your users table
and would leak, through its own response, which addresses already exist.

- The **first owner** of an organization is created by passing `email` to
  `POST /saas/orgs/register`. That address gets a link and becomes `owner`.
- Every subsequent person is **invited by an owner**, from Settings → People, or
  `POST /saas/orgs/members`.
- An owner can promote another member to `owner`. The last owner cannot be
  removed — an organization with none can never invite anyone again.

### Verifying it without a provider

Set `EMAIL_BACKEND=log` in development. The link is written to **stderr** — not
to the application logger, because `log_redaction.py` correctly rewrites any
`token=` it sees to `<redacted>`, and a sign-in token in a log really is a
credential. Run the API, POST an address to `/saas/auth/request-link`, and copy
the link off the console.

`log` is rejected in production by the startup check above.

---

## 8. Stripe (only if billing is enabled)

1. **Developers → Webhooks → Add endpoint**: `https://api.<your-domain>/saas/billing/webhook`
2. Copy the **signing secret** into `STRIPE_WEBHOOK_SECRET`.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`.

Without `STRIPE_WEBHOOK_SECRET`, webhooks are **rejected**. An unverified
webhook is an unauthenticated request that changes subscription state, so
rejecting is the correct failure. Redelivery is idempotent — handled events are
recorded in `processed_events`, so Stripe's retries do not double-apply.

The gateway accepts the webhook at both the prefixed and unprefixed path, so
Stripe calling `/saas/billing/webhook` works regardless of the frontend's path
convention.

---

## 9. Custom domains

Render: **Settings → Custom Domain** on each service, then add the CNAME records
it gives you at your DNS provider.

| Host | Points at |
|---|---|
| `nhid-clinical.org` | GitHub Pages (the public site — already configured) |
| `app.nhid-clinical.org` | Render static site |
| `api.nhid-clinical.org` | Render web service |

These names are a target, not a requirement — use whatever you own. After
changing either hostname you must update **both** `VITE_API_BASE_URL` (and
rebuild the frontend) and `CORS_ALLOWED_ORIGINS`.

Do not point `nhid-clinical.org` itself at Render. Its `CNAME` file in the
framework repository binds it to GitHub Pages, and moving it has taken the site
down before.

---

## 10. Production smoke test

Run in order. Each step depends on the one before.

```bash
API=https://api.nhid-clinical.org
APP=https://app.nhid-clinical.org
```

1. **API is alive and the database is reachable**
   ```bash
   curl -s $API/health
   # {"status":"ok","db":"healthy",...}   — "db":"error" means DATABASE_URL is wrong
   ```
2. **Migrations are applied** — `python scripts/migrate.py --check` exits 0.
3. **The frontend loads** — open `$APP`. It must not show the recorded-demo
   banner once a key is connected.
4. **A workspace can be created** — register an organization through the app.
   You are shown an API key **once**; it is stored as a SHA-256 hash and cannot
   be recovered.
5. **An evaluation runs end to end** — create an assessment, load the synthetic
   demonstration set, ingest and evaluate. The engine is deterministic: the same
   input yields the same findings.
6. **Results persist** — reload, and the evaluation, findings and evidence are
   still there.
7. **Returning works** — close the browser, reopen `$APP`, supply the key, and
   the same evaluation is retrievable.
8. **Isolation holds** — register a second organization and confirm it sees none
   of the first one's data. (`tests/test_workspace_isolation.py` asserts this,
   but confirm it against the deployment.)
9. **Admin authenticates** — `$APP/admin`, sign in with `ADMIN_USER` and the
   password behind `ADMIN_PASS_HASH`. API keys appear as prefixes only.
10. **Admin logout invalidates** — sign out, then confirm the old session token
    is refused.

If step 3 works but step 4 does not, it is almost always CORS or
`VITE_API_BASE_URL`.

---

## 11. Local development

Three processes.

```bash
# 1. PostgreSQL — any local instance, then:
export DATABASE_URL="postgresql://localhost:5432/nhid_saas"
export HMAC_SECRET="dev-only-not-a-real-secret"
export ADMIN_PASS="dev-only-admin-password"

# Sign-in links go to stderr instead of an inbox, so the whole flow works
# with no provider account and no network. Rejected in production.
export EMAIL_BACKEND=log
export APP_BASE_URL="http://localhost:3000"

# 2. Migrations, then the API on 8010
cd nhid-clinical
python scripts/migrate.py
uvicorn saas_main:app --host 127.0.0.1 --port 8010

# 3. The frontend on 3000, proxying /saas-api -> localhost:8010
cd artifacts/nhid-saas
PORT=3000 BASE_PATH=/ npm run dev
```

Leave `VITE_API_BASE_URL` unset locally — the dev proxy in `vite.config.ts` is
what makes the relative `/saas-api` path work. Leave `SESSION_COOKIE_DOMAIN`
unset too: the proxy makes the app and the API one origin, so a host-only
cookie is correct. Leave `NHID_SKIP_SCHEMA_BOOTSTRAP` unset as well, so the app
bootstraps its own schema, which is what the test suite relies on.

To sign in locally, register an organization with an address and read the link
off the API's console:

```bash
curl -s -X POST http://127.0.0.1:8010/saas/orgs/register \
  -H 'Content-Type: application/json' \
  -d '{"org_name":"Local Co","email":"you@example.org"}'
# -> the API's stderr prints:  [dev sign-in link for you@example.org]
```

Open that link. It works once and expires in 15 minutes.

Tests:

```bash
cd nhid-clinical
python -m pytest tests/ -q      # 373 passed, 18 skipped
```

---

## 12. Rotating credentials

| Credential | How | Consequence |
|---|---|---|
| `ADMIN_PASS_HASH` | new hash, restart | old password dead immediately; clear `admin_sessions` too if compromised |
| `DATABASE_URL` | rotate in Supabase, update, restart | brief downtime |
| `HMAC_SECRET` | **not routine** | records signed with the old key no longer verify — treat as a migration, not a rotation |
| `STRIPE_*` | roll in Stripe, update, restart | update the webhook secret at the same time |
| An organization's API key | `POST /saas/orgs/rotate-key`, or the Settings screen | old key stops working immediately |

`HMAC_SECRET` deserves the emphasis. It signs the audit chain. Rotating it does
not re-sign history, so every existing audit record becomes unverifiable. If you
must rotate it, plan for what happens to the records signed with the old one —
do not discover it afterwards.

---

## 13. Backup and recovery

Supabase takes automatic daily backups on paid plans; the free tier does not.
**Check which you are on before you have data worth losing.**

What matters most, in order:

1. `audit_traces` — the tamper-evident chain. It is the product's evidentiary
   claim, and it cannot be reconstructed.
2. `interactions`, `evaluations`, `findings`, `review_events` — customer data
   and the determinations made about it.
3. `orgs` — workspace records. API keys are stored as hashes, so restoring this
   restores access without exposing any key.

Everything else can be rebuilt: the schema comes from migrations, and evaluation
is deterministic, so re-running the engine over the same interactions reproduces
the same findings.

Test a restore before you rely on one.

---

## 14. Healthcare data

**Do not upload real PHI unless and until the deployment, contracts, security
controls and compliance requirements have been separately validated.**

Treat this as an environment for synthetic and test data.

Using authentication, TLS, PostgreSQL and a cloud provider does **not** make a
deployment HIPAA compliant. Compliance is a property of an organization, its
agreements — including a Business Associate Agreement with every vendor in the
path, Render and Supabase among them — its policies, its training and its
audits. It is not a property of software, and installing this software confers
none of it. Nothing here has been assessed against that standard.

The application says the same thing at the point of upload, where someone is
about to paste a transcript, rather than only in a document.

---

## 15. Observability

| Question | Where |
|---|---|
| Is the service alive? | `GET /health` |
| Is the database reachable? | `"db"` in `/health` |
| Did an evaluation succeed? | response body — failures are reported per record in `errors`, never silently dropped |
| Are there API errors? | Render service logs |
| Are there failed admin logins? | `ADMIN_LOGIN_FAILED` / `ADMIN_LOGIN_THROTTLED` in the logs |
| Did a webhook fail? | Render logs, and Stripe's own delivery log |
| What is the schema version? | `python scripts/migrate.py --status` |

Logs are redacted by `saas_layer/log_redaction.py`. Passwords, tokens, API keys
and PHI are not logged; admin login failures record that a failure occurred and
whether it locked, never the credential supplied.

`/health` is public so an uptime monitor can reach it, and deliberately carries
no business metrics. Tenant counts moved to `/saas/system/status`, which
requires an admin session.

---

## Checklist

Before calling a deployment done:

- [ ] `python scripts/migrate.py --check` exits 0 against the production database
- [ ] `ADMIN_PASS_HASH` set, `ADMIN_PASS` unset
- [ ] `CORS_ALLOWED_ORIGINS` names the frontend origin exactly
- [ ] `EMAIL_BACKEND` is `resend` or `postmark` — never `log` — with `EMAIL_API_KEY`, `EMAIL_FROM` and `APP_BASE_URL` set
- [ ] The sending domain's SPF and DKIM records resolve
- [ ] A real sign-in link arrived in a real inbox and opened a session
- [ ] `SESSION_COOKIE_DOMAIN` set if the app and API are on different subdomains
- [ ] `VITE_API_BASE_URL` set, and the frontend rebuilt since
- [ ] `/health` reports `"db":"healthy"`
- [ ] All ten smoke-test steps pass
- [ ] Two organizations confirm isolation against the real deployment
- [ ] Backups confirmed on the database plan you are actually on
- [ ] No secret in the repository: `git log -p | grep -iE 'sk_live|whsec_|postgres://.*:.*@'`
- [ ] Nobody has been told this is HIPAA compliant
