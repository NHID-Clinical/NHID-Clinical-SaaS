# Shadow Pilot CRM

Shadow Pilot CRM is a dark-mode internal operations workspace for coordinating NHID-Clinical Shadow Pilots, communications, operational knowledge, call-evaluation evidence, consultant certification, marketing activity, competitive intelligence, and administration.

## Architecture Overview

The application uses a React 19 and TypeScript client with Tailwind CSS and shadcn/ui primitives. An Express server exposes typed tRPC procedures, while Drizzle ORM manages the MySQL-compatible managed database. Authentication is available through the supplied Manus OAuth integration. The built-in object storage helper stores uploaded source files, including CSV call-volume evidence; the platform’s hosted language-model service is used server-side for knowledge-grounded email-draft generation.

| Layer         | Implementation                                                | Responsibility                                                                                                          |
| ------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Client        | React, TypeScript, Tailwind CSS, shadcn/ui, Recharts, dnd-kit | Dashboard, pipeline, triage, knowledge, evaluation, and administration interfaces                                       |
| API           | Express and tRPC                                              | Typed intake, drafting, categorization, scoring, and file-ingestion procedures                                          |
| Persistence   | Drizzle ORM with managed MySQL-compatible database            | Operational records, access roles, knowledge articles, evaluations, trainees, calendar entries, and competitor profiles |
| Storage       | Built-in S3-backed helper                                     | Uploaded CSV evidence and future generated artifacts                                                                    |
| AI assistance | Server-side built-in LLM helper                               | Human-reviewed knowledge-grounded email response drafts                                                                 |

> **Human review is required before an email is sent.** The interface intentionally models the controlled workflow as **Draft → Review → Send**. No procedure sends email.

## Access Control

Every procedure that reads or writes operational data requires a session. Three
procedure types enforce this:

| Procedure            | Who                   | Used for                                                                        |
| -------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `publicProcedure`    | Anyone                | Only partner intake, the health probe, and auth                                 |
| `protectedProcedure` | Any signed-in account | Knowledge reading, own profile, organization name                               |
| `staffProcedure`     | `admin`, `consultant` | The operational workspace: partners, inbox, evaluations, calendar, intelligence |
| `adminProcedure`     | `admin`               | Deletions, organization settings, user roles, reseeding                         |

New accounts default to `partner`. The owner (`OWNER_OPEN_ID`) is promoted to
`admin` on first sign-in; an admin can change roles from Settings.

Authorization is covered by `server/authorization.test.ts`, which asserts every
procedure against an anonymous caller and each of the three roles.

## Local Setup

Install the dependencies, then start the development service from the project root.

```bash
pnpm install
pnpm dev
```

Run the automated rules and type checks with the following commands.

```bash
pnpm test
pnpm check
```

The project uses system-provided configuration in the managed environment. For a compatible local environment, provide the following values through your secure environment-management solution rather than committing a `.env` file.

