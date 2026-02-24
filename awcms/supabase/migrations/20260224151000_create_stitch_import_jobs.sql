-- Migration Skeleton: Stitch import audit log table

CREATE TABLE IF NOT EXISTS public.stitch_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  target_editor text NOT NULL CHECK (target_editor IN ('tiptap', 'puck')),
  target_entity text NOT NULL CHECK (target_entity IN ('pages', 'blogs', 'templates', 'template_parts')),
  target_id uuid,
  source text NOT NULL DEFAULT 'stitch',
  source_format text NOT NULL DEFAULT 'html' CHECK (source_format IN ('html', 'json', 'zip', 'figma')),
  import_mode text NOT NULL DEFAULT 'hybrid' CHECK (import_mode IN ('hybrid', 'structured', 'fallback')),
  input_size_bytes integer NOT NULL DEFAULT 0 CHECK (input_size_bytes >= 0),
  input_checksum text,
  payload_preview text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  error_message text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_stitch_import_jobs_tenant_created
  ON public.stitch_import_jobs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stitch_import_jobs_tenant_status
  ON public.stitch_import_jobs (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_stitch_import_jobs_target
  ON public.stitch_import_jobs (tenant_id, target_entity, target_id);

ALTER TABLE public.stitch_import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stitch_import_jobs_select_unified ON public.stitch_import_jobs;
DROP POLICY IF EXISTS stitch_import_jobs_insert_unified ON public.stitch_import_jobs;
DROP POLICY IF EXISTS stitch_import_jobs_update_unified ON public.stitch_import_jobs;
DROP POLICY IF EXISTS stitch_import_jobs_delete_unified ON public.stitch_import_jobs;

CREATE POLICY stitch_import_jobs_select_unified
ON public.stitch_import_jobs
FOR SELECT
USING (
  tenant_id = public.current_tenant_id()
  OR public.is_platform_admin()
);

CREATE POLICY stitch_import_jobs_insert_unified
ON public.stitch_import_jobs
FOR INSERT
WITH CHECK (
  ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above())
  OR public.is_platform_admin()
);

CREATE POLICY stitch_import_jobs_update_unified
ON public.stitch_import_jobs
FOR UPDATE
USING (
  ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above())
  OR public.is_platform_admin()
)
WITH CHECK (
  ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above())
  OR public.is_platform_admin()
);

CREATE POLICY stitch_import_jobs_delete_unified
ON public.stitch_import_jobs
FOR DELETE
USING (
  ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above())
  OR public.is_platform_admin()
);
