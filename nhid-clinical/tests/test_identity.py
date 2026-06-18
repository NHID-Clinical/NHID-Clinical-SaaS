import time
import pytest
from src.agent_identity import AgentIdentityManager

VALID_NPI = "1234567890"


def _issue(m, agent_id="agent-1", scope=("eligibility",), ttl_seconds=86400, call_sid="CA-1", npi=VALID_NPI):
    prov_priv, prov_pub = m.generate_agent_keys()
    agent_priv, agent_pub = m.generate_agent_keys()
    delegation = m.create_delegation(
        prov_priv, agent_id, agent_pub, list(scope),
        ttl_seconds=ttl_seconds, call_sid=call_sid, provider_npi=npi,
    )
    sig = m.sign_delegation(prov_priv, delegation)
    passport = m.create_agent_passport(delegation, sig, agent_priv)
    return prov_priv, prov_pub, agent_priv, agent_pub, passport


def test_key_generation():
    m = AgentIdentityManager()
    priv, pub = m.generate_agent_keys()
    assert priv is not None
    assert pub is not None


def test_public_key_roundtrip():
    m = AgentIdentityManager()
    _, pub = m.generate_agent_keys()
    b64 = m.public_key_to_b64(pub)
    restored = m.b64_to_public_key(b64)
    assert m.public_key_to_b64(restored) == b64


def test_delegation_creation_and_verification():
    m = AgentIdentityManager()
    _, prov_pub, _, _, passport = _issue(m, agent_id="agent-1")
    result = m.verify_passport(passport, prov_pub, call_sid="CA-1")
    assert result.valid
    assert result.agent_id == "agent-1"
    assert result.provider_npi == VALID_NPI
    assert result.scope == ["eligibility"]


def test_delegation_id_is_uuid_v4():
    import uuid
    m = AgentIdentityManager()
    _, _, _, _, passport = _issue(m)
    parsed = uuid.UUID(passport.delegation.delegation_id)
    assert parsed.version == 4


def test_expired_delegation():
    m = AgentIdentityManager()
    _, prov_pub, _, _, passport = _issue(m, agent_id="agent-2", ttl_seconds=-1)
    result = m.verify_passport(passport, prov_pub, call_sid="CA-1")
    assert not result.valid
    assert result.reason == "ERR_EXPIRED"


def test_revoke_agent():
    m = AgentIdentityManager()
    _, prov_pub, _, _, passport = _issue(m, agent_id="agent-3")
    m.revoke_agent("agent-3")
    result = m.verify_passport(passport, prov_pub, call_sid="CA-1")
    assert not result.valid
    assert result.reason == "ERR_REVOKED"


def test_revoke_delegation():
    m = AgentIdentityManager()
    _, prov_pub, _, _, passport = _issue(m, agent_id="agent-4")
    m.revoke_delegation(passport.delegation.delegation_id)
    result = m.verify_passport(passport, prov_pub, call_sid="CA-1")
    assert not result.valid
    assert result.reason == "ERR_REVOKED"


def test_revocation_is_per_agent_not_global():
    m = AgentIdentityManager()
    prov_priv, prov_pub = m.generate_agent_keys()

    agent_a_priv, agent_a_pub = m.generate_agent_keys()
    d_a = m.create_delegation(prov_priv, "agent-5", agent_a_pub, ["eligibility"], call_sid="CA-1", provider_npi=VALID_NPI)
    sig_a = m.sign_delegation(prov_priv, d_a)
    passport_a = m.create_agent_passport(d_a, sig_a, agent_a_priv)

    agent_b_priv, agent_b_pub = m.generate_agent_keys()
    d_b = m.create_delegation(prov_priv, "agent-6", agent_b_pub, ["eligibility"], call_sid="CA-1", provider_npi=VALID_NPI)
    sig_b = m.sign_delegation(prov_priv, d_b)
    passport_b = m.create_agent_passport(d_b, sig_b, agent_b_priv)

    m.revoke_agent("agent-5")
    assert not m.verify_passport(passport_a, prov_pub, call_sid="CA-1").valid
    assert m.verify_passport(passport_b, prov_pub, call_sid="CA-1").valid


def test_invalid_provider_npi_rejected_at_creation():
    m = AgentIdentityManager()
    prov_priv, prov_pub = m.generate_agent_keys()
    _, agent_pub = m.generate_agent_keys()
    with pytest.raises(ValueError):
        m.create_delegation(prov_priv, "agent-7", agent_pub, ["eligibility"], provider_npi="not-an-npi")


def test_invalid_provider_npi_too_short():
    m = AgentIdentityManager()
    prov_priv, prov_pub = m.generate_agent_keys()
    _, agent_pub = m.generate_agent_keys()
    with pytest.raises(ValueError):
        m.create_delegation(prov_priv, "agent-8", agent_pub, ["eligibility"], provider_npi="123")


def test_call_sid_nonce_mismatch_rejected():
    m = AgentIdentityManager()
    _, prov_pub, _, _, passport = _issue(m, agent_id="agent-9", call_sid="CA-original")
    result = m.verify_passport(passport, prov_pub, call_sid="CA-different")
    assert not result.valid
    assert result.reason == "ERR_NONCE_MISMATCH"


def test_call_sid_match_accepted():
    m = AgentIdentityManager()
    _, prov_pub, _, _, passport = _issue(m, agent_id="agent-10", call_sid="CA-match")
    result = m.verify_passport(passport, prov_pub, call_sid="CA-match")
    assert result.valid


