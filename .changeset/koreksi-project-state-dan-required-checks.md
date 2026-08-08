---
"awcms": patch
---

docs(state,ci): `PROJECT_STATE` berhenti membantah kodenya sendiri; tiga job CI jadi required check

**Ruleset `main only` naik dari 7 ke 10 required status check.** Tiga job
`ci.yml` berjalan di setiap PR tanpa memblokir merge apa pun: `Integration tests
(RLS + DB role separation)`, `E2E smoke (Playwright)`, dan `Minimum-supported
versions (Bun 1.3.0 floor)`. Job `integration-tests` adalah **satu-satunya**
tempat Postgres nyata dijalankan — isolasi RLS, pemisahan role DB, dan seluruh
anggaran query hidup di sana — sementara job `quality` sengaja berjalan dengan
`DATABASE_URL: ""`. Artinya required check yang ada **buta secara struktural**
terhadap kelas itu: pelanggaran isolasi tenant memerahkan CI tanpa menahan
merge, dan seluruh penalaran "gerbang X ada di rantai" hanya sekuat kebiasaan
orang membaca CI merah.

Biaya yang diterima dan dinyatakan, bukan disembunyikan: job integrasi menarik
image Postgres dari Docker Hub, sehingga outage registry kini memblokir merge.
Itu terjadi sekali pada 8 Agustus (run `31234082007`, tiga retry semuanya
timeout) — satu kegagalan dari 14 run yang disampel, dan **bukan** kegagalan
test. Empat jenis aturan ruleset lainnya diverifikasi tidak berubah.

**Tiga klaim `docs/PROJECT_STATE.md` yang dibantah kode diperbaiki:**

- §4 mencatat anggaran query sudah mendarat, lalu beberapa ratus baris kemudian
  masih menulis "dari 34 gerbang, satu memeriksa performa" dan "pembangun
  sitemap belum beranggaran" — padahal `query-budget-admin.integration.test.ts`
  sudah mencakupnya. Hitungan itu **tidak diperbarui melainkan dihapus**, diganti
  rujukan ke `standar-performa-dan-keamanan.md` §8 sebagai satu-satunya tempat ia
  dipelihara. Menduplikasi angka adalah penyebab basinya, bukan gejalanya.
- "sebelas permission dari **43**" → **41**. `sql/089` mencabut
  `blog_content.seo.configure` dan `.posts.export` saat ADR-0058 mengosongkan
  daftar pengecualian. Diverifikasi lewat `listModules()`: 21 modul, 203
  permission, `blog_content` 41.
- `posts.export` masih disajikan sebagai "absen yang digerbangi contract test".
  Ia tidak ada lagi untuk diabsenkan — dicabut justru karena tak ada endpoint
  yang menegakkannya.

**Satu entri jebakan §6 diperkuat karena ia menyuruh memverifikasi hal yang
tidak cukup.** "Subagent di working tree bersama bisa memindahkan HEAD →
verifikasi `git branch --show-current`" — nama branch yang baru dibuat SELALU
terlihat benar; yang harus diverifikasi adalah **commit induknya**. Ini terjadi
pada 8 Agustus: PR #409 dibuat saat HEAD berada di branch sesi lain, membawa 32
berkas alih-alih 10, dan merge-nya mendaratkan seluruh isi PR #408 ke `main`
tanpa PR itu di-review. Gejala yang terlewat: pesan squash memuat pesan commit
PR lain sebagai butir.
