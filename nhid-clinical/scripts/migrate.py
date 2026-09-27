#!/usr/bin/env python3
"""Apply pending database migrations.

Run this as a release step, before the application starts:

    python scripts/migrate.py

Modes:
    (default)   apply every pending migration, in order
    --check     list what is pending, apply nothing, exit 1 if anything is
    --status    print the ledger: what has been applied and when

Requires DATABASE_URL. Exits non-zero on failure so a deploy stops rather than
starting an application against a schema it does not match.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true",
                       help="list pending migrations without applying them")
    group.add_argument("--status", action="store_true",
                       help="print the applied-migration ledger")
    args = parser.parse_args()

    if not os.environ.get("DATABASE_URL", "").strip():
        print("FAIL: DATABASE_URL is not set. Migrations need a database.")
        return 2

    from saas_layer.migrations import all_migrations, applied_versions, pending, run_migrations

    if args.status:
        from saas_layer.db import get_conn
        # Ensures the ledger exists, so --status works against a database that
        # has never been migrated instead of raising UndefinedTable.
        applied_versions()
        conn = get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT version, description, applied_at FROM schema_migrations "
                "ORDER BY version"
            )
            rows = cur.fetchall()
        finally:
            conn.close()
        if not rows:
            print("No migrations have been applied to this database.")
            return 0
        print(f"{len(rows)} migration(s) applied:")
        for row in rows:
            when = datetime.fromtimestamp(
                row["applied_at"], tz=timezone.utc
            ).strftime("%Y-%m-%d %H:%M:%SZ")
            print(f"  {row['version']}  {when}  {row['description']}")
        return 0

    outstanding = pending()

    if args.check:
        if not outstanding:
            print(f"MIGRATIONS PASS: up to date "
                  f"({len(applied_versions())} applied, 0 pending)")
            return 0
        print(f"MIGRATIONS PENDING: {len(outstanding)}")
        for migration in outstanding:
            print(f"  {migration.version}  {migration.description}")
        print("\nRun: python scripts/migrate.py")
        return 1

    if not outstanding:
        print(f"Database is up to date ({len(all_migrations())} migration(s), "
              f"none pending).")
        return 0

    print(f"Applying {len(outstanding)} migration(s):")
    try:
        applied = run_migrations(verbose=True)
    except Exception as exc:  # noqa: BLE001 — the message is the deliverable
        print(f"\nMIGRATION FAILED: {type(exc).__name__}: {exc}")
        print("The database is unchanged past the last migration recorded as "
              "applied. Fix the migration and run again.")
        return 1

    print(f"\nApplied {len(applied)} migration(s): {', '.join(applied)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
