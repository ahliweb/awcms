-- Migration: Update smandapbun logo
-- Created: 2026-02-01
-- Purpose: Ensure site_info.logo uses the new logo asset.

UPDATE public.settings
SET value = jsonb_set(
        coalesce(value::jsonb, '{}'::jsonb),
        '{site,logo}',
        '"/images/smanda-logo.png"'
      )::text,
    updated_at = now()
WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'smandapbun')
  AND key = 'site_info';
