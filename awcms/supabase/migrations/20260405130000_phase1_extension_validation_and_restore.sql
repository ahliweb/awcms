SET client_min_messages TO warning;

ALTER TABLE public.platform_extension_catalog
  ADD COLUMN IF NOT EXISTS runtime_mode text NOT NULL DEFAULT 'trusted',
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_invalidated_at timestamptz;

ALTER TABLE public.tenant_extensions
  ADD COLUMN IF NOT EXISTS desired_activation_state text NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_restored_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivation_reason_category text,
  ADD COLUMN IF NOT EXISTS invalidated_by_catalog_version text,
  ADD COLUMN IF NOT EXISTS restored_by_catalog_version text;

UPDATE public.tenant_extensions
SET desired_activation_state = CASE WHEN activation_state = 'active' THEN 'active' ELSE 'inactive' END
WHERE desired_activation_state IS DISTINCT FROM CASE WHEN activation_state = 'active' THEN 'active' ELSE 'inactive' END
  AND deleted_at IS NULL;

ALTER TABLE public.platform_extension_catalog DROP CONSTRAINT IF EXISTS platform_extension_catalog_runtime_mode_check;
ALTER TABLE public.platform_extension_catalog
  ADD CONSTRAINT platform_extension_catalog_runtime_mode_check CHECK (runtime_mode IN ('trusted'));

ALTER TABLE public.platform_extension_catalog DROP CONSTRAINT IF EXISTS platform_extension_catalog_validation_status_check;
ALTER TABLE public.platform_extension_catalog
  ADD CONSTRAINT platform_extension_catalog_validation_status_check CHECK (validation_status IN ('valid', 'invalid', 'warning'));

ALTER TABLE public.tenant_extensions DROP CONSTRAINT IF EXISTS tenant_extensions_desired_activation_state_check;
ALTER TABLE public.tenant_extensions
  ADD CONSTRAINT tenant_extensions_desired_activation_state_check CHECK (desired_activation_state IN ('installed', 'active', 'inactive', 'error', 'upgrade_required', 'uninstall_requested'));

ALTER TABLE public.tenant_extensions DROP CONSTRAINT IF EXISTS tenant_extensions_validation_status_check;
ALTER TABLE public.tenant_extensions
  ADD CONSTRAINT tenant_extensions_validation_status_check CHECK (validation_status IN ('valid', 'invalid', 'warning'));

ALTER TABLE public.tenant_extensions DROP CONSTRAINT IF EXISTS tenant_extensions_deactivation_reason_category_check;
ALTER TABLE public.tenant_extensions
  ADD CONSTRAINT tenant_extensions_deactivation_reason_category_check CHECK (
    deactivation_reason_category IS NULL OR deactivation_reason_category IN (
      'invalid_manifest',
      'unsupported_runtime_mode',
      'capability_validation_failed',
      'missing_artifact',
      'compatibility_failed'
    )
  );

CREATE INDEX IF NOT EXISTS platform_extension_catalog_validation_idx
  ON public.platform_extension_catalog (validation_status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_extensions_validation_idx
  ON public.tenant_extensions (validation_status, activation_state, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_extensions_deactivation_reason_idx
  ON public.tenant_extensions (deactivation_reason_category, updated_at DESC)
  WHERE deleted_at IS NULL;

DROP POLICY IF EXISTS "platform_extension_catalog_select" ON public.platform_extension_catalog;
CREATE POLICY "platform_extension_catalog_select"
ON public.platform_extension_catalog
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (SELECT public.auth_is_admin())
    OR (SELECT public.has_permission('platform.extensions.read'))
    OR (SELECT public.has_permission('platform.extensions.diagnostics.read'))
    OR (SELECT public.has_permission('tenant.setting.read'))
  )
);

DROP POLICY IF EXISTS "extension_lifecycle_audit_select" ON public.extension_lifecycle_audit;
CREATE POLICY "extension_lifecycle_audit_select"
ON public.extension_lifecycle_audit
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (tenant_id = (SELECT public.current_tenant_id()) AND ((SELECT public.has_permission('tenant.audit.read')) OR (SELECT public.has_permission('tenant.setting.read'))))
    OR (SELECT public.auth_is_admin())
    OR (SELECT public.has_permission('platform.extensions.read'))
    OR (SELECT public.has_permission('platform.extensions.diagnostics.read'))
  )
);

