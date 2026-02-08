drop policy "article_tags_select_public" on "public"."blog_tags";

drop policy "articles_delete_unified" on "public"."blogs";

drop policy "articles_insert_unified" on "public"."blogs";

drop policy "articles_select_unified" on "public"."blogs";

drop policy "articles_update_unified" on "public"."blogs";

drop policy "Admins manage extension_menu_items" on "public"."extension_menu_items";

drop policy "extension_permissions_delete_admin" on "public"."extension_permissions";

drop policy "extension_permissions_insert_admin" on "public"."extension_permissions";

drop policy "extension_permissions_select_auth" on "public"."extension_permissions";

drop policy "extension_permissions_update_admin" on "public"."extension_permissions";

drop policy "extension_rbac_delete" on "public"."extension_rbac_integration";

drop policy "extension_rbac_insert" on "public"."extension_rbac_integration";

drop policy "extension_rbac_select" on "public"."extension_rbac_integration";

drop policy "extension_rbac_update" on "public"."extension_rbac_integration";

drop policy "extension_routes_registry_select" on "public"."extension_routes_registry";

drop policy "extensions_delete_unified" on "public"."extensions";

drop policy "extensions_insert_unified" on "public"."extensions";

drop policy "extensions_select_unified" on "public"."extensions";

drop policy "extensions_update_unified" on "public"."extensions";

drop policy "files_delete_unified" on "public"."files";

drop policy "files_insert_unified" on "public"."files";

drop policy "files_select_unified" on "public"."files";

drop policy "files_update_unified" on "public"."files";

drop policy "menus_delete_unified" on "public"."menus";

drop policy "menus_insert_unified" on "public"."menus";

drop policy "menus_select_unified" on "public"."menus";

drop policy "menus_update_unified" on "public"."menus";

drop policy "page_categories_select_public" on "public"."page_categories";

drop policy "page_tags_delete_tenant" on "public"."page_tags";

drop policy "page_tags_insert_tenant" on "public"."page_tags";

drop policy "page_tags_read_all" on "public"."page_tags";

drop policy "page_tags_update_tenant" on "public"."page_tags";

drop policy "pages_delete_unified" on "public"."pages";

drop policy "pages_insert_unified" on "public"."pages";

drop policy "pages_select_unified" on "public"."pages";

drop policy "pages_update_unified" on "public"."pages";

drop policy "role_permissions_select_policy" on "public"."role_permissions";

drop policy "role_permissions_update_policy" on "public"."role_permissions";

drop policy "role_policies_insert_unified" on "public"."role_policies";

drop policy "role_policies_select_unified" on "public"."role_policies";

drop policy "role_policies_update_unified" on "public"."role_policies";

drop policy "roles_delete_unified" on "public"."roles";

drop policy "roles_insert_unified" on "public"."roles";

drop policy "roles_select_unified" on "public"."roles";

drop policy "roles_update_unified" on "public"."roles";

drop policy "Tenant Delete Services" on "public"."services";

drop policy "Tenant Insert Services" on "public"."services";

drop policy "Tenant Select Services" on "public"."services";

drop policy "Tenant Update Services" on "public"."services";

drop policy "settings_delete_unified" on "public"."settings";

drop policy "settings_insert_unified" on "public"."settings";

drop policy "settings_select_unified" on "public"."settings";

drop policy "settings_update_unified" on "public"."settings";

drop policy "templates_delete_unified" on "public"."templates";

drop policy "templates_modify_unified" on "public"."templates";

drop policy "templates_select_unified" on "public"."templates";

drop policy "templates_update_unified" on "public"."templates";

drop policy "testimonies_delete_unified" on "public"."testimonies";

drop policy "testimonies_insert_unified" on "public"."testimonies";

drop policy "testimonies_select_unified" on "public"."testimonies";

drop policy "testimonies_update_unified" on "public"."testimonies";

drop policy "themes_delete_unified" on "public"."themes";

drop policy "themes_insert_unified" on "public"."themes";

drop policy "themes_select_unified" on "public"."themes";

drop policy "themes_update_unified" on "public"."themes";

drop policy "users_delete_unified" on "public"."users";

drop policy "users_insert_unified" on "public"."users";

drop policy "users_select_unified" on "public"."users";

drop policy "users_update_unified" on "public"."users";

drop policy "widgets_delete_unified" on "public"."widgets";

drop policy "widgets_modify_unified" on "public"."widgets";

drop policy "widgets_select_unified" on "public"."widgets";

drop policy "widgets_update_unified" on "public"."widgets";

drop policy "notification_readers_select_policy" on "public"."notification_readers";

drop policy "Users view own orders" on "public"."orders";

drop policy "Admins View SSO Logs" on "public"."sso_audit_logs";

drop policy "testimony_tags_delete" on "public"."testimony_tags";

drop policy "testimony_tags_insert" on "public"."testimony_tags";

drop policy "testimony_tags_update" on "public"."testimony_tags";

alter table "public"."roles" drop constraint "roles_name_key";

drop index if exists "public"."idx_funfacts_display_order";

drop index if exists "public"."idx_partners_display_order";

drop index if exists "public"."idx_services_display_order";

drop index if exists "public"."idx_teams_display_order";

