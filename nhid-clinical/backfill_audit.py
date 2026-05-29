"""
backfill_audit.py — One-shot backfill of existing NHID core events into audit_traces.

Run from the nhid-clinical/ directory:
    python backfill_audit.py

Safe to re-run: uses INSERT OR IGNORE on event_id so duplicates are skipped.

Historical events have no known org_id — they are written with the sentinel
org_id "__backfill__" and clearly marked backfill=True.  Their HMAC signatures
are valid (computable from HMAC_SECRET + the sentinel org_id) but should NOT be
mixed into a live org's chain for verification purposes.

Requirements:
  - HMAC_SECRET must be set in the environment.
  - saas.db must exist (run the SaaS gateway at least once first).
  - nhid-clinical/ must be the working directory so NHID core is importable.
"""
import os
import sys
import sqlite3
import json
import uuid
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Ensure HMAC_SECRET is present before we import audit_svc
_secret = os.environ.get("HMAC_SECRET", "")
if not _secret:
    print("ERROR: HMAC_SECRET environment variable is not set.")
    print("Set it before running: export HMAC_SECRET=<your-secret>")
    sys.exit(1)

from saas_layer.auth import migrate_audit_traces
from saas_layer import audit as audit_svc

_SAAS_DB = os.path.join(_HERE, "saas.db")
_BACKFILL_ORG = "__backfill__"


def _get_saas_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_SAAS_DB, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _load_nhid_events():
    """Load all events from the NHID core event store."""
    try:
        import nhid_event_store as store
        # get_all_sessions is not a standard method; iterate known sessions
        # by querying the NHID core SQLite directly instead
    except ImportError as e:
        print(f"ERROR: Cannot import nhid_event_store: {e}")
        sys.exit(1)

    nhid_db = os.path.join(_HERE, "nhid_audit.db")
    if not os.path.exists(nhid_db):
        print(f"NHID audit DB not found at {nhid_db} — nothing to backfill.")
        return []

    conn = sqlite3.connect(nhid_db, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        # NHID core stores events in 'events' table (inspect actual schema)
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        print(f"NHID core tables: {tables}")

        # Try common table names used by nhid_event_store
        event_table = None
        for candidate in ("events", "audit_events", "trace_events", "audit_log"):
            if candidate in tables:
                event_table = candidate
                break

        if event_table is None:
            print(f"No known event table found in {nhid_db}. Tables: {tables}")
            print("Inspect nhid_audit.db manually to find the event table name.")
            return []

        rows = conn.execute(
            f"SELECT * FROM {event_table} ORDER BY rowid ASC"
        ).fetchall()
        print(f"Found {len(rows)} events in NHID core ({event_table}).")
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _already_backfilled(conn: sqlite3.Connection, event_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM audit_traces WHERE event_id = ?", (event_id,)
    ).fetchone()
    return row is not None


def run_backfill(dry_run: bool = False) -> None:
    print(f"{'DRY RUN — ' if dry_run else ''}Starting backfill...")

    # Ensure the table and triggers exist
    migrate_audit_traces()
    print("audit_traces schema verified.")

    events = _load_nhid_events()
    if not events:
        print("No events to backfill.")
        return

    inserted = 0
    skipped = 0
    errors = 0

    saas_conn = _get_saas_conn()

    for raw in events:
        # Build a normalized event dict from whatever columns NHID core has
        event = {
            "event_type":    raw.get("event_type") or raw.get("type") or "UNKNOWN",
            "state_before":  raw.get("state_before") or raw.get("prev_state") or "",
            "state_after":   raw.get("state_after") or raw.get("next_state") or "",
            "input_text":    raw.get("input_text") or raw.get("input"),
            "policy_action": raw.get("policy_action") or raw.get("action"),
            "reason_code":   raw.get("reason_code") or raw.get("reason"),
            "response_text": raw.get("response_text") or raw.get("response"),
            "policy_version": raw.get("policy_version"),
            "model_version": None,
        }

        # Use the NHID core's own ID if present, otherwise mint a new one
        core_id = str(raw.get("id") or raw.get("event_id") or uuid.uuid4())
        session_id = str(raw.get("session_id") or "unknown")

        if _already_backfilled(saas_conn, core_id):
            skipped += 1
            continue

        if dry_run:
            print(f"  [DRY RUN] Would insert event_id={core_id} session={session_id}")
            inserted += 1
            continue

        try:
            result = audit_svc.append_trace(
                org_id=_BACKFILL_ORG,
                session_id=session_id,
                event=event,
                model_version=None,
            )
            # Overwrite the auto-generated event_id with the core's original ID
            # by updating the just-inserted row (allowed before triggers fire on
            # future rows; this is a one-time migration operation)
            with saas_conn:
                saas_conn.execute(
                    "UPDATE audit_traces SET event_id = ? WHERE event_id = ?",
                    (core_id, result["event_id"]),
                )
            inserted += 1
            if inserted % 100 == 0:
                print(f"  ... {inserted} events inserted so far")
        except Exception as exc:
            print(f"  ERROR inserting event {core_id}: {exc}")
            errors += 1

    saas_conn.close()

    print(f"\nBackfill complete.")
    print(f"  Inserted : {inserted}")
    print(f"  Skipped  : {skipped} (already present)")
    print(f"  Errors   : {errors}")

    if errors:
        print("\nSome events failed — re-run to retry.")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Backfill NHID core events into audit_traces.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be inserted without writing.")
    args = parser.parse_args()
    run_backfill(dry_run=args.dry_run)
