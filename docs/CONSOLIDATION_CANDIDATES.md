# Consolidation candidates

**Status of every item here: PROPOSED FOR RETIREMENT — NOT YET DELETED.**

Nothing in this document has been removed. It records what appears orphaned,
the evidence for that, and what must be checked before any deletion lands.

## Why nothing has been deleted

Inspection found no commits in this repository from the last 24 hours — the
newest is `ec17862` (2026-08-21), four weeks old, with a clean working tree and
every branch at the same commit. So consolidation here cannot destroy recent
repository work.

**But there may be unpushed work in a separate Replit workspace.** That work is
not visible from this clone. If it exists and is later synced, it could depend
on something listed here, or could silently reintroduce it. Every item below
must be checked against that workspace before removal.

Preservation points: tags `pre-phase0-phase1-20260916-1534` and
`pre-phase0-phase1-20260916-192941`, both at `ec17862`. That commit is also
`origin/main`, so the pre-change state is reachable regardless of the tags.

## Summary

| Path | Files | Last touched | Code consumers | Disposition |
|---|---|---|---|---|
| `artifacts/api-server` | 14 | 2026-07-29 | none | PROPOSED FOR RETIREMENT |
| `artifacts/nhid-audit-core` | 2 | 2026-05-29 | none | PROPOSED FOR RETIREMENT |
| `lib/db` | 6 | 2026-05-29 | api-server only | PROPOSED FOR RETIREMENT |
| `lib/api-zod` | 15 | 2026-05-29 | api-server only | PROPOSED FOR RETIREMENT |
| `lib/api-client-react` | 6 | 2026-05-29 | replit-auth-web only | PROPOSED FOR RETIREMENT |
| `lib/replit-auth-web` | 4 | 2026-05-29 | none | PROPOSED FOR RETIREMENT |
| `lib/api-spec` | 3 | 2026-05-29 | none | PROPOSED FOR RETIREMENT |

These form a single connected cluster — the Replit OIDC authentication stack.
They are not seven independent decisions; retiring `api-server` orphans the rest.

```
artifacts/api-server ──┬── lib/db
                       └── lib/api-zod

artifacts/nhid-saas ───┬── lib/replit-auth-web ── lib/api-client-react
  (declares only;      │
   never imports)      └── lib/api-client-react

lib/api-spec ────────── nothing
```

---

## 1. `artifacts/api-server`

**Why it appears orphaned.** A Replit OIDC authentication scaffold. Seven
routes, all authentication: `/healthz`, `/auth/user`, `/login`, `/callback`,
`/logout`, `/mobile-auth/token-exchange`, `/mobile-auth/logout`. **No product
endpoints.** Its database schema is `users` + `sessions`, both carrying the
comment "mandatory for Replit Auth".

**Known consumers.** None in code. References are documentation and lockfile
only: `NHID_MASTER_KNOWLEDGE_ARCHIVE.md`, `docs/trustlayer-module-architecture.md`,
`.agents/memory/port-assignments.md`, `pnpm-lock.yaml`.

**Deployment references — the blocker has lifted.** This package was previously
the Root Directory of a hosted deployment, so removing it would have broken that
deployment outright. The project no longer deploys that way: the dashboard is
published by `.github/workflows/pages.yml` from `artifacts/nhid-saas`, and
nothing deploys from `artifacts/api-server`. See `docs/DEPLOYMENT.md`.

**Recent commits.** `1dac657` (2026-07-29) fixed its typecheck on a clean
checkout — a build fix, not feature work.

**Before removal, check in the Replit workspace:** whether any newer product
API work was started here rather than in the Python gateway.

**Ordering:** no longer constrained by a deployment setting; remove as an ordinary consolidation step.

---

## 2. `artifacts/nhid-audit-core`

**Why it appears orphaned.** A standalone FastAPI audit service (443 LOC,
single file) superseded by `nhid-clinical/saas_layer/audit.py`, which is what
the product actually uses.

