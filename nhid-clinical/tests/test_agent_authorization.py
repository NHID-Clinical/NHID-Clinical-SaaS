"""
Acceptance tests for provider-signed agent authorization (NHID-Auth v2).

This is the control the product exists for: an AI agent telephoning a payer and
claiming to act for a provider must be able to *prove* it, and must be refused
when it cannot.

Coverage
--------
Parsing        — malformed passport payloads are rejected by name, not by an
                 opaque signature failure
Registry       — provider signing keys and revocation, including cross-tenant
                 isolation
Verification   — the acceptance matrix: exactly one path verifies, every other
                 path denies with a specific reason
Persistence    — a verdict survives the round trip through voice_sessions and
                 comes back in the shape the policy engine reads
Policy loop    — the verdict actually changes the enforcement decision, which is
                 the connection that did not exist before

These tests require a live PostgreSQL (DATABASE_URL), like the rest of the
gateway suite.
"""

import base64
import json
import os
import sys
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

import pytest

# Ensure nhid-clinical/ is on sys.path so saas_layer is importable
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.agent_identity import AgentIdentityManager, Delegation  # noqa: E402
from saas_layer import agent_authorization, agent_registry  # noqa: E402
from saas_layer.agent_authorization import PassportFormatError, parse_passport  # noqa: E402
from saas_layer.db import get_conn  # noqa: E402
from saas_layer.voice_policy import check_authorization, run_voice_policy  # noqa: E402
from saas_layer.voice_policy_store import DEFAULT_RULESET  # noqa: E402

VALID_NPI = "1234567890"
OTHER_NPI = "9876543210"

_mgr = AgentIdentityManager()


# ── Helpers ───────────────────────────────────────────────────────────────────

def mint(
    provider_priv=None,
    signing_priv=None,
    agent_id="agent-under-test",
    scope=("eligibility",),
    ttl_seconds=3600,
    call_sid="CA-TEST-1",
    npi=VALID_NPI,
    agent_priv=None,
):
    """
    Produce (passport_payload, provider_public_key_b64).

    *provider_priv* is the key whose public half is registered; *signing_priv*
    is the key that actually signs. They are the same for a genuine passport
    and differ when forging one.
    """
    if provider_priv is None:
        provider_priv, _ = _mgr.generate_agent_keys()
    if signing_priv is None:
        signing_priv = provider_priv
    if agent_priv is None:
        agent_priv, _ = _mgr.generate_agent_keys()
    agent_pub = agent_priv.public_key()

    delegation = _mgr.create_delegation(
        provider_priv, agent_id, agent_pub, list(scope),
        ttl_seconds=ttl_seconds, call_sid=call_sid, provider_npi=npi,
    )
    provider_sig = _mgr.sign_delegation(signing_priv, delegation)
    passport = _mgr.create_agent_passport(delegation, provider_sig, agent_priv)
    return to_payload(passport), _mgr.public_key_to_b64(provider_priv.public_key())


def to_payload(passport) -> dict:
    """Serialise an AgentPassport the way a client would send it."""
    return {
        "delegation": asdict(passport.delegation),
        "signature_b64": passport.signature_b64,
        "agent_signature_b64": passport.agent_signature_b64,
    }


def resign(delegation: Delegation, provider_priv, agent_priv) -> dict:
    """Re-sign a hand-built delegation so only the field under test differs."""
    provider_sig = _mgr.sign_delegation(provider_priv, delegation)
    passport = _mgr.create_agent_passport(delegation, provider_sig, agent_priv)
    return to_payload(passport)


@pytest.fixture
def org_id():
    """A unique org id per test, with its registry rows removed afterwards."""
    oid = f"org_test_{uuid.uuid4().hex[:12]}"
    yield oid
    conn = get_conn()
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM provider_keys WHERE org_id = %s", (oid,))
            cur.execute("DELETE FROM agent_revocations WHERE org_id = %s", (oid,))
            cur.execute("DELETE FROM voice_sessions WHERE org_id = %s", (oid,))
    finally:
        conn.close()


@pytest.fixture(scope="module", autouse=True)
def _schema():
    agent_registry.init_agent_registry_tables()


# ─────────────────────────────────────────────────────────────────────────────
# Passport parsing
# ─────────────────────────────────────────────────────────────────────────────

