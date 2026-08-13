-- ADR-0089 — permission PLATFORM untuk registri partner.
--
-- `sql/116` membuat `awcms_partners` dan sengaja tidak memberinya penulis:
-- barisnya hanya bisa dibuat operator lewat psql. Migrasi ini menyeed izin yang
-- digerbangi `GET`/`POST /api/v1/partners`, permukaan pertama yang bisa
-- menulisnya.
--
-- ## Kenapa keduanya `platform`, bukan `tenant`
--
-- `partner_registry.create` menyatakan siapa yang BOLEH MENJADI partner di
-- deployment ini. Itu bukan aksi sebuah tenant atas datanya sendiri, dan
-- ADR-0089 memisahkannya dengan sengaja dari `partner_access.configure`
-- (tenant-scoped, ditulis PELANGGAN, "partner mana yang menjangkau tenant
-- SAYA"). Menyatukannya memberi satu aktor kedua paruh — peleburan yang seluruh
-- ADR itu ada untuk mencegahnya.
--
-- `partner_registry.read` mendaftar SELURUH partner. Versi tenant-scoped-nya
-- adalah persis artefak yang ADR-0089 §Ditolak sebut sebagai "direktori setiap
-- kemitraan komersial di instalasi ini, terbaca oleh setiap tenant" — dibangun
-- ulang sebagai permission alih-alih sebagai tabel global.
--
-- Karena keduanya `scope = 'platform'`, `createTenantWithOwner` dan job
-- backfill owner (keduanya menyaring `WHERE scope = 'tenant'`) tidak akan
-- pernah memberikannya ke tenant mana pun — termasuk tenant partner itu
-- sendiri. Sifat itulah yang membuat registri tidak bisa dibaca oleh yang
-- terdaftar di dalamnya.
--
-- ## Grant
--
-- Sama seperti `sql/086`: ke role `owner` milik `awcms_setup_state.tenant_id`,
-- dan hanya itu. Bentuk yang terbaca "lebih rapi" — grant yang berjalan di atas
-- `awcms_tenants` — adalah cacat asli yang ADR-0053 tutup, dan gerbang
-- `tests/platform-scoped-permissions.test.ts` menolaknya secara mekanis.
--
-- Deployment yang mengarahkan `PLATFORM_TENANT_ID` ke tenant lain memberikannya
-- sendiri; `bun run security:readiness` melaporkan ketidakcocokan itu alih-alih
-- membiarkannya ditemukan lewat 403.
--
-- ## Tidak ada perubahan skema
--
-- `awcms_partners` sudah lengkap sejak `sql/116`, dan berkas itu SUDAH TERAPAN
-- — menyuntingnya, bahkan komentarnya, memblokir `db:migrate` pada deployment
-- yang berjalan. CHECK `status = 'active'` juga TIDAK dilebarkan di sini:
-- pelebarannya hanya boleh terjadi di PR yang sama dengan PEMBACA suspensi,
-- kalau tidak ia adalah kontrol yang terbaca sebagai ditegakkan padahal tidak.
--
-- Idempotent: `ON CONFLICT` pada kunci natural, dan grant-nya anti-join.

INSERT INTO awcms_permissions (module_key, activity_code, action, description, scope)
VALUES
  ('identity_access', 'partner_registry', 'read',
   'PLATFORM: list every partner registered on the deployment',
   'platform'),
  ('identity_access', 'partner_registry', 'create',
   'PLATFORM: register an existing tenant as a partner — audited. Grants nothing; it is the precondition a customer''s engagement checks',
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
  ON p.module_key = 'identity_access'
 AND p.activity_code = 'partner_registry'
 AND p.action IN ('read', 'create')
WHERE s.id = true
  AND s.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM awcms_role_permissions existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
