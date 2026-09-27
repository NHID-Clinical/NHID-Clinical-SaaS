#!/usr/bin/env python3
"""Generate an ADMIN_PASS_HASH value.

    python scripts/hash_admin_password.py

Prompts for the password without echoing it, and prints the encoded hash to
paste into the deployment's ADMIN_PASS_HASH environment variable.

Why a hash and not ADMIN_PASS: the plaintext variable is supported, but it puts
the password itself in the environment, where it is visible in the dashboard, in
`env` output, and in anything that dumps the process environment on a crash. The
hash is not reversible, so a leak of it is not a leak of the password.

This is the only way an administrator is established. There is no sign-up flow
and no "first admin" bootstrap: the credential is deployment configuration, so
creating one and rotating one are the same operation -- set this variable and
restart. See docs/DEPLOYMENT.md, "Initial administrator and rotation".

The password is never written to disk, never logged, and never echoed. Passing
it as a command-line argument is deliberately not supported, because arguments
are visible in the process list and in shell history.
"""
from __future__ import annotations

import getpass
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

MIN_LENGTH = 12


def main() -> int:
    from saas_layer.admin_auth import hash_password

    if not sys.stdin.isatty():
        print("FAIL: run this interactively. Reading the password from a pipe "
              "would put it in shell history or a file.", file=sys.stderr)
        return 2

    password = getpass.getpass("Admin password: ")
    if not password:
        print("FAIL: empty password.", file=sys.stderr)
        return 1
    if len(password) < MIN_LENGTH:
        print(f"FAIL: use at least {MIN_LENGTH} characters. This credential is "
              f"the whole of the admin authorization boundary.", file=sys.stderr)
        return 1
    if password != getpass.getpass("Confirm: "):
        print("FAIL: the two entries did not match.", file=sys.stderr)
        return 1

    print("\nSet this as ADMIN_PASS_HASH (and leave ADMIN_PASS unset):\n")
    print(hash_password(password))
    print("\nThen restart the service. The previous password stops working "
          "immediately; existing admin sessions are unaffected until they "
          "expire, so revoke them by clearing the admin_sessions table if the "
          "old password may be compromised.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
