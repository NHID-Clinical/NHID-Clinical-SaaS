"""
saas_layer/agent_authorization.py — Verify provider-signed agent passports.

This module is the bridge between two pieces that already existed and had never
been connected:

  * ``src/agent_identity.py`` — the open framework's Ed25519 delegation format:
    a provider signs a delegation naming an NPI, an agent, a scope, an expiry
    and a call SID; the agent co-signs to prove it controls the key.

  * ``saas_layer/voice_policy.check_authorization`` — the runtime gate, which
    reads a verdict from ``session_state["authorization"]`` and denies the turn
    when the agent is unverified or out of scope.

Before this module, nothing in ``saas_layer/`` imported ``agent_identity`` and
nothing ever wrote ``session_state["authorization"]``. The rule existed, the
crypto existed, and the two never met — so an agent asserting "I am calling on
behalf of Dr. Smith, NPI 1234567890" was taken at its word.

What a verified passport does and does not prove
------------------------------------------------
It proves that somebody holding a private key **the organisation registered
against that NPI** signed a delegation naming this agent, this scope and this
call, and that the agent holds the key named in it.

It does not prove the caller is the NPI holder, that the NPI is valid in NPPES,
or that the underlying claim is truthful. Those are separate controls. The
binding this establishes is between a registered provider key and a live call —
which is the link that was missing.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from src.agent_identity import (
    AgentIdentityManager,
    AgentPassport,
    Delegation,
    NPI_RE,
)
from saas_layer import agent_registry

logger = logging.getLogger(__name__)

#: Field names of Delegation, in the order the dataclass declares them.
#: A passport payload must carry exactly these keys — no more, no fewer.
#: The provider's signature covers ``json.dumps(asdict(delegation), sort_keys=True)``,
#: so an extra or missing field changes the signed bytes and could not verify
#: anyway; rejecting it by name produces a usable error instead of an opaque
#: ERR_INVALID_SIG.
_DELEGATION_FIELDS = frozenset({
    "provider_npi",
    "agent_id",
    "agent_public_key_b64",
    "scope",
    "expires_at",
    "created_at",
    "delegation_id",
    "call_sid",
    "nonce",
})

_PASSPORT_FIELDS = frozenset({"delegation", "signature_b64", "agent_signature_b64"})

#: Reasons that are independent of which provider key was tried. When every
#: candidate key fails, one of these is more informative than ERR_INVALID_SIG,
#: because it tells the operator the passport itself is bad rather than that
#: they registered the wrong key.
_KEY_INDEPENDENT_REASONS = ("ERR_EXPIRED", "ERR_NONCE_MISMATCH", "ERR_SCOPE_VIOLATION", "ERR_INVALID_NPI")

#: Shared manager. Its in-memory revocation dicts are deliberately left empty —
#: revocation is checked against Postgres in this module, because per-process
#: dicts do not survive a restart and are not shared between workers.
_manager = AgentIdentityManager()


class PassportFormatError(ValueError):
    """Raised when a submitted passport payload is not structurally valid."""


def _unverified(reason: str, **extra: Any) -> Dict[str, Any]:
    """Build a failing verdict in the shape check_authorization expects."""
    verdict: Dict[str, Any] = {
        "verified": False,
        "reason": reason,
        "agent_id": extra.pop("agent_id", None),
        "scope": [],
    }
    verdict.update(extra)
    return verdict


# ── Parsing ───────────────────────────────────────────────────────────────────

def parse_passport(payload: Any) -> AgentPassport:
    """
    Turn an untrusted JSON-decoded payload into an AgentPassport.

    Strict by design: the payload comes off the wire, and silently coercing it
    would produce a signature failure that looks identical to a forgery. Raises
    PassportFormatError with a specific reason instead.
    """
    if not isinstance(payload, dict):
        raise PassportFormatError("ERR_PASSPORT_NOT_OBJECT")

    missing = _PASSPORT_FIELDS - payload.keys()
    if missing:
        raise PassportFormatError(f"ERR_PASSPORT_MISSING_FIELDS:{','.join(sorted(missing))}")
    unexpected = payload.keys() - _PASSPORT_FIELDS
    if unexpected:
        raise PassportFormatError(f"ERR_PASSPORT_UNEXPECTED_FIELDS:{','.join(sorted(unexpected))}")

    delegation_payload = payload["delegation"]
    if not isinstance(delegation_payload, dict):
        raise PassportFormatError("ERR_DELEGATION_NOT_OBJECT")

    missing = _DELEGATION_FIELDS - delegation_payload.keys()
    if missing:
        raise PassportFormatError(f"ERR_DELEGATION_MISSING_FIELDS:{','.join(sorted(missing))}")
    unexpected = delegation_payload.keys() - _DELEGATION_FIELDS
    if unexpected:
        raise PassportFormatError(f"ERR_DELEGATION_UNEXPECTED_FIELDS:{','.join(sorted(unexpected))}")

    for name in ("signature_b64", "agent_signature_b64"):
        if not isinstance(payload[name], str) or not payload[name]:
            raise PassportFormatError(f"ERR_PASSPORT_BAD_FIELD:{name}")

    scope = delegation_payload["scope"]
    if not isinstance(scope, list) or not all(isinstance(s, str) for s in scope):
        raise PassportFormatError("ERR_DELEGATION_BAD_FIELD:scope")
    # Order is preserved: the signature covers the list as written, and sorting
    # it here would change the signed bytes.

    for name in ("provider_npi", "agent_id", "agent_public_key_b64",
                 "expires_at", "created_at", "delegation_id", "call_sid", "nonce"):
        if not isinstance(delegation_payload[name], str):
            raise PassportFormatError(f"ERR_DELEGATION_BAD_FIELD:{name}")

    delegation = Delegation(
        provider_npi=delegation_payload["provider_npi"],
        agent_id=delegation_payload["agent_id"],
        agent_public_key_b64=delegation_payload["agent_public_key_b64"],
        scope=list(scope),
        expires_at=delegation_payload["expires_at"],
        created_at=delegation_payload["created_at"],
        delegation_id=delegation_payload["delegation_id"],
        call_sid=delegation_payload["call_sid"],
        nonce=delegation_payload["nonce"],
    )
    return AgentPassport(
        delegation=delegation,
        signature_b64=payload["signature_b64"],
        agent_signature_b64=payload["agent_signature_b64"],
    )


def _expiry_is_timezone_aware(expires_at: str) -> bool:
    """
    Return True when *expires_at* parses as an offset-aware ISO 8601 timestamp.

    The framework's expiry check calls ``datetime.fromisoformat(...).timestamp()``,
    which interprets a naive timestamp in the server's local timezone. A caller
    could exploit that to widen its own expiry window by hours depending on
    where the process runs. Requiring an explicit offset closes that without
    changing the shared framework's semantics.
    """
    try:
        parsed = datetime.fromisoformat(expires_at)
    except (TypeError, ValueError):
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() is not None


# ── Verification ──────────────────────────────────────────────────────────────

def verify_agent_passport(
    org_id: str,
    payload: Any,
    expected_call_sid: Optional[str] = None,
    required_scope: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Verify a submitted passport for *org_id* and return an authorization verdict.

    The verdict is the dict shape ``voice_policy.check_authorization`` reads:
    ``{"verified", "reason", "agent_id", "scope"}``, plus ``provider_npi``,
    ``delegation_id`` and ``call_sid_bound`` for persistence and audit.

    This function never raises for bad input — a malformed or forged passport is
    a denial, not a server error. It may raise if the database is unreachable.

    Parameters
    ----------
    expected_call_sid :
        When given, the delegation's ``call_sid`` must match it. This is the
        replay defence: a passport minted for one call cannot be presented on
        another. When None the binding is not checked, and the verdict records
        ``call_sid_bound: False`` so the audit trail shows the weaker check.
    required_scope :
        Optional immediate scope check. Per-turn scope enforcement is the policy
        engine's job; this is for callers that want to fail fast at presentation
        time.
    """
    try:
        passport = parse_passport(payload)
    except PassportFormatError as exc:
        return _unverified(str(exc))

    d = passport.delegation

    if not NPI_RE.match(d.provider_npi or ""):
        return _unverified("ERR_INVALID_NPI", provider_npi=d.provider_npi,
                           delegation_id=d.delegation_id, agent_id=d.agent_id)

    if not _expiry_is_timezone_aware(d.expires_at):
        return _unverified("ERR_EXPIRY_NOT_TIMEZONE_AWARE", provider_npi=d.provider_npi,
                           delegation_id=d.delegation_id, agent_id=d.agent_id)

    # Revocation is checked before the signature. A revoked agent presenting a
    # perfectly valid passport must still be denied, and checking first means a
    # revocation cannot be outrun by a key rotation.
    revoked_subject = agent_registry.is_revoked(
        org_id, agent_id=d.agent_id, delegation_id=d.delegation_id
    )
    if revoked_subject is not None:
        return _unverified(f"ERR_REVOKED:{revoked_subject}", provider_npi=d.provider_npi,
                           delegation_id=d.delegation_id, agent_id=d.agent_id)

    candidate_keys = agent_registry.get_active_provider_keys(org_id, d.provider_npi)
    if not candidate_keys:
        # The heart of the control: an agent may claim any NPI it likes, but the
        # claim is worthless unless this organisation has registered a signing
        # key for that NPI.
        return _unverified("ERR_PROVIDER_KEY_NOT_REGISTERED", provider_npi=d.provider_npi,
                           delegation_id=d.delegation_id, agent_id=d.agent_id)

    failures: List[str] = []
    for public_key_b64 in candidate_keys:
        try:
            provider_pub = _manager.b64_to_public_key(public_key_b64)
        except Exception:
            # A stored key that no longer decodes cannot verify anything. Skip
            # it rather than failing the whole verification on one bad row.
            logger.warning(
                "agent_authorization: undecodable provider key org=%s npi=%s key_id_unknown",
                org_id, d.provider_npi,
            )
            continue

        result = _manager.verify_passport(
            passport,
            provider_pub,
            call_sid=expected_call_sid,
            required_scope=required_scope,
        )
        if result.valid:
            return {
                "verified": True,
                "reason": "VERIFIED",
                "agent_id": result.agent_id,
                "scope": list(result.scope),
                "provider_npi": result.provider_npi,
                "delegation_id": result.delegation_id,
                "call_sid_bound": expected_call_sid is not None,
            }
        failures.append(result.reason)

    for reason in _KEY_INDEPENDENT_REASONS:
        if reason in failures:
            return _unverified(reason, provider_npi=d.provider_npi,
                               delegation_id=d.delegation_id, agent_id=d.agent_id)

    return _unverified("ERR_INVALID_SIG", provider_npi=d.provider_npi,
                       delegation_id=d.delegation_id, agent_id=d.agent_id)


def verdict_for_session(verdict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Reduce a verdict to the fields persisted on the voice session row.

    Kept separate from the verdict itself so that adding a diagnostic field to
    the verdict does not silently require a schema change.
    """
    return {
        "verified": bool(verdict.get("verified", False)),
        "reason": verdict.get("reason", ""),
        "agent_id": verdict.get("agent_id"),
        "provider_npi": verdict.get("provider_npi"),
        "delegation_id": verdict.get("delegation_id"),
        "scope": list(verdict.get("scope") or []),
    }
