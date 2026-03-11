SET client_min_messages TO warning;

CREATE OR REPLACE FUNCTION public.sync_modules_from_sidebar(p_tenant_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
    v_target_tenant_id uuid;
    v_rows_synced integer := 0;
BEGIN
    v_target_tenant_id := COALESCE(p_tenant_id, public.current_tenant_id());

    IF v_target_tenant_id IS NULL THEN
        RETURN 0;
    END IF;

    CREATE TEMP TABLE tmp_sidebar_modules (
        tenant_id uuid NOT NULL,
        name text NOT NULL,
        slug text NOT NULL,
        description text,
        status text NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_sidebar_modules (tenant_id, name, slug, description, status)
    SELECT
        v_target_tenant_id,
        item.label,
        item.slug,
        item.description,
        item.status
    FROM (
        WITH canonical_menus AS (
            SELECT DISTINCT ON (COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')))
                am.key,
                am.label,
                am.path,
                am.is_visible,
                am.tenant_id
            FROM public.admin_menus am
            WHERE COALESCE(am.key, '') <> ''
              AND COALESCE(am.key, '') NOT LIKE 'group_placeholder_%'
              AND (am.tenant_id = v_target_tenant_id OR am.tenant_id IS NULL)
            ORDER BY COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')), CASE WHEN am.tenant_id = v_target_tenant_id THEN 0 ELSE 1 END, am.updated_at DESC NULLS LAST, am.created_at DESC NULLS LAST
        ),
        resource_fallbacks AS (
            SELECT
                rr.key,
                rr.label,
                rr.active
            FROM public.resources_registry rr
            WHERE rr.active = true
              AND NOT EXISTS (
                SELECT 1
                FROM canonical_menus cm
                WHERE cm.key = rr.key
              )
        ),
        extension_menus AS (
            SELECT DISTINCT ON (em.slug)
                em.label,
                em.slug,
                em.description,
                em.status
            FROM (
                SELECT
                    COALESCE(emi.label, ext.name, ext.slug) AS label,
                    CONCAT(
                        'ext-',
                        COALESCE(ext.slug, 'extension'),
                        '-',
                        trim(both '-' from regexp_replace(lower(COALESCE(NULLIF(regexp_replace(COALESCE(emi.path, ''), '^/?admin/?', ''), ''), emi.label, 'menu')), '[^a-z0-9]+', '-', 'g'))
                    ) AS slug,
                    CASE
                        WHEN ext.name IS NOT NULL THEN 'Extension: ' || ext.name
                        ELSE NULL
                    END AS description,
                    CASE
                        WHEN emi.is_active = false OR ext.is_active = false THEN 'inactive'
                        ELSE 'active'
                    END AS status
                FROM public.extension_menu_items emi
                JOIN public.extensions ext ON ext.id = emi.extension_id
                WHERE emi.deleted_at IS NULL
                  AND ext.deleted_at IS NULL
                  AND ext.tenant_id = v_target_tenant_id
                  AND ext.is_active = true
            ) em
            WHERE em.slug IS NOT NULL
              AND em.slug <> 'ext-extension-'
        )
        SELECT
            COALESCE(cm.label, cm.key) AS label,
            cm.key AS slug,
            NULL::text AS description,
            CASE WHEN cm.is_visible = false THEN 'inactive' ELSE 'active' END AS status
        FROM canonical_menus cm

        UNION ALL

        SELECT
            COALESCE(rf.label, rf.key) AS label,
            rf.key AS slug,
            'Available from resources registry'::text AS description,
            CASE WHEN rf.active = false THEN 'inactive' ELSE 'active' END AS status
        FROM resource_fallbacks rf

        UNION ALL

        SELECT
            em.label,
            em.slug,
            em.description,
            em.status
        FROM extension_menus em
    ) item
    WHERE item.slug IS NOT NULL
      AND item.slug <> '';

    INSERT INTO public.modules (tenant_id, name, slug, description, status, updated_at)
    SELECT
        tenant_id,
        name,
        slug,
        description,
        status,
        NOW()
    FROM tmp_sidebar_modules
    ON CONFLICT (tenant_id, slug)
    DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        updated_at = NOW();

    GET DIAGNOSTICS v_rows_synced = ROW_COUNT;

    UPDATE public.modules m
    SET status = 'inactive',
        updated_at = NOW()
    WHERE m.tenant_id = v_target_tenant_id
      AND NOT EXISTS (
        SELECT 1
        FROM tmp_sidebar_modules tsm
        WHERE tsm.tenant_id = m.tenant_id
          AND tsm.slug = m.slug
      );

    RETURN v_rows_synced;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_modules_from_sidebar(uuid) TO authenticated;