class TestParsePassport:
    def test_parses_a_well_formed_payload(self):
        payload, _ = mint()
        passport = parse_passport(payload)
        assert passport.delegation.provider_npi == VALID_NPI
        assert passport.delegation.agent_id == "agent-under-test"

    def test_round_trip_preserves_signed_bytes(self):
        """
        Parsing then re-serialising must reproduce the exact JSON the signature
        covers. If this drifts, every genuine passport starts failing as a forgery.
        """
        payload, _ = mint(scope=("zebra", "alpha", "middle"))
        passport = parse_passport(payload)
        assert passport.delegation.to_json() == json.dumps(
            payload["delegation"], sort_keys=True
        )

    def test_preserves_scope_order(self):
        payload, _ = mint(scope=("zebra", "alpha"))
        assert parse_passport(payload).delegation.scope == ["zebra", "alpha"]

    @pytest.mark.parametrize("bad", [None, "string", 42, [], True])
    def test_rejects_non_object(self, bad):
        with pytest.raises(PassportFormatError, match="ERR_PASSPORT_NOT_OBJECT"):
            parse_passport(bad)

    def test_rejects_missing_top_level_field(self):
        payload, _ = mint()
        del payload["agent_signature_b64"]
        with pytest.raises(PassportFormatError, match="ERR_PASSPORT_MISSING_FIELDS"):
            parse_passport(payload)

    def test_rejects_unexpected_top_level_field(self):
        payload, _ = mint()
        payload["admin"] = True
        with pytest.raises(PassportFormatError, match="ERR_PASSPORT_UNEXPECTED_FIELDS"):
            parse_passport(payload)

    def test_rejects_missing_delegation_field(self):
        payload, _ = mint()
        del payload["delegation"]["nonce"]
        with pytest.raises(PassportFormatError, match="ERR_DELEGATION_MISSING_FIELDS"):
            parse_passport(payload)

    def test_rejects_unexpected_delegation_field(self):
        payload, _ = mint()
        payload["delegation"]["elevated"] = True
        with pytest.raises(PassportFormatError, match="ERR_DELEGATION_UNEXPECTED_FIELDS"):
            parse_passport(payload)

    def test_rejects_non_list_scope(self):
        payload, _ = mint()
        payload["delegation"]["scope"] = "eligibility"
        with pytest.raises(PassportFormatError, match="scope"):
            parse_passport(payload)

    def test_rejects_non_string_scope_entry(self):
        payload, _ = mint()
        payload["delegation"]["scope"] = ["eligibility", 7]
        with pytest.raises(PassportFormatError, match="scope"):
            parse_passport(payload)

    def test_rejects_non_string_delegation_field(self):
        payload, _ = mint()
        payload["delegation"]["agent_id"] = 123
        with pytest.raises(PassportFormatError, match="agent_id"):
            parse_passport(payload)

    def test_rejects_empty_signature(self):
        payload, _ = mint()
        payload["signature_b64"] = ""
        with pytest.raises(PassportFormatError, match="signature_b64"):
            parse_passport(payload)


# ─────────────────────────────────────────────────────────────────────────────
# Provider key registry
# ─────────────────────────────────────────────────────────────────────────────

class TestProviderKeyRegistry:
    def test_register_and_retrieve(self, org_id):
        _, pub = mint()
        row = agent_registry.register_provider_key(org_id, VALID_NPI, pub, "Front desk")
        assert row["status"] == "active"
        assert row["provider_npi"] == VALID_NPI
        assert agent_registry.get_active_provider_keys(org_id, VALID_NPI) == [pub]

    def test_unregistered_npi_returns_no_keys(self, org_id):
        assert agent_registry.get_active_provider_keys(org_id, VALID_NPI) == []

    def test_keys_are_scoped_per_npi(self, org_id):
        _, pub = mint()
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        assert agent_registry.get_active_provider_keys(org_id, OTHER_NPI) == []

    def test_keys_are_scoped_per_org(self, org_id):
        _, pub = mint()
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        assert agent_registry.get_active_provider_keys("org_someone_else", VALID_NPI) == []

    def test_reregistering_does_not_duplicate(self, org_id):
        _, pub = mint()
        first = agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        second = agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        assert first["key_id"] == second["key_id"]
        assert len(agent_registry.get_active_provider_keys(org_id, VALID_NPI)) == 1

    def test_reregistering_reactivates_a_revoked_key(self, org_id):
        _, pub = mint()
        row = agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        agent_registry.revoke_provider_key(org_id, row["key_id"])
        assert agent_registry.get_active_provider_keys(org_id, VALID_NPI) == []
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        assert agent_registry.get_active_provider_keys(org_id, VALID_NPI) == [pub]

    def test_revoke_returns_false_for_unknown_key(self, org_id):
        assert agent_registry.revoke_provider_key(org_id, "pk_does_not_exist") is False

    def test_revoke_is_not_idempotent_on_second_call(self, org_id):
        _, pub = mint()
        row = agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        assert agent_registry.revoke_provider_key(org_id, row["key_id"]) is True
        assert agent_registry.revoke_provider_key(org_id, row["key_id"]) is False

    def test_cannot_revoke_another_orgs_key(self, org_id):
        _, pub = mint()
        row = agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        assert agent_registry.revoke_provider_key("org_attacker", row["key_id"]) is False
        assert agent_registry.get_active_provider_keys(org_id, VALID_NPI) == [pub]

    def test_supports_key_rotation_with_two_active_keys(self, org_id):
        _, old = mint()
        _, new = mint()
        agent_registry.register_provider_key(org_id, VALID_NPI, old)
        agent_registry.register_provider_key(org_id, VALID_NPI, new)
        assert set(agent_registry.get_active_provider_keys(org_id, VALID_NPI)) == {old, new}

    def test_list_hides_revoked_by_default(self, org_id):
        _, pub = mint()
        row = agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        agent_registry.revoke_provider_key(org_id, row["key_id"])
        assert agent_registry.list_provider_keys(org_id) == []
        assert len(agent_registry.list_provider_keys(org_id, include_revoked=True)) == 1

    @pytest.mark.parametrize("bad_npi", ["", "123", "12345678901", "abcdefghij", "123-456-78"])
    def test_rejects_malformed_npi(self, org_id, bad_npi):
        _, pub = mint()
        with pytest.raises(agent_registry.RegistryError, match="ERR_INVALID_NPI"):
            agent_registry.register_provider_key(org_id, bad_npi, pub)

    @pytest.mark.parametrize("bad_key", [
        "",
        "not base64!!",
        base64.b64encode(b"too short").decode(),
        base64.b64encode(b"x" * 64).decode(),
    ])
    def test_rejects_malformed_public_key(self, org_id, bad_key):
        with pytest.raises(agent_registry.RegistryError, match="ERR_INVALID_PUBLIC_KEY"):
            agent_registry.register_provider_key(org_id, VALID_NPI, bad_key)


