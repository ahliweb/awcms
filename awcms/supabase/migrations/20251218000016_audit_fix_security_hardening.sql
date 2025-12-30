-- Migration: Security Hardening for Tags, Notifications, SSO
-- Description: Add tenant_id isolation and fix RLS policies for critical tables.

-- ==========================================
-- 1. HARDEN TAGS (Cleanup Legacy Policies)
-- ==========================================
-- Existing 'Tenant Read/Write Access' are good. Drop the loose ones.
DROP POLICY IF EXISTS "tags_select_public" ON public.tags;
DROP POLICY IF EXISTS "Allow delete tags" ON public.tags;
DROP POLICY IF EXISTS "Allow insert tags" ON public.tags;
DROP POLICY IF EXISTS "Allow update tags" ON public.tags;


-- ==========================================
-- 2. HARDEN NOTIFICATIONS (Add Tenant Isolation)
-- ==========================================
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id ON public.notifications(tenant_id);

-- Backfill tenant_id from users (best effort)
UPDATE public.notifications n
SET tenant_id = u.tenant_id
FROM public.users u
WHERE n.user_id = u.id
AND n.tenant_id IS NULL;

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Drop legacy policies
DROP POLICY IF EXISTS "notifications_select_policy" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_policy" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_policy" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_policy" ON public.notifications;

-- Create Strict Policies
-- READ: Users see their own. Tenant Admins see their Tenant's. Global Admins see ALL.
CREATE POLICY "notifications_read_policy" ON public.notifications
FOR SELECT
USING (
  (user_id = auth.uid()) OR
  (tenant_id = current_tenant_id() AND is_admin_or_above()) OR
  is_platform_admin()
);

-- WRITE (System/Insert): Usually handled by system functions, but allow admins to create announcements
CREATE POLICY "notifications_write_policy" ON public.notifications
FOR ALL
USING (
  (tenant_id = current_tenant_id() AND is_admin_or_above()) OR
  is_platform_admin()
);


-- ==========================================
-- 3. HARDEN SSO PROVIDERS (Critical Security)
-- ==========================================
ALTER TABLE public.sso_providers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
CREATE INDEX IF NOT EXISTS idx_sso_providers_tenant_id ON public.sso_providers(tenant_id);

-- Enable RLS
ALTER TABLE public.sso_providers ENABLE ROW LEVEL SECURITY;

-- Drop legacy policies
DROP POLICY IF EXISTS "sso_providers_select" ON public.sso_providers;
DROP POLICY IF EXISTS "sso_providers_modify" ON public.sso_providers;
DROP POLICY IF EXISTS "sso_providers_update" ON public.sso_providers;
DROP POLICY IF EXISTS "sso_providers_delete" ON public.sso_providers;

-- Strict Policies
-- Strict Policies
DROP POLICY IF EXISTS "sso_providers_isolation_policy" ON public.sso_providers;
CREATE POLICY "sso_providers_isolation_policy" ON public.sso_providers
FOR ALL
USING (
  (tenant_id = current_tenant_id() AND is_admin_or_above()) OR
  is_platform_admin()
);

-- Note: SSO Role Mappings should also be checked, assuming they link to providers which are now secured.
-- If sso_role_mappings references sso_providers(id), standard RLS on providers might sufficient if joins are used, 
-- but ideally mappings should also have RLS. Let's add RLS to mappings too just in case.

ALTER TABLE public.sso_role_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sso_mappings_isolation_policy" ON public.sso_role_mappings;
CREATE POLICY "sso_mappings_isolation_policy" ON public.sso_role_mappings
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.sso_providers p 
    WHERE p.id = sso_role_mappings.provider_id::uuid  -- CAST TO UUID
    AND (
      (p.tenant_id = current_tenant_id()) OR 
      is_platform_admin()
    )
  )
);
