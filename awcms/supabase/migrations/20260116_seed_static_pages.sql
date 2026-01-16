-- Migration: Seed initial pages (about, contact, services) for CMS control
-- These pages correspond to the static .astro pages but allow admin editing
-- Run this in Supabase SQL Editor after getting the primary tenant ID

-- First, get the primary tenant ID (replace with actual query)
DO $$ 
DECLARE
  primary_tenant_id UUID;
BEGIN
  -- Get the first tenant (adjust if needed)
  SELECT id INTO primary_tenant_id FROM tenants WHERE slug = 'primary' LIMIT 1;
  
  IF primary_tenant_id IS NULL THEN
    RAISE NOTICE 'No tenant found. Please create a tenant first.';
    RETURN;
  END IF;

  -- Insert About page
  INSERT INTO pages (
    tenant_id, title, slug, content, excerpt, status, page_type, editor_type, 
    meta_description, is_active, published_at
  ) VALUES (
    primary_tenant_id,
    'About Us',
    'about',
    '<h2>Elevate your online presence with our Beautiful Website Templates</h2>
<p>Donec efficitur, ipsum quis congue luctus, mauris magna convallis mauris, eu auctor nisi lectus non augue. Donec quis lorem non massa vulputate efficitur ac at turpis.</p>

<h3>Our Values</h3>
<ul>
<li><strong>Customer-centric approach</strong> - We put our customers first in everything we do.</li>
<li><strong>Constant Improvement</strong> - We continuously improve our products and services.</li>
<li><strong>Ethical Practices</strong> - We operate with integrity and transparency.</li>
</ul>

<h3>Our Achievements</h3>
<ul>
<li>Global reach across 50+ countries</li>
<li>Positive customer feedback with 4.9/5 rating</li>
<li>Industry awards and recognition</li>
</ul>

<h3>Our Locations</h3>
<ul>
<li>USA - 1234 Lorem Ipsum St, Miami</li>
<li>Spain - 5678 Lorem Ipsum St, Madrid</li>
<li>Australia - 9012 Lorem Ipsum St, Sydney</li>
<li>Brazil - 3456 Lorem Ipsum St, São Paulo</li>
</ul>',
    'Learn about our company, values, and the team behind our beautiful website templates.',
    'published',
    'regular',
    'richtext',
    'About AhliWeb - Learn about our company, values, and commitment to creating beautiful website templates.',
    true,
    NOW()
  ) ON CONFLICT (tenant_id, slug) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    excerpt = EXCLUDED.excerpt,
    updated_at = NOW();

  -- Insert Contact page
  INSERT INTO pages (
    tenant_id, title, slug, content, excerpt, status, page_type, editor_type,
    meta_description, is_active, published_at
  ) VALUES (
    primary_tenant_id,
    'Contact Us',
    'contact',
    '<h2>Let''s Connect!</h2>
<p>For quicker answers, explore our FAQs section. You may find the solution you''re looking for right there! If not, our support team is delighted to help you.</p>

<h3>We are here to help!</h3>
<ul>
<li><strong>General support</strong> - Chat with us for inquiries related to account management, website navigation, payment issues, or general questions.</li>
<li><strong>Contact sales</strong> - Questions about purchases, customization options, licensing for commercial use.</li>
<li><strong>Technical support</strong> - Issues with template installation, editing difficulties, compatibility issues.</li>
</ul>

<h3>Contact Information</h3>
<ul>
<li><strong>Phone:</strong> +1 (234) 567-890</li>
<li><strong>Email:</strong> contact@support.com</li>
<li><strong>Location:</strong> 1234 Lorem Ipsum St, 12345, Miami, USA</li>
</ul>

<p>Our support team typically responds within 24 business hours.</p>',
    'Get in touch with our team. We''re here to help with any questions or concerns.',
    'published',
    'regular',
    'richtext',
    'Contact AhliWeb - Get in touch with our support team for assistance with templates, purchases, or technical issues.',
    true,
    NOW()
  ) ON CONFLICT (tenant_id, slug) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    excerpt = EXCLUDED.excerpt,
    updated_at = NOW();

  -- Insert Services page
  INSERT INTO pages (
    tenant_id, title, slug, content, excerpt, status, page_type, editor_type,
    meta_description, is_active, published_at
  ) VALUES (
    primary_tenant_id,
    'Our Services',
    'services',
    '<h2>Elevate your projects with our stunning templates</h2>
<p>Explore our meticulously crafted templates tailored to various industries and purposes. From captivating presentations to functional website designs, we offer the tools you need to succeed.</p>

<h3>Our Template Categories</h3>
<ul>
<li><strong>Educational</strong> - Templates that streamline content creation for educational materials.</li>
<li><strong>Interior Design</strong> - Crafting functional, visually appealing spaces for homes and businesses.</li>
<li><strong>Photography</strong> - Captivating portfolios that empower photographers with stunning layouts.</li>
<li><strong>E-commerce</strong> - Engaging online stores to effectively showcase your products.</li>
<li><strong>Blog</strong> - User-friendly templates for writers at any stage.</li>
<li><strong>Business</strong> - Professional options for effective visual communication.</li>
<li><strong>Branding</strong> - Pre-designed elements for consistent brand identity.</li>
<li><strong>Medical</strong> - Tools for healthcare professionals to enhance communication.</li>
<li><strong>Fashion Design</strong> - Contemporary designs for showcasing fashion ideas.</li>
</ul>

<h3>Main Features</h3>
<ul>
<li><strong>High-Quality Designs</strong> - Top-tier designs for professional appearance.</li>
<li><strong>Customization Tools</strong> - User-friendly personalization of colors, fonts, and content.</li>
<li><strong>Pre-Designed Elements</strong> - Ready-to-use graphics, icons, and layouts.</li>
<li><strong>Preview and Mockup Views</strong> - Visualize outcomes before making changes.</li>
</ul>

<h3>Benefits</h3>
<ul>
<li><strong>Time Savings</strong> - Create stunning materials efficiently.</li>
<li><strong>Professional Appearance</strong> - Make a lasting impression.</li>
<li><strong>Cost-Efficiency</strong> - Professional designs at a fraction of the cost.</li>
<li><strong>Instant Download</strong> - Immediate access upon purchase.</li>
</ul>',
    'Explore our diverse templates for education, design, photography, e-commerce, and more.',
    'published',
    'regular',
    'richtext',
    'AhliWeb Services - Explore our diverse website templates for education, interior design, photography, e-commerce, and more.',
    true,
    NOW()
  ) ON CONFLICT (tenant_id, slug) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    excerpt = EXCLUDED.excerpt,
    updated_at = NOW();

  RAISE NOTICE 'Successfully seeded about, contact, and services pages for tenant %', primary_tenant_id;
END $$;
