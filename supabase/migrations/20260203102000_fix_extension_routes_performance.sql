-- Fix Multiple Permissive Policies on extension_routes_registry
-- Currently has overlapping "select" and "select_hierarchy" policies.
-- "select" is effectively a superset (Global visibility for active items).
-- We consolidate to a single policy preserving the current effective behavior (Global visibility for active items),
-- while optimizing function calls.

DROP POLICY IF EXISTS "extension_routes_registry_select" ON public.extension_routes_registry;
DROP POLICY IF EXISTS "extension_routes_registry_select_hierarchy" ON public.extension_routes_registry;

CREATE POLICY "Unified select extension routes"
ON public.extension_routes_registry
FOR SELECT
TO public
USING (
  deleted_at IS NULL AND (
    (select is_platform_admin()) OR 
    is_active = true OR 
    (select has_permission('platform.extensions.read'))
  )
);
