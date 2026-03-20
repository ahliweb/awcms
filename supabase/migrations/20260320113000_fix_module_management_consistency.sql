SET client_min_messages TO warning;

-- Fix module management consistency and persistence.
-- 1) Add explicit UPDATE policy so module toggles can persist for platform admins.
-- 2) Rebuild sync_modules_from_sidebar() so every tenant gets the same canonical
--    module set derived from global admin menus + active resources + extension
--    menu slugs across all tenants, while preserving each tenant's current status.

DROP POLICY IF EXISTS modules_update_policy ON public.modules;
CREATE POLICY modules_update_policy ON public.modules
    FOR UPDATE
    TO authenticated
    USING (
        public.is_platform_admin()
        OR public.has_permission('platform.module.manage')
    )
    WITH CHECK (
        public.is_platform_admin()
        OR public.has_permission('platform.module.manage')
    );

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

    DROP TABLE IF EXISTS tmp_sidebar_modules;

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
        item.name,
        item.slug,
        item.description,
        COALESCE(existing.status, 'active') AS status
    FROM (
        WITH canonical_menus AS (
            SELECT DISTINCT ON (COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')))
                COALESCE(am.label, am.key) AS name,
                COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')) AS slug,
                NULL::text AS description
            FROM public.admin_menus am
            WHERE COALESCE(am.key, '') <> ''
              AND COALESCE(am.key, '') NOT LIKE 'group_placeholder_%'
              AND am.tenant_id IS NULL
              AND COALESCE(am.permission, '') <> 'platform.module.read'
            ORDER BY COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')), am.updated_at DESC NULLS LAST, am.created_at DESC NULLS LAST
        ),
        resource_fallbacks AS (
            SELECT
                COALESCE(rr.label, rr.key) AS name,
                rr.key AS slug,
                'Available from resources registry'::text AS description
            FROM public.resources_registry rr
            WHERE rr.active = true
              AND NOT EXISTS (
                SELECT 1
                FROM canonical_menus cm
                WHERE cm.slug = rr.key
              )
        ),
        extension_menus AS (
            SELECT DISTINCT ON (em.slug)
                em.name,
                em.slug,
                em.description
            FROM (
                SELECT
                    COALESCE(emi.label, ext.name, ext.slug) AS name,
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
                    emi.updated_at,
                    emi.created_at
                FROM public.extension_menu_items emi
                JOIN public.extensions ext ON ext.id = emi.extension_id
                WHERE emi.deleted_at IS NULL
                  AND ext.deleted_at IS NULL
                  AND ext.is_active = true
            ) em
            WHERE em.slug IS NOT NULL
              AND em.slug <> 'ext-extension-'
            ORDER BY em.slug, em.updated_at DESC NULLS LAST, em.created_at DESC NULLS LAST
        )
        SELECT name, slug, description FROM canonical_menus
        UNION
        SELECT name, slug, description FROM resource_fallbacks
        UNION
        SELECT name, slug, description FROM extension_menus
    ) item
    LEFT JOIN public.modules existing
      ON existing.tenant_id = v_target_tenant_id
     AND existing.slug = item.slug
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
        status = COALESCE(public.modules.status, EXCLUDED.status),
        updated_at = NOW();

    GET DIAGNOSTICS v_rows_synced = ROW_COUNT;

    UPDATE public.modules m
    SET status = CASE WHEN m.status = 'maintenance' THEN 'maintenance' ELSE 'inactive' END,
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
