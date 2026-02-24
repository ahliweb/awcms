-- Final Cleanup for Page Tags and Role Permissions

-- page_tags: _tenant and read_all are redundant with _hierarchy
DO $$
BEGIN
  IF to_regclass('public.page_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS page_tags_delete_tenant ON public.page_tags;
    DROP POLICY IF EXISTS page_tags_insert_tenant ON public.page_tags;
    DROP POLICY IF EXISTS page_tags_update_tenant ON public.page_tags;
    DROP POLICY IF EXISTS page_tags_read_all ON public.page_tags;
  END IF;
END $$;

-- role_permissions: update_policy is redundant with update_hierarchy
-- Note: insert_policy is RETAINED because there is no insert_hierarchy policy.
DROP POLICY IF EXISTS role_permissions_update_policy ON public.role_permissions;
