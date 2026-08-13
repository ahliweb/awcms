-- Gelombang 8 PR 8.3 (Issue #423), ADR-0091 — atribusi DUA SISI.
--
-- Sejak ADR-0090 seorang manusia bisa bertindak di dalam tenant C sementara ia
-- bekerja untuk tenant X. Setiap catatan yang dihasilkan tindakan itu hanya
-- menyebut SATU sisinya: `actor_tenant_user_id` menunjuk baris keanggotaan di
-- tenant C, dan tidak ada apa pun di baris itu yang mengatakan bahwa orangnya
-- datang dari luar.
--
-- Tiga kolom menutup itu:
--
--   awcms_audit_events.actor_tenant_id       — tenant ASAL si aktor
--   awcms_audit_events.delegated_grant_id    — grant yang membuatnya bisa ada
--   awcms_abac_decision_logs.delegated_grant_id  — sama, untuk setiap keputusan
--
-- ## `actor_tenant_id` NULL berarti "dari dalam", bukan "tidak diketahui"
--
-- Menuliskannya untuk setiap baris akan menjadikannya duplikat `tenant_id` pada
-- 99,9% baris, dan kolom yang hampir selalu sama dengan tetangganya berhenti
-- dibaca. NULL adalah kasus biasa; terisi berarti aktornya berasal dari tenant
-- LAIN, dan itulah baris yang dicari sebuah investigasi.
--
-- Bentuknya sudah dipakai `awcms_tenant_status_transitions.actor_tenant_id`
-- (`sql/092`, ADR-0054) sejak provisioning — PR ini memakai bentuk yang sudah
-- ada, bukan menciptakan yang kedua.
--
-- ## FK grant-nya KOMPOSIT, dan itu bukan gaya
--
-- `(tenant_id, delegated_grant_id)` → `awcms_delegated_access_grants
-- (tenant_id, id)`. FK sederhana pada `id` saja akan melewati RLS (seperti
-- setiap FK) dan menerima id grant milik TENANT LAIN — sebuah baris audit yang
-- menyebut grant yang tidak pernah menjangkau tenant ini. Bentuk yang sama
-- dituntut #149 untuk office, dengan alasan yang sama persis.
--
-- ## Yang TIDAK dilakukan migrasi ini
--
-- Tidak ada backfill. Baris yang sudah ada ditulis sebelum akses terdelegasi
-- ada, jadi `actor_tenant_id` NULL pada semuanya BENAR — aktornya memang dari
-- dalam. Backfill yang mengisi `tenant_id` ke sana akan mengubah 100% baris
-- lama menjadi klaim yang kebetulan benar dan menghapus perbedaan yang justru
-- menjadi guna kolom ini.

BEGIN;

-- 1. Target FK komposit. `awcms_delegated_access_grants` lahir di `sql/117`
--    tanpa ini karena belum ada yang mereferensinya.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_delegated_access_grants_tenant_id_key'
  ) THEN
    ALTER TABLE awcms_delegated_access_grants
      ADD CONSTRAINT awcms_delegated_access_grants_tenant_id_key
      UNIQUE (tenant_id, id);
  END IF;
END $$;

-- 2. Audit: dari tenant mana aktornya, dan grant mana yang membuatnya bisa.
ALTER TABLE awcms_audit_events
  ADD COLUMN IF NOT EXISTS actor_tenant_id uuid REFERENCES awcms_tenants (id),
  ADD COLUMN IF NOT EXISTS delegated_grant_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_audit_events_delegated_grant_fkey'
  ) THEN
    ALTER TABLE awcms_audit_events
      ADD CONSTRAINT awcms_audit_events_delegated_grant_fkey
      FOREIGN KEY (tenant_id, delegated_grant_id)
      REFERENCES awcms_delegated_access_grants (tenant_id, id);
  END IF;
END $$;

-- Sebuah baris yang menyebut grant WAJIB menyebut tenant asalnya. Tanpa CHECK
-- ini sebuah baris bisa mengatakan "ini di bawah grant" tanpa mengatakan grant
-- SIAPA, yang justru setengah jawaban yang tidak berguna.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_audit_events_delegation_pairing_check'
  ) THEN
    ALTER TABLE awcms_audit_events
      ADD CONSTRAINT awcms_audit_events_delegation_pairing_check
      CHECK (delegated_grant_id IS NULL OR actor_tenant_id IS NOT NULL);
  END IF;
END $$;

-- 3. Decision log: grant yang sama, pada setiap keputusan otorisasi.
--
--    `actor_tenant_id` sengaja TIDAK ditambahkan di sini. Baris decision log
--    ditulis oleh chokepoint pada jalur panas setiap request, dan tenant asal
--    dapat diturunkan dari grant-nya kapan saja lewat satu join. Menyimpan
--    keduanya berarti menulis dua kolom per request untuk menghindari satu join
--    yang hanya dijalankan investigasi.
ALTER TABLE awcms_abac_decision_logs
  ADD COLUMN IF NOT EXISTS delegated_grant_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_abac_decision_logs_delegated_grant_fkey'
  ) THEN
    ALTER TABLE awcms_abac_decision_logs
      ADD CONSTRAINT awcms_abac_decision_logs_delegated_grant_fkey
      FOREIGN KEY (tenant_id, delegated_grant_id)
      REFERENCES awcms_delegated_access_grants (tenant_id, id);
  END IF;
END $$;

-- 4. Index. Keduanya PARSIAL: kolomnya NULL pada hampir setiap baris, dan index
--    penuh atas tabel decision log (tabel terbesar di repo ini) untuk kolom yang
--    99,9% NULL adalah biaya tanpa pembaca.
--
--    Pertanyaan yang mereka layani adalah pertanyaan audit: "apa saja yang
--    dilakukan di bawah grant ini" dan "apa saja yang dilakukan orang luar di
--    tenant saya".
CREATE INDEX IF NOT EXISTS awcms_audit_events_delegated_grant_idx
  ON awcms_audit_events (tenant_id, delegated_grant_id)
  WHERE delegated_grant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_audit_events_actor_tenant_idx
  ON awcms_audit_events (tenant_id, actor_tenant_id, created_at DESC)
  WHERE actor_tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_abac_decision_logs_delegated_grant_idx
  ON awcms_abac_decision_logs (tenant_id, delegated_grant_id)
  WHERE delegated_grant_id IS NOT NULL;

COMMENT ON COLUMN awcms_audit_events.actor_tenant_id IS
  'ADR-0091. Tenant ASAL aktor, terisi HANYA bila berbeda dari tenant_id. NULL berarti "aktornya dari dalam", bukan "tidak diketahui" — kolom yang hampir selalu menduplikasi tetangganya berhenti dibaca. Bentuk yang sama dengan awcms_tenant_status_transitions.actor_tenant_id (sql/092).';

COMMENT ON COLUMN awcms_audit_events.delegated_grant_id IS
  'ADR-0091. Grant akses terdelegasi (ADR-0090) yang membuat tindakan ini bisa terjadi. FK KOMPOSIT bersama tenant_id: FK sederhana melewati RLS dan akan menerima id grant milik tenant lain.';

COMMENT ON COLUMN awcms_abac_decision_logs.delegated_grant_id IS
  'ADR-0091. Grant yang mendasari keputusan ini. Tenant asal sengaja TIDAK disimpan di sini — ia dapat diturunkan dari grant lewat satu join yang hanya dijalankan investigasi, dan baris ini ditulis pada jalur panas setiap request.';

COMMIT;
