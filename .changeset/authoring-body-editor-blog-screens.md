---
"awcms": patch
---

fix(admin): CMS ini akhirnya bisa menerbitkan artikel lewat layarnya sendiri — form create mengirim `contentText: ""` ke validator yang menolaknya

`/admin/blog` dan `/admin/blog-pages` mengirim `contentJson: {}` dengan
`contentText: ""`, di bawah legenda yang menjanjikan editor body "belum bagian
dari layar ini". `validateContentTextField` mewajibkan `contentText` tak-kosong,
jadi **setiap** create dari kedua layar dijawab 400: tidak ada satu pun artikel
atau halaman yang pernah bisa dibuat lewat UI-nya sendiri.

Perbaikannya adalah INPUT yang hilang, bukan validator yang dilonggarkan.
`content-quality-checklist.ts` tidak punya aturan "body ada", jadi melemahkan
`validateContentTextField` akan membuat post yang benar-benar kosong lolos
sampai `publish`.

- **`<textarea>` body** pada form create kedua layar, dikonversi oleh
  `src/lib/ui/blog-body-editor.ts` menjadi `{ blocks: [{ type: "paragraph",
  text }] }` — bentuk yang didefinisikan `content-block-rendering.ts`, bukan
  bentuk karangan sendiri. Tipe `ParagraphBlock` di-`Extract` dari union modul
  itu, sehingga perubahan di sana gagal di typecheck, bukan diam-diam
  menghasilkan blok yang tak dirender siapa pun.
- **Jalur PATCH**: `/admin/blog` tidak punya form edit sama sekali (`grep -c
  PATCH` = 0), jadi post yang sudah ada hanya bisa disunting lewat `curl`.
  Kini ada form edit ber-`?edit=<id>`, mengikuti pola `/admin/blog-pages` yang
  sudah ada (partial update, tanpa `Idempotency-Key` — kedua endpoint memang
  menolaknya). Form edit `/admin/blog-pages` ikut mendapat body dan excerpt.
- **Editor MENOLAK menyunting body** yang memuat blok di luar `paragraph`
  (gallery, video embed). Blok-blok itu tak punya permukaan authoring di repo
  ini, dan textarea yang menulis ulangnya sebagai paragraf akan
  **menghancurkannya** pada simpan pertama. `readParagraphBodyText` menjawab
  `null`, dan layar tidak merender field body sama sekali untuk baris itu.
- **Pesan galat menyebut field yang benar.** Sebelumnya setiap kegagalan
  dijawab "Check the title and slug" — justru dua field yang selalu BENAR,
  sementara yang ditolak API adalah `contentText`. `sendJsonWithFieldErrors`
  membaca `error.details` yang `sendJson` sengaja buang, dan hanya NAMA field
  yang ditampilkan lewat peta label layar (bukan teks pesan server). Cabang
  konflik slug juga diperbaiki: kode yang dikirim endpoint adalah
  `SLUG_CONFLICT`, sedangkan layar memeriksa `CONFLICT` yang tak pernah cocok.

Baris `?edit=` divalidasi sebagai UUID di frontmatter: `fetchBlogPostById`
mengikatnya sebagai `uuid`, dan `?edit=nonsense` akan membatalkan transaksi
sehingga seluruh layar menjadi "posts could not be loaded" — "daftarnya rusak"
untuk sesuatu yang sebenarnya "tidak ada post itu".

Skrip klien tetap DIIMPOR (dua modul baru di `src/lib/ui/`), bukan inline:
CSP `default-src 'self'` tanpa `'unsafe-inline'` memblokir `<script>` yang
di-inline Astro saat tak ada import. Diverifikasi dari `dist/`: keduanya
ter-emit sebagai `/_astro/*.js` eksternal, dan `import type` membuat renderer
`content-block-rendering.ts` tidak ikut ke bundle browser.

Penugasan taksonomi (`termIds`) TETAP absen di `/admin/blog`: picker-nya butuh
katalog taksonomi, dan membacanya di bawah gerbang `posts.*` layar ini adalah
pembacaan tanpa permission sendiri. `blog_content.taxonomies.read` milik
`/admin/blog-taxonomy`, dan `tests/admin-blog-page-contract.test.ts` mengunci
layar ini pada sebelas key — meminjam satu harus jadi keputusan yang ditulis di
berkas itu.
