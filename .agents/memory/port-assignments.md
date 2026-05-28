---
name: Port assignments
description: Fixed port map for all running services in this project.
---

| Port | Service | Workflow |
|------|---------|---------|
| 8000 | NHID Clinical App (app:app) | NHID Clinical App |
| 8001 | NHID Clinical Bridge (replit_backend_bridge) | NHID Clinical Bridge |
| 8003 | NHID Audit Core (FastAPI) | NHID Audit Core |
| 8010 | NHID Clinical SaaS Gateway (saas_main.py) | NHID Clinical SaaS |
| 5174/5175 | NHID Clinical Viewer (Vite) | NHID Clinical Viewer |
| 8080 | API Server (Node/Express) | artifacts/api-server |
| varies | nhid-dashboard (Vite) | artifacts/nhid-dashboard |
| 23223 | nhid-saas frontend (Vite) | artifacts/nhid-saas |

**Why:** Port 8000 was freed from the Audit Core (moved to 8003) specifically so the NHID Clinical test suite can keep pointing at 8000 without reconfiguration.
