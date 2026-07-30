---
"awcms": patch
---

Perbaiki katalog tag OpenAPI dan kepemilikan fragment — 55 operasi yang selama
ini hilang dari referensi API kini terdokumentasi, dan dua gerbang baru mencegah
kelas cacat ini terulang.

`scripts/api-docs-generate.ts` mengelompokkan operasi menurut tag yang
**dideklarasikan** di katalog root. Konsekuensinya tidak pernah terlihat: sebuah
operasi yang membawa tag tak-terdeklarasi tidak muncul di seksi mana pun — ia
hilang tanpa memerahkan apa pun. Itulah yang terjadi pada empat modul sekaligus.
`docs/awcms/api-reference.md` tidak memuat **satu pun** operasi REST milik
`blog_content` (30 path), `visitor_analytics` (12), `tenant_domain` (7), dan
`data_lifecycle` (6), meski bundel memuat semuanya dan `bun run check` hijau.

Sisi sebaliknya sama sunyinya: katalog masih mengumumkan tag `News Portal *`
sebagai milik modul `news_portal` yang sudah dipensiunkan ADR-0044, dan
`openapi/modules/news-portal.openapi.yaml` masih ada sebagai fragment untuk
modul yang tidak lagi terdaftar. Yang membuatnya bertahan adalah tidak adanya
aturan yang menghubungkan fragment ke registry: `api.openApiPath` milik
`blog_content` dan `media_library` malah menunjuk **bundel** hasil generate,
sehingga fragment asli mereka tidak diklaim siapa pun.

Perubahan ini:

- menambah empat tag yang kurang (`Blog Content`, `Visitor Analytics`,
  `Tenant Domains`, `Data Lifecycle`) dan meng-atribusikan ulang tag
  `News Media`/`News Portal *` ke modul pemiliknya hari ini (`media_library`,
  `blog_content`). **Nama tag dan path publik sengaja tidak diubah** — mengikuti
  alasan ADR-0044 §3/§6 dan preseden ADR-0036: merge memindahkan kepemilikan,
  bukan permukaan publik;
- melebur `openapi/modules/news-portal.openapi.yaml` ke fragment
  `blog-content`, dan me-repoint `api.openApiPath` `blog_content` +
  `media_library` ke fragment mereka sendiri (ADR-0026: modul menunjuk
  fragmentnya, tak pernah bundel);
- menambah dua gerbang murni di `bun run api:spec:check`:
  `collectTagCatalogProblems` (setiap operasi ber-tag, setiap tag operasi
  terdeklarasi, **dan** setiap tag terdeklarasi dipakai — separuh kedua itulah
  yang menangkap tag modul pensiunan) dan `collectFragmentOwnershipProblems`
  (satu fragment = satu modul terdaftar, dua arah, dengan
  `foundation.openapi.yaml` sebagai satu-satunya pengecualian ter-review);
- meluruskan deskripsi `media_library` yang masih menyebut `news_portal` sebagai
  konsumen wajib yang hidup.

Bundel yang dihasilkan **tidak berubah selain katalog tag** (11 baris tambah, 3
kurang, nol path dan nol schema) — bukti bahwa pemindahan fragment tidak
menyentuh kontrak yang diterbitkan. Kedua gerbang dibuktikan MERAH dengan
mengembalikan cacat aslinya (menghapus tag `Blog Content`: 49 temuan;
mengembalikan fragment `news-portal`: 1 temuan), lalu hijau lagi setelah
dipulihkan.
