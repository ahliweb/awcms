SET client_min_messages TO warning;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security = off
AS $function$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_requested_tenant text;
  v_override_tenant_id uuid;
BEGIN
  BEGIN
    v_requested_tenant := NULLIF(current_setting('app.current_tenant_id', true), '');
  EXCEPTION WHEN OTHERS THEN
    v_requested_tenant := NULL;
  END;

  IF v_requested_tenant IS NULL THEN
    BEGIN
      v_requested_tenant := current_setting('request.headers', true)::json->>'x-tenant-id';
    EXCEPTION WHEN OTHERS THEN
      v_requested_tenant := NULL;
    END;
  END IF;

  IF v_requested_tenant ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_override_tenant_id := v_requested_tenant::uuid;
  END IF;

  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN v_override_tenant_id;
  END IF;

  IF v_override_tenant_id IS NOT NULL AND public.auth_is_admin() THEN
    SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE id = v_override_tenant_id
      AND deleted_at IS NULL
      AND status IN ('active', 'migrating')
    LIMIT 1;

    IF v_tenant_id IS NOT NULL THEN
      RETURN v_tenant_id;
    END IF;
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.users
  WHERE id = v_user_id
    AND deleted_at IS NULL;

  RETURN v_tenant_id;
END;
$function$;

WITH selected_project AS (
  SELECT id
  FROM public.platform_projects
  WHERE status = 'active'
  ORDER BY created_at ASC
  LIMIT 1
), selected_cell AS (
  SELECT id, project_id
  FROM public.deployment_cells
  WHERE status = 'active'
  ORDER BY created_at ASC
  LIMIT 1
), tenant_seed AS (
  SELECT t.id, t.slug, t.name, t.status, t.domain, COALESCE(NULLIF(t.host, ''), NULLIF(t.domain, ''), t.slug) AS preferred_host
  FROM public.tenants t
  WHERE t.deleted_at IS NULL
    AND t.slug IN ('primary', 'smandapbun')
)
INSERT INTO public.tenants_control (
  id,
  project_id,
  tenant_code,
  display_name,
  status,
  current_cell_id
)
SELECT ts.id, sc.project_id, ts.slug, ts.name, ts.status, sc.id
FROM tenant_seed ts
CROSS JOIN selected_cell sc
ON CONFLICT (id) DO UPDATE SET
  tenant_code = EXCLUDED.tenant_code,
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  current_cell_id = EXCLUDED.current_cell_id;

WITH selected_cell AS (
  SELECT id
  FROM public.deployment_cells
  WHERE status = 'active'
  ORDER BY created_at ASC
  LIMIT 1
), domain_seed AS (
  SELECT t.id AS tenant_id,
         sc.id AS cell_id,
         CASE
           WHEN t.slug = 'primary' THEN COALESCE(NULLIF(t.host, ''), 'primary.localhost')
           ELSE COALESCE(NULLIF(t.domain, ''), NULLIF(t.host, ''), CONCAT(t.slug, '.localhost'))
         END AS hostname,
         true AS is_primary
  FROM public.tenants t
  CROSS JOIN selected_cell sc
  WHERE t.deleted_at IS NULL
    AND t.slug IN ('primary', 'smandapbun')
)
INSERT INTO public.tenant_domains (
  tenant_id,
  cell_id,
  hostname,
  domain_kind,
  is_primary,
  verification_status,
  active_from
)
SELECT tenant_id, cell_id, hostname, 'platform_subdomain', is_primary, 'verified', now()
FROM domain_seed
ON CONFLICT (hostname) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  cell_id = EXCLUDED.cell_id,
  domain_kind = EXCLUDED.domain_kind,
  is_primary = EXCLUDED.is_primary,
  verification_status = EXCLUDED.verification_status;

