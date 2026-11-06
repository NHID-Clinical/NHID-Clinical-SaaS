# Business Associate Agreement: draft template for counsel

> **DRAFT FOR LEGAL REVIEW. NOT LEGAL ADVICE. NOT SIGNED. NOT IN EFFECT.**
> No business associate agreement is in place with anyone. This is a starting
> structure that follows the contract provisions HIPAA requires
> (45 CFR 164.504(e), and 164.314(a) for security). It exists so that
> counsel's review begins from the right outline. Every bracketed item needs
> counsel's text, and counsel may restructure it entirely. Do not send it to a
> customer as an offer.

**Parties:** [Covered Entity legal name] ("Covered Entity") and [NHID-Clinical
operating entity, once one exists] ("Business Associate").

**Effective date:** [date]

## 1. Definitions

Terms used and not defined here have the meanings given in 45 CFR Parts 160
and 164, among them Breach, Protected Health Information (PHI), Security
Incident, Subcontractor and Unsecured PHI.

## 2. Permitted uses and disclosures — 164.504(e)(2)(i)

Business Associate may use and disclose PHI only:
- (a) to perform the services described in [the Service Agreement]: receiving
  transcripts of provider-to-payer administrative calls, evaluating them
  against the NHID-Clinical controls, and producing findings and reports for
  Covered Entity;
- (b) as required by law;
- (c) for its proper management and administration, within
  164.504(e)(4) [counsel to confirm whether to permit].

Business Associate will not use or disclose PHI in a way that would violate
Subpart E if done by Covered Entity. [Counsel: the minimum-necessary
obligation (164.502(b)).]

**Service facts for counsel:**
- Call audio is never received.
- Transcripts are retained for 30 days by default, then redacted, with a
  per-organization override capped at 365 days and deletion on request.
- No PHI is used to train models.
- [Confirm data location and subprocessors.]

## 3. Safeguards — 164.504(e)(2)(ii)(B); 164.314(a)

Business Associate will use appropriate safeguards and comply with Subpart C
of Part 164 for electronic PHI.
- [Reference the security measures in `docs/ENTERPRISE-SECURITY-REVIEW.md`.]
- [Counsel and security: no SOC 2 report or third-party assessment exists;
  decide what representations, if any, are made.]

## 4. Reporting — 164.504(e)(2)(ii)(C); 164.410

Business Associate will report to Covered Entity:
- any use or disclosure not provided for by this Agreement;
- any Security Incident [counsel: the treatment of unsuccessful attempts];
- any Breach of Unsecured PHI, without unreasonable delay and in no case later
  than [__] calendar days after discovery (the regulatory outer limit is 60
  days under 164.410), with the information 164.410(c) requires.

## 5. Subcontractors — 164.504(e)(2)(ii)(D); 164.502(e)(1)(ii)

Business Associate will ensure that any subcontractor that creates, receives,
maintains or transmits PHI on its behalf agrees to the same restrictions and
conditions.
- [List the current subprocessors: hosting, database, email delivery,
  identity provider.]

## 6. Individual rights — 164.504(e)(2)(ii)(E)–(G)

Business Associate will, within [__] days of a request from Covered Entity:
- (a) make PHI in a Designated Record Set available for access (164.524)
  [counsel: whether the transcripts held form part of a Designated Record
  Set];
- (b) make amendments (164.526);
- (c) provide the information needed for an accounting of disclosures
  (164.528).

## 7. Covered Entity's obligations

To the extent Business Associate carries out an obligation of Covered Entity
under Subpart E, it will comply with the requirements that apply to Covered
Entity in performing that obligation (164.504(e)(2)(ii)(H)).

## 8. Books and records — 164.504(e)(2)(ii)(I)

Business Associate will make its internal practices, books and records about
PHI available to the Secretary of HHS to determine compliance.

## 9. Term and termination — 164.504(e)(2)(ii)(J), (e)(2)(iii)

- (a) **Term:** [__].
- (b) **Termination for material breach:** Covered Entity may terminate if
  Business Associate violates a material term and does not cure within [__]
  days.
- (c) **Return or destruction:** at termination, Business Associate will
  return or destroy all PHI, keeping no copies. Where that is infeasible, it
  will extend these protections and limit further use. Engineering fact: the
  platform supports an owner-initiated purge of all transcript text now
  (`POST /saas/monitor/retention/purge`). Findings and evaluations are kept
  as evidence and hold no transcript text. [Counsel: decide whether findings
  are PHI and how they are returned or destroyed.]

## 10. Miscellaneous

[Regulatory references, amendment, survival, interpretation, no third-party
beneficiaries, governing law. Counsel to supply.]

---

*Prepared as engineering input to counsel, 2026-11-06. It cites the regulation
so that counsel can check each section against it. Whether to offer a BAA,
and on what terms, is a legal and business decision not made here.*
