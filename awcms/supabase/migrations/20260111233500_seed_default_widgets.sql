
-- 1. Add slug column to template_parts if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'template_parts' AND column_name = 'slug') THEN
        ALTER TABLE public.template_parts ADD COLUMN slug TEXT;
        CREATE INDEX IF NOT EXISTS idx_template_parts_slug ON public.template_parts(slug);
    END IF;
END $$;

-- 2. Seed Default Widget Area and Widget
DO $$
DECLARE
    v_tenant_id uuid;
    v_area_id uuid;
BEGIN
    -- Get Primary Tenant ID
    SELECT id INTO v_tenant_id FROM tenants 
    WHERE slug = 'primary' 
       OR name ILIKE '%primary%'
       OR domain ILIKE '%primary%'
    LIMIT 1;
    
    IF v_tenant_id IS NULL THEN
        RAISE NOTICE 'No primary tenant found. Skipping seed.';
        RETURN;
    END IF;

    -- Insert Default Sidebar (Widget Area)
    -- We try to find it first by name or slug
    SELECT id INTO v_area_id FROM template_parts 
    WHERE tenant_id = v_tenant_id AND (slug = 'default-sidebar' OR name = 'Default Sidebar');

    IF v_area_id IS NULL THEN
        INSERT INTO template_parts (name, slug, type, tenant_id, is_active, content)
        VALUES ('Default Sidebar', 'default-sidebar', 'widget_area', v_tenant_id, true, '{}')
        RETURNING id INTO v_area_id;
    ELSE
        -- Ensure slug is set if it was found by name but missing slug
        UPDATE template_parts SET slug = 'default-sidebar' WHERE id = v_area_id AND slug IS NULL;
    END IF;

    -- Insert Default Text Widget if not exists
    IF NOT EXISTS (SELECT 1 FROM widgets WHERE area_id = v_area_id AND type = 'core/text') THEN
        INSERT INTO widgets (type, config, area_id, "order", tenant_id)
        VALUES (
            'core/text', 
            '{"content": "<h3>Welcome!</h3><p>This is a default text widget.</p>", "isHtml": true}', 
            v_area_id, 
            0, 
            v_tenant_id
        );
    END IF;

END $$;
