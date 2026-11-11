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
-- ## The unit of deletion is a whole publication -- in the APPLICATION
--
-- A publication, its jobs and their attempts are one piece of evidence. The
-- purge removes a publication only when EVERY job of it is terminal and older
-- than the window, and deletes attempts, then jobs, then the publication, in one
-- transaction. It never touches a waiting job, a `needs_reconciliation` job or a
-- `pending_approval` publication, and it skips a tenant whose legal hold covers
-- any of the three descriptors.
--
-- What the DATABASE adds below is a PER-ROW floor, not that unit and not the
-- legal hold: a compromised `awcms_worker` cannot delete any row younger than
-- 365 days or not terminal, but it could still delete ONE old terminal job of a
-- publication whose other jobs are young (the application never does), and the
-- legal hold is enforced by the purge, not by these policies (a hold is a
-- `data_lifecycle` row the floor does not read, as for every other module).
--
-- ## The floor rests on a stamp NO role can write (`terminal_at`)
--
-- `updated_at` is writable by `awcms_app` (publications, jobs) and
-- `awcms_worker` (jobs): a floor on it can be defeated by moving it back and then
-- deleting a fresh row. `terminal_at` is set ONLY by the triggers below, from the
-- database clock, whatever a statement asks for:
--
--   * a job: `now()` when it ENTERS `published`, `failed` or `cancelled`; NULL
--     while it is not terminal (an operator's retry back to `queued` clears it,
--     so the next terminal state is a fresh stamp); kept unchanged while it stays
--     terminal. INSERT always writes NULL (a job is created `queued`).
--   * a publication: `now()` when it enters `ready`, `cancelled` or `refused`
--     (at INSERT or by a state change); otherwise kept. `pending_approval` is
--     NULL.
--
-- An attempt row is never updated by any role (no UPDATE grant), so its
-- `created_at` is fixed; its floor also requires its job's `terminal_at`.
--
-- Rows that existed before this migration have `terminal_at` NULL and are never
-- deletable by the floor (fail closed). No adapter was ever registered, so no
-- deployment holds a published job from before it.
--
-- Defaults (a decision the OWNER may change, recorded in
-- `docs/awcms/social-publishing.md`): keep 730 days, bounded 365..3650. 365 days
-- is the descriptor's `retentionMinDays`: lowering it needs a migration.
-- `awcms_app` still has no DELETE on any of the three tables.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

ALTER TABLE awcms_social_publish_jobs
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz;

ALTER TABLE awcms_social_publications
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz;

CREATE OR REPLACE FUNCTION awcms_social_publish_jobs_terminal_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.terminal_at := NULL;
  ELSIF NEW.status NOT IN ('published', 'failed', 'cancelled') THEN
    NEW.terminal_at := NULL;
  ELSIF OLD.status IN ('published', 'failed', 'cancelled') THEN
    NEW.terminal_at := OLD.terminal_at;
  ELSE
    NEW.terminal_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_social_publish_jobs_terminal_stamp
  ON awcms_social_publish_jobs;

CREATE TRIGGER awcms_social_publish_jobs_terminal_stamp
  BEFORE INSERT OR UPDATE ON awcms_social_publish_jobs
  FOR EACH ROW
  EXECUTE FUNCTION awcms_social_publish_jobs_terminal_stamp();

CREATE OR REPLACE FUNCTION awcms_social_publications_terminal_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.terminal_at := CASE
      WHEN NEW.state IN ('ready', 'cancelled', 'refused') THEN now()
      ELSE NULL
    END;
  ELSIF NEW.state IS DISTINCT FROM OLD.state
        AND NEW.state IN ('ready', 'cancelled', 'refused') THEN
    NEW.terminal_at := now();
  ELSE
    NEW.terminal_at := OLD.terminal_at;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_social_publications_terminal_stamp
  ON awcms_social_publications;

CREATE TRIGGER awcms_social_publications_terminal_stamp
  BEFORE INSERT OR UPDATE ON awcms_social_publications
  FOR EACH ROW
  EXECUTE FUNCTION awcms_social_publications_terminal_stamp();

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
        AND j.terminal_at < now() - interval '365 days'
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
    AND terminal_at < now() - interval '365 days'
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
    AND terminal_at < now() - interval '365 days'
    AND NOT EXISTS (
      SELECT 1
      FROM awcms_social_publish_jobs j
      WHERE j.tenant_id = awcms_social_publications.tenant_id
        AND j.publication_id = awcms_social_publications.id
    )
  );

-- The purge's own paths: (tenant, terminal_at) over what it may remove.
CREATE INDEX IF NOT EXISTS awcms_social_publications_retention_idx
  ON awcms_social_publications (tenant_id, terminal_at)
  WHERE state IN ('ready', 'cancelled', 'refused');

CREATE INDEX IF NOT EXISTS awcms_social_publish_jobs_retention_idx
  ON awcms_social_publish_jobs (tenant_id, terminal_at)
  WHERE status IN ('published', 'failed', 'cancelled');
