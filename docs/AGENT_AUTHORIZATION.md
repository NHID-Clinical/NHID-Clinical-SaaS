# Agent authorization (NHID-Auth v2)

How the gateway decides whether an AI agent telephoning on behalf of a provider is
actually authorized to do so.

## The problem this addresses

An AI voice agent calls a health or dental payer and says it is acting for a provider.
The payer has no way to test that claim. The agent can assert any NPI it likes; nothing
in the call proves the named provider ever delegated anything to it.

## What was already in the repository, and what was missing

Three of the four pieces existed before this change and had never been connected:

| Piece | Where | State before |
|---|---|---|
| Ed25519 delegation format — provider signs, agent co-signs, NPI/scope/expiry/call-SID bound | `nhid-clinical/src/agent_identity.py` | Implemented and unit-tested |
| Runtime gate that denies an unverified agent | `voice_policy.check_authorization` | Implemented, never reached |
| `REQUIRE_AGENT_AUTHORIZATION` rule | `voice_policy._eval_authorization` | Implemented, not in any shipped ruleset |
| Anything that produced a verdict | — | **Did not exist** |

The gate reads `session_state["authorization"]`. Nothing ever wrote it, `agent_identity`
was never imported by `saas_layer/`, and `DEFAULT_RULESET` contained only disclosure and
escalation. The crypto and the gate were in the same repository and had no path between
them.

This change supplies the missing piece and closes the loop.

## What a verified passport proves

Somebody holding a private key **that this organisation registered against that NPI**
signed a delegation naming this agent, this scope, this expiry and this call, and the
agent holds the key named in it.

## What it does not prove

- **Not** that the caller is the NPI holder.
- **Not** that the NPI is valid or active in NPPES. No NPPES lookup is performed.
- **Not** that the underlying claim (eligibility, benefit, treatment) is truthful.
- **Not** that the payload came from a particular telephony vendor — webhook API keys
  are a separate, weaker control and are not vendor signature verification.

The binding it establishes is between a registered provider key and a live call. That is
the link that was missing; it is not the whole trust problem.

## Components

| Module | Responsibility |
|---|---|
| `saas_layer/agent_registry.py` | Which public keys may sign for an NPI; which agents and delegations are revoked |
| `saas_layer/agent_authorization.py` | Parse a submitted passport, verify it, produce a verdict |
| `saas_layer/voice_sessions.py` | Persist the verdict on the session; hand it to the policy engine as `session_state["authorization"]` |
| `saas_layer/voice_policy.py` | `REQUIRE_AGENT_AUTHORIZATION` acts on the verdict (unchanged by this work) |

### Order of checks

Verification is ordered so that the cheapest and most decisive checks come first, and so
that a revocation cannot be outrun:

1. Structural parse — exact field set, correct types
2. NPI format
3. Expiry is offset-aware ISO 8601
4. **Revocation** — before any signature work
5. Provider key lookup for `(org_id, provider_npi)`
6. Ed25519 signature verification (provider signature and agent co-signature)
7. Call-SID binding, then scope

## Default posture

`REQUIRE_AGENT_AUTHORIZATION` ships **enabled** at priority `-1`, with `required: false`.

| Credential presented | `required: false` (default) | `required: true` |
|---|---|---|
| None | allowed through | **denied** — `AGENT_NOT_AUTHORIZED` |
| Valid | allowed | allowed |
| Invalid | **denied** | **denied** |

`required: false` means a credential is optional. It has never meant a bad credential is
acceptable — a passport that fails verification is denied either way.

This default was chosen so that adding the rule does not stop calls for organisations
that have not yet registered a provider key. **Turning `required: true` on will stop
calls** from every agent that cannot present a verifiable delegation. That is the point
of it, and it is opt-in per organisation for that reason.

## Operator runbook

**Register a provider signing key.** Until this is done, every passport claiming that NPI
is denied with `ERR_PROVIDER_KEY_NOT_REGISTERED`.

```
POST /saas/agent-registry/provider-keys
{ "provider_npi": "1234567890", "public_key_b64": "...", "label": "Dr Smith" }
```

