🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0100-portable-text-is-the-canonical-body-format.md)

<!-- i18n-source-hash: sha256:c8f6a80dea03faf08dfde7c27ab38f69002e26a3ff6ac332c5bc608f4c7260d9 -->

# ADR-0100 — Portable Text adalah format badan kanonik, dan kosakatanya tetap TERTUTUP

- **Status:** Accepted
- **Tanggal:** 2026-08-19
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.id.md) (admission), [ADR-0044](0044-merge-news-portal-into-blog-content.id.md) (`blog_content` memiliki badan artikel), [ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.id.md) (kontrak konsumen yang dibekukan), Issue #588, `src/modules/blog-content/domain/`

## Konteks

Sebuah paragraf di `blog_content` adalah `{ type: "paragraph", text: string }`.

Satu string. Tidak ada cara menebalkan satu kata, memiringkan satu frasa, atau menaruh tautan di dalam kalimat. Bukan "belum ada editornya" — **tidak ada tempatnya di dalam data**. Setiap artikel yang pernah disimpan CMS ini adalah prosa tanpa gaya, dan tidak ada editor yang bisa mengubahnya, karena `ContentBlock` tidak mengenal rentang inline.

Untuk platform berita ini bukan kemewahan yang hilang. Berita yang tidak bisa menautkan peraturan yang dibahasnya, atau menegaskan satu angka yang penting, dirender lebih buruk daripada bahan yang menjadi sumbernya.

Perbaikan yang tampak jelas — "izinkan sedikit HTML di `text`" — justru satu-satunya hal yang tidak boleh terjadi. `content-validation.ts` **MENOLAK** `<script>`, `<iframe>`, `<embed>`, `<object>`, atribut handler inline dan `javascript:` alih-alih menyanitasinya, dan union `ContentBlock` yang tertutup itulah yang membuat "tidak ada field tempat markup sembarang bisa hidup" menjadi benar. Membuka badan artikel ke markup berarti menukar properti keamanan nyata dengan fitur pemformatan.

## Keputusan

1. **Portable Text menjadi format badan kanonik**, disimpan di kolomnya sendiri `body_portable_text jsonb` pada post, page dan revision (`sql/134`).

2. **Kosakatanya TERTUTUP.** Portable Text sebagaimana dipakai ekosistem luas bersifat terbuka: `_type` apa pun sah, dan konsumen diharapkan mengabaikan yang tidak dikenalnya. Keterbukaan itu persis yang akan melarutkan properti di atas. Jadi setiap tipe node, gaya blok, jenis list, dekorator dan tipe anotasi dienumerasi di `domain/portable-text.ts`, masing-masing dilas ke union TypeScript-nya lewat assertion mutual-assignability, dan apa pun di luar itu **ditolak saat tulis**, bukan sekadar gagal dirender.

   Yang didapat dibanding union lama adalah **struktur inline**, bukan keleluasaan menambah. Menambah tipe node adalah perubahan sengaja dengan validasinya sendiri, bukan payload yang bisa dikarang penulis.

3. **`content_text` menjadi TURUNAN sisi server dan tidak lagi diterima dari request.** Hari ini ia field wajib yang divalidasi TERPISAH dari `contentJson`, **tanpa satu pun pemeriksaan bahwa keduanya cocok** — jadi pemanggil bisa mengirim badan tentang satu subjek dan teks pencarian tentang subjek lain, dan indeks pencarian mempercayai teks pencariannya. Menurunkannya menutup celah itu secara konstruksi, bukan lewat pemeriksaan konsistensi yang harus diingat setiap penulis.

   Ini membuat perubahan API bersifat **breaking**, dan rilisnya major. Menyatakannya terang-terangan lebih murah daripada bump minor yang menghapus field wajib.

