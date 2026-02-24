SET client_min_messages TO warning;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS parent_tenant_id uuid,
  ADD COLUMN IF NOT EXISTS level integer,
  ADD COLUMN IF NOT EXISTS hierarchy_path uuid[],
  ADD COLUMN IF NOT EXISTS role_inheritance_mode text NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_parent_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_parent_tenant_id_fkey
      FOREIGN KEY (parent_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_level_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_level_check
      CHECK (level BETWEEN 1 AND 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_role_inheritance_mode_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_role_inheritance_mode_check
      CHECK (role_inheritance_mode IN ('auto', 'linked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_parent_tenant_id
  ON public.tenants (parent_tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenants_hierarchy_path
  ON public.tenants USING gin (hierarchy_path);

CREATE OR REPLACE FUNCTION public.set_tenant_hierarchy() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  parent_level integer;
  parent_path uuid[];
BEGIN
  IF NEW.parent_tenant_id IS NULL THEN
    NEW.level := 1;
    NEW.hierarchy_path := ARRAY[NEW.id];
    RETURN NEW;
  END IF;

  IF NEW.parent_tenant_id = NEW.id THEN
    RAISE EXCEPTION 'Tenant cannot be its own parent.';
  END IF;

  SELECT level, hierarchy_path
  INTO parent_level, parent_path
  FROM public.tenants
  WHERE id = NEW.parent_tenant_id;

  IF parent_level IS NULL THEN
    RAISE EXCEPTION 'Parent tenant not found.';
  END IF;

  IF parent_level >= 5 THEN
    RAISE EXCEPTION 'Max tenant depth is 5.';
  END IF;

  IF parent_path @> ARRAY[NEW.id] THEN
    RAISE EXCEPTION 'Circular tenant hierarchy detected.';
  END IF;

  NEW.level := parent_level + 1;
  NEW.hierarchy_path := parent_path || NEW.id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_tenant_subtree(p_root_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  max_depth integer;
BEGIN
  WITH RECURSIVE tree AS (
    SELECT id, parent_tenant_id, hierarchy_path, level
    FROM public.tenants
    WHERE id = p_root_id
    UNION ALL
    SELECT child.id, child.parent_tenant_id, tree.hierarchy_path || child.id, tree.level + 1
    FROM public.tenants child
    JOIN tree ON child.parent_tenant_id = tree.id
  )
  SELECT max(level) INTO max_depth FROM tree;

  IF max_depth > 5 THEN
    RAISE EXCEPTION 'Max tenant depth is 5.';
  END IF;

  WITH RECURSIVE tree AS (
    SELECT id, parent_tenant_id, hierarchy_path, level
    FROM public.tenants
    WHERE id = p_root_id
    UNION ALL
    SELECT child.id, child.parent_tenant_id, tree.hierarchy_path || child.id, tree.level + 1
    FROM public.tenants child
    JOIN tree ON child.parent_tenant_id = tree.id
  )
  UPDATE public.tenants t
  SET hierarchy_path = tree.hierarchy_path,
      level = tree.level
  FROM tree
  WHERE t.id = tree.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_tenant_subtree_trigger() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.refresh_tenant_subtree(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_tenant_hierarchy ON public.tenants;
CREATE TRIGGER set_tenant_hierarchy
  BEFORE INSERT OR UPDATE OF parent_tenant_id ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_hierarchy();

DROP TRIGGER IF EXISTS refresh_tenant_subtree ON public.tenants;
CREATE TRIGGER refresh_tenant_subtree
  AFTER UPDATE OF parent_tenant_id ON public.tenants
  FOR EACH ROW
  WHEN (OLD.parent_tenant_id IS DISTINCT FROM NEW.parent_tenant_id)
  EXECUTE FUNCTION public.refresh_tenant_subtree_trigger();

UPDATE public.tenants
SET level = 1
WHERE level IS NULL;

UPDATE public.tenants
SET hierarchy_path = ARRAY[id]
WHERE hierarchy_path IS NULL;

CREATE TABLE IF NOT EXISTS public.tenant_resource_registry (
  resource_key text PRIMARY KEY,
  description text,
  default_share_mode text NOT NULL DEFAULT 'isolated',
  default_access_mode text NOT NULL DEFAULT 'read_write',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT tenant_resource_registry_share_mode_check
    CHECK (default_share_mode IN ('isolated', 'shared_descendants', 'shared_ancestors', 'shared_all')),
  CONSTRAINT tenant_resource_registry_access_mode_check
    CHECK (default_access_mode IN ('read', 'write', 'read_write'))
);

CREATE TABLE IF NOT EXISTS public.tenant_resource_rules (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resource_key text NOT NULL REFERENCES public.tenant_resource_registry(resource_key) ON DELETE CASCADE,
  share_mode text NOT NULL,
  access_mode text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id, resource_key),
  CONSTRAINT tenant_resource_rules_share_mode_check
    CHECK (share_mode IN ('isolated', 'shared_descendants', 'shared_ancestors', 'shared_all')),
  CONSTRAINT tenant_resource_rules_access_mode_check
    CHECK (access_mode IN ('read', 'write', 'read_write'))
);

ALTER TABLE public.tenant_resource_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_resource_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_resource_registry_select ON public.tenant_resource_registry;
CREATE POLICY tenant_resource_registry_select
  ON public.tenant_resource_registry
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS tenant_resource_rules_select ON public.tenant_resource_rules;
CREATE POLICY tenant_resource_rules_select
  ON public.tenant_resource_rules
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS tenant_resource_rules_insert ON public.tenant_resource_rules;
CREATE POLICY tenant_resource_rules_insert
  ON public.tenant_resource_rules
  FOR INSERT
  WITH CHECK ((tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin());

DROP POLICY IF EXISTS tenant_resource_rules_update ON public.tenant_resource_rules;
CREATE POLICY tenant_resource_rules_update
  ON public.tenant_resource_rules
  FOR UPDATE
  USING ((tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin())
  WITH CHECK ((tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin());

DROP POLICY IF EXISTS tenant_resource_rules_delete ON public.tenant_resource_rules;
CREATE POLICY tenant_resource_rules_delete
  ON public.tenant_resource_rules
  FOR DELETE
  USING ((tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin());

INSERT INTO public.tenant_resource_registry (resource_key, description, default_share_mode, default_access_mode)
VALUES
  ('settings', 'Tenant settings and configuration', 'shared_descendants', 'read_write'),
  ('branding', 'Branding and theme assets', 'shared_descendants', 'read_write'),
  ('content', 'Content resources (pages, blogs, categories, tags)', 'isolated', 'read_write'),
  ('media', 'Media library and files', 'isolated', 'read_write'),
  ('users', 'User accounts and profiles', 'isolated', 'read_write'),
  ('roles', 'Role and permission management', 'isolated', 'read_write'),
  ('menus', 'Navigation menus', 'isolated', 'read_write'),
  ('extensions', 'Extensions and plugin registry', 'isolated', 'read_write'),
  ('widgets', 'Widgets and widget registry', 'isolated', 'read_write'),
  ('templates', 'Template management', 'isolated', 'read_write'),
  ('workflows', 'Workflow definitions', 'isolated', 'read_write'),
  ('notifications', 'Notification resources', 'isolated', 'read_write'),
  ('audit.logs', 'Audit logs and activity trails', 'isolated', 'read_write'),
  ('analytics.reports', 'Analytics and reporting data', 'isolated', 'read_write'),
  ('billing', 'Subscription and billing', 'isolated', 'read_write'),
  ('commerce', 'Commerce products and orders', 'isolated', 'read_write'),
  ('regions', 'Region hierarchy data', 'isolated', 'read_write'),
  ('integrations.webhooks', 'Webhook integrations', 'isolated', 'read_write'),
  ('search', 'Search configuration and indexes', 'isolated', 'read_write'),
  ('backups', 'Backup and restore operations', 'isolated', 'read_write')
ON CONFLICT (resource_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_tenant_resource_rules(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.tenant_resource_rules (tenant_id, resource_key, share_mode, access_mode)
  SELECT p_tenant_id, resource_key, default_share_mode, default_access_mode
  FROM public.tenant_resource_registry
  ON CONFLICT (tenant_id, resource_key) DO NOTHING;
END;
$$;

DO $$
DECLARE
  tenant_row record;
BEGIN
  FOR tenant_row IN
    SELECT id FROM public.tenants
  LOOP
    PERFORM public.seed_tenant_resource_rules(tenant_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_descendant(p_ancestor uuid, p_descendant uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants
    WHERE id = p_descendant
      AND hierarchy_path @> ARRAY[p_ancestor]
  );
$$;

CREATE OR REPLACE FUNCTION public.tenant_can_access_resource(p_row_tenant_id uuid, p_resource_key text, p_action text) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  current_tenant uuid := public.current_tenant_id();
  share_mode text;
  access_mode text;
  can_access boolean := false;
  current_root uuid;
  row_root uuid;
BEGIN
  IF current_tenant IS NULL OR p_row_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_platform_admin() THEN
    RETURN true;
  END IF;

  IF p_row_tenant_id = current_tenant THEN
    RETURN true;
  END IF;

  IF NOT public.is_admin_or_above() THEN
    RETURN false;
  END IF;

  SELECT hierarchy_path[1] INTO current_root
  FROM public.tenants
  WHERE id = current_tenant;

  SELECT hierarchy_path[1] INTO row_root
  FROM public.tenants
  WHERE id = p_row_tenant_id;

  IF current_root IS NULL OR row_root IS NULL OR current_root <> row_root THEN
    RETURN false;
  END IF;

  SELECT tr.share_mode, tr.access_mode
  INTO share_mode, access_mode
  FROM public.tenant_resource_rules tr
  WHERE tr.tenant_id = p_row_tenant_id
    AND tr.resource_key = p_resource_key;

  IF share_mode IS NULL THEN
    SELECT rr.default_share_mode, rr.default_access_mode
    INTO share_mode, access_mode
    FROM public.tenant_resource_registry rr
    WHERE rr.resource_key = p_resource_key;
  END IF;

  IF share_mode IS NULL THEN
    share_mode := 'isolated';
    access_mode := 'read_write';
  END IF;

  IF share_mode = 'isolated' THEN
    RETURN false;
  END IF;

  IF p_action = 'read' AND access_mode NOT IN ('read', 'read_write') THEN
    RETURN false;
  END IF;

  IF p_action = 'write' AND access_mode NOT IN ('write', 'read_write') THEN
    RETURN false;
  END IF;

  IF share_mode = 'shared_descendants' THEN
    can_access := public.is_tenant_descendant(p_row_tenant_id, current_tenant);
  ELSIF share_mode = 'shared_ancestors' THEN
    can_access := public.is_tenant_descendant(current_tenant, p_row_tenant_id);
  ELSIF share_mode = 'shared_all' THEN
    can_access := true;
  END IF;

  RETURN can_access;
END;
$$;

CREATE TABLE IF NOT EXISTS public.tenant_role_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  child_role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  created_by uuid,
  UNIQUE (tenant_id, parent_role_id, child_role_id)
);

ALTER TABLE public.tenant_role_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_role_links_select ON public.tenant_role_links;
CREATE POLICY tenant_role_links_select
  ON public.tenant_role_links
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS tenant_role_links_insert ON public.tenant_role_links;
CREATE POLICY tenant_role_links_insert
  ON public.tenant_role_links
  FOR INSERT
  WITH CHECK ((tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin());

DROP POLICY IF EXISTS tenant_role_links_update ON public.tenant_role_links;
CREATE POLICY tenant_role_links_update
  ON public.tenant_role_links
  FOR UPDATE
  USING ((tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin())
  WITH CHECK ((tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin());

DROP POLICY IF EXISTS tenant_role_links_delete ON public.tenant_role_links;
CREATE POLICY tenant_role_links_delete
  ON public.tenant_role_links
  FOR DELETE
  USING ((tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.sync_tenant_roles_from_parent(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  parent_id uuid;
BEGIN
  SELECT parent_tenant_id INTO parent_id
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF parent_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.roles (
    name,
    description,
    tenant_id,
    is_system,
    scope,
    is_platform_admin,
    is_full_access,
    is_tenant_admin,
    is_public,
    is_guest,
    is_staff,
    staff_level
  )
  SELECT
    r.name,
    r.description,
    p_tenant_id,
    r.is_system,
    r.scope,
    false,
    false,
    r.is_tenant_admin,
    r.is_public,
    r.is_guest,
    r.is_staff,
    r.staff_level
  FROM public.roles r
  WHERE r.tenant_id = parent_id
    AND r.deleted_at IS NULL
  ON CONFLICT (tenant_id, name) DO UPDATE
  SET description = EXCLUDED.description,
      is_system = EXCLUDED.is_system,
      scope = EXCLUDED.scope,
      is_tenant_admin = EXCLUDED.is_tenant_admin,
      is_public = EXCLUDED.is_public,
      is_guest = EXCLUDED.is_guest,
      is_staff = EXCLUDED.is_staff,
      staff_level = EXCLUDED.staff_level;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT child.id, rp.permission_id
  FROM public.role_permissions rp
  JOIN public.roles parent ON parent.id = rp.role_id
  JOIN public.roles child
    ON child.tenant_id = p_tenant_id
   AND child.name = parent.name
  WHERE parent.tenant_id = parent_id
    AND rp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.role_permissions existing
      WHERE existing.role_id = child.id
        AND existing.permission_id = rp.permission_id
        AND existing.deleted_at IS NULL
    );

  INSERT INTO public.role_policies (role_id, policy_id)
  SELECT child.id, rp.policy_id
  FROM public.role_policies rp
  JOIN public.roles parent ON parent.id = rp.role_id
  JOIN public.roles child
    ON child.tenant_id = p_tenant_id
   AND child.name = parent.name
  WHERE parent.tenant_id = parent_id
    AND rp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.role_policies existing
      WHERE existing.role_id = child.id
        AND existing.policy_id = rp.policy_id
        AND existing.deleted_at IS NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_linked_tenant_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT link.child_role_id, rp.permission_id
  FROM public.tenant_role_links link
  JOIN public.role_permissions rp ON rp.role_id = link.parent_role_id
  WHERE link.tenant_id = p_tenant_id
    AND rp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.role_permissions existing
      WHERE existing.role_id = link.child_role_id
        AND existing.permission_id = rp.permission_id
        AND existing.deleted_at IS NULL
    );

  INSERT INTO public.role_policies (role_id, policy_id)
  SELECT link.child_role_id, rp.policy_id
  FROM public.tenant_role_links link
  JOIN public.role_policies rp ON rp.role_id = link.parent_role_id
  WHERE link.tenant_id = p_tenant_id
    AND rp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.role_policies existing
      WHERE existing.role_id = link.child_role_id
        AND existing.policy_id = rp.policy_id
        AND existing.deleted_at IS NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_tenant_role_inheritance(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  inheritance_mode text;
BEGIN
  SELECT role_inheritance_mode
  INTO inheritance_mode
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF inheritance_mode IS NULL THEN
    inheritance_mode := 'auto';
  END IF;

  IF inheritance_mode = 'auto' THEN
    PERFORM public.sync_tenant_roles_from_parent(p_tenant_id);
  ELSIF inheritance_mode = 'linked' THEN
    PERFORM public.sync_linked_tenant_roles(p_tenant_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(
  p_name text,
  p_slug text,
  p_domain text DEFAULT NULL::text,
  p_tier text DEFAULT 'free'::text,
  p_parent_tenant_id uuid DEFAULT NULL,
  p_role_inheritance_mode text DEFAULT 'auto'
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_tenant_id uuid;
    v_admin_role_id uuid;
BEGIN
    INSERT INTO public.tenants (
      name,
      slug,
      domain,
      subscription_tier,
      status,
      parent_tenant_id,
      role_inheritance_mode
    )
    VALUES (p_name, p_slug, p_domain, p_tier, 'active', p_parent_tenant_id, p_role_inheritance_mode)
    RETURNING id INTO v_tenant_id;

    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_tenant_admin)
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true, 'tenant', true)
    RETURNING id INTO v_admin_role_id;

    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('editor', 'Content Editor', v_tenant_id, true, 'tenant');

    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('author', 'Content Author', v_tenant_id, true, 'tenant');

    PERFORM public.seed_staff_roles(v_tenant_id);
    PERFORM public.seed_tenant_resource_rules(v_tenant_id);
    PERFORM public.apply_tenant_role_inheritance(v_tenant_id);

    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id,
        'Home',
        'home',
        '{"root":{"props":{"title":"Home"},"children":[]}}',
        'published',
        true,
        'homepage',
        (SELECT auth.uid())
    );

    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id,
        'About Us',
        'about',
        '{"root":{"props":{"title":"About Us"},"children":[]}}',
        'published',
        true,
        'regular',
        (SELECT auth.uid())
    );

    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'Home', '/', 'header', true, true, 1);

    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'About', '/about', 'header', true, true, 2);

    RETURN jsonb_build_object(
        'tenant_id', v_tenant_id,
        'message', 'Tenant created with default data.'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;

INSERT INTO public.permissions (name, description, resource, action, created_at, updated_at)
VALUES
  ('platform.reporting.read', 'Can view platform reporting', 'platform.reporting', 'read', now(), now()),
  ('platform.reporting.bulk_update', 'Can run bulk reporting updates', 'platform.reporting', 'bulk_update', now(), now()),
  ('platform.reporting.bulk_delete', 'Can run bulk reporting deletes', 'platform.reporting', 'bulk_delete', now(), now()),
  ('platform.reporting.bulk_restore', 'Can run bulk reporting restores', 'platform.reporting', 'bulk_restore', now(), now())
ON CONFLICT (name) DO NOTHING;

DROP POLICY IF EXISTS settings_select_hierarchy ON public.settings;
CREATE POLICY settings_select_hierarchy
  ON public.settings
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'settings', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS settings_insert_hierarchy ON public.settings;
CREATE POLICY settings_insert_hierarchy
  ON public.settings
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'settings', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS settings_update_hierarchy ON public.settings;
CREATE POLICY settings_update_hierarchy
  ON public.settings
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'settings', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'settings', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS settings_delete_hierarchy ON public.settings;
CREATE POLICY settings_delete_hierarchy
  ON public.settings
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'settings', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS themes_select_hierarchy ON public.themes;
CREATE POLICY themes_select_hierarchy
  ON public.themes
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'branding', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS themes_insert_hierarchy ON public.themes;
CREATE POLICY themes_insert_hierarchy
  ON public.themes
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'branding', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS themes_update_hierarchy ON public.themes;
CREATE POLICY themes_update_hierarchy
  ON public.themes
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'branding', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'branding', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS themes_delete_hierarchy ON public.themes;
CREATE POLICY themes_delete_hierarchy
  ON public.themes
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'branding', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS menus_select_hierarchy ON public.menus;
CREATE POLICY menus_select_hierarchy
  ON public.menus
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'menus', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS menus_insert_hierarchy ON public.menus;
CREATE POLICY menus_insert_hierarchy
  ON public.menus
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'menus', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS menus_update_hierarchy ON public.menus;
CREATE POLICY menus_update_hierarchy
  ON public.menus
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'menus', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'menus', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS menus_delete_hierarchy ON public.menus;
CREATE POLICY menus_delete_hierarchy
  ON public.menus
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'menus', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS pages_select_hierarchy ON public.pages;
CREATE POLICY pages_select_hierarchy
  ON public.pages
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS pages_insert_hierarchy ON public.pages;
CREATE POLICY pages_insert_hierarchy
  ON public.pages
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS pages_update_hierarchy ON public.pages;
CREATE POLICY pages_update_hierarchy
  ON public.pages
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS pages_delete_hierarchy ON public.pages;
CREATE POLICY pages_delete_hierarchy
  ON public.pages
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS blogs_select_hierarchy ON public.blogs;
CREATE POLICY blogs_select_hierarchy
  ON public.blogs
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS blogs_insert_hierarchy ON public.blogs;
CREATE POLICY blogs_insert_hierarchy
  ON public.blogs
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS blogs_update_hierarchy ON public.blogs;
CREATE POLICY blogs_update_hierarchy
  ON public.blogs
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS blogs_delete_hierarchy ON public.blogs;
CREATE POLICY blogs_delete_hierarchy
  ON public.blogs
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
    OR public.is_platform_admin()
  );

DO $$
BEGIN
  IF to_regclass('public.blog_categories') IS NOT NULL THEN
    DROP POLICY IF EXISTS blog_categories_select_hierarchy ON public.blog_categories;
    CREATE POLICY blog_categories_select_hierarchy
      ON public.blog_categories
      FOR SELECT
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS blog_categories_insert_hierarchy ON public.blog_categories;
    CREATE POLICY blog_categories_insert_hierarchy
      ON public.blog_categories
      FOR INSERT
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS blog_categories_update_hierarchy ON public.blog_categories;
    CREATE POLICY blog_categories_update_hierarchy
      ON public.blog_categories
      FOR UPDATE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      )
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS blog_categories_delete_hierarchy ON public.blog_categories;
    CREATE POLICY blog_categories_delete_hierarchy
      ON public.blog_categories
      FOR DELETE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.blog_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS blog_tags_select_hierarchy ON public.blog_tags;
    CREATE POLICY blog_tags_select_hierarchy
      ON public.blog_tags
      FOR SELECT
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS blog_tags_insert_hierarchy ON public.blog_tags;
    CREATE POLICY blog_tags_insert_hierarchy
      ON public.blog_tags
      FOR INSERT
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS blog_tags_update_hierarchy ON public.blog_tags;
    CREATE POLICY blog_tags_update_hierarchy
      ON public.blog_tags
      FOR UPDATE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      )
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS blog_tags_delete_hierarchy ON public.blog_tags;
    CREATE POLICY blog_tags_delete_hierarchy
      ON public.blog_tags
      FOR DELETE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.page_categories') IS NOT NULL THEN
    DROP POLICY IF EXISTS page_categories_select_hierarchy ON public.page_categories;
    CREATE POLICY page_categories_select_hierarchy
      ON public.page_categories
      FOR SELECT
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS page_categories_insert_hierarchy ON public.page_categories;
    CREATE POLICY page_categories_insert_hierarchy
      ON public.page_categories
      FOR INSERT
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS page_categories_update_hierarchy ON public.page_categories;
    CREATE POLICY page_categories_update_hierarchy
      ON public.page_categories
      FOR UPDATE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      )
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS page_categories_delete_hierarchy ON public.page_categories;
    CREATE POLICY page_categories_delete_hierarchy
      ON public.page_categories
      FOR DELETE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.page_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS page_tags_select_hierarchy ON public.page_tags;
    CREATE POLICY page_tags_select_hierarchy
      ON public.page_tags
      FOR SELECT
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS page_tags_insert_hierarchy ON public.page_tags;
    CREATE POLICY page_tags_insert_hierarchy
      ON public.page_tags
      FOR INSERT
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS page_tags_update_hierarchy ON public.page_tags;
    CREATE POLICY page_tags_update_hierarchy
      ON public.page_tags
      FOR UPDATE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      )
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS page_tags_delete_hierarchy ON public.page_tags;
    CREATE POLICY page_tags_delete_hierarchy
      ON public.page_tags
      FOR DELETE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.services') IS NOT NULL THEN
    DROP POLICY IF EXISTS services_select_hierarchy ON public.services;
    CREATE POLICY services_select_hierarchy
      ON public.services
      FOR SELECT
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS services_insert_hierarchy ON public.services;
    CREATE POLICY services_insert_hierarchy
      ON public.services
      FOR INSERT
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS services_update_hierarchy ON public.services;
    CREATE POLICY services_update_hierarchy
      ON public.services
      FOR UPDATE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      )
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS services_delete_hierarchy ON public.services;
    CREATE POLICY services_delete_hierarchy
      ON public.services
      FOR DELETE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.testimonies') IS NOT NULL THEN
    DROP POLICY IF EXISTS testimonies_select_hierarchy ON public.testimonies;
    CREATE POLICY testimonies_select_hierarchy
      ON public.testimonies
      FOR SELECT
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS testimonies_insert_hierarchy ON public.testimonies;
    CREATE POLICY testimonies_insert_hierarchy
      ON public.testimonies
      FOR INSERT
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS testimonies_update_hierarchy ON public.testimonies;
    CREATE POLICY testimonies_update_hierarchy
      ON public.testimonies
      FOR UPDATE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      )
      WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );

    DROP POLICY IF EXISTS testimonies_delete_hierarchy ON public.testimonies;
    CREATE POLICY testimonies_delete_hierarchy
      ON public.testimonies
      FOR DELETE
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'write')
        OR public.is_platform_admin()
      );
  END IF;
END $$;

DROP POLICY IF EXISTS files_select_hierarchy ON public.files;
CREATE POLICY files_select_hierarchy
  ON public.files
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'media', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS files_insert_hierarchy ON public.files;
CREATE POLICY files_insert_hierarchy
  ON public.files
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'media', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS files_update_hierarchy ON public.files;
CREATE POLICY files_update_hierarchy
  ON public.files
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'media', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'media', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS files_delete_hierarchy ON public.files;
CREATE POLICY files_delete_hierarchy
  ON public.files
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'media', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS users_select_hierarchy ON public.users;
CREATE POLICY users_select_hierarchy
  ON public.users
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS users_update_hierarchy ON public.users;
CREATE POLICY users_update_hierarchy
  ON public.users
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS roles_select_hierarchy ON public.roles;
CREATE POLICY roles_select_hierarchy
  ON public.roles
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'roles', 'read')
    OR public.is_platform_admin()
    OR tenant_id IS NULL
  );

DROP POLICY IF EXISTS roles_update_hierarchy ON public.roles;
CREATE POLICY roles_update_hierarchy
  ON public.roles
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'roles', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'roles', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS role_permissions_select_hierarchy ON public.role_permissions;
CREATE POLICY role_permissions_select_hierarchy
  ON public.role_permissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND (
          r.tenant_id = public.current_tenant_id()
          OR public.tenant_can_access_resource(r.tenant_id, 'roles', 'read')
          OR public.is_platform_admin()
        )
    )
  );