UPDATE public.tenants_control tc
SET primary_domain_id = td.id
FROM public.tenant_domains td
WHERE td.tenant_id = tc.id
  AND td.is_primary = true
  AND tc.id IN (
    SELECT id FROM public.tenants WHERE deleted_at IS NULL AND slug IN ('primary', 'smandapbun')
  );

WITH channel_seed AS (
  SELECT t.id AS tenant_id,
         'web_public'::text AS channel,
         CASE
           WHEN t.slug = 'primary' THEN COALESCE(NULLIF(t.domain, ''), 'primary')
           ELSE COALESCE(NULLIF(t.domain, ''), t.slug)
         END AS domain,
         CONCAT('/awcms-public/', t.slug, '/') AS base_path
  FROM public.tenants t
  WHERE t.deleted_at IS NULL
    AND t.slug IN ('primary', 'smandapbun')
)
INSERT INTO public.tenant_channels (
  tenant_id,
  channel,
  domain,
  base_path,
  is_primary,
  is_active
)
SELECT tenant_id, channel, domain, base_path, true, true
FROM channel_seed
ON CONFLICT (tenant_id, channel, is_primary) DO UPDATE SET
  domain = EXCLUDED.domain,
  base_path = EXCLUDED.base_path,
  is_primary = EXCLUDED.is_primary,
  is_active = EXCLUDED.is_active,
  updated_at = now();