4. **`content_json` bertahan sebagai amplop non-badan, dan `content_json.blocks` TETAP DITULIS sebagai PROYEKSI TURUNAN.** Ini keputusan yang salah diambil oleh cutover naif, dan alasannya berada di luar repo ini:

   - `ahliweb/awcms-astro` membaca badan dari `contentJson.blocks`, dan
   - renderer-nya mengembalikan string kosong untuk non-array alih-alih gagal, dan
   - ia menyimpan sidecar terstruktur yang tak berkaitan di `contentJson.awcmsAstro` — langkah prosedur, biaya, dasar hukum, FAQ.

   Jadi menjatuhkan `blocks` akan membuat situs itu merender **setiap artikel sebagai halaman kosong dengan build tetap hijau**, dan mengganti amplopnya akan **menghapus sidecar** itu. Tidak satu pun kegagalan itu mengumumkan dirinya.

   Proyeksi ini adalah keluaran, bukan sumber kebenaran kedua: tidak ada di repo ini yang membaca `blocks`, dan suntingan padanya dibuang pada penyimpanan berikutnya. Ia **lossy secara konstruksi** — kosakata lama tidak punya mark, jadi tebal, miring, code dan tautan mendatar menjadi teks polos saat menyeberang — dan itu dapat diterima justru karena kolom kanoniknya menyimpannya.

5. **Proyeksi dihapus ketika `awcms-astro` membaca `bodyPortableText` langsung.** Itu pull request di repo sebelah, dilacak di Issue #588. Ia tidak bisa dikerjakan dari sini, dan penulis kompatibilitas ini bertahan sampai itu terjadi.

6. **Backfill adalah SKRIP, bukan DML migrasi.** `sql/134` menambah kolom dengan default `'[]'` dan tidak lebih. `awcms_blog_posts` ber-`FORCE ROW LEVEL SECURITY`, dan DML di dalam migrasi terhadap tabel FORCE RLS hijau di CI kosong lalu jebol di produksi. `bun run blog:portable-text:backfill` mengikuti preseden `idn-regions:import`: **dry-run secara bawaan**, `--commit` menulis, dan melaporkan apa yang dikonversinya.

## Konsekuensi

- Redaksi mendapat tebal, miring, code, tautan, heading, kutipan dan list dengan mark inline — pertama kalinya semua itu bisa diungkapkan.
- Postur XSS tidak berubah jenisnya dan menguat derajatnya: `_type` tak dikenal kini ditolak saat tulis alih-alih diam-diam tak dirender, dan `href` tautan diperiksa skemanya lewat parsing `URL` (bukan regex, yang justru jalan masuknya `java\nscript:`) saat tulis **dan** di-escape saat render.
- `awcms-astro` tetap berjalan tanpa rilis terkoordinasi, dan kehilangan pemformatan sampai ia bermigrasi — defisit yang terlihat dan bisa dipulihkan, bukan halaman kosong yang senyap.
- Konversinya **deterministik**, jadi backfill bisa dijalankan ulang setelah gagal separuh tanpa menulis ulang setiap baris dengan key baru.
- Satu hal sengaja TIDAK diklaim: `portable_text -> blocks -> portable_text` **bukan** round trip, dan tidak ada kode yang boleh menganggapnya begitu. Arah maju dari korpus legacy **memang** lossless, karena format lama tidak punya mark untuk hilang.

## Ditolak

- **Mengizinkan HTML di `text`.** Menukar properti keamanan dengan fitur pemformatan; lihat Konteks.
- **Portable Text terbuka.** Membuat penolakan saat tulis mustahil dinyatakan, karena "`_type` tak dikenal" akan menjadi dokumen yang sah.
- **Dual-read (`portable_text ?? convert(content_json)`).** Menaruh percabangan di tiap ~12 konsumen, dan "nanti" adalah cara sebuah seam menjadi permanen.
- **Cutover sekali jalan yang menjatuhkan `blocks`.** Mengosongkan situs sebelah secara senyap. Ini rencana awalnya, dan review atasnya adalah alasan keputusan 4 ada.
- **`underline` sebagai dekorator.** Rentang bergaris bawah yang bukan tautan adalah cacat kegunaan, dan menawarkannya menjamin ia dipakai untuk penegasan.
