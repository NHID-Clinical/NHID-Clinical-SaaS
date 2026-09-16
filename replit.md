# NHID Audit Core (superseded)

> **Status:** this standalone service is superseded by
> `nhid-clinical/saas_layer/audit.py`, which is the audit implementation the
> product uses. It is retained pending removal and should not be treated as the
> current backend. See the repository README for architecture terminology.
>
> It also has known defects: passwords are stored and compared in plaintext,
> and `/agent/issue`, `/trace/append` and `/auth/verify` require no
> authentication. Do not deploy it.


A tamper-evident audit logging engine for AI/agent-driven healthcare workflows. Proves what an agent did, when it did it, and whether it was authorized at that moment.

## Run & Operate

- `cd artifacts/nhid-audit-core && uvicorn main:app --host 0.0.0.0 --port 8000 --reload` — run the audit core (workflow: "NHID Audit Core")
- FastAPI interactive docs available at the service URL + `/docs`

## Stack

- Python 3.11
- FastAPI + Uvicorn
- SQLite (single file: `nhid_audit.db`, created automatically on startup)
- hashlib SHA256 for tamper-evident hash chaining
- Pydantic v2 for request/response validation

## Where things live

- `artifacts/nhid-audit-core/main.py` — entire service (single file, by design)
- `artifacts/nhid-audit-core/nhid_audit.db` — SQLite database (auto-created on first run)
- `artifacts/nhid-audit-core/requirements.txt` — Python dependencies

## Architecture decisions

- **Single-file service**: All logic lives in `main.py` per the spec's "single service" requirement — no module splitting.
- **Hash chaining rule**: `SHA256(prev_hash + json.dumps(event, sort_keys=True) + timestamp + agent_id)` — deterministic and tamper-detectable.
- **Genesis hash**: Sessions start with a 64-zero string as `prev_hash` for the first event, making chain validation unambiguous.
- **Token scope**: Scopes are stored as JSON arrays on both agents and tokens; `auth/verify` checks the requested scope is present in the token's scope array.
- **No external services**: SQLite only — no Postgres, Redis, or Docker needed.

## Product

Four endpoints that together prove agent accountability:

| Endpoint | Purpose |
|---|---|
| `POST /agent/issue` | Create an agent identity and access token |
| `POST /auth/verify` | Validate a token is active and covers a requested scope |
| `POST /trace/append` | Append a hash-chained event to a session trace |
| `GET /proof/{session_id}` | Export the full ordered audit trail with chain validity flag |

If any stored trace record is tampered with after the fact, `valid_chain` in the proof response returns `false`.

## User preferences

_Populate as you build._

## Gotchas

- `nhid_audit.db` is written relative to the working directory (`artifacts/nhid-audit-core/`). Always run uvicorn from that directory.
- The service runs on port 8000 (not routed through the shared pnpm proxy — access directly).