drop index if exists "public"."roles_name_key";


  create table "public"."tenant_resource_registry" (
    "resource_key" text not null,
    "description" text,
    "default_share_mode" text not null default 'isolated'::text,
    "default_access_mode" text not null default 'read_write'::text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."tenant_resource_registry" enable row level security;


  create table "public"."tenant_resource_rules" (
    "tenant_id" uuid not null,
    "resource_key" text not null,
    "share_mode" text not null,
    "access_mode" text not null,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "updated_by" uuid
      );


alter table "public"."tenant_resource_rules" enable row level security;


  create table "public"."tenant_role_links" (
    "id" uuid not null default gen_random_uuid(),
    "tenant_id" uuid not null,
    "parent_role_id" uuid not null,
    "child_role_id" uuid not null,
    "created_at" timestamp with time zone default now(),
    "created_by" uuid
      );


alter table "public"."tenant_role_links" enable row level security;

alter table "public"."extension_menu_items" add column "tenant_id" uuid;

alter table "public"."extension_permissions" add column "tenant_id" uuid;

alter table "public"."extension_rbac_integration" add column "tenant_id" uuid;

alter table "public"."extension_routes_registry" add column "tenant_id" uuid;

alter table "public"."notification_readers" add column "tenant_id" uuid;

alter table "public"."roles" add column "is_default_invite" boolean not null default false;

alter table "public"."roles" add column "is_default_public_registration" boolean not null default false;

alter table "public"."roles" add column "is_full_access" boolean not null default false;

alter table "public"."roles" add column "is_guest" boolean not null default false;

alter table "public"."roles" add column "is_platform_admin" boolean not null default false;

alter table "public"."roles" add column "is_public" boolean not null default false;

alter table "public"."roles" add column "is_staff" boolean not null default false;

alter table "public"."roles" add column "is_tenant_admin" boolean not null default false;

alter table "public"."roles" add column "scope" text not null default 'tenant'::text;

alter table "public"."roles" add column "staff_level" integer;

alter table "public"."tenants" add column "hierarchy_path" uuid[];

alter table "public"."tenants" add column "level" integer;

alter table "public"."tenants" add column "parent_tenant_id" uuid;

alter table "public"."tenants" add column "role_inheritance_mode" text not null default 'auto'::text;

CREATE INDEX idx_extension_menu_items_tenant_id ON public.extension_menu_items USING btree (tenant_id);

CREATE INDEX idx_extension_permissions_tenant_id ON public.extension_permissions USING btree (tenant_id);

CREATE INDEX idx_extension_rbac_integration_tenant_id ON public.extension_rbac_integration USING btree (tenant_id);

CREATE INDEX idx_extension_routes_registry_tenant_id ON public.extension_routes_registry USING btree (tenant_id);

CREATE INDEX idx_tenant_resource_rules_resource_key ON public.tenant_resource_rules USING btree (resource_key);

CREATE INDEX idx_tenant_role_links_child_role_id ON public.tenant_role_links USING btree (child_role_id);

CREATE INDEX idx_tenant_role_links_parent_role_id ON public.tenant_role_links USING btree (parent_role_id);

CREATE INDEX idx_tenants_hierarchy_path ON public.tenants USING gin (hierarchy_path);

CREATE INDEX idx_tenants_parent_tenant_id ON public.tenants USING btree (parent_tenant_id);

CREATE UNIQUE INDEX roles_name_global_unique ON public.roles USING btree (name) WHERE (tenant_id IS NULL);

CREATE UNIQUE INDEX roles_name_tenant_unique ON public.roles USING btree (tenant_id, name) WHERE (tenant_id IS NOT NULL);

CREATE UNIQUE INDEX tenant_resource_registry_pkey ON public.tenant_resource_registry USING btree (resource_key);

CREATE UNIQUE INDEX tenant_resource_rules_pkey ON public.tenant_resource_rules USING btree (tenant_id, resource_key);

CREATE UNIQUE INDEX tenant_role_links_pkey ON public.tenant_role_links USING btree (id);

CREATE UNIQUE INDEX tenant_role_links_tenant_id_parent_role_id_child_role_id_key ON public.tenant_role_links USING btree (tenant_id, parent_role_id, child_role_id);

alter table "public"."tenant_resource_registry" add constraint "tenant_resource_registry_pkey" PRIMARY KEY using index "tenant_resource_registry_pkey";

alter table "public"."tenant_resource_rules" add constraint "tenant_resource_rules_pkey" PRIMARY KEY using index "tenant_resource_rules_pkey";

alter table "public"."tenant_role_links" add constraint "tenant_role_links_pkey" PRIMARY KEY using index "tenant_role_links_pkey";

alter table "public"."extension_menu_items" add constraint "extension_menu_items_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."extension_menu_items" validate constraint "extension_menu_items_tenant_id_fkey";

alter table "public"."extension_permissions" add constraint "extension_permissions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."extension_permissions" validate constraint "extension_permissions_tenant_id_fkey";

alter table "public"."extension_rbac_integration" add constraint "extension_rbac_integration_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."extension_rbac_integration" validate constraint "extension_rbac_integration_tenant_id_fkey";

alter table "public"."extension_routes_registry" add constraint "extension_routes_registry_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."extension_routes_registry" validate constraint "extension_routes_registry_tenant_id_fkey";

alter table "public"."roles" add constraint "roles_scope_check" CHECK ((scope = ANY (ARRAY['platform'::text, 'tenant'::text, 'public'::text]))) not valid;

alter table "public"."roles" validate constraint "roles_scope_check";

alter table "public"."roles" add constraint "roles_staff_level_check" CHECK (((is_staff AND ((staff_level >= 1) AND (staff_level <= 10))) OR ((NOT is_staff) AND (staff_level IS NULL)))) not valid;

alter table "public"."roles" validate constraint "roles_staff_level_check";

alter table "public"."tenant_resource_registry" add constraint "tenant_resource_registry_access_mode_check" CHECK ((default_access_mode = ANY (ARRAY['read'::text, 'write'::text, 'read_write'::text]))) not valid;

alter table "public"."tenant_resource_registry" validate constraint "tenant_resource_registry_access_mode_check";

alter table "public"."tenant_resource_registry" add constraint "tenant_resource_registry_share_mode_check" CHECK ((default_share_mode = ANY (ARRAY['isolated'::text, 'shared_descendants'::text, 'shared_ancestors'::text, 'shared_all'::text]))) not valid;

alter table "public"."tenant_resource_registry" validate constraint "tenant_resource_registry_share_mode_check";

alter table "public"."tenant_resource_rules" add constraint "tenant_resource_rules_access_mode_check" CHECK ((access_mode = ANY (ARRAY['read'::text, 'write'::text, 'read_write'::text]))) not valid;

alter table "public"."tenant_resource_rules" validate constraint "tenant_resource_rules_access_mode_check";

alter table "public"."tenant_resource_rules" add constraint "tenant_resource_rules_resource_key_fkey" FOREIGN KEY (resource_key) REFERENCES public.tenant_resource_registry(resource_key) ON DELETE CASCADE not valid;

alter table "public"."tenant_resource_rules" validate constraint "tenant_resource_rules_resource_key_fkey";

alter table "public"."tenant_resource_rules" add constraint "tenant_resource_rules_share_mode_check" CHECK ((share_mode = ANY (ARRAY['isolated'::text, 'shared_descendants'::text, 'shared_ancestors'::text, 'shared_all'::text]))) not valid;

alter table "public"."tenant_resource_rules" validate constraint "tenant_resource_rules_share_mode_check";

alter table "public"."tenant_resource_rules" add constraint "tenant_resource_rules_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_resource_rules" validate constraint "tenant_resource_rules_tenant_id_fkey";

alter table "public"."tenant_role_links" add constraint "tenant_role_links_child_role_id_fkey" FOREIGN KEY (child_role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_role_links" validate constraint "tenant_role_links_child_role_id_fkey";

alter table "public"."tenant_role_links" add constraint "tenant_role_links_parent_role_id_fkey" FOREIGN KEY (parent_role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_role_links" validate constraint "tenant_role_links_parent_role_id_fkey";

alter table "public"."tenant_role_links" add constraint "tenant_role_links_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_role_links" validate constraint "tenant_role_links_tenant_id_fkey";

alter table "public"."tenant_role_links" add constraint "tenant_role_links_tenant_id_parent_role_id_child_role_id_key" UNIQUE using index "tenant_role_links_tenant_id_parent_role_id_child_role_id_key";

alter table "public"."tenants" add constraint "tenants_level_check" CHECK (((level >= 1) AND (level <= 5))) not valid;

alter table "public"."tenants" validate constraint "tenants_level_check";

alter table "public"."tenants" add constraint "tenants_parent_tenant_id_fkey" FOREIGN KEY (parent_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL not valid;

alter table "public"."tenants" validate constraint "tenants_parent_tenant_id_fkey";

alter table "public"."tenants" add constraint "tenants_role_inheritance_mode_check" CHECK ((role_inheritance_mode = ANY (ARRAY['auto'::text, 'linked'::text]))) not valid;

alter table "public"."tenants" validate constraint "tenants_role_inheritance_mode_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.apply_tenant_role_inheritance(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.auth_is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
      AND r.deleted_at IS NULL
      AND (r.is_tenant_admin OR r.is_platform_admin OR r.is_full_access)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(p_name text, p_slug text, p_domain text DEFAULT NULL::text, p_tier text DEFAULT 'free'::text, p_parent_tenant_id uuid DEFAULT NULL::uuid, p_role_inheritance_mode text DEFAULT 'auto'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id uuid;
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
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true, 'tenant', true);

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
$function$
;

CREATE OR REPLACE FUNCTION public.is_tenant_descendant(p_ancestor uuid, p_descendant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants
    WHERE id = p_descendant
      AND hierarchy_path @> ARRAY[p_ancestor]
  );
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_tenant_subtree(p_root_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_tenant_subtree_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.refresh_tenant_subtree(NEW.id);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_staff_roles(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  role_rec record;
BEGIN
  FOR role_rec IN
    SELECT * FROM (
      VALUES
        ('super_manager', 'Super Manager', 10),
        ('senior_manager', 'Senior Manager', 9),
        ('manager', 'Manager', 8),
        ('senior_supervisor', 'Senior Supervisor', 7),
        ('supervisor', 'Supervisor', 6),
        ('senior_specialist', 'Senior Specialist', 5),
        ('specialist', 'Specialist', 4),
        ('associate', 'Associate', 3),
        ('assistant', 'Assistant', 2),
        ('internship', 'Internship', 1)
    ) AS role_values(role_name, role_description, role_level)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.roles
      WHERE tenant_id = p_tenant_id
        AND name = role_rec.role_name
    ) THEN
      INSERT INTO public.roles (
        name,
        description,
        tenant_id,
        is_system,
        scope,
        is_staff,
        staff_level
      )
      VALUES (
        role_rec.role_name,
        role_rec.role_description,
        p_tenant_id,
        true,
        'tenant',
        true,
        role_rec.role_level
      );
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_tenant_resource_rules(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_resource_rules (tenant_id, resource_key, share_mode, access_mode)
  SELECT p_tenant_id, resource_key, default_share_mode, default_access_mode
  FROM public.tenant_resource_registry
  ON CONFLICT (tenant_id, resource_key) DO NOTHING;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_extension_tenant_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  extension_tenant uuid;
BEGIN
  IF NEW.extension_id IS NOT NULL THEN
    SELECT tenant_id INTO extension_tenant
    FROM public.extensions
    WHERE id = NEW.extension_id;

    IF extension_tenant IS NOT NULL THEN
      NEW.tenant_id := extension_tenant;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_tenant_hierarchy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_linked_tenant_roles(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_tenant_roles_from_parent(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND NOT EXISTS (
      SELECT 1
      FROM public.roles existing
      WHERE existing.tenant_id = p_tenant_id
        AND existing.name = r.name
    );

  UPDATE public.roles child
  SET description = parent.description,
      is_system = parent.is_system,
      scope = parent.scope,
      is_platform_admin = false,
      is_full_access = false,
      is_tenant_admin = parent.is_tenant_admin,
      is_public = parent.is_public,
      is_guest = parent.is_guest,
      is_staff = parent.is_staff,
      staff_level = parent.staff_level
  FROM public.roles parent
  WHERE parent.tenant_id = parent_id
    AND child.tenant_id = p_tenant_id
    AND child.name = parent.name;

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
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_can_access_resource(p_row_tenant_id uuid, p_resource_key text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.analyze_file_usage()
 RETURNS TABLE(file_path text, usage_count bigint, modules text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sql text := 'WITH all_content AS (';
  has_part boolean := false;
BEGIN
  file_path := NULL;
  usage_count := 0;
  modules := ARRAY[]::text[];
  IF to_regclass('public.articles') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'featured_image'
    ) THEN
      sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
        'SELECT ''articles''::text AS module, featured_image AS content FROM public.articles WHERE featured_image IS NOT NULL';
      has_part := true;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'content'
    ) THEN
      sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
        'SELECT ''articles''::text AS module, content AS content FROM public.articles WHERE content IS NOT NULL';
      has_part := true;
    END IF;
  END IF;

  IF to_regclass('public.blogs') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'blogs' AND column_name = 'featured_image'
    ) THEN
      sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
        'SELECT ''blogs''::text AS module, featured_image AS content FROM public.blogs WHERE featured_image IS NOT NULL';
      has_part := true;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'blogs' AND column_name = 'content'
    ) THEN
      sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
        'SELECT ''blogs''::text AS module, content AS content FROM public.blogs WHERE content IS NOT NULL';
      has_part := true;
    END IF;
  END IF;

  IF to_regclass('public.pages') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'featured_image'
    ) THEN
      sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
        'SELECT ''pages''::text AS module, featured_image AS content FROM public.pages WHERE featured_image IS NOT NULL';
      has_part := true;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'content'
    ) THEN
      sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
        'SELECT ''pages''::text AS module, content AS content FROM public.pages WHERE content IS NOT NULL';
      has_part := true;
    END IF;
  END IF;

  IF to_regclass('public.products') IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'images'
    ) THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT ''products''::text AS module, images::text AS content FROM public.products WHERE images IS NOT NULL';
    has_part := true;
  END IF;

  IF to_regclass('public.portfolio') IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'portfolio' AND column_name = 'images'
    ) THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT ''portfolio''::text AS module, images::text AS content FROM public.portfolio WHERE images IS NOT NULL';
    has_part := true;
  END IF;

  IF to_regclass('public.photo_gallery') IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'photo_gallery' AND column_name = 'photos'
    ) THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT ''photo_gallery''::text AS module, photos::text AS content FROM public.photo_gallery WHERE photos IS NOT NULL';
    has_part := true;
  END IF;

  IF to_regclass('public.testimonies') IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'testimonies' AND column_name = 'author_image'
    ) THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT ''testimonies''::text AS module, author_image AS content FROM public.testimonies WHERE author_image IS NOT NULL';
    has_part := true;
  END IF;

  IF NOT has_part THEN
    RETURN;
  END IF;

  sql := sql || '), file_matches AS (' ||
    ' SELECT f.file_path, ac.module FROM public.files f JOIN all_content ac ON ac.content ILIKE ''%'' || f.file_path || ''%''' ||
    ' ) SELECT fm.file_path, COUNT(*)::bigint AS usage_count, array_agg(DISTINCT fm.module) AS modules FROM file_matches fm GROUP BY fm.file_path';

  RETURN QUERY EXECUTE sql;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_backups()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT public.is_platform_admin(); $function$
