SET client_min_messages TO warning;

DROP POLICY IF EXISTS "tenant_extensions_insert" ON public.tenant_extensions;
CREATE POLICY "tenant_extensions_insert"
ON public.tenant_extensions
FOR INSERT
TO authenticated
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.has_permission('tenant.setting.update'))
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
    AND (SELECT public.has_permission('tenant.setting.update'))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
)
WITH CHECK (
  (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.has_permission('tenant.setting.update'))
  )
  OR (SELECT public.auth_is_admin())
  OR (SELECT public.has_permission('platform.extensions.update'))
  OR (SELECT public.has_permission('platform.extensions.manage'))
);
