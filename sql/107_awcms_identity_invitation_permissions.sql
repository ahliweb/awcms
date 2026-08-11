-- Permission catalog seed for the invitation surface (Gelombang 4 PR 4.1 of
-- Issue #423, ADR-0082), wiring up the `invitations` entries declared in
-- `identity-access/module.ts`.
--
-- ## Four, and why not six
--
-- `read`, `create`, `revoke` at tenant scope, plus `configure` at PLATFORM
-- scope. There is deliberately no `update` and no `delete`.
--
-- An invitation is not editable. Changing the roles it carries after it was
-- sent means the link already sitting in someone's inbox no longer matches what
-- was reviewed. Revoke-and-reinvite is the operation, and it leaves two audit
-- rows where an edit would leave none.
--
-- Deleting one destroys the only record that an offer was ever made, which is
-- the first question an investigation asks. `revoke` already answers "this link
-- is dead now" while keeping the row that answers "who offered what, to whom,
-- and what happened".
--
-- Resend is guarded by `create`, not by an action of its own. It MINTS A NEW
-- TOKEN, which is exactly the authority `create` already names — and `resend` is
-- not a member of the `AccessAction` union, so inventing it would also be
-- asserting that re-sending is a different authority from issuing. It is not: a
-- separate `resend` permission would let an operator hand fresh credentials to
-- everyone previously invited while holding no authority to invite anyone.
--
-- ## Inviting and GRANTING A ROLE stay two authorities
--
-- None of these four is what decides which roles an invitation carries.
-- `access_control.assign` — which already exists and already means "hand out a
-- role" — governs that, and an invitation naming roles demands BOTH it and
-- `invitations.create`.
--
-- This is ADR-0081's split repeated, and the repetition is deliberate because
-- invitations raise the stakes on one axis: a grant to a group reaches whoever
-- joins later, while a grant through an invitation reaches someone who does not
-- exist yet — no row to review, no name to recognise, and the recipient chooses
-- when it becomes live.
--
-- ## Why `configure` is PLATFORM-scoped
--
-- It is the gate on `skip_email_confirmation`, which removes the only proof
-- that the person at the far end controls that mailbox. Held at tenant scope,
-- any tenant admin could manufacture an unverified account for
-- `ceo@another-company.com`; after Gelombang 7 that object is a GLOBAL
-- principal, which is the one place it matters (the ADR-0053/ADR-0054
-- reasoning, applied here).
--
-- Because it is `scope = 'platform'`, `createTenantWithOwner` — which filters
-- `WHERE scope = 'tenant'` — never grants it to a provisioned tenant.
--
-- All four action literals already exist in the `AccessAction` union, so
-- nothing new is invented here. An unseeded action denies even the owner: the
-- latent-authz trap ADR-0058 §E describes.
--
-- ## Reach, stated plainly
--
-- Same as every prior permission-seed migration: this extends the GLOBAL
-- catalog only. An existing tenant's `owner` role does NOT retroactively gain
-- these — only tenants created after this migration runs get them from the
-- bootstrap. Live tenants are covered by
-- `bun run identity-access:permissions:backfill`, which grants exactly the
-- catalog rows NEWER than the role. That is a deployment step, not a migration
-- side effect.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'invitations', 'read',
   'List this tenant''s invitations and their status'),
  ('identity_access', 'invitations', 'create',
   'Invite a person to this tenant, and resend an invitation — which rotates its token — audited'),
  ('identity_access', 'invitations', 'revoke',
   'Revoke a pending invitation, killing its link immediately — audited')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

-- Platform-scoped: the `sql/086` form, with DO UPDATE so a re-run corrects a
-- row that was ever seeded without a scope.
INSERT INTO awcms_permissions (module_key, activity_code, action, description, scope)
VALUES
  ('identity_access', 'invitations', 'configure',
   'PLATFORM: issue an invitation that skips email confirmation',
   'platform')
ON CONFLICT (module_key, activity_code, action) DO UPDATE
  SET scope = EXCLUDED.scope,
      description = EXCLUDED.description;

-- Granted to the `owner` role of `awcms_setup_state.tenant_id`, and only that —
-- same as `sql/085`/`sql/086`. A deployment pointing `PLATFORM_TENANT_ID` at a
-- different tenant grants it itself; `bun run security:readiness` reports the
-- mismatch rather than leaving it to be discovered through a 403.
--
-- `awcms_role_permissions` is `FORCE ROW LEVEL SECURITY` (sql/005 + sql/017),
-- and this statement carries no `NO FORCE` toggle because it does not need one:
-- it is single-tenant by construction — every row it writes takes its
-- `tenant_id` from `awcms_setup_state` — and it runs as the migration owner,
-- exactly as `sql/085` and `sql/086` do. `sql/103` toggles because its backfill
-- is deliberately CROSS-tenant, so there is no single `app.current_tenant_id`
-- it could set.
--
-- Idempotent: anti-join on the grant.
INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT s.tenant_id, r.id, p.id
FROM awcms_setup_state s
JOIN awcms_roles r
  ON r.tenant_id = s.tenant_id
 AND r.role_code = 'owner'
 AND r.deleted_at IS NULL
JOIN awcms_permissions p
  ON p.module_key = 'identity_access'
 AND p.activity_code = 'invitations'
 AND p.action = 'configure'
WHERE s.id = true
  AND s.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM awcms_role_permissions existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
