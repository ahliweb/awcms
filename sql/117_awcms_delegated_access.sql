-- Gelombang 8 PR 8.2 (Issue #423), ADR-0090 — akses terdelegasi mencetak
-- TENANT USER SUNGGUHAN.
--
-- Sebuah grant yang ditebus tidak menghasilkan aktor jenis baru. Ia
-- menghasilkan baris `awcms_tenant_users` biasa di tenant target, terikat role
-- yang DIPILIH PELANGGAN, dengan tanggal mati. Itulah seluruh idenya: RLS,
-- decision log, audit, SoD, dan business-scope facts bekerja TANPA SATU PUN
-- PERUBAHAN, karena aktornya memang benar-benar tenant user di sana.
--
-- Presedennya ADR-0050: artefak ber-hash berumur pendek yang MENCETAK sesi
-- segar, bukan kredensial hidup yang disimpan lalu dipinjamkan.
--
-- ## Tidak ada role `support` yang ditanam platform
--
-- Rencana Gelombang 8 menulis "terikat role `support` terbatas". Role di repo
-- ini adalah baris PER-TENANT (`awcms_roles`), dan satu-satunya role sistem
-- yang ditanam adalah `owner` (`platform-bootstrap.ts`). Menanam `support` ke
-- setiap tenant menuntut seed MIGRATION plus BACKFILL — seed hanya menjangkau
-- tenant yang dibuat sesudahnya, dan tenant lama akan diam-diam 403 — dan,
-- lebih buruk, ia menuntut platform memutuskan apa yang boleh disentuh partner
-- DI DALAM tenant orang lain.
--
-- `role_id` di sini menunjuk role yang SUDAH ADA di tenant target. Pelanggan
-- memilih, seperti pelanggan memilih siapa partnernya (ADR-0089). Tidak ada
-- seed, tidak ada backfill, dan tidak ada keputusan platform tentang isi tenant
-- orang lain.
--
-- ## `principal_kind` pada `awcms_tenant_users`, dan mengapa DI SANA
--
-- Gerbang "aktor terdelegasi tidak boleh menulis otoritas" harus bisa dijawab
-- oleh SETIAP jalur yang sampai ke chokepoint. Ada dua: satu lewat sesi
-- (`resolveTenantPrincipal`) dan satu lewat tenant user langsung
-- (`resolveTenantPrincipalForTenantUser`). Menyandarkannya pada
-- `awcms_sessions.origin_auth` akan membuat jalur kedua TIDAK TERGERBANGI, dan
-- kegagalannya senyap — kelas "penulis pindah, pembacanya tidak" (ADR-0079).
--
-- Kolom ini ada di baris yang KEDUA jalur itu sudah SELECT, jadi gerbangnya
-- gratis dan tidak bisa dilewati. Ia juga write-once: sebuah tenant user
-- terdelegasi lahir terdelegasi dan tidak pernah berubah menjadi anggota biasa
-- — jadi tidak ada kewajiban penulis kedua yang bisa hanyut.
--
-- Nilainya `user | delegated`. `machine` sengaja TIDAK di sini meski atribut
-- ABAC `subject.principalKind` yang direncanakan program memuat ketiganya:
-- kredensial mesin bukan tenant user, jenisnya dibawa namespace hash-nya
-- (ADR-0049), dan menyalinnya ke sini akan menciptakan sumber kedua yang bisa
-- berbeda pendapat.
--
-- ## Plafon TTL punya kelonggaran satu hari, dan itu disengaja
--
-- `created_at` DEFAULT `now()` adalah instant MULAI TRANSAKSI, sementara
-- `expires_at` dihitung jam APLIKASI yang selalu belakangan. CHECK "tepat 30
-- hari" karena itu akan MENOLAK baris yang benar-benar normal — jebakan yang
-- sudah pernah menggigit repo ini. Plafon basis data 31 hari, plafon aplikasi
-- 30 hari (`DELEGATED_ACCESS_MAX_TTL_DAYS`); yang pertama menangkap penulis
-- yang lupa, yang kedua adalah aturannya.
--
-- ## `origin_auth` mendapat nilai kelimanya
--
-- `sql/115` menambahkan `switch` dan menyisakan pola yang sama: sebuah nilai
-- ditambahkan ke CHECK pada PR yang bisa MEMPRODUKSINYA. Sesi terdelegasi
-- membawa `delegated`, dan `POST /auth/session/switch` menolaknya bersama
-- `sso`/`handoff` — sesi yang lahir dari kredensial GLOBAL boleh berpindah,
-- sesi yang lahir dari kuasa satu tenant tidak. Sebuah grant untuk tenant C
-- yang bisa berpindah ke tenant D adalah pelanggaran yang setiap langkahnya
-- terlihat sah.

BEGIN;

-- 1. Jenis aktor, pada baris yang setiap pembaca sudah menyentuhnya.
ALTER TABLE awcms_tenant_users
  ADD COLUMN IF NOT EXISTS principal_kind text NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_tenant_users_principal_kind_check'
  ) THEN
    ALTER TABLE awcms_tenant_users
      ADD CONSTRAINT awcms_tenant_users_principal_kind_check
      CHECK (principal_kind IN ('user', 'delegated'));
  END IF;