WITH permission_seed(name, resource, action, description) AS (
  VALUES
    ('tenant.blog.read', 'blogs', 'read', 'Read tenant blogs'),
    ('tenant.blog.create', 'blogs', 'create', 'Create tenant blogs'),
    ('tenant.blog.update', 'blogs', 'update', 'Update tenant blogs'),
    ('tenant.blog.delete', 'blogs', 'delete', 'Soft delete tenant blogs'),
    ('tenant.blog.restore', 'blogs', 'restore', 'Restore tenant blogs'),
    ('tenant.blog.permanent_delete', 'blogs', 'permanent_delete', 'Permanently delete tenant blogs'),
    ('tenant.blog.publish', 'blogs', 'publish', 'Publish tenant blogs'),
    ('tenant.page.read', 'pages', 'read', 'Read tenant pages'),
    ('tenant.page.create', 'pages', 'create', 'Create tenant pages'),
    ('tenant.page.update', 'pages', 'update', 'Update tenant pages'),
    ('tenant.page.delete', 'pages', 'delete', 'Soft delete tenant pages'),
    ('tenant.page.restore', 'pages', 'restore', 'Restore tenant pages'),
    ('tenant.page.permanent_delete', 'pages', 'permanent_delete', 'Permanently delete tenant pages'),
    ('tenant.page.publish', 'pages', 'publish', 'Publish tenant pages'),
    ('tenant.visual_pages.read', 'visual_pages', 'read', 'Read visual pages'),
    ('tenant.visual_pages.create', 'visual_pages', 'create', 'Create visual pages'),
    ('tenant.visual_pages.update', 'visual_pages', 'update', 'Update visual pages'),
    ('tenant.visual_pages.delete', 'visual_pages', 'delete', 'Delete visual pages'),
    ('tenant.portfolio.read', 'portfolio', 'read', 'Read portfolio content'),
    ('tenant.portfolio.create', 'portfolio', 'create', 'Create portfolio content'),
    ('tenant.portfolio.update', 'portfolio', 'update', 'Update portfolio content'),
    ('tenant.portfolio.delete', 'portfolio', 'delete', 'Delete portfolio content'),
    ('tenant.testimonies.read', 'testimonials', 'read', 'Read testimonials'),
    ('tenant.testimonies.create', 'testimonials', 'create', 'Create testimonials'),
    ('tenant.testimonies.update', 'testimonials', 'update', 'Update testimonials'),
    ('tenant.testimonies.delete', 'testimonials', 'delete', 'Delete testimonials'),
    ('tenant.announcements.read', 'announcements', 'read', 'Read announcements'),
    ('tenant.announcements.create', 'announcements', 'create', 'Create announcements'),
    ('tenant.announcements.update', 'announcements', 'update', 'Update announcements'),
    ('tenant.announcements.delete', 'announcements', 'delete', 'Delete announcements'),
    ('tenant.promotions.read', 'promotions', 'read', 'Read promotions'),
    ('tenant.promotions.create', 'promotions', 'create', 'Create promotions'),
    ('tenant.promotions.update', 'promotions', 'update', 'Update promotions'),
    ('tenant.promotions.delete', 'promotions', 'delete', 'Delete promotions'),
    ('tenant.files.read', 'files', 'read', 'Read media files'),
    ('tenant.files.create', 'files', 'create', 'Create media files'),
    ('tenant.files.update', 'files', 'update', 'Update media files'),
    ('tenant.files.delete', 'files', 'delete', 'Delete media files'),
    ('tenant.files.manage', 'files', 'manage', 'Manage media files'),
    ('tenant.files.restore', 'files', 'restore', 'Restore media files'),
    ('tenant.menu.read', 'menus', 'read', 'Read menus'),
    ('tenant.menu.create', 'menus', 'create', 'Create menus'),
    ('tenant.menu.update', 'menus', 'update', 'Update menus'),
    ('tenant.menu.delete', 'menus', 'delete', 'Delete menus'),
    ('tenant.categories.read', 'categories', 'read', 'Read categories'),
    ('tenant.categories.create', 'categories', 'create', 'Create categories'),
    ('tenant.categories.update', 'categories', 'update', 'Update categories'),
    ('tenant.categories.delete', 'categories', 'delete', 'Delete categories'),
    ('tenant.categories.restore', 'categories', 'restore', 'Restore categories'),
    ('tenant.categories.permanent_delete', 'categories', 'permanent_delete', 'Permanently delete categories'),
    ('tenant.tag.read', 'tags', 'read', 'Read tags'),
    ('tenant.tag.create', 'tags', 'create', 'Create tags'),
    ('tenant.tag.update', 'tags', 'update', 'Update tags'),
    ('tenant.tag.delete', 'tags', 'delete', 'Delete tags'),
    ('tenant.tag.restore', 'tags', 'restore', 'Restore tags'),
    ('tenant.tag.permanent_delete', 'tags', 'permanent_delete', 'Permanently delete tags'),
    ('tenant.user.read', 'users', 'read', 'Read users'),
    ('tenant.user.create', 'users', 'create', 'Create users'),
    ('tenant.user.delete', 'users', 'delete', 'Delete users'),
    ('tenant.notification.read', 'notifications', 'read', 'Read notifications'),
    ('tenant.notification.create', 'notifications', 'create', 'Create notifications'),
    ('tenant.notification.update', 'notifications', 'update', 'Update notifications'),
    ('tenant.notification.delete', 'notifications', 'delete', 'Delete notifications'),
    ('tenant.contacts.read', 'contacts', 'read', 'Read contacts'),
    ('tenant.contacts.create', 'contacts', 'create', 'Create contacts'),
    ('tenant.contacts.update', 'contacts', 'update', 'Update contacts'),
    ('tenant.contacts.delete', 'contacts', 'delete', 'Delete contacts'),
    ('tenant.contact_messages.read', 'contact_messages', 'read', 'Read contact messages'),
    ('tenant.contact_messages.create', 'contact_messages', 'create', 'Create contact messages'),
    ('tenant.contact_messages.update', 'contact_messages', 'update', 'Update contact messages'),
    ('tenant.contact_messages.delete', 'contact_messages', 'delete', 'Delete contact messages'),
    ('tenant.products.read', 'products', 'read', 'Read products'),
    ('tenant.products.create', 'products', 'create', 'Create products'),
    ('tenant.products.update', 'products', 'update', 'Update products'),
    ('tenant.products.delete', 'products', 'delete', 'Delete products'),
    ('tenant.product_types.read', 'product_types', 'read', 'Read product types'),
    ('tenant.product_types.create', 'product_types', 'create', 'Create product types'),
    ('tenant.product_types.update', 'product_types', 'update', 'Update product types'),
    ('tenant.product_types.delete', 'product_types', 'delete', 'Delete product types'),
    ('tenant.theme.read', 'themes', 'read', 'Read themes'),
    ('tenant.theme.create', 'themes', 'create', 'Create themes'),
    ('tenant.theme.update', 'themes', 'update', 'Update themes'),
    ('tenant.theme.delete', 'themes', 'delete', 'Delete themes'),
    ('tenant.widgets.read', 'widgets', 'read', 'Read widgets'),
    ('tenant.widgets.create', 'widgets', 'create', 'Create widgets'),
    ('tenant.widgets.update', 'widgets', 'update', 'Update widgets'),
    ('tenant.widgets.delete', 'widgets', 'delete', 'Delete widgets'),
    ('tenant.audit.read', 'audit_logs', 'read', 'Read audit logs'),
    ('tenant.languages.read', 'languages', 'read', 'Read languages'),
    ('tenant.languages.update', 'languages', 'update', 'Update languages'),
    ('tenant.mobile.read', 'mobile_config', 'read', 'Read mobile configuration'),
    ('tenant.mobile.update', 'mobile_config', 'update', 'Update mobile configuration'),
    ('tenant.seo.read', 'seo_manager', 'read', 'Read SEO settings'),
    ('tenant.seo.update', 'seo_manager', 'update', 'Update SEO settings'),
    ('tenant.sso.read', 'sso', 'read', 'Read SSO settings'),
    ('tenant.sso.update', 'sso', 'update', 'Update SSO settings')
)
INSERT INTO public.permissions (name, resource, action, description, deleted_at)
SELECT name, resource, action, description, NULL
FROM permission_seed
ON CONFLICT (name) DO UPDATE SET
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  deleted_at = NULL;

