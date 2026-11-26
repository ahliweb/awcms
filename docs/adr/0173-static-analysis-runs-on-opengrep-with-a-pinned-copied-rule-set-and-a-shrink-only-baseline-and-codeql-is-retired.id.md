🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0173-static-analysis-runs-on-opengrep-with-a-pinned-copied-rule-set-and-a-shrink-only-baseline-and-codeql-is-retired.md)

<!-- i18n-source-hash: sha256:3947430855e1e0dd8f173abe9795f4d1f810108160367d4b4d9016e027646085 -->

# ADR-0173 — Analisis statik berjalan di OpenGrep dengan set aturan tersalin yang dipin dan baseline yang hanya menyusut, dan CodeQL dipensiunkan

- **Status:** Diterima (Accepted)
- **Diterima:** 2026-11-27 (keputusan pemilik untuk setiap repositori portofolio, standar lintas-portofolio internal DL-098). Pada hari yang sama pemilik juga memutuskan bahwa cakupan workflow Actions digantikan, bukan dibuang (Keputusan 2). Satu pertanyaan tetap terbuka (lihat "Pertanyaan terbuka"); ia tidak menahan keputusan.
- **Tanggal:** 2026-11-27
- **Pengambil keputusan:** @ahliweb (pemilik). Merge pull request yang menerapkan ADR ini, dan perubahan ruleset `main`, adalah tindakan pemilik sendiri.
- **Terkait:** PR [#1530](https://github.com/ahliweb/awcms/pull/1530) (menerapkan ADR ini); [`SECURITY.md`](../../SECURITY.md); [`branch-protection.md`](../awcms/branch-protection.id.md) (check wajib, ruleset `11653326`); [`dependency-governance.md`](../awcms/dependency-governance.id.md) (tempat audit dependensi berjalan); [`standar-performa-dan-keamanan.md`](../awcms/standar-performa-dan-keamanan.id.md) celah C4 dan C16 (cakupan `.astro`); [ADR-0062](0062-skills-are-gated-against-the-code-they-describe.md) (skill digerbangi, sehingga skill triase diganti alih-alih dibiarkan menunjuk workflow yang sudah dihapus).

## Konteks

Sampai ADR ini, analisis statik adalah GitHub CodeQL: `.github/workflows/codeql.yml` menjalankan matriks `actions` dan `javascript-typescript` (`build-mode: none`, suite kueri `security-extended` dan `security-and-quality`) pada setiap push dan pull request ke `main` serta mingguan, mengecualikan `design/` lewat `.github/codeql/codeql-config.yml`, dan mengunggah SARIF ke GitHub code scanning. Tiga konteks darinya diwajibkan ruleset `main` `11653326`: `Analyze (javascript-typescript)`, `Analyze (actions)`, dan `CodeQL` (app code scanning). `tests/codeql-coverage-statement.test.ts` menjaga pernyataan cakupan workflow itu tetap jujur, dan skill `awcms-codeql-triage` memuat proses triase serta katalog false positive yang sudah dikonfirmasi.

Pemilik memutuskan pada 27 November 2026 bahwa CodeQL tidak dijalankan di repositori mana pun dalam portofolio. Ketentuan GitHub CodeQL membatasi pemakaiannya pada kode yang tidak open source dan di CI tanpa lisensi GitHub Advanced Security. Repositori ini publik dan berlisensi MIT, jadi batasan itu tidak mengenai repo ini hari ini. Pemilik tetap memilih **satu jalur untuk setiap repositori, termasuk yang publik**, karena dua alasan yang memang berlaku di sini:

1. Repositori yang membenamkan repo ini sebagai subtree (deployment hilir yang menyerap `awcms` ke pohonnya sendiri) tidak semuanya publik. Workflow atau skill yang benar di sini tersalin ke sana pada sinkron berikutnya, tempat ia tidak lagi benar.
2. Satu leg keamanan dengan nama check yang sama di setiap repositori adalah satu hal untuk dirawat, dijelaskan, dan diwajibkan; dua tumpukan alat yang dipilih menurut status lisensi adalah dua.

## Keputusan

1. **CodeQL dicabut dari setiap jalur yang dijalankan.** Dihapus: `.github/workflows/codeql.yml`, `.github/codeql/codeql-config.yml`, `tests/codeql-coverage-statement.test.ts`. Skill `awcms-codeql-triage` diganti `awcms-sast-triage` (triase OpenGrep: baseline, `nosemgrep` beralasan, aturan lokal), yang mempertahankan pelajaran katalog lama yang tidak bergantung alat. Komentar kode yang mencatat kenapa sebuah fungsi dinamai atau dibentuk setelah temuan CodeQL tetap ada: itu sejarah dan masih menjelaskan kodenya.
2. **Workflow terpisah, `.github/workflows/keamanan.yml`, job `keamanan / sast-rahasia-dependensi`,** berjalan pada setiap pull request, push ke `main`, dan atas permintaan, di runner GitHub-hosted `ubuntu-24.04`, dengan `permissions: contents: read`, setiap action dipin ke SHA commit, tanpa filter `paths`, dan tanpa unggah SARIF. Isinya dua langkah:
   - **Rahasia:** gitleaks `8.30.1`, arsip rilisnya diverifikasi terhadap SHA-256 sebelum dipakai, dijalankan dengan `--redact` atas **rentang commit** event (pull request `base..head`, push `before..after`, selain itu commit ujung). Ia tidak pernah memindai seluruh riwayat. Repositori ini tidak punya konfigurasi gitleaks, jadi aturan bawaan yang berlaku. GitGuardian tetap seperti adanya.
   - **SAST:** `bun tools/ci/sast/opengrep-scan.ts --exclude design`. OpenGrep `v2.1.0` (LGPL-2.1), binary `opengrep_linux_x86` dipin dengan SHA-256 `d6a68a84c01a3d8ee933f60847decf1b4d0fd7791a26833b32b95922baf28974` dan diverifikasi sebelum dieksekusi. Aturan: salinan byte `opengrep/opengrep-rules` pada commit `f1d2b562b414783763fd02a6ed2736eaed622efa`, setiap aturan `.yaml` dan `.yml` di `javascript/` dan `typescript/` (203 berkas) dan sembilan aturan di `yaml/github-actions/` (fixture uji aturan `*.test.yaml` dan `*.fixed.yaml` tidak disalin), seluruhnya 212 berkas aturan, ditambah `LICENSE` upstream, di `tools/ci/sast/rules/`, ditambah aturan milik repositori ini di `tools/ci/sast/rules/lokal/`. Semgrep Registry (`p/...`) dan `semgrep/semgrep-rules` tidak dipakai. Mesin berjalan dengan `SEMGREP_SEND_METRICS=off`, `--disable-version-check`, `--x-ignore-semgrepignore-files`, dan `--jobs` dari `CI_LOKAL_CPUS` (bawaan 5); OpenGrep 2.1.0 menolak `--metrics`, sehingga opsi itu tidak dipasang.
3. **Gerbang gagal hanya pada temuan `ERROR` yang tidak ada di baseline** (`tools/ci/sast/baseline.json`). `WARNING` dan `INFO` dilaporkan di log dan tidak pernah memblokir. Kode keluar: `0` lolos, `1` `ERROR` baru, `2` galat alat (unduhan, checksum, aturan kosong atau rusak, baseline rusak: gagal tertutup).
4. **Baseline hanya menyusut.** Ia dibuat sekali, saat adopsi, dan skrip menolak membuatnya lagi. `baseline --rapikan` membuang entri basi dan tidak pernah menambah. Entri baru adalah edit tangan dengan `alasan` yang tidak kosong, ditinjau manusia di pull request; agent tidak menambah entri baseline. Temuan yang diterima untuk satu baris ditekan inline dengan `// nosemgrep: <rule-id> -- <alasan>`, tidak pernah tanpa alasan.
5. **Audit dependensi tidak diduplikasi.** `bun run deps:audit:check` sudah menggerbangi setiap pull request di dalam rantai `check` `ci.yml` (job "Quality"), dengan ambang dan ledger pengecualiannya tidak berubah. `dependency-freshness.yml` (`bun outdated`, `bun audit`, pin image) tetap laporan mingguan dan atas permintaan, bukan gerbang pull request.
6. **Hasil tidak diunggah ke GitHub code scanning.** Alert code scanning yang ada tetap di GitHub seperti terakhir dilaporkan; tidak ada yang memperbarui atau menutupnya setelah ADR ini.

## Cakupan

- **Dipindai:** sumber `.ts`, `.js`, dan `.mjs` yang dilacak serta berkas workflow di `.github/workflows/`, dikurangi pengecualian bawaan skrip (dependensi, keluaran build, folder graf dan laporan hasil generate, `*.min.js`, aturan tersalin itu sendiri) dan `design/`. `design/` dikecualikan dengan alasan yang dicatat konfigurasi CodeQL: kanvas desain hasil ekspor dan salinan byte-identik runtime pihak ketiga yang di-vendor, hanya rujukan, tidak pernah dikirim dan tidak pernah diimpor oleh `src/`. Memindahkan isinya ke `src/` membuatnya kembali dipindai. Langkah `State coverage` di `keamanan.yml` menulis jumlah ini ke ringkasan run saat run berjalan (tidak pernah ditulis tangan), dan `tests/sast-coverage-statement.test.ts` menjaga langkah itu, pin SHA, ketiadaan filter `paths`, dan satu-satunya pengecualian agar tidak dihapus diam-diam; ia mengambil alih tugas uji cakupan CodeQL yang dihapus.
- **Tidak dipindai, tidak berubah:** berkas `.astro`. OpenGrep tidak punya parser Astro, persis seperti CodeQL tidak punya ekstraktor Astro, sehingga celah C4 dan C16 menggambarkan permukaan tak tercakup yang sama seperti sebelumnya.
- **`Analyze (actions)` digantikan, dengan kedalaman lebih dangkal.** Analisis atas berkas workflow itu sendiri (injeksi skrip lewat `${{ }}` di `run:`, checkout tak tepercaya pada trigger berhak tinggi) dicakup sembilan aturan `yaml/github-actions/` dari commit terpin yang sama (keputusan pemilik 27 November 2026). Itu aturan pola atas YAML, bukan analisis alur data CodeQL atas workflow, sehingga kasus yang ditemukan lebih sedikit dan lebih dangkal.
- **Hilang dibanding CodeQL:**
  1. **Pelacakan taint antar-prosedur.** Kueri `security-extended` CodeQL mengikuti data lintas fungsi dan berkas; aturan OpenGrep yang disalin sebagian besar aturan pola di dalam satu fungsi. Temuan aliran data yang dalam diperkirakan lebih sedikit.
  2. **Suite `security-and-quality`.** Kueri kualitas seperti variabel lokal tak terpakai tercakup sebagian oleh `tsc` (`noUnusedLocals`, `noUnusedParameters`), bukan pengganti.

## Pengukuran adopsi

Diambil di runner GitHub-hosted, karena pemindaian yang sama melewati batas 60 detik yang berlaku untuk CI di mesin kerja pemilik (standar lintas-portofolio internal DL-099): 213 berkas aturan (212 tersalin + 1 lokal), 4.740 berkas dipindai, 76,7 dtk; `ERROR` 16, `WARNING` 862, `INFO` 701. Sembilan aturan `yaml/github-actions` tidak melaporkan temuan apa pun (dari severity mana pun) di berkas workflow repositori. Ke-16 temuan `ERROR`, semuanya dari aturan JavaScript dan TypeScript, menjadi baseline adopsi:

| Aturan                                                 | Entri | Di mana                                                                                                                                                                                                           |
| ------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `javascript.node-crypto.security.gcm-no-tag-length`    | 5     | `src/lib/auth/mfa-secret-crypto.ts`, `src/lib/auth/sso-credential-crypto.ts`, `src/lib/security/field-encryption.ts`, `src/lib/security/secure-url-params.ts`, `src/modules/comments/domain/subscriber-crypto.ts` |
| `javascript.browser.security.insecure-document-method` | 4     | `public/js/blog-preview-overlay.js` (2), `src/lib/ui/blog-preview-overlay.ts` (2)                                                                                                                                 |
| `javascript.browser.security.insecure-innerhtml`       | 4     | `public/js/blog-preview-overlay.js` (2), `src/lib/ui/blog-preview-overlay.ts` (2)                                                                                                                                 |
| `typescript.lang.correctness.useless-ternary`          | 3     | `src/modules/hr-commission/domain/hr-commission-decimal.ts`, `src/modules/tax/domain/decimal.ts`, `tests/omes-control-repository-progress-poller.test.ts`                                                         |

Temuan itu dicatat, belum ditriase: perubahan yang menerapkan ADR ini tidak mengubah kode produk. Masing-masing ditriase dengan skill `awcms-sast-triage` di issue-nya sendiri; temuan yang sudah diperbaiki keluar dari baseline lewat `baseline --rapikan`.

## Konsekuensi

- **Positif:** satu leg keamanan dengan satu nama check di seluruh portofolio; tidak ada pertanyaan lisensi ketika pohon ini disalin ke repositori privat; set aturan dan mesin dipin dan dapat diverifikasi, sehingga hasil pemindaian dapat direproduksi dari commit saja; rahasia dipindai per perubahan oleh alat kedua yang independen di samping GitGuardian.
- **Negatif / trade-off:** cakupan yang tercantum di "Hilang dibanding CodeQL"; temuan tinggal di log job, bukan di tab code scanning, sehingga tidak ada riwayat alert maupun catatan dismissal; aturan yang disalin berasal dari repositori upstream yang sudah diarsipkan, sehingga aturan baru hanya datang lewat perubahan pin yang disengaja.
- **Lisensi aturan yang disalin:** `tools/ci/sast/rules/` (kecuali `lokal/`) berada di bawah Commons Clause + LGPL 2.1, bukan lisensi MIT repositori ini. Commons Clause menahan hak menjual perangkat lunak; memakai aturan di CI tidak dibatasi. Pertanyaan terbuka Q1.
- **Check wajib:** sampai pemilik mengubah ruleset `11653326`, ketiga konteks CodeQL masih diwajibkan dan tidak pernah melapor, sehingga tidak ada pull request, termasuk yang ini, yang dapat di-merge tanpa perubahan itu. Lihat "Tindakan pemilik".

## Tindakan pemilik

1. Di ruleset `11653326` ("main only"), cabut konteks wajib `Analyze (javascript-typescript)`, `Analyze (actions)`, dan `CodeQL`, lalu tambahkan `keamanan / sast-rahasia-dependensi`. Perintah persisnya ada di [`branch-protection.md`](../awcms/branch-protection.id.md) §"Memensiunkan CodeQL (ADR-0173)".
2. Opsional: nonaktifkan "default setup" CodeQL di setelan code security repositori bila pernah diaktifkan di sana (repositori ini memakai setup lanjutan berbasis workflow).

## Rollback

Revert pull request yang menerapkan ADR ini: itu memulihkan `codeql.yml`, konfigurasinya, uji cakupannya, dan skill-nya, serta mencabut `keamanan.yml`, `tools/ci/sast/`, dan status ADR ini. Pemilik lalu memulihkan ketiga konteks CodeQL di ruleset `11653326` dan mencabut `keamanan / sast-rahasia-dependensi`.

## Alternatif yang dipertimbangkan

- **Pertahankan CodeQL di sini, karena repositori ini publik.** Ditolak pemilik: salinan subtree tidak semuanya publik, dan satu jalur lebih diutamakan daripada penilaian lisensi per repositori.
- **Aturan Semgrep Registry (`p/...`) atau `semgrep/semgrep-rules`.** Dikecualikan oleh keputusan pemilik; registry yang diambil saat pemindaian juga tidak dipin dan tidak dapat direproduksi.
- **Unggah SARIF OpenGrep ke code scanning.** Ditolak: itu bergantung pada fitur GitHub Advanced Security yang sama untuk repositori privat, dan leg ini harus berperilaku sama di mana pun.

## Pertanyaan terbuka untuk pemilik

1. **Q1, pemberitahuan lisensi.** Perlukah README atau `LICENSE` menyatakan bahwa `tools/ci/sast/rules/` adalah materi pihak ketiga di bawah Commons Clause + LGPL 2.1, agar salinan hilir template MIT ini tidak mengiranya MIT? Direktori itu sudah membawa `LICENSE` upstream dan catatan asal-usul `SUMBER.md`.