;

CREATE OR REPLACE FUNCTION public.can_manage_extension()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT public.is_platform_admin(); $function$
;

CREATE OR REPLACE FUNCTION public.can_manage_extensions()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT public.is_platform_admin(); $function$
;

CREATE OR REPLACE FUNCTION public.can_manage_logs()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT public.is_platform_admin(); $function$
;

CREATE OR REPLACE FUNCTION public.can_manage_monitoring()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT public.is_platform_admin(); $function$
;

CREATE OR REPLACE FUNCTION public.can_manage_resource()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT public.is_admin_or_above(); $function$
;

CREATE OR REPLACE FUNCTION public.can_manage_settings()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT public.is_platform_admin(); $function$
;

CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(p_name text, p_slug text, p_domain text DEFAULT NULL::text, p_tier text DEFAULT 'free'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.create_tenant_with_defaults(
    p_name,
    p_slug,
    p_domain,
    p_tier,
    NULL,
    'auto'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_detailed_tag_usage()
 RETURNS TABLE(tag_id uuid, tag_name text, tag_slug text, tag_color text, tag_icon text, tag_is_active boolean, tag_description text, tag_created_at timestamp with time zone, tag_updated_at timestamp with time zone, module text, count bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  sql text := '';
  has_part boolean := false;
BEGIN
  tag_id := NULL;
  tag_name := NULL;
  tag_slug := NULL;
  tag_color := NULL;
  tag_icon := NULL;
  tag_is_active := NULL;
  tag_description := NULL;
  tag_created_at := NULL;
  tag_updated_at := NULL;
  module := NULL;
  count := 0;
  IF to_regclass('public.article_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''articles''::text, count(at.tag_id)::bigint '
      'FROM public.tags t JOIN public.article_tags at ON t.id = at.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.page_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''pages''::text, count(pt.tag_id)::bigint '
      'FROM public.tags t JOIN public.page_tags pt ON t.id = pt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.product_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''products''::text, count(prt.tag_id)::bigint '
      'FROM public.tags t JOIN public.product_tags prt ON t.id = prt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.portfolio_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''portfolio''::text, count(pot.tag_id)::bigint '
      'FROM public.tags t JOIN public.portfolio_tags pot ON t.id = pot.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.announcement_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''announcements''::text, count(ant.tag_id)::bigint '
      'FROM public.tags t JOIN public.announcement_tags ant ON t.id = ant.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.promotion_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''promotions''::text, count(prmt.tag_id)::bigint '
      'FROM public.tags t JOIN public.promotion_tags prmt ON t.id = prmt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.testimony_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''testimonies''::text, count(tt.tag_id)::bigint '
      'FROM public.tags t JOIN public.testimony_tags tt ON t.id = tt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.photo_gallery_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''photo_gallery''::text, count(pgt.tag_id)::bigint '
      'FROM public.tags t JOIN public.photo_gallery_tags pgt ON t.id = pgt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.video_gallery_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''video_gallery''::text, count(vgt.tag_id)::bigint '
      'FROM public.tags t JOIN public.video_gallery_tags vgt ON t.id = vgt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.contact_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''contacts''::text, count(ct.tag_id)::bigint '
      'FROM public.tags t JOIN public.contact_tags ct ON t.id = ct.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.contact_message_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''contact_messages''::text, count(cmt.tag_id)::bigint '
      'FROM public.tags t JOIN public.contact_message_tags cmt ON t.id = cmt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF to_regclass('public.product_type_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END ||
      'SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, ''product_types''::text, count(ptt.tag_id)::bigint '
      'FROM public.tags t JOIN public.product_type_tags ptt ON t.id = ptt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id';
    has_part := true;
  END IF;

  IF NOT has_part THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE sql;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  role_name text;
BEGIN
  SELECT r.name INTO role_name
  FROM public.users u
  JOIN public.roles r ON u.role_id = r.id
  WHERE u.id = (SELECT auth.uid())
    AND r.deleted_at IS NULL
  LIMIT 1;

  IF role_name IS NULL THEN
    SELECT r.name INTO role_name
    FROM public.roles r
    WHERE r.is_guest = true
      AND r.deleted_at IS NULL
      AND (r.tenant_id = public.current_tenant_id() OR r.tenant_id IS NULL)
    ORDER BY r.tenant_id NULLS LAST
    LIMIT 1;
  END IF;

  RETURN COALESCE(role_name, 'guest');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_role_name()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.get_my_role();
$function$
;

CREATE OR REPLACE FUNCTION public.get_tags_with_counts()
 RETURNS TABLE(tag text, cnt bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  sql text := 'WITH all_tag_links AS (';
  has_part boolean := false;
BEGIN
  tag := NULL;
  cnt := 0;
  IF to_regclass('public.product_type_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.product_type_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.article_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.article_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.page_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.page_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.product_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.product_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.promotion_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.promotion_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.portfolio_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.portfolio_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.photo_gallery_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.photo_gallery_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.video_gallery_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.video_gallery_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.contact_message_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.contact_message_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.testimony_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.testimony_tags';
    has_part := true;
  END IF;
  IF to_regclass('public.announcement_tags') IS NOT NULL THEN
    sql := sql || CASE WHEN has_part THEN ' UNION ALL ' ELSE '' END || 'SELECT tag_id FROM public.announcement_tags';
    has_part := true;
  END IF;

  IF NOT has_part THEN
    RETURN;
  END IF;

  sql := sql || ') SELECT t.name::text AS tag, COUNT(1)::bigint AS cnt FROM all_tag_links l JOIN public.tags t ON t.id = l.tag_id GROUP BY t.name ORDER BY cnt DESC';
  RETURN QUERY EXECUTE sql;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    default_role_id UUID;
    pending_role_id UUID;
    target_tenant_id UUID;
    primary_tenant_id UUID;
    is_public_registration BOOLEAN;
    initial_approval_status TEXT;
BEGIN
    BEGIN
        is_public_registration := COALESCE((NEW.raw_user_meta_data->>'public_registration')::BOOLEAN, FALSE);
    EXCEPTION WHEN OTHERS THEN
        is_public_registration := FALSE;
    END;

    BEGIN
        target_tenant_id := (NEW.raw_user_meta_data->>'tenant_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
        target_tenant_id := NULL;
    END;

    SELECT id INTO primary_tenant_id FROM public.tenants WHERE slug = 'primary' LIMIT 1;

    IF target_tenant_id IS NULL THEN
        target_tenant_id := primary_tenant_id;
    END IF;

    IF is_public_registration THEN
        SELECT id INTO pending_role_id
        FROM public.roles
        WHERE is_default_public_registration = true
          AND deleted_at IS NULL
          AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
        ORDER BY tenant_id NULLS LAST, created_at ASC
        LIMIT 1;

        IF pending_role_id IS NULL THEN
            SELECT id INTO pending_role_id
            FROM public.roles
            WHERE is_public = true
              AND deleted_at IS NULL
              AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
            ORDER BY tenant_id NULLS LAST, created_at ASC
            LIMIT 1;
        END IF;

        IF pending_role_id IS NULL THEN
            SELECT id INTO pending_role_id
            FROM public.roles
            WHERE is_guest = true
              AND deleted_at IS NULL
              AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
            ORDER BY tenant_id NULLS LAST, created_at ASC
            LIMIT 1;
        END IF;

        default_role_id := pending_role_id;
        initial_approval_status := 'pending_admin';
    ELSE
        SELECT id INTO default_role_id
        FROM public.roles
        WHERE is_default_invite = true
          AND deleted_at IS NULL
          AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
        ORDER BY tenant_id NULLS LAST, created_at ASC
        LIMIT 1;

        IF default_role_id IS NULL THEN
            SELECT id INTO default_role_id
            FROM public.roles
            WHERE deleted_at IS NULL
              AND tenant_id = target_tenant_id
              AND is_guest = false
              AND is_public = false
              AND is_tenant_admin = false
              AND is_platform_admin = false
              AND is_full_access = false
            ORDER BY is_staff ASC, staff_level DESC NULLS LAST, created_at ASC
            LIMIT 1;
        END IF;

        IF default_role_id IS NULL THEN
            SELECT id INTO default_role_id
            FROM public.roles
            WHERE deleted_at IS NULL
              AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
              AND (is_guest = true OR is_public = true)
            ORDER BY tenant_id NULLS LAST, created_at ASC
            LIMIT 1;
        END IF;

        initial_approval_status := 'approved';
    END IF;

    INSERT INTO public.users (
        id,
        email,
        full_name,
        role_id,
        tenant_id,
        approval_status,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        default_role_id,
        target_tenant_id,
        initial_approval_status,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
        updated_at = NOW();

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_permission(permission_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  has_perm boolean;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = (SELECT auth.uid())
      AND r.deleted_at IS NULL
      AND (r.is_full_access OR r.is_platform_admin OR r.is_tenant_admin)
  ) THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    JOIN public.role_permissions rp ON r.id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE u.id = (SELECT auth.uid())
      AND r.deleted_at IS NULL
      AND rp.deleted_at IS NULL
      AND p.deleted_at IS NULL
      AND p.name = permission_name
  ) INTO has_perm;

  RETURN has_perm;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_article_view(article_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target_table regclass;
BEGIN
  target_table := to_regclass('public.articles');
  IF target_table IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'articles' AND column_name = 'views'
  ) THEN
    EXECUTE format('UPDATE %s SET views = COALESCE(views, 0) + 1 WHERE id = $1', target_table) USING article_id;
    RETURN;
  END IF;

  target_table := to_regclass('public.blogs');
  IF target_table IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'blogs' AND column_name = 'views'
  ) THEN
    EXECUTE format('UPDATE %s SET views = COALESCE(views, 0) + 1 WHERE id = $1', target_table) USING article_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin_or_above()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
      AND r.deleted_at IS NULL
      AND (r.is_tenant_admin OR r.is_platform_admin OR r.is_full_access)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_media_manage_role()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_admin_or_above()
    OR public.has_permission('view_files')
    OR public.has_permission('create_files')
    OR public.has_permission('edit_files')
    OR public.has_permission('delete_files');
$function$
;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
      AND r.deleted_at IS NULL
      AND r.is_platform_admin = true
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.is_platform_admin();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_resource_tags(p_resource_id uuid, p_resource_type text, p_tags text[], p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_id UUID;
  v_tag_name TEXT;
  v_slug TEXT;
  target_table regclass := to_regclass('public.resource_tags');
BEGIN
  IF target_table IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format('DELETE FROM %s WHERE resource_id = $1 AND resource_type = $2', target_table)
    USING p_resource_id, p_resource_type;

  IF p_tags IS NOT NULL THEN
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
      v_slug := trim(both '-' from lower(regexp_replace(v_tag_name, '[^a-zA-Z0-9]+', '-', 'g')));

      INSERT INTO public.tags (name, slug, tenant_id)
      VALUES (v_tag_name, v_slug, p_tenant_id)
      ON CONFLICT (tenant_id, slug) DO UPDATE SET name = v_tag_name
      RETURNING id INTO v_tag_id;

      EXECUTE format('INSERT INTO %s (resource_id, resource_type, tag_id) VALUES ($1, $2, $3)', target_table)
        USING p_resource_id, p_resource_type, v_tag_id;
    END LOOP;
  END IF;
END;
$function$
;

grant delete on table "public"."tenant_resource_registry" to "anon";

grant insert on table "public"."tenant_resource_registry" to "anon";

grant references on table "public"."tenant_resource_registry" to "anon";

grant select on table "public"."tenant_resource_registry" to "anon";

grant trigger on table "public"."tenant_resource_registry" to "anon";

grant truncate on table "public"."tenant_resource_registry" to "anon";

grant update on table "public"."tenant_resource_registry" to "anon";

grant delete on table "public"."tenant_resource_registry" to "authenticated";

grant insert on table "public"."tenant_resource_registry" to "authenticated";

grant references on table "public"."tenant_resource_registry" to "authenticated";

grant select on table "public"."tenant_resource_registry" to "authenticated";

grant trigger on table "public"."tenant_resource_registry" to "authenticated";

grant truncate on table "public"."tenant_resource_registry" to "authenticated";

grant update on table "public"."tenant_resource_registry" to "authenticated";

grant delete on table "public"."tenant_resource_registry" to "service_role";

grant insert on table "public"."tenant_resource_registry" to "service_role";

grant references on table "public"."tenant_resource_registry" to "service_role";

grant select on table "public"."tenant_resource_registry" to "service_role";

grant trigger on table "public"."tenant_resource_registry" to "service_role";

grant truncate on table "public"."tenant_resource_registry" to "service_role";

grant update on table "public"."tenant_resource_registry" to "service_role";

grant delete on table "public"."tenant_resource_rules" to "anon";

grant insert on table "public"."tenant_resource_rules" to "anon";

grant references on table "public"."tenant_resource_rules" to "anon";

grant select on table "public"."tenant_resource_rules" to "anon";

grant trigger on table "public"."tenant_resource_rules" to "anon";

grant truncate on table "public"."tenant_resource_rules" to "anon";

grant update on table "public"."tenant_resource_rules" to "anon";

grant delete on table "public"."tenant_resource_rules" to "authenticated";

grant insert on table "public"."tenant_resource_rules" to "authenticated";

grant references on table "public"."tenant_resource_rules" to "authenticated";

grant select on table "public"."tenant_resource_rules" to "authenticated";

grant trigger on table "public"."tenant_resource_rules" to "authenticated";

grant truncate on table "public"."tenant_resource_rules" to "authenticated";

grant update on table "public"."tenant_resource_rules" to "authenticated";

grant delete on table "public"."tenant_resource_rules" to "service_role";

grant insert on table "public"."tenant_resource_rules" to "service_role";

grant references on table "public"."tenant_resource_rules" to "service_role";

grant select on table "public"."tenant_resource_rules" to "service_role";

grant trigger on table "public"."tenant_resource_rules" to "service_role";

grant truncate on table "public"."tenant_resource_rules" to "service_role";

grant update on table "public"."tenant_resource_rules" to "service_role";

grant delete on table "public"."tenant_role_links" to "anon";

grant insert on table "public"."tenant_role_links" to "anon";

grant references on table "public"."tenant_role_links" to "anon";

grant select on table "public"."tenant_role_links" to "anon";

grant trigger on table "public"."tenant_role_links" to "anon";

grant truncate on table "public"."tenant_role_links" to "anon";

grant update on table "public"."tenant_role_links" to "anon";

grant delete on table "public"."tenant_role_links" to "authenticated";

grant insert on table "public"."tenant_role_links" to "authenticated";

grant references on table "public"."tenant_role_links" to "authenticated";

grant select on table "public"."tenant_role_links" to "authenticated";

grant trigger on table "public"."tenant_role_links" to "authenticated";

grant truncate on table "public"."tenant_role_links" to "authenticated";

grant update on table "public"."tenant_role_links" to "authenticated";

grant delete on table "public"."tenant_role_links" to "service_role";

grant insert on table "public"."tenant_role_links" to "service_role";

grant references on table "public"."tenant_role_links" to "service_role";

grant select on table "public"."tenant_role_links" to "service_role";

grant trigger on table "public"."tenant_role_links" to "service_role";

grant truncate on table "public"."tenant_role_links" to "service_role";

grant update on table "public"."tenant_role_links" to "service_role";


  create policy "blog_tags_delete_hierarchy"
  on "public"."blog_tags"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "blog_tags_insert_hierarchy"
  on "public"."blog_tags"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "blog_tags_select_hierarchy"
  on "public"."blog_tags"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "blog_tags_update_hierarchy"
  on "public"."blog_tags"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "blogs_delete_hierarchy"
  on "public"."blogs"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "blogs_insert_hierarchy"
  on "public"."blogs"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "blogs_select_hierarchy"
  on "public"."blogs"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "blogs_update_hierarchy"
  on "public"."blogs"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_menu_items_delete_hierarchy"
  on "public"."extension_menu_items"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_menu_items_insert_hierarchy"
  on "public"."extension_menu_items"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_menu_items_select_hierarchy"
  on "public"."extension_menu_items"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "extension_menu_items_update_hierarchy"
  on "public"."extension_menu_items"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_permissions_delete_hierarchy"
  on "public"."extension_permissions"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_permissions_insert_hierarchy"
  on "public"."extension_permissions"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_permissions_select_hierarchy"
  on "public"."extension_permissions"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "extension_permissions_update_hierarchy"
  on "public"."extension_permissions"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_rbac_delete_hierarchy"
  on "public"."extension_rbac_integration"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_rbac_insert_hierarchy"
  on "public"."extension_rbac_integration"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_rbac_select_hierarchy"
  on "public"."extension_rbac_integration"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "extension_rbac_update_hierarchy"
  on "public"."extension_rbac_integration"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_routes_registry_delete_hierarchy"
  on "public"."extension_routes_registry"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_routes_registry_insert_hierarchy"
  on "public"."extension_routes_registry"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_routes_registry_select_hierarchy"
  on "public"."extension_routes_registry"
  as permissive
  for select
  to public
using (((deleted_at IS NULL) AND ((is_active = true) OR public.is_platform_admin()) AND ((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'read'::text) OR public.is_platform_admin())));



  create policy "extension_routes_registry_update_hierarchy"
  on "public"."extension_routes_registry"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extensions_delete_hierarchy"
  on "public"."extensions"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extensions_insert_hierarchy"
  on "public"."extensions"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extensions_select_hierarchy"
  on "public"."extensions"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "extensions_update_hierarchy"
  on "public"."extensions"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "files_delete_hierarchy"
  on "public"."files"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'media'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "files_insert_hierarchy"
  on "public"."files"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'media'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "files_select_hierarchy"
  on "public"."files"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'media'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "files_update_hierarchy"
  on "public"."files"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'media'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'media'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "menus_delete_hierarchy"
  on "public"."menus"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "menus_insert_hierarchy"
  on "public"."menus"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "menus_select_hierarchy"
  on "public"."menus"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "menus_update_hierarchy"
  on "public"."menus"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "page_categories_delete_hierarchy"
  on "public"."page_categories"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "page_categories_insert_hierarchy"
  on "public"."page_categories"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "page_categories_select_hierarchy"
  on "public"."page_categories"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "page_categories_update_hierarchy"
  on "public"."page_categories"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "page_tags_delete_hierarchy"
  on "public"."page_tags"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "page_tags_insert_hierarchy"
  on "public"."page_tags"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "page_tags_select_hierarchy"
  on "public"."page_tags"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "page_tags_update_hierarchy"
  on "public"."page_tags"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "pages_delete_hierarchy"
  on "public"."pages"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "pages_insert_hierarchy"
  on "public"."pages"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "pages_select_hierarchy"
  on "public"."pages"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "pages_update_hierarchy"
  on "public"."pages"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "role_permissions_select_hierarchy"
  on "public"."role_permissions"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'read'::text) OR public.is_platform_admin())))));



  create policy "role_permissions_update_hierarchy"
  on "public"."role_permissions"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin())))))
