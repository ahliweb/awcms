-- Migration: Seed primary tenant content (blogs and pages)
-- Created: 2026-03-01
-- Purpose: Seed sample content for primary tenant so Blogs/Pages Manager is not empty

-- First, get or create the primary tenant
DO $$
DECLARE
    v_tenant_id uuid;
    v_user_id uuid;
BEGIN
    -- Try to find existing primary tenant
    SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'primary' LIMIT 1;
    
    -- If not found, create it
    IF v_tenant_id IS NULL THEN
        INSERT INTO public.tenants (name, slug, status, tier, created_at, updated_at)
        VALUES ('Ahliweb CMS', 'primary', 'active', 'enterprise', now(), now())
        RETURNING id INTO v_tenant_id;
        RAISE NOTICE 'Created primary tenant with ID: %', v_tenant_id;
    ELSE
        RAISE NOTICE 'Using existing primary tenant with ID: %', v_tenant_id;
    END IF;

    -- Get or create a default user for ownership
    SELECT id INTO v_user_id FROM public.users LIMIT 1;
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'No users found - blogs will be created without owner';
    END IF;

    -- Seed sample categories (if not exist)
    INSERT INTO public.categories (name, slug, description, type, tenant_id, created_at, updated_at)
    VALUES 
        ('Technology', 'technology', 'Technology related articles', 'blog', v_tenant_id, now(), now()),
        ('Business', 'business', 'Business and entrepreneurship', 'blog', v_tenant_id, now(), now()),
        ('Education', 'education', 'Educational content and insights', 'blog', v_tenant_id, now(), now())
    ON CONFLICT DO NOTHING;

    -- Seed sample tags (if not exist)
    INSERT INTO public.tags (name, slug, tenant_id, created_at, updated_at)
    VALUES 
        ('news', 'news', v_tenant_id, now(), now()),
        ('update', 'update', v_tenant_id, now(), now()),
        ('featured', 'featured', v_tenant_id, now(), now())
    ON CONFLICT DO NOTHING;

    -- Seed sample blog posts (if not exist)
    INSERT INTO public.blogs (
        title,
        slug,
        content,
        excerpt,
        featured_image,
        status,
        workflow_state,
        tenant_id,
        author_id,
        is_active,
        is_public,
        created_at,
        updated_at,
        published_at
    )
    SELECT * FROM (
        SELECT 
            'Welcome to Ahliweb CMS' AS title,
            'welcome-to-ahliweb-cms' AS slug,
            '<p>Welcome to Ahliweb CMS! This is your content management system for managing blogs, pages, and more.</p><h2>Getting Started</h2><p>Use the navigation menu to access different modules. You can create new blog posts, manage pages, and customize your website.</p>' AS content,
            'Welcome to Ahliweb CMS - Your all-in-one content management system' AS excerpt,
            NULL AS featured_image,
            'published' AS status,
            'published' AS workflow_state,
            v_tenant_id AS tenant_id,
            v_user_id AS author_id,
            true AS is_active,
            true AS is_public,
            now() AS created_at,
            now() AS updated_at,
            now() AS published_at
        UNION ALL
        SELECT 
            'How to Create Your First Blog Post' AS title,
            'how-to-create-first-blog-post' AS slug,
            '<p>Creating blog posts is easy! Follow these steps to get started.</p><ol><li>Navigate to Blogs in the sidebar</li><li>Click the "New Blog" button</li><li>Fill in the title and content</li><li>Select a category and tags</li><li>Click Publish when ready</li></ol>' AS content,
            'Learn how to create and publish your first blog post in Ahliweb CMS' AS excerpt,
            NULL AS featured_image,
            'published' AS status,
            'published' AS workflow_state,
            v_tenant_id AS tenant_id,
            v_user_id AS author_id,
            true AS is_active,
            true AS is_public,
            now() AS created_at,
            now() AS updated_at,
            now() AS published_at
        UNION ALL
        SELECT 
            'Understanding Content Workflows' AS title,
            'understanding-content-workflows' AS slug,
            '<p>AWCMS supports content workflows to help you manage your content lifecycle.</p><h2>Workflow States</h2><ul><li><strong>Draft</strong> - Work in progress</li><li><strong>Review</strong> - Pending approval</li><li><strong>Published</strong> - Live on your site</li><li><strong>Archived</strong> - Removed from public view</li></ul>' AS content,
            'Learn about content workflows and how to use them effectively' AS excerpt,
            NULL AS featured_image,
            'published' AS status,
            'published' AS workflow_state,
            v_tenant_id AS tenant_id,
            v_user_id AS author_id,
            true AS is_active,
            true AS is_public,
            now() AS created_at,
            now() AS updated_at,
            now() AS published_at
    ) AS new_blogs
    ON CONFLICT (tenant_id, slug) WHERE deleted_at IS NULL DO NOTHING;

    -- Seed sample pages (if not exist)
    INSERT INTO public.pages (
        title,
        slug,
        content,
        excerpt,
        status,
        page_type,
        tenant_id,
        created_by,
        is_active,
        is_public,
        created_at,
        updated_at,
        published_at
    )
    SELECT * FROM (
        SELECT 
            'Home' AS title,
            'home' AS slug,
            '<h1>Welcome to Our Website</h1><p>This is the home page of your website.</p>' AS content,
            'Welcome to our website' AS excerpt,
            'published' AS status,
            'home' AS page_type,
            v_tenant_id AS tenant_id,
            v_user_id AS created_by,
            true AS is_active,
            true AS is_public,
            now() AS created_at,
            now() AS updated_at,
            now() AS published_at
        UNION ALL
        SELECT 
            'About Us' AS title,
            'about' AS slug,
            '<h1>About Us</h1><p>We are a company dedicated to providing quality content management solutions.</p>' AS content,
            'Learn more about us' AS excerpt,
            'published' AS status,
            'regular' AS page_type,
            v_tenant_id AS tenant_id,
            v_user_id AS created_by,
            true AS is_active,
            true AS is_public,
            now() AS created_at,
            now() AS updated_at,
            now() AS published_at
        UNION ALL
        SELECT 
            'Contact' AS title,
            'contact' AS slug,
            '<h1>Contact Us</h1><p>Get in touch with us!</p><p>Email: info@ahliweb.com</p>' AS content,
            'Contact us for more information' AS excerpt,
            'published' AS status,
            'regular' AS page_type,
            v_tenant_id AS tenant_id,
            v_user_id AS created_by,
            true AS is_active,
            true AS is_public,
            now() AS created_at,
            now() AS updated_at,
            now() AS published_at
    ) AS new_pages
    ON CONFLICT (tenant_id, slug) WHERE deleted_at IS NULL DO NOTHING;

    RAISE NOTICE 'Content seeding completed for primary tenant: %', v_tenant_id;
END $$;
