"""Tests for admin credential loading and verification (Phase 0.1).

These cover the security properties that matter:
  * no default password — a missing config must raise, not fall back
  * wrong credentials are rejected
  * verification is against a KDF, never plaintext
  * errors do not leak the supplied or expected credential
"""

import pytest

from saas_layer.admin_auth import (
    AdminCredentialError,
    hash_password,
    load_admin_credentials,
    verify_password,
    verify_username,
)


# ── No default credential ─────────────────────────────────────────────────────

def test_missing_credentials_raises():
    """An unconfigured deployment must not start with a default password."""
    with pytest.raises(AdminCredentialError):
        load_admin_credentials({})


def test_empty_credentials_raise():
    with pytest.raises(AdminCredentialError):
        load_admin_credentials({"ADMIN_PASS": "", "ADMIN_PASS_HASH": ""})


def test_the_retired_default_password_is_not_accepted():
    """Regression: the credential that leaked in git history must not work."""
    with pytest.raises(AdminCredentialError):
        load_admin_credentials({"ADMIN_USER": "admin"})


# ── Hashing and verification ──────────────────────────────────────────────────

def test_hash_is_not_plaintext_and_is_salted():
    h1 = hash_password("swordfish")
    h2 = hash_password("swordfish")
    assert "swordfish" not in h1
    assert h1.startswith("scrypt$")
    assert h1 != h2, "each hash must use a fresh salt"


def test_correct_password_verifies():
    assert verify_password("swordfish", hash_password("swordfish")) is True


@pytest.mark.parametrize("bad", ["", "wrong", "swordfis", "swordfish ", "SWORDFISH"])
def test_wrong_password_rejected(bad):
    assert verify_password(bad, hash_password("swordfish")) is False


def test_malformed_hash_fails_closed():
    """A corrupted ADMIN_PASS_HASH denies login rather than raising."""
    for junk in ["", "not-a-hash", "scrypt$bad", "bcrypt$1$2$3$4$5"]:
        assert verify_password("swordfish", junk) is False


def test_username_comparison():
    assert verify_username("admin", "admin") is True
    assert verify_username("root", "admin") is False
    assert verify_username("", "admin") is False


# ── Configuration paths ───────────────────────────────────────────────────────

def test_plaintext_env_fallback_is_hashed_not_stored():
    creds = load_admin_credentials({"ADMIN_PASS": "swordfish"})
    assert "swordfish" not in creds.password_hash
    assert verify_password("swordfish", creds.password_hash) is True
    assert verify_password("wrong", creds.password_hash) is False


def test_hash_env_is_preferred_over_plaintext():
    encoded = hash_password("from-hash")
    creds = load_admin_credentials(
        {"ADMIN_PASS_HASH": encoded, "ADMIN_PASS": "from-plaintext"}
    )
    assert verify_password("from-hash", creds.password_hash) is True
    assert verify_password("from-plaintext", creds.password_hash) is False


def test_username_defaults_to_admin_but_is_overridable():
    assert load_admin_credentials({"ADMIN_PASS": "x"}).username == "admin"
    assert load_admin_credentials(
        {"ADMIN_PASS": "x", "ADMIN_USER": "ops"}
    ).username == "ops"


def test_malformed_hash_env_raises_at_load():
    with pytest.raises(AdminCredentialError):
        load_admin_credentials({"ADMIN_PASS_HASH": "bcrypt$nope"})


# ── Error messages must not leak secrets ──────────────────────────────────────

def test_error_message_does_not_contain_credentials():
    try:
        load_admin_credentials({})
    except AdminCredentialError as exc:
        msg = str(exc)
        assert "nhidclinical1626" not in msg
        assert "ADMIN_PASS_HASH" in msg, "should name the variable, not its value"
    else:
        pytest.fail("expected AdminCredentialError")


def test_empty_password_refused_by_hasher():
    with pytest.raises(AdminCredentialError):
        hash_password("")
