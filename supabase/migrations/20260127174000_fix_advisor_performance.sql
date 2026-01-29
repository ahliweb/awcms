CREATE OR REPLACE FUNCTION public.analyze_file_usage() RETURNS TABLE(file_path text, usage_count bigint, modules text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.get_detailed_tag_usage() RETURNS TABLE(tag_id uuid, tag_name text, tag_slug text, tag_color text, tag_icon text, tag_is_active boolean, tag_description text, tag_created_at timestamptz, tag_updated_at timestamptz, module text, count bigint)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.get_tags_with_counts() RETURNS TABLE(tag text, cnt bigint)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.increment_article_view(article_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.sync_resource_tags(p_resource_id uuid, p_resource_type text, p_tags text[], p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

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
$$;

CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(
  p_name text,
  p_slug text,
  p_domain text DEFAULT NULL::text,
  p_tier text DEFAULT 'free'::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;
