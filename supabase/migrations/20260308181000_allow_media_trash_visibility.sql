BEGIN;

DROP POLICY IF EXISTS media_objects_select_unified ON public.media_objects;

CREATE POLICY media_objects_select_unified
  ON public.media_objects
  FOR SELECT
  TO public
  USING (
    (
      access_control = 'public'
      AND deleted_at IS NULL
      AND status = 'uploaded'
    )
    OR (
      public.is_platform_admin()
      AND (
        deleted_at IS NULL
        OR deleted_at IS NOT NULL
      )
    )
    OR (
      tenant_id = public.current_tenant_id()
      AND deleted_at IS NULL
      AND (
        public.has_permission('tenant.files.read')
        OR public.has_permission('tenant.files.manage')
        OR public.has_permission('tenant.files.update')
        OR public.has_permission('tenant.files.delete')
        OR public.is_admin_or_above()
      )
    )
    OR (
      tenant_id = public.current_tenant_id()
      AND deleted_at IS NOT NULL
      AND (
        public.has_permission('tenant.files.manage')
        OR public.has_permission('tenant.files.delete')
        OR public.has_permission('tenant.files.restore')
        OR public.is_admin_or_above()
      )
    )
  );

COMMIT;
