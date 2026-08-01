---
"awcms": patch
---

`GET /api/v1/blog/posts` mengembalikan apa yang kontraknya janjikan, dan
mendapat mode `?view=full` untuk build feed.

Kontrak OpenAPI menyatakan endpoint ini mengembalikan `BlogPost` — lengkap
dengan `contentJson`, `excerpt`, `metaDescription`, `canonicalUrl`, dan
`translationGroupId`. Implementasinya mengembalikan ringkasan yang tidak memuat
satu pun dari itu. Selisih itu tidak pernah gagal di mana pun: klien yang
mempercayai dokumen membaca field-field tersebut sebagai `undefined`.

Akibatnya nyata dan sudah terjadi. Sebuah situs `awcms-astro` membangun hijau
dengan **badan setiap artikel kosong** — dan karena seksi tempat artikel berada
juga tinggal di dalam `contentJson`, **seluruh seksinya kosong juga**. Tidak ada
error di build mana pun, tidak ada 4xx, tidak ada baris log.

Tiga perubahan:

- **`?view=full`** mengembalikan baris penuh (`BlogPost`) dengan cursor keyset
  yang sama, batas halaman 50 karena barisnya membawa `contentJson`. Ia
  **mensyaratkan** `order=created_at`: traversal penuh hanya sehat di atas
  urutan yang tidak berubah, dan syaratnya dinyatakan alih-alih diam-diam
  disubstitusi — sikap yang sama seperti penolakan `cursor` atas urutan mutable.
  Tanpa mode ini, satu-satunya cara membangun situs adalah menyusuri daftar lalu
  mengambil ulang setiap post satu per satu (N+1 permintaan per build, ke
  endpoint admin, pada setiap publish).
- **`translationGroupId` kini benar-benar dikembalikan** — oleh `view=full`
  maupun `GET /api/v1/blog/posts/{id}`. Kolomnya sudah ada dan bisa ditulis
  sejak awal, tetapi tidak satu pun endpoint baca mengembalikannya, sehingga
  klien bisa menyetel pasangan terjemahan dan tidak pernah bisa membacanya lagi.
- **Bentuk ringkasannya dinyatakan sebagai skema tersendiri**
  (`BlogPostSummary`) alih-alih dibiarkan disimpulkan pembaca. Dokumen yang
  menjanjikan lebih dari yang dikirim kode adalah dokumen yang membuat klien
  salah dengan yakin.

Validasi query dipindahkan ke `parseBlogPostListQuery` (domain, murni) supaya
setiap penolakan punya tes tanpa basis data — sebelumnya ia inline di route dan
tidak bisa dijangkau tes mana pun tanpa sesi dan Postgres.
