-- Migration: Add tenant.files.permanent_delete permission and RPC
-- Date: 2026-03-25
-- Adds:
--   1. Permission key tenant.files.permanent_delete (missing from canonical ABAC seed)
--   2. Assign it to the tenant admin role (alongside other files.* permissions)
--   3. permanent_delete_media_object(p_media_id uuid) RPC – hard-deletes the DB row
--      after confirming the caller has the permission. Storage deletion is handled
--      by the Cloudflare Edge Worker route BEFORE calling this RPC.

-- ============================================================
-- 1. Insert permission key (idempotent)
-- ============================================================

INSERT INTO public.permissions (name, resource, action, description)
VALUES (
  'tenant.files.permanent_delete',
  'files',
  'permanent_delete',
  'Permanently delete media files from storage and database'
)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 2. Grant to tenant admin role (idempotent)
--    We look up the admin role by name per tenant so the grant
--    covers all tenant admin roles in the system.
-- ============================================================

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name = 'tenant.files.permanent_delete'
WHERE r.name IN ('admin', 'Admin', 'Tenant Admin', 'Administrator')
  AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Create permanent_delete_media_object RPC
--    Security: SECURITY DEFINER – bypasses RLS to perform a real
--    DELETE, but enforces the permission check in PL/pgSQL.
--    The Edge Worker has already deleted the file from R2 before
--    calling this; the RPC only removes the database row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.permanent_delete_media_object(
  p_media_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
  v_deleted_at timestamptz;
BEGIN
  -- 1. Confirm caller has the permanent_delete permission
  IF NOT (
    public.has_permission('tenant.files.permanent_delete')
    OR public.auth_is_admin()
  ) THEN
    RAISE EXCEPTION 'Permission denied: tenant.files.permanent_delete required'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Look up the row (must be soft-deleted first; we do not hard-delete live files)
  SELECT tenant_id, deleted_at
    INTO v_tenant_id, v_deleted_at
    FROM public.media_objects
   WHERE id = p_media_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Media object not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_deleted_at IS NULL THEN
    RAISE EXCEPTION 'File must be moved to trash before it can be permanently deleted'
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Hard-delete the row
  DELETE FROM public.media_objects WHERE id = p_media_id;
END;
$$;

-- Grant EXECUTE to authenticated role so Supabase JS client RPC calls work
GRANT EXECUTE ON FUNCTION public.permanent_delete_media_object(uuid) TO authenticated;
