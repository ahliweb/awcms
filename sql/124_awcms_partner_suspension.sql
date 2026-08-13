-- ADR-0093 (Issue #543) — CHECK `status` dilebarkan, DI PR YANG SAMA dengan
-- pembacanya.
--
-- Header `sql/116` menuliskan syaratnya sendiri: "PR 8.4 melebarkan CHECK ini
-- di PR yang sama dengan pembacanya, atau tidak sama sekali". Mengirim partner
-- yang BISA di-suspend sebelum ada yang MEMBACA suspensi adalah kontrol yang
-- terbaca sebagai ditegakkan padahal tidak — bentuk yang sama yang `sql/106`
-- pakai untuk `scope_type`. Migrasi ini mendarat bersama tiga pembaca:
-- chokepoint, penyewaan kemitraan, dan predikat di dalam INSERT grant.
--
-- ## Empat bagian
--
--   1. CHECK dilebarkan ke DUA nilai persis — bukan dibuka;
--   2. policy baca untuk role definer, dan fungsi SECURITY DEFINER sempit yang
--      menjawab satu pertanyaan;
--   3. seed dua permission PLATFORM;
--   4. grant keduanya ke `owner` tenant platform, anti-join seperti `sql/123`.
--
-- ## Kenapa fungsi, dan bukan sekadar SELECT
--
-- `awcms_partners` milik tenant PLATFORM dan ber-FORCE RLS. Chokepoint berjalan
-- di tenant PELANGGAN dan TIDAK BISA membaca tabel itu. Rencana yang
-- mengandaikan sebaliknya adalah jebakan yang sudah memakan dua gelombang
-- berturut-turut (ADR-0087 dan ADR-0088 sama-sama merencanakan pembacaan
-- lintas-tenant yang RLS larang), dan header `sql/116` sudah mengantisipasi
-- jalan keluarnya: fungsi SECURITY DEFINER sempit, preseden `sql/048`.
--
-- Keempat pengaman `sql/048`/`sql/119` berlaku, dengan role pemilik yang SAMA
-- (`awcms_partner_view` — NOLOGIN, tanpa anggota, sudah ada sejak `sql/119`):
--
--   1. role pemilik NOLOGIN tersendiri, tanpa anggota;
--   2. policy baca eksplisit ber-scope untuk role itu saja;
--   3. batas yang KETAT — di sini bukan daftar kolom melainkan sebuah `text`:
--      fungsinya mengembalikan STATUS, bukan baris, jadi tidak ada kolom
--      registri lain yang bisa lewat dan tidak ada `WHERE` yang bisa dilupakan
--      pemanggilnya;
--   4. EXECUTE dicabut dari PUBLIC dan diberikan hanya ke `awcms_app`.
--
-- Ia tetap bukan direktori: pemanggilnya WAJIB menyebut satu
-- `partner_tenant_id`, dan chokepoint mengisinya dari baris grant milik
-- pelanggan itu sendiri — tenant yang tidak punya grant tidak punya id untuk
-- ditanyakan, dan menebak satu hanya mengembalikan `NULL` atau `'active'` untuk
-- tenant yang sudah bisa ia ketahui adalah partnernya.
--
-- ## `NULL` berarti MENOLAK
--
-- Tidak ada baris registri diperlakukan sama dengan tersuspensi. Itu tak
-- terjangkau hari ini — FK `sql/120` menuntut partner terdaftar selama ada
-- grant — dan justru karena tak terjangkau, memilih fail-closed tidak bisa
-- mematahkan apa pun yang sedang berjalan.
--
-- ## Jangkauan seed
--
-- Ini memperluas katalog GLOBAL saja, seperti `sql/123`. Role `owner` tenant
-- yang SUDAH ADA tidak otomatis mendapatkannya; tenant hidup ditutup
-- `bun run identity-access:permissions:backfill`.
--
-- Idempotent: CHECK di-DROP dulu, policy/fungsi dijaga `IF NOT EXISTS` /
-- `CREATE OR REPLACE`, seed ber-`ON CONFLICT`, grant anti-join.

BEGIN;

-- 1. CHECK dilebarkan ke dua nilai persis. Nilai ketiga kelak adalah satu
--    DROP/ADD CONSTRAINT lagi, di PR yang sama dengan pembacanya — aturan
--    `sql/116` berlaku untuk dirinya sendiri.
ALTER TABLE awcms_partners
  DROP CONSTRAINT IF EXISTS awcms_partners_status_active_only_check;

ALTER TABLE awcms_partners
  ADD CONSTRAINT awcms_partners_status_check
  CHECK (status IN ('active', 'suspended'));

COMMENT ON COLUMN awcms_partners.status IS
  'ADR-0093. ''active'' atau ''suspended''. Suspensi MENGHENTIKAN jangkauan yang sedang berjalan (chokepoint, bukan job) dan TIDAK menyentuh satu baris grant pun: grant adalah catatan siapa yang pernah bisa melihat data pelanggan, dan sql/120 sengaja membuatnya hidup lebih lama dari kemitraannya. Keberlakuan dihitung, tidak disimpan.';

-- 2. Policy baca untuk role definer saja. Permissive, jadi ia di-OR dengan
--    policy isolasi tenant `sql/116` dan tidak menggantikannya: SELECT langsung
--    oleh `awcms_app` tetap fail-closed persis seperti sebelumnya.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'awcms_partners'
      AND policyname = 'awcms_partners_partner_view_read'
  ) THEN
    CREATE POLICY awcms_partners_partner_view_read
      ON awcms_partners
      FOR SELECT
      TO awcms_partner_view
      USING (true);
  END IF;
