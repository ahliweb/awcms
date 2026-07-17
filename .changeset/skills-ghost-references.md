---
"awcms": patch
---

Sapu realitas warisan awcms-mini dari `.claude/skills/` (yang DIIKUTI agen,
sehingga skill yang salah aktif melahirkan bug) dan tambah gate otomatis yang
menangkap kelas bug ini sekali jalan.

- **Rujukan migration `sql/NNN` hantu** — 34 rujukan (penomoran awcms-mini yang
  terbawa saat adaptasi) dibetulkan: yang punya padanan awcms diperbaiki ke
  nomor yang benar (mis. email — migrasi mini 020/021/024 → `sql/014`), yang
  merujuk modul yang belum di-port dinyatakan tegas sebagai artefak awcms-mini
  lewat banner status per-file.
- **Skill untuk modul yang belum di-port ditandai BACAAN SAJA** — 10 skill
  (`blog-content`, `data-lifecycle`, `document-infrastructure`, `form-drafts`,
  `idn-admin-regions`, `integration-hub`, `news-portal`, `social-publishing`,
  `visitor-analytics`, `tenant-domain-routing`) mendapat prefiks status di
  `description` + banner "BELUM di-port; ada di awcms-mini" di body, mengikuti
  pola `awcms-legacy-migration`. `awcms-profile-identity` ditandai SEBAGIAN
  (fondasi ada, lapis Issue #748 belum di-port).
- **Rujukan role/script disetel ke realitas terkini** — `awcms_app` +
  `scripts/security-readiness.ts` kini ADA (Issue #141/#142); skill dinaikkan
  dari "belum ada" ke status akurat (mis. `awcms-new-migration` aturan 11/12,
  `awcms-port-from-mini`, `awcms-deploy`, `awcms-workflow-approval`). Role
  `awcms_worker`/`awcms_setup` dinyatakan tetap tidak ada.
- **Gate baru `checkSqlMigrationReferences`** di `scripts/lib/docs-checks.mjs`
  (dijalankan `bun run check:docs`) menolak setiap rujukan `sql/NNN` di
  dokumentasi (termasuk `.claude/skills/`) yang berkasnya tidak ada di `sql/`.
  Escape hatch berbasis konten (penanda inline `<!-- sql-refs: awcms-mini -->`
  + daftar path), bukan nomor baris.
- **`NAMING_EXEMPTIONS` diperbaiki dari `file:line` ke `file::identifier`**
  (berbasis konten) supaya kebal terhadap pergeseran baris — desain lama patah
  saat agen paralel menyisipkan baris di dokumen yang sama.

Tidak ada perubahan pada kode runtime, schema, atau API.
