-- ADR-0054 — permission PLATFORM untuk direktori & provisioning tenant.
--
-- ## Kenapa keduanya `platform`, bukan `tenant`
--
-- `tenant_provisioning.create` menambah PIHAK ke deployment; itu bukan aksi
-- sebuah tenant atas datanya sendiri. `tenant_provisioning.read` mendaftar
-- SELURUH tenant — versi tenant-scoped-nya berarti owner mana pun bisa
-- meng-enumerasi daftar pelanggan platform.
--
-- Karena keduanya `scope = 'platform'`, `createTenantWithOwner` (yang menyaring
-- `WHERE scope = 'tenant'`) tidak akan pernah memberikannya ke tenant yang
-- di-provision — termasuk tenant yang dibuat lewat endpoint ini sendiri. Itu
-- properti yang penting: platform tidak bisa tanpa sengaja melahirkan pesaing
-- wewenangnya sendiri.
--
-- ## Grant
--
-- Sama seperti `sql/085`: ke role `owner` milik `awcms_setup_state.tenant_id`,
-- dan hanya itu. Deployment yang mengarahkan `PLATFORM_TENANT_ID` ke tenant lain
-- memberikannya sendiri; `bun run security:readiness` melaporkan ketidakcocokan
-- itu alih-alih membiarkannya ditemukan lewat 403.
--
-- Idempotent: `ON CONFLICT` pada kunci natural, dan grant-nya anti-join.

INSERT INTO awcms_permissions (module_key, activity_code, action, description, scope)
VALUES
  ('tenant_admin', 'tenant_provisioning', 'read',
   'PLATFORM: list every tenant on the deployment',
   'platform'),
  ('tenant_admin', 'tenant_provisioning', 'create',
   'PLATFORM: provision a new tenant with its owner account',
   'platform')
ON CONFLICT (module_key, activity_code, action) DO UPDATE
  SET scope = EXCLUDED.scope,
      description = EXCLUDED.description;

INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT s.tenant_id, r.id, p.id
FROM awcms_setup_state s
JOIN awcms_roles r
  ON r.tenant_id = s.tenant_id
 AND r.role_code = 'owner'
 AND r.deleted_at IS NULL
JOIN awcms_permissions p
  ON p.module_key = 'tenant_admin'
 AND p.activity_code = 'tenant_provisioning'
 AND p.action IN ('read', 'create')
WHERE s.id = true
  AND s.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM awcms_role_permissions existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