END $$;

-- 2. Grant, milik tenant TARGET (ADR-0089 §"sisi mana yang memiliki").
CREATE TABLE IF NOT EXISTS awcms_delegated_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  partner_tenant_id uuid NOT NULL,
  role_id uuid NOT NULL,
  approved_by_tenant_user_id uuid NOT NULL,
  purpose text NOT NULL,
  access_code_hash text,
  granted_tenant_user_id uuid,
  redeemed_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_tenant_user_id uuid,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Berumur, dan terbatas. Kelonggaran satu hari dijelaskan di header.
  CONSTRAINT awcms_delegated_access_grants_ttl_check
    CHECK (expires_at > created_at
           AND expires_at <= created_at + interval '31 days'),

  -- Sebelum ditebus: ada kode, belum ada tenant user. Sesudah: kebalikannya,
  -- dan kodenya HILANG dari baris. Tanpa pasangan ini sebuah baris bisa
  -- mengklaim penebusan tanpa keanggotaan di belakangnya, atau menyimpan kode
  -- hidup untuk grant yang sudah dipakai.
  CONSTRAINT awcms_delegated_access_grants_redemption_check
    CHECK (
      (access_code_hash IS NOT NULL
        AND granted_tenant_user_id IS NULL AND redeemed_at IS NULL)
      OR
      (access_code_hash IS NULL
        AND granted_tenant_user_id IS NOT NULL AND redeemed_at IS NOT NULL)
    ),

  -- Pencabutan oleh manusia menyebut manusianya; kedaluwarsa tidak menyebut
  -- siapa-siapa. Yang dilarang hanyalah aktor tanpa waktu.
  CONSTRAINT awcms_delegated_access_grants_revoked_check
    CHECK (revoked_by_tenant_user_id IS NULL OR revoked_at IS NOT NULL),

  -- Sebuah grant hanya bisa ada di tempat kemitraannya ada. Kalau pelanggan
  -- memutus kemitraannya, FK ini yang membuat "grant yatim" mustahil.
  CONSTRAINT awcms_delegated_access_grants_engagement_fkey
    FOREIGN KEY (tenant_id, partner_tenant_id)
    REFERENCES awcms_partner_managed_tenants (tenant_id, partner_tenant_id),

  CONSTRAINT awcms_delegated_access_grants_role_fkey
    FOREIGN KEY (tenant_id, role_id)
    REFERENCES awcms_roles (tenant_id, id),

  CONSTRAINT awcms_delegated_access_grants_approved_by_fkey
    FOREIGN KEY (tenant_id, approved_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),

  CONSTRAINT awcms_delegated_access_grants_granted_user_fkey
    FOREIGN KEY (tenant_id, granted_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),

  CONSTRAINT awcms_delegated_access_grants_revoked_by_fkey
    FOREIGN KEY (tenant_id, revoked_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Kode penebusan unik SAAT ADA, sehingga `WHERE access_code_hash = …` mengikat
-- satu baris dan penebusan bisa berupa compare-and-swap (ADR-0088 memakai
-- bentuk yang sama untuk token seleksi).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_delegated_access_grants_code_key
  ON awcms_delegated_access_grants (access_code_hash)
  WHERE access_code_hash IS NOT NULL;

-- Satu tenant user terdelegasi melayani satu grant. Tanpa ini sebuah baris
-- keanggotaan bisa dipakai ulang oleh grant kedua dan hidup melewati
-- pencabutan grant pertama.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_delegated_access_grants_tenant_user_key
  ON awcms_delegated_access_grants (granted_tenant_user_id)
  WHERE granted_tenant_user_id IS NOT NULL;

-- Pandangan pelanggan: "siapa yang menjangkau tenant saya, sekarang".
CREATE INDEX IF NOT EXISTS awcms_delegated_access_grants_live_idx
  ON awcms_delegated_access_grants (tenant_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_delegated_access_grants_partner_idx
  ON awcms_delegated_access_grants (tenant_id, partner_tenant_id);

CREATE INDEX IF NOT EXISTS awcms_delegated_access_grants_role_idx
  ON awcms_delegated_access_grants (tenant_id, role_id);

CREATE INDEX IF NOT EXISTS awcms_delegated_access_grants_approved_by_idx
  ON awcms_delegated_access_grants (tenant_id, approved_by_tenant_user_id);

CREATE INDEX IF NOT EXISTS awcms_delegated_access_grants_revoked_by_idx
  ON awcms_delegated_access_grants (tenant_id, revoked_by_tenant_user_id)
  WHERE revoked_by_tenant_user_id IS NOT NULL;

-- Jalur cursor mesin lifecycle (WHERE tenant_id = ? AND created_at < ?).
CREATE INDEX IF NOT EXISTS awcms_delegated_access_grants_tenant_created_idx
  ON awcms_delegated_access_grants (tenant_id, created_at);

ALTER TABLE awcms_delegated_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_delegated_access_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_delegated_access_grants_tenant_isolation
  ON awcms_delegated_access_grants
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 3. `origin_auth = 'delegated'` — nilai kelima.
ALTER TABLE awcms_sessions
  DROP CONSTRAINT IF EXISTS awcms_sessions_origin_auth_check;

ALTER TABLE awcms_sessions
  ADD CONSTRAINT awcms_sessions_origin_auth_check
  CHECK (origin_auth IN ('password', 'sso', 'handoff', 'switch', 'delegated'));

COMMENT ON COLUMN awcms_tenant_users.principal_kind IS
  'ADR-0090: user | delegated. Write-once — sebuah keanggotaan terdelegasi lahir terdelegasi dan tidak pernah menjadi anggota biasa. Ditaruh di sini, bukan di awcms_sessions, supaya KEDUA jalur resolusi konteks (sesi dan tenant-user langsung) menggerbanginya tanpa query tambahan. `machine` sengaja tidak ada: kredensial mesin bukan tenant user dan jenisnya dibawa namespace hash-nya (ADR-0049).';

COMMENT ON TABLE awcms_delegated_access_grants IS
  'ADR-0090. Grant akses terdelegasi, milik tenant TARGET. Menebusnya mencetak awcms_tenant_users biasa ber-principal_kind=delegated yang terikat role PILIHAN PELANGGAN — bukan role `support` yang ditanam platform, yang akan menuntut seed+backfill dan menyerahkan isi tenant orang lain kepada platform. Pencabutan dan kedaluwarsa menonaktifkan keanggotaan itu dan mencabut sesinya DI TRANSAKSI YANG SAMA (pola setTenantUserStatus).';

COMMENT ON COLUMN awcms_delegated_access_grants.access_code_hash IS
  'SHA-256 ber-namespace dari kode penebusan sekali-pakai, ADR-0050 sebagai preseden. NULL sesudah ditebus, dipasangkan dengan granted_tenant_user_id oleh CHECK: sebuah grant tidak boleh menyimpan kode hidup untuk keanggotaan yang sudah dicetak.';

COMMENT ON COLUMN awcms_delegated_access_grants.role_id IS
  'Role yang SUDAH ADA di tenant target, dipilih pelanggan. Inilah kontrol utama atas apa yang bisa disentuh partner; yang TIDAK bisa didelegasikan sebuah role adalah otoritas access-control, karena ia menciptakan kuasa yang hidup melewati grant — itu ditolak gerbang deny-only di chokepoint, bukan oleh pilihan role.';

COMMIT;
