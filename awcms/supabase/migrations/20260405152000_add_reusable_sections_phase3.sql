SET client_min_messages TO warning;

CREATE TABLE IF NOT EXISTS public.reusable_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  owner_tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  section_mode text NOT NULL DEFAULT 'visual',
  status text NOT NULL DEFAULT 'draft',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_part_id uuid REFERENCES public.template_parts(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT reusable_sections_mode_check CHECK (section_mode IN ('visual', 'template_part_reference')),
  CONSTRAINT reusable_sections_status_check CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS reusable_sections_slug_unique
  ON public.reusable_sections (owner_tenant_id, lower(slug))
  WHERE deleted_at IS NULL;

ALTER TABLE public.reusable_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reusable_sections_select ON public.reusable_sections;
CREATE POLICY reusable_sections_select
ON public.reusable_sections
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

DROP POLICY IF EXISTS reusable_sections_insert ON public.reusable_sections;
CREATE POLICY reusable_sections_insert
ON public.reusable_sections
FOR INSERT TO authenticated
WITH CHECK (
  (
    owner_tenant_id IS NULL
    AND (public.auth_is_admin() OR public.has_permission('platform.template.manage'))
  )
  OR (
    owner_tenant_id = public.current_tenant_id()
    AND public.has_permission('tenant.setting.update')
  )
);

DROP POLICY IF EXISTS reusable_sections_update ON public.reusable_sections;
CREATE POLICY reusable_sections_update
ON public.reusable_sections
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

CREATE INDEX IF NOT EXISTS reusable_sections_owner_status_idx
  ON public.reusable_sections (owner_tenant_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;
