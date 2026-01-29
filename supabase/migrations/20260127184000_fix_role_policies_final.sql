SET client_min_messages TO warning;

-- Fix Role Policies and Permissions Duplicates
-- Advisor flagged `role_policies` as having duplicate policies.
-- `role_permissions` also has `_hierarchy` policies, so older `_admin`/`_policy` ones should be dropped.

-- Role Policies
DROP POLICY IF EXISTS role_policies_select_unified ON public.role_policies;
DROP POLICY IF EXISTS role_policies_insert_unified ON public.role_policies;
DROP POLICY IF EXISTS role_policies_update_unified ON public.role_policies;
DROP POLICY IF EXISTS role_policies_delete_unified ON public.role_policies;

-- Role Permissions
DROP POLICY IF EXISTS role_permissions_select_policy ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_select_unified ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_insert_admin ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_update_admin ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_delete_admin ON public.role_permissions;

-- Roles (Re-apply just in case)
DROP POLICY IF EXISTS roles_select_unified ON public.roles;
