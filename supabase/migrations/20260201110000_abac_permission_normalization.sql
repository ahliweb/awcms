-- Migration: Normalize Permission Keys to ABAC Standard
-- Date: 2026-02-01
-- Description: Renames legacy permission keys to 'scope.module.action' format and populates the 'module' column.

DO $$
DECLARE
    r record;
BEGIN
    -- 1. DROP BAD CONSTRAINT (Robustly)
    BEGIN
        ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_scope_check;
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;

    -- 2. Normalize Permissions
    FOR r IN SELECT * FROM (VALUES 
        ('view_orders', 'tenant.orders.read', 'orders', 'orders', 'read'),
        ('tenant.orders.view', 'tenant.orders.read', 'orders', 'orders', 'read'), 
        ('edit_articles', 'tenant.blog.update', 'blog', 'blog', 'update'),
        ('delete_articles', 'tenant.blog.delete', 'blog', 'blog', 'delete'),
        ('restore_articles', 'tenant.blog.restore', 'blog', 'blog', 'restore'),
        ('publish_articles', 'tenant.blog.publish', 'blog', 'blog', 'publish'),
        ('soft_delete_articles', 'tenant.blog.soft_delete', 'blog', 'blog', 'soft_delete'),
        ('permanent_delete_articles', 'tenant.blog.permanent_delete', 'blog', 'blog', 'permanent_delete'),
        ('upload_files', 'tenant.files.upload', 'files', 'files', 'upload'),
        ('permanent_delete_files', 'tenant.files.permanent_delete', 'files', 'files', 'permanent_delete'),
        ('permanent_delete_settings', 'tenant.settings.permanent_delete', 'settings', 'settings', 'permanent_delete'),
        ('edit_themes', 'tenant.themes.update', 'themes', 'themes', 'update'),
        ('edit_visual_pages', 'tenant.visual_pages.update', 'visual_pages', 'visual_pages', 'update'),
        ('edit_galleries', 'tenant.galleries.update', 'galleries', 'galleries', 'update'),
        ('permanent_delete_product_types', 'tenant.product_types.permanent_delete', 'product_types', 'product_types', 'permanent_delete'),
        ('Read Regions', 'tenant.regions.read', 'regions', 'regions', 'read')
    ) AS t(legacy_name, standard_name, mod, res, act)
    LOOP
        DECLARE
            v_legacy_id uuid;
            v_standard_id uuid;
        BEGIN
            v_legacy_id := NULL;
            v_standard_id := NULL;
            
            SELECT id INTO v_legacy_id FROM permissions WHERE name = r.legacy_name;
            SELECT id INTO v_standard_id FROM permissions WHERE name = r.standard_name;
            
            IF v_legacy_id IS NOT NULL THEN
                IF v_standard_id IS NOT NULL THEN
                    -- Target exists. Merge.
                    -- Move role_permissions (ignore duplicates)
                    UPDATE role_permissions 
                    SET permission_id = v_standard_id 
                    WHERE permission_id = v_legacy_id
                    AND NOT EXISTS (
                        SELECT 1 FROM role_permissions rp2 
                        WHERE rp2.role_id = role_permissions.role_id 
                        AND rp2.permission_id = v_standard_id
                    );
                    
                    -- Delete remaining (duplicates)
                    DELETE FROM role_permissions WHERE permission_id = v_legacy_id;
                    
                    -- Delete legacy permission
                    DELETE FROM permissions WHERE id = v_legacy_id;
                    
                ELSE
                    -- Target does not exist. Rename/Update.
                    UPDATE permissions 
                    SET name = r.standard_name,
                        module = r.mod,
                        resource = r.res,
                        action = r.act
                    WHERE id = v_legacy_id;
                END IF;
            END IF;
        END;
    END LOOP;
    
    -- 3. Fix Module Names (Robust Update)
    UPDATE permissions SET module = 'reporting' WHERE name LIKE 'platform.reporting.%';
    UPDATE permissions SET module = 'school_pages' WHERE name LIKE 'tenant.school_pages.%';
    UPDATE permissions SET module = 'blog' WHERE module = 'blogs';
    
    -- 4. Cleanup others
    UPDATE permissions 
    SET deleted_at = NOW() 
    WHERE name NOT LIKE '%.%.%' 
      AND deleted_at IS NULL;
      
END $$;
