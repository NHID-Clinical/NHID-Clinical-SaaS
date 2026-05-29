---
name: SaaS DB Postgres Migration
description: saas_layer fully migrated from SQLite (saas.db) to Replit PostgreSQL; all connection details and constraints.
---

## Rule
All saas_layer database access goes through `saas_layer/db.py` → `get_conn()` → psycopg2.
Never re-introduce sqlite3 in any saas_layer module.

**Why:** saas.db was a local file that evaporated on every autoscale container restart, losing all org/billing/audit data. Replit PostgreSQL is persistent.

## How to apply
- Import: `from saas_layer.db import get_conn`
- Parameters: `%s` (not `?`)
- Cursors: `conn.cursor()` returns `RealDictCursor` (set on connection factory)
- Transactions: `with conn:` + explicit cursor, then `conn.close()` in `finally`
- BOOLEAN in orgs.active (not integer 0/1)
- `INSERT ... ON CONFLICT DO NOTHING` (not `INSERT OR IGNORE`)
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (not PRAGMA checks)
- `to_char(CURRENT_DATE, 'YYYY-MM-DD')` for today comparisons on TEXT timestamp columns

## Append-only triggers (audit_traces)
Postgres trigger function `enforce_audit_append_only()` + two triggers. Created in `init_db()` via `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (CREATE TRIGGER IF NOT EXISTS requires PG17+).

## `artifacts/nhid-saas: SaaS Gateway` workflow
This is the `sleep infinity` dev stub — intentionally fails/does nothing in dev. The actual Python gateway runs as `NHID Clinical SaaS` on port 8010. Do NOT restart the stub.

## Data migrated
All SQLite rows from saas.db were copied to Postgres on 2026-05-29. The SQLite file still exists at nhid-clinical/saas.db but is no longer read or written by any code.
