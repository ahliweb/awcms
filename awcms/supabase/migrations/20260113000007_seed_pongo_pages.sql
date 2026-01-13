-- Seed default Pongo pages for primary tenant
-- Usage: run this SQL in Supabase SQL editor or via migration tool

INSERT INTO "public"."pages" ("tenant_id", "title", "slug", "content", "status", "layout_key", "content_type", "published_at", "is_public", "created_at", "updated_at")
VALUES
(
    'primary',
    'Home', 
    'home', 
    '<div class="hero-section"><h1>Welcome to Pongo</h1><p>We are a digital agency.</p></div>', 
    'published', 
    'pongo.landing', 
    'richtext',
    NOW(),
    TRUE,
    NOW(),
    NOW()
),
(
    'primary',
    'About Us', 
    'about', 
    '<div class="about-section"><h2>About Us</h2><p>We are a team of professionals.</p></div>', 
    'published', 
    'pongo.standard', 
    'richtext',
    NOW(),
    TRUE,
    NOW(),
    NOW()
),
(
    'primary',
    'Contact', 
    'contact', 
    '<div class="contact-section"><h2>Contact Us</h2><p>Email: info@example.com</p></div>', 
    'published', 
    'pongo.standard', 
    'richtext',
    NOW(),
    TRUE,
    NOW(),
    NOW()
)
ON CONFLICT ("tenant_id", "slug") DO NOTHING;