`audit.py` is better on every axis: HMAC-SHA256 over event hash, org, timestamp,
policy version and sequence number, verified with `hmac.compare_digest`;
PostgreSQL-backed; `HMAC_SECRET` required at import. `nhid-audit-core` uses a
bare SHA-256 chain with no secret, on SQLite.

**It also has defects that make fixing it a poor use of effort:**

- passwords stored and compared in plaintext (`main.py:229`, `:246`)
- `POST /agent/issue` — **unauthenticated**; anyone can mint an agent identity
  with any scope and any `provider_id`
- `POST /trace/append` — **unauthenticated**; anyone can inject events into any
  session's audit chain
- `POST /auth/verify` — unauthenticated
- `provider_id` is `str | None = None`, never validated, never bound

**Known consumers.** None in code. `nhid-clinical/backfill_audit.py` references
a *file* named `nhid_audit.db` but resolves it relative to its own directory,
not this package.

**Documentation references.** `replit.md` (6, including run instructions — now
carrying a "superseded, do not deploy" note), `NHID_MASTER_KNOWLEDGE_ARCHIVE.md`,
`docs/trustlayer-module-architecture.md`.

**Recent commits.** None since 2026-05-29.

**Before removal, check in the Replit workspace:** whether a Replit workflow
still runs it (`replit.md` describes one), and whether any `nhid_audit.db`
holds data worth migrating.

---

## 3–7. The `lib/` cluster

All five were last touched 2026-05-29 and form the dependency tail of the
Replit auth stack.

| Package | Consumed by | Notes |
|---|---|---|
| `lib/db` | `api-server` only (3 files) | Drizzle schema: `users`, `sessions` |
| `lib/api-zod` | `api-server` only (4 files) | Zod contracts for the auth routes |
| `lib/api-client-react` | `lib/replit-auth-web` only (1 file) | Generated client for `/api/auth/*` |
| `lib/replit-auth-web` | **nothing in code** | Declared in `artifacts/nhid-saas/package.json`, never imported from `src/` |
| `lib/api-spec` | **nothing at all** | OpenAPI + orval config; already fully orphaned |

**The `nhid-saas` finding is the one worth stating precisely.** The customer
frontend declares `@workspace/replit-auth-web` and `@workspace/api-client-react`
as dependencies, but `grep` across `artifacts/nhid-saas/src/` finds **no import
of either**. The declaration is vestigial. `lib/replit-auth-web/src/use-auth.ts`
calls `/api/auth/user`, `/api/login` and `/api/logout` — endpoints served only
by `api-server`.

**Consequence:** removing this cluster does **not** break the customer frontend.
Verified — `pnpm -C artifacts/nhid-saas run typecheck` and `run build` both exit
0 today, and neither imports these packages.

**Also requires:** removing the corresponding `references` entries from the root
`tsconfig.json` and from `artifacts/nhid-saas/tsconfig.json`, and the
`dependencies` entries from `artifacts/nhid-saas/package.json`, plus a
`pnpm-lock.yaml` regeneration.

**Before removal, check in the Replit workspace:** whether any newer frontend
work began using `useAuth` from `replit-auth-web`, which would make the
dependency real rather than vestigial.

---

## Not a consolidation candidate

`artifacts/nhid-clinical-operations` is **internal operations and testing
tooling** and stays. It carries the only substantial test suite in the
repository (148 passing). Its `server/policyEngine.ts` duplicates control logic
and needs reconciliation — see `docs/POLICY_ENGINE_RECONCILIATION.md` — but that
is a reconciliation question, not a deletion one.

`artifacts/mockup-sandbox` has not been assessed in this pass.

## Removal procedure, when approved

1. Confirm each item against the Replit workspace.
2. Confirm the Pages deploy is green before and after each removal.
3. One commit per package, never mixed with functional changes.
4. After each: `pnpm install`, `pnpm run typecheck`, `pnpm -C artifacts/nhid-saas run build`, `pytest`.
5. Update `NHID_MASTER_KNOWLEDGE_ARCHIVE.md`, `replit.md`,
   `docs/trustlayer-module-architecture.md`, `.agents/memory/port-assignments.md`.
6. Add a CI guard against reintroducing a second product backend.

**Requires explicit approval before any step.**
