🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0040-site-search-module-admission.md)

<!-- i18n-source-hash: sha256:8b704f847282c2d3b2ba9746886bae0178b51a1acfde16e97f2a3c7a12feba56 -->

# ADR-0040 — Admission `site_search` (Official Optional Module): pencarian PostgreSQL FTS lintas-konten lewat search-source descriptor, DAG-safe inward

- **Status:** Accepted
- **Tanggal:** 2026-07-25
- **Pengambil keputusan:** @ahliweb
- **Mengadaptasi:** awcms-micro `src/modules/site-search/` + ADR-0031 (issue #270, epic #261 Gelombang 2; di awcms-micro migrasinya bernomor 087/088 — penomoran repo itu, bukan repo ini) ke basis `awcms`. Di sini skema mendarat di `sql/064` dan seed permission di `sql/065`.
- **Terkait:** ADR-0038/0039 (`seo_distribution` — preseden kontribusi INWARD: modul konten adalah PENYEDIA, modul agregator KONSUMEN), ADR-0037 (`data_lifecycle`, dua tabel telemetri modul ini di-register ke sana), ADR-0036 (`media_library` — penyedia search source lanjutan), ADR-0013 §1/§6 (modul tidak menulis ke tabel modul lain; kolaborasi lewat kontrak yang dideklarasikan modul pemilik), ADR-0009 (rute publik tenant-scoped berbasis `tenantCode`), ADR-0011 (capability port), ADR-0035 (program penyerapan awcms-micro), [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) §Gelombang 1.

## Konteks

Basis ini hari ini punya pencarian **per-modul**: `blog_content` memiliki `search_vector` di `awcms_blog_posts`/`awcms_blog_pages` (migrasi `sql/035`) plus rute `/blog/{tenantCode}/search`. Yang belum ada adalah pencarian **lintas-konten, satu tenant** — satu permukaan terindeks yang menyatukan post, halaman, dan tipe konten mana pun yang menyusul, lengkap dengan suggestion, rebuild, dan rekonsiliasi.

Kalau kebutuhan itu dipenuhi ad hoc, setiap modul konten berikutnya akan menumbuhkan versi indeks/relevansi/snippet-nya sendiri — persis drift lintas-modul yang ADR-0036/0038 baru saja bersusah payah membalik untuk media dan SEO. Keputusan yang harus mengikat **sebelum** kode: siapa yang memiliki indeks pencarian, ke arah mana dependency mengalir, dan lewat seam apa modul konten menyumbang sumber-pencarian tanpa saling impor dan tanpa menulis ke tabel indeks orang lain.

Fakta grounding yang sudah ada dan **tidak** ditulis ulang oleh modul ini:

- `blog_content` sudah memiliki predikat "publik + terbit" tunggal (`status='published' AND visibility='public' AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()`) yang dipakai rute publiknya sendiri **dan** adapter `seo_facts`-nya. `site_search` mengonsumsi predikat itu lewat descriptor, bukan memodelkannya ulang.
- `tenant_domain` (ADR-0010, mendarat lewat #219) me-resolve tenant dari host untuk rute publik. Permukaan pencarian publik memakainya persis seperti rute discovery `seo_distribution`.
- Rute konten publik basis ini **berbasis path tenant** (`/blog/{tenantCode}/{slug}`, ADR-0009) — bukan `/news/:slug` host-resolved seperti awcms-micro. Itu satu-satunya perbedaan struktural yang menembus sampai ke bentuk descriptor (§7).

## Keputusan

Kami mengadmisi **`site_search`** sebagai **Official Optional Module** (fitur produk generik lintas domain website, opt-in per tenant), memakai **PostgreSQL full-text search sebagai default** (`tsvector`/GIN; `pg_trgm` HANYA untuk suggestion typeahead judul), dan mewujudkan kolaborasinya lewat **search-source contribution contract** — **bukan** impor internal lintas-modul dan **bukan** tulisan langsung ke shared table (ADR-0013 §6).

Arah kepemilikan dinyatakan tegas, meniru ADR-0038: **modul konten adalah PENYEDIA "search sources"; `site_search` adalah KONSUMEN/agregator.** Tidak ada modul yang sudah ada dibuat bergantung pada `site_search`, dan `site_search` tidak mengambil lifecycle dependency apa pun ke modul konten (hanya ke Core) — sehingga graf tetap DAG-safe.

### 1. Parameter admission

| Parameter                   | Nilai                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Nama                        | Site Search                                                                                                                            |
| `key`                       | `site_search`                                                                                                                          |
| Kategori                    | **Official Optional Module** — pencarian situs kebutuhan generik **setiap** situs publik lintas vertikal, opt-in per tenant            |
| `type` di kode              | `domain` (sama seperti `blog_content`/`news_portal`/`seo_distribution`)                                                                |
| `isCore`                    | tidak                                                                                                                                  |
| `status`                    | `active` — descriptor + kode runtime mendarat bersama                                                                                  |
| Lifecycle `dependencies`    | `["tenant_admin", "identity_access"]` **saja** — tidak ke `blog_content`/`news_portal`/`media_library`                                 |
| Kontribusi sumber-pencarian | descriptor-list `ModuleDescriptor.searchSources` (§3) — **bukan** capability `provides` (>1 penyedia = `capability_provider_conflict`) |
| Kelas kompatibilitas        | Indeks + query dari DB lokal = **offline-lan-safe**; layanan search eksternal (Elastic/OpenSearch/vector) = **di luar scope**          |

### 2. Arah dependency — kenapa panah menunjuk ke DALAM (DAG-safe)

| Modul           | Peran terhadap `site_search`                          | Lifecycle `dependencies`              |
| --------------- | ----------------------------------------------------- | ------------------------------------- |
| `blog_content`  | **penyedia** search source (post `/blog/:code/:slug`) | tidak berubah                         |
| `news_portal`   | menyusun post berita, bukan resource mandiri          | tidak berubah                         |
| `media_library` | **penyedia** (opsional, follow-up) metadata media     | tidak berubah                         |
| `site_search`   | **konsumen/agregator** (memiliki indeks + query)      | `["tenant_admin", "identity_access"]` |

**Invariant yang dikunci:** tidak ada modul yang `dependencies`- atau `consumes`-nya menyebut `site_search` (ditegakkan test `tests/site-search-module.test.ts`). Arah kontribusi dibalik dari desain naif "search mengimpor tiap modul konten": kalau `site_search` mengonsumsi port milik `blog_content`, agregator akan menyeret dependency ke setiap modul konten. Dengan membalik arah — konten **mendeklarasikan** search source, search menemukannya lewat `listModules()` — `site_search` tetap ignorant terhadap modul konten mana pun.

### 3. Contribution contract — kenapa descriptor-list, BUKAN capability `provides`

ADR-0038 memodelkan `seo_facts` sebagai **satu** capability `provides` (hanya `blog_content` mendeklarasikannya, karena `module-composition.ts`'s `checkCapabilityBindings` menandai `capability_provider_conflict` bila >1 modul mendeklarasikan `provides` string yang sama). Untuk pencarian kita **memang** ingin banyak modul konten menyumbang → memodelkan `search_source` sebagai capability `provides` akan langsung memicu konflik itu.

Maka seam-nya adalah **descriptor-list** — pola `dataLifecycle`/`sodRules`/`reportingProjections` yang sudah ada: setiap modul mendeklarasikan array `ModuleDescriptor.searchSources` **di `module.ts`-nya sendiri**, dan `site_search` mengagregasi lewat `listModules()` (`site-search/domain/search-source-registry.ts`). `MODULE_CONTRACT_VERSION` naik `2.1.0` → `2.2.0` (MINOR, murni aditif — setiap `module.ts` yang tidak punya `searchSources` tetap valid).

**`SearchSourceDescriptor` adalah DATA MURNI, bukan extractor executable.** Descriptor mendeklarasikan, sebagai konstanta reviewed build-time: `resourceType`, tabel/kolom sumber, template URL publik, **publication filter deklaratif** (equals/notNull/isNull/timeReached), `weight` relevansi, dan `privacyClassification`. Engine generik (`application/search-index-engine.ts`) membangun query BER-PARAMETER dari descriptor — nilai selalu bound parameter; hanya IDENTIFIER (nama tabel/kolom) yang diinterpolasi, dan itu divalidasi ketat (`^[a-z][a-z0-9_]*$`, tabel harus berprefiks `awcms_`) — **preseden persis `data_lifecycle`'s generic executionMode**. Gate CI-nya `bun run site-search:sources:check`, di rantai `bun run check`.

### 4. Model indeks — proyeksi tenant-scoped, reconcile deterministik

- **Tabel indeks** `awcms_site_search_documents` (RLS FORCE, satu doc per `(tenant, source_key, resource_id, locale)`) dengan `search_vector tsvector GENERATED ALWAYS ... STORED` (`setweight` title=A/summary=B/tags=C/body=D) + index GIN. `pg_trgm` GIN pada `title` **hanya** untuk suggestion typeahead.
- **reconcile** deterministik: upsert semua doc publik saat ini (skip bila `source_checksum` cocok), hapus doc indeks yang resource-nya tidak lagi memenuhi predikat sumber. Idempoten: menjalankan ulang saat sinkron = no-op.
- **rebuild** penuh idempoten (DELETE doc tenant → reconcile; hasil akhir identik apa pun state awal).
- **reindex satu-resource** (`reindexSearchResource`) — primitive event-shaped, pertahanan stale-leakage: archive/delete/unpublish menghapus dari hasil publik tanpa sisa.
- **Event-driven**: `blog_content` di basis ini menerbitkan lifecycle sebagai **log line**, bukan event outbox nyata. Maka **reconcile terjadwal** (`bun run site-search:reconcile`) adalah backbone deterministik hari ini; `reindexSearchResource` adalah seam yang aktif begitu sebuah modul konten menerbitkan event lifecycle nyata.

### 5. Kontrak query publik + suggestion

| Aspek                   | Invariant                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenant/locale scope** | Setiap query dibatasi `tenant_id` (RLS FORCE + predikat) DAN `locale`.                                                                |
| **Publication-state**   | Difilter di boundary sumber→indeks; query indeks **bukan** sumber otorisasi. Tidak ada draft/preview/private/deleted di hasil.        |
| **Normalisasi query**   | Trim, batas panjang min/max, kolaps whitespace, strip control char, lalu ke `websearch_to_tsquery('simple', $1)` sebagai bound param. |
| **Snippet/highlight**   | `ts_headline` dengan sentinel non-HTML → escape HTML seluruhnya → sentinel diganti `<mark>` — markup dari konten tidak pernah lolos.  |
| **Pagination**          | Keyset cursor `(rank, id)`, `LIMIT` dibatasi.                                                                                         |
| **Anonim**              | Rate limit per-IP, batas panjang query, result caps.                                                                                  |
| **Cache key**           | `buildSearchCacheKey` menolak menyusun key tanpa `tenant_id`+`locale`+`query`-hash.                                                   |

### 6. Konfigurasi tenant, admin, retensi/audit

- **Config tenant** (`awcms_site_search_settings`, RLS FORCE, 1 baris/tenant, CHECK-bounded): `enabled`, `enabled_resource_types`, `result_limit`, `min_query_length`, `suggestions_enabled`, `suggestion_limit`, `analytics_enabled`.
- **Permission** (`sql/065`): `site_search.index.{read,reconcile,rebuild}`, `site_search.settings.{read,update}`, `site_search.diagnostics.read`. `rebuild` HIGH-RISK; `reconcile` **sengaja tidak** high-risk (sinkronisasi proyeksi yang sepenuhnya regenerable) tetapi tetap `Idempotency-Key`-ed + teraudit. `reconcile` adalah anggota BARU union `AccessAction`.
- **Retensi:** `awcms_site_search_query_log` dan `awcms_site_search_index_failures` didaftarkan sebagai `HighVolumeTableDescriptor` `generic` (ADR-0037). Tabel indeks sendiri **tidak** — ia di-rebuild, bukan di-purge.
- **Query logging** opt-in + minimized: hanya sha256 query ternormalisasi + panjang + locale + jumlah hasil. Query mentah tidak pernah disimpan.

### 7. Adaptasi khusus awcms (bukan kelalaian port)

| Area                | awcms-micro                     | Di sini                                                                                                                                                                                                                                |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL konten publik   | host-resolved `/news/:slug`     | `/blog/:tenantCode/:slug` (ADR-0009) — descriptor mendapat placeholder `:tenantCode` yang di-resolve engine sekali per run dari `awcms_tenants.tenant_code`, lalu di-encode                                                            |
| Typeahead `/search` | inline `<script>` ARIA combobox | **tidak diport** — CSP basis ini tidak punya `'unsafe-inline'` untuk script dan halaman publik di sini adalah APIRoute HTML tanpa langkah bundling. Halaman ship core no-JS; `/suggest` tetap tersedia untuk client bundled milik tema |
| Label halaman       | gettext `createTranslator`      | `DEFAULT_SEARCH_PAGE_LABELS` (basis ini tidak punya runtime katalog i18n) — tetap parameter agar penambahan i18n kelak jadi perubahan caller                                                                                           |
| Gate registry       | hanya unit test                 | ditambah CLI gate `site-search:sources:check` di rantai `check` (konvensi basis ini untuk setiap registry descriptor)                                                                                                                  |
| Blog PAGES          | tidak diindeks (tak ada rute)   | sama — tidak diindeks; halaman tidak punya rute publik di basis ini, jadi hit-nya akan 404                                                                                                                                             |

## Threat model (bagian dari acceptance)

| Ancaman                         | Kontrol                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **SQL injection**               | Query & filter selalu bound parameter; descriptor IDENTIFIER divalidasi ketat sebelum interpolasi.                      |
| **XSS lewat snippet**           | `ts_headline` sentinel non-HTML → escape HTML seluruh string → ganti sentinel `<mark>`.                                 |
| **Draft/private leakage**       | Publication-filter deklaratif ditegakkan di boundary sumber→indeks; reindex menghapus yang jadi non-publik.             |
| **Cross-tenant / cross-locale** | RLS FORCE + predikat `tenant_id`/`locale` di setiap query; cache key wajib memuat tenant+locale; uji isolasi integrasi. |
| **Query abuse**                 | Rate limit per-IP, batas panjang query, result caps, index bounded (LIMIT + keyset).                                    |
| **Open redirect / path escape** | `:tenantCode`/`:slug`/`:id` selalu `encodeURIComponent` saat index time; template wajib path absolut tanpa skema.       |
| **Cache poisoning**             | `buildSearchCacheKey` tenant+locale+query-hash — menolak key tanpa komponen isolasi.                                    |
| **Search sebagai authz source** | Indeks HANYA proyeksi konten publik; sumber kebenaran visibilitas tetap modul konten.                                   |

## Out of scope (ditegakkan)

Layanan search SaaS/Elasticsearch/OpenSearch, vector/semantic AI ranking, cross-tenant global search, mengindeks data privat/admin bisnis, dan memakai proyeksi search sebagai sumber otorisasi — **tidak** diadmisi. PostgreSQL FTS adalah default sampai ada bukti kuat ia tidak cukup.

## Konsekuensi

**Positif.** Kepemilikan indeks pencarian eksplisit; satu otoritas relevansi/snippet/rebuild; tipe konten baru menyumbang lewat satu descriptor tanpa `site_search` mengenal satu pun secara spesifik. DAG aman. Publication-state, tenant/locale isolation, dan snippet-escaping dikunci sebagai kontrak sejak hari nol. PostgreSQL FTS lokal = offline-lan-safe.

**Negatif / trade-off yang diterima.** Indeks adalah proyeksi kedua (di atas `search_vector` per-modul yang sudah ada) → butuh reconcile/rebuild untuk konsistensi; biaya disengaja demi pencarian lintas-konten yang seragam. Karena `blog_content` menerbitkan lifecycle sebagai log line, indexing incremental low-latency menunggu event nyata; sampai itu, reconcile terjadwal adalah backbone. Halaman `/search` ship tanpa typeahead sampai ada tema dengan client bundled.

**Netral.** `site_search` menyentuh permukaan yang sama dengan `seo_distribution` (URL publik) dan `visitor_analytics` (query publik) — koordinasi lewat descriptor/log, bukan tabel bersama.

## Alternatif yang dipertimbangkan

- **Memodelkan `search_source` sebagai capability `provides`.** Ditolak: >1 penyedia = `capability_provider_conflict`; descriptor-list `listModules()` adalah seam yang benar untuk banyak penyedia.
- **Extractor executable per modul, di-wire di composition root gaya `seo_facts`.** Ditolak untuk source-extraction: descriptor data murni + engine generik reviewed lebih sempit dan lebih mudah di-audit.
- **Menyatukan pencarian ke `blog_content` yang sudah ada.** Ditolak: pencarian lintas-konten bukan milik satu modul konten; agregator netral adalah tempat yang benar.
- **Layanan search eksternal (Elastic/OpenSearch/vector).** Ditolak: tidak ada bukti PostgreSQL FTS tidak cukup untuk scope website.
- **Menyimpan URL relatif tanpa `:tenantCode` dan menambahkan prefiks saat query.** Ditolak: URL akan benar hanya untuk pemanggil yang ingat menambahkannya, dan checksum dokumen tidak akan menangkap perubahan `tenant_code` — menyimpan URL final membuat rename tenant otomatis meng-update dokumen pada reconcile berikutnya.
