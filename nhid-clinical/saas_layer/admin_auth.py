"""
admin_auth.py — admin credential loading and verification for the SaaS gateway.

Security properties:

  * No hardcoded credential defaults.  The gateway refuses to start if admin
    credentials are absent, rather than falling back to a known value.
  * Passwords are verified against a memory-hard KDF (scrypt, RFC 7914) — never
    compared in plaintext.
  * All comparisons are constant-time (`hmac.compare_digest`).
  * Errors never echo the supplied or expected credential.

Configuration (one of the two is required):

  ADMIN_PASS_HASH   Preferred.  An encoded scrypt hash produced by
                    `hash_password()` — no plaintext secret in the environment.
  ADMIN_PASS        Fallback for existing deployments.  Plaintext; hashed into
                    memory at startup and never stored.  Discouraged.

  ADMIN_USER        Optional, defaults to "admin".  The username is not secret,
                    but it is still compared in constant time.

Generate a hash for ADMIN_PASS_HASH with:

    python -c "from saas_layer.admin_auth import hash_password; \
               print(hash_password('<your-password>'))"

Note on the KDF choice: scrypt is used rather than Argon2id purely to avoid
adding a runtime dependency to a deployment that is already fragile.  scrypt is
memory-hard and standardised; migrating to Argon2id later only requires changing
`hash_password`/`verify_password` and re-issuing ADMIN_PASS_HASH, because the
encoded form carries its own algorithm tag.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from typing import NamedTuple

# scrypt parameters.  n=2**15 keeps verification well under ~150ms on typical
# server hardware while remaining memory-hard (~32 MiB at r=8).
_SCRYPT_N = 2 ** 15
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32
_SALT_BYTES = 16
# OpenSSL caps scrypt memory at 32 MiB by default, which n=2**15, r=8 sits
# exactly on. Raise the cap explicitly so the parameters are the constraint,
# not the library default.
_SCRYPT_MAXMEM = 128 * _SCRYPT_N * _SCRYPT_R * 2

_ALGO_TAG = "scrypt"


class AdminCredentials(NamedTuple):
    username: str
    password_hash: str


class AdminCredentialError(RuntimeError):
    """Raised when admin credentials are missing or malformed."""


def _b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """Return an encoded scrypt hash: scrypt$n$r$p$<salt_b64>$<dk_b64>."""
    if not password:
        raise AdminCredentialError("Refusing to hash an empty password.")
    if salt is None:
        salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
        maxmem=_SCRYPT_MAXMEM,
    )
    return f"{_ALGO_TAG}${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64e(salt)}${_b64e(dk)}"


def verify_password(password: str, encoded: str) -> bool:
    """Constant-time verification of `password` against an encoded hash.

    Returns False for malformed input rather than raising, so that a corrupted
    ADMIN_PASS_HASH fails closed (denies login) instead of crashing the request.
    """
    if not password or not encoded:
        return False
    try:
        algo, n_s, r_s, p_s, salt_b64, dk_b64 = encoded.split("$")
        if algo != _ALGO_TAG:
            return False
        dk = hashlib.scrypt(
            password.encode("utf-8"),
            salt=_b64d(salt_b64),
            n=int(n_s),
            r=int(r_s),
            p=int(p_s),
            dklen=len(_b64d(dk_b64)),
            maxmem=128 * int(n_s) * int(r_s) * 2,
        )
    except Exception:
        return False
    return hmac.compare_digest(dk, _b64d(dk_b64))


def verify_username(supplied: str, expected: str) -> bool:
    """Constant-time username comparison."""
    return hmac.compare_digest(
        (supplied or "").encode("utf-8"), (expected or "").encode("utf-8")
    )


def load_admin_credentials(env: dict | None = None) -> AdminCredentials:
    """Load admin credentials from the environment, or raise.

    There is deliberately no default password.  A deployment that does not
    configure one must not start.
    """
    env = os.environ if env is None else env

    username = env.get("ADMIN_USER") or "admin"
    encoded = (env.get("ADMIN_PASS_HASH") or "").strip()

    if encoded:
        # Validate the encoded form now so a malformed hash fails at startup
        # rather than silently denying every login later.
        if not verify_password("probe-not-the-real-password", encoded) and not encoded.startswith(f"{_ALGO_TAG}$"):
            raise AdminCredentialError(
                "ADMIN_PASS_HASH is set but is not a recognised scrypt hash. "
                "Regenerate it with saas_layer.admin_auth.hash_password()."
            )
        return AdminCredentials(username=username, password_hash=encoded)

    plaintext = env.get("ADMIN_PASS") or ""
    if plaintext:
        # Hashed into memory; the plaintext is not retained beyond this call.
        return AdminCredentials(
            username=username, password_hash=hash_password(plaintext)
        )

    raise AdminCredentialError(
        "Admin credentials are not configured. Set ADMIN_PASS_HASH (preferred) "
        "or ADMIN_PASS before starting the gateway. The gateway will not start "
        "with a default password."
    )
