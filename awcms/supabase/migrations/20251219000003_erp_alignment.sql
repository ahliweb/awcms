-- Migration: ERP Alignment (Roles, Permissions, Menus)
-- Generated based on docs/ABAC_SYSTEM.md and ERP Architecture

-- 1. Ensure Roles Exist
INSERT INTO public.roles (name, description, is_system) VALUES
('owner', 'System Owner - Supreme Authority', true),
('author', 'Content Creator', true),
('member', 'Registered User', true),
('subscriber', 'Premium User', true)
ON CONFLICT (name) DO NOTHING;

-- 2. Define New Permissions (Granular)
DO $$
DECLARE
  perm text;
  perms text[] := ARRAY[
    -- Platform Scope
    'platform.tenant.create', 'platform.tenant.read', 'platform.tenant.update', 'platform.tenant.delete', 'platform.tenant.restore', 'platform.tenant.delete_permanent',
    'platform.setting.read', 'platform.setting.update',
    'platform.module.create', 'platform.module.read', 'platform.module.update',
    'platform.billing.read', 'platform.billing.update',
    'platform.user.create', 'platform.user.read', 'platform.user.update', 'platform.user.delete', 'platform.user.restore', 'platform.user.delete_permanent',

    -- Tenant Scope
    'tenant.post.create', 'tenant.post.read', 'tenant.post.update', 'tenant.post.publish', 'tenant.post.delete', 'tenant.post.restore', 'tenant.post.delete_permanent',
    'tenant.page.create', 'tenant.page.read', 'tenant.page.update', 'tenant.page.publish', 'tenant.page.delete', 'tenant.page.restore', 'tenant.page.delete_permanent',
    'tenant.media.create', 'tenant.media.read', 'tenant.media.update', 'tenant.media.delete', 'tenant.media.restore', 'tenant.media.delete_permanent',
    'tenant.user.create', 'tenant.user.read', 'tenant.user.update', 'tenant.user.publish', 'tenant.user.delete', 'tenant.user.restore',
    'tenant.setting.read', 'tenant.setting.update',
    'tenant.profile.read', 'tenant.profile.update',
    'tenant.theme.manage', -- Added for ThemesManager legacy mapping

    -- Public/Consumption Scope
    'content.read', 'content.comment', 'content.like'
  ];
BEGIN
  FOREACH perm IN ARRAY perms LOOP
    INSERT INTO public.permissions (name, description, module, resource, action)
    VALUES (
      perm, 
      'ERP Standard Permission', 
      split_part(perm, '.', 1), 
      split_part(perm, '.', 1), 
      split_part(perm, '.', array_length(string_to_array(perm, '.'), 1))
    )
    ON CONFLICT (name) DO UPDATE SET
        module = EXCLUDED.module,
        resource = EXCLUDED.resource,
        action = EXCLUDED.action;
  END LOOP;
END;
$$;

-- 3. Map Roles to Permissions
CREATE OR REPLACE FUNCTION grant_perm(role_name text, perm_keys text[]) RETURNS void AS $$
DECLARE
  r_id uuid;
  p_key text;
  p_id uuid;
