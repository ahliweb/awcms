-- Fix published_blogs_view to use security_invoker (Advisor: Security Definer View)
ALTER VIEW public.published_blogs_view SET (security_invoker = true);

-- Fix sync_resource_tags to have explicit search_path (Advisor: Function Search Path Mutable)
CREATE OR REPLACE FUNCTION public.sync_resource_tags(p_resource_id uuid, p_resource_type text, p_tags text[], p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_id UUID;
  v_tag_name TEXT;
BEGIN
  -- Delete existing tags for the resource
  DELETE FROM public.resource_tags 
  WHERE resource_id = p_resource_id 
    AND resource_type = p_resource_type;

  -- Insert new tags
  IF p_tags IS NOT NULL THEN
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
      -- Check if tag already exists in the tenant, otherwise insert
      INSERT INTO public.tags (name, slug, tenant_id)
      VALUES (v_tag_name, slugify(v_tag_name), p_tenant_id)
      ON CONFLICT (tenant_id, slug) DO UPDATE SET name = v_tag_name -- Update name just in case casing changed
      RETURNING id INTO v_tag_id;

      -- Link tag to resource
      INSERT INTO public.resource_tags (resource_id, resource_type, tag_id)
      VALUES (p_resource_id, p_resource_type, v_tag_id);
    END LOOP;
  END IF;
END;
$function$;
