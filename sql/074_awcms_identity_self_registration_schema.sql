-- Self-registration, admin-approval gated (Wave 2 delta auth, adapted from
-- awcms-micro). A public visitor submits a request via
-- `POST /api/v1/auth/register`; it lands here as `status='pending'` and is NOT
-- a login-eligible account. Only approval materializes the real
-- profile/identity/tenant_user rows (sql/003, sql/004), which is exactly what
-- `evaluateLoginAttempt` needs before anyone can sign in.
--
-- ## Why a separate table and not a pending identity
--
-- Unapproved requests never enter `awcms_identities`, so public spam cannot
-- collide with the `(tenant_id, login_identifier)` uniqueness of real accounts,
-- cannot pollute the identity table, and can be rejected or aged out without
-- touching auth state.
--
-- ## Why there is NO password column here
--
-- awcms-micro's version stores an argon2id hash submitted by an anonymous,
-- unverified caller, for an account that may never exist. This one does not:
-- approval creates the identity with an UNUSABLE random password and issues a
-- password-reset link (sql/073) instead. The applicant proves control of the
-- mailbox before they can sign in, and a rejected or abandoned request leaves
-- no credential behind at all. It also removes the "spam flood stores hashes"
-- amplification: each submission costs an INSERT, never an argon2id hash.
--
-- FORCE RLS inline, per the convention every table since sql/013 follows.
CREATE TABLE IF NOT EXISTS awcms_registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  login_identifier text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_tenant_user_id uuid REFERENCES awcms_tenant_users (id),
  created_identity_id uuid REFERENCES awcms_identities (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_registration_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- Admin queue path: WHERE tenant_id = ? AND status = 'pending'
-- ORDER BY requested_at.
CREATE INDEX IF NOT EXISTS awcms_registration_requests_pending_idx
  ON awcms_registration_requests (tenant_id, status, requested_at);

-- At most ONE outstanding request per identifier per tenant. A second submit
-- while one is still pending hits this constraint; the endpoint absorbs it and
-- returns the same generic success, so a caller cannot tell a duplicate from a
-- fresh request. `approved`/`rejected` rows are excluded from the predicate so
-- a rejected applicant can apply again later.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_registration_requests_pending_key
  ON awcms_registration_requests (tenant_id, login_identifier)
  WHERE status = 'pending';

-- Purge cursor path for the data_lifecycle GENERIC engine, which ages out
-- REVIEWED rows (see the `identity_access.registration_requests` descriptor).
CREATE INDEX IF NOT EXISTS awcms_registration_requests_tenant_created_idx
  ON awcms_registration_requests (tenant_id, created_at);

ALTER TABLE awcms_registration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_registration_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_registration_requests_tenant_isolation
  ON awcms_registration_requests
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Least-privilege `awcms_worker` grant
-- ---------------------------------------------------------------------------
-- The worker runs the data_lifecycle GENERIC purge over this table and nothing
-- else: SELECT for the bounded cursor scan, DELETE to age out reviewed rows.
-- No INSERT (submitting is a public-path write on awcms_app) and no UPDATE
-- (approving/rejecting is an admin action) — a worker able to write here could
-- manufacture an approved registration. RLS FORCE applies to it as well.
GRANT SELECT, DELETE ON awcms_registration_requests TO awcms_worker;