WITH tenant_roles AS (
  SELECT id, tenant_id, name, COALESCE(staff_level, 0) AS staff_level, is_tenant_admin
  FROM public.roles
  WHERE deleted_at IS NULL
    AND tenant_id IS NOT NULL
), role_permission_seed AS (
  SELECT tr.id AS role_id, p.id AS permission_id
  FROM tenant_roles tr
  JOIN public.permissions p ON p.deleted_at IS NULL
  WHERE (
    tr.is_tenant_admin = true
    AND p.name LIKE 'tenant.%'
  ) OR (
    tr.name IN ('editor', 'manager', 'senior_manager', 'super_manager', 'supervisor', 'senior_supervisor')
    AND p.name IN (
      'tenant.analytics.read', 'tenant.audit.read',
      'tenant.blog.read', 'tenant.blog.create', 'tenant.blog.update', 'tenant.blog.delete', 'tenant.blog.publish',
      'tenant.page.read', 'tenant.page.create', 'tenant.page.update', 'tenant.page.delete', 'tenant.page.publish',
      'tenant.visual_pages.read', 'tenant.visual_pages.create', 'tenant.visual_pages.update', 'tenant.visual_pages.delete',
      'tenant.portfolio.read', 'tenant.portfolio.create', 'tenant.portfolio.update', 'tenant.portfolio.delete',
      'tenant.testimonies.read', 'tenant.testimonies.create', 'tenant.testimonies.update', 'tenant.testimonies.delete',
      'tenant.announcements.read', 'tenant.announcements.create', 'tenant.announcements.update', 'tenant.announcements.delete',
      'tenant.promotions.read', 'tenant.promotions.create', 'tenant.promotions.update', 'tenant.promotions.delete',
      'tenant.files.read', 'tenant.files.create', 'tenant.files.update', 'tenant.files.delete', 'tenant.files.manage',
      'tenant.menu.read', 'tenant.menu.create', 'tenant.menu.update',
      'tenant.categories.read', 'tenant.categories.create', 'tenant.categories.update',
      'tenant.tag.read', 'tenant.tag.create', 'tenant.tag.update',
      'tenant.contacts.read', 'tenant.contacts.create', 'tenant.contacts.update',
      'tenant.contact_messages.read', 'tenant.contact_messages.update',
      'tenant.notification.read', 'tenant.notification.create', 'tenant.notification.update', 'tenant.notification.delete',
      'tenant.products.read', 'tenant.product_types.read', 'tenant.orders.read',
      'tenant.school_pages.read', 'tenant.school_pages.update',
      'tenant.setting.read', 'tenant.setting.update',
      'tenant.languages.read', 'tenant.languages.update',
      'tenant.seo.read', 'tenant.seo.update',
      'tenant.sso.read', 'tenant.sso.update',
      'tenant.mobile.read', 'tenant.mobile.update',
      'tenant.mobile_users.read', 'tenant.push_notifications.read', 'tenant.push_notifications.create', 'tenant.push_notifications.update',
      'tenant.iot.read', 'tenant.iot.create', 'tenant.iot.update',
      'tenant.role.read', 'tenant.policy.read', 'tenant.user.read', 'tenant.user.update',
      'tenant.events.read', 'tenant.events.create', 'tenant.events.update', 'tenant.events.publish', 'tenant.modules.read'
    )
  ) OR (
    tr.name IN ('author', 'assistant', 'associate', 'specialist', 'senior_specialist')
    AND p.name IN (
      'tenant.analytics.read',
      'tenant.blog.read', 'tenant.blog.create', 'tenant.blog.update',
      'tenant.page.read', 'tenant.page.create', 'tenant.page.update',
      'tenant.visual_pages.read', 'tenant.visual_pages.create', 'tenant.visual_pages.update',
      'tenant.portfolio.read', 'tenant.portfolio.create', 'tenant.portfolio.update',
      'tenant.testimonies.read', 'tenant.testimonies.create', 'tenant.testimonies.update',
      'tenant.announcements.read', 'tenant.announcements.create', 'tenant.announcements.update',
      'tenant.promotions.read', 'tenant.promotions.create', 'tenant.promotions.update',
      'tenant.files.read', 'tenant.files.create', 'tenant.files.update',
      'tenant.menu.read',
      'tenant.categories.read', 'tenant.tag.read',
      'tenant.contacts.read', 'tenant.contact_messages.read', 'tenant.contact_messages.create',
      'tenant.notification.read',
      'tenant.products.read', 'tenant.product_types.read', 'tenant.orders.read',
      'tenant.school_pages.read', 'tenant.setting.read', 'tenant.languages.read',
      'tenant.mobile.read', 'tenant.mobile_users.read', 'tenant.push_notifications.read',
      'tenant.iot.read', 'tenant.events.read', 'tenant.events.create', 'tenant.events.update', 'tenant.modules.read'
    )
  ) OR (
    tr.name = 'internship'
    AND p.name IN (
      'tenant.blog.read', 'tenant.page.read', 'tenant.announcements.read', 'tenant.promotions.read',
      'tenant.files.read', 'tenant.menu.read', 'tenant.categories.read', 'tenant.tag.read',
      'tenant.contacts.read', 'tenant.contact_messages.read', 'tenant.notification.read',
      'tenant.school_pages.read', 'tenant.languages.read', 'tenant.analytics.read',
      'tenant.events.read', 'tenant.modules.read'
    )
  )
)
INSERT INTO public.role_permissions (role_id, permission_id, tenant_id, deleted_at)
SELECT rps.role_id, rps.permission_id, tr.tenant_id, NULL
FROM role_permission_seed rps
JOIN tenant_roles tr ON tr.id = rps.role_id
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  deleted_at = NULL,
  tenant_id = EXCLUDED.tenant_id;
