DO $$
DECLARE
    r record;
BEGIN
    RAISE NOTICE 'Listing Categories:';
    FOR r IN SELECT id, name, type, tenant_id FROM public.categories LOOP
        RAISE NOTICE 'ID: %, Name: %, Type: %, Tenant: %', r.id, r.name, r.type, r.tenant_id;
    END LOOP;
END $$;
