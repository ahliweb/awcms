-- awcms_worker must not be able to read a credential column (Issue #1078).
--
-- Found by the security review of #1044: `information_schema.column_privileges`
-- showed `awcms_worker` holding SELECT on `awcms_identities.password_hash`. The
-- cause is `sql/022` (`GRANT SELECT ON awcms_identities TO awcms_worker`), a
-- TABLE-level grant that was right for what it was written for (the reporting
-- projection source scan) and wrong for what it reached: every column added
-- since, `password_hash` included, was readable by the worker for free.
--
-- ## Why it matters
--
-- RLS trusts `app.current_tenant_id`, a session setting the caller chooses. Whoever
-- can run SQL as the worker (a compromised job script, or SQL injection in a worker
-- query) can set that GUC to any tenant and read that tenant's password hashes.
-- No worker job needs a credential hash; the grant is pure exposure.
--
-- ## The audit (what every worker job actually reads)
--
-- Every credential column granted to `awcms_worker` was traced to the job that
-- issues the statement. The result is one of three shapes:
--
-- 1. READ NEEDED, columns named below (identities).
-- 2. ONLY THE GENERIC RETENTION PURGE touches the table
--    (`data-lifecycle:archive-purge`, `archive-purge-job.ts`). For a
--    `hard_delete` descriptor it issues `SELECT id … WHERE tenant_id = $1 AND
--    created_at < $2` inside a `DELETE`, and a `count(*)` dry-run with the same
--    predicate. `SELECT *` exists only on the ARCHIVE path and none of these
--    tables is archivable. So `id, tenant_id, created_at` is all it can need.
-- 3. A JOB READS THE ROW BUT NEVER THE CREDENTIAL (tenant_domains, telegram):
--    column list is "every column except the credential".
--
-- ## awcms_identities  (table SELECT revoked, column SELECT re-granted)
--
--   id, tenant_id, profile_id, status, login_identifier
--       workflow:escalations:dispatch (and the HR attendance settlement notice,
--       sql/302): `announcement-directory.ts` resolves a tenant user to a
--       recipient with `awcms_tenant_users JOIN awcms_identities i ON
--       i.id = tu.identity_id … JOIN awcms_profiles p ON p.id = i.profile_id
--       WHERE i.status = 'active'` and reads `i.login_identifier` (the address).
--   tenant_id, created_at
--       reporting:projections:refresh: the `identities` cursor stream of the
--       module-activity projection (`reporting/module.ts`) selects the cursor
--       column and the tenant column, nothing else.
--
--   NOT granted, because no worker job reads them: password_hash,
--   failed_login_count, locked_until, last_login_at, updated_at, principal_id.
--   (last_login_at is read by `tenant-activity-report.ts`, which is served only
--   by `GET /api/v1/reports/tenant-activity` as `awcms_app`.)
--
-- ## Generic hard_delete purge only  (SELECT narrowed to the columns it reads)
--
--   awcms_password_reset_tokens            (id, tenant_id, created_at)   not token_hash
--   awcms_invitations                      (id, tenant_id, created_at)   not token_hash
--   awcms_delegated_access_grants          (id, tenant_id, created_at)   not access_code_hash
--   awcms_omes_enrollments                 (id, tenant_id, created_at)   not enrollment_challenge_hash
--   awcms_newsletter_subscribers           (id, tenant_id, created_at)   not the two token hashes
--   awcms_comments_reply_subscriptions     (id, tenant_id, created_at, confirmed)
--       not unsubscribe_token_hash. `confirmed` is the one extra: the
--       `comments:retention` job (comment-retention.ts) deletes and counts
--       `WHERE confirmed = false AND created_at < $cutoff`.
--   Job for each: data-lifecycle:archive-purge. DELETE is unchanged.
--
-- ## Job reads the row, never the credential  (SELECT = every column but one)
--
--   awcms_tenant_domains          all except verification_token_hash
--       tenant-domain:dns:sync reads (id, tenant_id, normalized_hostname,
--       domain_type, status, deleted_at); the host-resolution readers read the
--       rest. None reads the verification token hash.
--   awcms_telegram_link_codes     all except code_hash
--       telegram:dispatch / telegram:queue:purge end and delete codes; nothing
--       compares a code (that is the webhook, as awcms_app).
--   awcms_telegram_bindings       all except pin_hash
--       telegram:dispatch / telegram:queue:purge end bindings. They only ever
--       NULL `pin_hash` (UPDATE (pin_hash), sql/288, unchanged) and never read
--       it; verifying a PIN is the confirm route, as awcms_app.
--
-- ## Deliberately left readable (documented exceptions, see security-readiness)
--
--   awcms_push_subscriptions.auth_secret  push:dispatch needs the subscription's
--       Web Push auth secret to encrypt the payload; it is key material the job
--       cannot work without, not a login credential.
--   awcms_omes_repository_progress_config.secret_ref  a REFERENCE (the name of a
--       secret held elsewhere), read by omes:repository-progress:poll to resolve
--       it. The secret itself is never in the database.
--   awcms_telegram_bindings.chat_ciphertext  the dispatcher decrypts the chat id
--       to deliver; it is ciphertext under a key ring the worker already holds.
--
-- Other credential-bearing tables (awcms_sessions, awcms_principals,
-- awcms_*_mfa_*, awcms_machine_credentials, awcms_auth_providers,
-- awcms_bff_clients, awcms_session_handoff_codes, awcms_mfa_challenges,
-- awcms_theming_preview_sessions) hold NO privilege for awcms_worker today and
-- must keep it that way: `security:readiness` now fails if one ever does.
--
-- ## Not touched
--
-- The NOLOGIN, memberless SECURITY DEFINER owner roles (awcms_delegated_expiry,
-- awcms_domain_bootstrap, awcms_telegram_bootstrap, …) hold credential-column
-- SELECT by design (sql/142, sql/217 …): they are function owners reachable only
-- through a narrow EXECUTE, not roles a job connects as.
--
-- Pure DDL, no rows written. Revoking a column privilege the role only holds via
-- a table grant is impossible, so each table is REVOKEd whole and re-GRANTed by
-- column. Matching changes in `WORKER_ROLE_GRANTS`/`WORKER_COLUMN_GRANTS`
-- (`scripts/security-readiness.ts`) land with this file.

-- NOTE: a REVOKE only removes a privilege granted BY THE SAME GRANTOR. Issued by
-- a different role than the one that granted it, REVOKE is a silent no-op (no
-- error, no warning) and the worker keeps reading. The `security:readiness`
-- check "Worker roles cannot read credential columns" (critical) asks
-- `has_column_privilege` afterwards and fails the deploy if that happened.

-- ===== awcms_identities =====
REVOKE SELECT ON awcms_identities FROM awcms_worker;
GRANT SELECT (id, tenant_id, profile_id, status, login_identifier, created_at)
  ON awcms_identities TO awcms_worker;

-- ===== generic hard_delete purge only =====
REVOKE SELECT ON awcms_password_reset_tokens FROM awcms_worker;
GRANT SELECT (id, tenant_id, created_at)
  ON awcms_password_reset_tokens TO awcms_worker;

REVOKE SELECT ON awcms_invitations FROM awcms_worker;
GRANT SELECT (id, tenant_id, created_at)
  ON awcms_invitations TO awcms_worker;

REVOKE SELECT ON awcms_delegated_access_grants FROM awcms_worker;
GRANT SELECT (id, tenant_id, created_at)
  ON awcms_delegated_access_grants TO awcms_worker;

REVOKE SELECT ON awcms_omes_enrollments FROM awcms_worker;
GRANT SELECT (id, tenant_id, created_at)
  ON awcms_omes_enrollments TO awcms_worker;

REVOKE SELECT ON awcms_newsletter_subscribers FROM awcms_worker;
GRANT SELECT (id, tenant_id, created_at)
  ON awcms_newsletter_subscribers TO awcms_worker;

REVOKE SELECT ON awcms_comments_reply_subscriptions FROM awcms_worker;
GRANT SELECT (id, tenant_id, created_at, confirmed)
  ON awcms_comments_reply_subscriptions TO awcms_worker;

-- ===== job reads the row, never the credential =====
REVOKE SELECT ON awcms_tenant_domains FROM awcms_worker;
GRANT SELECT (
  id, tenant_id, hostname, normalized_hostname, domain_type, route_mode, status,
  is_primary, redirect_to_primary, verification_method, verification_record_name,
  verification_record_value, verified_at, last_checked_at, created_at, updated_at,
  created_by, updated_by, deleted_at, deleted_by, delete_reason
) ON awcms_tenant_domains TO awcms_worker;

REVOKE SELECT ON awcms_telegram_link_codes FROM awcms_worker;
GRANT SELECT (
  id, tenant_id, principal_id, expires_at, consumed_at, invalidated_at, created_at
) ON awcms_telegram_link_codes TO awcms_worker;

REVOKE SELECT ON awcms_telegram_bindings FROM awcms_worker;
GRANT SELECT (
  id, tenant_id, principal_id, status, chat_ciphertext, chat_hash, hash_key_id,
  chat_masked, display_name, username_masked, pending_expires_at, confirmed_at,
  revoked_at, revoke_cause, revoked_by, created_at, updated_at, pin_attempts
) ON awcms_telegram_bindings TO awcms_worker;
