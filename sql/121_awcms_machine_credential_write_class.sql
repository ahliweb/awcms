-- Gelombang 8 PR 8.5 (Issue #423), ADR-0092 — kredensial mesin boleh MENULIS,
-- dan plafonnya tetap di KODE.
--
-- ADR-0049 mengirim kredensial mesin yang hanya bisa membaca, ditahan satu
-- kalimat: `MACHINE_CREDENTIAL_ALLOWED_ACTIONS` memuat tepat satu nilai. PR ini
-- membuka kelas kedua — dan menjaga kalimat itu tetap yang memutuskan.
--
-- ## Plafonnya di KODE; kolomnya hanya bisa MENYEMPITKAN
--
-- Aksi yang boleh ditulis sebuah kredensial adalah
--
--     MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS  ∩  allowed_write_actions
--
-- dan urutan itu bukan gaya penulisan. Kalau daftar aksinya menjadi kolom
-- MURNI, satu restore backup, satu INSERT tangan, atau satu jalur provisioning
-- yang kehilangan `WHERE` bisa mencetak kredensial tulis se-katalog — dengan
-- setiap gerbang di repo ini hijau, karena tidak satu pun gerbang membaca isi
-- baris.
--
-- Kolomnya karena itu bukan sumber kebenaran. Ia daftar penyempit, dan himpunan
-- yang mungkin ditulisnya dibatasi sesuatu yang hanya berubah lewat commit yang
-- di-review.
--
-- ## Kredensial tulis WAJIB terikat IP, dan ketiadaan IP adalah DENY
--
-- CHECK di bawah menolak baris ber-`allowed_write_actions` tanpa
-- `allowed_ip_cidrs`. Aturan yang lebih halus hidup di gerbang: bila `clientIp`
-- TIDAK TERSEDIA, kredensial tulis ditolak. Kalau tidak, setiap rute yang belum
-- meneruskan alamat pemanggil diam-diam mematikan kondisinya — kontrol yang
-- terbaca sebagai ditegakkan dan sebenarnya tidak.
--
-- ## Umur 30 hari, bukan 365
--
-- Kredensial baca boleh hidup setahun (ADR-0049 §5); kredensial tulis tidak. Ia
-- bisa mengubah data, dan waktu sampai seseorang menyadari ia bocor diukur
-- dalam minggu. CHECK basis datanya 31 hari, dengan alasan yang sama seperti
-- `sql/117`: `created_at` DEFAULT `now()` adalah instant MULAI TRANSAKSI, jadi
-- "tepat 30" akan menolak baris yang benar-benar normal.
--
-- ## Sentinel lama DIPERTAHANKAN VERBATIM
--
-- `machine_credential_readonly` ada di sejarah decision log dan di ADR-0049.
-- Menggantinya menulis ulang masa lalu bagi konsumen log. Kelas tulis mendapat
-- sentinel BARU, tidak mendaur ulang yang lama.

BEGIN;

ALTER TABLE awcms_machine_credentials
  ADD COLUMN IF NOT EXISTS allowed_write_actions text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS allowed_ip_cidrs text[] NOT NULL DEFAULT '{}'::text[];

-- Sebuah kredensial tulis tanpa ikatan IP tidak boleh ada. Ditegakkan di sini
-- dan BUKAN hanya di TypeScript, karena penulis kedua adalah bagaimana kontrol
-- seperti ini menghilang.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_machine_credentials_write_requires_ip_check'
  ) THEN
    ALTER TABLE awcms_machine_credentials
      ADD CONSTRAINT awcms_machine_credentials_write_requires_ip_check
      CHECK (
        cardinality(allowed_write_actions) = 0
        OR cardinality(allowed_ip_cidrs) > 0
      );
  END IF;
END $$;

-- Plafon umur kelas tulis. Baris LAMA tidak tersentuh: `allowed_write_actions`
-- kosong pada semuanya, jadi cabang pertama CHECK ini benar untuk setiap baris
-- yang sudah ada — tidak ada validasi yang bisa gagal, dan tidak ada backfill.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_machine_credentials_write_lifetime_check'
  ) THEN
    ALTER TABLE awcms_machine_credentials
      ADD CONSTRAINT awcms_machine_credentials_write_lifetime_check
      CHECK (
        cardinality(allowed_write_actions) = 0
        OR expires_at <= created_at + interval '31 days'
      );
  END IF;
END $$;

-- Pertanyaan operasional yang dijawabnya: "kredensial mana di instalasi ini
-- yang bisa MENULIS". Parsial, karena hampir semuanya tidak bisa.
CREATE INDEX IF NOT EXISTS awcms_machine_credentials_write_class_idx
  ON awcms_machine_credentials (tenant_id, expires_at)
  WHERE cardinality(allowed_write_actions) > 0;

COMMENT ON COLUMN awcms_machine_credentials.allowed_write_actions IS
  'ADR-0092. Daftar PENYEMPIT, bukan sumber kebenaran: aksi efektif = MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS (kode) ∩ kolom ini. Kalau aksinya menjadi kolom murni, satu restore backup atau satu INSERT tangan bisa mencetak kredensial tulis se-katalog dengan setiap gerbang hijau. Kosong = kredensial baca-saja, yang merupakan setiap baris yang ada sebelum migrasi ini.';

COMMENT ON COLUMN awcms_machine_credentials.allowed_ip_cidrs IS
  'ADR-0092. WAJIB tidak kosong bila kredensialnya bisa menulis (CHECK). Gerbang menolak kredensial tulis ketika clientIp TIDAK TERSEDIA — kalau tidak, rute yang belum meneruskan alamat pemanggil diam-diam mematikan kondisinya.';

COMMIT;
