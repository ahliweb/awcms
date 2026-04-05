SET client_min_messages TO warning;

CREATE TABLE IF NOT EXISTS public.reusable_section_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reusable_section_id uuid NOT NULL REFERENCES public.reusable_sections(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT reusable_section_action_requests_action_type_check CHECK (action_type IN ('detach_all', 'relink_all', 'update_linked')),
  CONSTRAINT reusable_section_action_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'completed'))
);

CREATE INDEX IF NOT EXISTS reusable_section_action_requests_section_idx
  ON public.reusable_section_action_requests (reusable_section_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS reusable_section_action_requests_status_idx
  ON public.reusable_section_action_requests (tenant_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.reusable_section_action_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reusable_section_action_requests_select ON public.reusable_section_action_requests;
CREATE POLICY reusable_section_action_requests_select
ON public.reusable_section_action_requests
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    tenant_id = public.current_tenant_id()
    OR public.auth_is_admin()
    OR public.has_permission('platform.approvals.read')
    OR public.has_permission('platform.template.manage')
    OR public.has_permission('tenant.setting.read')
  )
);

DROP POLICY IF EXISTS reusable_section_action_requests_insert ON public.reusable_section_action_requests;
CREATE POLICY reusable_section_action_requests_insert
ON public.reusable_section_action_requests
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  OR public.auth_is_admin()
  OR public.has_permission('platform.template.manage')
  OR public.has_permission('tenant.setting.update')
);

DROP POLICY IF EXISTS reusable_section_action_requests_update ON public.reusable_section_action_requests;
CREATE POLICY reusable_section_action_requests_update
ON public.reusable_section_action_requests
FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL AND (
    public.auth_is_admin()
    OR public.has_permission('platform.approvals.read')
    OR public.has_permission('platform.template.manage')
  )
)
WITH CHECK (
  public.auth_is_admin()
  OR public.has_permission('platform.approvals.read')
  OR public.has_permission('platform.template.manage')
);
