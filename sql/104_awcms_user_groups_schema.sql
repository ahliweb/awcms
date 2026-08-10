-- Gelombang 3 PR 3.5 (Issue #423), ADR-0081 — a group is a subject.
--
-- Two tables plus one widened column. `awcms_user_groups` and
-- `awcms_user_group_members` say who is in a group; `awcms_access_policies`
-- gains `user_group_id` so a group can hold a grant exactly the way a person
-- does.
--
-- ## A group grants ROLES, never permissions
--
-- This is the decision the whole migration exists to make, and getting it wrong
-- fails SILENTLY in the widening direction.
--
-- If a group conferred permission KEYS directly, a subject would hold the keys
-- while `subject.roles` stayed empty — so a tenant's own policy
-- `subject.roles in ["editor"]` would quietly stop matching. An ALLOW policy
-- that stops matching is a narrowing (safe, and someone notices). A DENY policy
-- that stops matching is INERT, which is a widening, and nothing observes it.
-- Segregation of duties would go the same way: its facts are keyed off the role
-- grant, so a group-derived grant would carry no conflict.
--
-- Because the grant lands in `awcms_access_policies`, every reader gets groups
-- at once through `activeRoleGrants` (ADR-0079) — `subject.roles`,
-- `fetchGrantedPermissionKeys`, the SoD resolvers, the admin listing, the
-- last-administrator guard. There is no second path that could disagree, which
-- is the whole reason PR 3.3 collapsed the readers before this PR added a
-- subject.
--
-- ## `external_id`, not `group_code`, is the sync key
--
-- An IdP rename must not orphan a group. `group_code` is a human label and
-- humans rename things; `external_id` is what the directory calls the group and
-- it survives the rename. A `source = 'scim'` group is therefore matched by
-- `external_id` and refuses local mutation.
--
-- SCIM itself is NOT built here. What is built is the shape that does not have
-- to be migrated when it is: a `source` discriminator with a CHECK, and an
-- `external_id` that is unique per tenant among externally-managed rows.
--
-- ## Widening `awcms_access_policies` in place
--
-- `subject_type` was created accepting one value precisely so this migration
-- would be one `DROP CONSTRAINT` / `ADD CONSTRAINT` (ADR-0078 §"subject_type
-- accepts one value, on purpose"). `tenant_user_id` becomes NULLABLE, and the
-- XOR CHECK below is what replaces the NOT NULL: exactly one subject column is
-- populated, and it is the one `subject_type` names.
--
-- Dropping a NOT NULL from a live authorization table is exactly the class of
-- change ADR-0078 refused to make to `awcms_access_assignments`. It is safe HERE
-- and it is worth saying why, because the words look identical: there, the
-- change was to DROP A UNIQUE INDEX, which fails in the ALLOW direction (two
-- rows where one was permitted) with nothing going red. Here the constraint is
-- REPLACED by a stricter one in the same statement block — a row with neither
-- subject, or both, or a subject that disagrees with its own discriminator, is
-- refused where before it was merely impossible.
--
-- The partial unique index on active grants must gain a sibling: `NULL` is not
-- equal to `NULL` in a unique index, so the existing index stops constraining
-- anything the moment `tenant_user_id` can be NULL.
--
-- Pure DDL — no rows are written, so the `NO FORCE -> DML -> FORCE` toggle
-- `sql/103` needed does not apply.

BEGIN;

-- 1. awcms_user_groups — a named set of tenant users, local or directory-sourced.
CREATE TABLE IF NOT EXISTS awcms_user_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  group_code text NOT NULL,
  group_name text NOT NULL,
  description text,
  source text NOT NULL DEFAULT 'local',
  external_id text,
  created_by_tenant_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT awcms_user_groups_source_check
    CHECK (source IN ('local', 'scim')),
  CONSTRAINT awcms_user_groups_code_format_check
    CHECK (group_code ~ '^[a-z][a-z0-9_-]{1,63}$'),
  -- A directory-sourced group without the directory's own identifier cannot be
  -- re-matched after a rename, which is the one thing `external_id` exists for.
  CONSTRAINT awcms_user_groups_external_id_check
    CHECK (source <> 'scim' OR external_id IS NOT NULL),
  CONSTRAINT awcms_user_groups_created_by_tenant_fkey
    FOREIGN KEY (tenant_id, created_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Composite-FK target: a grant names a group, and the pair must stay in one
-- tenant (`sql/027` — RI checks run as the table owner and bypass RLS).
ALTER TABLE awcms_user_groups
  ADD CONSTRAINT awcms_user_groups_tenant_id_key UNIQUE (tenant_id, id);

-- One live group per code. Partial on `deleted_at` so a retired code can be
-- reused, which is the ordinary case for a directory that recreates a group.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_user_groups_code_key
  ON awcms_user_groups (tenant_id, group_code)
  WHERE deleted_at IS NULL;

-- The sync key: one live group per external identifier, per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_user_groups_external_key
  ON awcms_user_groups (tenant_id, external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_user_groups_tenant_idx
  ON awcms_user_groups (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_user_groups_created_by_idx
  ON awcms_user_groups (tenant_id, created_by_tenant_user_id)
  WHERE created_by_tenant_user_id IS NOT NULL;

ALTER TABLE awcms_user_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_user_groups FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_user_groups_tenant_isolation
  ON awcms_user_groups
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 2. awcms_user_group_members — membership, one row per (group, tenant user).
CREATE TABLE IF NOT EXISTS awcms_user_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  user_group_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  added_by_tenant_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_user_group_members_group_tenant_fkey
    FOREIGN KEY (tenant_id, user_group_id)
    REFERENCES awcms_user_groups (tenant_id, id),
  CONSTRAINT awcms_user_group_members_subject_tenant_fkey
    FOREIGN KEY (tenant_id, tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_user_group_members_added_by_tenant_fkey
    FOREIGN KEY (tenant_id, added_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_user_group_members_key
  ON awcms_user_group_members (tenant_id, user_group_id, tenant_user_id);

-- The authorization-path lookup: "which groups is this subject in?". This is
-- the join `activeRoleGrants` walks on every guarded request that reaches a
-- grant read, so it is the one index whose absence would be felt everywhere.
CREATE INDEX IF NOT EXISTS awcms_user_group_members_subject_idx
  ON awcms_user_group_members (tenant_id, tenant_user_id);

CREATE INDEX IF NOT EXISTS awcms_user_group_members_added_by_idx
  ON awcms_user_group_members (tenant_id, added_by_tenant_user_id)
  WHERE added_by_tenant_user_id IS NOT NULL;

ALTER TABLE awcms_user_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_user_group_members FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_user_group_members_tenant_isolation
  ON awcms_user_group_members
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 3. A group can hold a grant.
ALTER TABLE awcms_access_policies
  ADD COLUMN IF NOT EXISTS user_group_id uuid;

ALTER TABLE awcms_access_policies
  ALTER COLUMN tenant_user_id DROP NOT NULL;

ALTER TABLE awcms_access_policies
  DROP CONSTRAINT IF EXISTS awcms_access_policies_subject_type_check;

ALTER TABLE awcms_access_policies
  ADD CONSTRAINT awcms_access_policies_subject_type_check
    CHECK (subject_type IN ('tenant_user', 'user_group'));

-- The XOR, and it is what replaces the dropped NOT NULL: exactly one subject
-- column is populated, and it is the one the discriminator names. A row with
-- neither, both, or a mismatched pair is refused.
ALTER TABLE awcms_access_policies
  ADD CONSTRAINT awcms_access_policies_subject_xor_check
    CHECK (
      (subject_type = 'tenant_user'
        AND tenant_user_id IS NOT NULL AND user_group_id IS NULL)
      OR
      (subject_type = 'user_group'
        AND user_group_id IS NOT NULL AND tenant_user_id IS NULL)
    );

ALTER TABLE awcms_access_policies
  ADD CONSTRAINT awcms_access_policies_group_tenant_fkey
    FOREIGN KEY (tenant_id, user_group_id)
    REFERENCES awcms_user_groups (tenant_id, id);

-- The sibling the existing partial unique index needs: `NULL` is not equal to
-- `NULL`, so `awcms_access_policies_active_key` constrains nothing once
-- `tenant_user_id` can be NULL. Without this, a group could hold the same role
-- at the same scope any number of times.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_access_policies_group_active_key
  ON awcms_access_policies (tenant_id, user_group_id, role_id, scope_type, scope_id)
  WHERE status = 'active' AND user_group_id IS NOT NULL;

-- Group-subject lookup, mirroring `awcms_access_policies_subject_idx`.
CREATE INDEX IF NOT EXISTS awcms_access_policies_group_idx
  ON awcms_access_policies (tenant_id, user_group_id)
  WHERE status = 'active' AND user_group_id IS NOT NULL;

COMMENT ON TABLE awcms_user_groups IS
  'A named set of tenant users that can hold a role grant (ADR-0081). A group grants ROLES, never permission keys: conferring keys directly would leave subject.roles empty, which silently makes a tenant DENY policy inert and blinds SoD. source = ''scim'' marks a directory-managed group — matched by external_id (not group_code, which humans rename) and refused local mutation.';

COMMENT ON COLUMN awcms_access_policies.user_group_id IS
  'Set when subject_type = ''user_group''. Exactly one of tenant_user_id / user_group_id is populated (awcms_access_policies_subject_xor_check).';

COMMIT;
