# ADR-0023 — Dokumentasi dwibahasa: sumber Indonesia, Inggris sebagai default, digerbang staleness

- **Status:** Accepted
- **Tanggal:** 2026-07-16
- **Pengambil keputusan:** @ahliweb
- **Terkait:** `docs/adr/README.md` §Aturan #4 (perubahan standar mengikat wajib ADR), ADR-0022 (konteks dokumen "pintu depan" yang baru diselaraskan), `scripts/check-docs.mjs`/`scripts/lib/docs-checks.mjs` (pola check docs murni + I/O yang diikuti), `scripts/db-migrate.ts` (pola checksum yang diadaptasi)

## Konteks

Kontributor teknis dan pengambil keputusan repo ini menulis dalam Bahasa Indonesia — seluruh `docs/awcms/**`, `docs/adr/**`, dan `README.md` saat ini murni Indonesia. Namun repo ini perlu tampil dengan **Inggris sebagai default** untuk pembaca eksternal (kontributor internasional, integrator ekstensi ERP/aplikasi turunan yang membaca `README.md`/indeks docs pertama kali), tanpa memaksa penulis asli beralih bahasa atau kehilangan otoritas isi Bahasa Indonesia yang sudah ada.

Tidak ada mekanisme render dwibahasa bawaan untuk file Markdown statis di GitHub — file yang secara harfiah bernama `README.md` adalah yang ditampilkan sebagai halaman utama repo. Tidak ada kunci API/provider terjemahan yang terpasang di repo ini (repo ini Bun-only, offline-first, tanpa integrasi AI provider untuk tooling docs); memanggil layanan terjemahan langsung dari CI berarti menambah secret, biaya, dan ketergantungan jaringan baru untuk sesuatu yang bukan bagian alur produksi.

Skop: `docs/awcms/**` sendiri berisi ~30.000 baris di ~40 berkas (termasuk `api-reference.md` yang 17.829 baris — artefak ter-generate dari OpenAPI, bukan prosa yang diterjemahkan tangan). Menerjemahkan seluruhnya sekaligus bukan pekerjaan satu perubahan; kebijakan ini karenanya harus mendukung **rollout bertahap** per berkas, bukan mengharuskan semuanya selesai sebelum mekanismenya berlaku.

Catatan: ini **berbeda** dari sistem i18n UI aplikasi (katalog `.po`/gettext, skill `awcms-i18n`, doc 04) yang menerjemahkan **konten yang dilihat pengguna akhir aplikasi** (tenant, produk, dsb.). ADR ini hanya mengatur **dokumentasi teknis/governance repo** — audiensnya kontributor dan integrator, bukan pengguna akhir aplikasi turunan.

## Keputusan

Kami memutuskan:

1. **Konvensi path:** untuk setiap dokumen yang mengikuti kebijakan ini, `<nama>.id.md` adalah **sumber otoritatif** Bahasa Indonesia (ditulis/diedit manusia), dan `<nama>.md` (path bare, tanpa akhiran bahasa) adalah **hasil generate** Bahasa Inggris — inilah yang tampil sebagai default (mis. `README.md` root yang dirender GitHub, atau tautan bare yang dipakai dokumen lain). Tidak ada penggantian nama berkas yang sudah ada di luar tiga dokumen "pintu depan" pada keputusan #2 — dokumen yang belum mengadopsi pola ini tetap Indonesia di path bare-nya sampai giliran migrasinya.

2. **Adopsi awal (perubahan ini):** tiga dokumen pintu depan mengadopsi pola di atas sekarang — `README.md` (root), `docs/awcms/README.md` (indeks paket dokumen + deskripsi), `docs/adr/README.md` (indeks ADR). Dokumen isi (`docs/awcms/01_canvas_induk.md` dst., seluruh `docs/adr/000X-*.md`) **tetap Indonesia di path bare-nya** untuk saat ini — migrasi berikutnya dilakukan per berkas/batch seiring kebutuhan, mengikuti pola yang sama.

3. **Banner language-switcher:** setiap berkas yang mengikuti pola ini (baik `.id.md` maupun `.md` pasangannya) menyertakan baris tautan timbal-balik di paling atas (mis. `🇬🇧 English (default) · 🇮🇩 [Bahasa Indonesia](README.id.md)` di versi Inggris, kebalikannya di versi Indonesia) agar pembaca yang mendarat di bahasa "salah" segera tahu ada padanannya.

