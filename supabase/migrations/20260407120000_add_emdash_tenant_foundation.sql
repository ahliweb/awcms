SET client_min_messages TO warning;

ALTER TABLE public.tenant_extensions
  ADD COLUMN IF NOT EXISTS settings_schema_version text NOT NULL DEFAULT '1',
  ADD COLUMN IF NOT EXISTS runtime_bindings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS storage_bindings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.template_parts
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS normalization_status text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS last_normalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_emdash_payload jsonb;

ALTER TABLE public.widgets
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS normalization_status text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS last_normalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_emdash_payload jsonb;

CREATE TABLE IF NOT EXISTS public.tenant_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_system text NOT NULL DEFAULT 'emdash' CHECK (source_system IN ('emdash')),
  import_type text NOT NULL DEFAULT 'seed' CHECK (import_type IN ('seed', 'content_sync', 'replay')),
  template_slug text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'dry_run')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_import_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.tenant_import_jobs(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('seed', 'content', 'media', 'settings', 'widget_area', 'extension')),
  source_locator text,
  source_version text,
  checksum text,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_import_sources_job_source_unique UNIQUE (job_id, source_key, source_kind)
);

CREATE TABLE IF NOT EXISTS public.tenant_import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.tenant_import_jobs(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_id text NOT NULL,
  target_table text NOT NULL,
  target_id text NOT NULL,
  mapping_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_import_mappings_source_target_unique UNIQUE (tenant_id, source_kind, source_id, target_table)
);

CREATE TABLE IF NOT EXISTS public.tenant_import_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.tenant_import_jobs(id) ON DELETE CASCADE,
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('seed', 'normalized_payload', 'widget_snapshot', 'visual_snapshot', 'log')),
  artifact_key text NOT NULL,
  checksum text,
  artifact_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_import_artifacts_job_key_unique UNIQUE (job_id, artifact_kind, artifact_key)
);

CREATE TABLE IF NOT EXISTS public.tenant_import_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.tenant_import_jobs(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'succeeded',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_extension_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  catalog_id uuid NOT NULL REFERENCES public.platform_extension_catalog(id) ON DELETE CASCADE,
  tenant_extension_id uuid NOT NULL REFERENCES public.tenant_extensions(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  extension_slug text NOT NULL,
  route_key text NOT NULL,
  route_path text NOT NULL,
  route_method text NOT NULL DEFAULT 'POST',
  visibility text NOT NULL DEFAULT 'authenticated' CHECK (visibility IN ('public', 'authenticated')),
  capability text NOT NULL,
  permission text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_extension_routes_unique UNIQUE (tenant_extension_id, route_key)
);

CREATE INDEX IF NOT EXISTS tenant_import_jobs_tenant_status_idx
  ON public.tenant_import_jobs (tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_import_sources_job_kind_idx
  ON public.tenant_import_sources (job_id, source_kind)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_import_mappings_tenant_target_idx
  ON public.tenant_import_mappings (tenant_id, target_table)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_import_artifacts_job_kind_idx
  ON public.tenant_import_artifacts (job_id, artifact_kind)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_import_audit_tenant_created_idx
  ON public.tenant_import_audit (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_extension_routes_lookup_idx
  ON public.tenant_extension_routes (tenant_id, vendor, extension_slug, route_method, route_path)
  WHERE deleted_at IS NULL AND is_active = true;

ALTER TABLE public.tenant_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_import_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_import_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_import_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_import_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_extension_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_import_jobs_select" ON public.tenant_import_jobs;
CREATE POLICY "tenant_import_jobs_select"
ON public.tenant_import_jobs
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.has_permission('tenant.emdash_import.read')))
    OR (SELECT public.auth_is_admin())
    OR (SELECT public.has_permission('platform.extensions.read'))
  )
);

DROP POLICY IF EXISTS "tenant_import_jobs_insert" ON public.tenant_import_jobs;
CREATE POLICY "tenant_import_jobs_insert"
ON public.tenant_import_jobs
FOR INSERT
TO authenticated
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.has_permission('tenant.emdash_import.create'))
    AND (requested_by IS NULL OR requested_by = auth.uid())
  )
  OR (SELECT public.auth_is_admin())
);

DROP POLICY IF EXISTS "tenant_import_jobs_update" ON public.tenant_import_jobs;
CREATE POLICY "tenant_import_jobs_update"
ON public.tenant_import_jobs
FOR UPDATE
TO authenticated
USING (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.has_permission('tenant.emdash_import.update'))
  )
  OR (SELECT public.auth_is_admin())
)
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.has_permission('tenant.emdash_import.update'))
  )
  OR (SELECT public.auth_is_admin())
);

DROP POLICY IF EXISTS "tenant_import_jobs_delete" ON public.tenant_import_jobs;
CREATE POLICY "tenant_import_jobs_delete"
ON public.tenant_import_jobs
FOR DELETE
TO authenticated
USING (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.has_permission('tenant.emdash_import.delete'))
  )
  OR (SELECT public.auth_is_admin())
);

DROP POLICY IF EXISTS "tenant_import_sources_unified" ON public.tenant_import_sources;
CREATE POLICY "tenant_import_sources_unified"
ON public.tenant_import_sources
FOR ALL
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.has_permission('tenant.emdash_import.read')))
    OR (SELECT public.auth_is_admin())
  )
)
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT public.has_permission('tenant.emdash_import.create'))
      OR (SELECT public.has_permission('tenant.emdash_import.update'))
    )
  )
  OR (SELECT public.auth_is_admin())
);

