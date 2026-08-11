-- Gelombang 4 PR 4.1 (Issue #423), ADR-0082 — an invitation carries its policy.
--
-- Two tables. `awcms_invitations` is an offer of membership addressed to
-- someone who has no account here yet; `awcms_invitation_policies` is the grant
-- that offer carries, materialized only when the offer is accepted.
--
-- ## An offer is not a grant
--
-- Nothing in these tables confers anything. `activeRoleGrants` (ADR-0079) does
-- not read them and must never be taught to: a subject holding a role because a
-- row somewhere says they were invited is precisely the second grant path
-- ADR-0079 collapsed. Acceptance calls `grantRolePolicy`, the same writer every
-- other grant goes through, and the row in `awcms_access_policies` it produces
-- is the only thing any reader ever sees.
--
-- That is also why these are NOT added to `GRANT_TABLES` in
-- `scripts/access-grant-readers-check.ts`. A file naming them is not reading
-- authorization; it is reading correspondence.
--
-- ## Tenant-wide scope only, and the CHECK is the point
--
-- `awcms_invitation_policies` carries `scope_type`/`scope_id` so the shape does
-- not have to be migrated later, and pins both with a CHECK so the shape cannot
-- lie in the meantime.
--
-- ADR-0080 closed itself on an explicit limit: scope qualification is only as
-- strong as the routes that DECLARE a required scope, because
-- `fetchGrantedPermissionKeys` still returns keys from every grant — it must,
-- since the RBAC gate runs first. On a route declaring no scope, a scoped grant
-- confers that permission tenant-wide. The limit is inert while zero writers of
-- scoped grants exist, and ADR-0080 wrote that the PR adding one may not land
-- without answering it.
--
-- An invitation carrying a scope would be that writer. This migration answers
-- the limit by refusing to be it: `awcms_invitation_policies_tenant_wide_only_check`
-- makes any other value unrepresentable, so the columns exist for a later
-- widening (one DROP CONSTRAINT / ADD CONSTRAINT — the shape ADR-0078
-- §"subject_type accepts one value, on purpose" established, and ADR-0081
-- collected) while this wave ships zero non-tenant-wide grants.
--
-- The alternative considered and rejected was omitting the columns entirely, on
-- the grounds that `grantRolePolicy` hardcodes `('tenant', ${tenantId})` and so
-- a stored scope would be accepted, displayed back to the admin who typed it,
-- and then silently ignored. That is true of an UNCONSTRAINED column and the
-- CHECK removes it: with one legal value, what is stored and what is
-- materialized cannot disagree.
--
-- ## Resend rotates, it does not multiply
--
-- Resend overwrites `token_hash` in place. Without rotation, "resend" grows N
-- live links from one invitation, and revoking the invitation means revoking N
-- secrets nobody counted. The previous link dies the moment the new one is born
-- because there is only ever one hash in the row.
--
-- `resend_count <= 5` is a DATABASE constraint, not a TypeScript one. The
-- application check is the friendly error; this is the one that still holds
-- when a second writer forgets. Same reasoning as the TTL CHECK on
-- `awcms_session_handoff_codes` (sql/088).
--
-- ## Why `token_hash` is UNIQUE alone
--
-- Not `(tenant_id, token_hash)`. A collision under a per-tenant unique index
-- would let one raw token match two rows in two tenants, and the redemption
-- path would then have to pick one. Same reasoning as
-- `awcms_password_reset_tokens_hash_key` (sql/073). The token itself is never
-- stored — only `sha256:<hex>` of it, produced by `hashInviteToken`.
--
-- ## Why the child cascades
--
-- `ON DELETE CASCADE` on `awcms_invitation_policies.invitation_id` is
-- load-bearing rather than tidiness. The parent's lifecycle descriptor is
-- `executionMode: 'generic'`, and that engine deletes purely by AGE with no
-- status predicate. Without the cascade the purge aborts on this foreign key
-- and the retention silently never runs — a defect no gate can see, because the
-- descriptor validates its own shape, not its executability. The one prior use
-- of CASCADE in this repo (`sql/024`) documents itself as a backstop behind an
-- application delete; this one is the mechanism itself.
--
-- ## Membership, not identity, is what an invitation creates
--
-- `accepted_tenant_user_id` references `awcms_tenant_users`, not
-- `awcms_identities`, for two reasons. The composite-FK target already exists
-- there (`awcms_tenant_users_tenant_id_key`, sql/027) so no other table's
-- constraints change — `sql/050` records why adding one to a table you do not
-- own is its own decision. And it is the column that survives Gelombang 7: an
-- identity becomes a global principal there, while the membership row stays
-- exactly what it is.
--
-- Pure DDL — no rows are written, so the `NO FORCE -> DML -> FORCE` toggle
-- `sql/103` needed does not apply.

BEGIN;

-- 1. awcms_invitations — an offer of membership, addressed to an email.
CREATE TABLE IF NOT EXISTS awcms_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  login_identifier text NOT NULL,
  display_name text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  skip_email_confirmation boolean NOT NULL DEFAULT false,
  resend_count integer NOT NULL DEFAULT 0,
  invited_by_tenant_user_id uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_tenant_user_id uuid,
  revoked_at timestamptz,
  revoked_by_tenant_user_id uuid,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  CONSTRAINT awcms_invitations_resend_count_check
    CHECK (resend_count >= 0 AND resend_count <= 5),
  CONSTRAINT awcms_invitations_expiry_check
    CHECK (expires_at > issued_at),
  -- An accepted invitation names what it produced, and a non-accepted one names
  -- nothing. Without this pair a row could claim an acceptance with no
  -- membership behind it, which is the shape an audit question starts from.
  CONSTRAINT awcms_invitations_accepted_consistency_check
    CHECK (
      (status <> 'accepted'
        AND accepted_at IS NULL AND accepted_tenant_user_id IS NULL)
      OR
      (status = 'accepted'
        AND accepted_at IS NOT NULL AND accepted_tenant_user_id IS NOT NULL)
    ),
  CONSTRAINT awcms_invitations_revoked_consistency_check
    CHECK (
      (status <> 'revoked' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL)
    ),
  CONSTRAINT awcms_invitations_inviter_tenant_fkey
    FOREIGN KEY (tenant_id, invited_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_invitations_accepted_by_tenant_fkey
    FOREIGN KEY (tenant_id, accepted_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_invitations_revoked_by_tenant_fkey
    FOREIGN KEY (tenant_id, revoked_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Composite-FK target for awcms_invitation_policies below.
ALTER TABLE awcms_invitations
  ADD CONSTRAINT awcms_invitations_tenant_id_key UNIQUE (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_invitations_token_hash_key
  ON awcms_invitations (token_hash);

-- One live offer per address. Partial, so a revoked or expired offer can be
-- reissued — and so a duplicate submit meets `ON CONFLICT … DO NOTHING` rather
-- than raising 23505 INSIDE the transaction, which would abort it and take the
-- audit row with it. `sql/074` chose this shape for the same reason.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_invitations_pending_key
  ON awcms_invitations (tenant_id, login_identifier)
  WHERE status = 'pending';

-- The admin queue.
CREATE INDEX IF NOT EXISTS awcms_invitations_pending_idx
  ON awcms_invitations (tenant_id, status, created_at);

-- The lifecycle engine's cursor path (WHERE tenant_id = ? AND created_at < ?).
-- The queue index above cannot serve it: a leading `status` column does not
-- serve a cursor scan.
CREATE INDEX IF NOT EXISTS awcms_invitations_tenant_created_idx
  ON awcms_invitations (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS awcms_invitations_inviter_idx
  ON awcms_invitations (tenant_id, invited_by_tenant_user_id);

CREATE INDEX IF NOT EXISTS awcms_invitations_accepted_by_idx
  ON awcms_invitations (tenant_id, accepted_tenant_user_id)
  WHERE accepted_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_invitations_revoked_by_idx
  ON awcms_invitations (tenant_id, revoked_by_tenant_user_id)
  WHERE revoked_by_tenant_user_id IS NOT NULL;

ALTER TABLE awcms_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_invitations_tenant_isolation
  ON awcms_invitations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 2. awcms_invitation_policies — the grant the offer carries.
CREATE TABLE IF NOT EXISTS awcms_invitation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  invitation_id uuid NOT NULL,
  role_id uuid NOT NULL,
  scope_type text NOT NULL DEFAULT 'tenant',
  scope_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_invitation_policies_scope_type_format_check
    CHECK (scope_type ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_invitation_policies_tenant_wide_only_check
    CHECK (scope_type = 'tenant' AND scope_id = tenant_id),
  CONSTRAINT awcms_invitation_policies_invitation_tenant_fkey
    FOREIGN KEY (tenant_id, invitation_id)
    REFERENCES awcms_invitations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT awcms_invitation_policies_role_tenant_fkey
    FOREIGN KEY (tenant_id, role_id)
    REFERENCES awcms_roles (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_invitation_policies_key
  ON awcms_invitation_policies (tenant_id, invitation_id, role_id, scope_type, scope_id);

CREATE INDEX IF NOT EXISTS awcms_invitation_policies_role_idx
  ON awcms_invitation_policies (tenant_id, role_id);

ALTER TABLE awcms_invitation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_invitation_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_invitation_policies_tenant_isolation
  ON awcms_invitation_policies
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

COMMENT ON TABLE awcms_invitations IS
  'An offer of membership addressed to someone with no account here yet (Gelombang 4, ADR-0082). The row holds the token HASH, never the token; resend rotates that hash in place, which is what kills the previous link. Nothing here confers access — acceptance calls grantRolePolicy, and the row it writes to awcms_access_policies is the only thing any authorization reader sees.';

COMMENT ON COLUMN awcms_invitations.login_identifier IS
  'Stored .trim()ed and NEVER lowercased, matching awcms_identities.login_identifier and every lookup on the auth path. Foo@x.com and foo@x.com are two accounts in this schema; an accept flow that lowercased would collide-or-miss differently than every path that already exists.';

COMMENT ON COLUMN awcms_invitations.skip_email_confirmation IS
  'Requires the PLATFORM-scoped identity_access.invitations.configure, or a target that already holds an active identity in this tenant. It removes the only proof that the person at the far end controls the mailbox — and after Gelombang 7 the object it mints is a GLOBAL principal.';

COMMENT ON COLUMN awcms_invitation_policies.scope_type IS
  'Pinned to ''tenant'' by awcms_invitation_policies_tenant_wide_only_check. The column exists so widening is one DROP/ADD CONSTRAINT (ADR-0078''s shape); the CHECK exists because ADR-0080 forbids shipping a scoped-grant writer before routes declare their required scope.';

COMMIT;
