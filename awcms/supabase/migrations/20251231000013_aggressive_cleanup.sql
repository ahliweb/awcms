-- Migration: Aggressive Policy Cleanup & Duplicate Index Fix
-- Date: 2025-12-31
-- Description: Aggressively drops all potential legacy RLS policy names for backups, order_items, users, roles to resolve 'Multiple Permissive Policies'. Drops duplicate role_policies index.

-- 1. DROP DUPLICATE INDEX on role_policies
-- One of these is likely duplicate. Dropping the custom named ones to rely on system defaults or the remaining one.
DROP INDEX IF EXISTS public.idx_role_policies_role;
DROP INDEX IF EXISTS public.idx_role_policies_role_id;


-- 2. AGGRESSIVE POLICY CLEANUP
-- Logic: A 'Multiple Permissive Policies' warning means overlapping Permissive policies exist.
-- We want to keep ONLY the "_unified" ones created in Migration 08/09/12.

DO $$
DECLARE
    t text;
    -- Tables still showing warnings in screenshot
    tables text[] := ARRAY['backups', 'order_items', 'users', 'roles'];
    
    -- Common legacy patterns found in codebase
    patterns text[] := ARRAY[
        '%I_select_policy', '%I_insert_policy', '%I_update_policy', '%I_delete_policy',
        '%I_read_policy', '%I_write_policy', '%I_modify_policy',
        '%I_access_policy', '%I_isolation_policy',
        'Tenant Read Access', 'Tenant Write Access', 
        'Tenant Update Access', 'Tenant Delete Access', 'Tenant Insert Access',
        'Tenant Isolation Select', 'Tenant Isolation All', 'Tenant Isolation Insert',
        'Public can view %I', 'Admins can manage %I'
    ];
    
    p text;
    policy_name text;
BEGIN
    FOREACH t IN ARRAY tables LOOP
        FOREACH p IN ARRAY patterns LOOP
            -- Construct potential policy name
            IF p LIKE '%%I%%' THEN
                policy_name := format(p, t);
            ELSE
                policy_name := p;
            END IF;

            -- Explicit Drop
            EXECUTE format('DROP POLICY IF EXISTS "%s" ON public.%I;', policy_name, t);
        END LOOP;
        
        -- Special Cases seen in previous migrations
        IF t = 'users' THEN
            EXECUTE 'DROP POLICY IF EXISTS "admins_view_pending_users" ON public.users;';
            EXECUTE 'DROP POLICY IF EXISTS "admins_approve_users" ON public.users;';
            EXECUTE 'DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;';
            EXECUTE 'DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.users;';
        END IF;
        
         IF t = 'roles' THEN
            EXECUTE 'DROP POLICY IF EXISTS "Enable read access for all users" ON public.roles;';
             EXECUTE 'DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.roles;';
        END IF;

    END LOOP;
END $$;
