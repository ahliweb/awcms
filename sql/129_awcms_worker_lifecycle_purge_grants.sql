-- The retention engine could not touch two of the tables it is responsible for.
--
-- Found by RUNNING the job against production, not by reading a grant list:
--
--   bun run data-lifecycle:archive-purge --dry-run
--   → PostgresError: permission denied for table awcms_delegated_access_grants
--
-- `data-lifecycle:archive-purge` runs as `awcms_worker` (`WORKER_DATABASE_URL`,
-- verified on the running container). Its generic executor issues, per
-- descriptor:
--
--   SELECT * FROM <table> WHERE tenant_id = $1 AND <cursor> < $2 …   -- candidates
--   DELETE FROM <table> WHERE id IN (SELECT id FROM <table> …)       -- hard_delete
--
-- so every table with a `dataLifecycle` descriptor needs SELECT + DELETE for
-- that role. Two never got them:
--
--   awcms_delegated_access_grants  (sql/117, identity_access)
--   awcms_subject_requests         (sql/125, data_lifecycle)
--
-- ## Why this was invisible
--
-- `data-lifecycle:registry:check` and `data-lifecycle:table-coverage:check` both
-- pass, and they are right to: the descriptors exist, they are well-formed, and
-- every lifecycle-bearing table has one. What no gate compared was the descriptor
-- against the PRIVILEGE the engine needs to honour it. The registry said "this
-- table is purged on a 365-day retention"; the database said "no". Both
-- statements were checked; the pair never was.
--
-- This is the same shape as `sql/127` (a grant list that read correctly and was
-- wrong for the statement actually issued) and the same shape as the setup-wizard
-- break, where a privilege gate verified its own matrix rather than what the code
-- needed. The gate added alongside this migration
-- (`data-lifecycle:worker-grants:check`) closes the class rather than these two
-- rows: it derives the required grants from the descriptor registry and fails on
-- any lifecycle table the worker cannot read and delete.
--
-- ## Why the failure mattered more than a missing schedule
--
-- Neither job was scheduled either (`crontab -l` carried one of 32), so this
-- never surfaced as an error anybody saw. But the two are different defects with
-- the same silence: unscheduled means "it would work if run", and this means "it
-- would NOT". Scheduling the job without this migration would have converted
-- silent non-enforcement into a nightly failing job — visibly broken, which is
-- better, but still not retention. ADR-0094's retention guarantees rest on this
-- job completing, and for these two tables it could not.
--
-- Both are `deletion.mode = hard_delete`, so no UPDATE is granted: the engine
-- never anonymises these, and a privilege the code does not use is a privilege
-- that outlives the reason it was added.

GRANT SELECT, DELETE ON awcms_delegated_access_grants TO awcms_worker;
GRANT SELECT, DELETE ON awcms_subject_requests TO awcms_worker;

-- A THIRD table, found the same way and NOT of the same kind.
--
--   bun run domain-events:deliveries:purge --dry-run
--   → permission denied for table awcms_domain_event_replays
--
-- `awcms_domain_event_replays` has no `dataLifecycle` descriptor and is not
-- purged by anything. It is READ by the delivery-retention purge as an EXISTS
-- guard —
--
--   … AND NOT EXISTS (SELECT 1 FROM awcms_domain_event_replays r WHERE …)
--
-- so a delivery that a replay row still points at is not deleted. SELECT only:
-- the job never writes here, and the row it protects is written by
-- `delivery-replay.ts` on the request path as `awcms_app`.
--
-- It is worth naming why the new gate does NOT catch this one. That gate derives
-- its requirement from the lifecycle registry, so it covers the 12 tables the
-- GENERIC engine executes against. This table is touched by a `delegated`
-- job — one that owns its own SQL — and the registry says nothing about the
-- tables such a job reads on the way. Deriving that would mean statically
-- analysing every job's queries, which is a real gap and is recorded as one
-- rather than papered over: the thing that found it was RUNNING all 23 jobs
-- with `--dry-run` against production, and that remains the check for the
-- delegated half.
GRANT SELECT ON awcms_domain_event_replays TO awcms_worker;

COMMENT ON TABLE awcms_delegated_access_grants IS
  'Partner support-access grants. Purged by data-lifecycle:archive-purge (hard_delete, audit_security class) — awcms_worker holds SELECT+DELETE for that engine (sql/129); the evidentiary copy lives in awcms_audit_events with its own retention.';

COMMENT ON TABLE awcms_subject_requests IS
  'Data-subject request ledger (ADR-0094). Archived to JSONL then purged by data-lifecycle:archive-purge (hard_delete, audit_security class) — awcms_worker holds SELECT+DELETE for that engine (sql/129).';
