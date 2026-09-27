"""Versioned schema migrations, with a ledger of what has been applied.

Why this exists
---------------
The schema was created by calling `init_db()` and three sibling
`init_*_tables()` functions at **module import time** in `gateway.py`. That has
three problems in a real deployment:

  * **No record.** Every table is `CREATE TABLE IF NOT EXISTS`, so the database
    cannot say which version of the schema it is at, and neither can anyone
    looking at it. A column added later to one of those `CREATE TABLE`
    statements is simply never applied to a database that already has the table
    -- the statement is skipped whole. That is not a hypothetical: it is why
    `migrate_billing_columns()` exists, hand-written to patch up exactly that.

  * **Concurrency.** On a host that runs more than one worker, every worker
    executes the DDL at once on boot. Postgres mostly tolerates this, but the
    ordering is undefined and the failure mode is a half-created schema.

  * **Timing.** DDL on import means importing the module touches the database,
    so a migration cannot be run *before* the app starts, which is the only
    point at which it is safe to run one.

What this does
--------------
One ordered list of migrations, applied inside a transaction, each recorded in
`schema_migrations`, under an advisory lock so concurrent workers serialise.
Running it twice is a no-op.

Migration 0001 is the existing Python bootstrap rather than a hand-written SQL
baseline. That is deliberate: those functions *are* the current schema
definition, they are idempotent, and 358 tests exercise them. Transcribing them
into a SQL file would create a second definition free to drift from the first,
which is the problem this module exists to end, not start.

Every migration after 0001 is a SQL file in `nhid-clinical/migrations/`, named
`NNNN_description.sql`, applied in filename order.

Usage:
    python scripts/migrate.py            # apply everything pending
    python scripts/migrate.py --check    # list pending, apply nothing, exit 1 if any
    python scripts/migrate.py --status   # show the ledger
"""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Callable, List, NamedTuple, Optional

from saas_layer.db import get_conn

_logger = logging.getLogger("nhid.saas.migrations")

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

# An arbitrary but fixed 64-bit key. Any process running migrations takes this
# lock, so two workers booting together queue rather than race.
_ADVISORY_LOCK_KEY = 8_241_557_003_119_004_201


class Migration(NamedTuple):
    version: str
    description: str
    sql: Optional[str] = None
    python: Optional[Callable[[], None]] = None

    def checksum(self) -> str:
        body = self.sql if self.sql is not None else f"python:{self.version}"
        return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def _baseline() -> None:
    """The schema as the application code defines it.

    Imported inside the function, not at module scope: `saas_layer.gateway`
    imports this module, and importing these at the top would close the loop.
    """
    from saas_layer import agent_registry, monitoring, voice_policy_store
    from saas_layer.auth import init_db

    # `stripe_billing`, not `billing` -- both define a `migrate_billing_columns`
    # and only this one is what `gateway.py` called. Taking the other would have
    # produced a baseline subtly different from the schema in use.
    from saas_layer.stripe_billing import migrate_billing_columns

    init_db()
    migrate_billing_columns()
    voice_policy_store.init_voice_policy_table()
    agent_registry.init_agent_registry_tables()
    monitoring.init_monitoring_tables()


def _discover_sql_migrations() -> List[Migration]:
    """SQL migrations from disk, in filename order."""
    if not MIGRATIONS_DIR.is_dir():
        return []
    found = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        version = path.stem.split("_", 1)[0]
        description = path.stem.split("_", 1)[1].replace("_", " ") if "_" in path.stem else path.stem
        found.append(Migration(version=version, description=description,
                               sql=path.read_text(encoding="utf-8")))
    return found


def all_migrations() -> List[Migration]:
    return [
        Migration(version="0001", description="baseline schema", python=_baseline),
        *_discover_sql_migrations(),
    ]


def _ensure_ledger(cur) -> None:
    cur.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
               version     TEXT PRIMARY KEY,
               description TEXT NOT NULL,
               checksum    TEXT,
               applied_at  DOUBLE PRECISION NOT NULL
           )"""
    )


def applied_versions() -> List[str]:
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            _ensure_ledger(cur)
            cur.execute("SELECT version FROM schema_migrations ORDER BY version")
            return [r["version"] for r in cur.fetchall()]
    finally:
        conn.close()


def pending() -> List[Migration]:
    done = set(applied_versions())
    return [m for m in all_migrations() if m.version not in done]


def run_migrations(verbose: bool = False) -> List[str]:
    """Apply every pending migration in order. Returns the versions applied now.

    Each migration runs in its own transaction, so a failure leaves the ledger
    consistent with the database: the failing migration is not recorded and the
    ones before it are.
    """
    import time as _time

    conn = get_conn()
    try:
        # Serialise across workers for the whole run, not per migration, so two
        # processes cannot interleave and both see the same migration pending.
        with conn:
            conn.cursor().execute("SELECT pg_advisory_lock(%s)", (_ADVISORY_LOCK_KEY,))
        try:
            with conn:
                _ensure_ledger(conn.cursor())
            with conn:
                cur = conn.cursor()
                cur.execute("SELECT version FROM schema_migrations")
                done = {r["version"] for r in cur.fetchall()}

            applied_now: List[str] = []
            for migration in all_migrations():
                if migration.version in done:
                    continue
                if verbose:
                    print(f"  applying {migration.version}  {migration.description}")

                if migration.python is not None:
                    migration.python()
                else:
                    with conn:
                        conn.cursor().execute(migration.sql)

                with conn:
                    conn.cursor().execute(
                        """INSERT INTO schema_migrations
                               (version, description, checksum, applied_at)
                           VALUES (%s, %s, %s, %s)
                           ON CONFLICT (version) DO NOTHING""",
                        (migration.version, migration.description,
                         migration.checksum(), _time.time()),
                    )
                applied_now.append(migration.version)
                _logger.info("MIGRATION APPLIED version=%s", migration.version)

            return applied_now
        finally:
            with conn:
                conn.cursor().execute("SELECT pg_advisory_unlock(%s)", (_ADVISORY_LOCK_KEY,))
    finally:
        conn.close()


def ensure_schema() -> None:
    """Bring the database up to date. Safe to call on every boot.

    This is what the application calls at startup. In a deployment that runs
    `scripts/migrate.py` as a release step -- which is the documented setup --
    everything is already applied by the time a worker boots and this does
    nothing but one indexed read.
    """
    run_migrations()
