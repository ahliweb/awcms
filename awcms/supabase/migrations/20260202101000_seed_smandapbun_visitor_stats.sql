SET client_min_messages TO warning;

-- Description: Seed smandapbun consent notice and public menu entry for visitor stats.

DO $seed$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'smandapbun';

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'Tenant smandapbun not found, skipping visitor stats seed.';
  ELSE
    INSERT INTO public.settings (tenant_id, key, value, type, description, is_public, updated_at)
    VALUES (
      v_tenant_id,
      'analytics_consent',
      $$
{
  "enabled": true,
  "mode": "informational",
  "version": "2026-02-02",
  "title": {
    "id": "Pemberitahuan Cookie",
    "en": "Cookie Notice"
  },
  "body": {
    "id": "Kami menggunakan cookie untuk memahami penggunaan situs dan meningkatkan pengalaman. Data yang dikumpulkan meliputi:",
    "en": "We use cookies to understand site usage and improve the experience. Data collected includes:"
  },
  "data_points": [
    { "id": "Alamat IP pengunjung", "en": "Visitor IP address" },
    { "id": "Halaman yang dikunjungi", "en": "Pages visited" },
    { "id": "Referrer dan parameter UTM", "en": "Referrer and UTM parameters" },
    { "id": "Informasi perangkat dan browser", "en": "Device and browser information" },
    { "id": "Lokasi perkiraan (negara/region)", "en": "Approximate location (country/region)" }
  ],
  "accept_label": { "id": "Mengerti", "en": "Accept" },
  "decline_label": { "id": "Tolak", "en": "Decline" }
}
      $$,
      'json',
      'Visitor analytics consent notice',
      true,
      now()
    )
    ON CONFLICT (tenant_id, key) DO UPDATE SET
      value = EXCLUDED.value,
      type = EXCLUDED.type,
      description = EXCLUDED.description,
      is_public = EXCLUDED.is_public,
      updated_at = EXCLUDED.updated_at;

    INSERT INTO public.menus (
      tenant_id,
      name,
      label,
      url,
      icon,
      group_label,
      is_active,
      is_public,
      "order"
    )
    SELECT
      v_tenant_id,
      'visitor_stats',
      'Visitor Stats',
      '/visitor-stats',
      'LineChart',
      'footer',
      true,
      true,
      90
    WHERE NOT EXISTS (
      SELECT 1 FROM public.menus
      WHERE tenant_id = v_tenant_id
        AND url = '/visitor-stats'
        AND group_label = 'footer'
        AND deleted_at IS NULL
    );
  END IF;
END;
$seed$;
