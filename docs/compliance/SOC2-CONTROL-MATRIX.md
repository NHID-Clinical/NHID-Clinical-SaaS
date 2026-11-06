# SOC 2 readiness: control matrix

> **This is a self-prepared readiness matrix. It is not a SOC 2 report.**
> No SOC 2 Type I or Type II examination has been performed, and nothing here
> may be described as SOC 2 compliance, certification or attestation. It maps
> the 2017 Trust Services Criteria (AICPA, with the 2022 revised points of
> focus) to what exists in this repository today. It is for a compliance
> automation vendor or an auditor to start from. Last reviewed 2026-11-06.

**Columns:**
- **Evidence in code** is something a reviewer can run or read.
- **Status:**
  - *Implemented*: the control exists in code and is tested.
  - *Partial*: some of it exists.
  - *Policy needed*: the control is organizational and needs a written policy
    and evidence of operation, which code cannot supply.
  - *Gap*: not in place.

## Common criteria (Security)

| TSC | Control area | Evidence in code | Status |
| :-- | :-- | :-- | :-- |
| CC1.1–1.5 | Control environment: integrity, oversight, structure, competence, accountability | — | **Policy needed.** One-person organization today. Board oversight, a code of conduct and HR controls do not exist yet. |
| CC2.1 | Information for internal control | Activity log; audit chain; CI results; SBOM | Partial |
| CC2.2–2.3 | Internal and external communication | `docs/ENTERPRISE-SECURITY-REVIEW.md` (including the gaps); a vulnerability-reporting route (§8) | Partial: no customer-notification policy |
| CC3.1–3.4 | Risk assessment, including fraud and change | `docs/compliance/THREAT-MODEL.md` | Partial: no recurring risk-assessment cadence |
| CC4.1–4.2 | Monitoring of controls | CI on every PR: tests, dependency audit, static analysis, headers, ZAP baseline | Partial: no periodic control review |
| CC5.1–5.3 | Control activities and policies | Fail-closed startup checks (`scripts/check_startup.py`) | **Policy needed** |
| CC6.1 | Logical access: identification and authentication | Hashed API keys; scoped, expiring keys; magic-link sign-in; OIDC SSO with PKCE; operator scrypt | Implemented |
| CC6.2 | Provisioning and deprovisioning users | Owner-only invite and remove; removal ends sessions; SSO joins only at allowed domains with a non-owner role; all logged | Implemented |
| CC6.3 | Least privilege, role-based access | Owner / member / auditor; key scopes enforced before any route | Implemented |
| CC6.4 | Physical access | Inherited from the hosting providers (Render, managed Postgres) | Inherited: needs the providers' SOC 2 reports |
| CC6.5 | Disposal of data | Transcript retention (30 days by default), provable purge, deletion on request | Implemented |
| CC6.6 | Protection against threats from outside the system boundary | CORS allowlist, security headers, input bounds, SSRF screen, login throttles | Implemented |
| CC6.7 | Data in transit | HSTS; TLS from the platform | Implemented / inherited |
| CC6.8 | Malicious or unauthorized software | Dependency audit and SBOM in CI; lockfile-frozen installs | Partial: no runtime malware control |
| CC7.1 | Detecting vulnerabilities and configuration changes | pip-audit, pnpm audit, Bandit, ZAP baseline on every PR | Implemented (automated); **Gap**: no third-party pen test |
| CC7.2 | Monitoring for anomalies | Activity log; failed-login throttle records | Partial: no alerting or SIEM integration |
| CC7.3–7.5 | Incident response and recovery | — | **Gap**: no incident-response plan |
| CC8.1 | Change management | PRs, CI gates, forward-only migrations, CODEOWNERS | Implemented: branch protection settings must be confirmed |
| CC9.1 | Business disruption risk | — | **Gap**: no business continuity or disaster recovery plan; single instance |
| CC9.2 | Vendor and business-partner risk | — | **Policy needed**: subprocessor list and vendor reviews |

## Additional criteria

| TSC | Area | Evidence | Status |
| :-- | :-- | :-- | :-- |
| A1.1–1.3 | Availability: capacity, backup, recovery | Health check endpoint | **Gap**: free plan, one instance, backup and restore untested |
| C1.1–1.2 | Confidentiality: identify and dispose | Data classification of pilot runs; retention and purge | Partial |
| PI1.1–1.5 | Processing integrity | Deterministic engine; frozen baselines; per-control results with four states | Partial |
| P1–P8 | Privacy | — | **Gap**: no privacy notice or data subject request process beyond purge |

## What closing the gaps takes

1. **Policies.** Information security, access control, incident response,
   business continuity, vendor management, data retention and acceptable use.
   A compliance automation vendor's templates are the usual start.
2. **Evidence of operation.** Access reviews, change approvals and
   incident-response drills, recorded over the Type II window (usually 3–12
   months).
3. **A third-party penetration test.**
4. **An auditor**, a licensed CPA firm, for a Type I and then a Type II.

None of these can be closed by code. The engineering column is as strong as it
can be made without them.
