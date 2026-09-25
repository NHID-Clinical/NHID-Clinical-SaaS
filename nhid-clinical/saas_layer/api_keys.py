"""
api_keys.py — generation, hashing and display of organization API keys.

Kept separate from auth.py so it can be tested without a database connection,
following the same pattern as webhook_auth.py.

Why SHA-256 and not scrypt/bcrypt
---------------------------------
A key here is ``"nhid_" + secrets.token_hex(24)`` — 24 random bytes, 192 bits
of entropy. The slow-KDF argument is about *low-entropy human passwords*, where
an attacker who steals the hashes can guess the plaintext; a deliberately slow
hash makes that guessing expensive. None of that applies to a 192-bit random
value: it cannot be guessed, dictionary-attacked or rainbow-tabled at any
work factor.

What a slow KDF *would* do here is put a deliberate delay on the authentication
path of every single request, which is a denial-of-service lever pointed at
ourselves. So: a single SHA-256, which is what the same problem gets at Stripe
and GitHub.

The security property that matters is the one this module exists to provide —
**the plaintext key is never at rest**. A database dump, a backup, a stray log
of a row, or a SELECT through an injection flaw yields hashes, and a hash
cannot be replayed against the API.
"""

from __future__ import annotations

import hashlib
import secrets

# Kept as a constant because it is load-bearing in two places that must agree:
# the prefix stored for display, and the length assumed when masking.
KEY_PREFIX = "nhid_"

# Bytes of randomness. 24 bytes -> 48 hex characters -> 192 bits.
KEY_ENTROPY_BYTES = 24

# How much of the key is retained in cleartext purely so a human can tell two
# keys apart in a list. Short enough to be useless to an attacker: it leaves
# 160 bits unknown.
DISPLAY_PREFIX_LEN = len(KEY_PREFIX) + 6


def generate_key() -> str:
    """Return a new API key. The only place a key is minted."""
    return KEY_PREFIX + secrets.token_hex(KEY_ENTROPY_BYTES)


def hash_key(api_key: str) -> str:
    """Return the lowercase hex SHA-256 of a key, as stored and looked up.

    Deterministic on purpose: the hash *is* the lookup index, so validating a
    key stays a single indexed equality lookup rather than a table scan over
    per-row salts.
    """
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def key_prefix(api_key: str) -> str:
    """Return the short, non-secret fragment shown in a UI (e.g. ``nhid_1a2b3c``)."""
    return api_key[:DISPLAY_PREFIX_LEN]


def mask(api_key: str) -> str:
    """Render a key for display without revealing it."""
    return f"{key_prefix(api_key)}…"
