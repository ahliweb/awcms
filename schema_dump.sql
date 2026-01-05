


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."analyze_file_usage"() RETURNS TABLE("file_path" "text", "usage_count" bigint, "modules" "text"[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    WITH all_content AS (
        SELECT 'articles'::text as module, featured_image as content FROM articles WHERE featured_image IS NOT NULL
        UNION ALL SELECT 'articles', content FROM articles WHERE content IS NOT NULL
        UNION ALL SELECT 'pages', featured_image FROM pages WHERE featured_image IS NOT NULL
        UNION ALL SELECT 'pages', content FROM pages WHERE content IS NOT NULL
        UNION ALL SELECT 'products', images::text FROM products WHERE images IS NOT NULL
        UNION ALL SELECT 'portfolio', images::text FROM portfolio WHERE images IS NOT NULL
        UNION ALL SELECT 'photo_gallery', photos::text FROM photo_gallery WHERE photos IS NOT NULL
        UNION ALL SELECT 'testimonies', author_image FROM testimonies WHERE author_image IS NOT NULL
    ),
    file_matches AS (
        SELECT 
            f.file_path,
            ac.module
        FROM files f
        JOIN all_content ac ON ac.content ILIKE '%' || f.file_path || '%'
    )
    SELECT 
        fm.file_path,
        COUNT(*)::bigint as usage_count,
        array_agg(DISTINCT fm.module) as modules
    FROM file_matches fm
    GROUP BY fm.file_path;
END;
$$;


ALTER FUNCTION "public"."analyze_file_usage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_delete_resource"("resource_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.has_permission('delete_' || resource_name); $$;


ALTER FUNCTION "public"."can_delete_resource"("resource_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_edit_resource"("resource_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.has_permission('edit_' || resource_name); $$;


ALTER FUNCTION "public"."can_edit_resource"("resource_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_backups"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.get_my_role() = 'super_admin'; $$;


ALTER FUNCTION "public"."can_manage_backups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_extension"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.get_my_role() = 'super_admin'; $$;


ALTER FUNCTION "public"."can_manage_extension"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_extensions"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.get_my_role() = 'super_admin'; $$;


ALTER FUNCTION "public"."can_manage_extensions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_logs"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.get_my_role() = 'super_admin'; $$;


ALTER FUNCTION "public"."can_manage_logs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_monitoring"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.get_my_role() = 'super_admin'; $$;


ALTER FUNCTION "public"."can_manage_monitoring"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_resource"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.get_my_role() IN ('super_admin', 'admin'); $$;


ALTER FUNCTION "public"."can_manage_resource"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_roles"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.has_permission('view_roles') AND public.has_permission('edit_roles'); $$;


ALTER FUNCTION "public"."can_manage_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_settings"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.get_my_role() = 'super_admin'; $$;


ALTER FUNCTION "public"."can_manage_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_users"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.has_permission('view_users') AND public.has_permission('edit_users'); $$;


ALTER FUNCTION "public"."can_manage_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_publish_resource"("resource_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.has_permission('publish_' || resource_name); $$;


ALTER FUNCTION "public"."can_publish_resource"("resource_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_restore_resource"("resource_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.has_permission('restore_' || resource_name); $$;


ALTER FUNCTION "public"."can_restore_resource"("resource_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_resource"("resource_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT public.has_permission('view_' || resource_name); $$;


ALTER FUNCTION "public"."can_view_resource"("resource_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_access"("resource_owner_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_role text;
    v_uid uuid;
BEGIN
    v_uid := (SELECT auth.uid());
    -- Use the existing efficient get_my_role function
    v_role := (SELECT public.get_my_role());
    
    -- Super admins and admins have full access
    IF v_role IN ('super_admin', 'admin') THEN
        RETURN true;
    END IF;
    
    -- Editors/Users can access their own resources
    IF v_uid = resource_owner_id THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$;


ALTER FUNCTION "public"."check_access"("resource_owner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_public_permission"("permission_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  has_perm boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE r.name = 'public'
    AND p.name = permission_name
  ) INTO has_perm;
  RETURN has_perm;
END;
$$;


ALTER FUNCTION "public"."check_public_permission"("permission_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_tenant_limit"("check_tenant_id" "uuid", "feature_key" "text", "proposed_usage" bigint DEFAULT 0) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    tier TEXT;
    current_usage BIGINT := 0;
    max_limit BIGINT;
BEGIN
    -- Get Tenant Tier
    SELECT subscription_tier INTO tier
    FROM public.tenants
    WHERE id = check_tenant_id;

    -- Define Limits based on Tier
    -- Users Limit (count)
    IF feature_key = 'max_users' THEN
        IF tier = 'enterprise' THEN max_limit := -1; -- Unlimited
        ELSIF tier = 'pro' THEN max_limit := 50;
        ELSE max_limit := 5; -- Free
        END IF;
        
        -- Get Current Usage
        SELECT count(*) INTO current_usage
        FROM public.users
        WHERE tenant_id = check_tenant_id;

    -- Storage Limit (bytes)
    ELSIF feature_key = 'max_storage' THEN
        IF tier = 'enterprise' THEN max_limit := -1; -- Unlimited
        ELSIF tier = 'pro' THEN max_limit := 10737418240; -- 10GB
        ELSE max_limit := 104857600; -- 100MB
        END IF;

        -- Get Current Usage
        SELECT COALESCE(SUM(file_size), 0) INTO current_usage
        FROM public.files
        WHERE tenant_id = check_tenant_id AND deleted_at IS NULL;
    END IF;

    -- Check Limit (-1 means unlimited)
    IF max_limit = -1 THEN
        RETURN TRUE;
    END IF;

    -- For storage, we add the proposed file size. For users, the trigger happens BEFORE insert, so current usage is existing users.
    -- If adding a user, proposed_usage should be 1.
    -- If adding a file, proposed_usage is the file size.
    
    IF (current_usage + proposed_usage) > max_limit THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."check_tenant_limit"("check_tenant_id" "uuid", "feature_key" "text", "proposed_usage" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_tenant_with_defaults"("p_name" "text", "p_slug" "text", "p_domain" "text" DEFAULT NULL::"text", "p_tier" "text" DEFAULT 'free'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_tenant_id uuid;
    v_admin_role_id uuid;
BEGIN
    -- 1. Create Tenant
    INSERT INTO public.tenants (name, slug, domain, subscription_tier, status)
    VALUES (p_name, p_slug, p_domain, p_tier, 'active')
    RETURNING id INTO v_tenant_id;

    -- 2. Create Default Roles (Scoped to Tenant)
    -- Admin
    INSERT INTO public.roles (name, description, tenant_id, is_system)
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true)
    RETURNING id INTO v_admin_role_id;

    -- Editor
    INSERT INTO public.roles (name, description, tenant_id, is_system)
    VALUES ('editor', 'Content Editor', v_tenant_id, true);

    -- Author
    INSERT INTO public.roles (name, description, tenant_id, is_system)
    VALUES ('author', 'Content Author', v_tenant_id, true);

    -- 3. Create Default Pages (Home, About, Contact)
    -- Homepage
    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id, 
        'Home', 
        'home', 
        '{"root":{"props":{"title":"Home"},"children":[]}}', 
        'published', 
        true, 
        'homepage', 
        (SELECT auth.uid()) -- Safe auth.uid() usage
    );

    -- About
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

    -- 4. Create Default Menu Items (Header)
    -- Fixed to match schema: label, url, group_label, is_public, order
    
    -- Home Link
    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'Home', '/', 'header', true, true, 1);

    -- About Link
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


ALTER FUNCTION "public"."create_tenant_with_defaults"("p_name" "text", "p_slug" "text", "p_domain" "text", "p_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_tenant_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  config_tenant text;
BEGIN
  -- 1. Try JWT (Auth)
  IF (auth.jwt() -> 'app_metadata' ->> 'tenant_id') IS NOT NULL THEN
    RETURN (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
  END IF;

  -- 2. Try User Record (Auth)
  IF auth.uid() IS NOT NULL THEN
     RETURN (SELECT tenant_id FROM public.users WHERE id = auth.uid());
  END IF;

  -- 3. Try Config (Anon / Pre-request hook)
  config_tenant := current_setting('app.current_tenant_id', true);
  IF config_tenant IS NOT NULL AND config_tenant ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN config_tenant::uuid;
  END IF;

  RETURN NULL;
END;
$_$;


ALTER FUNCTION "public"."current_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_storage_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    limit_ok BOOLEAN;
BEGIN
    IF NEW.tenant_id IS NOT NULL AND NEW.file_size IS NOT NULL THEN
        -- Check limit (proposed usage is the new file's size)
        limit_ok := public.check_tenant_limit(NEW.tenant_id, 'max_storage', NEW.file_size);
        
        IF NOT limit_ok THEN
            RAISE EXCEPTION 'Tenant storage quota exceeded. Upgrade your plan to upload more files.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_storage_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_user_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    limit_ok BOOLEAN;
BEGIN
    -- Only check if tenant_id is set
    IF NEW.tenant_id IS NOT NULL THEN
        -- Check limit (proposed usage 1 because we are adding 1 user)
        limit_ok := public.check_tenant_limit(NEW.tenant_id, 'max_users', 1);
        
        IF NOT limit_ok THEN
            RAISE EXCEPTION 'Tenant user quota exceeded. Upgrade your plan to add more users.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_user_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_single_active_theme"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE themes SET is_active = false WHERE id != NEW.id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_single_active_theme"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_detailed_tag_usage"() RETURNS TABLE("tag_id" "uuid", "tag_name" "text", "tag_slug" "text", "tag_color" "text", "tag_icon" "text", "tag_is_active" boolean, "tag_description" "text", "tag_created_at" timestamp with time zone, "tag_updated_at" timestamp with time zone, "module" "text", "count" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'articles'::text, count(at.tag_id)::bigint FROM tags t JOIN article_tags at ON t.id = at.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'pages'::text, count(pt.tag_id)::bigint FROM tags t JOIN page_tags pt ON t.id = pt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'products'::text, count(prt.tag_id)::bigint FROM tags t JOIN product_tags prt ON t.id = prt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'portfolio'::text, count(pot.tag_id)::bigint FROM tags t JOIN portfolio_tags pot ON t.id = pot.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'announcements'::text, count(ant.tag_id)::bigint FROM tags t JOIN announcement_tags ant ON t.id = ant.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'promotions'::text, count(prmt.tag_id)::bigint FROM tags t JOIN promotion_tags prmt ON t.id = prmt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'testimonies'::text, count(tt.tag_id)::bigint FROM tags t JOIN testimony_tags tt ON t.id = tt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'photo_gallery'::text, count(pgt.tag_id)::bigint FROM tags t JOIN photo_gallery_tags pgt ON t.id = pgt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'video_gallery'::text, count(vgt.tag_id)::bigint FROM tags t JOIN video_gallery_tags vgt ON t.id = vgt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'contacts'::text, count(ct.tag_id)::bigint FROM tags t JOIN contact_tags ct ON t.id = ct.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'contact_messages'::text, count(cmt.tag_id)::bigint FROM tags t JOIN contact_message_tags cmt ON t.id = cmt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id
    UNION ALL
    SELECT t.id, t.name, t.slug, t.color, t.icon, t.is_active, t.description, t.created_at, t.updated_at, 'product_types'::text, count(ptt.tag_id)::bigint FROM tags t JOIN product_type_tags ptt ON t.id = ptt.tag_id WHERE t.deleted_at IS NULL GROUP BY t.id;
END;
$$;


ALTER FUNCTION "public"."get_detailed_tag_usage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_permissions"() RETURNS "text"[]
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  perms text[];
BEGIN
  SELECT ARRAY_AGG(p.name)
  INTO perms
  FROM public.users u
  JOIN public.roles r ON u.role_id = r.id
  JOIN public.role_permissions rp ON r.id = rp.role_id
  JOIN public.permissions p ON rp.permission_id = p.id
  WHERE u.id = (SELECT auth.uid());
  
  RETURN COALESCE(perms, ARRAY[]::text[]);
END;
$$;


ALTER FUNCTION "public"."get_my_permissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  role_name text;
  user_email text;
BEGIN
  -- Wrap current_setting in a subquery for safety, though STABLE handles it well
  user_email := (SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'email');
  
  -- Hardcoded super admin check for safety
  IF user_email = 'cms@ahliweb.com' THEN
    RETURN 'super_admin';
  END IF;

  -- Efficient query for role name
  SELECT r.name INTO role_name
  FROM public.users u
  JOIN public.roles r ON u.role_id = r.id
  WHERE u.id = (SELECT auth.uid());
  
  RETURN COALESCE(role_name, 'guest');
END;
$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role_name"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT r.name
  FROM public.users u
  JOIN public.roles r ON u.role_id = r.id
  WHERE u.id = (select auth.uid()) -- Wrap here too just in case
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_my_role_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_storage_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    total_files bigint;
    total_size bigint;
    image_count bigint;
    video_count bigint;
    doc_count bigint;
BEGIN
    -- Basic counts
    SELECT 
        count(*), 
        COALESCE(sum(file_size), 0)
    INTO 
        total_files, 
        total_size
    FROM files
    WHERE deleted_at IS NULL;

    -- Type counts
    SELECT count(*) INTO image_count 
    FROM files 
    WHERE file_type ILIKE 'image/%' AND deleted_at IS NULL;

    SELECT count(*) INTO video_count 
    FROM files 
    WHERE file_type ILIKE 'video/%' AND deleted_at IS NULL;

    SELECT count(*) INTO doc_count 
    FROM files 
    WHERE file_type NOT ILIKE 'image/%' 
      AND file_type NOT ILIKE 'video/%' 
      AND deleted_at IS NULL;

    RETURN jsonb_build_object(
        'total_files', total_files,
        'total_size', total_size,
        'image_count', image_count,
        'video_count', video_count,
        'doc_count', doc_count
    );
END;
$$;


ALTER FUNCTION "public"."get_storage_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tags_with_counts"() RETURNS TABLE("tag" "text", "cnt" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH all_tag_links AS (
    SELECT tag_id FROM public.product_type_tags
    UNION ALL SELECT tag_id FROM public.article_tags
    UNION ALL SELECT tag_id FROM public.page_tags
    UNION ALL SELECT tag_id FROM public.product_tags
    UNION ALL SELECT tag_id FROM public.promotion_tags
    UNION ALL SELECT tag_id FROM public.portfolio_tags
    UNION ALL SELECT tag_id FROM public.photo_gallery_tags
    UNION ALL SELECT tag_id FROM public.video_gallery_tags
    UNION ALL SELECT tag_id FROM public.contact_message_tags
    UNION ALL SELECT tag_id FROM public.testimony_tags
    UNION ALL SELECT tag_id FROM public.announcement_tags
  )
  SELECT t.name::text AS tag, COUNT(1)::bigint AS cnt
  FROM all_tag_links l
  JOIN public.tags t ON t.id = l.tag_id
  GROUP BY t.name
  ORDER BY cnt DESC;
END;
$$;


ALTER FUNCTION "public"."get_tags_with_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tenant_by_domain"("lookup_domain" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSONB;
    target_domain TEXT;
    subdomain TEXT;
    tenant_name TEXT;
    domain_suffix TEXT;
BEGIN
    -- 1. Handle Domain Alias Logic (Same as get_tenant_id_by_host)
    -- Format: primarypublic.ahliweb.com -> primary.ahliweb.com
    
    subdomain := split_part(lookup_domain, '.', 1);
    domain_suffix := substring(lookup_domain from position('.' in lookup_domain) + 1);

    IF subdomain LIKE '%public' AND length(subdomain) > 6 THEN
        tenant_name := left(subdomain, length(subdomain) - 6);
        target_domain := tenant_name || '.' || domain_suffix;
    ELSE
        target_domain := lookup_domain;
    END IF;

    -- 2. Search by custom domain OR slug (subdomain) OR host
    SELECT to_jsonb(t) INTO result
    FROM public.tenants t
    WHERE (t.domain = target_domain OR t.slug = target_domain OR t.host = target_domain)
      AND t.status = 'active'
    LIMIT 1;

    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_tenant_by_domain"("lookup_domain" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tenant_id_by_host"("lookup_host" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  target_host text;
  subdomain text;
  tenant_name text;
  domain_suffix text;
BEGIN
  -- Extract subdomain (first part before first dot)
  subdomain := split_part(lookup_host, '.', 1);
  domain_suffix := substring(lookup_host from position('.' in lookup_host) + 1);
  
  -- Handle Domain Alias: tenantpublic.domain.tld -> tenant.domain.tld
  -- Check if subdomain ends with 'public'
  IF subdomain LIKE '%public' AND length(subdomain) > 6 THEN
      -- Extract tenant name by removing 'public' suffix
      tenant_name := left(subdomain, length(subdomain) - 6);
      target_host := tenant_name || '.' || domain_suffix;
  ELSE
      target_host := lookup_host;
  END IF;

  -- Debug: Log the resolution
  RAISE LOG 'get_tenant_id_by_host: lookup_host=%, subdomain=%, target_host=%', 
            lookup_host, subdomain, target_host;

  -- Lookup Tenant by host or domain
  RETURN (
    SELECT id 
    FROM tenants 
    WHERE host = target_host 
       OR domain = target_host 
    LIMIT 1
  );
END;
$$;


ALTER FUNCTION "public"."get_tenant_id_by_host"("lookup_host" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role_name"("user_uuid" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  role_name text;
BEGIN
  SELECT r.name INTO role_name
  FROM public.users u
  JOIN public.roles r ON u.role_id = r.id
  WHERE u.id = user_uuid;
  
  RETURN role_name;
END;
$$;


ALTER FUNCTION "public"."get_user_role_name"("user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    default_role_id UUID;
    pending_role_id UUID;
    target_tenant_id UUID;
    primary_tenant_id UUID;
    is_public_registration BOOLEAN;
    initial_approval_status TEXT;
BEGIN
    -- 1. Determine if this is a public registration
    -- Public registrations will have 'public_registration' = true in metadata
    BEGIN
        is_public_registration := COALESCE((NEW.raw_user_meta_data->>'public_registration')::BOOLEAN, FALSE);
    EXCEPTION WHEN OTHERS THEN
        is_public_registration := FALSE;
    END;

    -- 2. Determine Tenant
    -- Try to get from metadata (if invited to specific tenant)
    BEGIN
        target_tenant_id := (NEW.raw_user_meta_data->>'tenant_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
        target_tenant_id := NULL;
    END;

    -- If no tenant in metadata, fallback to Primary Tenant
    SELECT id INTO primary_tenant_id FROM public.tenants WHERE slug = 'primary' LIMIT 1;
    
    IF target_tenant_id IS NULL THEN
        target_tenant_id := primary_tenant_id;
    END IF;

    -- 3. Determine Role and Approval Status
    IF is_public_registration THEN
        -- Public registration: assign 'pending' role and set approval_status
        SELECT id INTO pending_role_id 
        FROM public.roles 
        WHERE name = 'pending' 
        LIMIT 1;
        
        default_role_id := pending_role_id;
        initial_approval_status := 'pending_admin';
    ELSE
        -- Admin-created/invited user: assign 'user' role with immediate approval
        SELECT id INTO default_role_id 
        FROM public.roles 
        WHERE name = 'user' AND tenant_id = target_tenant_id
        LIMIT 1;
        
        -- Fallback if no 'user' role in tenant
        IF default_role_id IS NULL THEN
            SELECT id INTO default_role_id 
            FROM public.roles 
            WHERE name = 'subscriber'
            LIMIT 1;
        END IF;
        
        initial_approval_status := 'approved';
    END IF;

    -- 4. Insert into public.users
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
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("permission_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  has_perm boolean;
  v_role text;
BEGIN
  v_role := (SELECT public.get_my_role());
  
  IF v_role = 'super_admin' THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    JOIN public.role_permissions rp ON r.id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE u.id = (SELECT auth.uid())
      AND p.name = permission_name
  ) INTO has_perm;
  
  RETURN has_perm;
END;
$$;


ALTER FUNCTION "public"."has_permission"("permission_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("role_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ SELECT (public.get_my_role() = role_name); $$;


ALTER FUNCTION "public"."has_role"("role_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_article_view"("article_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE articles
  SET views = COALESCE(views, 0) + 1
  WHERE id = article_id;
END;
$$;


ALTER FUNCTION "public"."increment_article_view"("article_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_page_view"("page_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE pages
  SET views = COALESCE(views, 0) + 1
  WHERE id = page_id;
END;
$$;


ALTER FUNCTION "public"."increment_page_view"("page_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_or_above"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  _role_name TEXT;
BEGIN
  _role_name := (auth.jwt() ->> 'role')::TEXT;
  IF _role_name IN ('admin', 'super_admin', 'owner') THEN
    RETURN TRUE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
    AND r.name IN ('admin', 'super_admin', 'owner')
  );
END;
$$;


ALTER FUNCTION "public"."is_admin_or_above"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_platform_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
      BEGIN
        RETURN public.is_super_admin();
      END;
      $$;


ALTER FUNCTION "public"."is_platform_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  _role_name TEXT;
BEGIN
  _role_name := (auth.jwt() ->> 'role')::TEXT;
  IF _role_name IN ('super_admin', 'owner') THEN
    RETURN TRUE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
    AND r.name IN ('super_admin', 'owner')
  );
END;
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_created_by"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."lock_created_by"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    actor_id UUID;
    action_type TEXT;
    payload JSONB;
    captured_tenant_id UUID;
BEGIN
    actor_id := auth.uid();
    
    IF (TG_OP = 'INSERT') THEN
        action_type := 'CREATE';
        payload := to_jsonb(NEW);
    ELSIF (TG_OP = 'UPDATE') THEN
        action_type := 'UPDATE';
        payload := to_jsonb(NEW);
    ELSIF (TG_OP = 'DELETE') THEN
        action_type := 'DELETE';
        payload := to_jsonb(OLD);
    END IF;

    -- Try to capture tenant_id from the changed record
    BEGIN
        captured_tenant_id := (payload->>'tenant_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
        captured_tenant_id := NULL;
    END;

    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource, details, created_at)
    VALUES (
        captured_tenant_id,
        actor_id,
        action_type,
        TG_TABLE_NAME, 
        payload,
        now()
    );

    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."log_audit_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_extension_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- On UPDATE, log the change
  IF TG_OP = 'UPDATE' THEN
    -- Log activation/deactivation
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      INSERT INTO extension_logs (tenant_id, extension_id, extension_slug, action, details, user_id)
      VALUES (
        NEW.tenant_id,
        NEW.id,
        NEW.slug,
        CASE WHEN NEW.is_active THEN 'activate' ELSE 'deactivate' END,
        jsonb_build_object(
          'previous_state', OLD.is_active,
          'new_state', NEW.is_active,
          'version', NEW.version
        ),
        auth.uid()
      );
    END IF;
    
    -- Log config changes
    IF OLD.config IS DISTINCT FROM NEW.config THEN
      INSERT INTO extension_logs (tenant_id, extension_id, extension_slug, action, details, user_id)
      VALUES (
        NEW.tenant_id,
        NEW.id,
        NEW.slug,
        'config_change',
        jsonb_build_object(
          'previous_config', OLD.config,
          'new_config', NEW.config
        ),
        auth.uid()
      );
    END IF;
    
    RETURN NEW;
  END IF;
  
  -- On INSERT (install)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO extension_logs (tenant_id, extension_id, extension_slug, action, details, user_id)
    VALUES (
      NEW.tenant_id,
      NEW.id,
      NEW.slug,
      'install',
      jsonb_build_object(
        'version', NEW.version,
        'extension_type', NEW.extension_type
      ),
      auth.uid()
    );
    RETURN NEW;
  END IF;
  
  -- On DELETE (uninstall)
  IF TG_OP = 'DELETE' THEN
    INSERT INTO extension_logs (tenant_id, extension_id, extension_slug, action, details, user_id)
    VALUES (
      OLD.tenant_id,
      OLD.id,
      OLD.slug,
      'uninstall',
      jsonb_build_object(
        'version', OLD.version,
        'was_active', OLD.is_active
      ),
      auth.uid()
    );
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."log_extension_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_sso_event"("p_provider" "text", "p_event_type" "text", "p_details" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_log_id uuid;
BEGIN
    INSERT INTO public.sso_audit_logs (user_id, provider, event_type, details)
    VALUES ((select auth.uid()), p_provider, p_event_type, p_details)
    RETURNING id INTO v_log_id;
    RETURN v_log_id;
END;
$$;


ALTER FUNCTION "public"."log_sso_event"("p_provider" "text", "p_event_type" "text", "p_details" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_duplicates"("table_name" "text", "column_name" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  normalized_table regclass;
  sch text;
  tbl text;
  unsafe_schemas text[] := ARRAY['pg_catalog','information_schema','extensions','pg_toast','pg_temp'];
BEGIN
  -- Basic identifier checks
  IF table_name IS NULL OR table_name = '' THEN
    RAISE EXCEPTION 'table_name must be provided';
  END IF;
  IF column_name IS NULL OR column_name = '' THEN
    RAISE EXCEPTION 'column_name must be provided';
  END IF;

  -- Try to resolve the table name to regclass (allows schema qualified or unqualified)
  BEGIN
    normalized_table := table_name::regclass;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'table "%" does not exist or is not visible to this function', table_name;
  END;

  -- Extract schema and table
  sch := split_part((normalized_table::text),'.',1);
  tbl := split_part((normalized_table::text),'.',2);

  -- Prevent dangerous schemas
  IF sch = ANY(unsafe_schemas) THEN
    RAISE EXCEPTION 'operation not allowed on schema %', sch;
  END IF;

  -- Ensure the column exists on the resolved table
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = sch
      AND c.relname = tbl
      AND a.attname = column_name
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'column "%" does not exist on table %I.%I', column_name, sch, tbl;
  END IF;

  -- Perform delete using fully qualified names
  EXECUTE format(
    'DELETE FROM %I.%I a USING %I.%I b
     WHERE a.id < b.id
       AND a.%I = b.%I;',
    sch, tbl, sch, tbl, column_name, column_name
  );
END;
$$;


ALTER FUNCTION "public"."remove_duplicates"("table_name" "text", "column_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_permissions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  resources text[] := ARRAY[
    'articles', 'pages', 'products', 'portfolio', 'announcements', 
    'promotions', 'testimonies', 'photo_gallery', 'video_gallery', 
    'contacts', 'contact_messages', 'users', 'roles', 'permissions',
    'categories', 'tags', 'menus', 'themes', 'files', 'notifications'
  ];
  actions text[] := ARRAY['view', 'create', 'edit', 'delete', 'restore', 'permanent_delete'];
  r text;
  a text;
  perm_name text;
BEGIN
  FOREACH r IN ARRAY resources
  LOOP
    FOREACH a IN ARRAY actions
    LOOP
      perm_name := a || '_' || r;
      -- Insert if not exists
      IF NOT EXISTS (SELECT 1 FROM permissions WHERE name = perm_name) THEN
        INSERT INTO permissions (name, resource, action, description, created_at, updated_at)
        VALUES (
          perm_name, 
          r, 
          a, 
          'Can ' || a || ' ' || replace(r, '_', ' '), 
          NOW(), 
          NOW()
        );
      END IF;
    END LOOP;
    
    -- Add publish permission for specific content types
    IF r IN ('articles', 'pages', 'products', 'portfolio', 'announcements', 'promotions', 'testimonies', 'photo_gallery', 'video_gallery') THEN
       perm_name := 'publish_' || r;
       IF NOT EXISTS (SELECT 1 FROM permissions WHERE name = perm_name) THEN
          INSERT INTO permissions (name, resource, action, description, created_at, updated_at)
          VALUES (perm_name, r, 'publish', 'Can publish ' || replace(r, '_', ' '), NOW(), NOW());
       END IF;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."seed_permissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_created_by"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_created_by"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_request_tenant"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  header_tenant_id text;
BEGIN
  -- Read x-tenant-id header from request.headers (provided by PostgREST)
  -- The second argument 'true' means return null if missing instead of error
  header_tenant_id := current_setting('request.headers', true)::json->>'x-tenant-id';
  
  -- If present, set the app.current_tenant_id config variable locally for this transaction
  IF header_tenant_id IS NOT NULL THEN
    -- Validate it looks like a uuid to avoid injection/errors
    IF header_tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        PERFORM set_config('app.current_tenant_id', header_tenant_id, true);
    END IF;
  END IF;
END;
$_$;


ALTER FUNCTION "public"."set_request_tenant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_tenant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Only set if not already provided (allows explicit override by platform admins)
    IF NEW.tenant_id IS NULL THEN
        NEW.tenant_id := current_tenant_id();
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_resource_tags"("p_resource_id" "uuid", "p_resource_type" "text", "p_tags" "text"[], "p_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
    v_tag_id uuid;
    v_tag_name text;
    v_tag_ids uuid[] := ARRAY[]::uuid[];
    v_slug text;
BEGIN
    -- Strict Tenant Check
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant ID is required for tag synchronization';
    END IF;

    IF p_tags IS NOT NULL THEN
        FOREACH v_tag_name IN ARRAY p_tags
        LOOP
            IF length(trim(v_tag_name)) > 0 THEN
                v_tag_name := trim(v_tag_name);
                v_slug := lower(regexp_replace(v_tag_name, '[^a-zA-Z0-9]+', '-', 'g'));
                v_slug := regexp_replace(v_slug, '^-+|-+$', '', 'g');
                
                -- Insert with tenant_id, conflict on (tenant_id, slug)
                INSERT INTO tags (name, slug, tenant_id, created_at, updated_at)
                VALUES (v_tag_name, v_slug, p_tenant_id, NOW(), NOW())
                ON CONFLICT (tenant_id, slug) DO UPDATE SET updated_at = NOW()
                RETURNING id INTO v_tag_id;
                
                -- Fallback lookup if simple update/insert didn't return (shouldn't happen with RETURNING but strict safety)
                IF v_tag_id IS NULL THEN
                    SELECT id INTO v_tag_id FROM tags WHERE slug = v_slug AND tenant_id = p_tenant_id;
                END IF;

                IF v_tag_id IS NOT NULL THEN
                    v_tag_ids := array_append(v_tag_ids, v_tag_id);
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- Update Junction Tables
    -- Note: Junction tables use resource_id which is already tenant-scoped via RLS on the resource table.
    -- However, we only link tags that belong to the tenant (enforced by v_tag_id logic above)
    
    IF p_resource_type = 'articles' THEN
        DELETE FROM article_tags WHERE article_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
            INSERT INTO article_tags (article_id, tag_id)
            SELECT p_resource_id, unnest(v_tag_ids)
            ON CONFLICT (article_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'pages' THEN
        DELETE FROM page_tags WHERE page_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
            INSERT INTO page_tags (page_id, tag_id)
            SELECT p_resource_id, unnest(v_tag_ids)
            ON CONFLICT (page_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'video_gallery' THEN
        DELETE FROM video_gallery_tags WHERE video_gallery_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
             INSERT INTO video_gallery_tags (video_gallery_id, tag_id)
             SELECT p_resource_id, unnest(v_tag_ids)
             ON CONFLICT (video_gallery_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'contacts' THEN
        DELETE FROM contact_tags WHERE contact_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
             INSERT INTO contact_tags (contact_id, tag_id)
             SELECT p_resource_id, unnest(v_tag_ids)
             ON CONFLICT (contact_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'contact_messages' THEN
        DELETE FROM contact_message_tags WHERE message_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
             INSERT INTO contact_message_tags (message_id, tag_id)
             SELECT p_resource_id, unnest(v_tag_ids)
             ON CONFLICT (message_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'product_types' THEN
        DELETE FROM product_type_tags WHERE product_type_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
             INSERT INTO product_type_tags (product_type_id, tag_id)
             SELECT p_resource_id, unnest(v_tag_ids)
             ON CONFLICT (product_type_id, tag_id) DO NOTHING;
        END IF;
    END IF;
END;
$_$;


ALTER FUNCTION "public"."sync_resource_tags"("p_resource_id" "uuid", "p_resource_type" "text", "p_tags" "text"[], "p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_storage_files"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'storage', 'extensions'
    AS $_$
DECLARE
    inserted_count int;
BEGIN
    WITH new_files AS (
        INSERT INTO public.files (
            name,
            file_path,
            file_size,
            file_type,
            bucket_name,
            uploaded_by,
            created_at,
            updated_at
        )
        SELECT
            substring(name from '[^/]+$'), -- Extract filename
            name,
            (metadata->>'size')::bigint,
            coalesce(metadata->>'mimetype', 'application/octet-stream'),
            bucket_id,
            -- Only link user if they exist in public.users, otherwise NULL
            CASE 
                WHEN EXISTS(SELECT 1 FROM public.users WHERE id = owner) THEN owner 
                ELSE NULL 
            END,
            created_at,
            updated_at
        FROM storage.objects
        WHERE bucket_id = 'cms-uploads'
        AND NOT EXISTS (
            SELECT 1 FROM public.files WHERE file_path = storage.objects.name
        )
        RETURNING 1
    )
    SELECT count(*) INTO inserted_count FROM new_files;

    RETURN jsonb_build_object(
        'success', true,
        'synced_count', inserted_count
    );
END;
$_$;


ALTER FUNCTION "public"."sync_storage_files"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_menu_order"("payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  item jsonb;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(payload)
  LOOP
    UPDATE menus
    SET "order" = (item->>'order')::int,
        updated_at = NOW()
    WHERE id = (item->>'id')::uuid;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."update_menu_order"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_isolation_debug"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    tenant_a_id UUID;
    tenant_b_id UUID;
    user_a_id UUID;
    user_b_id UUID;
    prod_a_id UUID;
    prod_b_id UUID;
    safe_role_id UUID;
    count_result INTEGER;
    debug_tid UUID;
    debug_is_admin BOOLEAN;
    
    orig_tid_a UUID;
    orig_role_a UUID;
    orig_tid_b UUID;
    orig_role_b UUID;
    
    log_text TEXT := '';
    
    a_count INT;
    b_count INT;
    other_count INT;
BEGIN
    log_text := log_text || 'Starting Multi-Tenancy Isolation Test (Function Mode - FORCE RLS)...' || E'\n';

    -- 1. Get Existing Users
    SELECT id INTO user_a_id FROM auth.users ORDER BY created_at ASC LIMIT 1;
    SELECT id INTO user_b_id FROM auth.users ORDER BY created_at ASC OFFSET 1 LIMIT 1;
    
    -- Save Original State
    SELECT tenant_id, role_id INTO orig_tid_a, orig_role_a FROM public.users WHERE id = user_a_id;
    SELECT tenant_id, role_id INTO orig_tid_b, orig_role_b FROM public.users WHERE id = user_b_id;

    -- 2. Safe Role
    SELECT id INTO safe_role_id FROM public.roles WHERE name = 'viewer' LIMIT 1;

    -- 3. Create Tenants
    INSERT INTO public.tenants (name, slug, status, subscription_tier) 
    VALUES ('VOLATILE-TEST-A', 'volatile-test-a', 'active', 'free') 
    RETURNING id INTO tenant_a_id;

    INSERT INTO public.tenants (name, slug, status, subscription_tier) 
    VALUES ('VOLATILE-TEST-B', 'volatile-test-b', 'active', 'free') 
    RETURNING id INTO tenant_b_id;

    -- 4. Update Users
    UPDATE public.users SET tenant_id = tenant_a_id, role_id = safe_role_id WHERE id = user_a_id;
    UPDATE public.users SET tenant_id = tenant_b_id, role_id = safe_role_id WHERE id = user_b_id;

    -- 5. Create Data
    INSERT INTO public.products (name, slug, tenant_id, status, is_available, price) 
    VALUES ('Product A', 'prod-a', tenant_a_id, 'active', true, 100)
    RETURNING id INTO prod_a_id;

    INSERT INTO public.products (name, slug, tenant_id, status, is_available, price) 
    VALUES ('Product B', 'prod-b', tenant_b_id, 'active', true, 200)
    RETURNING id INTO prod_b_id;

    -- FORCE RLS (To test as superuser)
    ALTER TABLE public.products FORCE ROW LEVEL SECURITY;

    -- DEBUG: Check Context
    PERFORM set_config('request.jwt.claim.sub', user_a_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    SELECT public.current_tenant_id() INTO debug_tid;
    SELECT public.is_platform_admin() INTO debug_is_admin;
    
    log_text := log_text || format('DEBUG: User A (%s), TenantDB: %s, CurrentTenantFunc: %s, IsAdmin: %s', user_a_id, tenant_a_id, debug_tid, debug_is_admin) || E'\n';

    -- Verify Products
    SELECT count(*) INTO count_result FROM public.products;
    log_text := log_text || format('DEBUG: User A sees %s products.', count_result) || E'\n';
    
    -- Breakdown
    SELECT count(*) INTO a_count FROM public.products WHERE tenant_id = tenant_a_id;
    SELECT count(*) INTO b_count FROM public.products WHERE tenant_id = tenant_b_id;
    SELECT count(*) INTO other_count FROM public.products WHERE tenant_id NOT IN (tenant_a_id, tenant_b_id);
    
    log_text := log_text || format('DEBUG Breakdown: Tenant A Rows: %s, Tenant B Rows: %s, Other Rows: %s', a_count, b_count, other_count) || E'\n';

    -- DISABLE FORCE RLS
    ALTER TABLE public.products NO FORCE ROW LEVEL SECURITY;

    -- CLEANUP
    
    -- RESET CONTEXT TO SUPERUSER (Bypass RLS execution context, but we are already superuser)
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    PERFORM set_config('request.jwt.claim.role', NULL, true);

    -- 1. Restore Users
    UPDATE public.users SET tenant_id = orig_tid_a, role_id = orig_role_a WHERE id = user_a_id;
    UPDATE public.users SET tenant_id = orig_tid_b, role_id = orig_role_b WHERE id = user_b_id;
    
    -- 2. Delete Data
    DELETE FROM public.products WHERE id IN (prod_a_id, prod_b_id);
    
    -- 3. Delete Audit Logs
    DELETE FROM public.audit_logs WHERE tenant_id IN (tenant_a_id, tenant_b_id);
    
    -- 4. Delete Tenants
    DELETE FROM public.tenants WHERE id IN (tenant_a_id, tenant_b_id);

    RETURN log_text;
END;
$$;


ALTER FUNCTION "public"."verify_isolation_debug"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."account_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "tenant_id" "uuid",
    "status" "text" DEFAULT 'pending_admin'::"text",
    "admin_approved_at" timestamp with time zone,
    "admin_approved_by" "uuid",
    "super_admin_approved_at" timestamp with time zone,
    "super_admin_approved_by" "uuid",
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "account_requests_status_check" CHECK (("status" = ANY (ARRAY['pending_admin'::"text", 'pending_super_admin'::"text", 'approved'::"text", 'rejected'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."account_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_menus" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "path" "text" NOT NULL,
    "permission" "text",
    "order" integer DEFAULT 0 NOT NULL,
    "is_visible" boolean DEFAULT true NOT NULL,
    "is_core" boolean DEFAULT true,
    "parent_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "group_label" "text" DEFAULT 'General'::"text",
    "group_order" integer DEFAULT 0
);


ALTER TABLE "public"."admin_menus" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."announcement_tags" (
    "announcement_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."announcement_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text",
    "priority" "text" DEFAULT 'normal'::"text",
    "status" "text" DEFAULT 'draft'::"text",
    "published_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "category_id" "uuid",
    "tags" "text"[],
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."article_tags" (
    "article_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."article_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."articles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "content" "text",
    "excerpt" "text",
    "featured_image" "text",
    "author_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text",
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "category_id" "uuid",
    "tags" "text"[],
    "is_active" boolean DEFAULT true,
    "is_public" boolean DEFAULT true,
    "meta_title" "text",
    "meta_description" "text",
    "meta_keywords" "text",
    "og_image" "text",
    "created_by" "uuid",
    "canonical_url" "text",
    "robots" "text" DEFAULT 'index, follow'::"text",
    "og_title" "text",
    "og_description" "text",
    "twitter_card_type" "text" DEFAULT 'summary_large_image'::"text",
    "twitter_image" "text",
    "views" integer DEFAULT 0,
    "tenant_id" "uuid" NOT NULL,
    "workflow_state" "text" DEFAULT 'draft'::"text",
    "puck_layout_jsonb" "jsonb" DEFAULT '{}'::"jsonb",
    "tiptap_doc_jsonb" "jsonb" DEFAULT '{}'::"jsonb",
    "region_id" "uuid",
    "current_assignee_id" "uuid"
);


ALTER TABLE "public"."articles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."articles"."workflow_state" IS 'Workflow state: draft, reviewed, approved, published, archived';



CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "resource" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    "channel" "text"
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."auth_hibp_events" (
    "id" bigint NOT NULL,
    "event_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "created_by" "uuid",
    CONSTRAINT "auth_hibp_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['blocked'::"text", 'allowed'::"text"])))
);


ALTER TABLE "public"."auth_hibp_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."auth_hibp_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."auth_hibp_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."auth_hibp_events_id_seq" OWNED BY "public"."auth_hibp_events"."id";



CREATE TABLE IF NOT EXISTS "public"."backup_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "backup_id" "uuid",
    "action" "text" NOT NULL,
    "status" "text" NOT NULL,
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "tenant_id" "uuid" NOT NULL
);


ALTER TABLE "public"."backup_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backup_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "frequency" "text" NOT NULL,
    "time" time without time zone NOT NULL,
    "is_active" boolean DEFAULT true,
    "last_run" timestamp with time zone,
    "next_run" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."backup_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "backup_type" "text" DEFAULT 'full'::"text" NOT NULL,
    "size" bigint,
    "status" "text" DEFAULT 'pending'::"text",
    "file_path" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "tenant_id" "uuid" NOT NULL
);


ALTER TABLE "public"."backups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cart_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cart_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "price_snapshot" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" NOT NULL,
    CONSTRAINT "cart_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."cart_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."carts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "session_id" "text",
    "status" "text" DEFAULT 'active'::"text",
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "carts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'abandoned'::"text", 'converted'::"text"])))
);


ALTER TABLE "public"."carts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_message_tags" (
    "message_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."contact_message_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "subject" "text",
    "message" "text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "tags" "text"[],
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."contact_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_tags" (
    "contact_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."contact_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "address" "text",
    "city" "text",
    "province" "text",
    "postal_code" "text",
    "country" "text",
    "latitude" numeric,
    "longitude" numeric,
    "website" "text",
    "social_media" "jsonb" DEFAULT '{}'::"jsonb",
    "business_hours" "jsonb" DEFAULT '{}'::"jsonb",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "tags" "text"[],
    "created_by" "uuid",
    "tenant_id" "uuid" NOT NULL
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "device_name" "text",
    "device_type" "text" DEFAULT 'esp32'::"text",
    "ip_address" "text",
    "mac_address" "text",
    "firmware_version" "text" DEFAULT '1.0.0'::"text",
    "is_online" boolean DEFAULT false,
    "last_seen" timestamp with time zone,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "event_type" "text" NOT NULL,
    "recipient" "text" NOT NULL,
    "subject" "text",
    "template_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."email_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_logs" IS 'Logs for email events from Mailketing webhooks and API';



CREATE TABLE IF NOT EXISTS "public"."extension_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "extension_id" "uuid",
    "extension_slug" "text" NOT NULL,
    "action" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "user_id" "uuid",
    "ip_address" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "extension_logs_action_check" CHECK (("action" = ANY (ARRAY['install'::"text", 'uninstall'::"text", 'activate'::"text", 'deactivate'::"text", 'update'::"text", 'config_change'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."extension_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."extension_logs" IS 'Audit trail for extension lifecycle events';



COMMENT ON COLUMN "public"."extension_logs"."action" IS 'install, uninstall, activate, deactivate, update, config_change, error';



CREATE TABLE IF NOT EXISTS "public"."extension_menu_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "extension_id" "uuid",
    "label" "text" NOT NULL,
    "path" "text" NOT NULL,
    "icon" "text",
    "order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "parent_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."extension_menu_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extension_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "extension_id" "uuid",
    "permission_name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."extension_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extension_rbac_integration" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "extension_id" "uuid",
    "role_id" "uuid",
    "permission_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."extension_rbac_integration" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extension_routes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "extension_id" "uuid",
    "path" "text" NOT NULL,
    "component_key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text",
    "order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."extension_routes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extension_routes_registry" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "extension_id" "uuid",
    "path" "text" NOT NULL,
    "component_key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text",
    "requires_auth" boolean DEFAULT true,
    "required_permissions" "text"[],
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."extension_routes_registry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extensions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "version" "text" DEFAULT '1.0.0'::"text" NOT NULL,
    "author" "text",
    "is_active" boolean DEFAULT false,
    "is_system" boolean DEFAULT false,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "icon" "text",
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    "extension_type" "text" DEFAULT 'core'::"text",
    "external_path" "text",
    "manifest" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "extensions_extension_type_check" CHECK (("extension_type" = ANY (ARRAY['core'::"text", 'external'::"text"])))
);


ALTER TABLE "public"."extensions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."extensions"."slug" IS 'Unique slug for plugin matching (e.g., backup, helloworld)';



COMMENT ON COLUMN "public"."extensions"."extension_type" IS 'core = bundled plugin, external = external module from awcms-ext-* folder';



COMMENT ON COLUMN "public"."extensions"."external_path" IS 'Path for external extensions (e.g., /awcms-ext-vendor-name/dist/index.js)';



COMMENT ON COLUMN "public"."extensions"."manifest" IS 'Plugin manifest JSON (from plugin.json)';



CREATE TABLE IF NOT EXISTS "public"."file_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_id" "uuid",
    "user_id" "uuid",
    "permission_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."file_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size" bigint,
    "file_type" "text",
    "bucket_name" "text" DEFAULT 'cms-uploads'::"text",
    "folder_id" "uuid",
    "is_public" boolean DEFAULT true,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "tenant_id" "uuid" NOT NULL
);


ALTER TABLE "public"."files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "menu_id" "uuid",
    "role_id" "uuid",
    "can_view" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."menu_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menus" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "label" "text" NOT NULL,
    "slug" "text",
    "url" "text",
    "icon" "text",
    "parent_id" "uuid",
    "order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "is_public" boolean DEFAULT true,
    "role_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "created_by" "uuid",
    "tenant_id" "uuid",
    "group_label" "text" DEFAULT 'header'::"text"
);


ALTER TABLE "public"."menus" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mobile_app_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "app_name" "text",
    "app_logo_url" "text",
    "app_icon_url" "text",
    "primary_color" "text" DEFAULT '#3b82f6'::"text",
    "secondary_color" "text" DEFAULT '#10b981'::"text",
    "force_update_version" "text",
    "recommended_version" "text",
    "maintenance_mode" boolean DEFAULT false,
    "maintenance_message" "text",
    "features" "jsonb" DEFAULT '{"offline": true, "articles": true, "notifications": true}'::"jsonb",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid"
);


ALTER TABLE "public"."mobile_app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mobile_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "device_token" "text",
    "device_type" "text",
    "device_name" "text",
    "app_version" "text",
    "os_version" "text",
    "last_active" timestamp with time zone,
    "push_enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "mobile_users_device_type_check" CHECK (("device_type" = ANY (ARRAY['ios'::"text", 'android'::"text", 'web'::"text"])))
);


ALTER TABLE "public"."mobile_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_readers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "notification_id" "uuid",
    "user_id" "uuid",
    "read_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notification_readers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "type" "text" DEFAULT 'info'::"text",
    "is_read" boolean DEFAULT false,
    "link" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "priority" "text" DEFAULT 'normal'::"text",
    "category" "text" DEFAULT 'system'::"text",
    "deleted_at" timestamp with time zone,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid",
    "product_id" "uuid",
    "quantity" integer DEFAULT 1,
    "price" numeric(12,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" NOT NULL
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "total_amount" numeric(12,2) DEFAULT 0,
    "status" "text" DEFAULT 'pending'::"text",
    "shipping_address" "text",
    "tracking_number" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" NOT NULL,
    "deleted_at" timestamp with time zone,
    "payment_status" "text" DEFAULT 'unpaid'::"text",
    "payment_method" "text",
    "shipping_cost" numeric DEFAULT 0,
    "subtotal" numeric DEFAULT 0,
    "order_number" "text"
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_categories" (
    "page_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."page_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_tags" (
    "page_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."page_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "content" "text",
    "layout_data" "jsonb",
    "status" "text" DEFAULT 'draft'::"text",
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "category_id" "uuid",
    "tags" "text"[],
    "created_by" "uuid",
    "excerpt" "text",
    "featured_image" "text",
    "meta_title" "text",
    "meta_description" "text",
    "meta_keywords" "text",
    "og_image" "text",
    "canonical_url" "text",
    "robots" "text",
    "is_public" boolean DEFAULT true,
    "is_active" boolean DEFAULT true,
    "og_title" "text",
    "og_description" "text",
    "twitter_card_type" "text" DEFAULT 'summary_large_image'::"text",
    "twitter_image" "text",
    "views" integer DEFAULT 0,
    "content_draft" "jsonb" DEFAULT '{}'::"jsonb",
    "content_published" "jsonb" DEFAULT '{}'::"jsonb",
    "editor_type" "text" DEFAULT 'richtext'::"text",
    "template" "text" DEFAULT 'default'::"text",
    "page_type" "text" DEFAULT 'regular'::"text",
    "tenant_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "puck_layout_jsonb" "jsonb" DEFAULT '{}'::"jsonb",
    "workflow_state" "text" DEFAULT 'draft'::"text",
    "current_assignee_id" "uuid",
    CONSTRAINT "pages_editor_type_check" CHECK (("editor_type" = ANY (ARRAY['richtext'::"text", 'visual'::"text"])))
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pages"."content_draft" IS 'JSONB content for visual builder draft version';



COMMENT ON COLUMN "public"."pages"."content_published" IS 'JSONB content for visual builder published version';



COMMENT ON COLUMN "public"."pages"."editor_type" IS 'Editor type: richtext or visual';



COMMENT ON COLUMN "public"."pages"."template" IS 'Page template name';



COMMENT ON COLUMN "public"."pages"."page_type" IS 'Type of page: regular, homepage, single_page, single_post, header, footer, 404, archive';



CREATE TABLE IF NOT EXISTS "public"."payment_methods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "payment_methods_type_check" CHECK (("type" = ANY (ARRAY['midtrans'::"text", 'bank_transfer'::"text", 'cod'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."payment_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "payment_method_id" "uuid",
    "amount" numeric NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "transaction_id" "text",
    "gateway_response" "jsonb" DEFAULT '{}'::"jsonb",
    "paid_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'success'::"text", 'failed'::"text", 'expired'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "resource" "text" NOT NULL,
    "action" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "created_by" "uuid",
    "module" "text"
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photo_gallery" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "google_album_id" "text",
    "google_album_url" "text",
    "description" "text",
    "photos" "jsonb",
    "status" "text" DEFAULT 'draft'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "category_id" "uuid",
    "tags" "text"[],
    "created_by" "uuid",
    "slug" "text",
    "views" integer DEFAULT 0,
    "photo_count" integer DEFAULT 0,
    "cover_image" "text",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."photo_gallery" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photo_gallery_tags" (
    "photo_gallery_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."photo_gallery_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "definition" "jsonb" NOT NULL,
    "tenant_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."portfolio" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "images" "jsonb",
    "client" "text",
    "project_date" "date",
    "tags" "jsonb",
    "status" "text" DEFAULT 'draft'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "category_id" "uuid",
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."portfolio" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."portfolio_tags" (
    "portfolio_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."portfolio_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_tags" (
    "product_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."product_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_type_tags" (
    "product_type_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."product_type_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "tags" "text"[],
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."product_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "price" numeric(10,2),
    "images" "jsonb",
    "status" "text" DEFAULT 'draft'::"text",
    "stock" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "category_id" "uuid",
    "tags" "text"[],
    "product_type_id" "uuid",
    "discount_price" numeric,
    "sku" "text",
    "weight" numeric,
    "dimensions" "text",
    "shipping_cost" numeric,
    "is_available" boolean DEFAULT true,
    "created_by" "uuid",
    "tenant_id" "uuid" NOT NULL,
    "published_at" timestamp with time zone,
    "featured_image" "text"
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promotion_tags" (
    "promotion_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."promotion_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promotions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "discount_percentage" numeric(5,2),
    "discount_amount" numeric(10,2),
    "code" "text",
    "start_date" timestamp with time zone,
    "end_date" timestamp with time zone,
    "status" "text" DEFAULT 'draft'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "category_id" "uuid",
    "tags" "text"[],
    "created_by" "uuid",
    "featured_image" "text",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."promotions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."published_articles_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "tenant_id",
    "title",
    "content",
    "excerpt",
    "featured_image",
    "status",
    "author_id",
    "created_at",
    "updated_at"
   FROM "public"."articles"
  WHERE (("status" = 'published'::"text") AND ("deleted_at" IS NULL));


ALTER VIEW "public"."published_articles_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "image_url" "text",
    "action_url" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "target_type" "text" DEFAULT 'all'::"text",
    "target_ids" "uuid"[],
    "target_topics" "text"[],
    "scheduled_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "sent_count" integer DEFAULT 0,
    "failed_count" integer DEFAULT 0,
    "status" "text" DEFAULT 'draft'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "push_notifications_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'sending'::"text", 'sent'::"text", 'failed'::"text"]))),
    CONSTRAINT "push_notifications_target_type_check" CHECK (("target_type" = ANY (ARRAY['all'::"text", 'user'::"text", 'segment'::"text", 'topic'::"text"])))
);


ALTER TABLE "public"."push_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."region_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "level_order" integer NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."region_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "level_id" "uuid",
    "parent_id" "uuid",
    "code" "text",
    "name" "text" NOT NULL,
    "full_path" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."regions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role_id" "uuid",
    "permission_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_policies" (
    "role_id" "uuid" NOT NULL,
    "policy_id" "uuid" NOT NULL
);


ALTER TABLE "public"."role_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "created_by" "uuid",
    "tenant_id" "uuid",
    "is_system" boolean DEFAULT false
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sensor_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "gas_ppm" double precision,
    "gas_level" "text",
    "temperature" double precision,
    "humidity" double precision,
    "raw_data" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sensor_readings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seo_metadata" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid",
    "meta_title" "text",
    "meta_description" "text",
    "meta_keywords" "text",
    "og_image" "text",
    "canonical_url" "text",
    "robots" "text" DEFAULT 'index, follow'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "tenant_id" "uuid" NOT NULL
);


ALTER TABLE "public"."seo_metadata" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settings" (
    "key" "text" NOT NULL,
    "value" "text",
    "type" "text" DEFAULT 'string'::"text",
    "description" "text",
    "is_public" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid" NOT NULL
);


ALTER TABLE "public"."settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sso_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "provider" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."sso_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sso_providers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "client_id" "text",
    "is_active" boolean DEFAULT true,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."sso_providers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sso_role_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "text" NOT NULL,
    "external_role_name" "text" NOT NULL,
    "internal_role_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."sso_role_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "deleted_at" timestamp with time zone,
    "description" "text",
    "color" "text" DEFAULT '#3b82f6'::"text",
    "icon" "text",
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "route_type" "text" NOT NULL,
    "template_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "channel" "text" DEFAULT 'web'::"text"
);


ALTER TABLE "public"."template_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_parts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "content" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "language" "text" DEFAULT 'en'::"text",
    "translation_group_id" "uuid" DEFAULT "gen_random_uuid"(),
    CONSTRAINT "template_parts_type_check" CHECK (("type" = ANY (ARRAY['header'::"text", 'footer'::"text", 'sidebar'::"text", 'widget_area'::"text"])))
);


ALTER TABLE "public"."template_parts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_strings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "locale" "text" NOT NULL,
    "value" "text",
    "context" "text" DEFAULT 'default'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."template_strings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "thumbnail" "text",
    "category" "text" DEFAULT 'General'::"text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "tenant_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'page'::"text",
    "parts" "jsonb" DEFAULT '{}'::"jsonb",
    "language" "text" DEFAULT 'en'::"text",
    "translation_group_id" "uuid" DEFAULT "gen_random_uuid"()
);


ALTER TABLE "public"."templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "domain" "text",
    "status" "text" DEFAULT 'active'::"text",
    "subscription_tier" "text" DEFAULT 'free'::"text",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "subscription_expires_at" timestamp with time zone,
    "billing_amount" numeric(10,2) DEFAULT 0,
    "billing_cycle" "text" DEFAULT 'monthly'::"text",
    "notes" "text",
    "contact_email" "text",
    "currency" "text" DEFAULT 'USD'::"text",
    "locale" "text" DEFAULT 'en'::"text",
    "host" "text",
    CONSTRAINT "tenants_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tenants"."subscription_expires_at" IS 'Subscription expiration/renewal date';



COMMENT ON COLUMN "public"."tenants"."billing_amount" IS 'Billing amount per cycle';



COMMENT ON COLUMN "public"."tenants"."billing_cycle" IS 'Billing cycle: monthly, yearly, custom';



COMMENT ON COLUMN "public"."tenants"."notes" IS 'Administrative notes for the tenant';



COMMENT ON COLUMN "public"."tenants"."contact_email" IS 'Primary contact email for the tenant';



COMMENT ON COLUMN "public"."tenants"."currency" IS 'Billing currency code: USD, IDR, EUR, etc';



COMMENT ON COLUMN "public"."tenants"."locale" IS 'Tenant default locale/language: en, id, etc';



CREATE TABLE IF NOT EXISTS "public"."testimonies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text",
    "author_name" "text" NOT NULL,
    "author_position" "text",
    "author_image" "text",
    "rating" integer,
    "category_id" "uuid",
    "tags" "text"[],
    "status" "text" DEFAULT 'draft'::"text",
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "created_by" "uuid",
    "tenant_id" "uuid",
    "published_at" timestamp with time zone,
    CONSTRAINT "testimonies_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."testimonies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."testimony_tags" (
    "testimony_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."testimony_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."themes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."themes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."two_factor_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "event_type" "text" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."two_factor_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."two_factor_auth" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "secret" "text" NOT NULL,
    "backup_codes" "text"[] DEFAULT ARRAY[]::"text"[],
    "enabled" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."two_factor_auth" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "role_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "language" "text" DEFAULT 'id'::"text",
    "created_by" "uuid",
    "tenant_id" "uuid",
    "approval_status" "text" DEFAULT 'approved'::"text",
    "admin_approved_at" timestamp with time zone,
    "admin_approved_by" "uuid",
    "super_admin_approved_at" timestamp with time zone,
    "super_admin_approved_by" "uuid",
    "rejection_reason" "text",
    "region_id" "uuid",
    CONSTRAINT "users_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending_admin'::"text", 'pending_super_admin'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."users"."tenant_id" IS 'Tenant UUID. NULL for global roles (owner, super_admin) that operate at platform level.';



COMMENT ON COLUMN "public"."users"."approval_status" IS 'Multi-stage approval status: pending_admin -> pending_super_admin -> approved/rejected';



CREATE TABLE IF NOT EXISTS "public"."video_gallery" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "youtube_playlist_id" "text",
    "youtube_playlist_url" "text",
    "description" "text",
    "videos" "jsonb",
    "status" "text" DEFAULT 'draft'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "category_id" "uuid",
    "tags" "text"[],
    "created_by" "uuid",
    "slug" "text",
    "views" integer DEFAULT 0,
    "duration" "text",
    "thumbnail_image" "text",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."video_gallery" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."video_gallery_tags" (
    "video_gallery_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."video_gallery_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."widgets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "area_id" "uuid",
    "type" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."widgets" OWNER TO "postgres";


ALTER TABLE ONLY "public"."auth_hibp_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."auth_hibp_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."account_requests"
    ADD CONSTRAINT "account_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_menus"
    ADD CONSTRAINT "admin_menus_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."admin_menus"
    ADD CONSTRAINT "admin_menus_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."announcement_tags"
    ADD CONSTRAINT "announcement_tags_pkey" PRIMARY KEY ("announcement_id", "tag_id");



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."article_tags"
    ADD CONSTRAINT "article_tags_pkey" PRIMARY KEY ("article_id", "tag_id");



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auth_hibp_events"
    ADD CONSTRAINT "auth_hibp_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backup_logs"
    ADD CONSTRAINT "backup_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backup_schedules"
    ADD CONSTRAINT "backup_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backups"
    ADD CONSTRAINT "backups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_cart_id_product_id_key" UNIQUE ("cart_id", "product_id");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "carts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."contact_message_tags"
    ADD CONSTRAINT "contact_message_tags_pkey" PRIMARY KEY ("message_id", "tag_id");



ALTER TABLE ONLY "public"."contact_messages"
    ADD CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_tags"
    ADD CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contact_id", "tag_id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_tenant_id_device_id_key" UNIQUE ("tenant_id", "device_id");



ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extension_logs"
    ADD CONSTRAINT "extension_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extension_menu_items"
    ADD CONSTRAINT "extension_menu_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extension_permissions"
    ADD CONSTRAINT "extension_permissions_ext_perm_key" UNIQUE ("extension_id", "permission_name");



ALTER TABLE ONLY "public"."extension_permissions"
    ADD CONSTRAINT "extension_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extension_rbac_integration"
    ADD CONSTRAINT "extension_rbac_integration_extension_id_role_id_permission__key" UNIQUE ("extension_id", "role_id", "permission_id");



ALTER TABLE ONLY "public"."extension_rbac_integration"
    ADD CONSTRAINT "extension_rbac_integration_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extension_routes"
    ADD CONSTRAINT "extension_routes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extension_routes_registry"
    ADD CONSTRAINT "extension_routes_registry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extensions"
    ADD CONSTRAINT "extensions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extensions"
    ADD CONSTRAINT "extensions_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."file_permissions"
    ADD CONSTRAINT "file_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_permissions"
    ADD CONSTRAINT "menu_permissions_menu_id_role_id_key" UNIQUE ("menu_id", "role_id");



ALTER TABLE ONLY "public"."menu_permissions"
    ADD CONSTRAINT "menu_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menus"
    ADD CONSTRAINT "menus_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mobile_app_config"
    ADD CONSTRAINT "mobile_app_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mobile_app_config"
    ADD CONSTRAINT "mobile_app_config_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."mobile_users"
    ADD CONSTRAINT "mobile_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_readers"
    ADD CONSTRAINT "notification_readers_notification_id_user_id_key" UNIQUE ("notification_id", "user_id");



ALTER TABLE ONLY "public"."notification_readers"
    ADD CONSTRAINT "notification_readers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_categories"
    ADD CONSTRAINT "page_categories_pkey" PRIMARY KEY ("page_id", "category_id");



ALTER TABLE ONLY "public"."page_tags"
    ADD CONSTRAINT "page_tags_pkey" PRIMARY KEY ("page_id", "tag_id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_gallery"
    ADD CONSTRAINT "photo_gallery_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_gallery"
    ADD CONSTRAINT "photo_gallery_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."photo_gallery_tags"
    ADD CONSTRAINT "photo_gallery_tags_pkey" PRIMARY KEY ("photo_gallery_id", "tag_id");



ALTER TABLE ONLY "public"."policies"
    ADD CONSTRAINT "policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio"
    ADD CONSTRAINT "portfolio_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio"
    ADD CONSTRAINT "portfolio_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."portfolio_tags"
    ADD CONSTRAINT "portfolio_tags_pkey" PRIMARY KEY ("portfolio_id", "tag_id");



ALTER TABLE ONLY "public"."product_tags"
    ADD CONSTRAINT "product_tags_pkey" PRIMARY KEY ("product_id", "tag_id");



ALTER TABLE ONLY "public"."product_type_tags"
    ADD CONSTRAINT "product_type_tags_pkey" PRIMARY KEY ("product_type_id", "tag_id");



ALTER TABLE ONLY "public"."product_types"
    ADD CONSTRAINT "product_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_types"
    ADD CONSTRAINT "product_types_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."promotion_tags"
    ADD CONSTRAINT "promotion_tags_pkey" PRIMARY KEY ("promotion_id", "tag_id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_notifications"
    ADD CONSTRAINT "push_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."region_levels"
    ADD CONSTRAINT "region_levels_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."region_levels"
    ADD CONSTRAINT "region_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_permission_id_key" UNIQUE ("role_id", "permission_id");



ALTER TABLE ONLY "public"."role_policies"
    ADD CONSTRAINT "role_policies_pkey" PRIMARY KEY ("role_id", "policy_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sensor_readings"
    ADD CONSTRAINT "sensor_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seo_metadata"
    ADD CONSTRAINT "seo_metadata_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seo_metadata"
    ADD CONSTRAINT "seo_metadata_resource_type_resource_id_key" UNIQUE ("resource_type", "resource_id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("tenant_id", "key");



ALTER TABLE ONLY "public"."sso_audit_logs"
    ADD CONSTRAINT "sso_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sso_providers"
    ADD CONSTRAINT "sso_providers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sso_role_mappings"
    ADD CONSTRAINT "sso_role_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_assignments"
    ADD CONSTRAINT "template_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_assignments"
    ADD CONSTRAINT "template_assignments_tenant_channel_route_unique" UNIQUE ("tenant_id", "channel", "route_type");



ALTER TABLE ONLY "public"."template_parts"
    ADD CONSTRAINT "template_parts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_strings"
    ADD CONSTRAINT "template_strings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_strings"
    ADD CONSTRAINT "template_strings_tenant_id_key_locale_context_key" UNIQUE ("tenant_id", "key", "locale", "context");



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_domain_key" UNIQUE ("domain");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_host_key" UNIQUE ("host");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."testimonies"
    ADD CONSTRAINT "testimonies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."testimonies"
    ADD CONSTRAINT "testimonies_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."testimony_tags"
    ADD CONSTRAINT "testimony_tags_pkey" PRIMARY KEY ("testimony_id", "tag_id");



ALTER TABLE ONLY "public"."themes"
    ADD CONSTRAINT "themes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."themes"
    ADD CONSTRAINT "themes_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."two_factor_audit_logs"
    ADD CONSTRAINT "two_factor_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."two_factor_auth"
    ADD CONSTRAINT "two_factor_auth_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."two_factor_auth"
    ADD CONSTRAINT "unique_user_2fa" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_gallery"
    ADD CONSTRAINT "video_gallery_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_gallery"
    ADD CONSTRAINT "video_gallery_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."video_gallery_tags"
    ADD CONSTRAINT "video_gallery_tags_pkey" PRIMARY KEY ("video_gallery_id", "tag_id");



ALTER TABLE ONLY "public"."widgets"
    ADD CONSTRAINT "widgets_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_account_requests_admin_approved_by" ON "public"."account_requests" USING "btree" ("admin_approved_by");



CREATE INDEX "idx_account_requests_email" ON "public"."account_requests" USING "btree" ("email");



CREATE INDEX "idx_account_requests_status" ON "public"."account_requests" USING "btree" ("status");



CREATE INDEX "idx_account_requests_super_admin_approved_by" ON "public"."account_requests" USING "btree" ("super_admin_approved_by");



CREATE INDEX "idx_account_requests_tenant" ON "public"."account_requests" USING "btree" ("tenant_id");



CREATE INDEX "idx_announcement_tags_announcement_id" ON "public"."announcement_tags" USING "btree" ("announcement_id");



CREATE INDEX "idx_announcement_tags_created_by" ON "public"."announcement_tags" USING "btree" ("created_by");



CREATE INDEX "idx_announcement_tags_tag_id" ON "public"."announcement_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_announcement_tags_tenant_id" ON "public"."announcement_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_announcements_category_id" ON "public"."announcements" USING "btree" ("category_id");



CREATE INDEX "idx_announcements_created_by" ON "public"."announcements" USING "btree" ("created_by");



CREATE INDEX "idx_announcements_pagination" ON "public"."announcements" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_announcements_status" ON "public"."announcements" USING "btree" ("status");



CREATE INDEX "idx_announcements_tenant_id" ON "public"."announcements" USING "btree" ("tenant_id");



CREATE INDEX "idx_article_tags_article_id" ON "public"."article_tags" USING "btree" ("article_id");



CREATE INDEX "idx_article_tags_created_by" ON "public"."article_tags" USING "btree" ("created_by");



CREATE INDEX "idx_article_tags_tag_id" ON "public"."article_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_article_tags_tenant_id" ON "public"."article_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_articles_author_id" ON "public"."articles" USING "btree" ("author_id");



CREATE INDEX "idx_articles_category_id" ON "public"."articles" USING "btree" ("category_id");



CREATE INDEX "idx_articles_created_by" ON "public"."articles" USING "btree" ("created_by");



CREATE INDEX "idx_articles_current_assignee_id" ON "public"."articles" USING "btree" ("current_assignee_id");



CREATE INDEX "idx_articles_deleted_at" ON "public"."articles" USING "btree" ("deleted_at");



CREATE INDEX "idx_articles_region" ON "public"."articles" USING "btree" ("region_id");



CREATE INDEX "idx_articles_status" ON "public"."articles" USING "btree" ("status");



CREATE INDEX "idx_articles_tenant_id" ON "public"."articles" USING "btree" ("tenant_id");



CREATE INDEX "idx_articles_tenant_slug" ON "public"."articles" USING "btree" ("tenant_id", "slug");



CREATE INDEX "idx_articles_tenant_status" ON "public"."articles" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_articles_workflow_state" ON "public"."articles" USING "btree" ("workflow_state");



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action");



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_tenant_id" ON "public"."audit_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_auth_hibp_events_created_by" ON "public"."auth_hibp_events" USING "btree" ("created_by");



CREATE INDEX "idx_auth_hibp_events_user_id" ON "public"."auth_hibp_events" USING "btree" ("user_id");



CREATE INDEX "idx_backup_logs_backup_id" ON "public"."backup_logs" USING "btree" ("backup_id");



CREATE INDEX "idx_backup_logs_created_by" ON "public"."backup_logs" USING "btree" ("created_by");



CREATE INDEX "idx_backup_logs_tenant_id" ON "public"."backup_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_backup_schedules_created_by" ON "public"."backup_schedules" USING "btree" ("created_by");



CREATE INDEX "idx_backup_schedules_tenant_id" ON "public"."backup_schedules" USING "btree" ("tenant_id");



CREATE INDEX "idx_backups_created_by" ON "public"."backups" USING "btree" ("created_by");



CREATE INDEX "idx_backups_tenant_id" ON "public"."backups" USING "btree" ("tenant_id");



CREATE INDEX "idx_cart_items_cart_id" ON "public"."cart_items" USING "btree" ("cart_id");



CREATE INDEX "idx_cart_items_product_id" ON "public"."cart_items" USING "btree" ("product_id");



CREATE INDEX "idx_cart_items_tenant_id" ON "public"."cart_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_carts_session_id" ON "public"."carts" USING "btree" ("session_id");



CREATE INDEX "idx_carts_tenant_id" ON "public"."carts" USING "btree" ("tenant_id");



CREATE INDEX "idx_carts_user_id" ON "public"."carts" USING "btree" ("user_id");



CREATE INDEX "idx_categories_created_by" ON "public"."categories" USING "btree" ("created_by");



CREATE INDEX "idx_categories_deleted_at" ON "public"."categories" USING "btree" ("deleted_at");



CREATE INDEX "idx_categories_tenant_id" ON "public"."categories" USING "btree" ("tenant_id");



CREATE INDEX "idx_categories_tenant_slug" ON "public"."categories" USING "btree" ("tenant_id", "slug");



CREATE INDEX "idx_categories_type" ON "public"."categories" USING "btree" ("type");



CREATE INDEX "idx_contact_message_tags_created_by" ON "public"."contact_message_tags" USING "btree" ("created_by");



CREATE INDEX "idx_contact_message_tags_message_id" ON "public"."contact_message_tags" USING "btree" ("message_id");



CREATE INDEX "idx_contact_message_tags_tag_id" ON "public"."contact_message_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_contact_message_tags_tenant_id" ON "public"."contact_message_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_contact_messages_created_by" ON "public"."contact_messages" USING "btree" ("created_by");



CREATE INDEX "idx_contact_messages_tenant_id" ON "public"."contact_messages" USING "btree" ("tenant_id");



CREATE INDEX "idx_contact_tags_contact_id" ON "public"."contact_tags" USING "btree" ("contact_id");



CREATE INDEX "idx_contact_tags_created_by" ON "public"."contact_tags" USING "btree" ("created_by");



CREATE INDEX "idx_contact_tags_tag_id" ON "public"."contact_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_contact_tags_tenant_id" ON "public"."contact_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_contacts_created_by" ON "public"."contacts" USING "btree" ("created_by");



CREATE INDEX "idx_contacts_tenant_id" ON "public"."contacts" USING "btree" ("tenant_id");



CREATE INDEX "idx_devices_device_id" ON "public"."devices" USING "btree" ("device_id");



CREATE INDEX "idx_devices_owner_id" ON "public"."devices" USING "btree" ("owner_id");



CREATE INDEX "idx_devices_tenant" ON "public"."devices" USING "btree" ("tenant_id");



CREATE INDEX "idx_email_logs_created_at" ON "public"."email_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_email_logs_event_type" ON "public"."email_logs" USING "btree" ("event_type");



CREATE INDEX "idx_email_logs_recipient" ON "public"."email_logs" USING "btree" ("recipient");



CREATE INDEX "idx_email_logs_tenant" ON "public"."email_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_extension_logs_action" ON "public"."extension_logs" USING "btree" ("action");



CREATE INDEX "idx_extension_logs_created" ON "public"."extension_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_extension_logs_extension" ON "public"."extension_logs" USING "btree" ("extension_id");



CREATE INDEX "idx_extension_logs_tenant" ON "public"."extension_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_extension_logs_user_id" ON "public"."extension_logs" USING "btree" ("user_id");



CREATE INDEX "idx_extension_menu_items_created_by" ON "public"."extension_menu_items" USING "btree" ("created_by");



CREATE INDEX "idx_extension_menu_items_extension_id" ON "public"."extension_menu_items" USING "btree" ("extension_id");



CREATE INDEX "idx_extension_menu_items_parent_id" ON "public"."extension_menu_items" USING "btree" ("parent_id");



CREATE INDEX "idx_extension_rbac_integration_created_by" ON "public"."extension_rbac_integration" USING "btree" ("created_by");



CREATE INDEX "idx_extension_rbac_integration_extension_id" ON "public"."extension_rbac_integration" USING "btree" ("extension_id");



CREATE INDEX "idx_extension_rbac_integration_permission_id" ON "public"."extension_rbac_integration" USING "btree" ("permission_id");



CREATE INDEX "idx_extension_rbac_integration_role_id" ON "public"."extension_rbac_integration" USING "btree" ("role_id");



CREATE INDEX "idx_extension_routes_created_by" ON "public"."extension_routes" USING "btree" ("created_by");



CREATE INDEX "idx_extension_routes_extension_id" ON "public"."extension_routes" USING "btree" ("extension_id");



CREATE INDEX "idx_extension_routes_registry_created_by" ON "public"."extension_routes_registry" USING "btree" ("created_by");



CREATE INDEX "idx_extension_routes_registry_extension_id" ON "public"."extension_routes_registry" USING "btree" ("extension_id");



CREATE INDEX "idx_extension_routes_tenant_id" ON "public"."extension_routes" USING "btree" ("tenant_id");



CREATE INDEX "idx_extensions_created_by" ON "public"."extensions" USING "btree" ("created_by");



CREATE INDEX "idx_extensions_tenant_id" ON "public"."extensions" USING "btree" ("tenant_id");



CREATE INDEX "idx_file_permissions_file_id" ON "public"."file_permissions" USING "btree" ("file_id");



CREATE INDEX "idx_file_permissions_tenant_id" ON "public"."file_permissions" USING "btree" ("tenant_id");



CREATE INDEX "idx_file_permissions_user_id" ON "public"."file_permissions" USING "btree" ("user_id");



CREATE INDEX "idx_files_tenant_id" ON "public"."files" USING "btree" ("tenant_id");



CREATE INDEX "idx_files_uploaded_by" ON "public"."files" USING "btree" ("uploaded_by");



CREATE INDEX "idx_menu_permissions_created_by" ON "public"."menu_permissions" USING "btree" ("created_by");



CREATE INDEX "idx_menu_permissions_menu_id" ON "public"."menu_permissions" USING "btree" ("menu_id");



CREATE INDEX "idx_menu_permissions_role_id" ON "public"."menu_permissions" USING "btree" ("role_id");



CREATE INDEX "idx_menu_permissions_tenant_id" ON "public"."menu_permissions" USING "btree" ("tenant_id");



CREATE INDEX "idx_menus_created_by" ON "public"."menus" USING "btree" ("created_by");



CREATE INDEX "idx_menus_parent_id" ON "public"."menus" USING "btree" ("parent_id");



CREATE INDEX "idx_menus_role_id" ON "public"."menus" USING "btree" ("role_id");



CREATE INDEX "idx_menus_tenant_id" ON "public"."menus" USING "btree" ("tenant_id");



CREATE INDEX "idx_mobile_app_config_updated_by" ON "public"."mobile_app_config" USING "btree" ("updated_by");



CREATE INDEX "idx_mobile_users_tenant" ON "public"."mobile_users" USING "btree" ("tenant_id");



CREATE INDEX "idx_mobile_users_user_id" ON "public"."mobile_users" USING "btree" ("user_id");



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_tenant_id" ON "public"."notifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_order_items_order_id" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_order_items_product_id" ON "public"."order_items" USING "btree" ("product_id");



CREATE INDEX "idx_order_items_tenant_id" ON "public"."order_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_orders_created_at" ON "public"."orders" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_orders_payment_status" ON "public"."orders" USING "btree" ("payment_status");



CREATE INDEX "idx_orders_status" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "idx_orders_tenant_id" ON "public"."orders" USING "btree" ("tenant_id");



CREATE INDEX "idx_orders_user_id" ON "public"."orders" USING "btree" ("user_id");



CREATE INDEX "idx_page_categories_category_id" ON "public"."page_categories" USING "btree" ("category_id");



CREATE INDEX "idx_page_categories_created_by" ON "public"."page_categories" USING "btree" ("created_by");



CREATE INDEX "idx_page_categories_page_id" ON "public"."page_categories" USING "btree" ("page_id");



CREATE INDEX "idx_page_categories_tenant_id" ON "public"."page_categories" USING "btree" ("tenant_id");



CREATE INDEX "idx_page_tags_created_by" ON "public"."page_tags" USING "btree" ("created_by");



CREATE INDEX "idx_page_tags_page_id" ON "public"."page_tags" USING "btree" ("page_id");



CREATE INDEX "idx_page_tags_tag_id" ON "public"."page_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_page_tags_tenant_id" ON "public"."page_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_pages_category_id" ON "public"."pages" USING "btree" ("category_id");



CREATE INDEX "idx_pages_created_by" ON "public"."pages" USING "btree" ("created_by");



CREATE INDEX "idx_pages_current_assignee_id" ON "public"."pages" USING "btree" ("current_assignee_id");



CREATE INDEX "idx_pages_page_type" ON "public"."pages" USING "btree" ("page_type");



CREATE INDEX "idx_pages_pagination" ON "public"."pages" USING "btree" ("status", "updated_at" DESC);



CREATE INDEX "idx_pages_parent_id" ON "public"."pages" USING "btree" ("parent_id");



CREATE INDEX "idx_pages_status" ON "public"."pages" USING "btree" ("status");



CREATE INDEX "idx_pages_status_deleted_at" ON "public"."pages" USING "btree" ("status", "deleted_at");



CREATE INDEX "idx_pages_tenant_id" ON "public"."pages" USING "btree" ("tenant_id");



CREATE INDEX "idx_pages_tenant_slug" ON "public"."pages" USING "btree" ("tenant_id", "slug");



CREATE UNIQUE INDEX "idx_pages_unique_system_type" ON "public"."pages" USING "btree" ("page_type") WHERE (("page_type" = ANY (ARRAY['homepage'::"text", 'header'::"text", 'footer'::"text", '404'::"text"])) AND ("status" = 'published'::"text") AND ("deleted_at" IS NULL));



CREATE INDEX "idx_pages_updated_at" ON "public"."pages" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_payment_methods_tenant_id" ON "public"."payment_methods" USING "btree" ("tenant_id");



CREATE INDEX "idx_payments_order_id" ON "public"."payments" USING "btree" ("order_id");



CREATE INDEX "idx_payments_payment_method_id" ON "public"."payments" USING "btree" ("payment_method_id");



CREATE INDEX "idx_payments_status" ON "public"."payments" USING "btree" ("status");



CREATE INDEX "idx_payments_tenant_id" ON "public"."payments" USING "btree" ("tenant_id");



CREATE INDEX "idx_permissions_created_by" ON "public"."permissions" USING "btree" ("created_by");



CREATE INDEX "idx_permissions_resource" ON "public"."permissions" USING "btree" ("resource");



CREATE INDEX "idx_photo_gallery_category_id" ON "public"."photo_gallery" USING "btree" ("category_id");



CREATE INDEX "idx_photo_gallery_created_by" ON "public"."photo_gallery" USING "btree" ("created_by");



CREATE INDEX "idx_photo_gallery_pagination" ON "public"."photo_gallery" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_photo_gallery_tags_created_by" ON "public"."photo_gallery_tags" USING "btree" ("created_by");



CREATE INDEX "idx_photo_gallery_tags_photo_gallery_id" ON "public"."photo_gallery_tags" USING "btree" ("photo_gallery_id");



CREATE INDEX "idx_photo_gallery_tags_tag_id" ON "public"."photo_gallery_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_photo_gallery_tags_tenant_id" ON "public"."photo_gallery_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_photo_gallery_tenant_id" ON "public"."photo_gallery" USING "btree" ("tenant_id");



CREATE INDEX "idx_policies_tenant_id" ON "public"."policies" USING "btree" ("tenant_id");



CREATE INDEX "idx_portfolio_category_id" ON "public"."portfolio" USING "btree" ("category_id");



CREATE INDEX "idx_portfolio_created_by" ON "public"."portfolio" USING "btree" ("created_by");



CREATE INDEX "idx_portfolio_pagination" ON "public"."portfolio" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_portfolio_tags_created_by" ON "public"."portfolio_tags" USING "btree" ("created_by");



CREATE INDEX "idx_portfolio_tags_portfolio_id" ON "public"."portfolio_tags" USING "btree" ("portfolio_id");



CREATE INDEX "idx_portfolio_tags_tag_id" ON "public"."portfolio_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_portfolio_tags_tenant_id" ON "public"."portfolio_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_portfolio_tenant_id" ON "public"."portfolio" USING "btree" ("tenant_id");



CREATE INDEX "idx_product_tags_created_by" ON "public"."product_tags" USING "btree" ("created_by");



CREATE INDEX "idx_product_tags_product_id" ON "public"."product_tags" USING "btree" ("product_id");



CREATE INDEX "idx_product_tags_tag_id" ON "public"."product_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_product_tags_tenant_id" ON "public"."product_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_product_type_tags_created_by" ON "public"."product_type_tags" USING "btree" ("created_by");



CREATE INDEX "idx_product_type_tags_product_type_id" ON "public"."product_type_tags" USING "btree" ("product_type_id");



CREATE INDEX "idx_product_type_tags_tag_id" ON "public"."product_type_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_product_type_tags_tenant_id" ON "public"."product_type_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_product_types_created_by" ON "public"."product_types" USING "btree" ("created_by");



CREATE INDEX "idx_product_types_deleted_at" ON "public"."product_types" USING "btree" ("deleted_at");



CREATE INDEX "idx_product_types_tenant_id" ON "public"."product_types" USING "btree" ("tenant_id");



CREATE INDEX "idx_products_category_id" ON "public"."products" USING "btree" ("category_id");



CREATE INDEX "idx_products_created_by" ON "public"."products" USING "btree" ("created_by");



CREATE INDEX "idx_products_pagination" ON "public"."products" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_products_product_type_id" ON "public"."products" USING "btree" ("product_type_id");



CREATE INDEX "idx_products_status" ON "public"."products" USING "btree" ("status");



CREATE INDEX "idx_products_tenant_id" ON "public"."products" USING "btree" ("tenant_id");



CREATE INDEX "idx_products_tenant_slug" ON "public"."products" USING "btree" ("tenant_id", "slug");



CREATE INDEX "idx_products_tenant_status" ON "public"."products" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_promotion_tags_created_by" ON "public"."promotion_tags" USING "btree" ("created_by");



CREATE INDEX "idx_promotion_tags_promotion_id" ON "public"."promotion_tags" USING "btree" ("promotion_id");



CREATE INDEX "idx_promotion_tags_tag_id" ON "public"."promotion_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_promotion_tags_tenant_id" ON "public"."promotion_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_promotions_category_id" ON "public"."promotions" USING "btree" ("category_id");



CREATE INDEX "idx_promotions_created_by" ON "public"."promotions" USING "btree" ("created_by");



CREATE INDEX "idx_promotions_pagination" ON "public"."promotions" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_promotions_status" ON "public"."promotions" USING "btree" ("status");



CREATE INDEX "idx_promotions_tenant_id" ON "public"."promotions" USING "btree" ("tenant_id");



CREATE INDEX "idx_push_notifications_created_by" ON "public"."push_notifications" USING "btree" ("created_by");



CREATE INDEX "idx_push_notifications_tenant" ON "public"."push_notifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_regions_code" ON "public"."regions" USING "btree" ("code");



CREATE INDEX "idx_regions_level" ON "public"."regions" USING "btree" ("level_id");



CREATE INDEX "idx_regions_parent" ON "public"."regions" USING "btree" ("parent_id");



CREATE INDEX "idx_regions_tenant" ON "public"."regions" USING "btree" ("tenant_id");



CREATE INDEX "idx_role_permissions_created_by" ON "public"."role_permissions" USING "btree" ("created_by");



CREATE INDEX "idx_role_permissions_permission_id" ON "public"."role_permissions" USING "btree" ("permission_id");



CREATE INDEX "idx_role_permissions_role_id" ON "public"."role_permissions" USING "btree" ("role_id");



CREATE INDEX "idx_role_permissions_tenant_id" ON "public"."role_permissions" USING "btree" ("tenant_id");



CREATE INDEX "idx_role_policies_policy_id" ON "public"."role_policies" USING "btree" ("policy_id");



CREATE INDEX "idx_role_policies_role_id" ON "public"."role_policies" USING "btree" ("role_id");



CREATE INDEX "idx_roles_created_by" ON "public"."roles" USING "btree" ("created_by");



CREATE INDEX "idx_roles_tenant_id" ON "public"."roles" USING "btree" ("tenant_id");



CREATE INDEX "idx_sensor_readings_device" ON "public"."sensor_readings" USING "btree" ("device_id");



CREATE INDEX "idx_sensor_readings_tenant" ON "public"."sensor_readings" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_seo_items" ON "public"."seo_metadata" USING "btree" ("resource_type", "resource_id") WHERE ("resource_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_seo_main_pages" ON "public"."seo_metadata" USING "btree" ("resource_type") WHERE ("resource_id" IS NULL);



CREATE INDEX "idx_seo_metadata_created_by" ON "public"."seo_metadata" USING "btree" ("created_by");



CREATE INDEX "idx_seo_metadata_tenant_id" ON "public"."seo_metadata" USING "btree" ("tenant_id");



CREATE INDEX "idx_settings_tenant_id" ON "public"."settings" USING "btree" ("tenant_id");



CREATE INDEX "idx_sso_audit_logs_tenant_id" ON "public"."sso_audit_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_sso_audit_logs_user_id" ON "public"."sso_audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_sso_providers_created_by" ON "public"."sso_providers" USING "btree" ("created_by");



CREATE INDEX "idx_sso_providers_tenant_id" ON "public"."sso_providers" USING "btree" ("tenant_id");



CREATE INDEX "idx_sso_role_mappings_created_by" ON "public"."sso_role_mappings" USING "btree" ("created_by");



CREATE INDEX "idx_sso_role_mappings_internal_role_id" ON "public"."sso_role_mappings" USING "btree" ("internal_role_id");



CREATE INDEX "idx_sso_role_mappings_provider" ON "public"."sso_role_mappings" USING "btree" ("provider_id");



CREATE INDEX "idx_tags_created_by" ON "public"."tags" USING "btree" ("created_by");



CREATE INDEX "idx_tags_is_active" ON "public"."tags" USING "btree" ("is_active") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tags_slug" ON "public"."tags" USING "btree" ("slug");



CREATE INDEX "idx_tags_tenant_id" ON "public"."tags" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_tags_tenant_slug" ON "public"."tags" USING "btree" ("tenant_id", "slug");



CREATE INDEX "idx_template_assignments_template_id" ON "public"."template_assignments" USING "btree" ("template_id");



CREATE INDEX "idx_template_assignments_tenant_id" ON "public"."template_assignments" USING "btree" ("tenant_id");



CREATE INDEX "idx_template_parts_tenant" ON "public"."template_parts" USING "btree" ("tenant_id");



CREATE INDEX "idx_templates_category" ON "public"."templates" USING "btree" ("category");



CREATE INDEX "idx_templates_slug" ON "public"."templates" USING "btree" ("slug");



CREATE INDEX "idx_templates_tenant_id" ON "public"."templates" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenants_host" ON "public"."tenants" USING "btree" ("host");



CREATE INDEX "idx_testimonies_category_id" ON "public"."testimonies" USING "btree" ("category_id");



CREATE INDEX "idx_testimonies_created_by" ON "public"."testimonies" USING "btree" ("created_by");



CREATE INDEX "idx_testimonies_published_at" ON "public"."testimonies" USING "btree" ("published_at");



CREATE INDEX "idx_testimonies_status" ON "public"."testimonies" USING "btree" ("status");



CREATE INDEX "idx_testimonies_tenant_id" ON "public"."testimonies" USING "btree" ("tenant_id");



CREATE INDEX "idx_testimony_tags_created_by" ON "public"."testimony_tags" USING "btree" ("created_by");



CREATE INDEX "idx_testimony_tags_tag_id" ON "public"."testimony_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_testimony_tags_tenant_id" ON "public"."testimony_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_testimony_tags_testimony_id" ON "public"."testimony_tags" USING "btree" ("testimony_id");



CREATE INDEX "idx_themes_created_by" ON "public"."themes" USING "btree" ("created_by");



CREATE INDEX "idx_themes_tenant_id" ON "public"."themes" USING "btree" ("tenant_id");



CREATE INDEX "idx_two_factor_audit_logs_tenant_id" ON "public"."two_factor_audit_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_two_factor_auth_tenant_id" ON "public"."two_factor_auth" USING "btree" ("tenant_id");



CREATE INDEX "idx_users_admin_approved_by" ON "public"."users" USING "btree" ("admin_approved_by");



CREATE INDEX "idx_users_approval_status" ON "public"."users" USING "btree" ("approval_status");



CREATE INDEX "idx_users_created_at" ON "public"."users" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_users_created_by" ON "public"."users" USING "btree" ("created_by");



CREATE INDEX "idx_users_deleted_at" ON "public"."users" USING "btree" ("deleted_at");



CREATE INDEX "idx_users_region" ON "public"."users" USING "btree" ("region_id");



CREATE INDEX "idx_users_role_id" ON "public"."users" USING "btree" ("role_id");



CREATE INDEX "idx_users_super_admin_approved_by" ON "public"."users" USING "btree" ("super_admin_approved_by");



CREATE INDEX "idx_users_tenant_id" ON "public"."users" USING "btree" ("tenant_id");



CREATE INDEX "idx_users_tenant_role" ON "public"."users" USING "btree" ("tenant_id", "role_id");



CREATE INDEX "idx_video_gallery_category_id" ON "public"."video_gallery" USING "btree" ("category_id");



CREATE INDEX "idx_video_gallery_created_by" ON "public"."video_gallery" USING "btree" ("created_by");



CREATE INDEX "idx_video_gallery_tags_created_by" ON "public"."video_gallery_tags" USING "btree" ("created_by");



CREATE INDEX "idx_video_gallery_tags_tag_id" ON "public"."video_gallery_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_video_gallery_tags_tenant_id" ON "public"."video_gallery_tags" USING "btree" ("tenant_id");



CREATE INDEX "idx_video_gallery_tags_video_gallery_id" ON "public"."video_gallery_tags" USING "btree" ("video_gallery_id");



CREATE INDEX "idx_video_gallery_tenant_id" ON "public"."video_gallery" USING "btree" ("tenant_id");



CREATE INDEX "idx_widgets_area" ON "public"."widgets" USING "btree" ("area_id");



CREATE INDEX "idx_widgets_tenant" ON "public"."widgets" USING "btree" ("tenant_id");



CREATE INDEX "notification_readers_user_id_idx" ON "public"."notification_readers" USING "btree" ("user_id");



CREATE INDEX "notifications_created_by_idx" ON "public"."notifications" USING "btree" ("created_by");



CREATE UNIQUE INDEX "seo_metadata_unique_idx" ON "public"."seo_metadata" USING "btree" ("resource_type", COALESCE("resource_id", '00000000-0000-0000-0000-000000000000'::"uuid"));



CREATE INDEX "two_factor_audit_logs_user_id_idx" ON "public"."two_factor_audit_logs" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "audit_account_requests" AFTER INSERT OR DELETE OR UPDATE ON "public"."account_requests" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_log_changes_admin_menus" AFTER INSERT OR DELETE OR UPDATE ON "public"."admin_menus" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_log_changes_permissions" AFTER INSERT OR DELETE OR UPDATE ON "public"."permissions" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_log_changes_policies" AFTER INSERT OR DELETE OR UPDATE ON "public"."policies" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_log_changes_role_permissions" AFTER INSERT OR DELETE OR UPDATE ON "public"."role_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_log_changes_role_policies" AFTER INSERT OR DELETE OR UPDATE ON "public"."role_policies" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_log_changes_roles" AFTER INSERT OR DELETE OR UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_log_changes_templates" AFTER INSERT OR DELETE OR UPDATE ON "public"."templates" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_log_changes_tenants" AFTER INSERT OR DELETE OR UPDATE ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_log_changes_users" AFTER INSERT OR DELETE OR UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_orders" AFTER INSERT OR DELETE OR UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_products" AFTER INSERT OR DELETE OR UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_role_permissions" AFTER INSERT OR DELETE OR UPDATE ON "public"."role_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_roles" AFTER INSERT OR DELETE OR UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_settings" AFTER INSERT OR DELETE OR UPDATE ON "public"."settings" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_users" AFTER INSERT OR DELETE OR UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "extension_audit_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."extensions" FOR EACH ROW EXECUTE FUNCTION "public"."log_extension_change"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."announcement_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."announcements" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."article_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."articles" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."auth_hibp_events" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."backup_logs" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."backup_schedules" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."backups" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."contact_message_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."contact_messages" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."contact_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."extension_menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."extension_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."extension_rbac_integration" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."extension_routes" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."extension_routes_registry" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."extensions" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."menu_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."menus" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."page_categories" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."page_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."permissions" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."photo_gallery" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."photo_gallery_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."portfolio" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."portfolio_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."product_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."product_type_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."product_types" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."promotion_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."promotions" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."role_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."seo_metadata" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."testimonies" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."testimony_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."video_gallery" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "lock_created_by_trg" BEFORE UPDATE ON "public"."video_gallery_tags" FOR EACH ROW EXECUTE FUNCTION "public"."lock_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."announcement_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."announcements" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."article_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."articles" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."auth_hibp_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."backup_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."backup_schedules" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."backups" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."contact_message_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."contact_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."contact_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."extension_menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."extension_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."extension_rbac_integration" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."extension_routes" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."extension_routes_registry" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."extensions" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."menu_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."menus" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."page_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."page_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."permissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."photo_gallery" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."photo_gallery_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."portfolio" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."portfolio_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."product_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."product_type_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."product_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."promotion_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."promotions" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."role_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."seo_metadata" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."testimonies" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."testimony_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."video_gallery" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "set_created_by_trg" BEFORE INSERT ON "public"."video_gallery_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_created_by"();



CREATE OR REPLACE TRIGGER "tr_enforce_storage_limit" BEFORE INSERT ON "public"."files" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_storage_limit"();



CREATE OR REPLACE TRIGGER "tr_enforce_user_limit" BEFORE INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_user_limit"();



CREATE OR REPLACE TRIGGER "trg_articles_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."articles" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."announcements" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."articles" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."contact_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."extension_routes" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."extensions" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."files" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."menus" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."photo_gallery" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."portfolio" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."product_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."promotions" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."testimonies" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."themes" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_tenant_id" BEFORE INSERT ON "public"."video_gallery" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_id"();



CREATE OR REPLACE TRIGGER "trigger_ensure_single_active_theme" BEFORE INSERT OR UPDATE OF "is_active" ON "public"."themes" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_single_active_theme"();



CREATE OR REPLACE TRIGGER "update_announcements_updated_at" BEFORE UPDATE ON "public"."announcements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_articles_updated_at" BEFORE UPDATE ON "public"."articles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extension_routes_updated_at" BEFORE UPDATE ON "public"."extension_routes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extensions_updated_at" BEFORE UPDATE ON "public"."extensions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_files_updated_at" BEFORE UPDATE ON "public"."files" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_notifications_updated_at" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_pages_updated_at" BEFORE UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_photo_gallery_updated_at" BEFORE UPDATE ON "public"."photo_gallery" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_portfolio_updated_at" BEFORE UPDATE ON "public"."portfolio" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_promotions_updated_at" BEFORE UPDATE ON "public"."promotions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_seo_metadata_updated_at" BEFORE UPDATE ON "public"."seo_metadata" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_template_assignments_updated_at" BEFORE UPDATE ON "public"."template_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_template_parts_updated_at" BEFORE UPDATE ON "public"."template_parts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_template_strings_updated_at" BEFORE UPDATE ON "public"."template_strings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_templates_updated_at" BEFORE UPDATE ON "public"."templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_testimonies_updated_at" BEFORE UPDATE ON "public"."testimonies" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_video_gallery_updated_at" BEFORE UPDATE ON "public"."video_gallery" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_widgets_updated_at" BEFORE UPDATE ON "public"."widgets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."account_requests"
    ADD CONSTRAINT "account_requests_admin_approved_by_fkey" FOREIGN KEY ("admin_approved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."account_requests"
    ADD CONSTRAINT "account_requests_super_admin_approved_by_fkey" FOREIGN KEY ("super_admin_approved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."account_requests"
    ADD CONSTRAINT "account_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."announcement_tags"
    ADD CONSTRAINT "announcement_tags_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcement_tags"
    ADD CONSTRAINT "announcement_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcement_tags"
    ADD CONSTRAINT "announcement_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."article_tags"
    ADD CONSTRAINT "article_tags_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_tags"
    ADD CONSTRAINT "article_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_tags"
    ADD CONSTRAINT "article_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_current_assignee_id_fkey" FOREIGN KEY ("current_assignee_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."auth_hibp_events"
    ADD CONSTRAINT "auth_hibp_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."backup_logs"
    ADD CONSTRAINT "backup_logs_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "public"."backups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."backup_logs"
    ADD CONSTRAINT "backup_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."backup_schedules"
    ADD CONSTRAINT "backup_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."backup_schedules"
    ADD CONSTRAINT "backup_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."backups"
    ADD CONSTRAINT "backups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."backups"
    ADD CONSTRAINT "backups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "carts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."contact_message_tags"
    ADD CONSTRAINT "contact_message_tags_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."contact_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_message_tags"
    ADD CONSTRAINT "contact_message_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_message_tags"
    ADD CONSTRAINT "contact_message_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_messages"
    ADD CONSTRAINT "contact_messages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."contact_messages"
    ADD CONSTRAINT "contact_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."contact_tags"
    ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_tags"
    ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_tags"
    ADD CONSTRAINT "contact_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extension_logs"
    ADD CONSTRAINT "extension_logs_extension_id_fkey" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extension_logs"
    ADD CONSTRAINT "extension_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."extension_logs"
    ADD CONSTRAINT "extension_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."extension_menu_items"
    ADD CONSTRAINT "extension_menu_items_extension_id_fkey" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extension_permissions"
    ADD CONSTRAINT "extension_permissions_extension_id_fkey" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extension_rbac_integration"
    ADD CONSTRAINT "extension_rbac_integration_extension_id_fkey" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extension_rbac_integration"
    ADD CONSTRAINT "extension_rbac_integration_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extension_rbac_integration"
    ADD CONSTRAINT "extension_rbac_integration_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extension_routes"
    ADD CONSTRAINT "extension_routes_extension_id_fkey" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extension_routes_registry"
    ADD CONSTRAINT "extension_routes_registry_extension_id_fkey" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extension_routes"
    ADD CONSTRAINT "extension_routes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."extensions"
    ADD CONSTRAINT "extensions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."extensions"
    ADD CONSTRAINT "extensions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."file_permissions"
    ADD CONSTRAINT "file_permissions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."file_permissions"
    ADD CONSTRAINT "file_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."file_permissions"
    ADD CONSTRAINT "file_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."menu_permissions"
    ADD CONSTRAINT "menu_permissions_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_permissions"
    ADD CONSTRAINT "menu_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_permissions"
    ADD CONSTRAINT "menu_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menus"
    ADD CONSTRAINT "menus_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."menus"
    ADD CONSTRAINT "menus_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."menus"("id");



ALTER TABLE ONLY "public"."menus"
    ADD CONSTRAINT "menus_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."menus"
    ADD CONSTRAINT "menus_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."mobile_app_config"
    ADD CONSTRAINT "mobile_app_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mobile_app_config"
    ADD CONSTRAINT "mobile_app_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."mobile_users"
    ADD CONSTRAINT "mobile_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mobile_users"
    ADD CONSTRAINT "mobile_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_readers"
    ADD CONSTRAINT "notification_readers_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_readers"
    ADD CONSTRAINT "notification_readers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."page_categories"
    ADD CONSTRAINT "page_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_categories"
    ADD CONSTRAINT "page_categories_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_categories"
    ADD CONSTRAINT "page_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_tags"
    ADD CONSTRAINT "page_tags_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_tags"
    ADD CONSTRAINT "page_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."page_tags"
    ADD CONSTRAINT "page_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_current_assignee_id_fkey" FOREIGN KEY ("current_assignee_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."photo_gallery"
    ADD CONSTRAINT "photo_gallery_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."photo_gallery"
    ADD CONSTRAINT "photo_gallery_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."photo_gallery_tags"
    ADD CONSTRAINT "photo_gallery_tags_photo_gallery_id_fkey" FOREIGN KEY ("photo_gallery_id") REFERENCES "public"."photo_gallery"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_gallery_tags"
    ADD CONSTRAINT "photo_gallery_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_gallery_tags"
    ADD CONSTRAINT "photo_gallery_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_gallery"
    ADD CONSTRAINT "photo_gallery_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."policies"
    ADD CONSTRAINT "policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."portfolio"
    ADD CONSTRAINT "portfolio_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."portfolio"
    ADD CONSTRAINT "portfolio_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."portfolio_tags"
    ADD CONSTRAINT "portfolio_tags_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolio_tags"
    ADD CONSTRAINT "portfolio_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolio_tags"
    ADD CONSTRAINT "portfolio_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolio"
    ADD CONSTRAINT "portfolio_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."product_tags"
    ADD CONSTRAINT "product_tags_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_tags"
    ADD CONSTRAINT "product_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_tags"
    ADD CONSTRAINT "product_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_type_tags"
    ADD CONSTRAINT "product_type_tags_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_type_tags"
    ADD CONSTRAINT "product_type_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_type_tags"
    ADD CONSTRAINT "product_type_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_types"
    ADD CONSTRAINT "product_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."product_types"
    ADD CONSTRAINT "product_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."promotion_tags"
    ADD CONSTRAINT "promotion_tags_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promotion_tags"
    ADD CONSTRAINT "promotion_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promotion_tags"
    ADD CONSTRAINT "promotion_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."push_notifications"
    ADD CONSTRAINT "push_notifications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."push_notifications"
    ADD CONSTRAINT "push_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "public"."region_levels"("id");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."regions"("id");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_policies"
    ADD CONSTRAINT "role_policies_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_policies"
    ADD CONSTRAINT "role_policies_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."sensor_readings"
    ADD CONSTRAINT "sensor_readings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seo_metadata"
    ADD CONSTRAINT "seo_metadata_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."sso_audit_logs"
    ADD CONSTRAINT "sso_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sso_audit_logs"
    ADD CONSTRAINT "sso_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sso_providers"
    ADD CONSTRAINT "sso_providers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."sso_providers"
    ADD CONSTRAINT "sso_providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."sso_role_mappings"
    ADD CONSTRAINT "sso_role_mappings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."sso_role_mappings"
    ADD CONSTRAINT "sso_role_mappings_internal_role_id_fkey" FOREIGN KEY ("internal_role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."template_assignments"
    ADD CONSTRAINT "template_assignments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."template_assignments"
    ADD CONSTRAINT "template_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_parts"
    ADD CONSTRAINT "template_parts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."testimonies"
    ADD CONSTRAINT "testimonies_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."testimonies"
    ADD CONSTRAINT "testimonies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."testimonies"
    ADD CONSTRAINT "testimonies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."testimony_tags"
    ADD CONSTRAINT "testimony_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."testimony_tags"
    ADD CONSTRAINT "testimony_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."testimony_tags"
    ADD CONSTRAINT "testimony_tags_testimony_id_fkey" FOREIGN KEY ("testimony_id") REFERENCES "public"."testimonies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."themes"
    ADD CONSTRAINT "themes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."themes"
    ADD CONSTRAINT "themes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."two_factor_audit_logs"
    ADD CONSTRAINT "two_factor_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."two_factor_audit_logs"
    ADD CONSTRAINT "two_factor_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."two_factor_auth"
    ADD CONSTRAINT "two_factor_auth_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."two_factor_auth"
    ADD CONSTRAINT "two_factor_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_admin_approved_by_fkey" FOREIGN KEY ("admin_approved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_super_admin_approved_by_fkey" FOREIGN KEY ("super_admin_approved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."video_gallery"
    ADD CONSTRAINT "video_gallery_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."video_gallery"
    ADD CONSTRAINT "video_gallery_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."video_gallery_tags"
    ADD CONSTRAINT "video_gallery_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_gallery_tags"
    ADD CONSTRAINT "video_gallery_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_gallery_tags"
    ADD CONSTRAINT "video_gallery_tags_video_gallery_id_fkey" FOREIGN KEY ("video_gallery_id") REFERENCES "public"."video_gallery"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_gallery"
    ADD CONSTRAINT "video_gallery_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."widgets"
    ADD CONSTRAINT "widgets_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "public"."template_parts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."widgets"
    ADD CONSTRAINT "widgets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



CREATE POLICY "Admins View SSO Logs" ON "public"."sso_audit_logs" FOR SELECT USING (("public"."get_my_role"() = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])));



CREATE POLICY "Admins manage extension_menu_items" ON "public"."extension_menu_items" TO "authenticated" USING ("public"."is_admin_or_above"()) WITH CHECK ("public"."is_admin_or_above"());



CREATE POLICY "Authenticated Insert" ON "public"."extension_logs" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "File permissions tenant isolation" ON "public"."file_permissions" TO "authenticated" USING (("public"."is_platform_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."files" "f"
  WHERE (("f"."id" = "file_permissions"."file_id") AND ("f"."tenant_id" = "public"."current_tenant_id"())))))) WITH CHECK (("public"."is_platform_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."files" "f"
  WHERE (("f"."id" = "file_permissions"."file_id") AND ("f"."tenant_id" = "public"."current_tenant_id"()))))));



CREATE POLICY "No Updates" ON "public"."extension_logs" FOR UPDATE USING (false);



CREATE POLICY "Payment methods Delete" ON "public"."payment_methods" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payment methods Insert" ON "public"."payment_methods" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payment methods Select" ON "public"."payment_methods" FOR SELECT USING (((("is_active" = true) AND ("deleted_at" IS NULL)) OR (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"])))))))));



CREATE POLICY "Payment methods Update" ON "public"."payment_methods" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payments Delete" ON "public"."payments" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payments Insert" ON "public"."payments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payments Select" ON "public"."payments" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))) OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "payments"."order_id") AND ("o"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Payments Update" ON "public"."payments" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Platform Admin Delete Only" ON "public"."extension_logs" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "Region levels viewable by authenticated" ON "public"."region_levels" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Regions tenant isolation" ON "public"."regions" TO "authenticated" USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "System Insert SSO Logs" ON "public"."sso_audit_logs" FOR INSERT WITH CHECK (true);



CREATE POLICY "System can insert 2fa logs" ON "public"."two_factor_audit_logs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Tenant Read Own Logs" ON "public"."extension_logs" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "Users can delete own 2fa" ON "public"."two_factor_auth" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own carts" ON "public"."carts" FOR INSERT WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("session_id" IS NOT NULL)));



CREATE POLICY "Users can modify own 2fa" ON "public"."two_factor_auth" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own 2fa" ON "public"."two_factor_auth" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own carts" ON "public"."carts" FOR UPDATE USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("session_id" IS NOT NULL)));



CREATE POLICY "Users can view own 2fa" ON "public"."two_factor_auth" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own 2fa logs" ON "public"."two_factor_audit_logs" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users create own orders" ON "public"."orders" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users view own orders" ON "public"."orders" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "public"."get_my_role_name"() AS "get_my_role_name") = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'editor'::"text"]))));



ALTER TABLE "public"."account_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "account_requests_delete_unified" ON "public"."account_requests" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "account_requests_insert_unified" ON "public"."account_requests" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "account_requests_select_unified" ON "public"."account_requests" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "account_requests_update_unified" ON "public"."account_requests" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."admin_menus" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_menus_delete_unified" ON "public"."admin_menus" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "admin_menus_insert_unified" ON "public"."admin_menus" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "admin_menus_select_unified" ON "public"."admin_menus" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "admin_menus_update_unified" ON "public"."admin_menus" FOR UPDATE USING ("public"."is_platform_admin"());



ALTER TABLE "public"."announcement_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "announcement_tags_select_public" ON "public"."announcement_tags" FOR SELECT USING (true);



ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "announcements_delete_unified" ON "public"."announcements" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "announcements_insert_unified" ON "public"."announcements" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "announcements_select_unified" ON "public"."announcements" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "announcements_update_unified" ON "public"."announcements" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."article_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "article_tags_select_public" ON "public"."article_tags" FOR SELECT USING (true);



ALTER TABLE "public"."articles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "articles_delete_unified" ON "public"."articles" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "articles_insert_unified" ON "public"."articles" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "articles_select_unified" ON "public"."articles" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "articles_update_unified" ON "public"."articles" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_insert_unified" ON "public"."audit_logs" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "audit_logs_select_unified" ON "public"."audit_logs" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR (("tenant_id" IS NULL) AND "public"."is_platform_admin"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."auth_hibp_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auth_hibp_events_select_own_v2" ON "public"."auth_hibp_events" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."backup_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "backup_logs_insert_auth" ON "public"."backup_logs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "backup_logs_select_auth" ON "public"."backup_logs" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."backup_schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "backup_schedules_delete_owner" ON "public"."backup_schedules" FOR DELETE TO "authenticated" USING (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "backup_schedules_insert_owner" ON "public"."backup_schedules" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "backup_schedules_select_auth" ON "public"."backup_schedules" FOR SELECT TO "authenticated" USING ((("created_by" IS NULL) OR ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "backup_schedules_update_owner" ON "public"."backup_schedules" FOR UPDATE TO "authenticated" USING (("created_by" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."backups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "backups_delete_unified" ON "public"."backups" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "backups_insert_unified" ON "public"."backups" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "backups_select_unified" ON "public"."backups" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "backups_update_unified" ON "public"."backups" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."cart_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cart_items_delete_unified" ON "public"."cart_items" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "cart_items_insert_unified" ON "public"."cart_items" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "cart_items_select_unified" ON "public"."cart_items" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "cart_items_update_unified" ON "public"."cart_items" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."carts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "carts_select_policy" ON "public"."carts" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("session_id" IS NOT NULL) OR (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"])))))))));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categories_delete_unified" ON "public"."categories" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "categories_insert_unified" ON "public"."categories" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "categories_select_unified" ON "public"."categories" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "categories_update_unified" ON "public"."categories" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."contact_message_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_message_tags_select_public" ON "public"."contact_message_tags" FOR SELECT USING (true);



ALTER TABLE "public"."contact_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_messages_delete_admin" ON "public"."contact_messages" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contact_messages_insert_public" ON "public"."contact_messages" FOR INSERT WITH CHECK (true);



CREATE POLICY "contact_messages_modify_admin" ON "public"."contact_messages" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contact_messages_select_unified" ON "public"."contact_messages" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."contact_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_tags_select_public" ON "public"."contact_tags" FOR SELECT USING (true);



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_delete_unified" ON "public"."contacts" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contacts_insert_unified" ON "public"."contacts" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contacts_select_unified" ON "public"."contacts" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contacts_update_unified" ON "public"."contacts" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devices_delete_policy" ON "public"."devices" FOR DELETE USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND ("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



CREATE POLICY "devices_insert_policy" ON "public"."devices" FOR INSERT WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "devices_select_policy" ON "public"."devices" FOR SELECT USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND ("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



CREATE POLICY "devices_update_policy" ON "public"."devices" FOR UPDATE USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND ("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



ALTER TABLE "public"."email_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_logs_insert_unified" ON "public"."email_logs" FOR INSERT WITH CHECK (("public"."is_admin_or_above"() OR "public"."is_platform_admin"()));



CREATE POLICY "email_logs_select_unified" ON "public"."email_logs" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."extension_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."extension_menu_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."extension_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extension_permissions_delete_admin" ON "public"."extension_permissions" FOR DELETE USING ((( SELECT "public"."get_my_role"() AS "get_my_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])));



CREATE POLICY "extension_permissions_insert_admin" ON "public"."extension_permissions" FOR INSERT WITH CHECK ((( SELECT "public"."get_my_role"() AS "get_my_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])));



CREATE POLICY "extension_permissions_select_auth" ON "public"."extension_permissions" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "extension_permissions_update_admin" ON "public"."extension_permissions" FOR UPDATE USING ((( SELECT "public"."get_my_role"() AS "get_my_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])));



CREATE POLICY "extension_rbac_delete" ON "public"."extension_rbac_integration" FOR DELETE USING ((( SELECT "public"."get_my_role"() AS "get_my_role") = 'super_admin'::"text"));



CREATE POLICY "extension_rbac_insert" ON "public"."extension_rbac_integration" FOR INSERT WITH CHECK ((( SELECT "public"."get_my_role"() AS "get_my_role") = 'super_admin'::"text"));



ALTER TABLE "public"."extension_rbac_integration" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extension_rbac_select" ON "public"."extension_rbac_integration" FOR SELECT USING (true);



CREATE POLICY "extension_rbac_update" ON "public"."extension_rbac_integration" FOR UPDATE USING ((( SELECT "public"."get_my_role"() AS "get_my_role") = 'super_admin'::"text"));



ALTER TABLE "public"."extension_routes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extension_routes_delete_unified" ON "public"."extension_routes" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "extension_routes_insert_unified" ON "public"."extension_routes" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."extension_routes_registry" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extension_routes_registry_select" ON "public"."extension_routes_registry" FOR SELECT USING ((("is_active" = true) OR (( SELECT "public"."get_my_role"() AS "get_my_role") = 'super_admin'::"text")));



CREATE POLICY "extension_routes_select_unified" ON "public"."extension_routes" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "extension_routes_update_unified" ON "public"."extension_routes" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."extensions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extensions_delete_unified" ON "public"."extensions" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "extensions_insert_unified" ON "public"."extensions" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "extensions_select_unified" ON "public"."extensions" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR ("tenant_id" IS NULL) OR "public"."is_platform_admin"()));



CREATE POLICY "extensions_update_unified" ON "public"."extensions" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."file_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "files_delete_unified" ON "public"."files" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "files_insert_unified" ON "public"."files" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "files_select_unified" ON "public"."files" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND ("deleted_at" IS NULL)) OR "public"."is_platform_admin"()));



CREATE POLICY "files_update_unified" ON "public"."files" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."menu_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "menu_permissions_select_public" ON "public"."menu_permissions" FOR SELECT USING (true);



ALTER TABLE "public"."menus" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "menus_delete_unified" ON "public"."menus" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "menus_insert_unified" ON "public"."menus" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "menus_select_unified" ON "public"."menus" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "menus_update_unified" ON "public"."menus" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."mobile_app_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mobile_app_config_access" ON "public"."mobile_app_config" USING ((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



ALTER TABLE "public"."mobile_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mobile_users_access" ON "public"."mobile_users" USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))) OR ( SELECT "public"."is_admin_or_above"() AS "is_admin_or_above") OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



ALTER TABLE "public"."notification_readers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_readers_delete_policy" ON "public"."notification_readers" FOR DELETE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notification_readers_insert_policy" ON "public"."notification_readers" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notification_readers_select_policy" ON "public"."notification_readers" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "public"."get_my_role"() AS "get_my_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_delete_unified" ON "public"."notifications" FOR DELETE USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "notifications_insert_unified" ON "public"."notifications" FOR INSERT WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "notifications_select_unified" ON "public"."notifications" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "notifications_update_unified" ON "public"."notifications" FOR UPDATE USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_items_delete_unified" ON "public"."order_items" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "order_items_insert_unified" ON "public"."order_items" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "order_items_select_unified" ON "public"."order_items" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "order_items_update_unified" ON "public"."order_items" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "page_categories_select_public" ON "public"."page_categories" FOR SELECT TO "anon", "authenticated" USING (true);



ALTER TABLE "public"."page_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "page_tags_select_public" ON "public"."page_tags" FOR SELECT USING (true);



ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pages_delete_unified" ON "public"."pages" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "pages_insert_unified" ON "public"."pages" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "pages_select_unified" ON "public"."pages" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND ("deleted_at" IS NULL)) OR "public"."is_platform_admin"()));



CREATE POLICY "pages_update_unified" ON "public"."pages" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."payment_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permissions_delete_policy" ON "public"."permissions" FOR DELETE TO "authenticated" USING ("public"."is_super_admin"());



CREATE POLICY "permissions_insert_policy" ON "public"."permissions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "permissions_select_policy" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "permissions_update_policy" ON "public"."permissions" FOR UPDATE TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK (true);



ALTER TABLE "public"."photo_gallery" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "photo_gallery_delete_unified" ON "public"."photo_gallery" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "photo_gallery_insert_unified" ON "public"."photo_gallery" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "photo_gallery_select_unified" ON "public"."photo_gallery" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."photo_gallery_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "photo_gallery_tags_select_public" ON "public"."photo_gallery_tags" FOR SELECT USING (true);



CREATE POLICY "photo_gallery_update_unified" ON "public"."photo_gallery" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."policies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "policies_delete_unified" ON "public"."policies" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "policies_insert_unified" ON "public"."policies" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "policies_select_unified" ON "public"."policies" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR ("tenant_id" IS NULL) OR "public"."is_platform_admin"()));



CREATE POLICY "policies_update_unified" ON "public"."policies" FOR UPDATE USING ("public"."is_platform_admin"());



ALTER TABLE "public"."portfolio" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "portfolio_delete_unified" ON "public"."portfolio" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "portfolio_insert_unified" ON "public"."portfolio" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "portfolio_select_unified" ON "public"."portfolio" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."portfolio_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "portfolio_tags_select_public" ON "public"."portfolio_tags" FOR SELECT USING (true);



CREATE POLICY "portfolio_update_unified" ON "public"."portfolio" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."product_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_tags_select_public" ON "public"."product_tags" FOR SELECT USING (true);



ALTER TABLE "public"."product_type_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_type_tags_select_public" ON "public"."product_type_tags" FOR SELECT USING (true);



ALTER TABLE "public"."product_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_types_delete_unified" ON "public"."product_types" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "product_types_insert_unified" ON "public"."product_types" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "product_types_select_unified" ON "public"."product_types" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "product_types_update_unified" ON "public"."product_types" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_delete_unified" ON "public"."products" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "products_insert_unified" ON "public"."products" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "products_select_unified" ON "public"."products" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "products_update_unified" ON "public"."products" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."promotion_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "promotion_tags_select_public" ON "public"."promotion_tags" FOR SELECT USING (true);



ALTER TABLE "public"."promotions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "promotions_delete_unified" ON "public"."promotions" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "promotions_insert_unified" ON "public"."promotions" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "promotions_select_unified" ON "public"."promotions" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "promotions_update_unified" ON "public"."promotions" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."push_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_notifications_access" ON "public"."push_notifications" USING ((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



ALTER TABLE "public"."region_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."regions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_permissions_delete_policy" ON "public"."role_permissions" FOR DELETE TO "authenticated" USING ("public"."is_super_admin"());



CREATE POLICY "role_permissions_insert_policy" ON "public"."role_permissions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "role_permissions_select_policy" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "role_permissions_update_policy" ON "public"."role_permissions" FOR UPDATE TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK (true);



ALTER TABLE "public"."role_policies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_policies_delete_unified" ON "public"."role_policies" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "role_policies_insert_unified" ON "public"."role_policies" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "role_policies_select_unified" ON "public"."role_policies" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "role_policies_update_unified" ON "public"."role_policies" FOR UPDATE USING ("public"."is_platform_admin"());



ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_delete_unified" ON "public"."roles" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "roles_insert_unified" ON "public"."roles" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "roles_select_unified" ON "public"."roles" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR ("tenant_id" IS NULL) OR "public"."is_platform_admin"()));



CREATE POLICY "roles_update_unified" ON "public"."roles" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."sensor_readings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sensor_readings_access" ON "public"."sensor_readings" USING ((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



ALTER TABLE "public"."seo_metadata" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seo_metadata_select_public" ON "public"."seo_metadata" FOR SELECT USING (true);



ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settings_delete_unified" ON "public"."settings" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "settings_insert_unified" ON "public"."settings" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "settings_select_unified" ON "public"."settings" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR ("tenant_id" IS NULL) OR "public"."is_platform_admin"()));



CREATE POLICY "settings_update_unified" ON "public"."settings" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."sso_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sso_providers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sso_providers_isolation_policy" ON "public"."sso_providers" USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."sso_role_mappings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sso_role_mappings_delete_unified" ON "public"."sso_role_mappings" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."sso_providers" "p"
  WHERE (("p"."id" = ("sso_role_mappings"."provider_id")::"uuid") AND ((("p"."tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"())))));



CREATE POLICY "sso_role_mappings_insert_unified" ON "public"."sso_role_mappings" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sso_providers" "p"
  WHERE (("p"."id" = ("sso_role_mappings"."provider_id")::"uuid") AND ((("p"."tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"())))));



CREATE POLICY "sso_role_mappings_select_unified" ON "public"."sso_role_mappings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sso_providers" "p"
  WHERE (("p"."id" = ("sso_role_mappings"."provider_id")::"uuid") AND (("p"."tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"())))));



CREATE POLICY "sso_role_mappings_update_unified" ON "public"."sso_role_mappings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."sso_providers" "p"
  WHERE (("p"."id" = ("sso_role_mappings"."provider_id")::"uuid") AND ((("p"."tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"())))));



ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tags_delete_unified" ON "public"."tags" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "tags_insert_unified" ON "public"."tags" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "tags_select_unified" ON "public"."tags" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "tags_update_unified" ON "public"."tags" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."template_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_assignments_delete_unified" ON "public"."template_assignments" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_assignments_modify_unified" ON "public"."template_assignments" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_assignments_select_unified" ON "public"."template_assignments" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_assignments_update_unified" ON "public"."template_assignments" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."template_parts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_parts_delete_unified" ON "public"."template_parts" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_parts_modify_unified" ON "public"."template_parts" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_parts_select_unified" ON "public"."template_parts" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_parts_update_unified" ON "public"."template_parts" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."template_strings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_strings_delete_unified" ON "public"."template_strings" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "template_strings_insert_unified" ON "public"."template_strings" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "template_strings_select_unified" ON "public"."template_strings" FOR SELECT USING (true);



CREATE POLICY "template_strings_update_unified" ON "public"."template_strings" FOR UPDATE USING ("public"."is_platform_admin"());



ALTER TABLE "public"."templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "templates_delete_unified" ON "public"."templates" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "templates_modify_unified" ON "public"."templates" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "templates_select_unified" ON "public"."templates" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "templates_update_unified" ON "public"."templates" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenants_delete_unified" ON "public"."tenants" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "tenants_insert_unified" ON "public"."tenants" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "tenants_select_unified" ON "public"."tenants" FOR SELECT USING ((("id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "tenants_update_unified" ON "public"."tenants" FOR UPDATE USING ("public"."is_platform_admin"());



ALTER TABLE "public"."testimonies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "testimonies_delete_unified" ON "public"."testimonies" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "testimonies_insert_unified" ON "public"."testimonies" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "testimonies_select_unified" ON "public"."testimonies" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "testimonies_update_unified" ON "public"."testimonies" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."testimony_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "testimony_tags_delete" ON "public"."testimony_tags" FOR DELETE USING ((( SELECT "public"."get_my_role"() AS "get_my_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'editor'::"text"])));



CREATE POLICY "testimony_tags_insert" ON "public"."testimony_tags" FOR INSERT WITH CHECK ((( SELECT "public"."get_my_role"() AS "get_my_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'editor'::"text"])));



CREATE POLICY "testimony_tags_select" ON "public"."testimony_tags" FOR SELECT USING (true);



CREATE POLICY "testimony_tags_update" ON "public"."testimony_tags" FOR UPDATE USING ((( SELECT "public"."get_my_role"() AS "get_my_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'editor'::"text"])));



ALTER TABLE "public"."themes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "themes_delete_unified" ON "public"."themes" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "themes_insert_unified" ON "public"."themes" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "themes_select_unified" ON "public"."themes" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR ("tenant_id" IS NULL) OR "public"."is_platform_admin"()));



CREATE POLICY "themes_update_unified" ON "public"."themes" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."two_factor_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."two_factor_auth" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_delete_unified" ON "public"."users" FOR DELETE USING (("public"."is_admin_or_above"() OR "public"."is_platform_admin"()));



CREATE POLICY "users_insert_unified" ON "public"."users" FOR INSERT WITH CHECK (("public"."is_admin_or_above"() OR "public"."is_platform_admin"()));



CREATE POLICY "users_select_unified" ON "public"."users" FOR SELECT USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "users_update_unified" ON "public"."users" FOR UPDATE USING (("public"."is_admin_or_above"() OR "public"."is_platform_admin"()));



ALTER TABLE "public"."video_gallery" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "video_gallery_delete_unified" ON "public"."video_gallery" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "video_gallery_insert_unified" ON "public"."video_gallery" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "video_gallery_select_unified" ON "public"."video_gallery" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."video_gallery_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "video_gallery_tags_select_public" ON "public"."video_gallery_tags" FOR SELECT USING (true);



CREATE POLICY "video_gallery_update_unified" ON "public"."video_gallery" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."widgets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "widgets_delete_unified" ON "public"."widgets" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "widgets_modify_unified" ON "public"."widgets" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "widgets_select_unified" ON "public"."widgets" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "widgets_update_unified" ON "public"."widgets" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."analyze_file_usage"() TO "anon";
GRANT ALL ON FUNCTION "public"."analyze_file_usage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."analyze_file_usage"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_delete_resource"("resource_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_delete_resource"("resource_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_delete_resource"("resource_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_edit_resource"("resource_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_resource"("resource_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_resource"("resource_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_backups"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_backups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_backups"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_extension"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_extension"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_extension"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_extensions"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_extensions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_extensions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_logs"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_logs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_logs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_monitoring"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_monitoring"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_monitoring"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_resource"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_resource"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_resource"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_settings"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_settings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_settings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_publish_resource"("resource_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_publish_resource"("resource_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_publish_resource"("resource_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_restore_resource"("resource_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_restore_resource"("resource_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_restore_resource"("resource_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_resource"("resource_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_resource"("resource_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_resource"("resource_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_access"("resource_owner_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_access"("resource_owner_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_access"("resource_owner_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_public_permission"("permission_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_public_permission"("permission_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_public_permission"("permission_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_tenant_limit"("check_tenant_id" "uuid", "feature_key" "text", "proposed_usage" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."check_tenant_limit"("check_tenant_id" "uuid", "feature_key" "text", "proposed_usage" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_tenant_limit"("check_tenant_id" "uuid", "feature_key" "text", "proposed_usage" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_tenant_with_defaults"("p_name" "text", "p_slug" "text", "p_domain" "text", "p_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_tenant_with_defaults"("p_name" "text", "p_slug" "text", "p_domain" "text", "p_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_tenant_with_defaults"("p_name" "text", "p_slug" "text", "p_domain" "text", "p_tier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_storage_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_storage_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_storage_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_user_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_user_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_user_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_active_theme"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_single_active_theme"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_active_theme"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_detailed_tag_usage"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_detailed_tag_usage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_detailed_tag_usage"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_permissions"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_permissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_permissions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_role_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role_name"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_storage_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_storage_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_storage_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tags_with_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_tags_with_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tags_with_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tenant_by_domain"("lookup_domain" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_tenant_by_domain"("lookup_domain" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tenant_by_domain"("lookup_domain" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tenant_id_by_host"("lookup_host" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_tenant_id_by_host"("lookup_host" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tenant_id_by_host"("lookup_host" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role_name"("user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role_name"("user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role_name"("user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_permission"("permission_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_permission"("permission_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("permission_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("role_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("role_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("role_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_article_view"("article_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_article_view"("article_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_article_view"("article_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_page_view"("page_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_page_view"("page_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_page_view"("page_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_or_above"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_or_above"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_or_above"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."lock_created_by"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_created_by"() TO "anon";
GRANT ALL ON FUNCTION "public"."lock_created_by"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_created_by"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_extension_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_extension_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_extension_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_sso_event"("p_provider" "text", "p_event_type" "text", "p_details" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_sso_event"("p_provider" "text", "p_event_type" "text", "p_details" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_sso_event"("p_provider" "text", "p_event_type" "text", "p_details" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_duplicates"("table_name" "text", "column_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_duplicates"("table_name" "text", "column_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_duplicates"("table_name" "text", "column_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_permissions"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_permissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_permissions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_created_by"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_created_by"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_created_by"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_created_by"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_request_tenant"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_request_tenant"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_request_tenant"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_resource_tags"("p_resource_id" "uuid", "p_resource_type" "text", "p_tags" "text"[], "p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_resource_tags"("p_resource_id" "uuid", "p_resource_type" "text", "p_tags" "text"[], "p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_resource_tags"("p_resource_id" "uuid", "p_resource_type" "text", "p_tags" "text"[], "p_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_storage_files"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_storage_files"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_storage_files"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_menu_order"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_menu_order"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_menu_order"("payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_isolation_debug"() TO "anon";
GRANT ALL ON FUNCTION "public"."verify_isolation_debug"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_isolation_debug"() TO "service_role";



GRANT ALL ON TABLE "public"."account_requests" TO "anon";
GRANT ALL ON TABLE "public"."account_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."account_requests" TO "service_role";



GRANT ALL ON TABLE "public"."admin_menus" TO "anon";
GRANT ALL ON TABLE "public"."admin_menus" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_menus" TO "service_role";



GRANT ALL ON TABLE "public"."announcement_tags" TO "anon";
GRANT ALL ON TABLE "public"."announcement_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."announcement_tags" TO "service_role";



GRANT ALL ON TABLE "public"."announcements" TO "anon";
GRANT ALL ON TABLE "public"."announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."announcements" TO "service_role";



GRANT ALL ON TABLE "public"."article_tags" TO "anon";
GRANT ALL ON TABLE "public"."article_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."article_tags" TO "service_role";



GRANT ALL ON TABLE "public"."articles" TO "anon";
GRANT ALL ON TABLE "public"."articles" TO "authenticated";
GRANT ALL ON TABLE "public"."articles" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."auth_hibp_events" TO "anon";
GRANT ALL ON TABLE "public"."auth_hibp_events" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_hibp_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."auth_hibp_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."auth_hibp_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."auth_hibp_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."backup_logs" TO "anon";
GRANT ALL ON TABLE "public"."backup_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_logs" TO "service_role";



GRANT ALL ON TABLE "public"."backup_schedules" TO "anon";
GRANT ALL ON TABLE "public"."backup_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."backups" TO "anon";
GRANT ALL ON TABLE "public"."backups" TO "authenticated";
GRANT ALL ON TABLE "public"."backups" TO "service_role";



GRANT ALL ON TABLE "public"."cart_items" TO "anon";
GRANT ALL ON TABLE "public"."cart_items" TO "authenticated";
GRANT ALL ON TABLE "public"."cart_items" TO "service_role";



GRANT ALL ON TABLE "public"."carts" TO "anon";
GRANT ALL ON TABLE "public"."carts" TO "authenticated";
GRANT ALL ON TABLE "public"."carts" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."contact_message_tags" TO "anon";
GRANT ALL ON TABLE "public"."contact_message_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_message_tags" TO "service_role";



GRANT ALL ON TABLE "public"."contact_messages" TO "anon";
GRANT ALL ON TABLE "public"."contact_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_messages" TO "service_role";



GRANT ALL ON TABLE "public"."contact_tags" TO "anon";
GRANT ALL ON TABLE "public"."contact_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_tags" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON TABLE "public"."devices" TO "anon";
GRANT ALL ON TABLE "public"."devices" TO "authenticated";
GRANT ALL ON TABLE "public"."devices" TO "service_role";



GRANT ALL ON TABLE "public"."email_logs" TO "anon";
GRANT ALL ON TABLE "public"."email_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."email_logs" TO "service_role";



GRANT ALL ON TABLE "public"."extension_logs" TO "anon";
GRANT ALL ON TABLE "public"."extension_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."extension_logs" TO "service_role";



GRANT ALL ON TABLE "public"."extension_menu_items" TO "anon";
GRANT ALL ON TABLE "public"."extension_menu_items" TO "authenticated";
GRANT ALL ON TABLE "public"."extension_menu_items" TO "service_role";



GRANT ALL ON TABLE "public"."extension_permissions" TO "anon";
GRANT ALL ON TABLE "public"."extension_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."extension_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."extension_rbac_integration" TO "anon";
GRANT ALL ON TABLE "public"."extension_rbac_integration" TO "authenticated";
GRANT ALL ON TABLE "public"."extension_rbac_integration" TO "service_role";



GRANT ALL ON TABLE "public"."extension_routes" TO "anon";
GRANT ALL ON TABLE "public"."extension_routes" TO "authenticated";
GRANT ALL ON TABLE "public"."extension_routes" TO "service_role";



GRANT ALL ON TABLE "public"."extension_routes_registry" TO "anon";
GRANT ALL ON TABLE "public"."extension_routes_registry" TO "authenticated";
GRANT ALL ON TABLE "public"."extension_routes_registry" TO "service_role";



GRANT ALL ON TABLE "public"."extensions" TO "anon";
GRANT ALL ON TABLE "public"."extensions" TO "authenticated";
GRANT ALL ON TABLE "public"."extensions" TO "service_role";



GRANT ALL ON TABLE "public"."file_permissions" TO "anon";
GRANT ALL ON TABLE "public"."file_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."file_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."files" TO "anon";
GRANT ALL ON TABLE "public"."files" TO "authenticated";
GRANT ALL ON TABLE "public"."files" TO "service_role";



GRANT ALL ON TABLE "public"."menu_permissions" TO "anon";
GRANT ALL ON TABLE "public"."menu_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."menus" TO "anon";
GRANT ALL ON TABLE "public"."menus" TO "authenticated";
GRANT ALL ON TABLE "public"."menus" TO "service_role";



GRANT ALL ON TABLE "public"."mobile_app_config" TO "anon";
GRANT ALL ON TABLE "public"."mobile_app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."mobile_app_config" TO "service_role";



GRANT ALL ON TABLE "public"."mobile_users" TO "anon";
GRANT ALL ON TABLE "public"."mobile_users" TO "authenticated";
GRANT ALL ON TABLE "public"."mobile_users" TO "service_role";



GRANT ALL ON TABLE "public"."notification_readers" TO "anon";
GRANT ALL ON TABLE "public"."notification_readers" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_readers" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."page_categories" TO "anon";
GRANT ALL ON TABLE "public"."page_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."page_categories" TO "service_role";



GRANT ALL ON TABLE "public"."page_tags" TO "anon";
GRANT ALL ON TABLE "public"."page_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."page_tags" TO "service_role";



GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";



GRANT ALL ON TABLE "public"."payment_methods" TO "anon";
GRANT ALL ON TABLE "public"."payment_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_methods" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."photo_gallery" TO "anon";
GRANT ALL ON TABLE "public"."photo_gallery" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_gallery" TO "service_role";



GRANT ALL ON TABLE "public"."photo_gallery_tags" TO "anon";
GRANT ALL ON TABLE "public"."photo_gallery_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_gallery_tags" TO "service_role";



GRANT ALL ON TABLE "public"."policies" TO "anon";
GRANT ALL ON TABLE "public"."policies" TO "authenticated";
GRANT ALL ON TABLE "public"."policies" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio" TO "anon";
GRANT ALL ON TABLE "public"."portfolio" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_tags" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_tags" TO "service_role";



GRANT ALL ON TABLE "public"."product_tags" TO "anon";
GRANT ALL ON TABLE "public"."product_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."product_tags" TO "service_role";



GRANT ALL ON TABLE "public"."product_type_tags" TO "anon";
GRANT ALL ON TABLE "public"."product_type_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."product_type_tags" TO "service_role";



GRANT ALL ON TABLE "public"."product_types" TO "anon";
GRANT ALL ON TABLE "public"."product_types" TO "authenticated";
GRANT ALL ON TABLE "public"."product_types" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."promotion_tags" TO "anon";
GRANT ALL ON TABLE "public"."promotion_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."promotion_tags" TO "service_role";



GRANT ALL ON TABLE "public"."promotions" TO "anon";
GRANT ALL ON TABLE "public"."promotions" TO "authenticated";
GRANT ALL ON TABLE "public"."promotions" TO "service_role";



GRANT ALL ON TABLE "public"."published_articles_view" TO "anon";
GRANT ALL ON TABLE "public"."published_articles_view" TO "authenticated";
GRANT ALL ON TABLE "public"."published_articles_view" TO "service_role";



GRANT ALL ON TABLE "public"."push_notifications" TO "anon";
GRANT ALL ON TABLE "public"."push_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."push_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."region_levels" TO "anon";
GRANT ALL ON TABLE "public"."region_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."region_levels" TO "service_role";



GRANT ALL ON TABLE "public"."regions" TO "anon";
GRANT ALL ON TABLE "public"."regions" TO "authenticated";
GRANT ALL ON TABLE "public"."regions" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."role_policies" TO "anon";
GRANT ALL ON TABLE "public"."role_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."role_policies" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."sensor_readings" TO "anon";
GRANT ALL ON TABLE "public"."sensor_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."sensor_readings" TO "service_role";



GRANT ALL ON TABLE "public"."seo_metadata" TO "anon";
GRANT ALL ON TABLE "public"."seo_metadata" TO "authenticated";
GRANT ALL ON TABLE "public"."seo_metadata" TO "service_role";



GRANT ALL ON TABLE "public"."settings" TO "anon";
GRANT ALL ON TABLE "public"."settings" TO "authenticated";
GRANT ALL ON TABLE "public"."settings" TO "service_role";



GRANT ALL ON TABLE "public"."sso_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."sso_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."sso_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."sso_providers" TO "anon";
GRANT ALL ON TABLE "public"."sso_providers" TO "authenticated";
GRANT ALL ON TABLE "public"."sso_providers" TO "service_role";



GRANT ALL ON TABLE "public"."sso_role_mappings" TO "anon";
GRANT ALL ON TABLE "public"."sso_role_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."sso_role_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON TABLE "public"."template_assignments" TO "anon";
GRANT ALL ON TABLE "public"."template_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."template_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."template_parts" TO "anon";
GRANT ALL ON TABLE "public"."template_parts" TO "authenticated";
GRANT ALL ON TABLE "public"."template_parts" TO "service_role";



GRANT ALL ON TABLE "public"."template_strings" TO "anon";
GRANT ALL ON TABLE "public"."template_strings" TO "authenticated";
GRANT ALL ON TABLE "public"."template_strings" TO "service_role";



GRANT ALL ON TABLE "public"."templates" TO "anon";
GRANT ALL ON TABLE "public"."templates" TO "authenticated";
GRANT ALL ON TABLE "public"."templates" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."testimonies" TO "anon";
GRANT ALL ON TABLE "public"."testimonies" TO "authenticated";
GRANT ALL ON TABLE "public"."testimonies" TO "service_role";



GRANT ALL ON TABLE "public"."testimony_tags" TO "anon";
GRANT ALL ON TABLE "public"."testimony_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."testimony_tags" TO "service_role";



GRANT ALL ON TABLE "public"."themes" TO "anon";
GRANT ALL ON TABLE "public"."themes" TO "authenticated";
GRANT ALL ON TABLE "public"."themes" TO "service_role";



GRANT ALL ON TABLE "public"."two_factor_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."two_factor_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."two_factor_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."two_factor_auth" TO "anon";
GRANT ALL ON TABLE "public"."two_factor_auth" TO "authenticated";
GRANT ALL ON TABLE "public"."two_factor_auth" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."video_gallery" TO "anon";
GRANT ALL ON TABLE "public"."video_gallery" TO "authenticated";
GRANT ALL ON TABLE "public"."video_gallery" TO "service_role";



GRANT ALL ON TABLE "public"."video_gallery_tags" TO "anon";
GRANT ALL ON TABLE "public"."video_gallery_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."video_gallery_tags" TO "service_role";



GRANT ALL ON TABLE "public"."widgets" TO "anon";
GRANT ALL ON TABLE "public"."widgets" TO "authenticated";
GRANT ALL ON TABLE "public"."widgets" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