class TestRevocationStore:
    def test_no_revocation_by_default(self, org_id):
        assert agent_registry.is_revoked(org_id, agent_id="a", delegation_id="d") is None

    def test_agent_revocation_detected(self, org_id):
        agent_registry.revoke_subject(org_id, "agent", "agent-1", "compromised")
        assert agent_registry.is_revoked(org_id, agent_id="agent-1") == "agent"

    def test_delegation_revocation_detected(self, org_id):
        agent_registry.revoke_subject(org_id, "delegation", "del-1")
        assert agent_registry.is_revoked(org_id, delegation_id="del-1") == "delegation"

    def test_agent_revocation_reported_in_preference_to_delegation(self, org_id):
        agent_registry.revoke_subject(org_id, "agent", "agent-1")
        agent_registry.revoke_subject(org_id, "delegation", "del-1")
        assert agent_registry.is_revoked(org_id, agent_id="agent-1", delegation_id="del-1") == "agent"

    def test_revocations_are_scoped_per_org(self, org_id):
        agent_registry.revoke_subject(org_id, "agent", "agent-1")
        assert agent_registry.is_revoked("org_other", agent_id="agent-1") is None

    def test_revoking_twice_preserves_original_timestamp(self, org_id):
        first = agent_registry.revoke_subject(org_id, "agent", "agent-1", "first reason")
        second = agent_registry.revoke_subject(org_id, "agent", "agent-1")
        assert first["revoked_at"] == second["revoked_at"]
        assert second["reason"] == "first reason"

    def test_rejects_unknown_subject_type(self, org_id):
        with pytest.raises(agent_registry.RegistryError, match="ERR_INVALID_SUBJECT_TYPE"):
            agent_registry.revoke_subject(org_id, "provider", "x")

    def test_rejects_empty_subject_id(self, org_id):
        with pytest.raises(agent_registry.RegistryError, match="ERR_INVALID_SUBJECT_ID"):
            agent_registry.revoke_subject(org_id, "agent", "")

    def test_no_subject_supplied_is_not_a_revocation(self, org_id):
        assert agent_registry.is_revoked(org_id) is None


# ─────────────────────────────────────────────────────────────────────────────
# The acceptance matrix
# ─────────────────────────────────────────────────────────────────────────────

