---
name: awcms-site-search
description: Modul site_search SUDAH di-port ke repo ini (dari awcms-micro Issue #270 / ADR-0031, di sini ADR-0040; migrasi `sql/064` schema + `sql/065` permission, Gelombang-1 `docs/awcms/absorb-awcms-micro-roadmap.md`). Indeks PostgreSQL FTS lintas-konten per tenant atas konten publik terbit — `type: domain`, deps `[tenant_admin, identity_access, module_management]` (yang terakhir ditambahkan #251 — rute publik meng-gate `fetchTenantModuleEntry`), lima tabel `awcms_site_search_*` (ENABLE+FORCE RLS), endpoint publik anonim host-resolved `GET /api/v1/site-search/{query,suggest}` + halaman `/search`, admin `/api/v1/site-search/{settings,index/*}`, job `bun run site-search:reconcile`, gate `bun run site-search:sources:check`. Seam kontribusi `ModuleDescriptor.searchSources` (MODULE_CONTRACT_VERSION 2.2.0) — modul konten MENDEKLARASIKAN sumber, agregator menemukannya lewat `listModules()`. Gunakan saat menambah sumber pencarian baru, mengubah relevansi/snippet/rebuild, atau menyentuh config/diagnostik search.
---

# AWCMS — Cross-Content Site Search

Ikuti `src/modules/site-search/README.md` dan
[ADR-0040](../../../docs/adr/0040-site-search-module-admission.md). Modul ini
**ada dan bisa dipanggil** di repo ini.

## Arah panah: JANGAN dibalik

`site_search` adalah **konsumen/agregator**. Modul konten adalah **penyedia**.
`site_search.dependencies` HANYA `["tenant_admin", "identity_access"]`, dan tidak
ada modul yang boleh `dependencies`/`consumes` ke `site_search`. Kalau agregator
mengimpor port milik `blog_content`, ia akan menyeret dependency ke setiap modul
konten yang menyusul — itu justru yang dihindari desain ini.

`tests/site-search-module.test.ts` menegakkan invariant ini; edge terbalik tetap
lolos typecheck dan tetap lolos `modules:dag:check`, jadi test itulah gerbangnya.

## Menambah sumber pencarian baru

Tambahkan entri `searchSources` **di `module.ts` modul pemilik konten** — bukan
di `site-search/`, dan bukan dengan menulis ke tabel indeks. Contoh yang sudah
ada: `blog_content.post` di `src/modules/blog-content/module.ts`.

Aturan yang ditegakkan `bun run site-search:sources:check` (di rantai
`bun run check`) — semuanya sudah mutation-proven merah:

- `ownerModuleKey` **wajib** sama dengan `key` modul pendeklarasi.
- `key` unik lintas registry, dan `(tableName, resourceType)` unik — dua sumber
  yang membaca tabel yang sama sebagai tipe yang sama menghasilkan dokumen ganda.
- `tableName` **wajib** berprefiks `awcms_`; setiap nama kolom snake_case.
- `privacyClassification` **wajib** `"public"`.
- `urlTemplate` wajib path absolut; hanya placeholder `:slug`/`:id`/`:tenantCode`.

**Descriptor adalah DATA MURNI.** Tidak ada function reference, tidak ada SQL.
Engine generik membangun query ber-parameter darinya: nilai selalu bound, hanya
IDENTIFIER yang diinterpolasi dan itu lewat `assertSafeIdentifier` /
`assertSafeTableName` tepat sebelum interpolasi.

## `:tenantCode` — beda dari awcms-micro

Rute konten publik basis ini **berbasis path tenant** (`/blog/{tenantCode}/{slug}`,
ADR-0009), bukan `/news/:slug` host-resolved seperti awcms-micro. Karena itu
`SearchSourceDescriptor.urlTemplate` di sini punya placeholder `:tenantCode`
tambahan, di-resolve engine **sekali per run** dari `awcms_tenants.tenant_code`.

Template yang memuat `:tenantCode` tapi tidak diberi kode tenant akan **THROW**,
bukan memancarkan `:tenantCode` literal — URL publik yang rusak diam-diam adalah
cacat yang disajikan ke setiap pengunjung. Kegagalan itu tercatat sebagai
`extract_error` di `awcms_site_search_index_failures`.

URL final ikut masuk `source_checksum`, jadi rename `tenant_code` otomatis
memicu re-index pada reconcile berikutnya.

## Publication state: ditegakkan di boundary, bukan di query

Indeks **hanya** memuat baris yang lolos `publicationFilter` descriptor. Draft /
private / soft-deleted / terjadwal-belum-tayang tidak pernah dibaca MASUK ke
indeks. Karena itu:

- **Indeks BUKAN sumber otorisasi.** Jangan pernah memakai keberadaan dokumen
  untuk memutuskan akses — sumber kebenaran visibilitas tetap modul konten.
- Archive/unpublish/delete di sumber + reconcile menghapus dokumen (stale
  removal lewat anti-join). `reindexSearchResource` melakukan hal yang sama
  untuk satu resource.

## Indexing

| Operasi     | Sifat                                                              |
| ----------- | ------------------------------------------------------------------ |
| `reconcile` | upsert set publik saat ini (skip bila checksum sama) + hapus stale |
| `rebuild`   | DELETE dokumen tenant untuk sumber terdaftar → reconcile           |
| `reindex`   | satu resource: publik → upsert, tidak publik → hapus               |

Ketiganya idempoten. Reconcile ulang saat sinkron = semua `unchanged`.
Backbone terjadwal: `bun run site-search:reconcile` (`--rebuild`,
`--tenant=<uuid>`), jalan sebagai `awcms_worker`.

Kegagalan per-item diisolasi `tx.savepoint` — satu baris rusak tidak
menggagalkan seluruh run, tercatat di tabel diagnostics.

## Permission & aksi

`site_search.index.{read,reconcile,rebuild}`, `site_search.settings.{read,update}`,
`site_search.diagnostics.read` (seed `sql/065`).

- `rebuild` **HIGH-RISK** (hapus + ekstrak ulang semua dokumen).
- `reconcile` adalah anggota **BARU** union `AccessAction`, sengaja **BUKAN**
  high-risk (sinkronisasi proyeksi yang sepenuhnya regenerable) — tapi rutenya
  tetap wajib `Idempotency-Key` dan tetap teraudit. `isHighRiskAction` itu
  metadata, bukan gerbang idempotency/audit.
- Seperti setiap seed permission sebelumnya: tenant LAMA tidak otomatis dapat
  keenam permission ini. Backfill `awcms_role_permissions` saat deploy, atau
  owner tenant lama kena 403 yang terlihat seperti bug.

## Keamanan yang jangan diregresi

- **XSS**: `ts_headline` memakai sentinel non-HTML; `renderSafeSnippet`
  meng-escape SELURUH string DULU baru mengganti sentinel jadi `<mark>`.
  Membalik urutan itu = XSS. Jangan pernah mengoper `<b>`/`<mark>` sebagai
  `StartSel` ke `ts_headline`.
- **SQL injection**: teks query selalu bound param ke
  `websearch_to_tsquery('simple', $1)`.
- **Cache**: `buildSearchCacheKey` MENOLAK key tanpa tenant+locale+query-hash.
- **RLS**: kelima tabel `ENABLE` **dan** `FORCE`. `ENABLE` saja inert untuk
  owner tabel.
- **Query log**: opt-in (`analytics_enabled`) dan hanya menyimpan sha256 query
  ternormalisasi + panjang + locale + jumlah hasil. Jangan pernah menyimpan
  query mentah.
- **Metrik**: tidak ada label query/tenant/host di mana pun — istilah pencarian
  itu teks bebas user (kardinalitas tak terbatas + kebocoran privasi).

## Yang BELUM ada (jangan klaim ada)

- **Typeahead di halaman `/search`.** Skrip inline awcms-micro TIDAK diport: CSP
  basis ini tanpa `'unsafe-inline'` untuk script, dan halaman publik di sini
  adalah APIRoute HTML tanpa langkah bundling. Halaman ship core no-JS;
  `/suggest` tetap ada untuk client bundled milik tema.
- **i18n label halaman** — `DEFAULT_SEARCH_PAGE_LABELS`, basis ini tanpa runtime
  katalog i18n.
- **Sumber selain `blog_content.post`.** Blog PAGES tidak diindeks (tidak punya
  rute publik di basis ini — hasilnya akan 404); metadata media follow-up.
- **Admin UI** (`/admin/search`) — API-nya ada, layarnya belum.
- **Event `domain_event_runtime`** — lifecycle indeks masih log line.
