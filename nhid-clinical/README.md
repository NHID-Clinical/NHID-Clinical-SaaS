# `nhid-clinical/` — the SaaS backend

This directory is the **NHID-Clinical SaaS backend**, not the framework.

It contains `saas_layer/` (the FastAPI control plane, the monitoring and
evidence product, billing, auth and the audit chain), a vendored snapshot of the
framework engine under `src/`, and an older copy of the framework's public site
HTML that is kept for the hosted demo routes.

> An earlier version of this file was a copy of the framework README. It had
> drifted badly — it advertised a per-call Call Authorization Score, "330+
> tests", and a DBC-01 that detected breathing and typing cues. None of that is
> true of either repository now. Duplicating the framework's documentation here
> is what let it drift, so this file no longer does.

**The framework repository is the source of truth for the controls:**
[github.com/NHID-Clinical/NHID-Clinical](https://github.com/NHID-Clinical/NHID-Clinical).
Read the control definitions, the terminology, the claim boundaries and the
evidence limitations there.

**The product** is described in
[`../docs/MONITORING_PRODUCT.md`](../docs/MONITORING_PRODUCT.md), and the
repository as a whole in [`../README.md`](../README.md).

## What is here

| Path | What it is |
|---|---|
| `saas_layer/` | The control plane. `gateway.py` is the API; `monitoring.py` is the monitoring and evidence product; `normalization.py` maps vendor payloads to one canonical interaction shape; `audit.py` is the hash-chained, HMAC-protected, append-only audit store. |
| `src/` | A vendored snapshot of the framework engine (`nhid_policy_engine_v1.py`, `agent_identity.py`). **It is a snapshot and it lags the framework.** In particular it still carries DBC-01's acoustic-artifact path, which the framework withdrew — see the note below. |
| `tests/` | The backend suite, including `test_monitoring_e2e.py`, which drives upload → normalize → evaluate → finding → evidence → review → report over real HTTP. |
| `specs/`, `traces/`, `assets/`, `*.html` | An older copy of the framework's published site, kept for the hosted demo routes. Not maintained here; the framework repository publishes the current versions. |

## Which controls run where

The **monitoring product** (`saas_layer/monitoring.py`) evaluates four controls —
**IDG-01, PDX-01, EIT-01, ATR-01** — and returns one of four results for each:
`pass`, `exception`, `unknown`, `not_assessable`.

**DBC-01 is not part of the monitoring product.** It is evaluated only by the
older real-time voice-webhook path (`saas_layer/voice_policy.py`), whose
`check_deceptive_artifacts` reads an `audio_artifacts` list supplied in the
webhook payload and looks for annotated transcript markers such as
`[breathing]`.

> **Known divergence from the framework.** The framework **withdrew** DBC-01's
> acoustic-artifact tier: it read a `deceptive_artifact_flags` field out of the
> event payload, which means it was self-reported by the agent under
> evaluation, and keeping it implied an acoustic analysis NHID-Clinical has
> never performed. The framework's DBC-01 now evaluates the agent's own
> identity assertion text for claims of human or licensed-professional status.
> The webhook path here has **not** been changed to match, and the vendored
> `src/nhid_policy_engine_v1.py` snapshot still contains the withdrawn tier.
> Whether to retire the webhook artifact check is an open product decision,
> recorded here rather than silently resolved.

## Running it

See [`../README.md`](../README.md) for the test commands, the required
configuration and the local setup, and
[`../docs/MONITORING_PRODUCT.md`](../docs/MONITORING_PRODUCT.md) for the demo
path. Both need a live PostgreSQL: `gateway.py` reads `DATABASE_URL` at import
time, so the suite cannot even collect without one.

## Status

Zero deployments, zero pilots, zero validated willingness-to-pay. This
repository must not be represented as production-ready or HIPAA-compliant.

---

**CC BY 4.0** (specification) · **Apache-2.0** (code) · Brianna Baynard ·
[nhid-clinical.org](https://nhid-clinical.org/)
