-- social_publishing -- retention of publication evidence (Issue #1145, an
-- admission condition of ADR-0157 before the first connector #1146).
-- Forward-only; `sql/330` is applied and is NOT edited.
--
-- ## What this replaces
--
-- `sql/330` shipped the publication, job and attempt tables with NO retention
-- (three `BOUNDED_BY_DESIGN` entries in
-- `scripts/data-lifecycle-table-coverage-check.ts`, "not bounded in time"). They
-- now get real `data_lifecycle` descriptors in
-- `src/modules/social-publishing/module.ts`, executed by the delegated adopter
-- `bun run social-publishing:retention:purge`
-- (`application/social-publishing-retention-purge.ts`).
--
-- ## The unit of deletion is a whole publication
--
-- A publication, its jobs and their attempts are one piece of evidence: what the
-- tenant published under its name, to which account, and what happened. The purge
-- removes a publication only when EVERY job of it is terminal
-- (`published`, `failed`, `cancelled`) and the publication and all its jobs are
-- older than the retention window; it deletes attempts, then jobs, then the
-- publication, in one transaction. It never touches a waiting job
-- (`queued`, `retry_wait`, `publishing`), a `needs_reconciliation` job (an
-- operator must decide whether the post exists) or a `pending_approval`
-- publication, however old.
--
-- Defaults (a decision the OWNER may change, recorded in
-- `docs/awcms/social-publishing.md`): keep 730 days, bounded 365..3650.
--
-- ## Why the worker gets DELETE, and why that is bounded here
--
-- The purge runs as `awcms_worker`, the role every scheduled job shares
-- (including `whatsapp:dispatch`). `sql/330` gave that role no DELETE on these
-- tables, deliberately: they are evidence. Granting DELETE alone would let a
-- compromised job erase every tenant's publication history. So the grant comes
-- with RESTRICTIVE row policies that are the database's own floor, independent
-- of the application's window:
--
--   * a job is deletable only when it is terminal and untouched for 365 days;
--   * an attempt only when its job is;
--   * a publication only when it is `ready`, `cancelled` or `refused`, untouched
--     for 365 days, and has NO job left (so its jobs went first, through the
--     policy above).
--
-- 365 days is the descriptor's `retentionMinDays`: lowering the minimum needs a
-- migration, on purpose. `awcms_app` still has no DELETE on any of the three.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

GRANT DELETE ON awcms_social_publications TO awcms_worker;
GRANT DELETE ON awcms_social_publish_jobs TO awcms_worker;
GRANT DELETE ON awcms_social_publish_attempts TO awcms_worker;

DROP POLICY IF EXISTS awcms_social_publish_attempts_worker_retention_floor
  ON awcms_social_publish_attempts;

CREATE POLICY awcms_social_publish_attempts_worker_retention_floor
  ON awcms_social_publish_attempts
  AS RESTRICTIVE
  FOR DELETE
  TO awcms_worker
  USING (
    created_at < now() - interval '365 days'
    AND EXISTS (
      SELECT 1
      FROM awcms_social_publish_jobs j
      WHERE j.tenant_id = awcms_social_publish_attempts.tenant_id
        AND j.id = awcms_social_publish_attempts.job_id
        AND j.status IN ('published', 'failed', 'cancelled')
        AND j.updated_at < now() - interval '365 days'
    )
  );

DROP POLICY IF EXISTS awcms_social_publish_jobs_worker_retention_floor
  ON awcms_social_publish_jobs;

CREATE POLICY awcms_social_publish_jobs_worker_retention_floor
  ON awcms_social_publish_jobs
  AS RESTRICTIVE
  FOR DELETE
  TO awcms_worker
  USING (
    status IN ('published', 'failed', 'cancelled')
    AND updated_at < now() - interval '365 days'
  );

DROP POLICY IF EXISTS awcms_social_publications_worker_retention_floor
  ON awcms_social_publications;

CREATE POLICY awcms_social_publications_worker_retention_floor
  ON awcms_social_publications
  AS RESTRICTIVE
  FOR DELETE
  TO awcms_worker
  USING (
    state IN ('ready', 'cancelled', 'refused')
    AND updated_at < now() - interval '365 days'
    AND NOT EXISTS (
      SELECT 1
      FROM awcms_social_publish_jobs j
      WHERE j.tenant_id = awcms_social_publications.tenant_id
        AND j.publication_id = awcms_social_publications.id
    )
  );

-- The purge's own path: (tenant, updated_at) over the states it may remove.
CREATE INDEX IF NOT EXISTS awcms_social_publications_retention_idx
  ON awcms_social_publications (tenant_id, updated_at)
  WHERE state IN ('ready', 'cancelled', 'refused');
