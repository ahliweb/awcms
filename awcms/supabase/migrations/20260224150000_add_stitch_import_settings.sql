-- Migration Skeleton: Seed tenant-level Stitch import controls
--
-- Settings schema (stored as JSON string in settings.value):
-- {
--   "enabled": false,
--   "mode": "hybrid",
--   "max_input_kb": 512,
--   "allow_raw_html_fallback": true,
--   "allowed_source_formats": ["html", "zip"],
--   "track_import_history": true
-- }

INSERT INTO public.settings (
  tenant_id,
  key,
  value,
  type,
  description,
  is_public,
  updated_at
)
SELECT
  t.id,
  'stitch_import',
  '{"enabled":false,"mode":"hybrid","max_input_kb":512,"allow_raw_html_fallback":true,"allowed_source_formats":["html","zip"],"track_import_history":true}'::text,
  'json',
  'Tenant-level controls for Stitch import into TipTap/Puck editors',
  false,
  now()
FROM public.tenants t
ON CONFLICT (tenant_id, key) DO NOTHING;
