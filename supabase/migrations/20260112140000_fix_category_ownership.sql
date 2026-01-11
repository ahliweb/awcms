DO $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
BEGIN
    -- Get primary tenant ID
    SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'primary' LIMIT 1;

    -- Get marketing user ID
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'marketing@ahliweb.com' LIMIT 1;
    
    -- Update categories
    IF v_tenant_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        UPDATE public.categories 
        SET tenant_id = v_tenant_id, 
            created_by = v_user_id
        WHERE tenant_id IS NULL OR created_by IS NULL OR tenant_id != v_tenant_id OR created_by != v_user_id;
        
        RAISE NOTICE 'Updated categories to Tenant % and User %', v_tenant_id, v_user_id;
    ELSE
        RAISE WARNING 'Primary tenant or Marketing user not found. Tenant: %, User: %', v_tenant_id, v_user_id;
    END IF;
END $$;