DROP POLICY IF EXISTS role_permissions_update_hierarchy ON public.role_permissions;
CREATE POLICY role_permissions_update_hierarchy
  ON public.role_permissions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND (
          r.tenant_id = public.current_tenant_id()
          OR public.tenant_can_access_resource(r.tenant_id, 'roles', 'write')
          OR public.is_platform_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND (
          r.tenant_id = public.current_tenant_id()
          OR public.tenant_can_access_resource(r.tenant_id, 'roles', 'write')
          OR public.is_platform_admin()
        )
    )
  );

DROP POLICY IF EXISTS role_policies_select_hierarchy ON public.role_policies;
CREATE POLICY role_policies_select_hierarchy
  ON public.role_policies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = role_policies.role_id
        AND (
          r.tenant_id = public.current_tenant_id()
          OR public.tenant_can_access_resource(r.tenant_id, 'roles', 'read')
          OR public.is_platform_admin()
        )
    )
  );

DROP POLICY IF EXISTS role_policies_update_hierarchy ON public.role_policies;
CREATE POLICY role_policies_update_hierarchy
  ON public.role_policies
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = role_policies.role_id
        AND (
          r.tenant_id = public.current_tenant_id()
          OR public.tenant_can_access_resource(r.tenant_id, 'roles', 'write')
          OR public.is_platform_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = role_policies.role_id
        AND (
          r.tenant_id = public.current_tenant_id()
          OR public.tenant_can_access_resource(r.tenant_id, 'roles', 'write')
          OR public.is_platform_admin()
        )
    )
  );

