-- Gelombang 7 PR 7.4 (Issue #423), ADR-0088 — memilih tenant, dan berpindah.
--
-- Login tanpa `x-awcms-tenant-id` berhenti menjadi 400 dan menjadi
-- `409 MEMBERSHIP_SELECTION_REQUIRED` + token seleksi berumur ≤120 detik,
-- sekali pakai, yang ditukar menjadi sesi pada tenant yang DISEBUT PEMANGGIL.
--
-- ## Dua kolom, bukan tabel kelima
--
-- Token seleksi bisa saja mendapat tabelnya sendiri. Ia tidak, dan alasannya
-- bukan penghematan: satu baris PER PERCOBAAN LOGIN TANPA-TENANT adalah tabel
-- yang tumbuh mengikuti TRAFIK, sehingga ia menuntut deskriptor retensi, job
-- purge, hak DELETE untuk `awcms_worker`, entri registry lifecycle, dan entri
-- allow-list gerbang — seluruh perkakas itu untuk baris yang hidup 120 detik.
-- Dua kolom pada baris principal yang SUDAH ada tidak tumbuh sama sekali.
--
-- Satu token hidup per manusia. Meminta yang baru menimpa yang lama, preseden
-- `deletePendingFactors` pada enrolment MFA: hanya yang terakhir diterbitkan
-- yang boleh ditebus.
--
-- ## Kenapa hash-nya, dan bukan tokennya
--
-- Sama seperti `token_hash` sesi dan `code_hash` recovery: yang disimpan hanya
-- SHA-256 ber-namespace (`pt-sha256:`), jadi dump basis data tidak menghasilkan
-- bearer yang bisa dipakai. Namespace-nya bukan hiasan — ia yang membuat
-- gerbang otorisasi bisa mengenali JENIS bearer dari hash-nya saja dan menolak
-- token seleksi dengan 401 keras (ADR-0049 §4, ditiru persis).
--
-- ## `origin_auth` mendapat nilai keempatnya
--
-- `sql/100` menulis CHECK-nya dengan tiga nilai dan menyatakan alasannya:
-- "CHECK yang memuat nilai yang tak bisa diproduksi apa pun terbaca sebagai
-- kapabilitas yang sudah dikirim... satu ALTER dari sini begitu Gelombang 7
-- mendaratkannya." Ini ALTER itu.
--
-- Constraint barunya SUPERSET dari yang lama, jadi setiap baris hidup lolos
-- validasi tanpa perubahan data. `awcms_sessions` hanya memuat sesi yang belum
-- kedaluwarsa (TTL diukur dalam jam), jadi scan validasinya kecil — bukan tabel
-- ledger yang butuh NOT VALID + VALIDATE terpisah.

BEGIN;

-- 1. Token seleksi tenant, pada baris manusia yang sudah ada.
ALTER TABLE awcms_principals
  ADD COLUMN IF NOT EXISTS selection_token_hash text,
  ADD COLUMN IF NOT EXISTS selection_token_expires_at timestamptz;

-- Unik saat ada. Ini yang membuat pencarian `WHERE selection_token_hash = …`
-- mengikat SATU baris, dan karena itu memenuhi invarian bentuk-baca
-- `identity:principal-access:check` (ADR-0085 kontrol 2, diperluas satu
-- predikat oleh ADR-0088).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_principals_selection_token_key
  ON awcms_principals (selection_token_hash)
  WHERE selection_token_hash IS NOT NULL;

-- Keduanya hidup dan mati bersama. Sebuah hash tanpa kedaluwarsa adalah bearer
-- abadi; sebuah kedaluwarsa tanpa hash adalah baris yang tidak berarti apa-apa.
-- CHECK ini menutup keduanya sekaligus, di tempat satu-satunya yang tidak bisa
-- dilewati penulis mana pun.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_principals_selection_token_pairing_check'
  ) THEN
    ALTER TABLE awcms_principals
      ADD CONSTRAINT awcms_principals_selection_token_pairing_check
      CHECK (
        (selection_token_hash IS NULL AND selection_token_expires_at IS NULL)
        OR (selection_token_hash IS NOT NULL AND selection_token_expires_at IS NOT NULL)
      );
  END IF;
END $$;

-- 2. `origin_auth = 'switch'` — nilai keempat yang `sql/100` antisipasi.
ALTER TABLE awcms_sessions
  DROP CONSTRAINT IF EXISTS awcms_sessions_origin_auth_check;

ALTER TABLE awcms_sessions
  ADD CONSTRAINT awcms_sessions_origin_auth_check
  CHECK (origin_auth IN ('password', 'sso', 'handoff', 'switch'));

-- 3. Tidak ada GRANT baru. Penambahan kolom mewarisi hak tabelnya, dan
--    `awcms_principals` sudah tepat: SELECT/INSERT/UPDATE untuk `awcms_app`,
--    DELETE ditahan permanen (`sql/112`). Menerbitkan dan menebus token seleksi
--    keduanya UPDATE pada baris yang sudah ada — tidak ada verb baru yang
--    dibutuhkan, dan itu salah satu alasan bentuk dua-kolom ini dipilih.

COMMENT ON COLUMN awcms_principals.selection_token_hash IS
  'SHA-256 ber-namespace (pt-sha256:) dari token seleksi tenant sekali-pakai, ADR-0088. Diterbitkan oleh login TANPA header tenant dan ditebus oleh POST /api/v1/auth/session/tenant. Satu token hidup per manusia: menerbitkan yang baru menimpa yang lama. Ia BUKAN bearer sesi — gerbang otorisasi menolak hash ber-namespace ini dengan 401 keras.';

COMMENT ON COLUMN awcms_principals.selection_token_expires_at IS
  'Kedaluwarsa token seleksi, ≤120 detik sejak diterbitkan. Dipasangkan dengan hash-nya oleh CHECK: keduanya NULL atau keduanya terisi.';

COMMENT ON COLUMN awcms_sessions.origin_auth IS
  'How this session was issued: password | sso | handoff | switch. A step-up rotation CARRIES the original value forward — rotating a session does not re-authenticate it. `switch` is ADR-0088: a session minted by POST /api/v1/auth/session/switch, whose root is always a password (sso/handoff sessions are refused by the switch endpoint, so they can never become `switch`).';

COMMIT;
