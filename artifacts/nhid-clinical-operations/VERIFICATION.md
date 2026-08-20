# Verification Record

Last updated after the operational-hardening pass.

## Automated

| Check                     | Command                           | Result                                       |
| ------------------------- | --------------------------------- | -------------------------------------------- |
| Types                     | `pnpm check`                      | Clean under `strict: true`                   |
| Unit + contract tests     | `pnpm test`                       | 148 passing, 11 skipped (the database suite) |
| Full suite incl. database | `TEST_DATABASE_URL=... pnpm test` | 159 passing, 0 skipped                       |
| Client build              | `vite build`                      | Succeeds                                     |
| Server bundle             | `esbuild server/_core/index.ts`   | Succeeds                                     |

Test files and what they cover:

- `policyEngine.test.ts` (28) — each of the five controls, including the
  phrasings the previous keyword matcher missed, negation handling, turn
  ordering, `not-evaluated` semantics, and confidence derivation.
- `authorization.test.ts` (94) — every procedure asserted against anonymous,
  `partner`, `consultant`, and `admin` callers.
- `callVolumeCsv.test.ts` (14) — quoted fields, CRLF, malformed rows, duplicate
  weeks, timezone anchoring.
- `persistence.test.ts` (8) — intake and call-volume writes, storage key
  sanitization, partial profile updates.
- `integration.test.ts` (11) — end-to-end against a real MySQL-compatible
  database: seeding, idempotency, concurrent seeding, pipeline transitions,
  re-import behaviour, concurrent module completion, dashboard aggregation.
- `email.mutations.test.ts`, `email.deleteTemplate.test.ts`, `auth.logout.test.ts` (4).

## Manual verification against a live server

Run against MariaDB 10.11 with a production build (`node dist/index.js`):

- The server refuses to start when `JWT_SECRET` is unset or shorter than 16
  characters, and when `DATABASE_URL` is unset.
- Seeding runs once at startup (`[Seed] created` / `already-seeded`), not per
  request.
- `system.health` responds without a session.
- `partners.publicIntake` accepts an anonymous submission over HTTP, writes the
  partner row, and records a `partner.applied` event.
- `email.inbox`, `partners.detail`, `operations.snapshot`, `intelligence.list`,
  `knowledge.list`, `settings.organization`, `calendar.list` and
  `email.templates` all return `401 UNAUTHORIZED` without a session.

## Migration

`drizzle/0004_operational_hardening.sql` was applied to a database holding
pre-migration data, including duplicate `(traineeId, module)` rows, duplicate
`(partnerId, weekStart)` rows, duplicate article titles, and rows pointing at
deleted partners. Verified afterwards:

- Duplicates collapsed to the most recent row.
- Orphaned child rows removed; nullable references set to `NULL`.
- All `comparisonMatrix` values migrated into `matrixCapabilities` /
  `matrixCells` before the old table was dropped.
- Every new unique constraint and foreign key rejects a violating insert.
- `ON DELETE CASCADE` removes dependent rows.

## Known gaps

Tracked in `todo.md`. The significant one is that the `partner` role currently
has no data of its own to see — there is no link between a `users` row and a
`partners` row, so "view-only access to their own data" is not yet implemented.
Partner accounts are denied access to the staff workspace rather than given a
scoped view.
