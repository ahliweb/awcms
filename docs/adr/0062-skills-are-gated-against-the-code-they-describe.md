# ADR-0062 — Skill digerbangi terhadap kode yang dijelaskannya

- **Status:** Accepted
- **Tanggal:** 2026-08-04
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (pengembangan hanya di `awcms` + `awcms-astro`; mini/micro jadi arsip), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (jalur turunan dihapus), [ADR-0058](0058-unenforced-permissions-disposition.md) (preseden: daftar pengecualian ber-alasan sebagai artefak), [ADR-0057](0057-blog-page-lifecycle.md) §F (preseden: gerbang cakupan yang butuh tiga kali tulis ulang)

## Konteks

### 1. Angka yang memaksa keputusan ini

`.claude/skills/` memuat 55 skill. Saat ADR ini ditulis:

- **Sebelas ADR berurutan — 0051 sampai 0061 — mendarat tanpa SATU pun skill
  menyebutnya.** Bukan sebagian: nol.
- **Empat skill untuk modul HIDUP menunjuk `src/lib/<modul>/…`** untuk berkas
  yang sebenarnya ada di `src/modules/<modul>/presentation/…`
  (`seo_distribution` ×3, `comments`, `theming`). Berkasnya pindah; skill-nya
  tidak.
- **Beberapa mengumumkan layar admin "TIDAK di-port" berbulan-bulan setelah
  layarnya mendarat** — `awcms-blog-content` menyatakan admin UI blog tidak ada
  padahal ada empat layar, `awcms-media-library` menyatakan `/admin/media` belum
  di-port padahal PR #345 membangunnya.
- **Enam skill masih mengajarkan alur mini-first** yang ADR-0055 cabut dua hari
  sebelumnya, termasuk satu skill yang SELURUHNYA adalah prosedur port.

### 2. Kenapa skill basi lebih berbahaya daripada dokumen basi

Dokumen dibaca manusia yang bisa ragu. **Skill DIIKUTI.** Dan arah menuanya
berlawanan dengan koreksi biasa: pernyataan "modul ini belum ada di repo ini"
mulai benar, lalu modulnya dibangun, dan kalimat itu menua menjadi kebohongan
yang percaya diri. Agen yang membacanya membangun ulang hal yang sudah ada —
atau, lebih buruk sejak ADR-0055, mengambilnya dari arsip yang tidak bergerak.

Repo ini sudah mencatat pola itu sebagai kelas: sebuah pemeriksaan yang menjawab
salah tidak berhenti pada satu laporan salah, **ia melahirkan dokumen**
(ADR-0058 §1: dua tuduhan palsu scanner sempat ditulis sebagai KEPUTUSAN
ber-alasan yang rutenya bantah baris demi baris; ADR-0059: sebuah dugaan tertulis
sebagai temuan lalu tersalin ke `PROJECT_STATE.md` sebagai keputusan).

### 3. Kenapa pengecualiannya dulu benar, dan kenapa sekarang tidak

`docs/awcms/` dan `.claude/skills/` sengaja DILUAR `check:docs`. Alasannya sah
saat ditulis: keduanya memuat catatan adaptasi `awcms-mini` yang memang boleh
menyebut tooling yang tidak ada di sini.

ADR-0055 mencabut alasan itu **untuk skill**. Begitu mini/micro jadi arsip dan
kemampuan DIBANGUN di sini, sebuah skill yang terbaca sebagai instruksi port
bukan lagi sekadar usang — ia mengarahkan pekerjaan ke repo yang tidak bergerak.
`docs/awcms/` tetap di luar gerbang ini: isinya memang campuran sejarah dan
spesifikasi, dan tidak dieksekusi sebagai instruksi.

## Keputusan

`bun run skills:check` (`scripts/skills-check.ts`) masuk rantai `bun run check`.
Murni — tanpa database, tanpa jaringan, tanpa git — dan **tidak membaca maksud**:
prosa tidak bisa digerbangi, jadi tiap aturan bertumpu pada registry modul,
otoritas yang sama yang dipakai `modules:*:check`.

**Aturan 1 — skill modul HIDUP menjelaskan kode HIDUP.** Bila subjek `awcms-<x>`
ada di `listModules()`, setiap path `src/…` yang dikutipnya wajib ada. **Tanpa
daftar pengecualian**, sengaja: skill untuk kode yang sudah rilis tidak punya
alasan menyebut berkas yang tidak ada. Ini yang menangkap keempat misdireksi
`src/lib/<modul>/`.

