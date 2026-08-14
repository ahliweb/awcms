🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0097-english-is-the-source-language.md)

<!-- i18n-source-hash: sha256:c99711f542cc9059dbe6e0dfbe0c77a0557687e13d799842e6b36cddefe15f96 -->

# ADR-0097 — Inggris adalah bahasa sumber; Indonesia adalah cerminannya

- **Status:** Accepted
- **Tanggal:** 2026-08-15
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0023](0023-bilingual-docs-indonesian-source-english-default.md) (di-supersede sebagian — keputusan 1 dan 2), `scripts/check-docs-translation.mjs`, `scripts/lib/docs-i18n-checks.mjs`, `scripts/docs-i18n-stamp.mjs`

## Konteks

ADR-0023 memutuskan bahwa Bahasa Indonesia di `<nama>.id.md` adalah sumber otoritatif dan Inggris di path bare `<nama>.md` adalah hasil generate yang tampil sebagai default, lalu menerapkannya pada tepat tiga dokumen pintu depan. Sisanya ia tulis lepas secara eksplisit: migrasi dokumen isi adalah "backlog terpisah yang belum dijadwalkan oleh ADR ini".

Backlog itu tidak pernah dijadwalkan, dan hasilnya adalah keadaan saat ADR ini ditulis. Dari 260 dokumen dalam cakupan, **empat** mengikuti konvensinya. **253 sisanya adalah prosa Indonesia yang duduk di path bare yang oleh konvensi itu dijanjikan berbahasa Inggris** — termasuk setiap ADR, `PROJECT_STATE.md`, seluruh 55 skill, dan setiap README modul. Pembaca yang menuruti aturan repo ini sendiri lalu membuka `<nama>.md` sambil mengharapkan Inggris akan mendapat Indonesia 97% dari waktunya.

Dua hal berubah sejak ADR-0023:

**Audiensnya bergeser.** Skill dibaca oleh agen coding, bukan hanya manusia. `.claude/skills/**` berisi 13.000 baris instruksi operasional, dan skill yang salah baca menghasilkan pekerjaan yang SALAH, bukan sekadar kebingungan — repo ini sudah mencatat skill yang klaim basinya mengirim agen ke arah yang keliru, terakhir satu yang menyatakan sebuah role database tidak ada padahal ada.

**Arahnya adalah paruh yang mahal.** ADR-0023 mempertahankan Indonesia sebagai otoritatif supaya penulis aslinya tak perlu berganti bahasa. Tetapi penanda hidup di sisi yang di-generate, jadi setiap suntingan pada berkas Indonesia yang otoritatif membuat Inggrisnya basi — dan Inggris itulah yang dilihat sebagian besar pembaca dan SEMUA agen. Menaruh sumber di bahasa yang lebih sedikit dibaca berarti salinan yang benar-benar dibaca orang adalah salinan yang diizinkan melenceng.

## Keputusan

1. **Inggris di path bare `<nama>.md` adalah sumber otoritatif.** Ia ditulis dan disunting tangan, dan ia yang didapat pembaca atau agen secara default. Indonesia di `<nama>.id.md` adalah cerminannya.

2. **Penanda staleness pindah ke cerminan.** `<!-- i18n-source-hash: sha256:<hex> -->` tinggal di `<nama>.id.md` dan mencatat hash dari `<nama>.md`. Selebihnya mekanisme ADR-0023 tidak berubah: gerbangnya MENDETEKSI drift, ia tidak menerjemahkan, dan tidak ada panggilan API terjemahan dari CI.

3. **Cakupannya seluruh korpus, bukan pintu depan.** Setiap dokumen ter-track di bawah `docs/**`, `.claude/skills/**`, `src/**/README.md`, `scripts/README.md`, dan `README.md` root dicerminkan. Dokumen yang bahasanya ditentukan generator atau spec hulu — `api-reference.md` (dari field `description` OpenAPI), `repo-inventory.md`, `agent-memory.md` — dikecualikan dari pencerminan TANGAN; membuatnya Inggris adalah perubahan pada generator atau spec-nya, yang memang sudah ditunjuk ADR-0023 untuk `api-reference.md`.

4. **Migrasinya adalah ledger yang hanya boleh MENYUSUT, bukan niat.** `DOCS_AWAITING_MIRROR` di `scripts/check-docs-translation.mjs` menamai seluruh 253 dokumen yang tertunggak. Entri dihapus seiring dokumen diterjemahkan; gerbangnya menolak entri yang cerminannya sudah ada, jadi ledger tak bisa melebih-lebihkan utang, dan tak ada yang boleh ditambahkan — dokumen yang ditulis setelah ADR ini ditulis dalam Inggris dan dicerminkan dalam perubahan yang sama. Ini instrumen yang dipakai ADR-0094 membawa ledger subjek data dari 139 ke 0.

5. **Cakupan dan kesegaran adalah dua pemeriksaan terpisah.** "Apakah cerminan ini masih segar?" dan "dokumen mana yang belum punya cerminan sama sekali?" adalah pertanyaan berbeda. Dokumen tanpa cerminan tidak punya pasangan untuk menjadi basi, jadi menggabungkannya akan melahirkan gerbang yang terbaca hijau sementara mayoritas korpusnya belum diterjemahkan.

6. **Keputusan 3, 4, 5, dan 6 ADR-0023 tetap berlaku.** Banner bahasa timbal-balik, gerbang staleness alih-alih terjemahan mesin, wiring ke `bun run check`, dan — yang penting — **review manusia atas Inggris untuk dokumen mengikat** (ADR, dan bagian `docs/awcms/**` yang menyatakan kebijakan mengikat). Gerbangnya membuktikan sebuah terjemahan tidak basi; ia tidak bisa membuktikan terjemahan itu setia, dan pada dokumen tata kelola perbedaan antara "wajib" dan "boleh" menggeser keputusan yang mengikat.

## Konsekuensi

- **Positif:** berkas yang dibuka setiap pembaca dan setiap agen secara default adalah yang otoritatif, sehingga salinan yang melenceng adalah salinan yang lebih sedikit dibaca — kebalikan dari susunan sebelumnya. Migrasinya terukur alih-alih aspiratif, dan tak bisa mandek diam-diam.

- **Trade-off, dan ini yang sesungguhnya:** setiap perubahan dokumentasi kini berbiaya dua tulisan, karena cerminannya wajib diterjemahkan ulang dalam perubahan yang sama atau CI merah. Untuk 260 dokumen itu pajak permanen, yang di sini diterima secara sadar. ADR-0023 menandai ongkos yang sama untuk tiga dokumen; ADR ini mengambilnya untuk semuanya.

- **Trade-off:** penulis aslinya menulis dalam Bahasa Indonesia. Menjadikan Inggris otoritatif meminta mereka mengarang dalam bahasa kedua, atau menerjemahkan draf mereka sendiri ke depan. Itulah ongkos dari membuat salinan default menjadi salinan otoritatif, dan itu sebabnya syarat review manusia pada keputusan 6 dipertahankan, bukan dilonggarkan.

- **Netral:** 253 dokumen tetap Indonesia di path bare-nya sampai entri ledger-nya dibersihkan. Selama migrasi, konvensinya benar untuk himpunan bagian yang membesar alih-alih untuk semuanya — persis keadaan yang ditinggalkan ADR-0023; bedanya, kini ia terhitung, dan hitungannya hanya boleh turun.
