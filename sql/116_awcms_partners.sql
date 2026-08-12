-- Gelombang 8 PR 8.1 (Issue #423), ADR-0089 — partner adalah tenant biasa.
--
-- Dua tabel, dan keduanya mendarat TANPA SATU PUN PENULIS. Yang mereka
-- kirimkan adalah BENTUK: `ModulePermissionScope` tetap `tenant | platform`
-- karena jangkauan kemitraan dimodelkan sebagai data, dan data itu ada di sini.
--
--   `scope` mengatur siapa yang boleh MEMEGANG sebuah permission;
--   kemitraan mengatur OBJEK MANA yang disentuhnya.
--
-- Menyatukan keduanya menghasilkan permission yang dipegang dengan benar dan
-- dijalankan terhadap tenant yang salah — dan tidak satu pun policy RLS akan
-- keberatan, karena aktornya memang terautentikasi secara sah di suatu tempat.
--
-- ## Sisi mana yang memiliki tiap baris, dan mengapa itu pertanyaan pertama
--
-- Keduanya adalah relasi ANTARA DUA TENANT, sementara di bawah FORCE RLS sebuah
-- baris hanya punya SATU `tenant_id` yang policy-nya kenali. Menjawab salah
-- menghasilkan tabel yang hijau di setiap gerbang dan tak terbaca oleh pihak
-- yang justru harus membacanya:
--
--   `awcms_partners`                 → milik tenant PLATFORM.
--   `awcms_partner_managed_tenants`  → milik tenant TARGET (pelanggan).
--
-- Yang pertama DIPAKSA, bukan dipilih. Bentuk yang wajar dibayangkan lebih dulu
-- — satu baris ber-`tenant_id` tenant partner itu sendiri — tidak bisa ditulis
-- oleh siapa pun: tenant platform yang bertindak dengan `app.current_tenant_id`
-- = dirinya sendiri tidak dapat menyisipkan baris ber-`tenant_id` tenant lain,
-- dan satu-satunya sisa jalur adalah tenant partner mendaftarkan dirinya
-- sendiri. Jadi barisnya milik platform dan MENYEBUT tenant lain lewat
-- `partner_tenant_id` — bentuk yang sudah dipakai
-- `awcms_tenant_status_transitions.actor_tenant_id` (`sql/092`) sejak ADR-0054.
--
-- Yang kedua DIPILIH, dan alasannya asimetri yang disengaja: pelanggan wajib
-- bisa melihat dan mencabut setiap jangkauan ke dalam tenantnya tanpa meminta
-- izin siapa pun. Pandangan partner atas bukunya sendiri adalah kenyamanan,
-- bukan kontrol, dan dilayani fungsi SECURITY DEFINER sempit (preseden
-- `sql/048`) saat PR 8.4 memberinya pemanggil. Bentuk ketiga — satu baris di
-- tiap sisi — ditolak: setiap pencabutan harus menemukan keduanya, dan
-- kegagalannya senyap serta permanen.
--
-- ## FK menegakkan apa yang SELECT tidak boleh melihat
--
-- `awcms_partner_managed_tenants.partner_tenant_id` mereferensi
-- `awcms_partners (partner_tenant_id)`. Pemeriksaan foreign key MELEWATI RLS,
-- jadi pelanggan dapat menamai partner yang barisnya tidak akan pernah bisa ia
-- baca: basis data menolak baris yang menamai tenant yang bukan partner
-- terdaftar, tanpa memberi siapa pun kemampuan mengenumerasi daftar partner.
--
-- Bahwa FK melewati RLS biasanya BAHAYA di repo ini — ia yang menuntut FK
-- komposit ber-`tenant_id` pada tabel office (#149). Di sini justru itu yang
-- diinginkan. Perbedaannya ditulis supaya tidak "diperbaiki" oleh orang yang
-- mengenali polanya tetapi bukan alasannya.
--
-- Index unik pada `partner_tenant_id` sengaja GLOBAL, bukan
-- `(tenant_id, partner_tenant_id)`: satu registri partner, satu baris per
-- tenant partner, dan tidak ada duplikat di mana pun. Komposit akan memaksa FK
-- di tabel kedua menyebut id tenant platform, yang tidak diketahui — dan tidak
-- seharusnya diketahui — oleh baris milik pelanggan.
--
-- ## `status` dipatok ke satu nilai, persis alasan `sql/106` mematok `scope_type`
--
-- Kolomnya ada supaya pelebaran kelak adalah satu DROP/ADD CONSTRAINT (bentuk
-- ADR-0078, preseden ADR-0082), dan CHECK-nya ada karena mengirim partner yang
-- BISA di-suspend sebelum ada yang MEMBACA suspensi adalah kontrol yang terbaca
-- sebagai ditegakkan padahal tidak. PR 8.4 melebarkan CHECK ini di PR yang sama
-- dengan pembacanya, atau tidak sama sekali.
--
-- ## Tidak ada GRANT baru
--
-- Keduanya tabel tenant biasa dan mewarisi keempat verb dari
-- `ALTER DEFAULT PRIVILEGES` (`sql/019`), yang memang dituntut
-- `security:readiness` untuk setiap tabel `awcms_%` yang tidak terdaftar
-- sebagai global. Tidak ada yang perlu ditambahkan dan tidak ada yang boleh
-- dicabut: keduanya tenant-scoped justru supaya tidak menjadi tabel global
-- kelima.

BEGIN;

-- 1. awcms_partners — registri partner, milik tenant PLATFORM.
CREATE TABLE IF NOT EXISTS awcms_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  partner_tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  partner_code text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  registered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Dipatok. Lihat header.
  CONSTRAINT awcms_partners_status_active_only_check
    CHECK (status = 'active'),
  -- Tenant platform tidak boleh mendaftarkan DIRINYA SENDIRI sebagai partner.
  -- Kalau boleh, otoritas platform dan jangkauan kemitraan menjadi satu hal —
  -- persis peleburan yang seluruh ADR-0089 ada untuk mencegahnya.
  CONSTRAINT awcms_partners_not_self_check
    CHECK (partner_tenant_id <> tenant_id)
);

-- Satu baris per tenant partner, di seluruh instalasi. Ini juga target FK
-- tabel kedua, jadi ia unique INDEX yang berperan sebagai constraint.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_partners_partner_tenant_key
  ON awcms_partners (partner_tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_partners_partner_code_key
  ON awcms_partners (partner_code);

-- Jalur cursor mesin lifecycle (WHERE tenant_id = ? AND created_at < ?).
CREATE INDEX IF NOT EXISTS awcms_partners_tenant_created_idx
  ON awcms_partners (tenant_id, created_at);

ALTER TABLE awcms_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_partners FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_partners_tenant_isolation
  ON awcms_partners
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 2. awcms_partner_managed_tenants — jangkauan, milik tenant TARGET.
CREATE TABLE IF NOT EXISTS awcms_partner_managed_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  partner_tenant_id uuid NOT NULL,
  engaged_at timestamptz NOT NULL DEFAULT now(),
  engaged_by_tenant_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Sebuah tenant tidak bisa menyewa dirinya sendiri. Barisnya tidak berarti
  -- apa-apa, dan ia akan membuat cek "apakah partner ini mengelola tenant itu"
  -- di PR 8.4 menjawab BENAR untuk setiap tenant atas dirinya sendiri.
  CONSTRAINT awcms_partner_managed_tenants_not_self_check
    CHECK (partner_tenant_id <> tenant_id),
  -- Hanya partner TERDAFTAR yang bisa dinamai. Inilah FK yang menegakkan apa
  -- yang SELECT pelanggan tidak boleh melihat.
  CONSTRAINT awcms_partner_managed_tenants_partner_fkey
    FOREIGN KEY (partner_tenant_id)
    REFERENCES awcms_partners (partner_tenant_id),
  -- Yang menyewa adalah manusia di tenant ini, dibuktikan FK komposit sehingga
  -- id tenant user dari tenant lain tidak bisa dititipkan (#149).
  CONSTRAINT awcms_partner_managed_tenants_engaged_by_fkey
    FOREIGN KEY (tenant_id, engaged_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Satu keterlibatan hidup per pasangan. Penuh, bukan parsial: pencabutan adalah
-- DELETE (ADR-0089), jadi tidak ada baris mati yang perlu dilewati — dan itu
-- pula yang menjaga tabel ini `BOUNDED_BY_DESIGN`.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_partner_managed_tenants_pair_key
  ON awcms_partner_managed_tenants (tenant_id, partner_tenant_id);

-- Arah baca partner ("tenant mana yang saya kelola"), yang hanya bisa dipakai
-- fungsi SECURITY DEFINER PR 8.4 — index-nya mendarat bersama tabelnya karena
-- ia gratis dan menghindari migrasi kedua di jalur yang sama.
CREATE INDEX IF NOT EXISTS awcms_partner_managed_tenants_partner_idx
  ON awcms_partner_managed_tenants (partner_tenant_id);

CREATE INDEX IF NOT EXISTS awcms_partner_managed_tenants_tenant_created_idx
  ON awcms_partner_managed_tenants (tenant_id, created_at);

-- FK komposit penyewa. `db:fk-index:check` menuntutnya, dan alasan gerbang itu
-- ada berlaku di sini: menonaktifkan sebuah tenant user memindai tabel ini.
CREATE INDEX IF NOT EXISTS awcms_partner_managed_tenants_engaged_by_idx
  ON awcms_partner_managed_tenants (tenant_id, engaged_by_tenant_user_id);

ALTER TABLE awcms_partner_managed_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_partner_managed_tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_partner_managed_tenants_tenant_isolation
  ON awcms_partner_managed_tenants
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

COMMENT ON TABLE awcms_partners IS
  'ADR-0089. Registri partner, milik tenant PLATFORM: barisnya ber-tenant_id tenant platform dan MENYEBUT tenant lain lewat partner_tenant_id. Bentuk "satu baris di tenant partner sendiri" tidak bisa ditulis siapa pun di bawah FORCE RLS. Mendarat tanpa penulis; penulisnya adalah permission ber-scope platform di PR 8.4.';

COMMENT ON COLUMN awcms_partners.partner_tenant_id IS
  'Tenant yang MERUPAKAN partner. Unik secara global — satu registri, satu baris per partner — dan menjadi target FK awcms_partner_managed_tenants, yang karenanya menolak setiap tenant yang bukan partner terdaftar tanpa pernah memberi pelanggan kemampuan membaca daftarnya.';

COMMENT ON COLUMN awcms_partners.status IS
  'Dipatok ''active'' oleh awcms_partners_status_active_only_check. Kolomnya ada supaya pelebaran kelak satu DROP/ADD CONSTRAINT (bentuk ADR-0078); CHECK-nya ada karena partner yang bisa di-suspend sebelum ada yang MEMBACA suspensi adalah kontrol yang terbaca sebagai ditegakkan padahal tidak. Preseden awcms_invitation_policies.scope_type (sql/106).';

COMMENT ON TABLE awcms_partner_managed_tenants IS
  'ADR-0089. Jangkauan partner ke sebuah tenant, milik tenant TARGET supaya pelanggan bisa melihat dan mencabutnya tanpa meminta izin siapa pun. Pencabutan adalah DELETE — pemetaan yang di-soft-delete adalah baris yang bisa dihidupkan kembali satu bug, dan riwayatnya sudah dijawab awcms_audit_events. BUKAN tabel grant: activeRoleGrants (ADR-0079) tidak membacanya dan tidak boleh diajari; pembacanya di PR 8.4 hanya boleh MENYEMPITKAN, tidak pernah menghasilkan allowed: true.';

COMMIT;
