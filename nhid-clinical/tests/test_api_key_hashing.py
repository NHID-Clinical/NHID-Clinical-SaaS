"""Tests for API keys being hashed at rest.

Before this, `orgs.api_key` held the live credential in cleartext and
authentication was a raw equality match on it, so any read of the table --
a backup, a dump, a logged row, a SELECT through an injection flaw -- yielded
working credentials for every tenant at once.

The load-bearing assertions here are the two that would catch a regression to
that state:

  * `test_plaintext_key_is_not_stored_anywhere_in_the_row` -- scans every
    column of the stored row for the key, rather than just checking that a
    column named `api_key` is gone. A regression that reintroduces the
    plaintext under a different column name still fails this.
  * `test_migration_from_plaintext_preserves_authentication` -- builds a row
    the way the *old* schema did and then migrates it, because a migration
    that hashed keys but locked existing customers out would be a worse
    outcome than the vulnerability.
"""

import uuid

import pytest

from saas_layer import auth
from saas_layer.api_keys import (
    DISPLAY_PREFIX_LEN,
    KEY_PREFIX,
    generate_key,
    hash_key,
    key_prefix,
)
from saas_layer.db import get_conn


# ── The pure module, no database needed ───────────────────────────────────────

def test_generated_keys_are_unique_and_carry_the_expected_entropy():
    keys = {generate_key() for _ in range(200)}
    assert len(keys) == 200, "key generation is not producing distinct values"
    for k in keys:
        assert k.startswith(KEY_PREFIX)
        # 24 random bytes rendered as hex.
        assert len(k) == len(KEY_PREFIX) + 48


def test_hash_is_deterministic_and_does_not_contain_the_key():
    key = generate_key()
    assert hash_key(key) == hash_key(key)
    assert len(hash_key(key)) == 64
    assert key not in hash_key(key)
    assert key[len(KEY_PREFIX):] not in hash_key(key)


def test_different_keys_hash_differently():
    assert hash_key(generate_key()) != hash_key(generate_key())


def test_prefix_is_short_enough_to_be_useless_to_an_attacker():
    key = generate_key()
    prefix = key_prefix(key)
    assert key.startswith(prefix)
    assert len(prefix) == DISPLAY_PREFIX_LEN
    # The point of the prefix is that it leaves the key unguessable: at least
    # 40 hex characters (160 bits) must remain unrevealed.
    assert len(key) - len(prefix) >= 40


# ── Against the database ──────────────────────────────────────────────────────

@pytest.fixture
def org():
    auth.init_db()
    created = auth.create_org(f"hash-test-{uuid.uuid4().hex[:8]}")
    yield created
    conn = get_conn()
    try:
        with conn:
            conn.cursor().execute(
                "DELETE FROM orgs WHERE org_id = %s", (created["org_id"],)
            )
    finally:
        conn.close()


def _stored_row(org_id):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM orgs WHERE org_id = %s", (org_id,))
        return dict(cur.fetchone())
    finally:
        conn.close()


def test_plaintext_key_is_not_stored_anywhere_in_the_row(org):
    """The whole point. Scans every column, not just the one we removed."""
    row = _stored_row(org["org_id"])
    plaintext = org["api_key"]
    for column, value in row.items():
        assert plaintext != value, f"plaintext key stored in column {column!r}"
        if isinstance(value, str):
            assert plaintext not in value, (
                f"plaintext key embedded in column {column!r}"
            )


def test_the_hash_is_what_is_stored(org):
    row = _stored_row(org["org_id"])
    assert row["api_key_sha256"] == hash_key(org["api_key"])
    assert row["api_key_prefix"] == key_prefix(org["api_key"])


def test_a_valid_key_still_authenticates(org):
    found = auth.validate_api_key(org["api_key"])
    assert found is not None
    assert found["org_id"] == org["org_id"]


def test_a_wrong_key_is_refused(org):
    assert auth.validate_api_key(generate_key()) is None
    assert auth.validate_api_key("") is None
    assert auth.validate_api_key("nhid_not-a-real-key") is None


def test_the_stored_hash_cannot_be_presented_as_a_key(org):
    """A dumped hash must not be replayable against the API.

    If someone reads the table, what they hold is the hash. Presenting it
    must fail, or hashing bought nothing.
    """
    stored_hash = _stored_row(org["org_id"])["api_key_sha256"]
    assert auth.validate_api_key(stored_hash) is None


def test_rotation_invalidates_the_old_key_and_issues_a_working_one(org):
    old_key = org["api_key"]
    assert auth.validate_api_key(old_key) is not None

    new_key = auth.rotate_api_key(org["org_id"])
    assert new_key and new_key != old_key

    assert auth.validate_api_key(old_key) is None, "old key still works"
    rotated = auth.validate_api_key(new_key)
    assert rotated is not None and rotated["org_id"] == org["org_id"]

    row = _stored_row(org["org_id"])
    assert row["api_key_sha256"] == hash_key(new_key)
    assert new_key not in str(row)


def test_rotating_an_unknown_org_returns_none():
    assert auth.rotate_api_key(f"no-such-org-{uuid.uuid4().hex}") is None


# ── The migration ─────────────────────────────────────────────────────────────

def test_migration_from_plaintext_preserves_authentication():
    """Simulate a row created under the old schema, then migrate it.

    A migration that hashed keys but silently locked existing customers out
    would be worse than the vulnerability it fixes, so this asserts the key
    still works afterwards -- not merely that the column is gone.
    """
    auth.init_db()
    org_id = f"legacy-{uuid.uuid4().hex[:12]}"
    legacy_key = generate_key()

    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            # Re-create the old shape: a plaintext column, populated, with no
            # hash. This is exactly the state a pre-migration database is in.
            cur.execute("ALTER TABLE orgs ADD COLUMN IF NOT EXISTS api_key TEXT")
            cur.execute(
                """INSERT INTO orgs (org_id, org_name, api_key, plan, status,
                                     created_at, active)
                   VALUES (%s, %s, %s, 'free', 'active', %s, TRUE)""",
                (org_id, "legacy org", legacy_key, auth._now()),
            )
    finally:
        conn.close()

    try:
        auth.migrate_api_keys_to_hashed()

        found = auth.validate_api_key(legacy_key)
        assert found is not None, "a key minted before the migration stopped working"
        assert found["org_id"] == org_id

        row = _stored_row(org_id)
        assert "api_key" not in row, "the plaintext column survived the migration"
        assert row["api_key_sha256"] == hash_key(legacy_key)
        assert legacy_key not in str(row)
    finally:
        conn = get_conn()
        try:
            with conn:
                conn.cursor().execute(
                    "DELETE FROM orgs WHERE org_id = %s", (org_id,)
                )
        finally:
            conn.close()


def test_migration_is_idempotent(org):
    """Runs on every startup, so running it twice must change nothing."""
    before = _stored_row(org["org_id"])
    auth.migrate_api_keys_to_hashed()
    auth.migrate_api_keys_to_hashed()
    after = _stored_row(org["org_id"])
    assert before == after
    assert auth.validate_api_key(org["api_key"]) is not None
