SET client_min_messages TO warning;

CREATE TABLE IF NOT EXISTS public.platform_extension_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  vendor text NOT NULL,
  name text NOT NULL,
  description text,
  version text NOT NULL DEFAULT '1.0.0',
  kind text NOT NULL DEFAULT 'external' CHECK (kind IN ('bundled', 'external')),
  scope text NOT NULL DEFAULT 'tenant' CHECK (scope IN ('platform', 'tenant')),
  source text NOT NULL DEFAULT 'workspace',
  package_path text,
  checksum text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'deprecated', 'retired')),
  compatibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_extension_catalog_vendor_slug_unique UNIQUE (vendor, slug)
);

CREATE TABLE IF NOT EXISTS public.tenant_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  catalog_id uuid NOT NULL REFERENCES public.platform_extension_catalog(id) ON DELETE RESTRICT,
  installed_version text NOT NULL DEFAULT '1.0.0',
  activation_state text NOT NULL DEFAULT 'installed' CHECK (activation_state IN ('installed', 'active', 'inactive', 'error', 'upgrade_required', 'uninstall_requested')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollout jsonb NOT NULL DEFAULT '{}'::jsonb,
  installed_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  deactivated_at timestamptz,
  last_health_status text NOT NULL DEFAULT 'unknown',
  last_health_checked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_extensions_tenant_catalog_unique UNIQUE (tenant_id, catalog_id)
);

