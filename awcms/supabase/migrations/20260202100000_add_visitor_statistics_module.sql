SET client_min_messages TO warning;

-- Description: Adds visitor statistics tracking (events + daily rollups) and admin module wiring.

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  visitor_id text,
  session_id text,
  event_type text DEFAULT 'page_view',
  path text NOT NULL,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  ip_address text,
  user_agent text,
  device_type text,
  country text,
  region text,
  consent_state text DEFAULT 'unknown',
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_created
  ON public.analytics_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_path
  ON public.analytics_events(tenant_id, path);
CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor_created
  ON public.analytics_events(tenant_id, visitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.analytics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  date date NOT NULL,
  path text NOT NULL,
  page_views integer DEFAULT 0,
  unique_visitors integer DEFAULT 0,
  unique_sessions integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, date, path)
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_tenant_date
  ON public.analytics_daily(tenant_id, date);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_events_admin_read" ON public.analytics_events;
CREATE POLICY "analytics_events_admin_read" ON public.analytics_events
  FOR SELECT
  TO authenticated
  USING (
    (tenant_id = public.current_tenant_id() AND public.has_permission('tenant.analytics.read'))
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "analytics_events_public_insert" ON public.analytics_events;
CREATE POLICY "analytics_events_public_insert" ON public.analytics_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "analytics_events_admin_manage" ON public.analytics_events;
CREATE POLICY "analytics_events_admin_manage" ON public.analytics_events
  FOR UPDATE
  TO authenticated
  USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
  )
  WITH CHECK (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "analytics_events_admin_delete" ON public.analytics_events;
CREATE POLICY "analytics_events_admin_delete" ON public.analytics_events
  FOR DELETE
  TO authenticated
  USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "analytics_daily_public_read" ON public.analytics_daily;
CREATE POLICY "analytics_daily_public_read" ON public.analytics_daily
  FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "analytics_daily_admin_manage" ON public.analytics_daily;
CREATE POLICY "analytics_daily_admin_manage" ON public.analytics_daily
  FOR ALL
  TO authenticated
  USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
  )
  WITH CHECK (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
  );

CREATE OR REPLACE FUNCTION public.update_analytics_daily()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_unique_visitor boolean;
  v_unique_session boolean;
  v_unique_visitor_global boolean;
  v_unique_session_global boolean;
BEGIN
  v_date := (NEW.created_at AT TIME ZONE 'UTC')::date;

  v_unique_visitor := NEW.visitor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.analytics_events
    WHERE tenant_id = NEW.tenant_id
      AND visitor_id = NEW.visitor_id
      AND path = NEW.path
      AND created_at::date = v_date
      AND id <> NEW.id
  );

  v_unique_session := NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.analytics_events
    WHERE tenant_id = NEW.tenant_id
      AND session_id = NEW.session_id
      AND path = NEW.path
      AND created_at::date = v_date
      AND id <> NEW.id
  );

  v_unique_visitor_global := NEW.visitor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.analytics_events
    WHERE tenant_id = NEW.tenant_id
      AND visitor_id = NEW.visitor_id
      AND created_at::date = v_date
      AND id <> NEW.id
  );

  v_unique_session_global := NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.analytics_events
    WHERE tenant_id = NEW.tenant_id
      AND session_id = NEW.session_id
      AND created_at::date = v_date
      AND id <> NEW.id
  );

  INSERT INTO public.analytics_daily (
    tenant_id,
    date,
    path,
    page_views,
    unique_visitors,
    unique_sessions,
    created_at,
    updated_at
  ) VALUES (
    NEW.tenant_id,
    v_date,
    NEW.path,
    1,
    CASE WHEN v_unique_visitor THEN 1 ELSE 0 END,
    CASE WHEN v_unique_session THEN 1 ELSE 0 END,
    now(),
    now()
  )
  ON CONFLICT (tenant_id, date, path)
  DO UPDATE SET
    page_views = public.analytics_daily.page_views + 1,
    unique_visitors = public.analytics_daily.unique_visitors +
      (CASE WHEN v_unique_visitor THEN 1 ELSE 0 END),
    unique_sessions = public.analytics_daily.unique_sessions +
      (CASE WHEN v_unique_session THEN 1 ELSE 0 END),
    updated_at = now();

  INSERT INTO public.analytics_daily (
    tenant_id,
    date,
    path,
    page_views,
    unique_visitors,
    unique_sessions,
    created_at,
    updated_at
  ) VALUES (
    NEW.tenant_id,
    v_date,
    '__all__',
    1,
    CASE WHEN v_unique_visitor_global THEN 1 ELSE 0 END,
    CASE WHEN v_unique_session_global THEN 1 ELSE 0 END,
    now(),
    now()
  )
  ON CONFLICT (tenant_id, date, path)
  DO UPDATE SET
    page_views = public.analytics_daily.page_views + 1,
    unique_visitors = public.analytics_daily.unique_visitors +
      (CASE WHEN v_unique_visitor_global THEN 1 ELSE 0 END),
    unique_sessions = public.analytics_daily.unique_sessions +
      (CASE WHEN v_unique_session_global THEN 1 ELSE 0 END),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS analytics_events_rollup ON public.analytics_events;
