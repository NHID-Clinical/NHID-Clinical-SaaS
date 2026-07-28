# TrustLayer module architecture

Maps the five TrustLayer platform modules — as presented publicly on nhid-clinical.org —
to the code in this repository. The purpose is to keep the marketing information
architecture and the implementation from drifting apart.

## Why this document exists

The public site was restructured around an **open framework first, separate commercial
platform layer** architecture. The open framework (specification, controls, reference
implementation, conformance suite, simulator) lives in `NHID-Clinical/NHID-Clinical` under
CC BY 4.0. TrustLayer is the commercial layer, and lives here.

Those two things must stay separate in code, in repositories, and in messaging. See
`docs/repository-architecture.md` in `NHID-Clinical/NHID-Clinical` for the intended
repository split.

## Non-negotiable constraint

**TrustLayer runs the same deterministic controls as the open framework.**

This is stated on every platform page on the public site, so it has to remain true in the
code. TrustLayer may add operations *around* the controls — scheduling, persistence,
identity lifecycle, reporting, access control — but it must not introduce private control
logic that produces a different verdict from the open reference engine for the same inputs.

If a control's behavior needs to change, the change lands in the open reference
implementation first, and TrustLayer picks it up as a pinned dependency.

## Module map

| Public page | Module | Purpose | Relevant code here |
|---|---|---|---|
| `/platform/agent-registry.html` | Agent Registry | Source of truth for agent identity: agent ID, organization, vendor, owner, purpose, permissions, expiration, status | `nhid-clinical/saas_layer/auth.py`, `nhid-clinical/saas_layer/db.py`, `lib/db`, `lib/api-spec` |
| `/platform/trust-gateway.html` | Trust Gateway | Runtime enforcement — identity verification, authorization, disclosure check, scope enforcement, audit event | `nhid-clinical/saas_layer/gateway.py`, `nhid-clinical/saas_layer/nhid_client.py`, `nhid-clinical/saas_layer/voice_policy.py` |
| `/platform/evidence-center.html` | Evidence Center | Audit-ready evidence: compliance reports, evidence packages, event history, governance exports | `nhid-clinical/saas_layer/audit.py`, `artifacts/nhid-audit-core/` |
| `/platform/continuous-conformance.html` | Continuous Conformance | Static conformance tests as ongoing monitoring, re-run on agent change | `nhid-clinical/saas_layer/nhid_client.py`, `nhid-clinical/saas_layer/usage.py` |
| `/platform/enterprise.html` | Enterprise Workflow | SSO, RBAC, approvals, integrations, SIEM export | `lib/replit-auth-web`, `nhid-clinical/saas_layer/auth.py`, `artifacts/api-server/` |

Supporting, not user-facing as modules:

| Concern | Code |
|---|---|
| Billing and plan entitlement | `nhid-clinical/saas_layer/billing.py`, `stripe_billing.py`, `stripe_client.py` |
| Dashboard / console UI | `artifacts/nhid-saas/`, `artifacts/mockup-sandbox/`, `nhid-clinical/replit_dashboard/` |
| API surface | `artifacts/api-server/`, `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` |

## The audit core

`artifacts/nhid-audit-core/` is the tamper-evident audit engine described in `replit.md`:
hash-chained events, agent issuance, token scope verification, and proof export. It is the
natural backing store for the Evidence Center — the four endpoints it exposes
(`/agent/issue`, `/auth/verify`, `/trace/append`, `/proof/{session_id}`) line up closely
with what the Agent Registry, Trust Gateway, and Evidence Center pages describe.

Its `valid_chain` flag is the property the Evidence Center's claim of replayable event
history ultimately rests on.

## Claims discipline

The public platform pages were written to specific constraints. Anything built here should
hold to the same line:

- **Never** describe TrustLayer as an "AI compliance platform." The approved phrasing is
  *"operational trust infrastructure for healthcare AI agents."*
- No certification claims. NHID-Clinical does not certify anyone, and neither does TrustLayer.
- No implied regulatory compliance guarantee. Evidence is aligned to NIST AI RMF,
  ISO/IEC 42001, and HIPAA documentation — alignment is not a compliance determination.
- Figures shown on the public site are explicitly labelled illustrative. Do not promote an
  illustrative figure to a claimed metric without a real measurement behind it.
- Pricing is a placeholder architecture (Community `$0`, Developer and Enterprise
  "contact for pricing"). The specification and conformance tests are never gated by a plan.

## Open questions

- Whether the Agent Registry stores NHID-Auth passports directly or references them by key
  identifier. The open format is defined in the framework repository; the registry should
  consume it rather than define a parallel schema.
- How continuous conformance obtains agent version changes: vendor-reported, detected from
  call traffic, or both.
- Retention policy defaults for the event history behind the Evidence Center.