4. **Gate staleness otomatis, bukan terjemahan otomatis:** `scripts/check-docs-translation.mjs` (logika murni di `scripts/lib/docs-i18n-checks.mjs`, pola yang sama dengan `check-docs.mjs`/`docs-checks.mjs`) memvalidasi bahwa setiap `*.id.md` yang di-track git punya padanan `*.md` yang menyimpan penanda `<!-- i18n-source-hash: sha256:<hex> -->` yang cocok dengan hash SHA-256 konten sumber ID saat ini. Gate ini **mendeteksi drift**, bukan menerjemahkan — bila sumber ID berubah tanpa EN diregenerasi, CI gagal dengan pesan yang menunjuk berkas mana yang basi. Regenerasi EN (oleh manusia atau agent AI seperti Claude Code) dan pembaruan penanda hash dilakukan sebagai bagian dari perubahan yang sama yang mengubah sumber ID — bukan panggilan API terpisah di CI.

5. **Wiring:** `check:docs:translation` masuk `bun run check` tepat setelah `check:docs` (paralel dengan mermaid/tautan/penamaan), dan sebagai step CI terpisah di `.github/workflows/ci.yml` job `quality`, mengikuti aturan file itu sendiri bahwa urutan step mencerminkan `check` di `package.json`.

6. **Review manusia untuk dokumen mengikat:** untuk `docs/adr/**` dan bagian `docs/awcms/**` yang menyatakan kebijakan mengikat (RBAC/ABAC, threat model, kontrak), terjemahan Inggris yang di-generate **wajib direview manusia sebelum merge** — gate staleness memastikan EN tidak basi, tapi tidak memvalidasi akurasi makna; ketidaktepatan pada dokumen governance (mis. "wajib" vs "boleh") berisiko menggeser keputusan mengikat tanpa disadari.

## Konsekuensi

- **Positif:** `README.md` root dan dua indeks utama langsung tampil Inggris untuk pembaca eksternal tanpa mengubah satu pun path yang sudah dirujuk skill/dokumen lain (hanya kontennya yang berganti bahasa); sumber Indonesia tetap otoritatif dan tidak hilang; drift antara ID dan EN terdeteksi otomatis di CI, bukan baru ketahuan saat pembaca komplain isinya beda.
- **Trade-off:** setiap perubahan pada dokumen yang sudah mengadopsi pola ini menambah satu langkah (regenerasi EN + update penanda hash) sebelum CI hijau; migrasi ~40 dokumen isi `docs/awcms/**` ke pola ini adalah backlog terpisah yang belum dijadwalkan oleh ADR ini.
- **Netral:** `api-reference.md` (artefak ter-generate dari OpenAPI) sengaja **di luar skop** kebijakan ini — bila perlu dwibahasa, jalurnya adalah menerjemahkan deskripsi di spec OpenAPI sumber, bukan menerjemahkan artefak yang di-generate ulang setiap kali.

## Alternatif yang dipertimbangkan

- **Menerjemahkan seluruh `docs/awcms/**`/`docs/adr/**` sekaligus dalam satu perubahan** — ditolak: ~30.000 baris tanpa jalur review bertahap berisiko tinggi salah terjemah pada dokumen mengikat, dan tidak realistis diverifikasi dalam satu putaran.
- **Panggilan API terjemahan langsung di CI (live translation setiap push)** — ditolak: menambah secret/biaya/dependency jaringan baru untuk repo yang sejauh ini sengaja offline-first-safe di jalur intinya; juga menghasilkan terjemahan tanpa jeda review sebelum ter-publish sebagai default, berisiko untuk dokumen mengikat (lihat keputusan #6).
- **Direktori paralel (`docs/awcms/en/*.md`) alih-alih akhiran `.id.md`** — ditolak untuk dokumen "pintu depan": `README.md` root secara khusus HARUS berada di path itu agar GitHub merender Inggris sebagai default; pola direktori tidak mencapai itu untuk README root. Akhiran `.id.md`/bare `.md` dipilih agar satu konvensi berlaku konsisten baik untuk README root maupun dokumen `docs/**` mana pun yang bermigrasi berikutnya.
- **Frontmatter `lang:` tanpa file terpisah (satu file, banyak blok bahasa)** — ditolak: membuat setiap file dua kali lebih panjang dan sulit di-diff per bahasa; dua file terpisah memberi git history yang bersih per bahasa dan memudahkan hash-based staleness check.
