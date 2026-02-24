-- Unlock Platform Permissions
-- restoration of standard CRUD permissions for platform-level resources to ensure Permission Matrix checkbox availability

DO $$
DECLARE
    p_action text;
    p_resource text;
    p_module text;
    p_name text;
BEGIN
    -- 1. Platform (The system itself)
    FOREACH p_action IN ARRAY ARRAY['create', 'read', 'update', 'delete', 'delete_permanent'] LOOP
        p_resource := 'platform';
        p_module := 'platform';
        p_name := 'platform.' || p_resource || '.' || p_action;

        INSERT INTO permissions (name, description, resource, action, module)
        VALUES (p_name, 'Manage Platform: ' || p_action, p_resource, p_action, p_module)
        ON CONFLICT (name) DO UPDATE SET 
            resource = EXCLUDED.resource,
            action = EXCLUDED.action,
            module = EXCLUDED.module;
    END LOOP;

    -- 2. Tenants (Managing other tenants)
    FOREACH p_action IN ARRAY ARRAY['create', 'read', 'update', 'delete', 'delete_permanent'] LOOP
        p_resource := 'tenants';
        p_module := 'tenants';
        p_name := 'platform.' || p_resource || '.' || p_action;

        INSERT INTO permissions (name, description, resource, action, module)
        VALUES (p_name, 'Manage Tenants: ' || p_action, p_resource, p_action, p_module)
        ON CONFLICT (name) DO UPDATE SET 
            resource = EXCLUDED.resource,
            action = EXCLUDED.action,
            module = EXCLUDED.module;
    END LOOP;

    -- 3. Tenant (The current tenant settings)
    -- Ensure at least read/update exist for platform scope usage
    FOREACH p_action IN ARRAY ARRAY['read', 'update'] LOOP
        p_resource := 'tenant';
        p_module := 'tenant';
        p_name := 'platform.' || p_resource || '.' || p_action;

        INSERT INTO permissions (name, description, resource, action, module)
        VALUES (p_name, 'Manage Tenant: ' || p_action, p_resource, p_action, p_module)
        ON CONFLICT (name) DO UPDATE SET 
            resource = EXCLUDED.resource,
            action = EXCLUDED.action,
            module = EXCLUDED.module;
    END LOOP;

    -- 4. Dashboard
    -- Ensure read/view exist
    FOREACH p_action IN ARRAY ARRAY['read', 'view'] LOOP
        p_resource := 'dashboard';
        p_module := 'dashboard';
        p_name := 'platform.' || p_resource || '.' || p_action;

        INSERT INTO permissions (name, description, resource, action, module)
        VALUES (p_name, 'Dashboard Access: ' || p_action, p_resource, p_action, p_module)
        ON CONFLICT (name) DO UPDATE SET 
            resource = EXCLUDED.resource,
            action = EXCLUDED.action,
            module = EXCLUDED.module;
    END LOOP;

    -- 5. 2FA
    -- Ensure read/update/manage exist
    FOREACH p_action IN ARRAY ARRAY['read', 'update', 'manage'] LOOP
        p_resource := '2fa';
        p_module := '2fa';
        p_name := 'platform.' || p_resource || '.' || p_action;

        INSERT INTO permissions (name, description, resource, action, module)
        VALUES (p_name, '2FA Management: ' || p_action, p_resource, p_action, p_module)
        ON CONFLICT (name) DO UPDATE SET 
            resource = EXCLUDED.resource,
            action = EXCLUDED.action,
            module = EXCLUDED.module;
    END LOOP;

END $$;
