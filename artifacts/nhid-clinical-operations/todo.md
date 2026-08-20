# Project TODO

Items are marked complete only when there is a test or a verified manual check
behind them. See `VERIFICATION.md` for how each was confirmed.

## Security and access control

- [x] Require a session for every procedure that reads or writes operational data.
- [x] Add `staffProcedure` (admin + consultant) and `adminProcedure` (admin only), and apply one of them to every non-public procedure.
- [x] Restrict destructive actions (template/campaign/competitor deletion, organization settings, reseed) to admin.
- [x] Keep `publicProcedure` for exactly three surfaces: partner intake, health, and auth.
- [x] Cover every procedure with authorization tests for anonymous, partner, consultant, and admin callers.
- [x] Fail startup when `JWT_SECRET` is missing or too short, rather than signing sessions with an empty key.
- [x] Add admin user-role management (`settings.listUsers`, `settings.setUserRole`) with self-demotion refused.
- [ ] Give the `partner` role a scoped view of its own data. This needs a link between `users` and `partners`, which does not exist yet; partner accounts are currently denied the staff workspace outright.
- [ ] Add rate limiting to `partners.publicIntake` — it is unauthenticated by design and currently unthrottled.

## Correctness

- [x] Persist public intake submissions and record an auditable `partner.applied` event.
- [x] Read the partner pipeline from the database instead of a hardcoded array.
- [x] Persist imported call volumes to `callVolumes`, keyed on `(partnerId, weekStart)` so re-import corrects instead of doubling.
- [x] Reject malformed evidence files with the offending row named, instead of silently skipping rows.
- [x] Parse CSV properly: quoted fields, embedded commas, doubled quotes, CRLF.
- [x] Stop `profile.save` wiping the stored email when the field is omitted.
- [x] Compute the dashboard from stored rows, including a real control pass rate and violation trend.
- [x] Return typed `TRPCError`s and fail loudly when the database is unconfigured.

## Policy engine

- [x] Evaluate transcripts by turn rather than by character offset.
- [x] Handle negation, so "we will never ask for your date of birth" is not scored as a PHI request.
- [x] Broaden disclosure, impersonation, PHI and escalation detection to the phrasings the keyword lists missed.
- [x] Report `not-evaluated` when a control has no trigger, and exclude those from the overall grade instead of scoring them A.
- [x] Make ATR-01 capable of failing: it now checks identifier format, reconstructability, and speaker attribution.
- [x] Attach verbatim evidence (turn, speaker, quote) to every finding.
- [x] Derive categorization confidence from match strength and report competing categories.
- [x] Show `not evaluated` distinctly in the report card and CSV export rather than rendering a grade.
- [ ] Validate the control thresholds with a qualified reviewer against labelled transcripts. The heuristics are materially better than the previous keyword matching but are still heuristics, and no accuracy measurement exists.
- [ ] Add a labelled transcript corpus and report precision/recall per control.

## Data model

- [x] Add foreign keys and indexes to every `partnerId` / `traineeId` reference.
- [x] Add a unique constraint on `(traineeId, module)` and make module completion idempotent.
- [x] Add a unique constraint on `(partnerId, weekStart)` and on `knowledgeArticles.title`.
- [x] Make competitors data rather than a schema enum, so adding one is an INSERT.
- [x] Normalize the comparison matrix into `matrixCapabilities` + `matrixCells`.
- [x] Write a data-preserving migration and verify it against a database holding duplicates and orphans.

## Operations

- [x] Move seeding off the request path to server startup and an admin-only procedure.
- [x] Serialize seeding with an advisory lock so concurrent first requests cannot double-seed.
- [x] Replace the per-article backfill lookup with a single query.
- [x] Stop `intelligence.matrix` writing default rows from inside a query.
- [x] Read seeded ids back from the database instead of assuming autoincrement starts at 1.
- [ ] Wrap the baseline seed in a transaction. The advisory lock prevents concurrent double-seeding, but a mid-seed failure still leaves a partially seeded database that the "is it empty" guard will skip.
- [ ] Reduce `upsertUser` write amplification — every authenticated request currently writes `lastSignedIn`.

## Maintainability

- [x] Format the entire codebase with the project's own Prettier config.
- [x] Delete the mock screens in `Home.tsx` that toasted success without saving.
- [x] Derive client types from the router instead of hand-maintaining duplicates.
- [x] Remove unrouted template code (`ComponentShowcase.tsx`, `AIChatBox.tsx`, `vite.config.ts.bak`).
- [x] Add loading, empty and error states to the comparison matrix.
- [ ] Add loading/empty/error states to the remaining persisted pages; only the matrix has the full set.
- [ ] Complete a route-by-route accessibility pass. Not started.
- [ ] Split the 2.3 MB client bundle; the build warns about chunk size.

## Original feature backlog (unchanged, previously delivered)

- [x] Shared data model, workflow constants, and access-control roles.
- [x] Dark-mode dashboard shell with responsive sidebar and mobile drawer.
- [x] Seven-stage partner pipeline board.
- [x] Email triage, categories, draft-review-send queue, ten template types.
- [x] Searchable Markdown knowledge base with Tier 0/Tier 1 and 20-question FAQ seeds.
- [x] Transcript ingestion, A/B/C/F report cards, CSV export.
- [x] Consultant trainee records, modules 101–107, completion certificates.
- [x] 30-day marketing calendar with the Idea → Draft → Scheduled → Published workflow.
- [x] Competitor profiles, feature matrix, and sales positioning.
- [x] Settings, profile, organization, and the Stripe "Coming Soon" placeholder.
- [x] Synthetic operational seed data, explicitly labelled as synthetic.
