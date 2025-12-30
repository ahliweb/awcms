-- Migration: Supabase Advisor Fixes (Security & Performance)
-- Date: 2025-12-31
-- Description: Hardens SECURITY DEFINER functions and indexes foreign keys.

-- 1. Security: Set search_path for SECURITY DEFINER functions
-- Prevents search_path hijacking by malicious users overriding objects in 'public'.
ALTER FUNCTION public.get_tenant_by_domain(text) SET search_path = public;
ALTER FUNCTION public.check_tenant_limit(uuid, text, bigint) SET search_path = public;
ALTER FUNCTION public.is_platform_admin() SET search_path = public;
ALTER FUNCTION public.current_tenant_id() SET search_path = public;
ALTER FUNCTION public.set_tenant_id() SET search_path = public;

-- Depending on definition in 20251220000005, verifying signature match or generic alt.
-- RPC: create_tenant_with_defaults(name, slug, domain, owner_email)
ALTER FUNCTION public.create_tenant_with_defaults(text, text, text, text) SET search_path = public;

-- 2. Performance: Index Foreign Keys
-- account_requests
CREATE INDEX IF NOT EXISTS idx_account_requests_admin_approved_by ON public.account_requests(admin_approved_by);
CREATE INDEX IF NOT EXISTS idx_account_requests_super_admin_approved_by ON public.account_requests(super_admin_approved_by);

-- template_assignments
CREATE INDEX IF NOT EXISTS idx_template_assignments_tenant_id ON public.template_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_template_assignments_template_id ON public.template_assignments(template_id);

-- articles & pages (workflow)
CREATE INDEX IF NOT EXISTS idx_articles_current_assignee_id ON public.articles(current_assignee_id);
CREATE INDEX IF NOT EXISTS idx_pages_current_assignee_id ON public.pages(current_assignee_id);

-- testimonies
CREATE INDEX IF NOT EXISTS idx_testimonies_category_id ON public.testimonies(category_id);

-- users (approval workflow)
CREATE INDEX IF NOT EXISTS idx_users_admin_approved_by ON public.users(admin_approved_by);
CREATE INDEX IF NOT EXISTS idx_users_super_admin_approved_by ON public.users(super_admin_approved_by);
