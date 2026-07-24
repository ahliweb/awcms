# ADR-0039 — `seo_distribution` scope tata-kelola redirect: aturan redirect + capture perubahan URL + telemetri 404

- **Status:** Accepted
- **Tanggal:** 2026-07-25
- **Pengambil keputusan:** @ahliweb
- **Mengadaptasi:** awcms-micro `src/modules/seo-distribution/` scope redirect (ADR-0028 §8 + deferral ADR-0010; di awcms-micro migrasinya bernomor 083/084 — penomoran repo itu, bukan repo ini) ke basis `awcms`, melengkapi separuh discovery yang sudah mendarat di [ADR-0038](0038-seo-distribution-module-admission-discovery-scope.md). Di `awcms` skema+permission redirect mendarat di `sql/060`/`sql/061`.
- **Terkait:** ADR-0038 (separuh discovery `seo_distribution` — companion), ADR-0037 (`data_lifecycle`, descriptor 404 di-register ke sini), ADR-0036 (`media_library`), ADR-0009 (resolusi tenant publik host/tenant-code), ADR-0035 (program penyerapan awcms-micro), [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) §5.

## Konteks

ADR-0038 mengadmisikan separuh **discovery** `seo_distribution` (renderer metadata + sitemap/robots/feed + config tenant), dan **secara eksplisit menunda** separuh **tata-kelola redirect** ke PR lanjutan (ADR-0038 §Ditunda): aturan redirect exact-path + hook redirect `src/middleware.ts`, telemetri 404 privacy-minimized + descriptor `dataLifecycle`, permission `redirect.*`/`not_found.*`, dan guard redirect beku (`classifyRedirectTarget`/`assertSafeRedirectTarget`) yang sengaja DIKELUARKAN dari port `seo_facts` awcms (lihat header `_shared/ports/seo-facts-port.ts` baris 14-20). ADR ini menyelesaikan penundaan itu.

Redirect adalah permukaan SEO paling rawan-abuse: target tak terbatas = open redirect, aturan pola = ReDoS, path admin/API/auth = target pembajakan. awcms-micro sudah menyelesaikan ini dengan skema yang membuat jalur aman menjadi satu-satunya jalur; ADR ini mem-port skema itu apa adanya secara semantik ke basis `awcms`, dengan tiga adaptasi yang didokumentasikan di bawah.

## Keputusan

### 1. Aturan redirect exact-path + telemetri 404, tiga tabel tenant-scoped (migrasi 060/061)

- `awcms_seo_redirects` (aturan exact-path), `awcms_seo_not_found_observations` (telemetri 404 agregat), `awcms_seo_redirect_settings` (kebijakan per-tenant) — semua **`ENABLE` + `FORCE ROW LEVEL SECURITY`** + policy `tenant_isolation` (`sql/060`). `sql/061` men-seed 6 permission (`redirect.{read,create,update,delete}`, `not_found.{read,update}`) ke `awcms_permissions` (backfill hanya tenant baru, sama seperti seed permission lain).
- **Hanya exact-path** — `normalized_source_path` adalah literal yang sudah dinormalisasi, dicocokkan dengan kesetaraan. TIDAK ADA kolom pola/regex/rewrite di skema, jadi tak bisa ReDoS. Aturan prefix/pola ditunda ke ADR mendatang.
- Resolusi rantai **bounded + non-rekursif** di kode aplikasi (`domain/redirect-chain.ts`, hop cap 5, satu point-query terindeks per hop), TIDAK PERNAH CTE rekursif SQL. Tabel tak punya FK self-referensial dan tak punya trigger.
- Descriptor `dataLifecycle` (`seo_distribution.not_found_observations`, kelas `analytics_telemetry`, `hard_delete`, `executionMode: "generic"`, retensi default 30 hari) di-register di `module.ts` dan divalidasi `data-lifecycle:registry:check`; `requiredIndexes` merujuk `awcms_seo_not_found_tenant_last_seen_idx` (cursor purge). Grant `SELECT, DELETE ... TO awcms_worker` diberikan ke tabel 404 (engine purge least-privilege).

### 2. Pertahanan open-redirect terkode di guard beku (di tulis DAN di tiap resolve)

