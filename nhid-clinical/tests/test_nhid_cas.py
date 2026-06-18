import pytest
from src.nhid_policy_engine_v1 import BoundaryViolation, ViolationSeverity
from src.nhid_cas import (
    NocfInputs, compute_f_iaf, compute_nocf, compute_ecf, tier_for_cas, compute_cas,
    ATR_REQUIRED_FIELDS,
)

PERFECT_NOCF_INPUTS = NocfInputs(
    entity_match_rate=1.0, intent_accuracy=1.0, domain_hit_rate=1.0,
    successful_actions=10, attempted_actions=10,
    call_drop_rate=0.0, audio_corruption_rate=0.0, tool_failure_rate=0.0,
    latency_ms=0.0,
    hallucination_risk=0.0, pii_leakage_risk=0.0, identity_ambiguity_risk=0.0,
)

COMPLETE_AUDIT_EVENT = {f: "x" for f in ATR_REQUIRED_FIELDS}


def _violation(rule_id, severity):
    return BoundaryViolation(rule_id=rule_id, description="test", severity=severity)


# -- F_IAF --------------------------------------------------------------

def test_f_iaf_is_1_with_no_violations():
    assert compute_f_iaf([]) == 1.0


def test_f_iaf_is_1_with_non_identity_critical_violation():
    assert compute_f_iaf([_violation("DBC-01", ViolationSeverity.CRITICAL)]) == 1.0


def test_f_iaf_is_0_for_idg01_critical():
    assert compute_f_iaf([_violation("IDG-01", ViolationSeverity.CRITICAL)]) == 0.0


def test_f_iaf_is_0_for_pdx01_critical():
    assert compute_f_iaf([_violation("PDX-01", ViolationSeverity.CRITICAL)]) == 0.0


def test_f_iaf_is_1_for_idg01_major_not_critical():
    assert compute_f_iaf([_violation("IDG-01", ViolationSeverity.MAJOR)]) == 1.0


# -- NOCF -----------------------------------------------------------------

def test_nocf_perfect_inputs_yields_1():
    assert compute_nocf(PERFECT_NOCF_INPUTS) == pytest.approx(1.0)


def test_nocf_zero_execution_rate_zeroes_score():
    inputs = NocfInputs(**{**PERFECT_NOCF_INPUTS.__dict__, "successful_actions": 0})
    assert compute_nocf(inputs) == 0.0


def test_nocf_no_attempted_actions_yields_zero_execution():
    inputs = NocfInputs(**{**PERFECT_NOCF_INPUTS.__dict__, "successful_actions": 0, "attempted_actions": 0})
    assert compute_nocf(inputs) == 0.0


def test_nocf_high_risk_reduces_score():
    inputs = NocfInputs(**{**PERFECT_NOCF_INPUTS.__dict__, "hallucination_risk": 1.0, "pii_leakage_risk": 1.0, "identity_ambiguity_risk": 1.0})
    assert compute_nocf(inputs) == pytest.approx(0.0)


def test_nocf_latency_above_l_max_floors_at_zero():
    inputs = NocfInputs(**{**PERFECT_NOCF_INPUTS.__dict__, "latency_ms": 999999})
    assert compute_nocf(inputs) == 0.0


def test_nocf_call_quality_degradation_lowers_stability():
    inputs = NocfInputs(**{**PERFECT_NOCF_INPUTS.__dict__, "call_drop_rate": 1.0, "audio_corruption_rate": 1.0, "tool_failure_rate": 1.0})
    assert compute_nocf(inputs) == 0.0


def test_nocf_clamped_to_unit_interval():
    assert 0.0 <= compute_nocf(PERFECT_NOCF_INPUTS) <= 1.0


# -- ECF -----------------------------------------------------------------

def test_ecf_full_when_all_fields_present():
    assert compute_ecf(COMPLETE_AUDIT_EVENT) == 1.0


def test_ecf_partial_when_fields_missing():
    partial = dict(COMPLETE_AUDIT_EVENT)
    del partial["actor_id"]
    del partial["replay_mode"]
    expected = (len(ATR_REQUIRED_FIELDS) - 2) / len(ATR_REQUIRED_FIELDS)
    assert compute_ecf(partial) == pytest.approx(expected)


def test_ecf_zero_for_empty_event():
    assert compute_ecf({}) == 0.0


# -- Tier ladder -----------------------------------------------------------

@pytest.mark.parametrize("cas,expected_tier,expected_badge", [
    (0.95, "Verified Trust", "L2"),
    (0.90, "Verified Trust", "L2"),
    (0.80, "Conditional Trust", "L1"),
    (0.75, "Conditional Trust", "L1"),
    (0.60, "Review Required", None),
    (0.50, "Review Required", None),
    (0.30, "Denied / Degraded", None),
    (0.20, "Denied / Degraded", None),
    (0.05, "Hard Denial", None),
])
def test_tier_for_cas(cas, expected_tier, expected_badge):
    tier, badge = tier_for_cas(cas)
    assert tier == expected_tier
    assert badge == expected_badge


# -- compute_cas end-to-end -------------------------------------------------

def test_compute_cas_perfect_call_is_verified_trust():
    result = compute_cas([], PERFECT_NOCF_INPUTS, COMPLETE_AUDIT_EVENT)
    assert result.cas == pytest.approx(1.0)
    assert result.tier == "Verified Trust"
    assert result.badge == "L2"


def test_compute_cas_identity_violation_forces_hard_denial():
    result = compute_cas([_violation("IDG-01", ViolationSeverity.CRITICAL)], PERFECT_NOCF_INPUTS, COMPLETE_AUDIT_EVENT)
    assert result.cas == 0.0
    assert result.tier == "Hard Denial"


def test_compute_cas_is_multiplicative_not_additive():
    # A single zeroed factor must zero the whole score, even if the others are perfect.
    result = compute_cas([], PERFECT_NOCF_INPUTS, {})
    assert result.cas == 0.0
