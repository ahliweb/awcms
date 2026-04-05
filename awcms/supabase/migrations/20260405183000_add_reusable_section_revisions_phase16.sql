SET client_min_messages TO warning;

CREATE TABLE IF NOT EXISTS public.reusable_section_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  reusable_section_id uuid NOT NULL REFERENCES public.reusable_sections(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT reusable_section_revisions_number_check CHECK (revision_number > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS reusable_section_revisions_unique
  ON public.reusable_section_revisions (reusable_section_id, revision_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS reusable_section_revisions_section_idx
  ON public.reusable_section_revisions (reusable_section_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.reusable_section_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reusable_section_revisions_select ON public.reusable_section_revisions;
CREATE POLICY reusable_section_revisions_select
ON public.reusable_section_revisions
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    tenant_id = public.current_tenant_id()
    OR public.auth_is_admin()
    OR public.has_permission('platform.template.manage')
    OR public.has_permission('tenant.setting.read')
  )
);

DROP POLICY IF EXISTS reusable_section_revisions_insert ON public.reusable_section_revisions;
CREATE POLICY reusable_section_revisions_insert
ON public.reusable_section_revisions
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  OR tenant_id IS NULL
  OR public.auth_is_admin()
  OR public.has_permission('platform.template.manage')
  OR public.has_permission('tenant.setting.update')
);