Guard beku `classifyRedirectTarget`/`assertSafeRedirectTarget` — yang sengaja DIKELUARKAN dari port `seo_facts` awcms di ADR-0038 — **di-rumahkan kembali sebagai helper domain standalone** di `src/modules/seo-distribution/domain/redirect-target-classification.ts`, BUKAN dikembalikan ke port (port tetap kontrak fakta-konten murni). Hanya klasifikasi `same_tenant_internal` yang pernah diemit; `//evil.com`, `/\evil.com`, `javascript:`, `data:`, host lintas-tenant, dan tiap bypass kontrol C0/DEL ditolak di guard, bukan constraint DB. Setiap target dilewatkan guard **pada tulis (create/update/import/capture) DAN pada tiap resolve** (re-validasi terhadap host terverifikasi tenant SAAT INI — target `verified_external` ke domain yang sejak itu dicabut gagal tertutup). Normalisasi (`domain/redirect-path.ts`) menolak CRLF/traversal/Unicode-confusion/protocol-relative; predikat eligibility (`domain/redirect-eligibility.ts`) mengecualikan path admin/API/auth/static/system/**discovery** (robots/sitemap/feed) di tulis DAN resolve, sehingga redirect tenant tak pernah membajak route admin atau menaungi route discovery yang di-ship ADR-0038. Loop/rantai-terlalu-panjang gagal **tertutup** (tak ada redirect), disurface untuk remediasi operator, tak pernah dipantulkan.

### 3. Satu edit invasif `src/middleware.ts` — cabang publik resolve-lalu-sajikan, FAIL-OPEN

Cabang non-`/admin` middleware (yang sebelumnya hanya `return applyResponseHeaders(await next(), ...)`) diganti dengan blok resolve-lalu-sajikan: (a) resolve redirect publik SEBELUM `next()`, (b) sajikan, (c) rekam observasi 404 best-effort SETELAH respons dihasilkan. Urutan: setelah `correlationId` + ceiling body API, sebelum `next()`. **FAIL-OPEN by construction**: `resolvePublicRedirectForRequest` menelan SEMUA fault ke `null` (error subsistem redirect tak pernah jadi 500 atau memblok halaman), dan capture 404 berjalan pasca-respons dan tak pernah throw. Guard login `/admin` dan logika ceiling body API TIDAK disentuh. Ini satu-satunya perubahan berisiko; komposisi wiring hidup di `src/lib/seo/redirect-middleware.ts` (importable, unit-testable) sesuai pola composition root SEO yang sudah ada (`discovery-route.ts`).

### 4. Resolusi tenant = host-based-only cut pertama (path-tenant ditunda)

Aturan redirect berbasis-host (Strategy 2) di-resolve via `resolvePublicTenantFromRequest` → benar HANYA untuk tenant dengan domain kustom terverifikasi (host request memetakan ke tenant). Di bawah host bersama, resolver menghasilkan tenant default. **KEPUTUSAN: host-based-only cut pertama (cocok persis dengan awcms-micro, paling tidak invasif).** Strategi path-tenant (menurunkan tenant dari segmen `/blog/{tenantCode}` untuk aturan exact-path) DITUNDA sebagai follow-up terdokumentasi — tidak dibangun sekarang. Kedua resolver sudah ada di awcms.

## Adaptasi (didokumentasikan, bukan senyap)

- **Legacy `/blog/{tenantCode}` → `/news` INERT.** awcms tak ship keluarga route `/news`, jadi meski `legacy-blog-redirect.ts` + kolom `legacy_blog_redirect_enabled` (DEFAULT `false`) di-port untuk paritas skema/perilaku dengan awcms-micro dan port `/news` masa depan, auto-redirect legacy TAK PERNAH menyala di basis ini: kebijakan off secara default, dan seandainya operator menyalakannya, tujuan `/news...` yang dihitung tak punya route konten. Dipertahankan agar port `/news` masa depan mewarisi mekanisme yang sudah ter-guard, bukan menurunkannya ulang.
- **Tanpa seam i18n/locale — `locale = null`.** awcms tak punya seam i18n/locale; middleware melewatkan `locale = null` ke resolver redirect. Aturan ber-scope locale karenanya tak pernah mencocokkan locale — hanya aturan semua-locale (`locale_scope IS NULL`) yang resolve. Parameter `locale` dipertahankan untuk paritas signature dan port locale masa depan.
- **Guard beku di-rumahkan sebagai helper domain, bukan port** (§2) — membalik lokasi awcms-micro (yang menaruhnya di `_shared/ports/seo-facts-port.ts`) karena awcms sengaja menjaga port `seo_facts` sebagai kontrak fakta-konten murni (ADR-0038). Perilaku byte-for-byte identik secara semantik.

## Konsekuensi

- Positif: tata-kelola redirect tenant-contained teruji dengan pertahanan open-redirect/loop/hijack terkode di guard + eligibility, telemetri 404 privacy-minimized (path tersanitasi + domain referrer bare saja) dengan retensi terbatas via `data_lifecycle`, dan admin API lengkap (`/api/v1/seo/redirects/*` + `/api/v1/seo/not-found/*`) idempotency-keyed + di-audit.
- Biaya: satu edit invasif `src/middleware.ts` (fail-open, hanya cabang non-`/admin`); `seo_distribution` naik `0.2.0`; tiga tabel + 6 permission + satu descriptor `dataLifecycle` baru; setiap request publik eligible kini menjalankan satu transaksi `withTenant` (short-circuit "tenant tanpa aturan" ditunda sebagai follow-up perf — bukan correctness-safe karena capture 404 tetap butuh host server-derived dan auto-redirect legacy dari settings).
- Keterbatasan (lihat `src/modules/seo-distribution/README.md`): resolusi tenant host-based-only (path-tenant ditunda); legacy-blog inert (tanpa `/news`); `locale` selalu null; UI admin (preview rantai + dashboard 404) ditunda (permukaan tetap API); capture perubahan URL adalah hook sinkron ter-audit, belum event domain terpublikasi; backfill permission hanya tenant baru.

## Alternatif yang ditolak

- **Mengembalikan guard beku ke port `seo_facts`** — mencemari kontrak fakta-konten murni dengan konsep redirect; awcms sengaja mengeluarkannya di ADR-0038. Ditolak; di-rumahkan sebagai helper domain standalone.
- **Membangun strategi path-tenant sekarang** — memperbesar PR dan menambah permukaan resolusi tenant kedua sebelum ada konsumen yang membutuhkannya; host-based-only cocok dengan awcms-micro dan cukup untuk tenant ber-domain kustom. Ditolak; ditunda.
- **Redirect sebagai endpoint `/api/v1` (bukan middleware)** — resolusi redirect publik HARUS terjadi sebelum routing konten untuk tiap request publik; menjadikannya endpoint API akan salah-model. Admin API redirect (tulis/kelola) MEMANG `/api/v1`; resolusi publik (baca 3xx `Location`) memang middleware. Ditolak untuk resolusi publik.
- **Mengaktifkan legacy-blog `/news`** — tak ada keluarga route `/news` di basis; mengaktifkannya akan menghasilkan redirect ke 404. Ditolak; dipertahankan inert untuk paritas.
