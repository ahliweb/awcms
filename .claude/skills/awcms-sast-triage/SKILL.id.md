---
name: awcms-sast-triage
description: Triase dan perbaiki temuan analisis statik (SAST) AWCMS dari OpenGrep, mesin check `keamanan / sast-rahasia-dependensi` (ADR-0173). Gunakan saat check itu gagal di sebuah PR, saat diminta "triase SAST"/"perbaiki temuan OpenGrep", saat mengerjakan entri `tools/ci/sast/baseline.json`, atau saat menambah aturan lokal. Mencakup semantik gerbang (hanya ERROR baru di luar baseline yang menggagalkan), baseline yang hanya menyusut, penekanan `nosemgrep` beralasan, aturan lokal, dan pelajaran yang tidak bergantung alat dari katalog CodeQL yang sudah dipensiunkan (heuristik nama, fallback `??` mati yang merupakan bug nyata, binding test tak terpakai yang menandai celah cakupan).
---

🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](SKILL.md)

<!-- i18n-source-hash: sha256:9e50b9892a96a3614aac1063a8fb4a33380440c90efcdf7f01d285a5b934c775 -->

# AWCMS — Triase SAST (OpenGrep)

Analisis statik berjalan di `.github/workflows/keamanan.yml`, job `keamanan / sast-rahasia-dependensi`, pada setiap pull request dan setiap push ke `main` ([ADR-0173](../../../docs/adr/0173-static-analysis-runs-on-opengrep-with-a-pinned-copied-rule-set-and-a-shrink-only-baseline-and-codeql-is-retired.id.md)). Ia menggantikan CodeQL. Job yang sama juga menjalankan gitleaks atas rentang commit; skill ini hanya mencakup langkah SAST.

- **Mesin:** OpenGrep `v2.1.0`, dipin dengan SHA-256 dan diverifikasi sebelum dieksekusi oleh `tools/ci/sast/opengrep-scan.ts`.
- **Aturan:** `tools/ci/sast/rules/javascript/`, `tools/ci/sast/rules/typescript/`, dan `tools/ci/sast/rules/yaml/github-actions/` (salinan byte `opengrep/opengrep-rules` pada commit terpin, lihat `tools/ci/sast/rules/SUMBER.md`) ditambah aturan milik repo ini di `tools/ci/sast/rules/lokal/`. Aturan registry tidak pernah diambil.
- **Gerbang:** exit `1` hanya untuk temuan `ERROR` yang sidik jarinya tidak ada di `tools/ci/sast/baseline.json`. `WARNING` dan `INFO` dicetak dan tidak pernah memblokir. Exit `2` adalah galat alat (unduhan, checksum, aturan, baseline) dan gagal tertutup.
- **Tidak tercakup:** berkas `.astro` (tanpa parser) dan `design/` (dikecualikan, ADR-0173 §Cakupan). Berkas workflow di `.github/workflows/` IKUT dipindai, oleh sembilan aturan `yaml/github-actions/`; itu aturan pola, lebih dangkal daripada analisis alur data CodeQL atas workflow.

## Langkah triase (wajib, jangan menebak)

1. **Baca temuan dari job yang gagal, bukan dari ingatan.** `gh pr checks <PR>` memberi URL job; `gh run view <run-id> --log-failed` menampilkan setiap `ERROR` baru sebagai `[ERROR] <path>:<line>  <rule-id>` diikuti pesan aturannya. Baris ringkasan memberi jumlah per severity dan jumlah entri baseline yang basi.
2. **Reproduksi** dengan perintah yang sama dengan CI, dari root repo:
   ```bash
   bun tools/ci/sast/opengrep-scan.ts --exclude design
   ```
   Di mesin kerja pemilik setiap perintah CI berjalan lewat `ci-lokal` (batas 60 detik, standar lintas-portofolio internal DL-099). Pemindaian penuh repo ini lebih lama dari itu (sekitar 77 dtk di runner GitHub-hosted saat adopsi), jadi pemindaian penuh berjalan di CI; secara lokal, baca aturan dan kodenya alih-alih mengulang pemindaian.
3. **Baca aturannya sebelum kodenya.** Berkas aturan ada di `tools/ci/sast/rules/<bahasa>/.../<nama>.yaml` (id `javascript.browser.security.insecure-innerhtml` dipetakan ke `tools/ci/sast/rules/javascript/browser/security/insecure-innerhtml.yaml`). Blok `pattern`/`patterns` menyatakan persis apa yang cocok; `message` dan `metadata` menyatakan kenapa itu penting. Sebagian besar aturan yang disalin mencocokkan pola di dalam satu fungsi: ia tidak tahu dari mana sebuah nilai berasal.
4. **Putuskan: cacat nyata, atau kecocokan yang tidak mungkin menjadi cacat di sini.** Buktikan ke salah satu arah sebelum menulis kode:
   - Ikuti setiap jalur data menuju sink yang cocok. Nilai yang terbukti konstan, token acak yang dibangkitkan server, atau yang sudah di-escape adalah bukti; "kelihatannya aman" bukan bukti.
   - Cari bentuk yang sama di tempat lain di repo. Bila call site lain membawa risiko yang sama, perbaikannya berada di helper bersama, bukan di satu berkas.
5. **Perbaiki dengan perubahan minimal yang mempertahankan perilaku** bila itu cacat nyata, dengan test yang gagal sebelum perbaikan. Lalu jalankan `bun tools/ci/sast/opengrep-scan.ts baseline --rapikan` bila temuan itu ada di baseline: entrinya kini basi dan wajib keluar.
6. **Bila bukan cacat dan kodenya tidak masuk akal dibentuk ulang**, tekan satu baris itu secara inline, dengan id aturan lengkap dan alasan di baris yang sama atau baris tepat di atasnya:
   ```ts
   // nosemgrep: javascript.browser.security.insecure-innerhtml -- markup is built from escapeHtml() output only, see the test "escapes every interpolated field"
   ```
   Penekanan tanpa alasan ditolak saat review. Utamakan membentuk ulang kode bila biayanya kecil, karena penekanan juga menyembunyikan baris itu dari setiap versi aturan di masa depan.
