-- ADR-0052 — revoke `idn_admin_regions.dataset.configure` and `.restore`.
--
-- ## Why these two rows are a security defect, not just dead config
--
-- Both actions swap the Indonesia administrative-region dataset that is served
-- to EVERY tenant: `awcms_idn_region_datasets` is global reference data with no
-- `tenant_id` and no RLS. But `sql/081` seeded them into the GLOBAL ABAC
-- catalog, and `POST /api/v1/setup/initialize` grants the whole catalog to each
-- new tenant's `owner` role (owner = every permission). So an ordinary tenant
-- owner held authority over data served to other tenants, and ABAC could not
-- see anything wrong with that — it evaluates the permission, not who the
-- action ultimately affects.
--
-- ADR-0052 removes the HTTP surface entirely: activation and rollback become
-- operator jobs (`bun run idn-regions:activate` / `:rollback`, dry-run by
-- default), matching `idn-regions:import`, which ADR-0046 §5 already made
-- job-only for exactly this reason ("no request-time subject for an ABAC guard
-- to evaluate"). With no endpoint left, a seeded permission would advertise a
-- surface that does not exist — the inverse latent-authz trap.
--
-- ## Order matters
--
-- `awcms_role_permissions` references `awcms_permissions`, so the grants must go
-- first or the catalog delete hits the FK. Deleting the grants is the half that
-- actually removes the authority from every role that already holds it — the
-- catalog delete alone would leave live grants pointing at nothing.
--
-- Idempotent: both statements are unconditional deletes of rows matched by
-- natural key, so re-running is a no-op. No rollback statement is provided
-- deliberately — restoring these grants is the defect, and a deployment that
-- wants the old behaviour must first decide how a cross-tenant action gets a
-- platform-scoped gate (ADR-0051 §Keputusan).

DELETE FROM awcms_role_permissions rp
USING awcms_permissions p
WHERE rp.permission_id = p.id
  AND p.module_key = 'idn_admin_regions'
  AND p.activity_code = 'dataset'
  AND p.action IN ('configure', 'restore');

DELETE FROM awcms_permissions
WHERE module_key = 'idn_admin_regions'
  AND activity_code = 'dataset'
  AND action IN ('configure', 'restore');
