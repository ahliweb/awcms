-- Migration: Add Policy Permissions and Menu Item
-- Description: Adds tenant.policy.* permissions and inserts the 'Policies' menu item.

-- 1. Insert Permissions
-- 1. Insert Permissions
INSERT INTO public.permissions (name, module, resource, action, description)
VALUES 
    ('tenant.policy.read', 'policies', 'policy', 'read', 'View ABAC policies'),
    ('tenant.policy.create', 'policies', 'policy', 'create', 'Create ABAC policies'),
    ('tenant.policy.update', 'policies', 'policy', 'update', 'Update ABAC policies'),
    ('tenant.policy.delete', 'policies', 'policy', 'delete', 'Delete ABAC policies')
ON CONFLICT (name) DO UPDATE SET
    module = EXCLUDED.module,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description;

-- 2. Insert Menu Item
-- Group: USERS (order 50), Item Order: 30 (after Roles)
INSERT INTO public.admin_menus (key, label, path, icon, permission, group_label, group_order, "order", is_visible)
VALUES (
    'policies', 
    'Policies (ABAC)', 
    'policies', 
    'ShieldCheck', 
    'tenant.policy.read', 
    'USERS', 
    50, 
    30, 
    true
)
ON CONFLICT (key) DO UPDATE SET 
    path = EXCLUDED.path,
    icon = EXCLUDED.icon,
    permission = EXCLUDED.permission,
    group_label = EXCLUDED.group_label,
    "order" = EXCLUDED."order";
