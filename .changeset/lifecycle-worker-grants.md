---
"awcms": patch
---

fix(data-lifecycle): the retention engine could not touch two of the tables it is responsible for

Found by RUNNING the job against production, not by reading a grant list:

    bun run data-lifecycle:archive-purge --dry-run
    → PostgresError: permission denied for table awcms_delegated_access_grants

`data-lifecycle:archive-purge` runs as `awcms_worker`. Its generic executor
issues a `SELECT` to find candidates and, for `hard_delete` descriptors, a
`DELETE` to remove them. Two lifecycle tables had never been granted either:
`awcms_delegated_access_grants` (`sql/117`) and `awcms_subject_requests`
(`sql/125`).

**Every existing gate passed, and every one of them was right.**
`data-lifecycle:registry:check` verifies the descriptors are well-formed;
`data-lifecycle:table-coverage:check` verifies every lifecycle-bearing table has
one. What nothing compared was the descriptor against the privilege needed to
honour it. The registry said "this table is purged on a 365-day retention", the
database said "no", and each statement was checked in isolation. A descriptor
declaring a retention the engine cannot enforce is not retention — it is a claim,
and ADR-0094's guarantees rested on it.

Two defects with the same silence, and they are not the same defect: the job was
also never scheduled. *Unscheduled* means "it would work if run". This meant "it
would not".

`data-lifecycle:worker-grants:check` closes the class rather than these two rows.
It derives the required privileges from the descriptor registry and checks them
against `sql/`, so a new lifecycle descriptor without its grant fails in CI.

Two things about that gate are worth stating, because both were mistakes it made
first:

- It covers only `executionMode: "generic"` descriptors. The 11 `delegated` ones
  are purged by their owning module's own job, with its own statements and its
  own already-correct grants. The first draft required generic-engine privileges
  for them too and reported **14 findings of which 9 were noise** — which is how
  a gate teaches people to ignore it.
- Its scanner strips SQL comments before matching. Without that, a `--` line
  merely *mentioning* GRANT has no semicolon, so `GRANT[\s\S]*?;` starts there
  and swallows the real statement after it. That produced **four false positives
  on grants sitting in plain sight** in `sql/060`, `sql/074` and `sql/091` — the
  `js/bad-tag-filter` mistake in a different costume, in the very file whose doc
  comment warns about it.

A third grant is in the same migration and is NOT of the same kind:
`awcms_domain_event_replays` has no lifecycle descriptor and is never purged — it
is READ by `domain-events:deliveries:purge` as an `EXISTS` guard so a delivery a
replay still points at is not deleted. It surfaced the same way
(`permission denied`) and the new gate does **not** cover it, because deriving
which tables a `delegated` job reads on the way would mean statically analysing
every job's SQL. That gap is recorded rather than papered over: what found it was
running all 23 schedulable jobs with `--dry-run` against production.

All three grants are applied and verified on production — `archive-purge` and
`deliveries:purge` both now complete with `status: success`.
