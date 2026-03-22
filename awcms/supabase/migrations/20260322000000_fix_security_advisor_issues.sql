-- Migration: Fix Security Advisor issues
-- Date: 2026-03-22
-- Issues resolved:
--   1. check_tenant_limit   — references public.files (dropped); rewrite to use media_objects
--   2. get_storage_stats    — references public.files (dropped); rewrite to use media_objects
--   3. sync_storage_files   — inserts into public.files (dropped); obsolete since R2 migration;
--                             replace with a no-op stub that returns a clear deprecation message
--   4. sync_modules_from_sidebar — uses TEMP TABLE which the linter cannot resolve statically;
--                             rewrite to use a CTE-based INSERT to eliminate temp table
--   5. can_manage_cell      — unused parameter p_cell_id; remove it

-- ============================================================
-- 1. Fix check_tenant_limit: use media_objects.size_bytes instead of files.file_size
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_tenant_limit(
    check_tenant_id uuid,
    feature_key text,
    proposed_usage bigint DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

    -- Users Limit (count)
    IF feature_key = 'max_users' THEN
        IF tier = 'enterprise' THEN max_limit := -1;
        ELSIF tier = 'pro' THEN max_limit := 50;
        ELSE max_limit := 5;
        END IF;

        SELECT count(*) INTO current_usage
        FROM public.users
        WHERE tenant_id = check_tenant_id
          AND deleted_at IS NULL;

    -- Storage Limit (bytes) — media_objects replaced public.files
    ELSIF feature_key = 'max_storage' THEN
        IF tier = 'enterprise' THEN max_limit := -1;
        ELSIF tier = 'pro' THEN max_limit := 10737418240; -- 10 GB
        ELSE max_limit := 104857600; -- 100 MB
        END IF;

        SELECT COALESCE(SUM(size_bytes), 0) INTO current_usage
        FROM public.media_objects
        WHERE tenant_id = check_tenant_id
          AND deleted_at IS NULL;
    END IF;

    IF max_limit = -1 THEN
        RETURN TRUE;
    END IF;

    IF (current_usage + proposed_usage) > max_limit THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

-- ============================================================
-- 2. Fix get_storage_stats: use media_objects instead of files
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_storage_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    total_files  bigint;
    total_size   bigint;
    image_count  bigint;
    video_count  bigint;
    doc_count    bigint;
BEGIN
    SELECT count(*), COALESCE(sum(size_bytes), 0)
    INTO total_files, total_size
    FROM public.media_objects
    WHERE deleted_at IS NULL;

    SELECT count(*) INTO image_count
    FROM public.media_objects
    WHERE mime_type ILIKE 'image/%' AND deleted_at IS NULL;

    SELECT count(*) INTO video_count
    FROM public.media_objects
    WHERE mime_type ILIKE 'video/%' AND deleted_at IS NULL;

    SELECT count(*) INTO doc_count
    FROM public.media_objects
    WHERE mime_type NOT ILIKE 'image/%'
      AND mime_type NOT ILIKE 'video/%'
      AND deleted_at IS NULL;

    RETURN jsonb_build_object(
        'total_files', total_files,
        'total_size',  total_size,
        'image_count', image_count,
        'video_count', video_count,
        'doc_count',   doc_count
    );
END;
$$;

-- ============================================================
-- 3. Replace sync_storage_files with a no-op deprecation stub
--    The public.files table was removed in migration 20260308150000.
--    Media is now stored in Cloudflare R2 and tracked in media_objects.
--    This function is no longer applicable; retain the signature so
--    callers receive a clear message instead of a hard error.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_storage_files()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    RETURN jsonb_build_object(
        'success',  false,
        'deprecated', true,
        'reason',
        'sync_storage_files is deprecated. Media is now stored in Cloudflare R2 and tracked in public.media_objects.'
    );
END;
$$;

-- ============================================================
-- 4. Fix sync_modules_from_sidebar: replace TEMP TABLE with CTE-based INSERT
--    The static linter cannot resolve relations created with CREATE TEMP TABLE
--    inside a PL/pgSQL body. Rewriting to use a CTE avoids the false-positive
--    "relation does not exist" error while preserving identical runtime behavior.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_modules_from_sidebar(p_tenant_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
    v_target_tenant_id uuid;
    v_rows_synced      integer := 0;
BEGIN
    v_target_tenant_id := COALESCE(p_tenant_id, public.current_tenant_id());

    IF v_target_tenant_id IS NULL THEN
        RETURN 0;
    END IF;

    -- Insert/upsert canonical module set using a CTE instead of a TEMP TABLE.
    -- The CTE builds the same sidebar-derived module list that was previously
    -- staged into tmp_sidebar_modules.
    INSERT INTO public.modules (tenant_id, name, slug, description, status, updated_at)
    WITH canonical_menus AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')))
            COALESCE(am.label, am.key)                               AS name,
            COALESCE(NULLIF(am.key, ''), NULLIF(am.path, ''))        AS slug,
            NULL::text                                               AS description
        FROM public.admin_menus am
        WHERE COALESCE(am.key, '') <> ''
          AND COALESCE(am.key, '') NOT LIKE 'group_placeholder_%'
          AND am.tenant_id IS NULL
          AND COALESCE(am.permission, '') <> 'platform.module.read'
        ORDER BY
            COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')),
            am.updated_at DESC NULLS LAST,
            am.created_at DESC NULLS LAST
    ),
    resource_fallbacks AS (
        SELECT
            COALESCE(rr.label, rr.key)                               AS name,
            rr.key                                                   AS slug,
            'Available from resources registry'::text                AS description
        FROM public.resources_registry rr
        WHERE rr.active = true
          AND NOT EXISTS (
              SELECT 1 FROM canonical_menus cm WHERE cm.slug = rr.key
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
                    trim(both '-' from regexp_replace(
                        lower(COALESCE(
                            NULLIF(regexp_replace(COALESCE(emi.path, ''), '^/?admin/?', ''), ''),
                            emi.label,
                            'menu'
                        )),
                        '[^a-z0-9]+', '-', 'g'
                    ))
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
    ),
    sidebar_modules AS (
        SELECT name, slug, description FROM canonical_menus
        UNION
        SELECT name, slug, description FROM resource_fallbacks
        UNION
        SELECT name, slug, description FROM extension_menus
    )
    SELECT
        v_target_tenant_id,
        item.name,
        item.slug,
        item.description,
        COALESCE(existing.status, 'active') AS status,
        NOW()
    FROM sidebar_modules item
    LEFT JOIN public.modules existing
        ON existing.tenant_id = v_target_tenant_id
       AND existing.slug      = item.slug
    WHERE item.slug IS NOT NULL
      AND item.slug <> ''
    ON CONFLICT (tenant_id, slug)
    DO UPDATE SET
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        status      = COALESCE(public.modules.status, EXCLUDED.status),
        updated_at  = NOW();

    GET DIAGNOSTICS v_rows_synced = ROW_COUNT;

    -- Mark modules that are no longer in the sidebar as inactive/maintenance
    UPDATE public.modules m
    SET status     = CASE WHEN m.status = 'maintenance' THEN 'maintenance' ELSE 'inactive' END,
        updated_at = NOW()
    WHERE m.tenant_id = v_target_tenant_id
      AND NOT EXISTS (
          WITH canonical_menus AS (
              SELECT DISTINCT ON (COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')))
                  COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')) AS slug
              FROM public.admin_menus am
              WHERE COALESCE(am.key, '') <> ''
                AND COALESCE(am.key, '') NOT LIKE 'group_placeholder_%'
                AND am.tenant_id IS NULL
                AND COALESCE(am.permission, '') <> 'platform.module.read'
              ORDER BY COALESCE(NULLIF(am.key, ''), NULLIF(am.path, '')), am.updated_at DESC NULLS LAST
          ),
          resource_fallbacks AS (
              SELECT rr.key AS slug
              FROM public.resources_registry rr
              WHERE rr.active = true
                AND NOT EXISTS (SELECT 1 FROM canonical_menus c WHERE c.slug = rr.key)
          ),
          extension_menus AS (
              SELECT DISTINCT ON (em.slug) em.slug
              FROM (
                  SELECT
                      CONCAT(
                          'ext-',
                          COALESCE(ext.slug, 'extension'),
                          '-',
                          trim(both '-' from regexp_replace(
                              lower(COALESCE(
                                  NULLIF(regexp_replace(COALESCE(emi.path, ''), '^/?admin/?', ''), ''),
                                  emi.label,
                                  'menu'
                              )),
                              '[^a-z0-9]+', '-', 'g'
                          ))
                      ) AS slug,
                      emi.updated_at,
                      emi.created_at
                  FROM public.extension_menu_items emi
                  JOIN public.extensions ext ON ext.id = emi.extension_id
                  WHERE emi.deleted_at IS NULL
                    AND ext.deleted_at IS NULL
                    AND ext.is_active = true
              ) em
              WHERE em.slug IS NOT NULL AND em.slug <> 'ext-extension-'
              ORDER BY em.slug, em.updated_at DESC NULLS LAST
          ),
          all_slugs AS (
              SELECT slug FROM canonical_menus
              UNION SELECT slug FROM resource_fallbacks
              UNION SELECT slug FROM extension_menus
          )
          SELECT 1 FROM all_slugs s WHERE s.slug = m.slug
      );

    RETURN v_rows_synced;
END;
$$;

-- ============================================================
-- 5. Fix can_manage_cell: remove unused p_cell_id parameter
--    The parameter is declared but the body only calls auth_is_platform_admin().
--    Replace with a parameterless version. The old signature is dropped first
--    to avoid an overload conflict.
-- ============================================================

DROP FUNCTION IF EXISTS public.can_manage_cell(uuid);

CREATE OR REPLACE FUNCTION public.can_manage_cell()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
    -- Only platform admins may manage deployment cells.
    RETURN public.auth_is_platform_admin();
END;
$$;
