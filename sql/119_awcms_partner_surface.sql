-- Gelombang 8 PR 8.4 (Issue #423) — permukaan kemitraan mendapat permission dan
-- pandangan partnernya.
--
-- Dua hal:
--
--   1. seed katalog permission `identity_access.partner_access.*`;
--   2. fungsi SECURITY DEFINER sempit yang menjawab satu pertanyaan partner —
--      "tenant mana yang saya kelola" — yang ADR-0089 sengaja tunda sampai ada
--      pemanggilnya.
--
-- ## Tiga aksi, dan kenapa bukan lima
--
-- `read`, `configure`, `assign`. Tidak ada `create` maupun `delete`.
--
-- Menyewa dan memutus kemitraan adalah dua arah dari SATU authority atas bentuk
-- tenant ini, dan `configure` sudah berarti itu — memisahkannya menjadi
-- `create`/`delete` akan membuat seseorang bisa menyewa partner tanpa bisa
-- memutusnya, yang persis kombinasi yang tidak boleh ada.
--
-- `assign` menggerbangi persetujuan grant, bukan `create`, karena yang
-- dikerjakan persetujuan itu adalah MEMBERI ROLE kepada orang luar. Itu authority
-- yang sudah punya nama di repo ini (ADR-0081, dan ADR-0082 mengulangnya untuk
-- undangan). Pencabutan grant memakai `assign` juga: memberi dan menarik kembali
-- adalah satu authority, dengan alasan yang sama seperti `configure` di atas.
--
-- Ketiganya `tenant` scope. Kemitraan adalah keputusan pelanggan tentang
-- tenantnya sendiri (ADR-0089), jadi `platform` justru akan salah — ia akan
-- memindahkan keputusan itu ke operator.
--
-- ## Jangkauan seed, dinyatakan seperti setiap migrasi permission sebelumnya
--
-- Ini memperluas katalog GLOBAL saja. Role `owner` tenant yang SUDAH ADA tidak
-- otomatis mendapatkannya — hanya tenant yang dibuat setelah migrasi ini yang
-- menerimanya dari bootstrap. Tenant hidup ditutup
-- `bun run identity-access:permissions:backfill`. Itu langkah deployment, bukan
-- efek samping migrasi.
--
-- ## Pandangan partner: preseden `sql/048`, EMPAT bagian bukan satu fungsi
--
-- `awcms_partner_managed_tenants` ber-RLS pada tenant TARGET (ADR-0089), jadi
-- partner tidak bisa membaca bukunya sendiri — asimetri yang disengaja:
-- pandangan pelanggan yang otoritatif.
--
-- Membalikkan itu dengan SECURITY DEFINER hanya aman bila keempat bagian
-- `sql/048` ada, karena di postur repo ini definer TIDAK mem-bypass RLS
-- (pemilik fungsi NON-superuser, NOBYPASSRLS):
--
--   1. role pemilik NOLOGIN tersendiri, tanpa anggota;
--   2. policy baca eksplisit ber-scope untuk role itu saja;
--   3. daftar kolom TETAP — batasnya kolomnya, bukan RLS-nya;
--   4. EXECUTE dicabut dari PUBLIC dan diberikan hanya ke `awcms_app`.
--
-- Ditambah satu batasan yang khas di sini dan tidak ada di `sql/048`: fungsinya
-- MENUNTUT `p_partner_tenant_id`, dan pemanggilnya mengisi itu dari konteks
-- tenant pemanggil — bukan dari input. Sebuah fungsi yang mengembalikan seluruh
-- tabel dan menyerahkan penyaringan ke TypeScript adalah direktori kemitraan
-- lintas-tenant dengan satu `WHERE` yang bisa dilupakan.
--
-- Yang dikembalikan hanyalah id dan nama tenant yang dikelola plus tanggal
-- keterlibatan. TIDAK `engaged_by_tenant_user_id`: partner tidak perlu tahu
-- siapa di pihak pelanggan yang menandatangani, dan itu identifier pihak ketiga.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'partner_access', 'read',
   'See which partners reach this tenant, and every delegated-access grant they hold'),
  ('identity_access', 'partner_access', 'configure',
   'Engage a partner for this tenant, and sever that engagement — audited'),
  ('identity_access', 'partner_access', 'assign',
   'Approve delegated access for a partner at a chosen role, and revoke it — audited')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

-- 1. Role pemilik: NOLOGIN, tanpa anggota, tak terjangkau selain sebagai definer
--    fungsi di bawah. Idempoten + cluster-scoped, pola `sql/048`/`sql/019`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_partner_view') THEN
    CREATE ROLE awcms_partner_view NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 2. Privilege minimum untuk badan fungsinya.
GRANT USAGE ON SCHEMA public TO awcms_partner_view;
GRANT SELECT ON awcms_partner_managed_tenants TO awcms_partner_view;
GRANT SELECT ON awcms_tenants TO awcms_partner_view;

-- 3. Policy baca eksplisit, HANYA untuk role itu. Permissive, jadi ia di-OR
--    dengan policy isolasi tenant `sql/116` dan tidak menggantikannya: SELECT
--    langsung `awcms_app` tetap fail-closed seperti sebelumnya.
CREATE POLICY awcms_partner_managed_tenants_partner_read
  ON awcms_partner_managed_tenants
  FOR SELECT
  TO awcms_partner_view
  USING (true);

CREATE OR REPLACE FUNCTION awcms_list_partner_managed_tenants(
  p_partner_tenant_id uuid
)
RETURNS TABLE (
  tenant_id uuid,
  tenant_code text,
  tenant_name text,
  tenant_status text,
  engaged_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    m.tenant_id,
    t.tenant_code,
    t.tenant_name,
    t.status AS tenant_status,
    m.engaged_at
  FROM awcms_partner_managed_tenants AS m
  JOIN awcms_tenants AS t ON t.id = m.tenant_id
  WHERE m.partner_tenant_id = p_partner_tenant_id
  ORDER BY m.engaged_at DESC;
$function$;

COMMENT ON FUNCTION awcms_list_partner_managed_tenants(uuid) IS
  'Pandangan partner atas bukunya sendiri (ADR-0089, PR 8.4). SECURITY DEFINER sempit dengan empat bagian pengaman sql/048: pemilik NOLOGIN awcms_partner_view tanpa anggota, policy FOR SELECT khusus role itu, daftar kolom tetap, EXECUTE hanya untuk awcms_app. Ia MENUNTUT partner_tenant_id dan pemanggilnya mengisinya dari konteks tenant — bukan dari input — karena fungsi yang mengembalikan seluruh tabel adalah direktori kemitraan lintas-tenant dengan satu WHERE yang bisa dilupakan. Tidak mengembalikan engaged_by_tenant_user_id: identifier pihak ketiga yang partner tidak perlu.';

-- 4. EXECUTE bukan bagian dari `ALTER DEFAULT PRIVILEGES` (yang hanya
--    tabel/sequence). Dicabut dari PUBLIC lalu diberikan hanya ke `awcms_app`,
--    dilakukan SELAGI migration owner masih memiliki fungsinya.
REVOKE ALL ON FUNCTION awcms_list_partner_managed_tenants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_list_partner_managed_tenants(uuid) TO awcms_app;

-- 5. Reassign supaya SECURITY DEFINER berjalan sebagai role itu. Menuntut
--    SUPERUSER saat migrasi — invarian yang sudah dituntut repo ini — dan
--    superuser me-reassign tanpa perlu keanggotaan, sehingga role-nya tetap
--    tanpa anggota.
ALTER FUNCTION awcms_list_partner_managed_tenants(uuid) OWNER TO awcms_partner_view;
