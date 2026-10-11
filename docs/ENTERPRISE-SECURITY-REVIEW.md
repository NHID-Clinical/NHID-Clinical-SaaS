# Enterprise security review — answer set

For a payer or provider security team evaluating NHID-Clinical. Every claim here
cites the code that implements it, so a reviewer can check rather than trust.

**It also names what is missing.** A security questionnaire answered only with
strengths is not an answer set, it is marketing, and a reviewer who finds the
first unstated gap stops believing the stated ones. The gaps are in §7.

Last verified against the code: 2026-10-11.

---

## 1. The single most important distinction

There are **two different deployment paths** with **completely different data
exposure**. Answering as though there were one is the most common way this
conversation goes wrong.

| | **Tier 0 Shadow Pilot Kit** | **Hosted platform** |
|---|---|---|
| Where it runs | **Your environment** | Our infrastructure |
| What we receive | **Nothing** | Canonical interaction records |
| Call audio | Never requested, never ingested | Never requested, never ingested |
| Transcripts | Stay with you | **Stored** — see §3 |
| Needs a BAA | No — no data reaches us | **Yes** |
| Available today | Yes | Not deployed |

**For a first evaluation, use Tier 0.** It is an offline batch over your own
de-identified transcripts, run by you, inside your network. There is no hosted
endpoint and no request for your audio. The output is a baseline *you* generated
— which is also why it is worth more than any figure we publish about ourselves.

Everything from §3 onward describes the **hosted platform**.

---

## 2. Authentication and credentials

Two credential types, deliberately separate.

| | Machine | Human |
|---|---|---|
| Credential | Organization API key | Magic-link session |
| Used by | Ingest pipelines, scripts, CI | People opening the console in a browser |

**Organization API keys** — SHA-256 hashed at rest; the raw value is returned
once at creation and never retrievable afterwards (`saas_layer/api_keys.py:57`).

**Human sign-in — no passwords exist.** No password storage, no reset flow, no
password reuse exposure (`saas_layer/user_auth.py:39`). Instead:

- Single-use tokens, **15-minute TTL** (`user_auth.py:59`)
- **SHA-256 at rest** — the database holds `token_sha256`, never the token
  (`user_auth.py:114`, `:294`)
- Redemption is an **atomic** `UPDATE … WHERE consumed_at IS NULL`, so a replayed
  link loses the race rather than being checked-then-written (`user_auth.py:319-321`)
- Sessions: 7-day TTL, stored as `session_sha256` (`user_auth.py:62`, `:361`)
- Cookie: `httponly=True`, `secure` in production, `samesite=lax`
  (`gateway.py:351-357`)
- **No account enumeration.** `/saas/auth/request-link` returns the same `202`
  and body for known and unknown addresses, and swallows provider errors rather
  than letting delivery success become an oracle (`gateway.py:686-691`)
- **No self-service signup.** The first owner of an organization is created
  explicitly; everyone else is invited by an owner (`gateway.py:561-566`)

**Operator console** — separate, cross-tenant, not a customer door.
Password verified against **scrypt (RFC 7914)**, n=2^15, r=8, with constant-time
comparison; only the hash is ever configured (`saas_layer/admin_auth.py:8`, `:44`,
`:117`). Login is throttled server-side in the database — five failures per IP
in fifteen minutes returns `429`, **checked before the password comparison**, so
a locked-out caller learns nothing from a correct guess. Customer sign-in uses a
*separate* `login_throttle` table, so an attacker hammering customer sign-in
cannot lock the operator out of the console used to investigate them.

---

## 3. What customer data is stored — and what is not

**Never ingested:** call audio or recordings. There is no audio column, no audio
upload path, and no storage bucket for media. We do not transcribe.

**Stored** in the `interactions` table (`saas_layer/monitoring.py:597-606`):
`external_id`, `occurred_at`, `source_vendor`, `source_type`, `ai_assessment`,
`language`, `interpreter_present`, `transcription_status`, `transcription_wer`,
**`transcript`**, `is_synthetic`.

