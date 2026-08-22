-- 144_awcms_credential_epoch.sql
--
-- Finding A5 of the 17 August 2026 audit round — a password reset changes the
-- credential in EVERY tenant but revokes sessions in only ONE.
--
-- `setPrincipalCredentialForIdentity` is global by design (ADR-0086): one human,
-- one credential. `revokeAllSessionsForIdentity` carries `WHERE tenant_id = …`,
-- because `awcms_sessions` is FORCE RLS and a transaction scoped to tenant A
-- cannot see, let alone update, tenant B's rows. So a person whose tenant-B
-- cookie was stolen, recovering from tenant A, changed the password everywhere
-- and revoked nothing in B. The stolen session kept working with a password its
-- holder no longer knows — which is the exact opposite of what a reset is for.
--
-- ## Why an epoch rather than a cross-tenant revoke
--
-- The obvious fix is to widen the revocation. It cannot be widened from inside
-- the request: the tenant GUC is set for one tenant per transaction, and FORCE
-- RLS means the UPDATE would silently match zero rows in every other tenant —
-- the same shape as the bug, with more code. Escaping RLS would mean a
-- SECURITY DEFINER function that may revoke any session in any tenant, reachable
-- from a request path. That is a much larger blast radius than the problem.
--
-- An epoch inverts it: the credential change writes ONE row it already owns
-- (`awcms_principals` is global and RLS-free, ADR-0087), and every session
-- carries the epoch it was minted under. A session whose epoch is behind its
-- principal's is dead everywhere, at once, without any writer ever reaching
-- across a tenant boundary. The check is a read the auth path already pays for.
--
-- ## Nullability is load-bearing on BOTH columns, in opposite directions
--
-- `awcms_principals.credential_epoch` is NOT NULL DEFAULT 0: every principal has
-- an epoch from this migration onward, so the comparison always has a right-hand
-- side.
--
-- `awcms_sessions.credential_epoch` is NULLABLE, and readers coalesce it to 0.
-- Sessions minted before this migration have no stamp, and NULL read as 0 means
-- they are already behind the moment their principal's epoch is bumped — so the
-- very first reset after deployment kills them, which is the behaviour the
-- finding asks for. A `NOT NULL DEFAULT 0` here would have been equivalent for
-- new rows and identical for old ones, but it would rewrite every live session
-- row on a table the login path writes to constantly; the nullable column is
-- free.
--
-- An identity with no `principal_id` (the link is nullable by design, sql/112)
-- has no epoch to be behind, so its sessions are unaffected. That is not a
-- bypass being granted: such an identity's credential also cannot be changed
-- globally, because `setPrincipalCredentialForIdentity` has nothing to write to.
-- The tenant-scoped revocation remains its whole guarantee, exactly as today.

ALTER TABLE awcms_principals
  ADD COLUMN IF NOT EXISTS credential_epoch integer NOT NULL DEFAULT 0;

ALTER TABLE awcms_principals
  ADD CONSTRAINT awcms_principals_credential_epoch_check
  CHECK (credential_epoch >= 0);

ALTER TABLE awcms_sessions
  ADD COLUMN IF NOT EXISTS credential_epoch integer;

ALTER TABLE awcms_sessions
  ADD CONSTRAINT awcms_sessions_credential_epoch_check
  CHECK (credential_epoch IS NULL OR credential_epoch >= 0);

-- No new GRANT. Both tables already carry table-level `SELECT`/`UPDATE` for
-- `awcms_app` (sql/112, sql/022), and a table-level grant covers columns added
-- later — which is only true because neither grant was written column-level.
-- `awcms_worker` deliberately has neither table: nothing in a background job
-- mints or validates a session.
