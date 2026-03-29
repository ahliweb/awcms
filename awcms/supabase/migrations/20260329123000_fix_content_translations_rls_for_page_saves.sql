-- Align content_translations write policies with tenant-aware content permissions.
-- This fixes page/blog translation upserts that fail under older tenant-only RLS.

drop policy if exists "content_translations_insert_tenant" on public.content_translations;
drop policy if exists "content_translations_update_tenant" on public.content_translations;
drop policy if exists "content_translations_delete_tenant" on public.content_translations;

create policy "content_translations_insert_tenant"
on public.content_translations
for insert
with check (
  (
    tenant_id = public.current_tenant_id()
    or public.tenant_can_access_resource(tenant_id, 'content', 'write')
    or public.is_platform_admin()
  )
  and (
    (content_type = 'page' and (public.has_permission('tenant.page.create') or public.has_permission('tenant.page.update') or public.has_permission('tenant.page.publish') or public.is_platform_admin()))
    or
    (content_type in ('blog', 'article') and (public.has_permission('tenant.blog.create') or public.has_permission('tenant.blog.update') or public.has_permission('tenant.blog.publish') or public.is_platform_admin()))
  )
);

create policy "content_translations_update_tenant"
on public.content_translations
for update
using (
  (
    tenant_id = public.current_tenant_id()
    or public.tenant_can_access_resource(tenant_id, 'content', 'write')
    or public.is_platform_admin()
  )
  and (
    (content_type = 'page' and (public.has_permission('tenant.page.update') or public.has_permission('tenant.page.publish') or public.is_platform_admin()))
    or
    (content_type in ('blog', 'article') and (public.has_permission('tenant.blog.update') or public.has_permission('tenant.blog.publish') or public.is_platform_admin()))
  )
)
with check (
  (
    tenant_id = public.current_tenant_id()
    or public.tenant_can_access_resource(tenant_id, 'content', 'write')
    or public.is_platform_admin()
  )
  and (
    (content_type = 'page' and (public.has_permission('tenant.page.update') or public.has_permission('tenant.page.publish') or public.is_platform_admin()))
    or
    (content_type in ('blog', 'article') and (public.has_permission('tenant.blog.update') or public.has_permission('tenant.blog.publish') or public.is_platform_admin()))
  )
);

create policy "content_translations_delete_tenant"
on public.content_translations
for delete
using (
  (
    tenant_id = public.current_tenant_id()
    or public.tenant_can_access_resource(tenant_id, 'content', 'write')
    or public.is_platform_admin()
  )
  and (
    (content_type = 'page' and (public.has_permission('tenant.page.update') or public.has_permission('tenant.page.delete') or public.is_platform_admin()))
    or
    (content_type in ('blog', 'article') and (public.has_permission('tenant.blog.update') or public.has_permission('tenant.blog.delete') or public.is_platform_admin()))
  )
);
