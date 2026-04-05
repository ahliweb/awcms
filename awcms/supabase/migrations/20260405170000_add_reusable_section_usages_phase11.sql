SET client_min_messages TO warning;

CREATE TABLE IF NOT EXISTS public.reusable_section_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reusable_section_id uuid NOT NULL REFERENCES public.reusable_sections(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_label text,
  locale text,
  usage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT reusable_section_usages_source_type_check CHECK (source_type IN ('page', 'template', 'template_part', 'content_translation'))
);

CREATE UNIQUE INDEX IF NOT EXISTS reusable_section_usages_unique
  ON public.reusable_section_usages (reusable_section_id, source_type, source_id, COALESCE(locale, ''), COALESCE(usage_path, ''))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS reusable_section_usages_section_idx
  ON public.reusable_section_usages (reusable_section_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS reusable_section_usages_source_idx
  ON public.reusable_section_usages (source_type, source_id, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.reusable_section_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reusable_section_usages_select ON public.reusable_section_usages;
CREATE POLICY reusable_section_usages_select
ON public.reusable_section_usages
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    tenant_id = public.current_tenant_id()
    OR public.auth_is_admin()
    OR public.has_permission('platform.template.manage')
    OR public.has_permission('tenant.setting.read')
  )
);

DROP POLICY IF EXISTS reusable_section_usages_insert ON public.reusable_section_usages;
CREATE POLICY reusable_section_usages_insert
ON public.reusable_section_usages
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  OR public.auth_is_admin()
  OR public.has_permission('platform.template.manage')
  OR public.has_permission('tenant.setting.update')
);

DROP POLICY IF EXISTS reusable_section_usages_update ON public.reusable_section_usages;
CREATE POLICY reusable_section_usages_update
ON public.reusable_section_usages
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

DROP POLICY IF EXISTS reusable_section_usages_delete ON public.reusable_section_usages;
CREATE POLICY reusable_section_usages_delete
ON public.reusable_section_usages
FOR DELETE TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  OR public.auth_is_admin()
  OR public.has_permission('platform.template.manage')
  OR public.has_permission('tenant.setting.update')
);
