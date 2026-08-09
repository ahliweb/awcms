-- 092_awcms_tenant_lifecycle.sql — Issue #429 / ADR-0073.
--
-- `awcms_tenants.status` menerima 'suspended' sejak `sql/002`. Nilai itu dibaca
-- di jalur login/reset/registrasi/SSO-start dan di resolver host publik —
-- dan TIDAK PERNAH di `authorizeInTransaction`.
--
-- Akibatnya asimetris ke arah yang salah: situs publik tenant mati seketika,
-- sementara sesi admin yang sudah terbit tetap penuh akses sampai kedaluwarsa
-- sendiri, dan machine credential (umur sampai 365 hari) tidak tersentuh sama
-- sekali. Pelanggan yang ditangguhkan kehilangan hal yang dilihat pengunjungnya
-- dan mempertahankan hal yang bisa mengubah datanya.
--
-- Migrasi ini menambahkan JEJAKNYA; penegakannya ada di kode
-- (`access-guard.ts`), karena gerbang yang diputuskan dari deklarasi sisi-kode
-- tidak bisa diangkat oleh satu UPDATE basis data — alasan yang sama dipakai
-- ADR-0053 untuk gerbang platform-scope.
--
-- Catatan penomoran: `sql/091` dipakai PR #436 (ADR-0072) yang belum merge saat
-- berkas ini ditulis. Kalau urutannya berubah, berkas ini yang dinomori ulang.

ALTER TABLE awcms_tenants
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text;

-- Catatan transisi status, append-only. Ia menjawab "kapan, oleh siapa, kenapa"
-- untuk sebuah tindakan yang mematikan layanan sebuah pelanggan.
--
-- Ber-RLS pada `tenant_id` dan karena itu terlihat oleh tenant YANG BERSANGKUTAN:
-- pelanggan yang ditangguhkan berhak melihat alasannya. Pembacaan lintas-tenant
-- oleh operator platform berjalan lewat permukaan platform-scoped, bukan dengan
-- melonggarkan policy ini.
CREATE TABLE IF NOT EXISTS awcms_tenant_status_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason text,
  -- Aktornya adalah tenant user milik tenant PLATFORM, bukan tenant target,
  -- jadi composite FK ber-`tenant_id` ke `awcms_tenant_users` justru akan salah
  -- di sini: ia akan menuntut aktornya anggota tenant yang ditangguhkan.
  -- Disimpan tanpa FK, sama seperti `awcms_audit_events.actor_tenant_user_id`.
  actor_tenant_user_id uuid,
  actor_tenant_id uuid REFERENCES awcms_tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_tenant_status_transitions_changed_check
    CHECK (from_status <> to_status)
);

CREATE INDEX IF NOT EXISTS awcms_tenant_status_transitions_tenant_created_idx
  ON awcms_tenant_status_transitions (tenant_id, created_at DESC);

-- ADR-0064 — tiap kolom FK wajib terjangkau index.
CREATE INDEX IF NOT EXISTS awcms_tenant_status_transitions_actor_tenant_idx
  ON awcms_tenant_status_transitions (actor_tenant_id);

ALTER TABLE awcms_tenant_status_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_tenant_status_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_tenant_status_transitions_tenant_isolation
  ON awcms_tenant_status_transitions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Dua permission ber-scope PLATFORM (ADR-0053): menangguhkan sebuah tenant
-- mengubah keadaan PIHAK LAIN, jadi ia tidak boleh bisa dipegang oleh tenant
-- biasa mana pun — penalaran yang sama dipakai ADR-0054 §2 untuk provisioning.
INSERT INTO awcms_permissions (module_key, activity_code, action, description, scope)
VALUES
  ('tenant_admin', 'tenant_lifecycle', 'disable',
   'Suspend a tenant: stop serving it, refuse its live sessions and machine credentials', 'platform'),
  ('tenant_admin', 'tenant_lifecycle', 'restore',
   'Lift a tenant suspension and resume service', 'platform')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

-- Berikan keduanya ke role `owner` tenant SETUP, mengikuti pola `sql/086`.
-- Anti-join, bukan INSERT polos: migrasi ini harus idempoten dan tidak boleh
-- menggandakan grant yang sudah ada.
--
-- Deployment yang tenant platform-nya BUKAN tenant setup (PLATFORM_TENANT_ID
-- menunjuk ke tempat lain) tidak terjangkau di sini — itu jebakan yang sudah
-- tercatat di `identity-access/domain/owner-permission-backfill.ts`, dan catatan
-- rilisnya menyebut `bun run identity-access:permissions:backfill`.
INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM awcms_setup_state s
JOIN awcms_roles r
  ON r.tenant_id = s.tenant_id AND r.role_code = 'owner' AND r.deleted_at IS NULL
JOIN awcms_permissions p
  ON p.module_key = 'tenant_admin'
 AND p.activity_code = 'tenant_lifecycle'
 AND p.action IN ('disable', 'restore')
WHERE NOT EXISTS (
  SELECT 1 FROM awcms_role_permissions rp
  WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_id = p.id
);