DROP POLICY IF EXISTS "tenant_import_mappings_unified" ON public.tenant_import_mappings;
CREATE POLICY "tenant_import_mappings_unified"
ON public.tenant_import_mappings
FOR ALL
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.has_permission('tenant.emdash_import.read')))
    OR (SELECT public.auth_is_admin())
  )
)
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT public.has_permission('tenant.emdash_import.create'))
      OR (SELECT public.has_permission('tenant.emdash_import.update'))
    )
  )
  OR (SELECT public.auth_is_admin())
);

DROP POLICY IF EXISTS "tenant_import_artifacts_unified" ON public.tenant_import_artifacts;
CREATE POLICY "tenant_import_artifacts_unified"
ON public.tenant_import_artifacts
FOR ALL
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.has_permission('tenant.emdash_import.read')))
    OR (SELECT public.auth_is_admin())
  )
)
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT public.has_permission('tenant.emdash_import.create'))
      OR (SELECT public.has_permission('tenant.emdash_import.update'))
    )
  )
  OR (SELECT public.auth_is_admin())
);

DROP POLICY IF EXISTS "tenant_import_audit_select" ON public.tenant_import_audit;
CREATE POLICY "tenant_import_audit_select"
ON public.tenant_import_audit
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.has_permission('tenant.emdash_import.read')))
    OR (SELECT public.auth_is_admin())
  )
);

DROP POLICY IF EXISTS "tenant_import_audit_insert" ON public.tenant_import_audit;
CREATE POLICY "tenant_import_audit_insert"
ON public.tenant_import_audit
FOR INSERT
TO authenticated
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (actor_user_id IS NULL OR actor_user_id = auth.uid())
  )
  OR (SELECT public.auth_is_admin())
);

DROP POLICY IF EXISTS "tenant_extension_routes_select" ON public.tenant_extension_routes;
CREATE POLICY "tenant_extension_routes_select"
ON public.tenant_extension_routes
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (tenant_id = (SELECT public.current_tenant_id()) AND ((SELECT public.has_permission('tenant.setting.read')) OR (SELECT public.has_permission('tenant.emdash_import.read'))))
    OR (SELECT public.auth_is_admin())
    OR (SELECT public.has_permission('platform.extensions.read'))
  )
);

DROP POLICY IF EXISTS "tenant_extension_routes_insert" ON public.tenant_extension_routes;
CREATE POLICY "tenant_extension_routes_insert"
ON public.tenant_extension_routes
FOR INSERT
TO authenticated
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND ((SELECT public.has_permission('tenant.setting.update')) OR (SELECT public.has_permission('tenant.emdash_import.update')))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);

DROP POLICY IF EXISTS "tenant_extension_routes_update" ON public.tenant_extension_routes;
CREATE POLICY "tenant_extension_routes_update"
ON public.tenant_extension_routes
FOR UPDATE
TO authenticated
USING (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND ((SELECT public.has_permission('tenant.setting.update')) OR (SELECT public.has_permission('tenant.emdash_import.update')))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
)
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND ((SELECT public.has_permission('tenant.setting.update')) OR (SELECT public.has_permission('tenant.emdash_import.update')))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);

DROP POLICY IF EXISTS "tenant_extension_routes_delete" ON public.tenant_extension_routes;
CREATE POLICY "tenant_extension_routes_delete"
ON public.tenant_extension_routes
FOR DELETE
TO authenticated
USING (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND ((SELECT public.has_permission('tenant.setting.update')) OR (SELECT public.has_permission('tenant.emdash_import.delete')))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.delete'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);

CREATE OR REPLACE TRIGGER update_tenant_import_jobs_updated_at
  BEFORE UPDATE ON public.tenant_import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_tenant_import_sources_updated_at
  BEFORE UPDATE ON public.tenant_import_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_tenant_import_mappings_updated_at
  BEFORE UPDATE ON public.tenant_import_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_tenant_import_artifacts_updated_at
  BEFORE UPDATE ON public.tenant_import_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_tenant_extension_routes_updated_at
  BEFORE UPDATE ON public.tenant_extension_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

WITH permissions_seed(name, resource, action, description) AS (
  VALUES
    ('tenant.emdash_import.read', 'emdash_import', 'read', 'Read EmDash tenant import jobs and compatibility metadata'),
    ('tenant.emdash_import.create', 'emdash_import', 'create', 'Create EmDash tenant import jobs'),
    ('tenant.emdash_import.update', 'emdash_import', 'update', 'Update EmDash tenant import jobs and compatibility metadata'),
    ('tenant.emdash_import.delete', 'emdash_import', 'delete', 'Delete EmDash tenant import jobs and compatibility metadata')
)
INSERT INTO public.permissions (name, resource, action, description, deleted_at)
SELECT name, resource, action, description, NULL
FROM permissions_seed
ON CONFLICT (name) DO UPDATE SET
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  deleted_at = NULL;

INSERT INTO public.resources_registry (key, label, scope, type, db_table, icon, permission_prefix, active)
VALUES ('emdash_imports', 'EmDash Imports', 'tenant', 'module', 'tenant_import_jobs', 'ArrowDownToLine', 'tenant.emdash_import', true)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  scope = EXCLUDED.scope,
  type = EXCLUDED.type,
  db_table = EXCLUDED.db_table,
  icon = EXCLUDED.icon,
  permission_prefix = EXCLUDED.permission_prefix,
  active = EXCLUDED.active,
  updated_at = now();

INSERT INTO public.admin_menus (
  key,
  label,
  icon,
  path,
  permission,
  "order",
  is_visible,
  is_core,
  group_label,
  group_order,
  scope,
  created_at,
  updated_at
)
SELECT
  'emdash_imports',
  'EmDash Imports',
  'ArrowDownToLine',
  'emdash/imports',
  'tenant.emdash_import.read',
  140,
  true,
  true,
  'CONTENT',
  20,
  'tenant',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_menus WHERE key = 'emdash_imports'
);
