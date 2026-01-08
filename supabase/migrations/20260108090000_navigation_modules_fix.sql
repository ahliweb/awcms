-- ============================================
-- Navigation Modules Audit Fix Migration
-- Date: 2026-01-08
-- Description: Fix tenant_id constraints, RLS policies, and seed data
-- ============================================

-- ============================================
-- PHASE 1: PRE-CHECK (Report counts before deletion)
-- ============================================
DO $$
DECLARE
    cat_null INT; cat_invalid INT;
    tag_null INT; tag_invalid INT;
    menu_null INT; menu_invalid INT;
    perm_null INT;
BEGIN
    SELECT COUNT(*) INTO cat_null FROM categories WHERE tenant_id IS NULL;
    SELECT COUNT(*) INTO cat_invalid FROM categories 
        WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT id FROM tenants);
    
    SELECT COUNT(*) INTO tag_null FROM tags WHERE tenant_id IS NULL;
    SELECT COUNT(*) INTO tag_invalid FROM tags 
        WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT id FROM tenants);
    
    SELECT COUNT(*) INTO menu_null FROM menus WHERE tenant_id IS NULL;
    SELECT COUNT(*) INTO menu_invalid FROM menus 
        WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT id FROM tenants);
    
    SELECT COUNT(*) INTO perm_null FROM menu_permissions WHERE tenant_id IS NULL;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'CLEANUP PRE-CHECK REPORT:';
    RAISE NOTICE '========================================';
    RAISE NOTICE '  categories: % NULL tenant_id, % invalid tenant_id', cat_null, cat_invalid;
    RAISE NOTICE '  tags: % NULL tenant_id, % invalid tenant_id', tag_null, tag_invalid;
    RAISE NOTICE '  menus: % NULL tenant_id, % invalid tenant_id', menu_null, menu_invalid;
    RAISE NOTICE '  menu_permissions: % NULL tenant_id', perm_null;
    RAISE NOTICE '========================================';
END $$;

-- ============================================
-- PHASE 2: CLEANUP INVALID DATA
-- Handle FK constraints before deletion
-- ============================================

-- Use session settings to avoid RLS during cleanup (runs as superuser during migration)
SET session_replication_role = replica;

-- Step 2a: Nullify FK references to orphaned categories
UPDATE articles SET category_id = NULL WHERE category_id IN (
    SELECT id FROM categories WHERE tenant_id IS NULL 
    OR tenant_id NOT IN (SELECT id FROM tenants)
);
UPDATE announcements SET category_id = NULL WHERE category_id IN (
    SELECT id FROM categories WHERE tenant_id IS NULL 
    OR tenant_id NOT IN (SELECT id FROM tenants)
);

-- Step 2b: Delete menu_permissions first (FK child relationship)
DELETE FROM menu_permissions WHERE menu_id IN (
    SELECT id FROM menus WHERE tenant_id IS NULL 
    OR tenant_id NOT IN (SELECT id FROM tenants)
);
DELETE FROM menu_permissions WHERE tenant_id IS NULL;

-- Step 2c: Delete tag join tables referencing orphaned tags
DELETE FROM article_tags WHERE tag_id IN (
    SELECT id FROM tags WHERE tenant_id IS NULL 
    OR tenant_id NOT IN (SELECT id FROM tenants)
);
DELETE FROM announcement_tags WHERE tag_id IN (
    SELECT id FROM tags WHERE tenant_id IS NULL 
    OR tenant_id NOT IN (SELECT id FROM tenants)
);

-- Step 2d: Delete menus with invalid tenant
DELETE FROM menus WHERE tenant_id IS NULL;
DELETE FROM menus WHERE tenant_id NOT IN (SELECT id FROM tenants);

-- Step 2e: Delete categories with invalid tenant
DELETE FROM categories WHERE tenant_id IS NULL;
DELETE FROM categories WHERE tenant_id NOT IN (SELECT id FROM tenants);

-- Step 2f: Delete tags with invalid tenant
DELETE FROM tags WHERE tenant_id IS NULL;
DELETE FROM tags WHERE tenant_id NOT IN (SELECT id FROM tenants);

-- Reset session settings after cleanup
SET session_replication_role = origin;

-- ============================================
-- PHASE 3: ADD NOT NULL CONSTRAINTS
-- ============================================
ALTER TABLE categories ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tags ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE menus ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE menu_permissions ALTER COLUMN tenant_id SET NOT NULL;

-- ============================================
-- PHASE 4: CREATE RLS POLICIES FOR MENUS
-- ============================================