**The `transcript` column holds transcript text.** For provider-to-payer
administrative calls that text can contain PHI — member identifiers, names,
dates of birth, claim details. Stating otherwise would be false, so:

> **The hosted platform processes text that may contain PHI, and therefore
> requires a BAA.** It is retained for **30 days by default** and then redacted,
> with a per-organization override and deletion on request — see §7.1.

`voice_sessions` rows are purged on a per-organization TTL — 24 hours by
default, configurable to 7 days (`saas_layer/voice_sessions.py:388-396`).

**We do not establish transcription accuracy.** NHID does not transcribe, and a
disclosure finding is only as good as the ASR path that produced the transcript.
Every interaction therefore carries a **transcription attestation**
(`status`, `wer`), and findings derived from unattested transcripts are labelled
as such (`monitoring.py:102-104`, `:248`, `:261`).

---

## 4. Audit integrity

Audit events are chained with **HMAC-SHA256** over
`event_hash + org_id + timestamp + policy_version + seq_num`, verified with
`hmac.compare_digest` — always constant-time (`saas_layer/audit.py:25-28`). The
signing secret is never logged, never included in a response, and never passed
into an exception (`audit.py:33`).

Review actions are attributed to the **authenticated user**, resolved
server-side from the session — and the client has no way to assert an identity,
because the request body **has no `reviewer` field at all**. It was removed: it
used to be free text the caller filled in, which meant the audit trail recorded
whatever was typed (`gateway.py:2440-2442`). Attribution additionally requires
the session's user to be a member of that organization (`gateway.py:2563`). An
API-key-only action is recorded explicitly as `api-key (unattributed)`
(`monitoring.py:854`) rather than as a person whose name went missing.

This matters more here than in most products: a governance tool that cannot say
who resolved a finding fails the first question an auditor asks about itself.

---

## 5. Tenant isolation

Every organization-scoped query takes `org_id` from the **resolved credential**,
never from the request body or a URL parameter. `org_members` governs who may
act for an organization. Isolation is covered by a dedicated test suite
(`tests/test_workspace_isolation.py`) exercising both credential types.

---

## 6. Platform and configuration

- **TLS in transit** and **encryption at rest** are provided by the hosting and
  database platforms (Render, Supabase/managed Postgres). We inherit them; we do
  not implement our own.
- **CORS is an exact-match allowlist.** No wildcard, and the service **refuses
  to start** in production if `CORS_ALLOWED_ORIGINS` is unset, rather than
  silently choosing between broken and wide-open (`gateway.py:168-177`).
- **Fail-closed startup.** Missing `ADMIN_PASS_HASH`, `DATABASE_URL`,
  `HMAC_SECRET`, or a real mail sender aborts startup (`scripts/check_startup.py`).
  A sign-in system that cannot send mail answers `202` to everything and locks
  every user out with no error anywhere, so startup is where that is caught.
- **Credential redaction in logs.** A filter on the root and uvicorn loggers
  rewrites `api_key`, `token`, `access_token`, `secret` and `password` values to
  `<redacted>` before emission (`saas_layer/log_redaction.py:25`). Defence in
  depth, not a licence to log secrets.
- **No secrets in source control.** Verified: only `.env.example` files are
  tracked, and a scan of the full git history of both repositories for
  `sk_live_`, `whsec_`, `re_`, `AKIA…`, `ghp_` and embedded `user:password@`
  connection strings returns nothing. *Scan limit: it matches known credential
  prefixes; an unprefixed password or generic key would not match.*
- **Schema changes** run as a single pre-deploy migration step, not as DDL
  raced by every booting worker.

---

## 7. Gaps — stated, not buried

### 7.1 ~~Transcript retention has no limit~~ — CLOSED

**Transcript text is retained for 30 days by default, then redacted.** Closed
2026-10-11 (`migrations/0003_transcript_retention.sql`); before that it was held
indefinitely with no deletion path, and this section said so.