with check ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin())))));



  create policy "role_policies_select_hierarchy"
  on "public"."role_policies"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_policies.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'read'::text) OR public.is_platform_admin())))));



  create policy "role_policies_update_hierarchy"
  on "public"."role_policies"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_policies.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin())))))
with check ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_policies.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin())))));



  create policy "roles_select_hierarchy"
  on "public"."roles"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'roles'::text, 'read'::text) OR public.is_platform_admin() OR (tenant_id IS NULL)));



  create policy "roles_update_hierarchy"
  on "public"."roles"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "services_delete_hierarchy"
  on "public"."services"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "services_insert_hierarchy"
  on "public"."services"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "services_select_hierarchy"
  on "public"."services"
  as permissive
  for select
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "services_update_hierarchy"
  on "public"."services"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "settings_delete_hierarchy"
  on "public"."settings"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "settings_insert_hierarchy"
  on "public"."settings"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "settings_select_hierarchy"
  on "public"."settings"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "settings_update_hierarchy"
  on "public"."settings"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "templates_delete_hierarchy"
  on "public"."templates"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "templates_insert_hierarchy"
  on "public"."templates"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "templates_select_hierarchy"
  on "public"."templates"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "templates_update_hierarchy"
  on "public"."templates"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "tenant_resource_registry_select"
  on "public"."tenant_resource_registry"
  as permissive
  for select
  to authenticated