class TestVerifyAgentPassport:
    """Exactly one path verifies. Every other path denies, with a named reason."""

    def test_valid_passport_with_registered_key_verifies(self, org_id):
        payload, pub = mint()
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(
            org_id, payload, expected_call_sid="CA-TEST-1"
        )
        assert verdict["verified"] is True
        assert verdict["reason"] == "VERIFIED"
        assert verdict["agent_id"] == "agent-under-test"
        assert verdict["provider_npi"] == VALID_NPI
        assert verdict["scope"] == ["eligibility"]
        assert verdict["call_sid_bound"] is True

    def test_unregistered_npi_is_denied(self, org_id):
        """The core anti-spoof case: claiming an NPI you hold no key for."""
        payload, _ = mint()
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["verified"] is False
        assert verdict["reason"] == "ERR_PROVIDER_KEY_NOT_REGISTERED"

    def test_key_registered_for_a_different_npi_is_denied(self, org_id):
        payload, pub = mint(npi=VALID_NPI)
        agent_registry.register_provider_key(org_id, OTHER_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_PROVIDER_KEY_NOT_REGISTERED"

    def test_another_orgs_registration_does_not_help(self, org_id):
        """Cross-tenant isolation: org A's key must not authorise org B's call."""
        payload, pub = mint()
        agent_registry.register_provider_key("org_somebody_else", VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_PROVIDER_KEY_NOT_REGISTERED"

    def test_forged_signature_is_denied(self, org_id):
        """Signed by a key the org never registered, claiming a registered NPI."""
        genuine_priv, _ = _mgr.generate_agent_keys()
        attacker_priv, _ = _mgr.generate_agent_keys()
        payload, _ = mint(provider_priv=genuine_priv, signing_priv=attacker_priv)
        agent_registry.register_provider_key(
            org_id, VALID_NPI, _mgr.public_key_to_b64(genuine_priv.public_key())
        )
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["verified"] is False
        assert verdict["reason"] == "ERR_INVALID_SIG"

    def test_tampered_scope_is_denied(self, org_id):
        """Widening scope after signing must invalidate the signature."""
        payload, pub = mint(scope=("eligibility",))
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        payload["delegation"]["scope"] = ["eligibility", "phi_read"]
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_INVALID_SIG"

    def test_tampered_agent_id_is_denied(self, org_id):
        payload, pub = mint()
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        payload["delegation"]["agent_id"] = "some-other-agent"
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_INVALID_SIG"

    def test_agent_cosignature_from_wrong_key_is_denied(self, org_id):
        """The agent must prove it controls the key named in the delegation."""
        provider_priv, _ = _mgr.generate_agent_keys()
        real_agent_priv, real_agent_pub = _mgr.generate_agent_keys()
        impostor_priv, _ = _mgr.generate_agent_keys()
        delegation = _mgr.create_delegation(
            provider_priv, "agent-under-test", real_agent_pub, ["eligibility"],
            ttl_seconds=3600, call_sid="CA-TEST-1", provider_npi=VALID_NPI,
        )
        payload = resign(delegation, provider_priv, impostor_priv)
        agent_registry.register_provider_key(
            org_id, VALID_NPI, _mgr.public_key_to_b64(provider_priv.public_key())
        )
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_INVALID_SIG"

    def test_expired_passport_is_denied(self, org_id):
        payload, pub = mint(ttl_seconds=-10)
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_EXPIRED"

    def test_replayed_on_a_different_call_is_denied(self, org_id):
        payload, pub = mint(call_sid="CA-ORIGINAL")
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(
            org_id, payload, expected_call_sid="CA-DIFFERENT"
        )
        assert verdict["reason"] == "ERR_NONCE_MISMATCH"

    def test_call_sid_binding_is_recorded_as_unchecked_when_omitted(self, org_id):
        payload, pub = mint(call_sid="CA-ORIGINAL")
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["verified"] is True
        assert verdict["call_sid_bound"] is False

    def test_revoked_agent_is_denied_despite_valid_signature(self, org_id):
        payload, pub = mint()
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        agent_registry.revoke_subject(org_id, "agent", "agent-under-test")
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_REVOKED:agent"

    def test_revoked_delegation_is_denied(self, org_id):
        payload, pub = mint()
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        agent_registry.revoke_subject(
            org_id, "delegation", payload["delegation"]["delegation_id"]
        )
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_REVOKED:delegation"

    def test_revoked_provider_key_invalidates_unexpired_delegations(self, org_id):
        payload, pub = mint()
        row = agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        assert agent_authorization.verify_agent_passport(org_id, payload)["verified"] is True
        agent_registry.revoke_provider_key(org_id, row["key_id"])
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_PROVIDER_KEY_NOT_REGISTERED"

    def test_verifies_against_the_second_of_two_rotated_keys(self, org_id):
        _, old_pub = mint()
        payload, new_pub = mint()
        agent_registry.register_provider_key(org_id, VALID_NPI, old_pub)
        agent_registry.register_provider_key(org_id, VALID_NPI, new_pub)
        assert agent_authorization.verify_agent_passport(org_id, payload)["verified"] is True

    def test_malformed_npi_is_denied_before_any_key_lookup(self, org_id):
        payload, pub = mint()
        payload["delegation"]["provider_npi"] = "12345"
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_INVALID_NPI"

    def test_naive_expiry_is_denied(self, org_id):
        """
        A timestamp with no UTC offset would be read in the server's local
        timezone, letting a caller widen its own expiry window.
        """
        provider_priv, _ = _mgr.generate_agent_keys()
        agent_priv, agent_pub = _mgr.generate_agent_keys()
        naive = (datetime.now(timezone.utc) + timedelta(hours=1)).replace(tzinfo=None)
        delegation = Delegation(
            provider_npi=VALID_NPI,
            agent_id="agent-under-test",
            agent_public_key_b64=_mgr.public_key_to_b64(agent_pub),
            scope=["eligibility"],
            expires_at=naive.isoformat(),
            created_at=datetime.now(timezone.utc).isoformat(),
            delegation_id=str(uuid.uuid4()),
            call_sid="CA-TEST-1",
            nonce=uuid.uuid4().hex,
        )
        payload = resign(delegation, provider_priv, agent_priv)
        agent_registry.register_provider_key(
            org_id, VALID_NPI, _mgr.public_key_to_b64(provider_priv.public_key())
        )
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_EXPIRY_NOT_TIMEZONE_AWARE"

    def test_unparseable_expiry_is_denied(self, org_id):
        payload, pub = mint()
        payload["delegation"]["expires_at"] = "whenever"
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["reason"] == "ERR_EXPIRY_NOT_TIMEZONE_AWARE"

    def test_malformed_payload_is_a_verdict_not_an_exception(self, org_id):
        verdict = agent_authorization.verify_agent_passport(org_id, {"nonsense": 1})
        assert verdict["verified"] is False
        assert verdict["reason"].startswith("ERR_PASSPORT_MISSING_FIELDS")
        assert verdict["scope"] == []

    def test_insufficient_scope_is_denied_when_checked_at_presentation(self, org_id):
        payload, pub = mint(scope=("eligibility",))
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(
            org_id, payload, required_scope=["phi_read"]
        )
        assert verdict["reason"] == "ERR_SCOPE_VIOLATION"

    def test_a_failed_verdict_never_carries_scope(self, org_id):
        payload, _ = mint(scope=("eligibility", "phi_read"))
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        assert verdict["verified"] is False
        assert verdict["scope"] == []


# ─────────────────────────────────────────────────────────────────────────────
# Session persistence
# ─────────────────────────────────────────────────────────────────────────────

class TestSessionPersistence:
    @staticmethod
    def _session(org_id):
        from saas_layer.voice_sessions import create_voice_session
        session_id = f"vs_{uuid.uuid4().hex[:12]}"
        create_voice_session(session_id, org_id, provider="api")
        return session_id

    def test_new_session_has_no_authorization(self, org_id):
        from saas_layer.voice_sessions import get_voice_session
        session_id = self._session(org_id)
        assert get_voice_session(session_id)["authorization"] is None

    def test_verdict_round_trips(self, org_id):
        from saas_layer.voice_sessions import (
            get_voice_session, set_voice_session_authorization,
        )
        payload, pub = mint(scope=("eligibility", "claims_status"))
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)

        session_id = self._session(org_id)
        set_voice_session_authorization(
            session_id, agent_authorization.verdict_for_session(verdict)
        )

        stored = get_voice_session(session_id)["authorization"]
        assert stored["verified"] is True
        assert stored["reason"] == "VERIFIED"
        assert stored["agent_id"] == "agent-under-test"
        assert stored["provider_npi"] == VALID_NPI
        assert stored["delegation_id"] == payload["delegation"]["delegation_id"]
        assert stored["scope"] == ["eligibility", "claims_status"]

    def test_rejected_passport_is_persisted_not_discarded(self, org_id):
        """A refused impersonation attempt must remain visible afterwards."""
        from saas_layer.voice_sessions import (
            get_voice_session, set_voice_session_authorization,
        )
        payload, _ = mint()
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        session_id = self._session(org_id)
        set_voice_session_authorization(
            session_id, agent_authorization.verdict_for_session(verdict)
        )
        stored = get_voice_session(session_id)["authorization"]
        assert stored["verified"] is False
        assert stored["reason"] == "ERR_PROVIDER_KEY_NOT_REGISTERED"

    def test_rejection_is_distinguishable_from_absence(self, org_id):
        """
        verified=False and authorization=None must not collapse into each other:
        the policy engine treats them differently.
        """
        from saas_layer.voice_sessions import (
            get_voice_session, set_voice_session_authorization,
        )
        absent = self._session(org_id)
        rejected = self._session(org_id)
        set_voice_session_authorization(
            rejected, {"verified": False, "reason": "ERR_INVALID_SIG",
                       "agent_id": None, "provider_npi": None,
                       "delegation_id": None, "scope": []},
        )
        assert get_voice_session(absent)["authorization"] is None
        assert get_voice_session(rejected)["authorization"]["verified"] is False

    def test_unparseable_stored_scope_does_not_read_as_wide_open(self, org_id):
        from saas_layer.voice_sessions import get_voice_session
        session_id = self._session(org_id)
        conn = get_conn()
        try:
            with conn:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE voice_sessions SET auth_verified = TRUE, auth_reason = 'VERIFIED', "
                    "auth_scope = %s WHERE session_id = %s",
                    ("{not json", session_id),
                )
        finally:
            conn.close()
        assert get_voice_session(session_id)["authorization"]["scope"] == []

    def test_a_later_verdict_replaces_an_earlier_one(self, org_id):
        from saas_layer.voice_sessions import (
            get_voice_session, set_voice_session_authorization,
        )
        session_id = self._session(org_id)
        set_voice_session_authorization(
            session_id, {"verified": True, "reason": "VERIFIED", "agent_id": "a1",
                         "provider_npi": VALID_NPI, "delegation_id": "d1",
                         "scope": ["eligibility"]},
        )
        set_voice_session_authorization(
            session_id, {"verified": False, "reason": "ERR_REVOKED:agent", "agent_id": "a1",
                         "provider_npi": VALID_NPI, "delegation_id": "d1", "scope": []},
        )
        stored = get_voice_session(session_id)["authorization"]
        assert stored["verified"] is False
        assert stored["reason"] == "ERR_REVOKED:agent"