- **Default 30 days**, per-organization override via
  `orgs.transcript_retention_days`, capped at 365 so an override cannot quietly
  become "forever". Server default is `TRANSCRIPT_RETENTION_DAYS`.
- **Scheduled sweep** every 6 hours (`_transcript_retention_loop`), so the
  effective window is the policy plus at most one interval — worth knowing
  before a number goes into a contract.
- **Deletion on request**, not just on schedule: an owner can purge everything
  now, or only text older than N days (`POST /saas/monitor/retention/purge`), or
  a single interaction
  (`DELETE /saas/monitor/interactions/{id}/transcript`). Both require an owner's
  **session** on top of the organization credential: an ingest key that leaked
  must not be able to destroy the evidence it created.
- **Disclosure**: `GET /saas/monitor/retention` answers "what do you hold on
  us?" — the effective policy, whether it came from the org or the server
  default, how many transcripts are held, how many were purged, and the oldest
  still held. It returns no transcript text.

**It redacts; it does not delete rows.** `evaluations` and `findings` reference
`interaction_id`, so deleting the row would destroy the evidence the platform
exists to produce. A purge nulls the text and stamps `transcript_purged_at`, so
deletion is **provable** rather than inferred from a NULL that might equally
mean no transcript was ever supplied.

**The clock runs from `created_at`, not the client-supplied `occurred_at`** —
letting a caller's timestamp drive our deletion schedule would be the same
mistake as trusting the `Host` header to decide where a sign-in link points.

Covered by `tests/test_transcript_retention.py` (15 tests): redaction with the
row surviving, both directions of the per-org override, idempotency, the
bounded and single-interaction requests, tenant isolation on the destructive
path, and an API key alone being refused.

### 7.2 No SOC 2, no HIPAA attestation, no BAA in place

None of these exist. They are months of work and real money. The architecture
above is offered **instead of** an attestation, not as a substitute for one.

### 7.3 No independent validation

Every published figure is self-measured. We authored both the tests and the
system under test, and a reviewer should discount self-grading accordingly. This
is the binding constraint on adoption, and it is the reason Tier 0 exists: a
baseline you generate in your own environment is not self-grading.

### 7.4 No customers, pilots or deployments

Zero, today. Nothing in our material represents otherwise.

### 7.5 Delegated-authority limits (NHID-Auth)

- **Revocation does not propagate across organizations.** It is durable within a
  deployment; a delegation revoked by one party is not known to another. Named a
  P1 gap in the framework docs.
- Signature, scope and expiry verify offline. **Revocation does not** — it needs
  state, and the hosted verify path degrades to a library-only check if that
  store is unreachable.
- The NPI is **cryptographically bound** to the delegation but **not validated
  against NPPES**. A real, correctly-formatted NPI belonging to someone else
  would pass the format check.

### 7.6 Scope of the framework itself

NHID-Clinical evaluates **disclosure behaviour on a call**. It does not assess
model quality, clinical reasoning, fairness, or HIPAA compliance, and it issues
no certification. It produces evidence and measurable baselines.

---

## 8. Reporting a vulnerability

Email **contact@nhid-clinical.org**, or use GitHub private vulnerability
reporting on the repository. Please include reproduction steps. We will
acknowledge within 5 business days and give an assessment and expected timeline
within 15. We will not pursue action against good-faith research that respects
these boundaries: no access to data you do not own, no denial of service, and no
testing against a deployment that is not yours.

---

## 9. What we will not claim

Not an accredited standard. Not a certification. Not a regulatory requirement.
Not HIPAA-compliant software. No adopters, pilots, customers or deployments. No
"first" or "only" positioning. Our NIST engagement is a **public comment
submission**, not adoption or endorsement.

Regulatory instruments the controls map to conceptually — EU AI Act Art. 50(1),
California AB 2905, FCC 24-17, NIST AI RMF, ISO/IEC 42001, CMS-0057-F — are
**mappings, not compliance**. Alignment is not endorsement.
