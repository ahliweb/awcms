-- Migration: Security Hardening & Audit Trails
-- Date: 2025-12-31
-- Description: Enforces RLS on admin_menus and attaches audit triggers to all critical tables.

-- 1. Security for Admin Menus
ALTER TABLE IF EXISTS public.admin_menus ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Public read access for admin_menus" ON public.admin_menus;
DROP POLICY IF EXISTS "Platform admins manage admin_menus" ON public.admin_menus;

-- Policy: Authenticated users can read menus (needed to render sidebar)
CREATE POLICY "Authenticated users view admin_menus"
ON public.admin_menus FOR SELECT
TO authenticated
USING (true);

-- Policy: Platform Admins can manage menus
CREATE POLICY "Platform admins manage admin_menus"
ON public.admin_menus FOR ALL
TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());


-- 2. Attach Audit Log Triggers to Critical Tables
-- We use the existing public.log_audit_event() function

-- Helper macro-like block for applying triggers safely
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'users', 
        'roles', 
        'permissions', 
        'role_permissions', 
        'policies', 
        'role_policies', 
        'templates', 
        'admin_menus',
        'tenants'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            
            -- Drop first to ensure idempotency
            EXECUTE format('DROP TRIGGER IF EXISTS audit_log_changes_%I ON public.%I', t, t);
            
            -- Create Trigger
            EXECUTE format('
                CREATE TRIGGER audit_log_changes_%I
                AFTER INSERT OR UPDATE OR DELETE ON public.%I
                FOR EACH ROW EXECUTE FUNCTION public.log_audit_event()
            ', t, t);
            
        END IF;
    END LOOP;
END $$;
