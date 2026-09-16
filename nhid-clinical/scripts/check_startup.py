#!/usr/bin/env python3
"""
check_startup.py — CI guard: required configuration and importability.

Two checks, neither of which needs the server to actually listen:

  1. Every environment variable the gateway requires at startup is present.
     Only names and a present/absent verdict are printed — never a value.
  2. The gateway module graph imports cleanly, which catches broken imports,
     syntax errors and missing dependencies before they reach a deploy.

Exit codes: 0 all checks passed, 1 something is missing or broken.

Run from the nhid-clinical/ directory:

    python scripts/check_startup.py
"""

from __future__ import annotations

import os
import sys

# Variables the gateway cannot start without.
REQUIRED = [
    ("DATABASE_URL", "PostgreSQL connection string"),
    ("HMAC_SECRET", "audit-chain signing secret"),
]

# Exactly one of each group must be set.
REQUIRED_ONE_OF = [
    (
        ("ADMIN_PASS_HASH", "ADMIN_PASS"),
        "admin credential (hash preferred; there is no default password)",
    ),
]


def _ok(msg: str) -> None:
    print(f"  ok      {msg}")


def _fail(msg: str) -> None:
    print(f"  MISSING {msg}")


def check_env() -> bool:
    print("Environment configuration:")
    passed = True

    for name, desc in REQUIRED:
        # Presence only. The value is never read into the output.
        if os.environ.get(name):
            _ok(f"{name} is set ({desc})")
        else:
            _fail(f"{name} is not set ({desc})")
            passed = False

    for names, desc in REQUIRED_ONE_OF:
        present = [n for n in names if os.environ.get(n)]
        if present:
            _ok(f"{' or '.join(names)} — {present[0]} is set ({desc})")
        else:
            _fail(f"none of {' / '.join(names)} is set ({desc})")
            passed = False

    return passed


def check_imports() -> bool:
    print("\nModule imports:")
    modules = [
        "saas_layer.admin_auth",
        "saas_layer.webhook_auth",
        "saas_layer.log_redaction",
        "saas_layer.audit",
        "saas_layer.stripe_billing",
        "saas_layer.gateway",
    ]
    passed = True
    for mod in modules:
        try:
            __import__(mod)
            _ok(f"import {mod}")
        except Exception as exc:
            # Type and message only; no traceback, which could contain a
            # connection string.
            print(f"  FAILED  import {mod} -> {type(exc).__name__}: {exc}")
            passed = False
    return passed


def main() -> int:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if here not in sys.path:
        sys.path.insert(0, here)

    env_ok = check_env()
    # Importing the gateway requires the environment to be valid, so only
    # attempt it once the configuration check has passed.
    import_ok = check_imports() if env_ok else False

    print()
    if env_ok and import_ok:
        print("startup check: PASS")
        return 0
    if not env_ok:
        print("startup check: FAIL — configuration incomplete")
    else:
        print("startup check: FAIL — module import error")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