-- Drop existing policies if any (safe re-run)
DROP POLICY IF EXISTS "menus_select_unified" ON "public"."menus";
DROP POLICY IF EXISTS "menus_insert_unified" ON "public"."menus";
DROP POLICY IF EXISTS "menus_update_unified" ON "public"."menus";
DROP POLICY IF EXISTS "menus_delete_unified" ON "public"."menus";

-- Create unified RLS policies matching categories/tags pattern
CREATE POLICY "menus_select_unified" ON "public"."menus" 
    FOR SELECT USING (
        (tenant_id = public.current_tenant_id()) 
        OR public.is_platform_admin()
    );

CREATE POLICY "menus_insert_unified" ON "public"."menus" 
    FOR INSERT WITH CHECK (
        ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) 
        OR public.is_platform_admin()
    );

CREATE POLICY "menus_update_unified" ON "public"."menus" 
    FOR UPDATE USING (
        ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) 
        OR public.is_platform_admin()
    );

CREATE POLICY "menus_delete_unified" ON "public"."menus" 
    FOR DELETE USING (
        ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) 
        OR public.is_platform_admin()
    );

-- ============================================
-- PHASE 5: ADD INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tags_tenant_id ON tags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_menus_tenant_id ON menus(tenant_id);
CREATE INDEX IF NOT EXISTS idx_menu_permissions_tenant_id ON menu_permissions(tenant_id);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_categories_tenant_deleted ON categories(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tags_tenant_deleted ON tags(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_menus_tenant_deleted ON menus(tenant_id, deleted_at);

-- ============================================
-- PHASE 6: SEED DUMMY DATA FOR PRIMARY TENANT
-- ============================================
DO $$
DECLARE
    primary_tenant_id UUID;
    menu_count INT;
    cat_count INT;
    tag_count INT;
BEGIN
    -- Get primary tenant ID
    SELECT id INTO primary_tenant_id FROM tenants WHERE slug = 'primary' LIMIT 1;
    
    IF primary_tenant_id IS NULL THEN
        RAISE NOTICE 'Primary tenant not found, skipping seed data';
        RETURN;
    END IF;
    
    -- Check existing data counts
    SELECT COUNT(*) INTO menu_count FROM menus WHERE tenant_id = primary_tenant_id AND deleted_at IS NULL;
    SELECT COUNT(*) INTO cat_count FROM categories WHERE tenant_id = primary_tenant_id AND deleted_at IS NULL;
    SELECT COUNT(*) INTO tag_count FROM tags WHERE tenant_id = primary_tenant_id AND deleted_at IS NULL;
    
    -- Seed Menus (if empty for primary)
    IF menu_count = 0 THEN
        INSERT INTO menus (name, label, slug, url, tenant_id, "order", is_active, is_public, group_label) VALUES
            ('main_menu', 'Main Menu', 'main-menu', '/', primary_tenant_id, 1, true, true, 'header'),
            ('footer_menu', 'Footer Menu', 'footer-menu', '/about', primary_tenant_id, 2, true, true, 'footer'),
            ('support_menu', 'Support Menu', 'support-menu', '/contact', primary_tenant_id, 3, true, true, 'footer');
        RAISE NOTICE 'Seeded 3 menus for primary tenant';
    ELSE
        RAISE NOTICE 'Primary tenant already has % menus, skipping seed', menu_count;
    END IF;
    
    -- Seed Categories (if empty for primary)
    IF cat_count = 0 THEN
        INSERT INTO categories (name, slug, type, tenant_id) VALUES
            ('News', 'news', 'article', primary_tenant_id),
            ('Products', 'products', 'product', primary_tenant_id),
            ('Events', 'events', 'announcement', primary_tenant_id);
        RAISE NOTICE 'Seeded 3 categories for primary tenant';
    ELSE
        RAISE NOTICE 'Primary tenant already has % categories, skipping seed', cat_count;
    END IF;
    
    -- Seed Tags (if empty for primary)
    IF tag_count = 0 THEN
        INSERT INTO tags (name, slug, color, is_active, tenant_id) VALUES
            ('promo', 'promo', '#ef4444', true, primary_tenant_id),
            ('update', 'update', '#3b82f6', true, primary_tenant_id),
            ('featured', 'featured', '#10b981', true, primary_tenant_id);
        RAISE NOTICE 'Seeded 3 tags for primary tenant';
    ELSE
        RAISE NOTICE 'Primary tenant already has % tags, skipping seed', tag_count;
    END IF;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'SEED DATA COMPLETE FOR PRIMARY TENANT';
    RAISE NOTICE '========================================';
END $$;