using (true);



  create policy "tenant_resource_rules_delete"
  on "public"."tenant_resource_rules"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_resource_rules_insert"
  on "public"."tenant_resource_rules"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_resource_rules_select"
  on "public"."tenant_resource_rules"
  as permissive
  for select
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "tenant_resource_rules_update"
  on "public"."tenant_resource_rules"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()))
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_role_links_delete"
  on "public"."tenant_role_links"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_role_links_insert"
  on "public"."tenant_role_links"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_role_links_select"
  on "public"."tenant_role_links"
  as permissive
  for select
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "tenant_role_links_update"
  on "public"."tenant_role_links"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()))
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "testimonies_delete_hierarchy"
  on "public"."testimonies"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "testimonies_insert_hierarchy"
  on "public"."testimonies"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "testimonies_select_hierarchy"
  on "public"."testimonies"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "testimonies_update_hierarchy"
  on "public"."testimonies"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "themes_delete_hierarchy"
  on "public"."themes"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "themes_insert_hierarchy"
  on "public"."themes"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "themes_select_hierarchy"
  on "public"."themes"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "themes_update_hierarchy"
  on "public"."themes"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "users_select_hierarchy"
  on "public"."users"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "users_update_hierarchy"
  on "public"."users"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "widgets_delete_hierarchy"
  on "public"."widgets"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "widgets_insert_hierarchy"
  on "public"."widgets"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "widgets_select_hierarchy"
  on "public"."widgets"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "widgets_update_hierarchy"
  on "public"."widgets"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "notification_readers_select_policy"
  on "public"."notification_readers"
  as permissive
  for select
  to public
