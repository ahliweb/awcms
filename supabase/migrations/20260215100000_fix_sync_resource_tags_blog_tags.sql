SET client_min_messages TO warning;

-- Fix sync_resource_tags to use blog_tags after article_tags removal.
CREATE OR REPLACE FUNCTION public.sync_resource_tags(
  p_resource_id uuid,
  p_resource_type text,
  p_tags text[],
  p_tenant_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tag_id uuid;
  v_tag_name text;
  v_slug text;
  target_table regclass;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant ID is required for tag synchronization';
  END IF;

  IF p_resource_type NOT IN ('blogs', 'articles') THEN
    RETURN;
  END IF;

  target_table := to_regclass('public.blog_tags');
  IF target_table IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.blog_tags
  WHERE blog_id = p_resource_id
    AND tenant_id = p_tenant_id;

  IF p_tags IS NOT NULL THEN
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
      v_slug := trim(both '-' from lower(regexp_replace(v_tag_name, '[^a-zA-Z0-9]+', '-', 'g')));

      INSERT INTO public.tags (name, slug, tenant_id)
      VALUES (v_tag_name, v_slug, p_tenant_id)
      ON CONFLICT (tenant_id, slug) DO UPDATE SET name = v_tag_name
      RETURNING id INTO v_tag_id;

      INSERT INTO public.blog_tags (blog_id, tag_id, tenant_id)
      VALUES (p_resource_id, v_tag_id, p_tenant_id)
      ON CONFLICT (blog_id, tag_id) DO NOTHING;
    END LOOP;
  END IF;
END;
$$;