# ─────────────────────────────────────────────────────────────────────────────
# The closed loop: a verdict changes the enforcement decision
# ─────────────────────────────────────────────────────────────────────────────

def _auth_rule(required=True, required_scope=None):
    return [{
        "rule_key": "REQUIRE_AGENT_AUTHORIZATION",
        "rule_type": "authorization",
        "enabled": True,
        "priority": -1,
        "params": {"required": required, "required_scope": required_scope},
    }]


_CONFIRMED = {"disclosure_confirmed": True}


class TestPolicyLoop:
    def test_verified_verdict_allows_the_turn(self, org_id):
        payload, pub = mint()
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        state = {**_CONFIRMED, "authorization": verdict}
        assert run_voice_policy("check eligibility", state, ruleset=_auth_rule())["action"] == "allow"

    def test_rejected_verdict_denies_the_turn(self, org_id):
        payload, _ = mint()
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        state = {**_CONFIRMED, "authorization": verdict}
        decision = run_voice_policy("check eligibility", state, ruleset=_auth_rule())
        assert decision["action"] == "deny"
        assert decision["reason_code"] == "AGENT_NOT_AUTHORIZED"

    def test_no_credential_denies_when_required(self):
        state = {**_CONFIRMED, "authorization": None}
        decision = run_voice_policy("check eligibility", state, ruleset=_auth_rule(required=True))
        assert decision["action"] == "deny"
        assert decision["reason_code"] == "AGENT_NOT_AUTHORIZED"

    def test_no_credential_passes_when_not_required(self):
        state = {**_CONFIRMED, "authorization": None}
        assert run_voice_policy(
            "check eligibility", state, ruleset=_auth_rule(required=False)
        )["action"] == "allow"

    def test_bad_credential_denies_even_when_not_required(self, org_id):
        """
        The default posture claim: `required: False` means "a credential is
        optional", never "a bad credential is acceptable".
        """
        payload, _ = mint()
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        state = {**_CONFIRMED, "authorization": verdict}
        decision = run_voice_policy(
            "check eligibility", state, ruleset=_auth_rule(required=False)
        )
        assert decision["action"] == "deny"
        assert decision["reason_code"] == "AGENT_NOT_AUTHORIZED"

    def test_verified_but_out_of_scope_is_denied(self, org_id):
        payload, pub = mint(scope=("eligibility",))
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        state = {**_CONFIRMED, "authorization": verdict}
        decision = run_voice_policy(
            "read me the chart notes", state,
            ruleset=_auth_rule(required_scope="phi_read"),
        )
        assert decision["action"] == "deny"
        assert decision["reason_code"] == "AGENT_SCOPE_INSUFFICIENT"

    def test_verified_and_in_scope_is_allowed(self, org_id):
        payload, pub = mint(scope=("eligibility", "phi_read"))
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        state = {**_CONFIRMED, "authorization": verdict}
        assert run_voice_policy(
            "read me the chart notes", state,
            ruleset=_auth_rule(required_scope="phi_read"),
        )["action"] == "allow"

    def test_authorization_outranks_disclosure(self, org_id):
        """
        An unauthorised agent is denied before it is invited to read the
        disclosure script — otherwise an impostor gets a turn to speak.
        """
        payload, _ = mint()
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        state = {"disclosure_confirmed": False, "authorization": verdict}
        decision = run_voice_policy("hello", state, ruleset=DEFAULT_RULESET)
        assert decision["action"] == "deny"
        assert decision["reason_code"] == "AGENT_NOT_AUTHORIZED"