| Variable                      | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`                | MySQL-compatible connection string for Drizzle                 |
| `JWT_SECRET`                  | Session-signing secret                                         |
| `OAUTH_SERVER_URL`            | OAuth backend base URL                                         |
| `VITE_APP_ID`                 | OAuth application identifier                                   |
| `VITE_OAUTH_PORTAL_URL`       | Browser login portal URL                                       |
| `BUILT_IN_FORGE_API_URL`      | Built-in platform service endpoint for LLM and storage helpers |
| `BUILT_IN_FORGE_API_KEY`      | Server-side credential for the built-in platform service       |
| `VITE_FRONTEND_FORGE_API_URL` | Front-end platform service endpoint                            |
| `VITE_FRONTEND_FORGE_API_KEY` | Front-end platform service credential                          |

## Data Model

The schema is organized around the full operational lifecycle. The `partners` table anchors the seven-stage pipeline: **Applied**, **Vetted**, **Contract Sent**, **Integrated**, **Live**, **Reporting**, and **Complete**. Related tables hold integration status, call volumes, raw event logs, and chronological partner communications.

| Domain                   | Core tables                                                                     |
| ------------------------ | ------------------------------------------------------------------------------- |
| Partner operations       | `partners`, `partnerIntegrations`, `callVolumes`, `eventLogs`, `communications` |
| Email operations         | `emailMessages`, `emailTemplates`                                               |
| Knowledge and evaluation | `knowledgeArticles`, `callEvaluations`                                          |
| Training                 | `trainees`, `certificationProgress`                                             |
| Content and intelligence | `contentEntries`, `competitors`                                                 |
| Administration           | `users`, `organizationSettings`                                                 |

The `users.role` field is constrained to the requested role values: `admin`, `consultant`, and `partner`. The call-evaluation schema limits overall grades to **A**, **B**, **C**, and **F**. Email records use the exact approved category set, while content entries use the required lifecycle: **Idea → Draft → Scheduled → Published**.

Referential integrity is enforced by the database: every `partnerId` and
`traineeId` is a foreign key, `(traineeId, module)` and `(partnerId, weekStart)`
are unique, and dependent rows cascade on delete. Competitors are rows rather
than a schema enum, and the comparison matrix is normalized into
`matrixCapabilities` + `matrixCells`, so tracking a new competitor is an INSERT
rather than a migration.

## Seed Data

The idempotent seed routine runs once at server start, and on demand through the admin-only `operations.seed` procedure. It is serialized with a database advisory lock so concurrent starts cannot double-seed, and it is never invoked from a request handler. It creates three synthetic Shadow Pilot partners, 15 synthetic inbound emails, 11 knowledge-base article starters, five evaluation records, a certified trainee with module progress, 30 content entries, the four requested competitor profiles, and ten response-template types. All seeded records are explicitly synthetic operational demo data rather than customer reviews, testimonials, or real clinical interactions.

## Core Policy Engine

The policy engine evaluates a transcript against the five identifiers:
**IDG-01** (automation disclosure), **PDX-01** (PHI request timing), **DBC-01**
(deceptive human impersonation), **EIT-01** (escalation handling), and
**ATR-01** (audit traceability).

Transcripts are parsed into turns by `server/transcript.ts` before any control
runs, because the controls are fundamentally about ordering and attribution —
whether disclosure came _before_ the PHI request, whether an escalation request
was honored _afterwards_, and who said what. Prefix lines with `Agent:` /
`Caller:` for the most accurate results; ATR-01 cannot score above **B** without
speaker attribution.

Three properties matter when reading a report card:

1. **`not-evaluated` is not a pass.** If nobody requested PHI, PDX-01 reports
   `not-evaluated` and is excluded from the overall grade. A control that never
   fired tells you nothing about compliance, so it must not inflate the score.
2. **Every finding carries evidence** — the turn index, the speaker, and a
   verbatim quote — so a grade can be checked rather than trusted.
3. **Negation is handled.** "We will never ask for your date of birth" is not a
   PHI request.

The detectors are explainable heuristics, not a trained classifier. They are
substantially broader than simple keyword matching and are covered by 28 tests
including the phrasings that keyword matching missed, but **no accuracy
measurement against a labelled corpus exists yet** (tracked in `todo.md`). This
is an operational workflow aid, not clinical, legal, or regulatory advice;
validate the rules and thresholds with qualified subject-matter experts before
relying on them for a compliance decision.

## Deployment

The project is prepared for the managed built-in hosting environment. Create a checkpoint once the remaining TODO items are complete, then use the **Publish** control in the project interface to release it and obtain the live URL. The runtime is stateless and uses managed database and object-storage services; do not rely on local files for persistent production data.

If you prefer to use an external host later, verify its compatibility with the managed OAuth, database, storage, and built-in AI service configuration first. The current implementation is designed for the built-in deployment workflow.

## Testing

```bash
pnpm test          # 148 tests; the database suite is skipped
pnpm check         # types
```

The end-to-end suite runs against a real MySQL-compatible database when
`TEST_DATABASE_URL` is set, bringing the total to 159:

```bash
TEST_DATABASE_URL="mysql://root@127.0.0.1:3306/nhid_test" pnpm test
```

It covers seeding and its idempotency, concurrent seeding, intake persistence,
pipeline transitions, call-volume re-import, concurrent module completion, and
dashboard aggregation. Point it at a throwaway database — it writes.

## Current Implementation Notes

All modules are wired to persistence and guarded by role. `VERIFICATION.md`
records what was checked and how.

The open items in `todo.md` that matter most before production:

- **The `partner` role has no scoped view.** There is no link between a `users`
  row and a `partners` row, so partner accounts are denied the staff workspace
  rather than shown their own data.
- **The policy heuristics are unmeasured.** They are far broader than keyword
  matching and well covered by unit tests, but no precision/recall figure
  against labelled transcripts exists.
- **The baseline seed is not transactional.** A mid-seed failure leaves a
  partially seeded database that the emptiness guard will then skip.
- **`partners.publicIntake` is unthrottled.** It is anonymous by design and
  needs rate limiting before public exposure.
- Route-by-route accessibility review has not been done.
