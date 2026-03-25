SET client_min_messages TO warning;

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
  v_resource_type text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant ID is required for tag synchronization';
  END IF;

  v_resource_type := lower(coalesce(p_resource_type, ''));

  IF v_resource_type IN ('blogs', 'articles') THEN
    IF to_regclass('public.blog_tags') IS NULL THEN
      RETURN;
    END IF;

    DELETE FROM public.blog_tags
    WHERE blog_id = p_resource_id
      AND tenant_id = p_tenant_id;
  ELSIF v_resource_type IN ('pages', 'page') THEN
    IF to_regclass('public.page_tags') IS NULL THEN
      RETURN;
    END IF;

    DELETE FROM public.page_tags
    WHERE page_id = p_resource_id
      AND tenant_id = p_tenant_id;
  ELSE
    RETURN;
  END IF;

  IF p_tags IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_tag_name IN ARRAY p_tags
  LOOP
    v_tag_name := btrim(v_tag_name);

    IF v_tag_name IS NULL OR v_tag_name = '' THEN
      CONTINUE;
    END IF;

    v_slug := trim(both '-' from lower(regexp_replace(v_tag_name, '[^a-zA-Z0-9]+', '-', 'g')));

    IF v_slug IS NULL OR v_slug = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.tags (name, slug, tenant_id, is_active, deleted_at)
    VALUES (v_tag_name, v_slug, p_tenant_id, true, null)
    ON CONFLICT (tenant_id, slug) DO UPDATE
      SET name = EXCLUDED.name,
          is_active = true,
          deleted_at = null,
          updated_at = now()
    RETURNING id INTO v_tag_id;

    IF v_resource_type IN ('blogs', 'articles') THEN
      INSERT INTO public.blog_tags (blog_id, tag_id, tenant_id)
      VALUES (p_resource_id, v_tag_id, p_tenant_id)
      ON CONFLICT (blog_id, tag_id) DO NOTHING;
    ELSE
      INSERT INTO public.page_tags (page_id, tag_id, tenant_id)
      VALUES (p_resource_id, v_tag_id, p_tenant_id)
      ON CONFLICT (page_id, tag_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;
