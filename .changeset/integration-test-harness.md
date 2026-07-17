---
"awcms": patch
---

Add the first `tests/integration/` suite — a real-PostgreSQL harness plus the
priority tests ported from awcms-mini (Issue #154).

Until now every one of this repo's `tests/*.test.ts` was a pure-unit test or a
migration-shape assertion; nothing exercised RLS, FK, unique constraints,
locking, or a real request path. That is the root reason several DB-layer bugs
reached the tree undetected (RLS inert on 23 tables, PR #139). awcms-mini has
101 integration tests; awcms had none.

New `tests/integration/harness.ts` provisions, from the CI-supplied superuser
`DATABASE_URL`, a throwaway database owned by a purpose-built non-superuser
role, runs the REAL migration runner (`bun scripts/db-migrate.ts`) as that
role, demotes it, and activates migration 019's least-privilege `awcms_app`
role — reproducing production's exact connection posture (non-superuser,
NOBYPASSRLS, `FORCE` RLS live). It repoints `DATABASE_URL` at the app role so
every route handler and `getDatabaseClient()` call runs least-privilege, and
tears the database down afterwards. Ref-counted so multiple files share one
database within a `bun test` process.

New tests (all gated on `DATABASE_URL`, so `bun test` without a database — as
in `ci.yml` — skips cleanly, and they execute in `release.yml`, which provides
a `postgres:18.4` service):

- `db-role-separation.integration.test.ts` — pins PR #139/#141: all 23 tables
  are `ENABLE`+`FORCE`, cross-tenant SELECT/UPDATE/DELETE/INSERT are blocked
  for the owner posture, a live-catalog check catches any future table shipped
  with `ENABLE` but no `FORCE`, and the `awcms_app` grant matrix + fail-closed
  all-zero `app.current_tenant_id` default. `awcms_app` assertions skip cleanly
  and informatively if migration 019 is ever absent.
- `module-tenant-lifecycle.integration.test.ts` — pins the PR #139 invariant
  that disabling a module actually returns `403 MODULE_DISABLED` from its own
  endpoints (not just flips a flag), plus enable/disable rules, audit, and
  cross-tenant isolation, through the real route handlers.
- `reporting-projections.integration.test.ts` — pins the incremental
  cursor-table worker's bounded-pass/resume correctness and the event-activity
  watermark comparison, making the source references in
  `event-activity-projection.ts` and `reporting/README.md` true.
- `object-storage-uploader.integration.test.ts` — the ADR-0006 provider path
  (checksum-mismatch pre-check, provider 5xx, timeout, circuit breaker) over a
  real loopback S3 round trip. Not database-gated — runs everywhere.

Tests-only: no runtime code, migration, schema, or API surface changes.
