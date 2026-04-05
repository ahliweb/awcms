SET client_min_messages TO warning;

CREATE TABLE IF NOT EXISTS public.reusable_section_detach_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reusable_section_id uuid NOT NULL REFERENCES public.reusable_sections(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_label text,
  locale text,
  usage_path text NOT NULL,
  detached_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  detached_at timestamptz NOT NULL DEFAULT now(),
  relinked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT reusable_section_detach_events_source_type_check CHECK (source_type IN ('page', 'template', 'template_part', 'content_translation')),
  CONSTRAINT reusable_section_detach_events_status_check CHECK (status IN ('pending', 'relinked', 'expired'))
);

CREATE INDEX IF NOT EXISTS reusable_section_detach_events_section_idx
  ON public.reusable_section_detach_events (reusable_section_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS reusable_section_detach_events_source_idx
  ON public.reusable_section_detach_events (source_type, source_id, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.reusable_section_detach_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reusable_section_detach_events_select ON public.reusable_section_detach_events;
CREATE POLICY reusable_section_detach_events_select
ON public.reusable_section_detach_events
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    tenant_id = public.current_tenant_id()
    OR public.auth_is_admin()
    OR public.has_permission('platform.template.manage')
    OR public.has_permission('tenant.setting.read')
  )
);

DROP POLICY IF EXISTS reusable_section_detach_events_insert ON public.reusable_section_detach_events;
CREATE POLICY reusable_section_detach_events_insert
ON public.reusable_section_detach_events
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  OR public.auth_is_admin()
  OR public.has_permission('platform.template.manage')
  OR public.has_permission('tenant.setting.update')
);

DROP POLICY IF EXISTS reusable_section_detach_events_update ON public.reusable_section_detach_events;
CREATE POLICY reusable_section_detach_events_update
ON public.reusable_section_detach_events
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

DROP POLICY IF EXISTS reusable_section_detach_events_delete ON public.reusable_section_detach_events;
CREATE POLICY reusable_section_detach_events_delete
ON public.reusable_section_detach_events
FOR DELETE TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  OR public.auth_is_admin()
  OR public.has_permission('platform.template.manage')
  OR public.has_permission('tenant.setting.update')
);
