# ADR-0036 — Admission `media_library` lewat inversi kepemilikan (EKSTRAKSI registry media generik dari `news_portal`)

- **Status:** Accepted
- **Tanggal:** 2026-07-24
- **Pengambil keputusan:** @ahliweb
- **Mengadaptasi:** awcms-micro `docs/adr/0026-media-library-module-admission.md` (inversi kepemilikan media ADR-0026) ke basis `awcms`, sesuai program penyerapan [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md) dan peta [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) (media = gelombang inversi, bukan Wave-0 aditif).
- **Terkait:** ADR-0011 (capability ports), ADR-0013 §1 (lapisan ekstensi; Core/System Foundation tidak boleh bergantung pada modul domain konsumennya), ADR-0006 (provider eksternal di luar transaksi), ADR-0034 (template dipakai-langsung; modul website hidup langsung di `src/modules/`), ADR-0032/`awcms-family-compatibility.yaml` (kontrak kapabilitas & conformance).

## Konteks

`awcms` sudah memiliki registry media, tetapi ia hidup **di dalam** `news_portal` (di-port dari awcms-mini, epik `news_portal` #631-#642/#649/#681/#690): tabel `awcms_news_media_objects` (`sql/041`), alur presigned upload (`/api/v1/media/news-images/upload-sessions/*`), MIME sniffing, verifikasi R2, lifecycle orphan, job `news-media:reconcile`, dan 9 permission `('news_portal','media',*)` (`sql/042`). Registry itu **sudah generik** — kolom `owner_resource_type`/`owner_resource_id` menunjuk ke `blog_post`, `blog_page`, `homepage_section`, `gallery_item`, `ad`, `video_thumbnail`, `seo_image`.

Kopling produk yang bermasalah: gate media `blog_content` (`news-media-reference-gate.ts`) hanya menegakkan referensi media terkelola **saat mode R2-only aktif untuk tenant** — dan mode itu milik `news_portal` (`isFullOnlineR2ModeActiveForTenant`, disandarkan pada `awcms_news_portal_tenant_state`). Konsekuensinya: **tenant situs brosur (`blog_content` + `tenant_domain`, tanpa `news_portal`) tidak punya media library sama sekali** — hanya bisa menempel URL mentah. Untuk platform online-first, mengunggah dan mengelola gambar tidak boleh menuntut penyalaan modul **portal berita**.

awcms-micro sudah menyelesaikan masalah ini (ADR-0026) lewat **inversi kepemilikan**. ADR ini mengadaptasi keputusan itu ke `awcms`.

## Keputusan

### 1. Admisi `media_library` sebagai modul base, lewat EKSTRAKSI (bukan implementasi paralel)

- Nama: **Media Library** · `key`: `media_library`
- Kategori: **System Foundation** — infrastruktur platform reusable, sejalan dengan `sync_storage`/`domain_event_runtime`.
- `type`: `system` · `status`: `active` · `isCore`: **tidak**
- `dependencies`: `["tenant_admin", "identity_access"]` — **tidak** bergantung pada `news_portal`/`blog_content` (arah dependensi justru dibalik). Sebuah modul System Foundation yang mengonsumsi kapabilitas modul domain adalah inversi ADR-0013 §1 yang ekstraksi ini justru hapus.

Membangun modul media kedua di samping registry yang sudah ada akan menduplikasi tabel, alur upload, gate R2, lifecycle orphan, dan job rekonsiliasi — dua sumber kebenaran untuk "objek media milik tenant ini". Karena itu kepemilikan **dipindahkan**, bukan diimplementasikan ulang.

### 2. Pembalikan arah kepemilikan

| Sebelum                                                                                            | Sesudah                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `news_portal` **memiliki** registry media; `blog_content` mengonsumsi port `news_media` (opsional) | `media_library` **memiliki** registry media; `blog_content` (opsional) & `news_portal` (wajib) mengonsumsi port `media_library` |
| Media hanya tersedia bila `news_portal` menyala                                                    | Media tersedia bagi tenant website mana pun tanpa `news_portal`                                                                 |

`news_portal` tetap memiliki apa yang benar-benar miliknya: homepage sections, ad placements, dan (bila dip-port kemudian) kebijakan editorial R2-only. Yang berpindah hanya registry objek media generik dan alur unggahnya. `news_portal` kini **CONSUMES** `media_library` (wajib — ad placements membawa FK `media_object_id` ke objek media).

Kopling yang ADR ini putus hidup di **kontrak port itu sendiri**, bukan di adaptornya: `NewsMediaPort.isFullOnlineR2ModeActiveForTenant` adalah pertanyaan kebijakan `news_portal`, bukan pertanyaan media. Karena itu port di-**split**, bukan sekadar di-rename:

- Pertanyaan **"haruskah referensi media tenant ini berbasis registry?"** adalah pertanyaan media. Kini dijawab `media_library` dari readiness deployment-nya sendiri (`domain/managed-media-readiness.ts`, pecahan bagian `NEWS_MEDIA_R2_*` dari readiness preset `news_portal` — reason code identik) dan flag per-tenant miliknya sendiri (`application/media-library-tenant-state.ts`, `sql/053`).
- `MediaLibraryPort` (`_shared/ports/media-library-port.ts`) punya 3 method: `isManagedMediaEnforcementActiveForTenant` (mengganti method bermuatan-news_portal), `isMediaReferenceSafe`, `resolveMediaReferences`. Method `resolveMediaPublicBaseUrl` (khusus `social_publishing` yang belum di-port ke base ini) **di-drop**.

### 3. Retirement `news_media`, bukan MAJOR-bump

Kapabilitas `news_media` **dipensiunkan**: penyedianya berubah **dan** kontraknya kehilangan satu method. Di `_shared/capability-contract-versions.ts` (dan manifest `awcms-family-compatibility.yaml`) key `media_library: "1.0.0"` ditambahkan; `news_media` tidak pernah terdaftar di registry base ini (dihapus Issue #183 saat modul konten belum di-port), sehingga secara registry ini penambahan `media_library` yang jujur. Konsumen mana pun yang dipin ke `news_media` harus gagal terang-terangan, bukan diam-diam terikat ke port yang tidak lagi menanyakan hal yang ia tanyakan.

### 4. Tabel `awcms_news_media_objects` TIDAK di-rename

Meski namanya kini keliru menyebut pemilik lama, tabel **tidak** di-rename: ia dirujuk `sql/041`/`042`/`045`, membawa **FK komposit keras** dari `awcms_news_portal_ad_placements (media_object_id)`, dan dirujuk seluruh application layer. Me-rename-nya menukar ketidaknyamanan kosmetik dengan risiko nyata dan diff tak terbaca. Nama command job `news-media:reconcile` dan env var `NEWS_MEDIA_R2_*` juga **dipertahankan** dengan alasan yang sama. Migrasi baru **menambahkan** (`sql/052`/`053`/`054`), tidak menulis ulang yang sudah terapan (migrasi terapan itu immutable — `scripts/db-migrate.ts` checksum).

### 5. Migrasi (destruktif tapi non-destruktif secara efektif — urutan load-bearing)

- **`sql/052` (permission ownership).** (1) INSERT 9 `('media_library','media',*)`; (2) repoint grant peran lama→baru pada `awcms_role_permissions` (membawa `tenant_id`); (3) DELETE `('news_portal','media',*)`. Urutan **repoint-sebelum-delete** wajib — delete duluan akan mencabut akses media dari setiap peran yang memilikinya. Berjalan sebagai role migrasi (superuser/BYPASSRLS, `sql/019`) sehingga repoint melintasi semua tenant meski `awcms_role_permissions` ber-RLS FORCE.
- **`sql/053` (tenant-state schema).** `awcms_media_library_tenant_state` (PK `tenant_id`, `managed_media_enforced_at`, RLS ENABLE+FORCE + tenant_isolation) + backfill `SELECT ... FROM awcms_news_portal_tenant_state` (di base ini membaca 0 baris hari ini karena penulis preset `news_portal` belum di-port — ditulis untuk forward-compat agar tenant yang opt-in via preset itu tidak diam-diam kehilangan enforcement saat subsistem itu dip-port kemudian).
- **`sql/054` (enforcement permissions).** `('media_library','enforcement',{read,enable})` — activity code terpisah dari `media` (berbeda radius ledakan: `media.*` mengatur OBJEK, `enforcement.*` mengatur KEBIJAKAN konten se-tenant).

### 5a. Endpoint penyalaan enforcement (`GET`/`POST /api/v1/media/enforcement`)

Karena base ini **tidak** mem-port subsistem preset-activation `news_portal`, flag `sql/053` tidak akan punya penulis kecuali langkah ini dip-port. Endpoint enforcement adalah **satu-satunya penulis** flag di base ini: entry point tersanksi `application/enable-managed-media-enforcement.ts` menjalankan gate readiness lebih dulu (di entry point, bukan di satu pemanggil, agar pemanggil kedua di masa depan tak bisa melewatinya), lalu mengaudit aktornya.

**Satu arah, secara konstruksi.** Tidak ada action `disable`, tidak ada fungsi "unmark", tidak ada DELETE terhadap `awcms_media_library_tenant_state` di mana pun. Ini **properti keamanan**: header `sql/043` mencatat desain lama terbukti dieksploitasi end-to-end justru karena tenant bisa membersihkan marker-nya sendiri dan diam-diam mematikan seluruh validasi medianya. Jalan mundur yang sah adalah mengubah konfigurasi `NEWS_MEDIA_R2_*` (tindakan operator, di luar jangkauan tenant), yang sudah diperlakukan fail-closed oleh `evaluateManagedMediaReadiness`.

### 6. Batas scope (tidak diport pada gelombang ini)

Dari langkah 5 awcms-micro, base ini **tidak** mem-port: media lifecycle/browser surface (`/api/v1/media/objects/*`, `/admin/media` — step 5d), varian gambar/`srcset` (step 5b), dan tipe media non-gambar PDF (step 5c). Modul menyatakannya sebagai PORT DROP; himpunan MIME tetap empat tipe raster dan `navigation` belum dideklarasikan (halaman `/admin/media` belum ada). Ini genuinely aditif → ditunda ke gelombang lanjutan.

## Konsekuensi

**Positif.** Media menjadi kapabilitas platform, bukan sandera modul berita — situs brosur akhirnya punya media terkelola. Satu sumber kebenaran untuk objek media dipertahankan (nol duplikasi). Enforcement per-tenant kini punya "tombol"-nya sendiri (5a), readiness-gated dan auditable.

**Negatif / risiko yang diakui.** Ini refaktor lintas modul non-aditif yang menyentuh `news_portal`, `blog_content`, dan `media_library` baru; memindahkan 12 file, memensiunkan capability `news_media`, dan menjalankan migrasi permission destruktif + backfill lintas-tenant di bawah role BYPASSRLS. Karena itu ia dikerjakan sebagai satu perubahan yang direview dengan test RLS/backfill terpisah (`tests/integration/media-library-tenant-state.integration.test.ts`) yang membuktikan urutan repoint, isolasi tenant FORCE RLS, fail-closed `awcms_app` tanpa konteks tenant, dan mekanisme backfill lintas-tenant — bukan dipercaya dari komentar.

## Alternatif yang ditolak

- **Bangun `media_library` baru dari nol berdampingan dengan registry lama.** Ditolak: dua sumber kebenaran + duplikasi alur presigned/rekonsiliasi/lifecycle-orphan + drift yang dijamin.
- **Biarkan media di `news_portal`, cukup tambah endpoint enforcement di sana.** Ditolak: tetap mengunci manajemen media di balik modul portal berita; situs brosur tetap warga kelas dua.
- **Rename `awcms_news_media_objects`.** Ditolak — lihat §4 (FK komposit keras + 3 migrasi + application layer).
- **MAJOR-bump `news_media` alih-alih pensiun.** Ditolak — penyedia berubah DAN kontrak kehilangan method; pensiun key adalah sinyal yang benar (§3).
