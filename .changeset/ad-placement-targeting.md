---
"awcms": minor
---

ADR-0044 §4 Fase 2, langkah pertama: `awcms_news_portal_ad_placements` kini
punya targeting (`target_type` global/widget/post/page + `target_id`), sehingga
ia bisa menyatakan segala yang bisa dinyatakan sistem iklan free-URL yang akan
dipensiunkan.

Penggabungan ADR-0044 meninggalkan `blog_content` memiliki DUA sistem iklan,
masing-masing punya kemampuan yang tidak dimiliki lawannya. Yang lama menerima
`image_url` bebas — URL apa pun, tanpa registry media — tetapi bisa menarget
post dan page. Yang baru mengikat `media_object_id` sebagai foreign key ke objek
media terverifikasi, tetapi setiap barisnya efektif site-wide.

Yang berbasis media adalah yang bertahan, karena `image_url text` persis
merupakan jalan pintas yang dituju ADR-0036 saat membalik kepemilikan media.
Tetapi menghapus yang lama LEBIH DULU akan diam-diam memusnahkan targeting
per-post dan per-page — iklan yang dibeli untuk satu artikel berhenti muncul,
tanpa satu pun error. Karena itu pelebaran ini berdiri sendiri, sebelum satu
baris pun dipindahkan.

Migrasi 078 SENGAJA tidak memindahkan data dan tidak menghapus tabel. Ingest
`awcms_blog_ads.image_url` ke `media_library` (dengan laporan residu yang bisa
di-dry-run) dan penghapusan kedua tabel lama adalah langkah terpisah
berikutnya, dalam urutan itu.

- `placement_key` tetap SLOT (di mana pada halaman); `target_type`/`target_id`
  adalah SCOPE (halaman mana). Keduanya ortogonal.
- Render sebuah halaman mengembalikan iklan bertarget halaman itu DIGABUNG
  dengan setiap iklan `global` untuk slot yang sama — perbaikan yang disengaja
  atas sistem lama yang mencocokkan satu scope persis dan menyerahkan
  penggabungan ke pemanggil.
- Aturan berpasangan (`target_id` wajib untuk tipe bertarget, terlarang untuk
  `global`) adalah CHECK di basis data, bukan hanya di validator seperti tabel
  lama. Diuji dengan INSERT sebagai peran admin — penulis yang persis tidak bisa
  dijangkau aturan tingkat-aplikasi.
- `target_id` polimorfik (post/page/widget), jadi tidak ada foreign key yang
  bisa menjangkaunya. Keberadaannya diperiksa saat tulis; target yang dihapus
  KEMUDIAN bukan error dan tidak pernah menjadi error — barisnya sekadar
  berhenti cocok.
- Baris yang ditulis dengan bentuk pra-078 bernilai `global`, jadi tidak ada
  iklan lama yang berubah perilakunya. Dibuktikan terhadap PostgreSQL 16 nyata,
  bukan disimpulkan dari default kolom.