**Aturan 2 — setiap ADR yang dikutip ada.** `ADR-0042` wajib resolve ke
`docs/adr/0042-*.md`. Rujukan ke ADR yang tak pernah ditulis adalah kutipan yang
pembacanya juga tak bisa periksa.

**Aturan 3 — skill untuk kode yang TIDAK ada wajib menyatakannya, ber-alasan.**
Skill spesifikasi-target dan historis itu sah: `awcms-social-publishing`
memerikan modul yang layak dibangun, `awcms-news-portal` mencatat modul yang
dilebur. Keduanya boleh mengutip path yang tidak ada — tetapi hanya dari
`ASPIRATIONAL_SKILLS`, tempat tiap entri menyatakan ia `target-spec`,
`historical`, atau `cross-cutting` **dan kenapa**.

Daftar itu sengaja per-SKILL, bukan per-PATH. Daftar path akan tumbuh setiap kali
sebuah spesifikasi target disunting lalu berhenti dibaca; daftar skill hanya
berubah ketika sebuah skill berubah SIFAT — persis saat seseorang memang harus
melihat.

**Aturan 4 — perintah yang disuruh dijalankan harus ada.** Setiap
`bun run <target>` di sebuah skill wajib ada di `package.json` ATAU terdaftar di
`scripts/README.md` §Ditunda. Aturan ini **sengaja sempit**: §Ditunda secara
eksplisit MENGIZINKAN skill menyebut target acuan yang belum dibangun, jadi
gerbang ini tidak menggugat kebijakan itu — ia hanya menangkap target yang bukan
keduanya. Hari ini itu tepat dua, dan salah satunya menyuruh pembacanya
menjalankan `github:snapshot:refresh` yang tak pernah ada padahal mekanismenya
`gh` CLI di halaman yang sama.

Ini kelas yang sama yang `check:docs` sudah tangkap di komentar kode: enam
komentar di `src/modules/module-management/` menyuruh menjalankan `modules:sync`,
perintah yang tak pernah ada di sini. Itu sudah diperbaiki di `src/` — dan skill
untuk modul yang SAMA masih menyebutnya, karena skill ada di luar semua gerbang.

### Entri mati juga gagal

Dua cara sebuah entri `ASPIRATIONAL_SKILLS` jadi tak bermakna, dan yang kedua
yang benar-benar akan terjadi: **modulnya DIBANGUN**, aturan 1 mulai
menguasainya, dan entrinya diam-diam berhenti berarti apa pun sambil tetap
terbaca sebagai keputusan. Gerbang melaporkan keduanya. Tiga entri sudah mati
begitu ditulis (`awcms-blog-content`, `awcms-form-drafts`,
`awcms-profile-identity`) dan langsung dihapus — bukti bahwa pemeriksaan itu
bukan hipotesis.

## Konsekuensi

**Yang didapat.** Kelas cacat "skill mengaku kode tidak ada padahal ada" jadi
merah di CI, bukan ditemukan bulan depan oleh agen yang sudah terlanjur
mengikutinya. 55 skill kini konsisten dengan registry; 10 path salah diperbaiki;
enam skill yang mengajarkan jalur ADR-0055 cabut sudah dibingkai ulang jadi
"bangun di sini dengan ADR admission".

**Yang dibayar.** Menyunting skill kini bisa memerahkan CI, dan itu memang
maksudnya. Satu efek samping yang perlu diketahui: badan banyak skill memuat
spesifikasi awcms-mini apa adanya, dengan path milik repo SUMBER. Path itu
sekarang harus ditulis sebagai milik sumber (`awcms-mini:src/…`) alih-alih
`src/…`, karena menuliskannya seperti path repo ini persis kesalahan yang
digerbangi.

**Yang TIDAK dilakukan.** Gerbang ini tidak menuntut setiap ADR dirujuk oleh
suatu skill. Menuntutnya akan menghasilkan rujukan seremonial yang ditambahkan
untuk menghijaukan CI — bentuk "upacara yang terlihat seperti cakupan" yang
`edge-cache:surfaces:check` sudah tolak untuk purge modul tanpa surface. Angka
0-dari-11 di §1 adalah GEJALA yang memicu ADR ini, bukan hal yang digerbangi;
yang digerbangi adalah klaim yang bisa diperiksa.

Nol migrasi, nol permission, nol perubahan OpenAPI, nol perubahan runtime — tak
satu berkas pun di `src/` berubah perilakunya.