class TestDefaultRuleset:
    def test_authorization_rule_is_present(self):
        keys = [r["rule_key"] for r in DEFAULT_RULESET]
        assert "REQUIRE_AGENT_AUTHORIZATION" in keys

    def test_authorization_rule_is_evaluated_first(self):
        by_priority = sorted(DEFAULT_RULESET, key=lambda r: r["priority"])
        assert by_priority[0]["rule_key"] == "REQUIRE_AGENT_AUTHORIZATION"

    def test_authorization_is_not_required_by_default(self):
        """
        Shipping `required: True` would deny every call for every org that has
        not yet registered a provider key. The default must not do that.
        """
        rule = next(r for r in DEFAULT_RULESET if r["rule_key"] == "REQUIRE_AGENT_AUTHORIZATION")
        assert rule["params"]["required"] is False

    def test_default_ruleset_allows_an_ordinary_call_with_no_credential(self):
        """Regression guard: adding the rule must not break existing orgs."""
        decision = run_voice_policy(
            "I have a question about a claim", _CONFIRMED, ruleset=DEFAULT_RULESET
        )
        assert decision["action"] == "allow"

    def test_default_ruleset_still_discloses_on_first_turn(self):
        decision = run_voice_policy("hello", {}, ruleset=DEFAULT_RULESET)
        assert decision["action"] == "disclose"

    def test_default_ruleset_still_escalates(self):
        decision = run_voice_policy(
            "I want to speak to a human", _CONFIRMED, ruleset=DEFAULT_RULESET
        )
        assert decision["action"] == "escalate"


