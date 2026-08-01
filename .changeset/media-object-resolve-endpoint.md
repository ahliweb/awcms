---
"awcms": minor
---

`GET /api/v1/media/objects` — resolusi referensi media batch, sehingga artikel
terbit tidak lagi kehilangan gambarnya di konsumen luar.

`awcms_blog_posts` membawa `featured_media_id` dan `seo_image_media_id`, tetapi
`media_library` **tidak mengekspos satu pun endpoint baca** — hanya upload
session dan flag enforcement. Konsumen di luar proses karena itu bisa melihat
bahwa sebuah post PUNYA gambar tanpa cara apa pun mengetahui URL-nya. Itulah
sebab `article-images.ts` di `awcms-astro` mengembalikan `src: undefined` dan
setiap artikel terbit tanpa gambarnya, sementara tidak ada satu pun yang gagal.

Logika resolusinya bukan hal baru: `MediaLibraryPort.resolveMediaReferences`
sudah melakukannya untuk konsumen in-process sejak ADR-0036. Ini panggilan yang
sama lewat HTTP, dengan aturan keamanan yang sama — hanya objek `verified` /
`attached`, satu tenant, tidak soft-deleted, yang resolve. Tanpa migrasi:
permission `media_library.media.read` sudah diseed sejak `sql/052` sambil
menunggu permukaannya (ADR-0026 langkah 5d).

Dua keputusan bentuk yang tidak sepele:

- **Batch, bukan satu-per-id.** Build feed me-resolve seluruh gambar satu halaman
  sekaligus; satu request per id membuat situs 200 post jadi ribuan round-trip,
  sementara query di bawahnya memang sudah satu `id = ANY(...)`.
- **Id yang gagal DILAPORKAN, bukan dibuang.** Mengembalikan hanya yang berhasil
  membuat "resource ini tidak punya gambar" dan "referensi gambarnya rusak"
  menjadi respons yang sama — ambiguitas yang membuat celah ini bertahan tanpa
  disadari. Semua sebab kegagalan dilebur ke satu ember (`unresolved`) supaya
  endpoint-nya tidak jadi oracle atas sebab mana; id yang bukan uuid ditolak 400
  karena "Anda mengirim sampah" adalah fakta yang berbeda.

Read-only, jadi kredensial mesin (ADR-0049) boleh memegangnya — inilah yang
melengkapi build feed.

Diverifikasi terhadap PostgreSQL nyata (7 test): objek belum-terverifikasi,
soft-deleted, dan milik tenant lain masing-masing TIDAK PERNAH resolve; batch
campuran resolve sebagian alih-alih gagal utuh; dan objek yang sama tetap
resolve dari tenant pemiliknya (memastikan kegagalan lintas-tenant itu memang
tenant scoping, bukan baris rusak).
