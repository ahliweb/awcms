-- Fix Final Roles Conflict
-- Advisor flagged roles_select_unified as redundant with roles_select_hierarchy.
-- Previous migration missed this specific policy name.

DROP POLICY IF EXISTS roles_select_unified ON public.roles;