# ─────────────────────────────────────────────────────────────────────────────
# End to end: real HTTP, real database, real audit chain
# ─────────────────────────────────────────────────────────────────────────────

class TestEndToEnd:
    """
    The whole path, with nothing mocked but the API-key lookup: register a
    provider key, place a call presenting a passport, then take a turn and see
    the policy engine act on the verdict.
    """

    @pytest.fixture
    def client(self, org_id):
        from fastapi.testclient import TestClient
        from saas_layer.gateway import app, get_current_org
        org = {"org_id": org_id, "org_name": "Test Dental Group", "plan": "free"}
        app.dependency_overrides[get_current_org] = lambda: org
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.pop(get_current_org, None)
            # audit_traces is deliberately NOT cleaned up: a Postgres trigger
            # rejects DELETE on it, which is the append-only guarantee doing its
            # job. Each test uses a fresh org_id, so the rows are inert.
            conn = get_conn()
            try:
                with conn:
                    conn.cursor().execute(
                        "DELETE FROM usage_log WHERE org_id = %s", (org_id,)
                    )
            finally:
                conn.close()

    def test_authorized_agent_completes_a_call(self, client, org_id):
        payload, pub = mint(call_sid="CA-E2E-1", scope=("eligibility",))

        r = client.post("/saas/agent-registry/provider-keys", json={
            "provider_npi": VALID_NPI, "public_key_b64": pub, "label": "Dr Smith",
        })
        assert r.status_code == 200, r.text

        r = client.post("/saas/voice/incoming", json={
            "caller_id": "+15555550100",
            "agent_passport": payload,
            "call_sid": "CA-E2E-1",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["authorization"]["verified"] is True
        assert body["authorization"]["provider_npi"] == VALID_NPI
        assert body["authorization"]["call_sid_bound"] is True
        session_id = body["session_id"]

        r = client.post("/saas/voice/transcript", json={
            "session_id": session_id,
            "transcript_text": "Checking eligibility for member 12345.",
            "turn_number": 1,
        })
        assert r.status_code == 200, r.text
        assert r.json()["action"] in ("allow", "disclose")

    def test_unauthorized_agent_is_denied_at_the_turn(self, client, org_id):
        """
        The end the product exists for: an agent claiming an NPI it cannot prove
        is refused, and the refusal is recorded.
        """
        genuine_priv, _ = _mgr.generate_agent_keys()
        attacker_priv, _ = _mgr.generate_agent_keys()
        forged, _ = mint(provider_priv=genuine_priv, signing_priv=attacker_priv,
                         call_sid="CA-E2E-2")
        client.post("/saas/agent-registry/provider-keys", json={
            "provider_npi": VALID_NPI,
            "public_key_b64": _mgr.public_key_to_b64(genuine_priv.public_key()),
        })

        r = client.post("/saas/voice/incoming", json={
            "caller_id": "+15555550199",
            "agent_passport": forged,
            "call_sid": "CA-E2E-2",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["authorization"]["verified"] is False
        assert body["authorization"]["reason"] == "ERR_INVALID_SIG"
        session_id = body["session_id"]

        r = client.post("/saas/voice/transcript", json={
            "session_id": session_id,
            "transcript_text": "I need the patient's date of birth.",
            "turn_number": 1,
        })
        assert r.status_code == 200, r.text
        decision = r.json()
        assert decision["action"] == "deny"
        assert decision["reason_code"] == "AGENT_NOT_AUTHORIZED"

    def test_call_with_no_passport_still_works(self, client):
        """Regression guard for every org not yet using credentials."""
        r = client.post("/saas/voice/incoming", json={"caller_id": "+15555550111"})
        assert r.status_code == 200, r.text
        assert r.json()["authorization"] is None
        session_id = r.json()["session_id"]

        r = client.post("/saas/voice/transcript", json={
            "session_id": session_id,
            "transcript_text": "Hello, I am calling about a claim.",
            "turn_number": 1,
        })
        assert r.status_code == 200
        assert r.json()["action"] != "deny"

    def test_passport_can_be_presented_after_call_setup(self, client, org_id):
        payload, pub = mint(call_sid="CA-E2E-3")
        client.post("/saas/agent-registry/provider-keys", json={
            "provider_npi": VALID_NPI, "public_key_b64": pub,
        })
        session_id = client.post("/saas/voice/incoming", json={}).json()["session_id"]

        r = client.post("/saas/voice/authorize", json={
            "session_id": session_id, "agent_passport": payload, "call_sid": "CA-E2E-3",
        })
        assert r.status_code == 200, r.text
        assert r.json()["authorization"]["verified"] is True

    def test_authorize_rejects_a_session_from_another_org(self, client, org_id):
        from saas_layer.voice_sessions import create_voice_session
        other_session = f"vs_{uuid.uuid4().hex[:12]}"
        create_voice_session(other_session, "org_not_yours", provider="api")
        payload, _ = mint()
        try:
            r = client.post("/saas/voice/authorize", json={
                "session_id": other_session, "agent_passport": payload,
            })
            assert r.status_code == 403
        finally:
            conn = get_conn()
            try:
                with conn:
                    conn.cursor().execute(
                        "DELETE FROM voice_sessions WHERE session_id = %s", (other_session,)
                    )
            finally:
                conn.close()

    def test_authorize_404s_for_an_unknown_session(self, client):
        payload, _ = mint()
        r = client.post("/saas/voice/authorize", json={
            "session_id": "vs_nonexistent", "agent_passport": payload,
        })
        assert r.status_code == 404

    def test_rejected_authorization_is_in_the_audit_chain(self, client, org_id):
        """The refusal must be recorded in the tamper-evident log, not just logged."""
        from saas_layer.audit import verify_chain
        payload, _ = mint(call_sid="CA-E2E-4")
        session_id = client.post("/saas/voice/incoming", json={
            "agent_passport": payload, "call_sid": "CA-E2E-4",
        }).json()["session_id"]

        conn = get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT event_type, policy_action, reason_code, input_text "
                "FROM audit_traces WHERE org_id = %s AND session_id = %s "
                "ORDER BY seq_num",
                (org_id, session_id),
            )
            rows = [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

        auth_events = [r for r in rows if r["event_type"] == "voice_agent_authorization"]
        assert len(auth_events) == 1
        assert auth_events[0]["policy_action"] == "deny"
        assert auth_events[0]["reason_code"] == "ERR_PROVIDER_KEY_NOT_REGISTERED"
        assert VALID_NPI in auth_events[0]["input_text"]

        # Adding a new event type must not break chain verification.
        result = verify_chain(org_id, session_id)
        assert result["chain_valid"] is True

    def test_audit_trail_carries_no_key_material(self, client, org_id):
        payload, pub = mint(call_sid="CA-E2E-5")
        client.post("/saas/agent-registry/provider-keys", json={
            "provider_npi": VALID_NPI, "public_key_b64": pub,
        })
        session_id = client.post("/saas/voice/incoming", json={
            "agent_passport": payload, "call_sid": "CA-E2E-5",
        }).json()["session_id"]

        conn = get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT input_text FROM audit_traces WHERE org_id = %s AND session_id = %s",
                (org_id, session_id),
            )
            blob = " ".join(str(r["input_text"] or "") for r in cur.fetchall())
        finally:
            conn.close()

        assert payload["signature_b64"] not in blob
        assert payload["agent_signature_b64"] not in blob
        assert payload["delegation"]["agent_public_key_b64"] not in blob
        assert pub not in blob

    def test_registry_rejects_a_malformed_key_over_http(self, client):
        r = client.post("/saas/agent-registry/provider-keys", json={
            "provider_npi": VALID_NPI, "public_key_b64": "obviously-not-a-key",
        })
        assert r.status_code == 400
        assert "ERR_INVALID_PUBLIC_KEY" in r.text

    def test_revoking_an_agent_over_http_denies_its_next_call(self, client, org_id):
        payload, pub = mint(agent_id="agent-to-revoke", call_sid="CA-E2E-6")
        client.post("/saas/agent-registry/provider-keys", json={
            "provider_npi": VALID_NPI, "public_key_b64": pub,
        })
        r = client.post("/saas/agent-registry/revocations", json={
            "subject_type": "agent", "subject_id": "agent-to-revoke", "reason": "key leaked",
        })
        assert r.status_code == 200, r.text

        body = client.post("/saas/voice/incoming", json={
            "agent_passport": payload, "call_sid": "CA-E2E-6",
        }).json()
        assert body["authorization"]["verified"] is False
        assert body["authorization"]["reason"] == "ERR_REVOKED:agent"


class TestCheckAuthorizationContract:
    """The verdict shape this module produces must satisfy the existing gate."""

    def test_verdict_fields_are_what_check_authorization_reads(self, org_id):
        payload, pub = mint(scope=("eligibility",))
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        result = check_authorization({"authorization": verdict}, required_scope="eligibility")
        assert result["ok"] is True

    def test_verdict_for_session_keeps_the_fields_the_gate_needs(self, org_id):
        payload, pub = mint(scope=("eligibility",))
        agent_registry.register_provider_key(org_id, VALID_NPI, pub)
        verdict = agent_authorization.verify_agent_passport(org_id, payload)
        reduced = agent_authorization.verdict_for_session(verdict)
        result = check_authorization({"authorization": reduced}, required_scope="eligibility")
        assert result["ok"] is True