CREATE TRIGGER analytics_events_rollup
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_analytics_daily();

DO $$
DECLARE
  v_perm_id uuid;
  v_owner_role_id uuid;
  v_super_admin_role_id uuid;
  v_admin_role_id uuid;
BEGIN
  SELECT id INTO v_owner_role_id FROM public.roles WHERE name = 'owner' LIMIT 1;
  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO v_admin_role_id FROM public.roles WHERE name = 'admin' LIMIT 1;

  INSERT INTO public.permissions (name, description, resource, action, module)
  VALUES ('tenant.analytics.read', 'Can view visitor statistics', 'analytics', 'read', 'analytics')
  ON CONFLICT (name) DO UPDATE SET
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    module = EXCLUDED.module
  RETURNING id INTO v_perm_id;

  IF v_perm_id IS NOT NULL THEN
    IF v_owner_role_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role_id = v_owner_role_id AND permission_id = v_perm_id
    ) THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_owner_role_id, v_perm_id);
    END IF;

    IF v_super_admin_role_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role_id = v_super_admin_role_id AND permission_id = v_perm_id
    ) THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_super_admin_role_id, v_perm_id);
    END IF;

    IF v_admin_role_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role_id = v_admin_role_id AND permission_id = v_perm_id
    ) THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_admin_role_id, v_perm_id);
    END IF;
  END IF;
END $$;

INSERT INTO public.resources_registry (key, label, scope, type, db_table, icon, permission_prefix)
VALUES (
  'visitor_stats',
  'Visitor Statistics',
  'tenant',
  'system',
  'analytics_events',
  'LineChart',
  'tenant.analytics'
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  scope = EXCLUDED.scope,
  type = EXCLUDED.type,
  db_table = EXCLUDED.db_table,
  icon = EXCLUDED.icon,
  permission_prefix = EXCLUDED.permission_prefix,
  updated_at = now();

INSERT INTO public.admin_menus (
  key,
  label,
  path,
  icon,
  permission,
  group_label,
  "order",
  group_order,
  is_visible,
  resource_id
) VALUES (
  'visitor_stats',
  'Visitor Statistics',
  'visitor-stats',
  'LineChart',
  'tenant.analytics.read',
  'SYSTEM',
  65,
  60,
  true,
  (SELECT id FROM public.resources_registry WHERE key = 'visitor_stats')
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  path = EXCLUDED.path,
  icon = EXCLUDED.icon,
  permission = EXCLUDED.permission,
  group_label = EXCLUDED.group_label,
  "order" = EXCLUDED."order",
  group_order = EXCLUDED.group_order,
  is_visible = EXCLUDED.is_visible,
  resource_id = EXCLUDED.resource_id;

INSERT INTO public.modules (tenant_id, name, slug, description, status)
SELECT
  id,
  'Visitor Statistics',
  'visitor_stats',
  'Tracks page views, visitors, and referrers.',
  'active'
FROM public.tenants
ON CONFLICT (tenant_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  updated_at = now();
