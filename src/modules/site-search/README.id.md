🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:32d1a856b8e6526c7be6b919883a749c446e493a3e1b631dd2d9c3c3ddd407dc -->

# site_search

**Pencarian teks-penuh PostgreSQL** lintas-konten ber-scope tenant atas konten website yang TERBIT ([ADR-0040](../../../docs/adr/0040-site-search-module-admission.md), di-port dari awcms-micro Issue #270 / ADR-0031). Official Optional Module, `type: "domain"`, hanya bergantung pada Core (`tenant_admin`, `identity_access`).

## Yang dimilikinya

- Indeks pencarian terpadu `awcms_site_search_documents` (sql/064, ber-RLS FORCE) — proyeksi `tsvector`/GIN dari setiap baris yang saat ini publik milik tiap modul konten, plus indeks GIN `pg_trgm` pada `title` untuk saran.
- Konfigurasi per-tenant (`awcms_site_search_settings`), ledger jalannya indeks (`awcms_site_search_index_runs`), diagnostik item gagal (`awcms_site_search_index_failures`), dan log query terminimalkan yang opt-in (`awcms_site_search_query_log`).
- Halaman publik `/search` + JSON `/api/v1/site-search/{query,suggest}`, dan API admin `/api/v1/site-search/{settings,index/*}`.

## Sambungan kontribusi — `SearchSourceDescriptor` (ADR-0040 §3)

Modul konten mendeklarasikan `SearchSourceDescriptor` **data-murni** di `module.ts` miliknya sendiri lewat `ModuleDescriptor.searchSources` (lihat deskriptor `blog_content.post` milik `blog_content`). Sebuah deskriptor memetakan kolom tabel sumber (title/summary/body/tags/locale/slug/updated_at) + **filter publikasi deklaratif** (equals / notNull / isNull / timeReached) + templat URL + bobot relevansi. **Tidak ada ekstraktor yang bisa dieksekusi dan tidak ada SQL tenant** — engine generiknya (`application/search-index-engine.ts`) membangun query terparameterisasi dari deskriptor; hanya IDENTIFIER yang sudah ditinjau (divalidasi terhadap `^[a-z_][a-z0-9_]*$` / `awcms_`) yang diinterpolasi, persis seperti executionMode generic milik `data_lifecycle`.

`domain/search-source-registry.ts` mengagregasi + memvalidasi deskriptor setiap modul lewat `listModules()` (preseden `reporting`/`data_lifecycle`), digerbangi di CI oleh `bun run site-search:sources:check`. Ia TIDAK dimodelkan sebagai `provides` capability `search_source` — provider >1 akan memicu `capability_provider_conflict`.

## Pengindeksan (ADR-0040 §4)

- **reconcile** (deterministik, idempoten): upsert himpunan publik saat ini (lewati bila checksum-nya sama) + hapus dokumen indeks yang basi (baris sumber hilang atau tidak lagi publik). Menjalankannya ulang saat sudah sinkron adalah no-op; cocok dengan jumlah/checksum sumber.
- **rebuild** (idempoten): hapus dokumen milik tenant untuk sumber yang diberikan, lalu reconcile — keadaan akhir identik apa pun keadaan sebelumnya.
- **reindex** (`reindexSearchResource`): ekstrak ulang satu sumber daya; publik → upsert, tidak lagi publik → dihapus. Primitif inkremental berbentuk-event.
- **Job:** `bun run site-search:reconcile` (tulang punggung terjadwal; `--rebuild`, `--tenant=<id>`). Karena `blog_content` menerbitkan lifecycle sebagai baris log (bukan event outbox sungguhan), sapuan terjadwal inilah tulang punggung deterministiknya; primitif reindex + konsumen domain-event di masa depan adalah jalur latensi-rendahnya begitu sebuah modul konten memancarkan event lifecycle sungguhan.

## Tulang punggung keamanan

- **Status publikasi** ditegakkan di batas sumber→indeks — indeks hanya menyimpan konten publik dan TIDAK PERNAH menjadi sumber otorisasi.
- **Isolasi tenant + locale** — RLS FORCE + predikat `tenant_id`/`locale` eksplisit; `buildSearchCacheKey` menolak kunci tanpa tenant/locale/query-hash (pertahanan cache-poisoning / lintas-tenant).
- **Injeksi SQL** — query selalu menjadi parameter terikat ke dalam `websearch_to_tsquery('simple', $1)`; identifier deskriptor divalidasi sebelum diinterpolasi.
- **XSS** — snippet dibangun oleh `ts_headline` dengan sentinel non-HTML, di-escape di `renderSafeSnippet`, lalu sentinelnya menjadi `<mark>` — markup yang berasal dari konten tidak akan pernah bisa selamat.
- **Penyalahgunaan anonim** — batas laju per-IP, batas panjang query, batas jumlah hasil.
- **Keamanan URL publik** — `:tenantCode`/`:slug`/`:id` di-`encodeURIComponent` saat pengindeksan, sehingga tidak ada nilai sumber yang bisa menyuntikkan segmen path atau sebuah scheme.

## Adaptasi port AWCMS (vs. awcms-micro)

| Area                   | awcms-micro                     | Di sini                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL konten publik      | `/news/:slug` host-resolved     | `/blog/:tenantCode/:slug` ber-scope tenant lewat path (ADR-0009) — deskriptornya mendapat placeholder `:tenantCode` yang diresolusi engine sekali per jalan dari `awcms_tenants.tenant_code`                                                    |
| Typeahead `/search`    | combobox ARIA `<script>` inline | **tidak di-port** — CSP base ini tidak punya `'unsafe-inline'` untuk skrip dan halaman publik adalah HTML APIRoute polos tanpa langkah bundling. Halamannya mengirim inti pencarian tanpa-JS; `/suggest` tetap tersedia untuk klien sebuah tema |
| Label halaman          | `createTranslator` gettext      | `DEFAULT_SEARCH_PAGE_LABELS` (base ini belum punya runtime katalog i18n) — dibiarkan sebagai parameter sehingga menambahkannya nanti cukup jadi perubahan pemanggil                                                                             |
| Permission `reconcile` | `AccessAction` yang sudah ada   | ditambahkan ke union di sini (eksplisit BUKAN high-risk; tetap ber-idempotency-key + diaudit)                                                                                                                                                   |
| Gerbang registry       | hanya test unit                 | ditambah `bun run site-search:sources:check` di rantai `check` (konvensi base ini untuk setiap registry deskriptor)                                                                                                                             |

## Tindak lanjut (didokumentasikan, bukan dibuang diam-diam)

HALAMAN blog (belum ada rute publik di base ini) dan tipe sumber daya lain, metadata media/galeri, event `domain_event_runtime` per-dokumen, UI dashboard admin, dan klien typeahead ter-bundle untuk `/search`. Sambungan deskriptornya sudah mendukung sumber-sumber tambahan itu.
