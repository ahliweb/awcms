-- ADR-0094 gelombang 2 (Issue #557) — permukaan hak subjek data: satu tabel
-- yang mencatat SETIAP permintaan ekspor dan penghapusan, dan menegakkan
-- maker/checker di lapisan yang tidak bisa dibalap.
--
-- ## Kenapa ekspor pun punya baris, padahal ia hanya membaca
--
-- ADR-0094 Keputusan 3: ekspor adalah PENGUNGKAPAN, dan "siapa pun yang bisa
-- mengekspor subjek mana pun bisa mengeksfiltrasi seluruh basis pengguna satu
-- permintaan pada satu waktu". Sebuah pembacaan yang tidak meninggalkan jejak
-- membuat kalimat itu tak bisa diperiksa. Barisnya adalah bagaimana operator
-- menjawab "siapa mengunduh data siapa, dan kapan" tanpa harus menyaring
-- seluruh audit log — dan `status = 'disclosed'` menamai perbuatannya apa
-- adanya alih-alih 'completed', yang akan membuatnya terbaca seperti pekerjaan
-- administratif biasa.
--
-- ## Maker/checker sebagai CONSTRAINT, bukan hanya sebagai aturan SoD
--
-- Registry SoD sudah menggerbangi permission-nya pada waktu aksi
-- (`high-risk-sod-guard.ts`), dan itu tetap lapisan pertama. Tetapi aturan
-- "yang menyetujui bukan yang meminta" adalah invarian tentang SATU BARIS, dan
-- repo ini sudah membayar pelajaran bahwa invarian per-baris yang ditegakkan di
-- JS bisa dibalap: `awcms_identities` lockout dulu read-modify-write, sehingga
-- K percobaan paralel menghasilkan SATU increment sementara empat dokumen
-- menyatakan sebaliknya.
--
-- Jadi `awcms_subject_requests_checker_is_not_maker` menegakkannya di database.
-- Dua request approve yang tiba bersamaan tidak bisa, di antara keduanya,
-- menghasilkan penghapusan yang disetujui pemintanya sendiri — apa pun yang
-- terjadi di atas.
--
-- ## FK komposit, seperti `sql/027`
--
-- `subject_tenant_user_id` dan kedua stempel aktornya menunjuk
-- `awcms_tenant_users (tenant_id, id)`, bukan `(id)`. FK biasa MELEWATI RLS,
-- jadi kolom ber-FK tunggal bisa menunjuk baris tenant lain dan constraint-nya
-- akan menerimanya — persis alasan `sql/027` menambahkan
-- `awcms_tenant_users_tenant_id_key`. Di tabel yang seluruh gunanya adalah
-- menjawab "data SIAPA", menunjuk orang di tenant lain adalah kebocoran, bukan
-- ketidakrapian.

CREATE TABLE IF NOT EXISTS awcms_subject_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  subject_tenant_user_id uuid NOT NULL,
  request_type text NOT NULL,
  status text NOT NULL,
  reason text NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  completed_at timestamptz,
  -- Cakupan yang DILAPORKAN bersama hasilnya. `tables_unanswered` adalah tabel
  -- global dan tabel tak-terjangkau (ADR-0094): laporan yang tidak menyebut
  -- angka ini tak bisa dibedakan dari laporan yang menganggap dirinya lengkap.
  tables_answered integer,
  tables_unanswered integer,
  rows_affected integer,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_subject_requests_type_check
    CHECK (request_type IN ('export', 'erasure')),
  CONSTRAINT awcms_subject_requests_status_check
    CHECK (status IN ('disclosed', 'pending_approval', 'rejected', 'completed')),
  -- Maker/checker, di lapisan yang tidak bisa dibalap. Lihat header.
  CONSTRAINT awcms_subject_requests_checker_is_not_maker
    CHECK (decided_by IS NULL OR decided_by <> requested_by),
  -- Sebuah keputusan punya pengambil keputusan DAN waktu, atau tidak ada
  -- keduanya. Separuh keputusan adalah baris yang tampak disetujui tanpa ada
  -- yang menyetujui.
  CONSTRAINT awcms_subject_requests_decision_is_whole
    CHECK (
      (decided_by IS NULL AND decided_at IS NULL)
      OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),
  -- Sebuah ekspor tidak menunggu siapa pun: ia diungkapkan atau tidak terjadi.
  -- Tanpa ini, ekspor ber-`pending_approval` akan duduk selamanya di inbox
  -- checker yang tidak punya tombol untuknya.
  CONSTRAINT awcms_subject_requests_export_is_immediate
    CHECK (request_type <> 'export' OR status = 'disclosed'),
  CONSTRAINT awcms_subject_requests_subject_fk
    FOREIGN KEY (tenant_id, subject_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_subject_requests_requested_by_fk
    FOREIGN KEY (tenant_id, requested_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_subject_requests_decided_by_fk
    FOREIGN KEY (tenant_id, decided_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Inbox checker: "apa yang menunggu saya" adalah kuerinya, dan ia berjalan di
-- tiap muat halaman.
CREATE INDEX IF NOT EXISTS awcms_subject_requests_tenant_status_idx
  ON awcms_subject_requests (tenant_id, status, requested_at DESC);

-- Jalur kursor keyset daftar admin (tenant_id, created_at).
CREATE INDEX IF NOT EXISTS awcms_subject_requests_tenant_created_idx
  ON awcms_subject_requests (tenant_id, created_at DESC);

-- "Apa yang pernah diminta TENTANG orang ini" — pertanyaan yang dijawab saat
-- permintaan kedua datang, dan saat seseorang bertanya apakah ekspornya sudah
-- pernah diserahkan.
CREATE INDEX IF NOT EXISTS awcms_subject_requests_tenant_subject_idx
  ON awcms_subject_requests (tenant_id, subject_tenant_user_id, requested_at DESC);

-- Indeks FK: `db:fk-index:check` menuntut kolom pertama tiap FK terindeks, dan
-- ketiganya memimpin dengan `tenant_id` yang sudah ditutup indeks di atas
-- KECUALI dua stempel aktor, yang butuh jalur sendiri.
CREATE INDEX IF NOT EXISTS awcms_subject_requests_tenant_requested_by_idx
  ON awcms_subject_requests (tenant_id, requested_by);
CREATE INDEX IF NOT EXISTS awcms_subject_requests_tenant_decided_by_idx
  ON awcms_subject_requests (tenant_id, decided_by);

ALTER TABLE awcms_subject_requests ENABLE ROW LEVEL SECURITY;
-- FORCE: tanpanya policy di bawah INERT untuk pemilik tabel, yang persis cara
-- isolasi tenant hilang tanpa satu pun migrasi memerah (ADR-0003).
ALTER TABLE awcms_subject_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_subject_requests_tenant_isolation
  ON awcms_subject_requests
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Tanpa DELETE, dan itu keputusan: catatan bahwa sebuah penghapusan diminta,
-- disetujui, dan dijalankan adalah bukti yang paling tidak boleh bisa
-- dihilangkan oleh orang yang sama yang bisa menjalankan penghapusan.
--
-- REVOKE, bukan sekadar GRANT yang menghilangkan DELETE. `sql/019` memberi
-- `awcms_app` keempat privilege atas SELURUH tabel di schema — sekali lewat
-- `ON ALL TABLES` dan seterusnya lewat `ALTER DEFAULT PRIVILEGES` — jadi tabel
-- ini sudah memilikinya sejak dibuat. GRANT yang "tidak menyebut" DELETE
-- karena itu tidak menahan apa pun: ia hanya memberikan lagi apa yang sudah
-- ada, sementara komentar di atasnya membaca seperti kontrol yang ditegakkan.
-- Preseden pencabutan eksplisit: `sql/112` dan `sql/114`.
GRANT SELECT, INSERT, UPDATE ON awcms_subject_requests TO awcms_app;
REVOKE DELETE ON awcms_subject_requests FROM awcms_app;