DROP POLICY IF EXISTS templates_select_hierarchy ON public.templates;
CREATE POLICY templates_select_hierarchy
  ON public.templates
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'templates', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS templates_insert_hierarchy ON public.templates;
CREATE POLICY templates_insert_hierarchy
  ON public.templates
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'templates', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS templates_update_hierarchy ON public.templates;
CREATE POLICY templates_update_hierarchy
  ON public.templates
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'templates', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'templates', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS templates_delete_hierarchy ON public.templates;
CREATE POLICY templates_delete_hierarchy
  ON public.templates
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'templates', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS widgets_select_hierarchy ON public.widgets;
CREATE POLICY widgets_select_hierarchy
  ON public.widgets
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'widgets', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS widgets_insert_hierarchy ON public.widgets;
CREATE POLICY widgets_insert_hierarchy
  ON public.widgets
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'widgets', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS widgets_update_hierarchy ON public.widgets;
CREATE POLICY widgets_update_hierarchy
  ON public.widgets
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'widgets', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'widgets', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS widgets_delete_hierarchy ON public.widgets;
CREATE POLICY widgets_delete_hierarchy
  ON public.widgets
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'widgets', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extensions_select_hierarchy ON public.extensions;
CREATE POLICY extensions_select_hierarchy
  ON public.extensions
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extensions_insert_hierarchy ON public.extensions;
CREATE POLICY extensions_insert_hierarchy
  ON public.extensions
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extensions_update_hierarchy ON public.extensions;
CREATE POLICY extensions_update_hierarchy
  ON public.extensions
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extensions_delete_hierarchy ON public.extensions;
CREATE POLICY extensions_delete_hierarchy
  ON public.extensions
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_menu_items_select_hierarchy ON public.extension_menu_items;
CREATE POLICY extension_menu_items_select_hierarchy
  ON public.extension_menu_items
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_menu_items_insert_hierarchy ON public.extension_menu_items;
CREATE POLICY extension_menu_items_insert_hierarchy
  ON public.extension_menu_items
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_menu_items_update_hierarchy ON public.extension_menu_items;
CREATE POLICY extension_menu_items_update_hierarchy
  ON public.extension_menu_items
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_menu_items_delete_hierarchy ON public.extension_menu_items;
CREATE POLICY extension_menu_items_delete_hierarchy
  ON public.extension_menu_items
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_permissions_select_hierarchy ON public.extension_permissions;
CREATE POLICY extension_permissions_select_hierarchy
  ON public.extension_permissions
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_permissions_insert_hierarchy ON public.extension_permissions;
CREATE POLICY extension_permissions_insert_hierarchy
  ON public.extension_permissions
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_permissions_update_hierarchy ON public.extension_permissions;
CREATE POLICY extension_permissions_update_hierarchy
  ON public.extension_permissions
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_permissions_delete_hierarchy ON public.extension_permissions;
CREATE POLICY extension_permissions_delete_hierarchy
  ON public.extension_permissions
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_routes_registry_select_hierarchy ON public.extension_routes_registry;
CREATE POLICY extension_routes_registry_select_hierarchy
  ON public.extension_routes_registry
  FOR SELECT
  USING (
    (deleted_at IS NULL)
    AND (is_active = true OR public.is_platform_admin())
    AND (
      tenant_id = public.current_tenant_id()
      OR public.tenant_can_access_resource(tenant_id, 'extensions', 'read')
      OR public.is_platform_admin()
    )
  );