END
$$;

GRANT SELECT ON awcms_partners TO awcms_partner_view;

CREATE OR REPLACE FUNCTION awcms_partner_registry_status(
  p_partner_tenant_id uuid
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT p.status
  FROM awcms_partners AS p
  WHERE p.partner_tenant_id = p_partner_tenant_id;
$function$;

COMMENT ON FUNCTION awcms_partner_registry_status(uuid) IS
  'ADR-0093. Satu pertanyaan: apa status registri partner ini. SECURITY DEFINER sempit dengan pengaman sql/048 dan pemilik yang sama seperti sql/119 (awcms_partner_view, NOLOGIN, tanpa anggota). Mengembalikan TEKS, bukan baris, sehingga tidak ada kolom registri lain yang bisa lewat. NULL berarti tidak terdaftar, dan pemanggilnya WAJIB memperlakukannya sama dengan tersuspensi.';

REVOKE ALL ON FUNCTION awcms_partner_registry_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_partner_registry_status(uuid) TO awcms_app;

-- Reassign supaya SECURITY DEFINER berjalan sebagai role itu. Menuntut
-- SUPERUSER saat migrasi — invarian yang sudah dituntut repo ini.
ALTER FUNCTION awcms_partner_registry_status(uuid) OWNER TO awcms_partner_view;

-- 3. Dua permission PLATFORM. `disable`/`restore` dipakai ulang, bukan
--    `suspend`/`reinstate` baru: keduanya sudah ada di `AccessAction`, dan
--    `tenant_admin.tenant_lifecycle` memakai pasangan yang sama untuk tindakan
--    yang sama bentuknya.
INSERT INTO awcms_permissions (module_key, activity_code, action, description, scope)
VALUES
  ('identity_access', 'partner_registry', 'disable',
   'PLATFORM: suspend a registered partner — every delegated actor it placed stops being served immediately, and no grant row is touched',
   'platform'),
  ('identity_access', 'partner_registry', 'restore',
   'PLATFORM: reinstate a suspended partner — the grants that survived start applying again',
   'platform')
ON CONFLICT (module_key, activity_code, action) DO UPDATE
  SET scope = EXCLUDED.scope,
      description = EXCLUDED.description;

-- 4. Grant ke role `owner` milik `awcms_setup_state.tenant_id`, dan hanya itu.
--    Bentuk yang terbaca "lebih rapi" — grant yang berjalan di atas
--    `awcms_tenants` — adalah cacat asli yang ADR-0053 tutup.
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
 AND p.action IN ('disable', 'restore')
WHERE s.id = true
  AND s.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM awcms_role_permissions existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );

COMMIT;
