-- Migration: ERP RBAC Upgrade
-- Description: Adds Audit Logs, ABAC Policies, and Workflow State columns

-- 1. ERP Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    tenant_id UUID REFERENCES public.tenants(id),
    user_id UUID REFERENCES public.users(id),
    action TEXT NOT NULL, -- e.g., 'user.create', 'post.publish'
    resource TEXT NOT NULL, -- e.g., 'users', 'posts'
    resource_id TEXT,
    old_value JSONB,
    new_value JSONB,
    channel TEXT DEFAULT 'web', -- web, mobile, api
    ip_address TEXT,
    user_agent TEXT
);

-- RLS for Audit Logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists to avoid conflicts
DROP POLICY IF EXISTS "audit_view_policy" ON public.audit_logs;

CREATE POLICY "audit_view_policy" ON public.audit_logs FOR SELECT
USING (
    -- Tenant Admins view their own logs
    (tenant_id = current_tenant_id() AND EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE name IN ('admin', 'super_admin')
      )
    ))
    -- Platform Admins view ALL
    OR is_platform_admin()
);

CREATE POLICY "audit_insert_policy" ON public.audit_logs FOR INSERT
WITH CHECK (
    -- Users can only log their own actions for their tenant
    (tenant_id = current_tenant_id() AND auth.uid() = user_id)
    OR is_platform_admin()
);

-- 2. ABAC Policies System
CREATE TABLE IF NOT EXISTS public.policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    definition JSONB NOT NULL, -- { "effect": "allow", "actions": ["delete"], "conditions": { ... } }
    tenant_id UUID REFERENCES public.tenants(id), -- Null for global policies
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for policies
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policies_read_policy" ON public.policies FOR SELECT
USING (
    (tenant_id = current_tenant_id()) OR 
    (tenant_id IS NULL) OR 
    is_platform_admin()
);

CREATE TABLE IF NOT EXISTS public.role_policies (
    role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
    policy_id UUID REFERENCES public.policies(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, policy_id)
);

-- 3. Workflow State Columns
-- Articles (was posts)
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS workflow_state TEXT DEFAULT 'draft'; -- draft, reviewed, approved, published
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS current_assignee_id UUID REFERENCES public.users(id);

-- Pages
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS workflow_state TEXT DEFAULT 'draft';
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS current_assignee_id UUID REFERENCES public.users(id);

-- 4. Initial Seed for Workflow States (Optional but good for consistency)
UPDATE public.articles SET workflow_state = 'published' WHERE status = 'published' AND workflow_state = 'draft';
UPDATE public.pages SET workflow_state = 'published' WHERE status = 'published' AND workflow_state = 'draft';

-- 5. Insert new Permissions
INSERT INTO public.permissions (name, description, module, resource, action) VALUES
('view_system_audit_logs', 'View system audit trails', 'system', 'system', 'view')
ON CONFLICT (name) DO UPDATE SET
    module = EXCLUDED.module,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action;

-- 6. Grant to Admins
DO $$
DECLARE
  v_role_id UUID;
  v_perm_id UUID;
BEGIN
  -- Super Admin
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'super_admin';
  SELECT id INTO v_perm_id FROM public.permissions WHERE name = 'view_system_audit_logs';
  IF v_role_id IS NOT NULL AND v_perm_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_role_id, v_perm_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Admin
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'admin';
  IF v_role_id IS NOT NULL AND v_perm_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_role_id, v_perm_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 7. Insert Menu Item
INSERT INTO public.admin_menus (key, label, path, icon, permission, group_label, group_order, "order", is_visible) VALUES
('audit_logs_erp', 'Audit Logs (ERP)', 'audit-logs', 'FileClock', 'view_system_audit_logs', 'SYSTEM', 100, 9, true)
ON CONFLICT (key) DO UPDATE SET path = 'audit-logs', permission = 'view_system_audit_logs', is_visible = true;