DROP POLICY IF EXISTS extension_routes_registry_insert_hierarchy ON public.extension_routes_registry;
CREATE POLICY extension_routes_registry_insert_hierarchy
  ON public.extension_routes_registry
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_routes_registry_update_hierarchy ON public.extension_routes_registry;
CREATE POLICY extension_routes_registry_update_hierarchy
  ON public.extension_routes_registry
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_routes_registry_delete_hierarchy ON public.extension_routes_registry;
CREATE POLICY extension_routes_registry_delete_hierarchy
  ON public.extension_routes_registry
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_rbac_select_hierarchy ON public.extension_rbac_integration;
CREATE POLICY extension_rbac_select_hierarchy
  ON public.extension_rbac_integration
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'read')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_rbac_insert_hierarchy ON public.extension_rbac_integration;
CREATE POLICY extension_rbac_insert_hierarchy
  ON public.extension_rbac_integration
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_rbac_update_hierarchy ON public.extension_rbac_integration;
CREATE POLICY extension_rbac_update_hierarchy
  ON public.extension_rbac_integration
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS extension_rbac_delete_hierarchy ON public.extension_rbac_integration;
CREATE POLICY extension_rbac_delete_hierarchy
  ON public.extension_rbac_integration
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    OR public.tenant_can_access_resource(tenant_id, 'extensions', 'write')
    OR public.is_platform_admin()
  );
