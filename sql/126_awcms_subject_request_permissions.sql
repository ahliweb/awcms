-- ADR-0094 gelombang 2 (Issue #557) — seed katalog permission untuk permukaan
-- hak subjek data. Cocok verbatim dengan
-- `src/modules/data-lifecycle/domain/subject-request-permissions.ts`
-- (`SUBJECT_REQUEST_PERMISSIONS`), yang dipakai ulang `module.ts` dan setiap
-- guard `authorizeInTransaction`.
--
-- ## EMPAT kunci, bukan dua, dan tiap pemisahan menjawab pertanyaan berbeda
--
-- Issue #557 menuntut "dua izin terpisah — ekspor dan penghapusan bukan satu
-- otoritas". Itu pemisahan PERTAMA:
--
--   `subject_request.export`   — mengungkapkan data seseorang;
--   `subject_erasure.*`        — menghancurkan tautan ke seseorang.
--
-- Pemisahan KEDUA datang dari ADR-0094 Keputusan 3, yang menjadikan penghapusan
-- maker/checker. Maker dan checker yang berbagi satu kunci bukan maker/checker
-- sama sekali, jadi `subject_erasure` terbelah:
--
--   `subject_erasure.create`   — MEMINTA penghapusan (maker);
--   `subject_erasure.approve`  — menyetujui dan MENJALANKANNYA (checker).
--
-- Preseden persis `data_lifecycle.legal_hold.create`/`.release` (`sql/056`),
-- termasuk aturan SoD yang menjadikan memegang keduanya sebagai konflik
-- `critical`.
--
-- `subject_request.read` ada supaya inbox checker bisa dilihat tanpa memegang
-- satu pun kunci yang mengungkapkan atau menghancurkan. Seorang petugas
-- perlindungan data yang hanya perlu MEMANTAU tidak boleh dipaksa memegang
-- otoritas ekspor untuk melakukannya.
--
-- Hanya melebarkan katalog ABAC global; tidak ada role/assignment yang
-- dikaitkan di sini. Seperti setiap migrasi seed permission sebelumnya, tenant
-- yang dibuat SESUDAH migrasi ini yang memungutnya otomatis lewat bootstrap
-- setup — tenant lama perlu backfill `awcms_role_permissions`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('data_lifecycle', 'subject_request', 'read', 'Read the subject-request log and the pending-erasure inbox'),
  ('data_lifecycle', 'subject_request', 'export', 'Export everything this tenant holds about a data subject (a DISCLOSURE)'),
  ('data_lifecycle', 'subject_erasure', 'create', 'Request erasure of a data subject (maker half — never executes it)'),
  ('data_lifecycle', 'subject_erasure', 'approve', 'Approve and execute a pending erasure request (checker half)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
