-- Assign AwTemplate 01 to Primary Tenant

DO $$
DECLARE
    v_primary_tenant_id UUID;
BEGIN
    -- Get Primary Tenant ID
    SELECT id INTO v_primary_tenant_id FROM "public"."tenants" WHERE slug = 'primary';

    -- Update Theme if tenant found
    IF v_primary_tenant_id IS NOT NULL THEN
        UPDATE "public"."themes"
        SET tenant_id = v_primary_tenant_id
        WHERE slug = 'awtemplate01';
    END IF;
END $$;