CREATE TABLE IF NOT EXISTS public.extension_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  catalog_id uuid REFERENCES public.platform_extension_catalog(id) ON DELETE SET NULL,
  tenant_extension_id uuid REFERENCES public.tenant_extensions(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'succeeded',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  slug text NOT NULL,
  summary text,
  location text,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_extension_catalog_vendor_slug_uidx ON public.platform_extension_catalog (vendor, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS platform_extension_catalog_status_idx ON public.platform_extension_catalog (status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_extensions_tenant_state_idx ON public.tenant_extensions (tenant_id, activation_state, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_extensions_catalog_idx ON public.tenant_extensions (catalog_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS extension_lifecycle_audit_scope_idx ON public.extension_lifecycle_audit (tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS extension_lifecycle_audit_catalog_idx ON public.extension_lifecycle_audit (catalog_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS events_tenant_slug_uidx ON public.events (tenant_id, lower(slug)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS events_tenant_status_start_idx ON public.events (tenant_id, status, start_at ASC) WHERE deleted_at IS NULL;

ALTER TABLE public.platform_extension_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extension_lifecycle_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_extension_catalog_select" ON public.platform_extension_catalog;
CREATE POLICY "platform_extension_catalog_select"
ON public.platform_extension_catalog
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (SELECT public.auth_is_admin())
    OR (SELECT public.has_permission('platform.extensions.read'))
    OR (SELECT public.has_permission('tenant.setting.read'))
  )
);

DROP POLICY IF EXISTS "platform_extension_catalog_insert" ON public.platform_extension_catalog;
CREATE POLICY "platform_extension_catalog_insert"
ON public.platform_extension_catalog
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.create'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);

DROP POLICY IF EXISTS "platform_extension_catalog_update" ON public.platform_extension_catalog;
CREATE POLICY "platform_extension_catalog_update"
ON public.platform_extension_catalog
FOR UPDATE
TO authenticated
USING (
  (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
)
WITH CHECK (
  (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);

DROP POLICY IF EXISTS "platform_extension_catalog_delete" ON public.platform_extension_catalog;
CREATE POLICY "platform_extension_catalog_delete"
ON public.platform_extension_catalog
FOR DELETE
TO authenticated
USING (
  (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.delete'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);

DROP POLICY IF EXISTS "tenant_extensions_select" ON public.tenant_extensions;
CREATE POLICY "tenant_extensions_select"
ON public.tenant_extensions
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (tenant_id = (SELECT public.current_tenant_id()) AND ((SELECT public.has_permission('tenant.setting.read')) OR (SELECT public.has_permission('tenant.setting.update'))))
    OR (SELECT public.auth_is_admin())
    OR (SELECT public.has_permission('platform.extensions.read'))
  )
);

DROP POLICY IF EXISTS "tenant_extensions_insert" ON public.tenant_extensions;
CREATE POLICY "tenant_extensions_insert"
ON public.tenant_extensions
FOR INSERT
TO authenticated
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND ((SELECT public.has_permission('tenant.setting.update')) OR (SELECT public.has_permission('tenant.setting.read')))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);

DROP POLICY IF EXISTS "tenant_extensions_update" ON public.tenant_extensions;
CREATE POLICY "tenant_extensions_update"
ON public.tenant_extensions
FOR UPDATE
TO authenticated
USING (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND ((SELECT public.has_permission('tenant.setting.update')) OR (SELECT public.has_permission('tenant.setting.read')))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
)
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND ((SELECT public.has_permission('tenant.setting.update')) OR (SELECT public.has_permission('tenant.setting.read')))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);

DROP POLICY IF EXISTS "tenant_extensions_delete" ON public.tenant_extensions;
CREATE POLICY "tenant_extensions_delete"
ON public.tenant_extensions
FOR DELETE
TO authenticated
USING (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.has_permission('tenant.setting.update'))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.delete'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);

DROP POLICY IF EXISTS "extension_lifecycle_audit_select" ON public.extension_lifecycle_audit;
CREATE POLICY "extension_lifecycle_audit_select"
ON public.extension_lifecycle_audit
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (tenant_id = (SELECT public.current_tenant_id()) AND ((SELECT public.has_permission('tenant.audit.read')) OR (SELECT public.has_permission('tenant.setting.read'))))
    OR (SELECT public.auth_is_admin())
    OR (SELECT public.has_permission('platform.extensions.read'))
  )
);

DROP POLICY IF EXISTS "extension_lifecycle_audit_insert" ON public.extension_lifecycle_audit;
CREATE POLICY "extension_lifecycle_audit_insert"
ON public.extension_lifecycle_audit
FOR INSERT
TO authenticated
WITH CHECK (
  actor_user_id = auth.uid()
  AND (
    tenant_id IS NULL
    OR tenant_id = (SELECT public.current_tenant_id())
    OR (SELECT public.auth_is_admin())
  )
);

DROP POLICY IF EXISTS "extension_lifecycle_audit_update" ON public.extension_lifecycle_audit;
CREATE POLICY "extension_lifecycle_audit_update"
ON public.extension_lifecycle_audit
FOR UPDATE
TO authenticated
USING ((SELECT public.auth_is_admin()))
WITH CHECK ((SELECT public.auth_is_admin()));

DROP POLICY IF EXISTS "events_select" ON public.events;
CREATE POLICY "events_select"
ON public.events
FOR SELECT
TO authenticated
USING (
  tenant_id = (SELECT public.current_tenant_id())
  AND deleted_at IS NULL
  AND ((SELECT public.has_permission('tenant.events.read')) OR (SELECT public.auth_is_admin()))
);

DROP POLICY IF EXISTS "events_insert" ON public.events;
CREATE POLICY "events_insert"
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = (SELECT public.current_tenant_id())
  AND ((SELECT public.has_permission('tenant.events.create')) OR (SELECT public.auth_is_admin()))
  AND (author_id IS NULL OR author_id = auth.uid())
);

DROP POLICY IF EXISTS "events_update" ON public.events;
CREATE POLICY "events_update"
ON public.events
FOR UPDATE
TO authenticated
USING (
  tenant_id = (SELECT public.current_tenant_id())
  AND deleted_at IS NULL
  AND ((SELECT public.has_permission('tenant.events.update')) OR (SELECT public.auth_is_admin()))
)
WITH CHECK (
  tenant_id = (SELECT public.current_tenant_id())
  AND ((SELECT public.has_permission('tenant.events.update')) OR (SELECT public.auth_is_admin()))
);

DROP POLICY IF EXISTS "events_delete" ON public.events;
CREATE POLICY "events_delete"
ON public.events
FOR DELETE
TO authenticated
USING (
  tenant_id = (SELECT public.current_tenant_id())
  AND ((SELECT public.has_permission('tenant.events.delete')) OR (SELECT public.auth_is_admin()))
);

WITH permissions_seed(name, resource, action, description) AS (
  VALUES
    ('platform.extensions.manage', 'extensions', 'manage', 'Manage the platform extension catalog and lifecycle orchestration'),
    ('tenant.events.read', 'events', 'read', 'Read tenant events'),
    ('tenant.events.create', 'events', 'create', 'Create tenant events'),
    ('tenant.events.update', 'events', 'update', 'Update tenant events'),
    ('tenant.events.delete', 'events', 'delete', 'Soft delete tenant events'),
    ('tenant.events.publish', 'events', 'publish', 'Publish tenant events')
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
VALUES ('events', 'Events', 'tenant', 'module', 'events', 'CalendarDays', 'tenant.events', true)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  scope = EXCLUDED.scope,
  type = EXCLUDED.type,
  db_table = EXCLUDED.db_table,
  icon = EXCLUDED.icon,
  permission_prefix = EXCLUDED.permission_prefix,
  active = EXCLUDED.active,
  updated_at = now();

INSERT INTO public.role_permissions (role_id, permission_id, deleted_at)
SELECT r.id, p.id, NULL
FROM public.roles r
JOIN public.permissions p ON p.name IN ('tenant.events.read', 'tenant.events.create', 'tenant.events.update', 'tenant.events.delete', 'tenant.events.publish')
WHERE r.deleted_at IS NULL
  AND r.is_tenant_admin = true
ON CONFLICT (role_id, permission_id) DO UPDATE SET deleted_at = NULL;

WITH legacy_extensions AS (
  SELECT
    e.*,
    COALESCE(NULLIF(e.manifest->>'vendor', ''), NULLIF(split_part(e.slug, '-', 1), ''), 'awcms') AS vendor_name,
    CASE
      WHEN jsonb_typeof(e.manifest) = 'object' AND e.manifest ? 'schemaVersion' THEN e.manifest
      ELSE jsonb_strip_nulls(jsonb_build_object(
        'schemaVersion', 1,
        'slug', e.slug,
        'name', e.name,
        'vendor', COALESCE(NULLIF(e.manifest->>'vendor', ''), 'awcms'),
        'version', e.version,
        'kind', CASE WHEN e.extension_type = 'external' THEN 'external' ELSE 'bundled' END,
        'scope', 'tenant',
        'compatibility', jsonb_build_object('awcms', COALESCE(NULLIF(e.manifest->'compatibility'->>'awcms', ''), NULLIF(e.manifest->>'awcms_version', ''), '>=4.1.1')),
        'capabilities', COALESCE(e.manifest->'capabilities', '[]'::jsonb),
        'resources', COALESCE(e.manifest->'resources', jsonb_build_object('admin', jsonb_build_object('entry', CASE WHEN e.extension_type = 'external' THEN COALESCE(e.external_path, 'dist/index.js') ELSE CONCAT('bundled:', e.slug) END))),
        'permissions', COALESCE(e.manifest->'permissions', COALESCE(e.config->'permissions', '[]'::jsonb)),
        'adminRoutes', COALESCE(e.manifest->'adminRoutes', COALESCE(e.config->'routes', e.manifest->'routes', '[]'::jsonb)),
        'menus', COALESCE(e.manifest->'menus', CASE WHEN e.manifest ? 'menu' THEN jsonb_build_array(e.manifest->'menu') ELSE '[]'::jsonb END),
        'publicModules', COALESCE(e.manifest->'publicModules', '[]'::jsonb),
        'settingsSchema', COALESCE(e.manifest->'settingsSchema', jsonb_build_object('type', 'object', 'properties', '{}'::jsonb)),
        'edgeRoutes', COALESCE(e.manifest->'edgeRoutes', '[]'::jsonb),
        'dependencies', COALESCE(e.manifest->'dependencies', '{}'::jsonb),
        'widgets', COALESCE(e.manifest->'widgets', '[]'::jsonb),
        'hooks', COALESCE(e.manifest->'hooks', '{}'::jsonb)
      ))
    END AS normalized_manifest
  FROM public.extensions e
  WHERE e.deleted_at IS NULL
), catalog_upsert AS (
  INSERT INTO public.platform_extension_catalog (
    slug,
    vendor,
    name,
    description,
    version,
    kind,
    scope,
    source,
    package_path,
    checksum,
    status,
    compatibility,
    capabilities,
    manifest,
    created_by,
    deleted_at,
    created_at,
    updated_at
  )
  SELECT DISTINCT ON (vendor_name, slug)
    slug,
    vendor_name,
    name,
    description,
    version,
    CASE WHEN extension_type = 'external' THEN 'external' ELSE 'bundled' END,
    'tenant',
    CASE WHEN extension_type = 'external' THEN 'workspace' ELSE 'bundled' END,
    external_path,
    NULL,
    'active',
    COALESCE(normalized_manifest->'compatibility', '{}'::jsonb),
    COALESCE(normalized_manifest->'capabilities', '[]'::jsonb),
    normalized_manifest,
    created_by,
    NULL,
    created_at,
    updated_at
  FROM legacy_extensions
  ON CONFLICT (vendor, slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    version = EXCLUDED.version,
    kind = EXCLUDED.kind,
    scope = EXCLUDED.scope,
    source = EXCLUDED.source,
    package_path = COALESCE(EXCLUDED.package_path, public.platform_extension_catalog.package_path),
    compatibility = EXCLUDED.compatibility,
    capabilities = EXCLUDED.capabilities,
    manifest = EXCLUDED.manifest,
    updated_at = GREATEST(public.platform_extension_catalog.updated_at, EXCLUDED.updated_at)
  RETURNING id, vendor, slug
)
INSERT INTO public.tenant_extensions (
  tenant_id,
  catalog_id,
  installed_version,
  activation_state,
  config,
  rollout,
  installed_at,
  activated_at,
  deactivated_at,
  created_by,
  updated_by,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  e.tenant_id,
  c.id,
  e.version,
  CASE WHEN e.is_active THEN 'active' ELSE 'inactive' END,
  COALESCE(e.config, '{}'::jsonb),
  '{}'::jsonb,
  COALESCE(e.created_at, now()),
  CASE WHEN e.is_active THEN COALESCE(e.updated_at, e.created_at, now()) ELSE NULL END,
  CASE WHEN e.is_active THEN NULL ELSE COALESCE(e.updated_at, now()) END,
  e.created_by,
  e.created_by,
  NULL,
  COALESCE(e.created_at, now()),
  COALESCE(e.updated_at, now())
FROM legacy_extensions e
JOIN public.platform_extension_catalog c
  ON c.vendor = e.vendor_name
 AND c.slug = e.slug
WHERE e.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, catalog_id) DO UPDATE SET
  installed_version = EXCLUDED.installed_version,
  activation_state = EXCLUDED.activation_state,
  config = EXCLUDED.config,
  updated_at = GREATEST(public.tenant_extensions.updated_at, EXCLUDED.updated_at),
  deleted_at = NULL;

INSERT INTO public.platform_extension_catalog (
  slug,
  vendor,
  name,
  description,
  version,
  kind,
  scope,
  source,
  package_path,
  status,
  compatibility,
  capabilities,
  manifest
)
VALUES (
  'events',
  'ahliweb',
  'Events Manager',
  'Reference manifest-driven tenant extension for event publishing.',
  '1.0.0',
  'bundled',
  'tenant',
  'workspace',
  'awcms-ext/ahliweb/events/extension.json',
  'active',
  '{"awcms": ">=4.1.1"}'::jsonb,
  '["events:content","events:public-listing","events:health"]'::jsonb,
  '{"schemaVersion":1,"slug":"events","name":"Events Manager","vendor":"ahliweb","version":"1.0.0","kind":"bundled","scope":"tenant","compatibility":{"awcms":">=4.1.1"},"capabilities":["events:content","events:public-listing","events:health"],"resources":{"admin":{"entry":"bundled:awcms-ext-ahliweb-events"},"public":{"entry":"events-list"},"edge":{"entry":"events-health"}},"permissions":[{"key":"tenant.events.read","description":"Read tenant events"},{"key":"tenant.events.create","description":"Create tenant events"},{"key":"tenant.events.update","description":"Update tenant events"},{"key":"tenant.events.delete","description":"Soft delete tenant events"},{"key":"tenant.events.publish","description":"Publish tenant events"}],"adminRoutes":[{"path":"events","component":"EventsDashboard","permission":"tenant.events.read"}],"menus":[{"key":"events","label":"Events","path":"events","icon":"CalendarDays","permission":"tenant.events.read","group":"CONTENT","order":115}],"publicModules":[{"key":"events","label":"Events","url":"/events","icon":"CalendarDays","order":310}],"settingsSchema":{"type":"object","properties":{"showUpcomingOnly":{"type":"boolean","default":true},"featuredLimit":{"type":"number","default":6}}},"edgeRoutes":[{"path":"/functions/v1/extensions/events/health","method":"GET","capability":"events:health","permission":"tenant.events.read"}],"dependencies":{},"widgets":[{"key":"events-overview","component":"EventsOverviewWidget","title":"Upcoming Events","icon":"CalendarDays","position":"sidebar","order":120}],"hooks":{}}'::jsonb
)
ON CONFLICT (vendor, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  version = EXCLUDED.version,
  kind = EXCLUDED.kind,
  scope = EXCLUDED.scope,
  source = EXCLUDED.source,
  package_path = EXCLUDED.package_path,
  status = EXCLUDED.status,
  compatibility = EXCLUDED.compatibility,
  capabilities = EXCLUDED.capabilities,
  manifest = EXCLUDED.manifest,
  updated_at = now();
