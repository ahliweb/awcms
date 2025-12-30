-- Migration: 20251230000004_seed_default_templates.sql
-- Description: Creates default templates for each page type.

-- The tenant_id is typically set via RLS context or a trigger.
-- This seed is designed to be run PER TENANT or via an RPC that accepts tenant_id.
-- For simplicity, we assume a trigger `set_tenant_id_from_context` exists.

-- 1. Default Home Template
INSERT INTO public.templates (name, slug, description, type, is_active, data, tenant_id)
VALUES (
    'Default Home',
    'default-home',
    'A simple home page layout with Hero and sections.',
    'page',
    true,
    '{"content":[{"type":"Hero","props":{"title":"Welcome!","subtitle":"This is your homepage."}},{"type":"Section","props":{"title":"About Us"}}],"root":{}}'::jsonb,
    (SELECT id FROM public.tenants ORDER BY created_at ASC LIMIT 1)
) ON CONFLICT (slug) DO NOTHING;

-- 2. Default 404 Template
INSERT INTO public.templates (name, slug, description, type, is_active, data, tenant_id)
VALUES (
    'Default 404',
    'default-404',
    'Standard 404 Not Found page.',
    'error',
    true,
    '{"content":[{"type":"Hero","props":{"title":"404 - Page Not Found","subtitle":"Sorry, the page you are looking for does not exist."}}],"root":{}}'::jsonb,
    (SELECT id FROM public.tenants ORDER BY created_at ASC LIMIT 1)
) ON CONFLICT (slug) DO NOTHING;

-- 3. Default Archive Template
INSERT INTO public.templates (name, slug, description, type, is_active, data, tenant_id)
VALUES (
    'Default Archive',
    'default-archive',
    'Standard archive listing template.',
    'archive',
    true,
    '{"content":[{"type":"Section","props":{"title":"Archive"}}],"root":{}}'::jsonb,
    (SELECT id FROM public.tenants ORDER BY created_at ASC LIMIT 1)
) ON CONFLICT (slug) DO NOTHING;

-- 4. Default Single Post Template
INSERT INTO public.templates (name, slug, description, type, is_active, data, tenant_id)
VALUES (
    'Default Single',
    'default-single',
    'Standard single post template.',
    'single',
    true,
    '{"content":[{"type":"Section","props":{"title":"Post Title"}}],"root":{}}'::jsonb,
    (SELECT id FROM public.tenants ORDER BY created_at ASC LIMIT 1)
) ON CONFLICT (slug) DO NOTHING;

-- 5. Default Header Part
INSERT INTO public.template_parts (name, type, content, tenant_id)
VALUES (
    'Default Header',
    'header',
    '{"content":[{"type":"core/menu","props":{"menuId":""}}]}'::jsonb,
    (SELECT id FROM public.tenants ORDER BY created_at ASC LIMIT 1)
) ON CONFLICT DO NOTHING;

-- 6. Default Footer Part
INSERT INTO public.template_parts (name, type, content, tenant_id)
VALUES (
    'Default Footer',
    'footer',
    '{"content":[{"type":"core/text","props":{"content":"© 2024 My Website","isHtml":false}}]}'::jsonb,
    (SELECT id FROM public.tenants ORDER BY created_at ASC LIMIT 1)
) ON CONFLICT DO NOTHING;
