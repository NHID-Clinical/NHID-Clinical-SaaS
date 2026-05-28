---
name: NHID SaaS HTTP isolation
description: How SaaS gateway reaches NHID core — HTTP only via Bridge at port 8001, no direct module imports.
---

## Rule
SaaS gateway MUST NOT import nhid_event_store, nhid_policy, or any NHID core Python module.
All NHID data access goes through `saas_layer/nhid_client.py` which makes HTTP calls to the Bridge.

## Architecture
- Port 8000: NHID Clinical Core (Twilio voice, untouchable)
- Port 8001: NHID Bridge (`replit_backend_bridge.py`) — HTTP API layer over nhid_event_store
  - `GET /health`, `GET /policy`, `GET /events/{id}`, `GET /trace/{id}`, `GET /proof/{id}`
  - `POST /events` — write via append_events_batch
- Port 8010: SaaS Gateway — imports only `saas_layer.nhid_client`
- Port ~23223: React frontend

## nhid_client.py interface
- `nhid_client.append_event(session_id, events, request_id)` → POST /events to Bridge
- `nhid_client.get_events(session_id)` → GET /events/{id}
- `nhid_client.get_trace(session_id)` → GET /trace/{id}
- `nhid_client.get_proof(session_id)` → GET /proof/{id}
- `nhid_client.get_policy_version()` → GET /policy (cached in-process)
- `nhid_client.is_reachable()` → GET /health

## Env vars
- `NHID_API_URL` — Bridge base URL (default: http://localhost:8001)
- `NHID_BASE_URL` — Core base URL for health probe (default: http://localhost:8000)
- `NHID_CLIENT_TIMEOUT` — HTTP timeout in seconds (default: 10)

**Why:** Previous design imported nhid_event_store directly, coupling SaaS and NHID at the Python module level. HTTP isolation means SaaS gateway can restart independently, and NHID core can be replaced or upgraded without touching SaaS.

**How to apply:** Any new SaaS endpoint that needs NHID data must use nhid_client, not a direct Python import. If a new NHID capability is needed, add it to the Bridge first.
