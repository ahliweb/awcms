# ADR-0057 — Siklus hidup page `blog_content`: page yang tidak pernah bisa terbit

- **Status:** Accepted
- **Tanggal:** 2026-08-02
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) (seluruh layar admin dibangun di sini), [ADR-0056](0056-media-library-admin-surface.md) (preseden: permukaan dulu, layar belakangan), [ADR-0044](0044-merge-news-portal-into-blog-content.md) (`blog_content` menyerap `news_portal`; layar admin disebut sebagai pekerjaan tersisa terbesar)

## Konteks

[ADR-0044](0044-merge-news-portal-into-blog-content.md) menutup dengan kalimat
bahwa layar admin `blog_content` "land one issue per screen". `/admin/blog`
(#340) mengambil siklus hidup post — sebelas dari 43 permission — dan
descriptor modul mencatat lima layar saudara yang menyusul: **pages**, taxonomy,
presentation, settings, homepage composition.

Audit permukaan `pages.*` sebelum menulis layar itu menemukan hal yang sama
dengan yang ADR-0056 temukan pada `media_library`, dan lebih tajam.

### 1. Empat dari delapan permission `pages.*` tidak digerbangi apa pun

`sql/036` men-seed delapan permission `pages.*` ke katalog global, dan
descriptor mendeklarasikan kedelapannya. Empat punya penegak nyata:

| Permission     | Penegak                                                      |
| -------------- | ------------------------------------------------------------ |
| `pages.read`   | `GET /api/v1/blog/pages`, `/{id}`, `/{id}/quality-checklist` |
| `pages.create` | `POST /api/v1/blog/pages`                                    |
| `pages.update` | `PATCH /api/v1/blog/pages/{id}`                              |
| `pages.delete` | `DELETE /api/v1/blog/pages/{id}`                             |

**Empat tidak punya sama sekali:** `pages.publish`, `pages.archive`,
`pages.restore`, `pages.purge`. Tidak ada route, tidak ada fungsi aplikasi,
tidak ada job yang memeriksanya. Keempatnya di-grant ke role `owner` tiap tenant
baru dan tidak ada satu pun jalur kode yang membacanya.

### 2. Lubangnya lebih dalam dari route — lapisan aplikasi juga tidak punya

Pada `media_library` tiga fungsi lifecycle sudah ditulis dan sekadar tak
dipanggil. Di sini fungsinya **tidak ada**. `application/blog-page-directory.ts`
mengekspor `createBlogPage`, `fetchBlogPageById`, `listBlogPages`,
`listBlogPagesForAdmin`, `updateBlogPage`, dan `softDeleteBlogPage` — itu saja.
Header berkasnya sendiri mencatat kenapa:

> Pages get plain CRUD only (no publish/schedule/archive/restore/purge lifecycle
> actions … those permissions are already seeded (#537) for a future issue to
> wire up, not this one).

Issue lanjutan itu tidak pernah datang. Yang tertinggal adalah katalog
permission yang menjanjikan siklus hidup dan kode yang tak punya satu pun
langkahnya.

### 3. Akibatnya: setiap page permanen `draft`, dan halaman publik permanen kosong

Ini bagian yang mengubah temuan dari "permission menganggur" menjadi cacat
fungsional, dan ia bisa dibuktikan dari tiga baris kode:

- `createBlogPage` menulis `status` sebagai literal `'draft'`;
- `updateBlogPage` tidak menyentuh `status` maupun `published_at`, dan
  `UpdateBlogPageInput` tidak punya field-nya;
- `blog-scheduled-publish.ts` hanya menyentuh `awcms_blog_posts`.

Tidak ada penulis lain untuk `awcms_blog_pages.status` di seluruh repo. **Sebuah
page karena itu tidak pernah bisa meninggalkan `draft`.**

Konsekuensinya sudah hidup di permukaan publik hari ini:
`blog-search.ts` menyaring cabang page dengan
`status = 'published' AND visibility = 'public' AND published_at IS NOT NULL`,
sehingga **hasil pencarian publik untuk page selalu nol baris**, berapa pun
banyak page yang dibuat tenant. `sql/035` bahkan membuat index
`awcms_blog_pages_tenant_status_published_idx` pada `(tenant_id, status,
published_at DESC)` — index untuk query terbit yang tidak pernah bisa
mengembalikan apa pun.

### 4. Tidak ada gerbang yang menangkap kelas cacat ini

`tests/admin-navigation-registry.test.ts` menangkap entri navigasi yang
path-nya tak punya halaman. `tests/admin-*-page-contract.test.ts` mengikat key
halaman ke yang route tegakkan. Tidak satu pun bertanya **"apakah tiap
permission ter-seed punya penegak"** — pertanyaan yang, bila ditanyakan, akan
memerahkan `media_library` (lima) dan `blog_content` (empat) sekaligus, jauh
sebelum keduanya jadi temuan audit manual.

## Keputusan

### A. Page mendapat siklus hidup, bukan pencabutan

Keempat permission tak-tergerbangi itu **diberi permukaan**, bukan dicabut.
Alasannya bukan simetri dengan post melainkan bahwa alternatifnya memutuskan
sesuatu yang tak seorang pun bermaksud putuskan: mencabut `pages.publish`
berarti menyatakan page memang selamanya draft — yaitu memberkati cacat nomor 3
sebagai desain, sementara index, kolom, CHECK constraint, dan penyaring
pencarian publik semuanya ditulis dengan asumsi sebaliknya.

Ini kebalikan dari putusan ADR-0056 §A untuk `attach`/`detach`, dan bedanya
bermakna: attach/detach usang karena ADR lain memindahkan kepemilikannya ke
tempat lain yang bekerja. Tidak ada tempat lain yang menerbitkan page.

### B. Siklus hidupnya lebih sempit dari post: tanpa `scheduled`, tanpa `review`

Post punya lima status dan permission `posts.schedule` tersendiri. Page **tidak
punya `pages.schedule`** — dan itu keputusan yang sudah dibuat `sql/036`, bukan
kelalaian yang perlu ditambal. Transisi yang diizinkan untuk page:

```
draft ──────► published ──────► archived
  ▲               │                 │
  └───────────────┴─────────────────┘
```

`review` dan `scheduled` **tidak** dipakai untuk page, meskipun CHECK
`awcms_blog_pages_status_check` menerimanya (kolom itu dibuat identik dengan
post di `sql/035`). Aturan transisi tinggal di `domain/`, terpisah dari
`ALLOWED_STATUS_TRANSITIONS` milik post, karena keduanya kini **memang** aturan
yang berbeda — membaginya berarti satu tabel yang benar untuk satu pemanggil dan
terlalu longgar untuk yang lain.

Alasan substansinya: page adalah konten struktural situs (about, kontak,
kebijakan privasi). Alur editorial "ajukan untuk direview" dan penerbitan
terjadwal adalah kebutuhan redaksi berita, dan `blog_content` sudah punya
keduanya di tempat yang benar — pada post. Menyalin keduanya ke page berarti
menambah dua permission yang harus di-seed, digerbangi, dan dilayari untuk alur
kerja yang belum ada yang minta.

### C. `purge` page memakai prasyarat yang sama dengan post

`canPurgePost` menuntut baris sudah soft-deleted **atau** berstatus `archived` —
"purge dilarang untuk konten terbit kecuali diarsipkan atau dihapus lunak
dahulu". Aturan itu berlaku untuk page tanpa perubahan, dan dipakai ulang alih-alih
ditulis kembali.

**Rujukan ad placement yang menggantung TIDAK memblokir purge**, dan itu bukan
kelonggaran melainkan kontrak yang modul ini sudah tetapkan.
`awcms_news_portal_ad_placements` menargetkan page lewat pasangan
`target_type = 'page'` dan `target_id` polimorfik yang, karena tak ada FK yang
bisa menjangkau tiga tabel, hanya diperiksa **saat tulis** oleh
`application/ad-placement-reference-validation.ts`. Header berkas itu sudah
memutuskan apa artinya bila target hilang belakangan:

> A target deleted LATER is not an error and never becomes one. The render
> query joins nothing on `target_id`, so the ad simply stops matching —
> degrade, don't error.

Dan itu benar sampai ke query-nya: `listActiveAdPlacementsForRendering`
mencocokkan `p.target_id = ${targetId}` dengan id **page yang sedang dirender**.
Page yang sudah di-purge tidak pernah dirender, jadi placement-nya tidak pernah
dicocokkan — ia menjadi inert, bukan rusak. Soft delete, yang sudah ada hari ini
dan tak digerbangi apa pun soal ini, punya efek render yang **persis sama**.
Purge karena itu tidak memperkenalkan mode kegagalan baru.

> **Koreksi terhadap draf pertama ADR ini.** Draf itu memutuskan purge
> **menolak dengan 409** selama ada ad placement menargetkan page tersebut.
> Itu salah, dan salahnya bukan soal selera: ia menolak sebuah operasi demi
> mencegah kondisi yang modul ini sudah nyatakan tak berbahaya, dan akan
> membuat operator terhalang menghapus page oleh iklan yang toh sudah berhenti
> tampil. Ditemukan dengan membaca `ad-placement-reference-validation.ts` dan
> query render-nya, bukan dengan menalar dari bentuk skema — pelajaran yang
> sama yang §4 catat tentang memindai route saja.

Yang purge **wajib** lakukan adalah membuat perubahan itu terlihat: responsnya
membawa jumlah ad placement yang kini menargetkan page yang tiada. Sebuah baris
yang diam-diam menjadi inert adalah persis "menghilang tanpa catatan" yang
ADR-0044 §4 tolak untuk iklan yang tak bisa dimigrasikan. Melaporkan bukan
menolak — operator melihat akibatnya tanpa dihalangi olehnya.

### D. Nol migrasi

Tidak ada migrasi dalam perubahan ini, dan itu bukan kebetulan yang beruntung
melainkan konsekuensi dari bentuk cacatnya:

- delapan permission sudah di-seed (`sql/036`) — tidak ada yang ditambah atau
  dicabut;
- `awcms_blog_pages` sudah punya `status`, `published_at`, `scheduled_at`,
  `deleted_at`/`deleted_by`/`delete_reason`, `restored_at`/`restored_by`, dan
  `version` (`sql/035`);
- CHECK dan index yang dibutuhkan sudah ada.

Yang hilang selama ini murni lapisan aplikasi dan route. Sebuah migrasi di sini
justru akan menjadi tanda bahwa sesuatu salah dibaca.

### E. Urutan: permukaan dulu, layar belakangan

Mengikuti ADR-0056 persis:

1. **ADR ini.**
2. **Permukaan** — `transitionBlogPageStatus`, `restoreBlogPage`,
   `purgeBlogPage` di `blog-page-directory.ts`, plus
   `POST /api/v1/blog/pages/{id}/publish`, `/archive`, `/restore`, `/purge`,
   ter-guard, ter-audit, ber-`Idempotency-Key`, dengan OpenAPI sinkron.
3. **Layar** `/admin/blog/pages` menggerakkan **kedelapan** permission, dengan
   entri `navigation` mendarat di PR yang sama dan contract test per-halaman
   yang mutation-proven.

Layar tidak mendahului permukaan. Konsol yang bisa membuat dan menyunting page
tapi tak pernah bisa menerbitkannya adalah jalan buntu yang terlihat seperti
fitur.

### F. Gerbang untuk kelas cacatnya, bukan hanya untuk instansnya

Dua modul kini pernah mengirim permission ter-seed tanpa penegak, dan keduanya
ditemukan hanya karena seseorang hendak membangun layarnya. Perubahan permukaan
(langkah 2) membawa serta sebuah gate yang **tidak** spesifik `blog_content`:
setiap permission yang dideklarasikan descriptor modul **mana pun** harus punya
call site `authorizeInTransaction`, atau terdaftar sebagai pengecualian
ber-alasan. Ia berjalan sebagai bagian `bun run check` dan tidak menyentuh
database — pertanyaannya seluruhnya bisa dijawab dari registry modul dan sumber
`src/`.

Dua pengecualian yang sudah diketahui dan akan didaftarkan sejak awal, keduanya
sudah tercatat di `/admin/blog`:

- `blog_content.posts.export` — dideklarasikan dan di-seed, tak ada endpoint
  mana pun yang menegakkannya (kandidat pencabutan, ADR tersendiri);
- gerbang yang hidup di dalam fungsi aplikasi alih-alih berkas route
  (`media.verify` di `media-finalize-upload-session.ts`) — bukan pengecualian
  melainkan alasan gate harus memindai `src/` seluruhnya, bukan `src/pages/api/`
  saja.

## Konsekuensi

- **Tidak ada perubahan otorisasi.** Katalog tidak bergerak; empat permission
  yang selama ini tak diperiksa mulai diperiksa. Tenant yang sudah memegangnya
  memperoleh kemampuan yang selama ini dijanjikan role-nya.
- **Perubahan perilaku yang terlihat pengguna:** page bisa terbit. Hasil
  pencarian publik untuk page berhenti selalu-kosong, dan `seo_facts`/sitemap
  konsumen akan mulai melihat page terbit — yang benar, dan yang harus
  disebut di changeset sebagai `minor`, bukan `patch`.
- **`purge` melaporkan, tidak menolak.** Responsnya membawa jumlah ad placement
  yang kini menargetkan page yang tiada — field baru yang harus ada di OpenAPI.
  Tidak ada kode error baru untuk kasus itu, dan itu memang keputusannya.
- **Empat layar saudara masih tersisa** setelah ini (taxonomy, presentation,
  settings, homepage composition). Sejauh audit ini, permukaan keempatnya
  lengkap — seluruhnya pasangan `read`/`configure` yang punya route. Gate §F
  akan mengubah "sejauh audit ini" menjadi klaim yang dijaga.

## Alternatif yang ditolak

- **Bangun layar CRUD sekarang, lifecycle nanti.** Paling cepat, dan ia
  mengirim konsol yang setiap tombolnya bekerja kecuali satu-satunya yang
  membuat sebuah page berguna. Ia juga meninggalkan empat permission menganggur
  di katalog — bahan baku cacat latent-authz yang repo ini sudah dua kali
  kirim.
- **Cabut keempat permission, nyatakan page CRUD-only.** Rapi dan salah, dengan
  cara yang mahal: ia memberkati pencarian publik page yang permanen kosong
  sebagai desain, dan membuang kolom, CHECK, serta index yang `sql/035` sudah
  bayar.
- **Beri page siklus hidup post seutuhnya (review + scheduled).** Berarti
  menambah dua permission baru untuk alur kerja yang belum ada yang minta, dan
  menyeret `blog-scheduled-publish.ts` ke resource kedua demi penerbitan
  terjadwal halaman "tentang kami".
- **Purge ikut menghapus ad placement yang menargetkan page.** Menghapus baris
  milik permukaan lain sebagai efek samping — kepemilikan yang ADR-0044 baru
  saja rapikan, dan penghapusan senyap yang persis dilarang ADR-0044 §4 untuk
  ad yang tak bisa dimigrasikan.
- **Purge menolak (409) selama ada ad placement menargetkan page itu.** Ini
  putusan draf pertama ADR ini, dan ia ditolak setelah membaca kode alih-alih
  menalar dari skema: `ad-placement-reference-validation.ts` sudah menyatakan
  target yang hilang belakangan "is not an error and never becomes one", query
  render tak pernah mencocokkan placement milik page yang tak dirender, dan
  soft delete — yang sudah ada dan tak digerbangi — punya efek yang sama
  persis. Menolak berarti menghalangi operator demi mencegah kondisi yang tidak
  merusak apa pun.
- **Purge diam saja soal placement yang jadi inert.** Aman secara teknis dan
  buruk secara operasional: sebuah slot iklan berhenti terisi tanpa satu pun
  jejak yang menghubungkannya ke page yang dihapus tiga minggu lalu.