7. **Verifikasi:** job hijau di PR, dan baris ringkasan tidak menunjukkan `ERROR` baru.

## Baseline hanya menyusut

- `tools/ci/sast/baseline.json` memuat temuan `ERROR` yang sudah ada saat gerbang diadopsi (16 entri, didaftar di ADR-0173 §Pengukuran adopsi). Setiap entri berbentuk `{ rule, path, fingerprint, alasan, baris }`; `fingerprint` (id aturan + path + teks cocok yang whitespace-nya dirapatkan + indeks kemunculan) adalah kuncinya, `baris` hanya informasi.
- `baseline --buat` hanya berjalan bila baseline belum ada; ia tidak akan berjalan lagi.
- `baseline --rapikan` membuang entri basi dan tidak pernah menambah. `scan` melaporkan berapa entri yang basi.
- **Agent tidak pernah menambah entri baseline.** Menambah entri adalah edit tangan dengan `alasan` yang tidak kosong, ditinjau manusia di PR; entri tanpa `alasan` membuat skrip exit `2`.
- Mengerjakan entri adopsi berarti mentriasenya dengan langkah di atas di issue-nya sendiri, lalu memperbaiki atau menekannya, lalu `--rapikan`.

## Menambah aturan lokal

Taruh berkas `.yaml` di `tools/ci/sast/rules/lokal/` (sinkron tidak pernah menyentuh folder itu; `larang-eval.yaml` adalah contohnya). Isi `metadata.alasan`, pilih severity dengan sengaja (`ERROR` memblokir merge), dan pindai repo dengannya sebelum membuka PR: setiap kecocokan yang sudah ada dari aturan `ERROR` baru adalah kegagalan baru, dan baseline tidak dapat menyerapnya tanpa tinjauan manusia.

## Mengubah pin mesin atau aturan

Kedua pin tinggal di `tools/ci/sast/opengrep-scan.ts` (`OPENGREP_VERSION`, `OPENGREP_ASSETS`, `RULES_COMMIT`), dan pin mesin diulang di `keamanan.yml` sebagai kunci cache. Perubahan pin adalah PR tersendiri: verifikasi digest rilis, sinkronkan aturan dengan `bun tools/ci/sast/opengrep-scan.ts sinkron-aturan`, tinjau diff aturan, dan tangani temuan `ERROR` baru lewat langkah triase, tidak pernah dengan membuat ulang baseline.

## Pelajaran yang dipertahankan dari era CodeQL

CodeQL berjalan di sini sampai ADR-0173 dan alert-nya mengajarkan pola yang tidak bergantung alat. Komentar kode yang mengutip id aturan CodeQL (misalnya di `src/lib/auth/reset-token.ts`) dipertahankan sebagai catatan kenapa kode itu berbentuk seperti itu.

1. **Heuristik nama bukan aliran data.** `js/insufficient-password-hash` CodeQL menandai setiap fungsi yang namanya mengandung "password", apa pun yang dikembalikannya (Issue #496, PR #505). Perbaikan yang berhasil adalah mengganti nama (`hashResetToken`, `validateForgotIdentifierInput`); penekanan inline tidak menghapus alert. Bila pesan pemindai menyebut sesuatu yang mustahil menurut aliran data, itu bukti false positive.
2. **Periksa `value === null` sebelum `typeof value === "object"`.** Urutan sebaliknya adalah JavaScript yang benar tetapi memicu `js/comparison-between-incompatible-types`; helper yang sudah diurutkan ulang di `src/modules/email/domain/announcement-validation.ts` dan `src/modules/form-drafts/domain/form-draft-validation.ts` membawa komentarnya.
3. **Bandingkan origin, bukan awalan.** `url.startsWith("https://host")` di sebuah mock test ditandai sebagai sanitasi substring dan juga lebih longgar dari maksudnya; `new URL(url).origin === "https://host"` tepat dan mempertahankan perilakunya.
4. **Temuan "kondisi selalu benar" bisa bug nyata.** Bila sebuah helper tidak pernah mengembalikan `null`/`undefined` tetapi call site-nya menulis `helper(x) ?? fallback`, fallback-nya kode mati (alert #140, PR #210). Pindahkan `??` ke dalam pemanggilan, pada nilai yang memang bisa tidak ada. Baca definisi helper sebelum men-dismiss temuan trivial-conditional.
5. **Tagged template tidak men-stringify.** Bun.SQL `` tx`... ${x} ...` `` meneruskan `x` sebagai parameter terikat; temuan yang mengandaikan `toString()` implisit di sana adalah false positive (Issue #788).
6. **Binding tak terpakai di test bisa menandai test yang hilang.** Sebelum menghapus helper tak terpakai atau `result` yang tertimpa di sebuah test, periksa apakah judul test, komentar, atau ekspor modul menjanjikan skenario yang seharusnya dicakupnya; bila ya, tambahkan assertion-nya (Issue #788, alert #204, PR #1293).
7. **Dismissal butuh bukti yang bisa diperiksa pembaca.** Ketika sebuah temuan diterima (Issue #614), alasannya menyebut setiap jalur data menuju sink. Standar yang sama berlaku untuk alasan `nosemgrep` sekarang.

## Skill terkait

`awcms-security-review` (checklist keamanan modul), `awcms-security-hardening` (pemetaan OWASP), `awcms-pr-review` (proses review PR umum).