def test_required_scope_satisfied():
    m = AgentIdentityManager()
    _, prov_pub, _, _, passport = _issue(m, agent_id="agent-11", scope=("claim_status_inquiry", "eligibility"))
    result = m.verify_passport(passport, prov_pub, call_sid="CA-1", required_scope=["eligibility"])
    assert result.valid


def test_required_scope_violation():
    m = AgentIdentityManager()
    _, prov_pub, _, _, passport = _issue(m, agent_id="agent-12", scope=("eligibility",))
    result = m.verify_passport(passport, prov_pub, call_sid="CA-1", required_scope=["claim_status_inquiry"])
    assert not result.valid
    assert result.reason == "ERR_SCOPE_VIOLATION"


def test_tampered_signature_rejected():
    m = AgentIdentityManager()
    _, prov_pub, _, _, passport = _issue(m, agent_id="agent-13")
    passport.delegation.scope = ["something_else"]
    result = m.verify_passport(passport, prov_pub, call_sid="CA-1")
    assert not result.valid
    assert result.reason == "ERR_INVALID_SIG"


def test_wrong_provider_key_rejected():
    m = AgentIdentityManager()
    _, _, _, _, passport = _issue(m, agent_id="agent-14")
    _, other_prov_pub = m.generate_agent_keys()
    result = m.verify_passport(passport, other_prov_pub, call_sid="CA-1")
    assert not result.valid
    assert result.reason == "ERR_INVALID_SIG"


def test_validate_chain_single_hop_valid():
    m = AgentIdentityManager()
    prov_priv, prov_pub = m.generate_agent_keys()
    agent_priv, agent_pub = m.generate_agent_keys()
    delegation = m.create_delegation(prov_priv, "agent-15", agent_pub, ["eligibility"], call_sid="CA-1", provider_npi=VALID_NPI)
    sig = m.sign_delegation(prov_priv, delegation)
    passport = m.create_agent_passport(delegation, sig, agent_priv)
    result = m.validate_chain([passport], prov_pub)
    assert result.valid


def test_validate_chain_narrowing_scope_accepted():
    m = AgentIdentityManager()
    prov_priv, prov_pub = m.generate_agent_keys()

    agent1_priv, agent1_pub = m.generate_agent_keys()
    d1 = m.create_delegation(prov_priv, "vendor", agent1_pub, ["eligibility", "claim_status_inquiry"], call_sid="CA-1", provider_npi=VALID_NPI)
    sig1 = m.sign_delegation(prov_priv, d1)
    p1 = m.create_agent_passport(d1, sig1, agent1_priv)

    agent2_priv, agent2_pub = m.generate_agent_keys()
    d2 = m.create_delegation(prov_priv, "sub-vendor", agent2_pub, ["eligibility"], call_sid="CA-1", provider_npi=VALID_NPI)
    sig2 = m.sign_delegation(prov_priv, d2)
    p2 = m.create_agent_passport(d2, sig2, agent2_priv)

    result = m.validate_chain([p1, p2], prov_pub)
    assert result.valid
    assert result.scope == ["eligibility"]


def test_validate_chain_expansion_rejected():
    m = AgentIdentityManager()
    prov_priv, prov_pub = m.generate_agent_keys()

    agent1_priv, agent1_pub = m.generate_agent_keys()
    d1 = m.create_delegation(prov_priv, "vendor", agent1_pub, ["eligibility"], call_sid="CA-1", provider_npi=VALID_NPI)
    sig1 = m.sign_delegation(prov_priv, d1)
    p1 = m.create_agent_passport(d1, sig1, agent1_priv)

    agent2_priv, agent2_pub = m.generate_agent_keys()
    d2 = m.create_delegation(prov_priv, "sub-vendor", agent2_pub, ["eligibility", "claim_status_inquiry"], call_sid="CA-1", provider_npi=VALID_NPI)
    sig2 = m.sign_delegation(prov_priv, d2)
    p2 = m.create_agent_passport(d2, sig2, agent2_priv)

    result = m.validate_chain([p1, p2], prov_pub)
    assert not result.valid
    assert result.reason == "ERR_CHAIN_NARROWING"


def test_validate_chain_too_long_rejected():
    m = AgentIdentityManager()
    prov_priv, prov_pub = m.generate_agent_keys()
    passports = []
    for i in range(4):
        agent_priv, agent_pub = m.generate_agent_keys()
        d = m.create_delegation(prov_priv, f"agent-chain-{i}", agent_pub, ["eligibility"], call_sid="CA-1", provider_npi=VALID_NPI)
        sig = m.sign_delegation(prov_priv, d)
        passports.append(m.create_agent_passport(d, sig, agent_priv))
    result = m.validate_chain(passports, prov_pub)
    assert not result.valid
    assert result.reason == "ERR_CHAIN_TOO_LONG"


def test_validate_chain_propagates_inner_failure():
    m = AgentIdentityManager()
    prov_priv, prov_pub = m.generate_agent_keys()
    agent_priv, agent_pub = m.generate_agent_keys()
    d = m.create_delegation(prov_priv, "agent-expired", agent_pub, ["eligibility"], ttl_seconds=-1, call_sid="CA-1", provider_npi=VALID_NPI)
    sig = m.sign_delegation(prov_priv, d)
    passport = m.create_agent_passport(d, sig, agent_priv)
    result = m.validate_chain([passport], prov_pub)
    assert not result.valid
    assert result.reason == "ERR_EXPIRED"