WITH permissions_seed(name, resource, action, description) AS (
  VALUES
    ('platform.extensions.diagnostics.read', 'extensions', 'diagnostics.read', 'View extension validation diagnostics, reason categories, and restoration status')
)
INSERT INTO public.permissions (name, resource, action, description, deleted_at)
SELECT name, resource, action, description, NULL
FROM permissions_seed
ON CONFLICT (name) DO UPDATE SET
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  deleted_at = NULL;

CREATE OR REPLACE FUNCTION public.sync_extension_catalog_validation_state(
  p_slug text,
  p_vendor text,
  p_name text,
  p_description text,
  p_version text,
  p_kind text,
  p_scope text,
  p_source text,
  p_package_path text,
  p_checksum text,
  p_status text,
  p_compatibility jsonb,
  p_capabilities jsonb,
  p_manifest jsonb,
  p_runtime_mode text,
  p_validation_status text,
  p_validation_summary jsonb,
  p_actor_user_id uuid
)
RETURNS TABLE (
  catalog_id uuid,
  previous_version text,
  auto_deactivated_count integer,
  auto_restored_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_catalog_id uuid;
  v_previous_version text;
  v_now timestamptz := now();
  v_reason text := NULLIF(COALESCE(p_validation_summary->>'primaryReasonCategory', p_validation_summary->'reasonCategories'->>0), '');
BEGIN
  SELECT id, version INTO v_catalog_id, v_previous_version
  FROM public.platform_extension_catalog
  WHERE vendor = p_vendor
    AND slug = p_slug
  LIMIT 1;

  INSERT INTO public.platform_extension_catalog (
    slug,
    vendor,
    name,
    description,
    version,
    kind,
    scope,
    source,
    package_path,
    checksum,
    status,
    compatibility,
    capabilities,
    manifest,
    runtime_mode,
    validation_status,
    validation_summary,
    last_validated_at,
    last_invalidated_at,
    created_by,
    updated_at,
    deleted_at
  ) VALUES (
    p_slug,
    p_vendor,
    p_name,
    p_description,
    p_version,
    p_kind,
    p_scope,
    p_source,
    p_package_path,
    p_checksum,
    p_status,
    COALESCE(p_compatibility, '{}'::jsonb),
    COALESCE(p_capabilities, '[]'::jsonb),
    COALESCE(p_manifest, '{}'::jsonb),
    p_runtime_mode,
    p_validation_status,
    COALESCE(p_validation_summary, '{}'::jsonb),
    v_now,
    CASE WHEN p_validation_status = 'invalid' THEN v_now ELSE NULL END,
    p_actor_user_id,
    v_now,
    NULL
  )
  ON CONFLICT (vendor, slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    version = EXCLUDED.version,
    kind = EXCLUDED.kind,
    scope = EXCLUDED.scope,
    source = EXCLUDED.source,
    package_path = EXCLUDED.package_path,
    checksum = EXCLUDED.checksum,
    status = EXCLUDED.status,
    compatibility = EXCLUDED.compatibility,
    capabilities = EXCLUDED.capabilities,
    manifest = EXCLUDED.manifest,
    runtime_mode = EXCLUDED.runtime_mode,
    validation_status = EXCLUDED.validation_status,
    validation_summary = EXCLUDED.validation_summary,
    last_validated_at = EXCLUDED.last_validated_at,
    last_invalidated_at = CASE WHEN EXCLUDED.validation_status = 'invalid' THEN v_now ELSE public.platform_extension_catalog.last_invalidated_at END,
    updated_at = v_now,
    deleted_at = NULL
  RETURNING id INTO v_catalog_id;

  auto_deactivated_count := 0;
  auto_restored_count := 0;

  UPDATE public.tenant_extensions target
  SET validation_status = p_validation_status,
      validation_summary = COALESCE(p_validation_summary, '{}'::jsonb),
      updated_by = p_actor_user_id,
      updated_at = v_now,
      deactivation_reason_category = CASE
        WHEN p_validation_status = 'invalid' THEN COALESCE(v_reason, 'invalid_manifest')
        ELSE NULL
      END
  WHERE target.catalog_id = v_catalog_id
    AND target.deleted_at IS NULL;

  IF p_validation_status = 'invalid' THEN
    WITH candidates AS (
      SELECT id, tenant_id, activation_state, installed_version
      FROM public.tenant_extensions current_extension
      WHERE current_extension.catalog_id = v_catalog_id
        AND current_extension.deleted_at IS NULL
        AND current_extension.activation_state = 'active'
    ), updated AS (
      UPDATE public.tenant_extensions target
      SET desired_activation_state = 'active',
          activation_state = 'inactive',
          deactivated_at = v_now,
          auto_deactivated_at = v_now,
          auto_restored_at = NULL,
          invalidated_by_catalog_version = p_version,
          restored_by_catalog_version = NULL,
          validation_status = p_validation_status,
          validation_summary = COALESCE(p_validation_summary, '{}'::jsonb),
          deactivation_reason_category = COALESCE(v_reason, 'invalid_manifest'),
          updated_by = p_actor_user_id,
          updated_at = v_now
      FROM candidates source
      WHERE target.id = source.id
      RETURNING target.id, target.tenant_id, source.installed_version
    ), audit_rows AS (
      INSERT INTO public.extension_lifecycle_audit (
        tenant_id,
        catalog_id,
        tenant_extension_id,
        actor_user_id,
        action,
        status,
        metadata
      )
      SELECT
        updated.tenant_id,
        v_catalog_id,
        updated.id,
        p_actor_user_id,
        'deactivate',
        'succeeded',
        jsonb_build_object(
          'automatic_restore', false,
          'validation_status', p_validation_status,
          'reason_categories', COALESCE(p_validation_summary->'reasonCategories', '[]'::jsonb),
          'runtime_mode', p_runtime_mode,
          'catalog_version', p_version,
          'previous_catalog_version', COALESCE(v_previous_version, updated.installed_version),
          'invalidated_by_catalog_version', p_version
        )
      FROM updated
      RETURNING 1
    )
    SELECT COUNT(*)::integer INTO auto_deactivated_count FROM updated;
  ELSE
    WITH restorable AS (
      SELECT id, tenant_id, installed_version, activation_state, invalidated_by_catalog_version
      FROM public.tenant_extensions current_extension
      WHERE current_extension.catalog_id = v_catalog_id
        AND current_extension.deleted_at IS NULL
        AND current_extension.desired_activation_state = 'active'
        AND current_extension.activation_state = 'inactive'
        AND current_extension.auto_deactivated_at IS NOT NULL
    ), updated AS (
      UPDATE public.tenant_extensions target
      SET activation_state = 'active',
          activated_at = v_now,
          deactivated_at = NULL,
          auto_restored_at = v_now,
          restored_by_catalog_version = p_version,
          validation_status = p_validation_status,
          validation_summary = COALESCE(p_validation_summary, '{}'::jsonb),
          deactivation_reason_category = NULL,
          updated_by = p_actor_user_id,
          updated_at = v_now
      FROM restorable source
      WHERE target.id = source.id
      RETURNING target.id, target.tenant_id, source.installed_version, source.activation_state, source.invalidated_by_catalog_version
    ), audit_rows AS (
      INSERT INTO public.extension_lifecycle_audit (
        tenant_id,
        catalog_id,
        tenant_extension_id,
        actor_user_id,
        action,
        status,
        metadata
      )
      SELECT
        updated.tenant_id,
        v_catalog_id,
        updated.id,
        p_actor_user_id,
        'activate',
        'succeeded',
        jsonb_build_object(
          'automatic_restore', true,
          'validation_status', p_validation_status,
          'reason_categories', COALESCE(p_validation_summary->'reasonCategories', '[]'::jsonb),
          'runtime_mode', p_runtime_mode,
          'catalog_version', p_version,
          'previous_catalog_version', COALESCE(v_previous_version, updated.installed_version),
          'restored_from_state', updated.activation_state,
          'invalidated_by_catalog_version', updated.invalidated_by_catalog_version,
          'restored_by_catalog_version', p_version
        )
      FROM updated
      RETURNING 1
    )
    SELECT COUNT(*)::integer INTO auto_restored_count FROM updated;
  END IF;

  catalog_id := v_catalog_id;
  previous_version := v_previous_version;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_extension_catalog_validation_state(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  jsonb,
  uuid
) TO authenticated;
