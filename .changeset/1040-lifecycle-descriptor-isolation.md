---
"awcms": patch
---

fix(data-lifecycle): one failing descriptor no longer aborts the tenant's archive-purge pass (#1040).

- `data-lifecycle:archive-purge`, run as `awcms_worker`, aborted each tenant at the first delegated dry-run snapshot it could not `SELECT` (29 inventory, procurement, HR and booking tables), so no generic retention purge, including the `awcms_idempotency_keys` one from #1034, ever took effect. A descriptor that throws is now logged (descriptor key and SQLSTATE only), recorded as a `failed` run with `errorCount: 1`, and the pass continues. Expected failures (a delegated snapshot of a baseline table failing with SQLSTATE `42501`) are counted as `knownUnreadableDelegated`, recorded as `failed` runs and do NOT make the job `partial`; any other failure, including any generic descriptor, makes it `partial` and exit non-zero.
- `awcms_worker` is deliberately NOT granted `SELECT` on those tables. `data-lifecycle:worker-grants:check` now also covers delegated descriptors with a shrink-only baseline; a new unreadable delegated descriptor or a stale entry fails the gate.
- No migration. Follow-up: a count-only SECURITY DEFINER snapshot per owning module.

**Upgrade note.** `data-lifecycle:archive-purge` exits 0 while the only failures are the 29 known-unreadable delegated snapshots; the count is in the job output. A non-zero exit now means something unexpected.
