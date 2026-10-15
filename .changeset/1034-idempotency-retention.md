---
"awcms": minor
---

feat(data-lifecycle): retention and subject-data classification for `awcms_idempotency_keys` (#1034, follow-up to #1000, ADR-0145 amendment 1).

- New lifecycle descriptor `domain_event_runtime.idempotency_keys`: rows are hard-deleted by `created_at` after **30 days** by default (tenant-configurable 7 to 90), by the existing daily `bun run data-lifecycle:archive-purge`. No new job.
- Migration 276 grants `awcms_worker` `SELECT, DELETE` on the table (the two verbs the generic purge issues); `scripts/security-readiness.ts` lists the same pair.
- The table now answers the subject question with a `subjectData` descriptor (`unreachableBySubject`, never exported, retention-bounded) instead of the `NO_SUBJECT_DATA` refusal that claimed no personal data. `actor_key` and `response_body` are not exported.
- The `#1034` text in `scripts/subject-data-coverage-check.ts` is removed; the stale "no retention" comment in `sql/256` stays (applied migrations are immutable) and is superseded by `sql/276` and the ADR.

**Upgrade note.** Run `bun run db:migrate` (migration 276) before the next `data-lifecycle:archive-purge` run, otherwise the purge fails with `permission denied for table awcms_idempotency_keys`. The first run deletes the accumulated backlog in bounded batches; preview it with `bun run data-lifecycle:archive-purge --dry-run`.