BEGIN
  SELECT id INTO r_id FROM roles WHERE name = role_name;
  IF r_id IS NOT NULL THEN
    FOREACH p_key IN ARRAY perm_keys LOOP
        SELECT id INTO p_id FROM permissions WHERE name = p_key; -- Changed from key to name to match schema
        IF p_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id) VALUES (r_id, p_id) ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    -- OWNER: Platform.* (Limited), Tenant.* (All), Content.*
    PERFORM grant_perm('owner', ARRAY[
        'platform.tenant.create', 'platform.tenant.read', 'platform.tenant.update', 'platform.tenant.delete', 'platform.tenant.restore', 'platform.tenant.delete_permanent',
        'platform.module.create', 'platform.module.read', 'platform.module.update',
        'platform.user.create', 'platform.user.read', 'platform.user.update', 'platform.user.delete', 'platform.user.restore', 'platform.user.delete_permanent',
        'tenant.post.create', 'tenant.post.read', 'tenant.post.update', 'tenant.post.publish', 'tenant.post.delete', 'tenant.post.restore', 'tenant.post.delete_permanent',
        'tenant.page.create', 'tenant.page.read', 'tenant.page.update', 'tenant.page.publish', 'tenant.page.delete', 'tenant.page.restore', 'tenant.page.delete_permanent',
        'tenant.media.create', 'tenant.media.read', 'tenant.media.update', 'tenant.media.delete', 'tenant.media.restore', 'tenant.media.delete_permanent',
        'tenant.user.create', 'tenant.user.read', 'tenant.user.update', 'tenant.user.publish', 'tenant.user.delete', 'tenant.user.restore',
        'tenant.setting.read', 'tenant.setting.update',
        'tenant.theme.manage',
        'content.read', 'content.comment', 'content.like'
    ]);

    -- SUPER ADMIN: Platform.* (Subset), Tenant.* (All)
    PERFORM grant_perm('super_admin', ARRAY[
        'platform.tenant.create', 'platform.tenant.read', 'platform.tenant.update', 'platform.tenant.delete', 'platform.tenant.restore', 'platform.tenant.delete_permanent',
        'platform.module.create', 'platform.module.read', 'platform.module.update',
        'tenant.post.create', 'tenant.post.read', 'tenant.post.update', 'tenant.post.publish', 'tenant.post.delete', 'tenant.post.restore', 'tenant.post.delete_permanent',
        'tenant.page.create', 'tenant.page.read', 'tenant.page.update', 'tenant.page.publish', 'tenant.page.delete', 'tenant.page.restore', 'tenant.page.delete_permanent',
        'tenant.media.create', 'tenant.media.read', 'tenant.media.update', 'tenant.media.delete', 'tenant.media.restore', 'tenant.media.delete_permanent',
        'tenant.user.create', 'tenant.user.read', 'tenant.user.update', 'tenant.user.publish', 'tenant.user.delete', 'tenant.user.restore',
        'tenant.setting.read', 'tenant.setting.update',
        'tenant.theme.manage',
        'content.read', 'content.comment', 'content.like'
    ]);

    -- ADMIN (Tenant): Tenant.* (Selected)
    PERFORM grant_perm('admin', ARRAY[
        'tenant.post.create', 'tenant.post.read', 'tenant.post.update', 'tenant.post.publish', 'tenant.post.delete', 'tenant.post.restore',
        'tenant.page.create', 'tenant.page.read', 'tenant.page.update', 'tenant.page.publish', 'tenant.page.delete', 'tenant.page.restore',
        'tenant.media.create', 'tenant.media.read', 'tenant.media.update', 'tenant.media.delete', 'tenant.media.restore', 
        'tenant.user.create', 'tenant.user.read', 'tenant.user.update', 'tenant.user.publish', 'tenant.user.delete', 'tenant.user.restore',
        'tenant.setting.read', 'tenant.setting.update',
        'tenant.theme.manage',
        'content.read', 'content.comment', 'content.like'
    ]);

    -- EDITOR (Tenant)
    PERFORM grant_perm('editor', ARRAY[
        'tenant.post.create', 'tenant.post.read', 'tenant.post.update', 'tenant.post.publish', 'tenant.post.delete',
        'tenant.media.create', 'tenant.media.read', 'tenant.media.update',
        'tenant.page.create', 'tenant.page.read', 'tenant.page.update',
        'content.read', 'content.comment', 'content.like'
    ]);

    -- AUTHOR (Tenant)
    PERFORM grant_perm('author', ARRAY[
        'tenant.post.create', 'tenant.post.read', 'tenant.post.update', -- Logic U-own handled in Context
        'tenant.media.create', 'tenant.media.read',
        'content.read'
    ]);

    -- MEMBER
    PERFORM grant_perm('member', ARRAY[
        'content.read', 'content.comment',
        'tenant.profile.read', 'tenant.profile.update'
    ]);

    -- SUBSCRIBER
    PERFORM grant_perm('subscriber', ARRAY[
        'content.read'
    ]);

    -- PUBLIC
    PERFORM grant_perm('public', ARRAY[
        'content.read'
    ]);
END;
$$;

DROP FUNCTION grant_perm;

-- 4. Map Legacy Admin Menus to New Keys
UPDATE public.admin_menus SET permission = 'tenant.post.read' WHERE permission = 'view_posts';
UPDATE public.admin_menus SET permission = 'tenant.page.read' WHERE permission = 'view_pages';
UPDATE public.admin_menus SET permission = 'tenant.media.read' WHERE permission = 'manage_media';
UPDATE public.admin_menus SET permission = 'tenant.user.read' WHERE permission = 'view_users';
UPDATE public.admin_menus SET permission = 'tenant.setting.read' WHERE permission = 'view_settings';
UPDATE public.admin_menus SET permission = 'tenant.theme.manage' WHERE permission = 'manage_themes';
UPDATE public.admin_menus SET permission = 'platform.tenant.read' WHERE permission = 'manage_tenants';
-- Visual Builder mapping
UPDATE public.admin_menus SET permission = 'tenant.page.read' WHERE permission = 'view_visual_builder';
