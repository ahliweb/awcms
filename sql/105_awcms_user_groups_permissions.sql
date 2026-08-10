-- Permission catalog seed for the user-group surface (Gelombang 3 PR 3.5 of
-- Issue #423, ADR-0081), wiring up the `user_groups` entries declared in
-- `identity-access/module.ts`.
--
-- ## Four, and why not five
--
-- `read`, `create`, `update`, `assign`. There is deliberately no `delete`.
--
-- Deleting a group is not one decision, it is three — what happens to the grants
-- it holds, what happens to its membership, and what happens to an `external_id`
-- a directory will present again tomorrow. Shipping a `delete` before those are
-- answered would either strand grants (a role nobody holds any more, according
-- to a row that still says otherwise) or destroy the only record of who held
-- what. A group can be renamed and emptied today; retiring one gets its own
-- change, with the lifecycle written down.
--
-- ## Why `assign` for membership, and `access_control.assign` for the role
--
-- Two different authorities, and folding them together would be the mistake.
--
-- `user_groups.assign` puts a person IN a group. `access_control.assign` — which
-- already exists and already means "hand out a role" — is what grants the group
-- its role, through the same endpoint that grants a person one. So "who may
-- decide what a group can DO" stays exactly where it already was, and the new
-- permission only decides who may be affected by it.
--
-- Getting this backwards would be a privilege-escalation path with no obvious
-- name: a group administrator who could also grant roles to their own group
-- could grant `owner` to a group they belong to.
--
-- All four action literals already exist in the `AccessAction` union, so nothing
-- new is invented here. An unseeded action denies even the owner — the
-- latent-authz trap ADR-0058 §E describes.
--
-- ## Reach, stated plainly
--
-- Same as every prior permission-seed migration: this extends the GLOBAL catalog
-- only. An existing tenant's `owner` role does NOT retroactively gain these —
-- only tenants created after this migration runs get them from the bootstrap.
-- Live tenants are covered by `bun run identity-access:permissions:backfill`,
-- which grants exactly the catalog rows NEWER than the role. That is a
-- deployment step, not a migration side effect.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'user_groups', 'read', 'List user groups and their members'),
  ('identity_access', 'user_groups', 'create', 'Create a local user group'),
  ('identity_access', 'user_groups', 'update', 'Rename a local user group or change its description'),
  ('identity_access', 'user_groups', 'assign', 'Add or remove a tenant user from a group — audited')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
