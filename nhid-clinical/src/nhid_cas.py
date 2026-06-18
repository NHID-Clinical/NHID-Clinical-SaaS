"""NHID-CAS - Call Authorization Score

CAS is a continuous compliance signal in [0.0, 1.0] per call session,
computed from policy-engine violations plus call-quality/risk telemetry.

Formula: CAS = F_IAF x F_NOCF x ECF
  F_IAF (Identity Assurance Factor)    {0.0, 1.0}
  F_NOCF (Operational Conformance Factor) [0.0, 1.0]
  ECF (Evidence Completeness Factor)   [0.0, 1.0]

NOCF sub-formula:
  C (coherence) = (entity_match_rate + intent_accuracy + domain_hit_rate) / 3
  E (execution)  = successful_actions / attempted_actions
  S (stability)  = 1 - (call_drop_rate + audio_corruption_rate + tool_failure_rate) / 3
  L_hat          = max(0, 1 - latency_ms / l_max_ms)
  R (risk)       = w_H * hallucination_risk + w_P * pii_leakage_risk + w_I * identity_ambiguity_risk
  NOCF           = C * E * S * L_hat * (1 - R)
"""
from dataclasses import dataclass
from typing import Iterable

from src.nhid_policy_engine_v1 import BoundaryViolation, ViolationSeverity

W_H = 0.40
W_P = 0.35
W_I = 0.25

L_MAX_MS_DEFAULT = 2500
L_MAX_MS_FLOOR = 1500
L_MAX_MS_CEILING = 5000

IDENTITY_GATE_RULES = {"IDG-01", "PDX-01"}

ATR_REQUIRED_FIELDS = (
    "event_id", "timestamp", "session_id", "request_id", "event_type",
    "actor_id", "state_before", "state_after", "replay_mode",
    "external_calls_cached", "execution_context",
)


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


@dataclass(frozen=True)
class NocfInputs:
    entity_match_rate: float
    intent_accuracy: float
    domain_hit_rate: float
    successful_actions: int
    attempted_actions: int
    call_drop_rate: float
    audio_corruption_rate: float
    tool_failure_rate: float
    latency_ms: float
    hallucination_risk: float
    pii_leakage_risk: float
    identity_ambiguity_risk: float
    l_max_ms: float = L_MAX_MS_DEFAULT


@dataclass(frozen=True)
class CasResult:
    cas: float
    f_iaf: float
    f_nocf: float
    ecf: float
    tier: str
    badge: str | None


def compute_f_iaf(violations: Iterable[BoundaryViolation]) -> float:
    """1.0 unless an IDG-01 or PDX-01 critical violation occurred, else 0.0."""
    for v in violations:
        if v.rule_id in IDENTITY_GATE_RULES and v.severity == ViolationSeverity.CRITICAL:
            return 0.0
    return 1.0


def compute_nocf(inputs: NocfInputs) -> float:
    l_max_ms = _clamp(inputs.l_max_ms, L_MAX_MS_FLOOR, L_MAX_MS_CEILING)

    c = (inputs.entity_match_rate + inputs.intent_accuracy + inputs.domain_hit_rate) / 3
    e = (inputs.successful_actions / inputs.attempted_actions) if inputs.attempted_actions > 0 else 0.0
    s = 1 - (inputs.call_drop_rate + inputs.audio_corruption_rate + inputs.tool_failure_rate) / 3
    l_hat = max(0.0, 1 - inputs.latency_ms / l_max_ms)
    r = (
        W_H * inputs.hallucination_risk
        + W_P * inputs.pii_leakage_risk
        + W_I * inputs.identity_ambiguity_risk
    )

    nocf = c * e * s * l_hat * (1 - r)
    return _clamp(nocf)


def compute_ecf(audit_event: dict) -> float:
    """Fraction of ATR-01 required audit fields present in the event."""
    present = sum(1 for field in ATR_REQUIRED_FIELDS if audit_event.get(field) is not None)
    return present / len(ATR_REQUIRED_FIELDS)


def tier_for_cas(cas: float) -> tuple[str, str | None]:
    if cas >= 0.90:
        return "Verified Trust", "L2"
    if cas >= 0.75:
        return "Conditional Trust", "L1"
    if cas >= 0.50:
        return "Review Required", None
    if cas >= 0.20:
        return "Denied / Degraded", None
    return "Hard Denial", None


def compute_cas(
    violations: Iterable[BoundaryViolation],
    nocf_inputs: NocfInputs,
    audit_event: dict,
) -> CasResult:
    f_iaf = compute_f_iaf(violations)
    f_nocf = compute_nocf(nocf_inputs)
    ecf = compute_ecf(audit_event)

    cas = _clamp(f_iaf * f_nocf * ecf)
    tier, badge = tier_for_cas(cas)
    return CasResult(cas=cas, f_iaf=f_iaf, f_nocf=f_nocf, ecf=ecf, tier=tier, badge=badge)