using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "Users view own orders"
  on "public"."orders"
  as permissive
  for select
  to public
using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = public.current_tenant_id()) AND public.has_permission('view_orders'::text)) OR public.is_platform_admin()));



  create policy "Admins View SSO Logs"
  on "public"."sso_audit_logs"
  as permissive
  for select
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.sso.read'::text)) OR public.is_platform_admin()));



  create policy "testimony_tags_delete"
  on "public"."testimony_tags"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.has_permission('edit_testimonies'::text)) OR public.is_platform_admin()));



  create policy "testimony_tags_insert"
  on "public"."testimony_tags"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.has_permission('edit_testimonies'::text)) OR public.is_platform_admin()));



  create policy "testimony_tags_update"
  on "public"."testimony_tags"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.has_permission('edit_testimonies'::text)) OR public.is_platform_admin()));


CREATE TRIGGER set_extension_menu_items_tenant_id BEFORE INSERT OR UPDATE ON public.extension_menu_items FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

CREATE TRIGGER set_extension_permissions_tenant_id BEFORE INSERT OR UPDATE ON public.extension_permissions FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

CREATE TRIGGER set_extension_rbac_integration_tenant_id BEFORE INSERT OR UPDATE ON public.extension_rbac_integration FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

CREATE TRIGGER set_extension_routes_registry_tenant_id BEFORE INSERT OR UPDATE ON public.extension_routes_registry FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

CREATE TRIGGER refresh_tenant_subtree AFTER UPDATE OF parent_tenant_id ON public.tenants FOR EACH ROW WHEN ((old.parent_tenant_id IS DISTINCT FROM new.parent_tenant_id)) EXECUTE FUNCTION public.refresh_tenant_subtree_trigger();

CREATE TRIGGER set_tenant_hierarchy BEFORE INSERT OR UPDATE OF parent_tenant_id ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.set_tenant_hierarchy();


