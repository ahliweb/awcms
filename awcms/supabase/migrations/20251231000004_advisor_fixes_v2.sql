-- Migration: Supabase Advisor Fixes Round 2
-- Date: 2025-12-31
-- Description: Enables RLS on join tables, hardens utility functions, and indexes remaining Foreign Keys.

-- 1. Security: Enable RLS on role_policies
ALTER TABLE public.role_policies ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read role_policies (needed for ABAC context loading)
CREATE POLICY "Authenticated can read role_policies" ON public.role_policies
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Only Admins can manage role_policies
CREATE POLICY "Admins can manage role_policies" ON public.role_policies
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u
            JOIN public.roles r ON u.role_id = r.id
            WHERE u.id = auth.uid()
            AND r.name IN ('owner', 'super_admin', 'admin')
        )
    );

-- 2. Security: Harden update_updated_at_column
-- This is a generic trigger function used by many tables.
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;

-- 3. Performance: Index Foreign Keys
-- policies table
CREATE INDEX IF NOT EXISTS idx_policies_tenant_id ON public.policies(tenant_id);

-- role_policies table (role_id is covered by PK)
CREATE INDEX IF NOT EXISTS idx_role_policies_policy_id ON public.role_policies(policy_id);

-- 4. Performance: template_parts and widgets (from Screenshot 4 items, confirming coverage)
-- template_parts.tenant_id was missing in schema definition (checked previously), added in seed but maybe missed index?
-- In 20251230000001_overhaul_templates_schema.sql, idx_template_parts_tenant WAS created.
-- Let's ensure it exists just in case.
CREATE INDEX IF NOT EXISTS idx_template_parts_tenant ON public.template_parts(tenant_id);
