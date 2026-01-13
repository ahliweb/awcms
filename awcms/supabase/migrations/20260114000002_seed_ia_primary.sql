-- Seed IA for Primary Tenant
-- Migrates to new Hierarchical Structure

-- 1. Helper function to get primary tenant
-- (Assumed 'primary' but good to be safe if ID changes, here we hardcode per requirements)

-- 2. Upsert Pages
-- Home
INSERT INTO "public"."pages" ("tenant_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
VALUES
('primary', 'Home', 'home', '<h1>Welcome Home</h1>', 'published', 'awtemplate01.landing', 'awtemplate01', 'richtext', NOW(), TRUE, 10, TRUE)
ON CONFLICT ("tenant_id", "slug") DO UPDATE 
SET "layout_key" = 'awtemplate01.landing', "template_key" = 'awtemplate01', "sort_order" = 10;

-- Hub: Profile
INSERT INTO "public"."pages" ("tenant_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
VALUES
('primary', 'Profile', 'profile', '<h1>Company Profile</h1>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 20, TRUE)
ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "template_key" = 'awtemplate01', "sort_order" = 20;

-- Profile Children (need to lookup parent_id dynamically or use a DO block)
DO $$
DECLARE
    v_profile_id uuid;
    v_services_id uuid;
BEGIN
    SELECT id INTO v_profile_id FROM "public"."pages" WHERE tenant_id = 'primary' AND slug = 'profile';

    -- About
    INSERT INTO "public"."pages" ("tenant_id", "parent_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
    VALUES
    ('primary', v_profile_id, 'About Us', 'profile/about', '<h2>About Us</h2>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 10, TRUE)
    ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "parent_id" = v_profile_id, "template_key" = 'awtemplate01';

    -- Vision
    INSERT INTO "public"."pages" ("tenant_id", "parent_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
    VALUES
    ('primary', v_profile_id, 'Vision & Mission', 'profile/vision-mission', '<h2>Vision</h2>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 20, TRUE)
    ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "parent_id" = v_profile_id, "template_key" = 'awtemplate01';

    -- Team
    INSERT INTO "public"."pages" ("tenant_id", "parent_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
    VALUES
    ('primary', v_profile_id, 'Our Team', 'profile/team', '<h2>Team</h2>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 30, TRUE)
    ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "parent_id" = v_profile_id, "template_key" = 'awtemplate01';
    
    -- Hub: Services
    INSERT INTO "public"."pages" ("tenant_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
    VALUES
    ('primary', 'Services', 'services', '<h1>Services</h1>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 30, TRUE)
    ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "template_key" = 'awtemplate01', "sort_order" = 30
    RETURNING id INTO v_services_id;

    -- Services Children
    -- Testimonials
    INSERT INTO "public"."pages" ("tenant_id", "parent_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
    VALUES
    ('primary', v_services_id, 'Testimonials', 'services/testimonials', '<h2>Testimonials</h2>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 10, TRUE)
    ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "parent_id" = v_services_id, "template_key" = 'awtemplate01';

    -- FAQ
    INSERT INTO "public"."pages" ("tenant_id", "parent_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
    VALUES
    ('primary', v_services_id, 'FAQ', 'services/faq', '<h2>FAQ</h2>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 20, TRUE)
    ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "parent_id" = v_services_id, "template_key" = 'awtemplate01';

END $$;

-- Projects
INSERT INTO "public"."pages" ("tenant_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
VALUES
('primary', 'Projects', 'projects', '<h1>Projects</h1>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 40, TRUE)
ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "template_key" = 'awtemplate01', "sort_order" = 40;

-- News
INSERT INTO "public"."pages" ("tenant_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
VALUES
('primary', 'News', 'news', '<h1>News</h1>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 50, TRUE)
ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "template_key" = 'awtemplate01', "sort_order" = 50;

-- Contact
INSERT INTO "public"."pages" ("tenant_id", "title", "slug", "content", "status", "layout_key", "template_key", "content_type", "published_at", "is_public", "sort_order", "nav_visibility")
VALUES
('primary', 'Contact', 'contact', '<h1>Contact Us</h1>', 'published', 'awtemplate01.standard', 'awtemplate01', 'richtext', NOW(), TRUE, 60, TRUE)
ON CONFLICT ("tenant_id", "slug") DO UPDATE SET "template_key" = 'awtemplate01', "sort_order" = 60;
