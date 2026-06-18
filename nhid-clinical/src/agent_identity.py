"""NHID-Auth v2 - Cryptographic Agent Identity Layer

Provider-signed agent credentials with NPI binding, scoped delegation chains
(max 3 hops, monotonic scope narrowing), per-agent/per-delegation revocation,
and call-SID nonce binding. Algorithm: Ed25519.
"""
import re
import json
import time
import uuid
import base64
from datetime import datetime, timezone
from typing import List, Tuple, Optional, Dict
from dataclasses import dataclass, field, asdict

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

NPI_RE = re.compile(r"^\d{10}$")
MAX_CHAIN_HOPS = 3


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso_to_epoch(value: str) -> float:
    return datetime.fromisoformat(value).timestamp()


@dataclass
class Delegation:
    provider_npi: str
    agent_id: str
    agent_public_key_b64: str
    scope: List[str]
    expires_at: str          # ISO 8601 UTC
    created_at: str          # ISO 8601 UTC
    delegation_id: str       # UUID v4
    call_sid: str
    nonce: str

    def to_json(self) -> str:
        return json.dumps(asdict(self), sort_keys=True)

    @classmethod
    def from_json(cls, data: str) -> "Delegation":
        return cls(**json.loads(data))


@dataclass
class AgentPassport:
    delegation: Delegation
    signature_b64: str        # Provider's Ed25519 signature over delegation JSON
    agent_signature_b64: str  # Agent's co-signature (proves agent key control)


@dataclass
class VerificationResult:
    valid: bool
    reason: str                          # Human-readable outcome or ERR_* code
    delegation_id: Optional[str] = None
    provider_npi: Optional[str] = None
    agent_id: Optional[str] = None
    scope: List[str] = field(default_factory=list)


class AgentIdentityManager:
    def __init__(self):
        self._revoked_agents: Dict[str, str] = {}       # agent_id -> revoked_at
        self._revoked_delegations: Dict[str, str] = {}  # delegation_id -> revoked_at

    # -- Key management -----------------------------------------------

    def generate_agent_keys(self) -> Tuple[Ed25519PrivateKey, Ed25519PublicKey]:
        priv = Ed25519PrivateKey.generate()
        return priv, priv.public_key()

    def public_key_to_b64(self, pub: Ed25519PublicKey) -> str:
        return base64.b64encode(pub.public_bytes(Encoding.Raw, PublicFormat.Raw)).decode()

    def b64_to_public_key(self, b64: str) -> Ed25519PublicKey:
        return Ed25519PublicKey.from_public_bytes(base64.b64decode(b64))

    # -- Delegation issuance --------------------------------------------

    def create_delegation(
        self,
        provider_priv: Ed25519PrivateKey,
        agent_id: str,
        agent_pub: Ed25519PublicKey,
        scope: List[str],
        ttl_seconds: int = 86400,
        call_sid: str = "",
        provider_npi: str = "",
    ) -> Delegation:
        if not NPI_RE.match(provider_npi or ""):
            raise ValueError("ERR_INVALID_NPI")
        now = datetime.now(timezone.utc)
        expires = now.timestamp() + ttl_seconds
        return Delegation(
            provider_npi=provider_npi,
            agent_id=agent_id,
            agent_public_key_b64=self.public_key_to_b64(agent_pub),
            scope=list(scope),
            expires_at=datetime.fromtimestamp(expires, tz=timezone.utc).isoformat(),
            created_at=now.isoformat(),
            delegation_id=str(uuid.uuid4()),
            call_sid=call_sid,
            nonce=uuid.uuid4().hex,
        )

    def sign_delegation(self, provider_priv: Ed25519PrivateKey, delegation: Delegation) -> str:
        return base64.b64encode(provider_priv.sign(delegation.to_json().encode())).decode()

    def create_agent_passport(
        self,
        delegation: Delegation,
        provider_sig: str,
        agent_priv: Ed25519PrivateKey,
    ) -> AgentPassport:
        agent_sig = base64.b64encode(agent_priv.sign(delegation.to_json().encode())).decode()
        return AgentPassport(delegation=delegation, signature_b64=provider_sig, agent_signature_b64=agent_sig)

    # -- Verification -----------------------------------------------------

    def verify_passport(
        self,
        passport: AgentPassport,
        provider_pub: Ed25519PublicKey,
        call_sid: Optional[str] = None,
        required_scope: Optional[List[str]] = None,
    ) -> VerificationResult:
        d = passport.delegation

        if d.delegation_id in self._revoked_delegations or d.agent_id in self._revoked_agents:
            return VerificationResult(False, "ERR_REVOKED", delegation_id=d.delegation_id, agent_id=d.agent_id)

        if not NPI_RE.match(d.provider_npi or ""):
            return VerificationResult(False, "ERR_INVALID_NPI", delegation_id=d.delegation_id)

        if _iso_to_epoch(d.expires_at) <= time.time():
            return VerificationResult(False, "ERR_EXPIRED", delegation_id=d.delegation_id)

        try:
            provider_pub.verify(base64.b64decode(passport.signature_b64), d.to_json().encode())
            agent_pub = self.b64_to_public_key(d.agent_public_key_b64)
            agent_pub.verify(base64.b64decode(passport.agent_signature_b64), d.to_json().encode())
        except Exception:
            return VerificationResult(False, "ERR_INVALID_SIG", delegation_id=d.delegation_id)

        if call_sid is not None and call_sid != d.call_sid:
            return VerificationResult(False, "ERR_NONCE_MISMATCH", delegation_id=d.delegation_id)

        if required_scope is not None and not set(required_scope).issubset(set(d.scope)):
            return VerificationResult(False, "ERR_SCOPE_VIOLATION", delegation_id=d.delegation_id)

        return VerificationResult(
            True, "Valid",
            delegation_id=d.delegation_id,
            provider_npi=d.provider_npi,
            agent_id=d.agent_id,
            scope=list(d.scope),
        )

    # -- Revocation -----------------------------------------------------

    def revoke_agent(self, agent_id: str) -> None:
        self._revoked_agents[agent_id] = _utc_now_iso()

    def revoke_delegation(self, delegation_id: str) -> None:
        self._revoked_delegations[delegation_id] = _utc_now_iso()

    # -- Delegation chains -----------------------------------------------

    def validate_chain(
        self,
        passports: List[AgentPassport],
        provider_pub: Ed25519PublicKey,
    ) -> VerificationResult:
        if len(passports) > MAX_CHAIN_HOPS:
            return VerificationResult(False, "ERR_CHAIN_TOO_LONG")

        prev_scope: Optional[List[str]] = None
        last_result: Optional[VerificationResult] = None
        for passport in passports:
            result = self.verify_passport(passport, provider_pub, call_sid=passport.delegation.call_sid)
            if not result.valid:
                return result
            if prev_scope is not None and not set(result.scope).issubset(set(prev_scope)):
                return VerificationResult(False, "ERR_CHAIN_NARROWING", delegation_id=result.delegation_id)
            prev_scope = result.scope
            last_result = result

        return last_result if last_result is not None else VerificationResult(False, "ERR_INVALID_SIG")
