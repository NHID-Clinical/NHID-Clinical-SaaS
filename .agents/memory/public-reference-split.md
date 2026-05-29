---
name: Public reference vs paid-tier test split
description: Which NHID tests belong in the public open-standard repo vs the private SaaS repo, and why
---

# Public reference (open standard) vs private paid-tier asset

Two GitHub repos exist:
- **NHID-Clinical** (public) — the open reference / conformance standard. Handout people clone and run.
- **NHID-Clinical-SaaS** (private) — the full hosted commercial product. This is the workspace `origin`.

## Rule for what goes public

PUBLIC = the **deterministic policy engine** + its **pure unit tests** only.
`saas_layer/voice_policy.py` is pure (imports only `typing`) → it IS the
conformance standard and is safe to publish. The pure test classes
(TestCheckDisclosure, TestCheckEscalation, TestRunVoicePolicy,
TestRulesetPolicyEngine) port cleanly.

PRIVATE = anything coupled to the hosted SaaS app (FastAPI gateway, Postgres,
billing, telephony) — especially `TestVoiceWebhookPlanGate` (the L2+
monetization gate) and the endpoint integration tests (TestVoiceIncoming /
TestVoiceTranscript). These can't run standalone, which is the natural fence.

**Why:** open-standard credibility lives in the deterministic policy rules;
monetization lives in the hosted implementation (real telephony integrations +
plan gating). Publishing the engine strengthens the standard without giving away
the paid product.

**How to apply:** when extracting to the public repo, only move pure modules and
tests that import no SaaS code. Verify they pass standalone (no live server)
before publishing. A staged bundle lives at `.local/public-repo-staging/`.
