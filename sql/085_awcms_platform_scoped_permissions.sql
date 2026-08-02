-- ADR-0053 — permission scope, and the return of the two region-dataset
-- lifecycle permissions as PLATFORM-scoped.
--
-- ## What this adds
--
-- `awcms_permissions.scope` splits the catalogue into two populations:
--
--   'tenant'   — an ordinary per-tenant permission. Everything that existed
--                before this migration, which is why the default backfills the
--                whole table without listing a single row.
--   'platform' — the action's effect crosses tenant boundaries. Never included
--                in the blanket grant a new tenant's owner receives, and
--                refused by `access-guard.ts` unless the acting tenant IS the
--                platform tenant (`lib/tenant/platform-tenant.ts`).
--
-- ## Why the column exists at all
--
-- `sql/084` (ADR-0052) deleted `idn_admin_regions.dataset.configure`/`.restore`
-- because they were cross-tenant authority sitting in a catalogue that
-- `POST /api/v1/setup/initialize` grants WHOLESALE to every new tenant's
-- `owner` role:
--
--     INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
--     SELECT <tenant>, <role>, id FROM awcms_permissions;
--
-- That statement is the actual defect, and it is still there — it just has
-- nothing dangerous left to hand out. Deleting the two rows fixed the instance;
-- the class returns with the next cross-tenant action anyone adds. `scope` is
-- what lets that SELECT exclude a population instead of relying on nobody ever
-- adding such a permission again (`platform-bootstrap.ts` now filters on it).
--
-- ## Why the grant below targets the setup tenant specifically
--
-- Platform authority belongs to ONE tenant. At request time that tenant is
-- resolved from `PLATFORM_TENANT_ID` -> the public default-tenant chain, which
-- SQL cannot see. `awcms_setup_state.tenant_id` — the tenant the setup wizard
-- bootstrapped — is the one candidate a migration can name, and it is the last
-- link of that same chain, so in every deployment that has not deliberately
-- repointed the default it is the same tenant.
--
-- A deployment that HAS repointed it grants the pair to that tenant's owner
-- role itself; `bun run security:readiness` reports the mismatch rather than
-- leaving it to be discovered by a 403. Missing grants deny — the safe
-- direction — because the guard requires the permission AND the platform
-- tenant, never one standing in for the other.
--
-- Idempotent throughout: `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`
-- against the natural key, and a grant insert that anti-joins what is already
-- there. Safe to re-run; safe on a database where `sql/084` already ran.

ALTER TABLE awcms_permissions
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'tenant';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'awcms_permissions_scope_check'
  ) THEN
    ALTER TABLE awcms_permissions
      ADD CONSTRAINT awcms_permissions_scope_check
      CHECK (scope IN ('tenant', 'platform'));
  END IF;
END
$$;

COMMENT ON COLUMN awcms_permissions.scope IS
  'ADR-0053. ''tenant'' = ordinary per-tenant permission, included in the blanket grant a new tenant owner receives. ''platform'' = the action crosses tenant boundaries: excluded from that grant, and refused by the authorization chokepoint unless the acting tenant is the platform tenant. Declared in code on ModulePermissionDescriptor.scope; tests/platform-scoped-permissions.test.ts fails when the two disagree.';

-- Re-seed the two lifecycle permissions removed by `sql/084`, now scoped.
INSERT INTO awcms_permissions (module_key, activity_code, action, description, scope)
VALUES
  ('idn_admin_regions', 'dataset', 'configure',
   'PLATFORM: choose which imported dataset version is served to every tenant (activate)',
   'platform'),
  ('idn_admin_regions', 'dataset', 'restore',
   'PLATFORM: return every tenant to the previously active dataset version (rollback)',
   'platform')
ON CONFLICT (module_key, activity_code, action) DO UPDATE
  SET scope = EXCLUDED.scope,
      description = EXCLUDED.description;

-- Grant them to the setup tenant's `owner` role — and to no other role.
INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT s.tenant_id, r.id, p.id
FROM awcms_setup_state s
JOIN awcms_roles r
  ON r.tenant_id = s.tenant_id
 AND r.role_code = 'owner'
 AND r.deleted_at IS NULL
JOIN awcms_permissions p
  ON p.module_key = 'idn_admin_regions'
 AND p.activity_code = 'dataset'
 AND p.action IN ('configure', 'restore')
WHERE s.id = true
  AND s.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM awcms_role_permissions existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
