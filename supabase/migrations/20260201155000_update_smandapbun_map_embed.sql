-- Migration: Update smandapbun map embed
-- Created: 2026-02-01
-- Purpose: Update the contact page Google Maps embed URL.

UPDATE public.settings
SET value = jsonb_set(
        coalesce(value::jsonb, '{}'::jsonb),
        '{mapEmbed}',
        '"https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2542.182637282755!2d111.64716318974263!3d-2.6854176337880564!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x2e08ee30ceed8459%3A0x47c7f285f4b5f9c!2sSMA%20Negeri%202%20Pangkalan%20Bun!5e1!3m2!1sid!2sid!4v1769956242665!5m2!1sid!2sid"'
      )::text,
    updated_at = now()
WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'smandapbun')
  AND key = 'page_contact';
