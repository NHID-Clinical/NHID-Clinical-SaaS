---
name: Audit chain concurrent write bug
description: SELECT FOR UPDATE fails to protect empty-chain first-insert; use pg_advisory_xact_lock instead.
---

## Rule
In `saas_layer/audit.py::_get_chain_tail`, use `pg_advisory_xact_lock(hashtext(org_id))` to serialize concurrent writes per org — NOT `SELECT ... FOR UPDATE`.

**Why:** `FOR UPDATE` can only lock rows that already exist. When an org's chain is empty (first write), all concurrent threads see zero rows, none acquires a lock, and all race to insert seq_num=0. This produces duplicate seq_nums and broken hash links. The advisory lock blocks at the Postgres level regardless of whether any rows exist yet.

**How to apply:**
```python
cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (org_id,))
cur.execute(
    "SELECT event_hash, seq_num FROM audit_traces "
    "WHERE org_id = %s ORDER BY seq_num DESC LIMIT 1",
    (org_id,),
)
```
The lock is transaction-scoped and auto-releases on commit or rollback — no manual cleanup needed. This was confirmed by the harness: `test_concurrent_writes_same_org_no_collision` failed with `FOR UPDATE` and passed immediately after switching to advisory lock.