**Rotate a key.** Register the new key before revoking the old one. Both stay active and
either will verify, so no call fails during the overlap.

**Revoke a compromised signing key.** This invalidates every delegation that key signed,
including unexpired ones.

```
POST /saas/agent-registry/provider-keys/{key_id}/revoke
```

**Revoke an agent or a single delegation.** Checked before signature verification, so a
revoked agent presenting an otherwise perfect passport is still denied.

```
POST /saas/agent-registry/revocations
{ "subject_type": "agent", "subject_id": "agent-42", "reason": "vendor breach" }
```

**Present a credential.** Either at call setup (`agent_passport` on
`POST /saas/voice/incoming`) or afterwards (`POST /saas/voice/authorize`). Supply
`call_sid` to enforce replay binding; omit it and the verdict records
`call_sid_bound: false`.

**Enforce.** Set `required: true` in the organisation's `REQUIRE_AGENT_AUTHORIZATION`
rule via the existing voice policy endpoints.

## Denial reasons

| Reason | Meaning |
|---|---|
| `ERR_PASSPORT_*` / `ERR_DELEGATION_*` | Structurally malformed; the specific field is named |
| `ERR_INVALID_NPI` | Not ten digits |
| `ERR_EXPIRY_NOT_TIMEZONE_AWARE` | `expires_at` has no UTC offset, or does not parse |
| `ERR_REVOKED:agent` / `ERR_REVOKED:delegation` | Revoked in this organisation's registry |
| `ERR_PROVIDER_KEY_NOT_REGISTERED` | No active key for that NPI under this org — also what a cross-tenant attempt returns |
| `ERR_INVALID_SIG` | No registered key produced this signature, or the delegation was altered after signing |
| `ERR_NONCE_MISMATCH` | Passport was minted for a different call |
| `ERR_SCOPE_VIOLATION` | Granted scope does not cover what was required |

## Design decisions worth knowing

**Revocation is in Postgres, not in `AgentIdentityManager`.** The reference
implementation tracks revocations in instance dicts. That state is lost on restart and is
not shared between Uvicorn workers, so an agent revoked on one worker would stay
authorized on the others. Revocation is therefore checked against the database, and the
shared manager's dicts are deliberately left empty.

**Offset-aware expiry is required.** The framework's expiry check calls
`datetime.fromisoformat(...).timestamp()`, which reads a naive timestamp in the server's
local timezone — a caller could widen its own expiry window depending on where the
process runs. The bridge rejects naive timestamps rather than changing the shared
framework's semantics.

**A rejected passport is persisted.** `auth_verified = FALSE` is written to the session
and a `voice_agent_authorization` event is appended to the audit chain. A refused
impersonation attempt is exactly the thing that must remain visible afterwards.

**`auth_verified IS NULL` is not `FALSE`.** NULL means no credential was ever presented
and defers to the rule's `required` flag; FALSE means one was presented and rejected, and
always denies.

**The audit event carries identifiers only.** Agent ID, NPI and delegation ID go into the
chain. No signature bytes and no key material are written, and there is a test asserting
it. The chain hash covers a fixed key set (`audit._PAYLOAD_KEYS`), so the identifiers go
in `input_text` rather than in extra event keys, which would be silently dropped from both
the row and the hash.

## Verification

`nhid-clinical/tests/test_agent_authorization.py` — 98 tests: parsing, registry and
cross-tenant isolation, the acceptance matrix, session persistence, the policy loop, and
ten end-to-end tests over real HTTP against a real database and a real audit chain,
including a `verify_chain` assertion that the new event type does not break tamper
evidence.

## Not done

- No NPPES validation. An NPI is checked for format only.
- Delegation chains (`validate_chain`, up to 3 hops) are implemented in the framework but
  not exposed through the gateway — single-hop delegations only.
- `PROHIBIT_DECEPTIVE_ARTIFACTS` has an evaluator and is still absent from
  `BUILTIN_RULE_REGISTRY` and `DEFAULT_RULESET`. Same class of gap as this one was, left
  alone deliberately to keep this change reviewable.
- No UI. Provider keys and revocations are API-only.
- Nothing here is a HIPAA compliance determination, and nothing here certifies anyone.
