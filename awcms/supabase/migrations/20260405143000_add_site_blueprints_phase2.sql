SET client_min_messages TO warning;

CREATE TABLE IF NOT EXISTS public.site_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'draft',
  owner_tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_blueprint_id uuid REFERENCES public.site_blueprints(id) ON DELETE SET NULL,
  blueprint_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT site_blueprints_status_check CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS site_blueprints_slug_unique
  ON public.site_blueprints (owner_tenant_id, lower(slug))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.tenant_site_blueprint_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  blueprint_id uuid NOT NULL REFERENCES public.site_blueprints(id) ON DELETE RESTRICT,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT tenant_site_blueprint_state_tenant_unique UNIQUE (tenant_id)
);

ALTER TABLE public.site_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_site_blueprint_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_blueprints_select ON public.site_blueprints;
CREATE POLICY site_blueprints_select
ON public.site_blueprints
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    owner_tenant_id IS NULL
    OR owner_tenant_id = public.current_tenant_id()
    OR public.auth_is_admin()
    OR public.has_permission('platform.template.manage')
    OR public.has_permission('tenant.setting.read')
  )
);

DROP POLICY IF EXISTS site_blueprints_insert ON public.site_blueprints;
CREATE POLICY site_blueprints_insert
ON public.site_blueprints
FOR INSERT TO authenticated
WITH CHECK (
  (
    owner_tenant_id IS NULL
    AND (
      public.auth_is_admin()
      OR public.has_permission('platform.template.manage')
    )
  )
  OR (
    owner_tenant_id = public.current_tenant_id()
    AND public.has_permission('tenant.setting.update')
  )
);

DROP POLICY IF EXISTS site_blueprints_update ON public.site_blueprints;
CREATE POLICY site_blueprints_update
ON public.site_blueprints
FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL AND (
    (owner_tenant_id IS NULL AND (public.auth_is_admin() OR public.has_permission('platform.template.manage')))
    OR (owner_tenant_id = public.current_tenant_id() AND public.has_permission('tenant.setting.update'))
  )
)
WITH CHECK (
  (owner_tenant_id IS NULL AND (public.auth_is_admin() OR public.has_permission('platform.template.manage')))
  OR (owner_tenant_id = public.current_tenant_id() AND public.has_permission('tenant.setting.update'))
);

DROP POLICY IF EXISTS tenant_site_blueprint_state_select ON public.tenant_site_blueprint_state;
CREATE POLICY tenant_site_blueprint_state_select
ON public.tenant_site_blueprint_state
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    tenant_id = public.current_tenant_id()
    OR public.auth_is_admin()
    OR public.has_permission('platform.template.manage')
    OR public.has_permission('tenant.setting.read')
  )
);

DROP POLICY IF EXISTS tenant_site_blueprint_state_insert ON public.tenant_site_blueprint_state;
CREATE POLICY tenant_site_blueprint_state_insert
ON public.tenant_site_blueprint_state
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  OR public.auth_is_admin()
  OR public.has_permission('platform.template.manage')
  OR public.has_permission('tenant.setting.update')
);

DROP POLICY IF EXISTS tenant_site_blueprint_state_update ON public.tenant_site_blueprint_state;
CREATE POLICY tenant_site_blueprint_state_update
ON public.tenant_site_blueprint_state
FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL AND (
    tenant_id = public.current_tenant_id()
    OR public.auth_is_admin()
    OR public.has_permission('platform.template.manage')
    OR public.has_permission('tenant.setting.update')
  )
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  OR public.auth_is_admin()
  OR public.has_permission('platform.template.manage')
  OR public.has_permission('tenant.setting.update')
);

CREATE INDEX IF NOT EXISTS site_blueprints_owner_status_idx
  ON public.site_blueprints (owner_tenant_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_site_blueprint_state_tenant_idx
  ON public.tenant_site_blueprint_state (tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;
