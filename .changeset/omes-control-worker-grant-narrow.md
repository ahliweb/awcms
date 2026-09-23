---
"awcms": patch
---

fix(security): narrow `awcms_worker`'s grant on the eight `omes_control` tables to what it actually executes

`sql/154` granted `awcms_worker` the same `SELECT, INSERT, UPDATE, DELETE` it gave
`awcms_app` on all eight `omes_control` tables. `omes_control` registers no scheduled
worker entrypoint at all — the control API's mutations run as `awcms_app`,
per-request. The only worker-run code that touches these tables is the generic
`data-lifecycle:archive-purge` engine, driven by each table's `dataLifecycle`
descriptor: every one of the eight is `mode: "hard_delete"`, `executionMode:
"generic"`, which is a bounded cursor `SELECT` plus an aged-row `DELETE`.

`INSERT` and `UPDATE` were therefore never used by any worker-run statement, and
holding them was a live least-privilege breach from the moment `sql/154` landed.
`security:readiness worker/setup grant check` (Issue #163) caught it correctly and
went red on `main` — the check fails in BOTH directions, and this was the
over-grant direction, not a missing matrix entry.

The fix removes the privileges rather than widening the matrix to accommodate them.
A readiness gate that is made green by relaxing what it measures is worse than no
gate, so `WORKER_ROLE_GRANTS` now claims exactly `["SELECT", "DELETE"]` for each of
the eight tables and the database is brought into line with it.

Two implementation notes worth keeping:

- This is a new migration, not an edit to `sql/154`. An applied migration is
  immutable here — editing one in place blocks `bun run db:migrate` on every
  deployment that has already run it — so the correction is additive: revoke
  exactly the two excess verbs.
- The `REVOKE`s are written one role per statement, paired with a no-op
  single-role `GRANT SELECT, DELETE`. `sql/154`'s combined-role
  `GRANT ... TO awcms_app, awcms_worker` form is not recognised by the replay
  parser in `tests/db-role-separation-worker-setup-migration.test.ts`, which reads
  only one-role-per-statement lines. The paired grant is redundant against a real
  database and exists so the static replay's picture of the final grant matches
  what `checkWorkerSetupRoleGrants` observes on a live Postgres.

`awcms_app` is untouched — the control API needs full CRUD there.
