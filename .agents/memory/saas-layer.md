---
name: SaaS layer architecture
description: How the NHID Clinical SaaS gateway is structured and how it relates to the NHID core.
---

The SaaS gateway (`nhid-clinical/saas_layer/gateway.py`) imports NHID core Python modules directly (`nhid_event_store`, `nhid_policy`) rather than HTTP-proxying to port 8000. This keeps the core test suite isolated and avoids network hops.

- **saas.db** — separate SQLite for org/usage data, at `nhid-clinical/saas.db`
- **Entrypoint** — `nhid-clinical/saas_main.py`, runs on `$PORT` (default 8010)
- **Auth** — `X-API-Key` header for org-scoped endpoints; `X-Admin-Key` (env `SAAS_ADMIN_KEY`, default `nhid-admin-key-dev`) for admin
- **Vite proxy** — `/saas-api` in the frontend rewrites to `http://localhost:8010`

**Why:** Direct import lets the SaaS layer reuse core logic without duplicating it and without coupling the core service's port/lifetime to the SaaS layer.

**How to apply:** Any new SaaS feature should import from core modules, not call port 8000. The core service on 8000 stays the test/clinical target only.
