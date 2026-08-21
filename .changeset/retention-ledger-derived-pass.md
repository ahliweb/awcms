---
"awcms": patch
---

chore(data-lifecycle): the retention exemption list shrinks for the first time, because `sql/` already answered

`data-lifecycle:table-coverage:check` asks every `awcms_*` table to have answered
the retention question. Until now a table could answer three ways: a
`dataLifecycle` descriptor, a reasoned `BOUNDED_BY_DESIGN` refusal, or a place on
the closed ledger of tables that predate the rule.

`awcms_site_profile` (Issue #596) arrived as a **seventeenth** exemption whose
argument was the second entry's almost word for word — one row per key, upserted,
ceiling is another table. That is exactly the pattern-match the list's own bar was
hardened to catch: **"a net shrink is required, not an argument."**

### The shrink, and the objection it had to answer first

A fourth pass now answers for a table without anybody writing anything down: if
**no role holds `INSERT`** on it anywhere in `sql/`, its row count cannot grow at
runtime. A bound the database enforces, checkable by running one query rather
than by trusting a sentence.

The repo had already considered this and rejected it, in a comment kept precisely
because "the idea is attractive enough that somebody will propose it again". That
rejection was right about the version it was aimed at:

- it derived from `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`, which constrains
  `awcms_app` alone — so `awcms_idn_admin_regions`, 91,000 rows written by a job
  running as `awcms_worker`, would have been exempted as unwritable. The new
  derivation reads **every** role, and that table is now pinned by a test as
  **unsealed**: the counter-example proves the rule instead of refuting it;
- and it judged the parse too expensive for "a question five sentences answer
  better". The parser landed anyway for `data-lifecycle:worker-grants:check`, and
  five sentences had become seventeen entries. Both gates now share one scanner,
  so the comment-swallowing bug that scanner records has one place to be fixed.

### What it paid for

- **`BOUNDED_BY_DESIGN` 17 → 14.** `awcms_entitlements`, `awcms_plans` and
  `awcms_plan_entitlements` leave: their prose argued migration-only authorship,
  which is what `sql/109`'s `REVOKE ALL` already enforces.
- **The debt ledger 108 → 103.** Two catalogues (`awcms_permissions`,
  `awcms_schema_migrations`) and three tables whose writer MOVED and whose INSERT
  was revoked behind it — `awcms_access_assignments` after ADR-0079, both
  `awcms_identity_mfa_*` tables after ADR-0087.
- **Both duplications are now errors**, not tolerated: a sealed table may not also
  be argued in prose or recorded as debt. A hand-written answer the database
  already enforces is not a second opinion, it is a copy — and it goes stale the
  day the grant changes and the sentence does not.

### Fail-closed

If the baseline `GRANT … ON ALL TABLES` / `ALTER DEFAULT PRIVILEGES` can no
longer be found, every table would read as sealed and the whole schema would be
exempted in one silent step. The derivation refuses instead: nothing sealed, and
a printed reason. The gate then reports those tables as unanswered — loud, wrong
in the safe direction, and self-correcting. That direction is planted as a test,
along with statement ordering (privileges are a running total, not a set) and
column-scoped `GRANT INSERT (col)`, which read as "no grant" would have sealed a
table a role can write.

No runtime behaviour changes: no migration, no new grant, no descriptor.
