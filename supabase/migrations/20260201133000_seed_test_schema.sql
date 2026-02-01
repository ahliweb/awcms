-- Migration: Seed Test Dynamic Resource
-- Description: Adds a test resource and its UI schema to verify the dynamic form builder.

-- 1. Insert Test Resource
INSERT INTO public.resources_registry (key, label, scope, type, db_table, icon, permission_prefix)
VALUES (
  'test_dynamic', 
  'Test Dynamic Resource', 
  'tenant', 
  'settings', 
  'settings', 
  'FlaskConical',
  'tenant.setting'
) ON CONFLICT (key) DO NOTHING;

-- 2. Insert UI Schema for Test Resource
INSERT INTO public.ui_configs (resource_key, type, name, is_default, schema)
VALUES (
  'test_dynamic',
  'form',
  'default',
  true,
  '{
    "fields": [
      {
        "name": "site_title",
        "label": "Site Title",
        "type": "text",
        "required": true,
        "placeholder": "Enter your site title"
      },
      {
        "name": "enable_maintenance",
        "label": "Maintenance Mode",
        "type": "boolean",
        "helpText": "Enable maintenance mode to show a coming soon page"
      },
      {
        "name": "admin_email",
        "label": "Admin Email",
        "type": "text",
        "required": true
      },
      {
        "name": "theme_color",
        "label": "Theme Color",
        "type": "select",
        "options": [
          { "value": "blue", "label": "Blue" },
          { "value": "red", "label": "Red" },
          { "value": "green", "label": "Green" },
          { "value": "dark", "label": "Dark Mode" }
        ]
      },
      {
        "name": "footer_text",
        "label": "Footer Text",
        "type": "textarea",
        "placeholder": "Copyright 2026..."
      }
    ]
  }'::jsonb
) ON CONFLICT (resource_key, type, tenant_id, name) DO UPDATE 
SET schema = EXCLUDED.schema;
