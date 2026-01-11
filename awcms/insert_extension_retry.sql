
INSERT INTO extensions (name, slug, extension_type, is_active, tenant_id)
VALUES ('Mailketing', 'mailketing', 'core', true, '469ed0e4-8e8c-4ace-8189-71c7c170994a')
RETURNING *;
