# Monitoring and evidence — the commercial product

**Status: BUSINESS HYPOTHESIS. NEEDS CUSTOMER VALIDATION.**

There are zero deployments, zero pilots and zero validated willingness-to-pay. The buyer, the
workflow and the pricing below are hypotheses. Nothing in this document, the application or
its UI may be presented to anyone as evidence of demand.

## What it is, in one sentence

NHID monitors healthcare voice-AI interactions against defined governance controls and gives
organizations the evidence and workflow needed to investigate what happened.

## The problem it addresses

A payer receives inbound calls from provider vendors, an increasing share of them placed by AI
voice agents. It cannot say how many were AI, whether they disclosed it, whether they asked for
member data before disclosing, or whether a request to speak to a human was honoured — and it
has no record to show anyone.

This product answers those questions over interactions the customer **already has**. Nothing in
production changes, no provider has to issue a credential, and no vendor has to integrate.

## The loop

```
Ingest → Normalize → Evaluate → Monitor → Investigate → Review → Report
```

| Step | Where |
|---|---|
| Ingest | `POST /saas/monitor/ingest` — upload transcripts or event exports |
| Normalize | `saas_layer/normalization.py` — one canonical shape; `generic`, `twilio`, `vapi` |
| Evaluate | `saas_layer/monitoring.py` — IDG-01, PDX-01, EIT-01, ATR-01 |
| Monitor | `GET /saas/monitor/metrics`, the Overview screen |
| Investigate | Interaction detail: transcript, per-control result, the reason for each |
| Review | Findings queue: open → under review → resolved |
| Report | `GET /saas/monitor/assessments/{id}/report` |

## Four result states, and why "unknown" is one of them

A control returns `pass`, `exception`, `unknown` or `not_assessable`.

Forcing a binary verdict onto an interaction that cannot support one is how a governance record
becomes fiction. The clearest case is escalation: if a human asks for a person and the recording
ends, completion was neither observed nor refused. Reporting that as a pass asserts a transfer
nobody saw; reporting it as a failure asserts a refusal nobody saw. It is reported as **unknown**,
and it still raises a finding, because it is exactly the thing a human should look at.

`not_assessable` is different: the evidence needed was never present at all.

## What it does not do

- **No score.** No composite, no tier, no grade, no percentage blending unlike denominators.
  The former CAS score, its "Verified Trust" / "Conditional Trust" tiers and its badges are
  withdrawn, and nothing here reintroduces them under another name.
- **No certification.** The report is an assessment of observed controls over a stated set of
  interactions. It is not a certification, compliance certificate, trust assessment or approval.
- **No speech recognition.** The product evaluates transcripts it did not produce. Every
  interaction carries a transcription attestation — `measured`, `attested` or `unattested` — and
  an unattested one raises a finding rather than being quietly treated as fine.
- **No legal conclusions.** Findings are *governance exceptions*, not regulatory violations.

## The ASR dependency, stated plainly

Controls read text. A disclosure that was spoken but mis-transcribed reads as a missing
disclosure. An escalation request that was mis-transcribed produces **no finding at all**, and
the record then attests to a compliant interaction — the one failure mode the evidence cannot
reveal on its own.

That is why the attestation travels with every interaction and appears on every report. Assuring
transcription quality, including across speaker groups, is the deploying organization's job. This
product's contribution is to make the dependency explicit and carry it alongside the finding.

## Free vs commercial

The open framework stays free, and the governance verdict is never paywalled.

**Open (NHID-Clinical):** control definitions, the deterministic engine, conformance tests, the
shadow-evaluation method, the event schema, the verifier and test vectors, the FHIR mapping, the
NHID-Auth profile. A determined organization can self-assess for free, forever, and get a real
answer.

**Commercial (this application):** hosted ingestion at volume, cross-vendor normalization,
continuous monitoring across repeated assessments, retained evidence with access control, the
findings workflow, dashboards, reporting, and questionnaire support.

Every commercial item is a cost of *running a service* — storage, uptime, connectors, retention.
None is a capability withheld from the framework to force a sale.

## Running it locally

```bash
# 1. Postgres
initdb -D /tmp/pgdata-nhid -A trust
pg_ctl -D /tmp/pgdata-nhid -o "-k /tmp/pgrun -p 5433" -l /tmp/pgdata-nhid/log start
createdb -h /tmp/pgrun -p 5433 nhid_saas

# 2. Backend
cd nhid-clinical
export DATABASE_URL="postgresql://postgres@127.0.0.1:5433/nhid_saas"
export HMAC_SECRET="a-real-secret-in-any-deployment"
uvicorn saas_main:app --port 8010

# 3. Frontend
cd artifacts/nhid-saas
PORT=5173 BASE_PATH=/ VITE_API_BASE=/saas-api npx vite --config vite.config.ts
```

## Demo path

1. Create an org and copy its API key (`POST /saas/orgs/register`).
2. Open **Governance Ops → Assessments**, create an assessment.
3. Select it, click **Load synthetic demo set (10)**. Ten synthetic interactions are ingested
   and evaluated in one step.
4. **Overview** now shows real figures computed from those rows — disclosure rate,
   Impersonation Latency distribution, escalation outcomes, transcription attestation.
5. **Interactions** lists them; open one to see the transcript with the disclosure turn
   highlighted and a per-control explanation of every result.
6. **Findings** shows the exceptions raised. Open one, record a reviewer and notes, resolve it.
7. **Reports** generates the Healthcare Voice-AI Governance Assessment, including its
   limitations and a notice that the records are synthetic.

Every demo record is flagged synthetic in the database, in the UI and in the report.

## Tests

```bash
cd nhid-clinical
export DATABASE_URL=... HMAC_SECRET=...
python -m pytest tests/test_monitoring_e2e.py -q     # 25 tests, full loop over HTTP
python -m pytest tests/ -q                           # whole suite
```

`tests/test_monitoring_e2e.py` covers eight fixtures — compliant, missing disclosure, delayed
disclosure, protected data before disclosure, escalation completed, escalation refused,
escalation outcome unknown, and unattested transcription — then drives
upload → normalize → evaluate → finding → evidence → review → report end to end.
