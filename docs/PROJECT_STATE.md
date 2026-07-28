# AWCMS — Project State & Continuation

> **Untuk apa dokumen ini.** Ringkasan **state proyek yang tahan-lama** + cara
> melanjutkan pekerjaan — dirancang sebagai **titik-lanjut ter-versioning** (alternatif
> catatan sesi privat/worktree yang tidak ikut ter-commit). Baca ini **lebih dulu** saat
> memulai/melanjutkan pekerjaan besar. Ia **melengkapi**, bukan menggantikan:
>
> - [`ARCHITECTURE.md`](ARCHITECTURE.md) — apa yang **ada di kode** (teknis, per-subsistem).
> - [`AGENTS.md`](../AGENTS.md) — **kontrak kerja** (aturan wajib, guardrail, alur task).
> - `docs/adr/` — **keputusan** arsitektural (kenapa).
>
> Sumber kebenaran state tetap **kode + `sql/` + `bun run check`**. Bila dokumen ini
> berbeda dari kode, kode yang benar — perbarui dokumen ini.

## 1. Model tata kelola saat ini (WAJIB dipahami)

Sejak [ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
(men-supersede ADR-0013/0014/0015/0022/0025): **`awcms-mini`, `awcms`, `awcms-micro` =
tiga template keluarga AWCMS yang dipakai LANGSUNG**, bukan hierarki base-dan-turunan.
`awcms` = template lini **ERP/back-office**.

Disempurnakan oleh [ADR-0035](adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
(positioning `awcms`): mode operasi `awcms` = **hybrid online + offline dengan prioritas
online-first** (online jalur utama; offline/LAN mode ketahanan), **siap ERP + SaaS
terintegrasi**, dan `awcms` menjadi **superset** keluarga yang **menyerap** klaster
website/e-commerce, UI/UX, dan pengerasan auth `awcms-micro` (peta di
[`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md)). `awcms-mini`
tetap hybrid offline-first (siap SaaS); `awcms-micro` tetap website full-online ramping.
Model tata kelola dipakai-langsung/tanpa-repo-turunan (ADR-0034 §2/§3) **tidak berubah**.

- Modul domain — **ERP, website/e-commerce, dan konten** — **ditambahkan langsung di
  `src/modules/`** template ini saat dipakai, lalu didaftarkan di `src/modules/index.ts`.
- **Jalur aplikasi-turunan DIHAPUS**: tidak ada lagi `src/modules/application-registry.ts`,
  command `extension:check`, namespace migrasi `900+`, manifest kompatibilitas turunan.
  `ModuleType` valid = `base | system | domain | integration` (tidak ada `derived`).
- Dokumen/skill yang masih menyebut "repo turunan / derived" sebagai jalur aktif adalah
  **usang** — perlakukan sebagai catatan historis (banyak sudah bertanda DEPRECATED).

## 2. Inventori ringkas

| Aspek      | Nilai (per commit ini)                                                    | Sumber kebenaran                                      |
| ---------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Versi      | **6.4.0** (2026-07-26); 0 changeset menunggu                              | `package.json`, `CHANGELOG.md`, tag `v*`              |
| Modul base | **21** (lihat daftar di ARCHITECTURE.md)                                  | `src/modules/index.ts`                                |
| Migrasi    | **79** (`sql/001`–`079`)                                                  | `ls sql/`                                             |
| ADR        | **43** (`0000`–`0042`)                                                    | `docs/adr/README.id.md` (indeks ter-gate)             |
| Kontrak    | OpenAPI modular per-modul + AsyncAPI; `MODULE_CONTRACT_VERSION` **2.3.0** | `openapi/`, `asyncapi/`, `_shared/module-contract.ts` |

> **Rilis:** `v6.0.0` (2026-07-21) adalah **rilis nyata pertama** yang menjalankan
> `.github/workflows/release.yml` end-to-end (validate → build+SBOM×2 → sign/attest/publish,
> image `ghcr.io/ahliweb/awcms:6.0.0` + GitHub Release). MAJOR karena breaking ADR-0034
> (jalur turunan dihapus, `MODULE_CONTRACT_VERSION` 1.3.0→2.0.0). Prosedur tag di
> [`docs/awcms/09_roadmap_repository_commit.md`](awcms/09_roadmap_repository_commit.md) /
> skill `awcms-release` (tag `vX.Y.Z` dibuat **manual** via `git tag -a` — tidak ada script
> `changeset:tag`). **Approval gate:** Environment `release` kini punya required
> reviewer (`ahliweb`, dikonfigurasi & diverifikasi via rehearsal 2026-07-21) — publish
> job pause di "Waiting for review" sebelum sign/attest/publish (lihat
> [`release-process.md`](awcms/release-process.md) §Environment approval).

Modul (21): `tenant-admin`, `identity-access`, `profile-identity`, `logging`,
`module-management`, `sync-storage`, `workflow-approval`, `reporting`, `email`,
`domain-event-runtime`, `theming`, `blog-content`, `news-portal`, **`tenant-domain`**,
**`visitor-analytics`**, **`media-library`**, **`data-lifecycle`**, **`seo-distribution`**,
**`form-drafts`**, **`site-search`**, **`comments`**.
(Delapan terakhir = gelombang penyerapan awcms-micro, 2026-07-24/25 — lihat §3/§4.)

> Catatan: generator `repo:inventory` **belum diport** dari `awcms-mini`, jadi
> [`awcms/repo-inventory.md`](awcms/repo-inventory.md) adalah placeholder — jangan
> jadikan sumber angka. Gunakan ARCHITECTURE.md / registry / `sql/`.

## 3. Yang sudah selesai (jangan dibangun ulang)

- **20 modul** aktif dengan RLS `FORCE`, pemisahan role DB
  (`awcms_app`/`awcms_worker`/`awcms_setup`), admin SSR read+write (Issue #166/#171).
- **Auth lanjutan**: MFA TOTP + session-assurance/step-up (`sql/024`), OIDC/SSO
  tenant-aware + SSRF guard + break-glass (`sql/025`/`026`), Turnstile bot protection
  sadar-profil (LAN/offline exempt). Lihat [`awcms/mfa-totp-step-up.md`](awcms/mfa-totp-step-up.md),
  [`awcms/oidc-sso.md`](awcms/oidc-sso.md), [`awcms/turnstile-bot-protection.md`](awcms/turnstile-bot-protection.md).
- **Authorization**: ABAC dinamis berbasis DSL (`sql/031`/`032`), business-scope hierarchy
  (`sql/027`/`028`), SoD conflict enforcement (`sql/029`/`030`).
- **`theming`** — modul website pertama di base (`sql/033`/`034`, ADR-0034 Fase 3).
- **`blog-content` + `news-portal`** — modul konten publik pertama, di-port dari mini
  (PR #214, `sql/035`–`sql/045`, 19 tabel FORCE RLS). Rute publik path-based
  `/blog/{tenantCode}` (ADR-0009); `news-portal` menyediakan capability `news_media`
  (registry R2 + presigned upload) yang dikonsumsi `blog-content` via adapter nyata.
  DI-DROP saat port (butuh modul lain yang belum ada): rute `/news/**` host-resolved
  (`tenant_domain`), aktivasi preset full-online-R2 (`module_management` preset subsystem).
  Lihat skill `awcms-blog-content` / `awcms-news-portal` (kini panduan kode nyata) §DELTA PORT.
- **UI/UX overhaul** (PR #215) — login + 8 layar admin + blog publik: mobile-first,
  animasi CSS-only, a11y AA, auto tenant picker di `/login` (sembunyi saat 1 tenant).
  Presentasi-only; jaminan CSP single-owner "zero third-party origin" dipertahankan.
- **Paritas admin shell dengan awcms-micro** (PR #229) — `.admin-shell` + topbar sticky,
  badge tenant, sidebar dua-level (section → modul pemilik → link) + footer versi,
  breadcrumb, dashboard KPI/detail/module-usage, dan **toggle tema terang/gelap yang
  benar-benar berfungsi**. Token `:root[data-theme="dark"]` sudah ada sebelumnya tanpa
  apa pun yang menyetel atribut; toggle butuh script head yang jalan sebelum paint,
  sehingga `script-src` kini **selalu** dipancarkan berisi `'self'` + **SHA-256 satu
  script inline itu** (hash, BUKAN `'unsafe-inline'` — hanya satu urutan byte persis yang
  diizinkan). `tests/theme-init-script.test.ts` merah bila body script dan hash melenceng;
  tanpa gate itu, ketidakcocokan hash gagal senyap (script diblokir, tanpa error/log).
  DI-DROP karena capability pendukungnya belum ada: LanguageSwitcher (belum ada katalog
  i18n), SyncIndicator, link profil (`/admin/profile` belum ada), penataan sidebar
  per-tenant. Drawer JS micro **ditolak**: drawer checkbox CSS-only awcms tak butuh script
  sama sekali — lebih baik di bawah CSP ini.
- **Kontrak OpenAPI modular** per-modul + bundler deterministik (ADR-0026), **family
  compatibility manifest + CI conformance** (ADR-0032).
- **Penyerapan awcms-micro — Wave 0/1 (2026-07-24/25, PR #218–#231, `sql/046`–`sql/065`).**
  Tujuh modul baru diserap satu-PR-atomic-per-modul lewat pipeline delta → coder →
  reviewer + security-auditor → validasi Postgres nyata:
  - **`tenant-domain`** (#219, `sql/046`–`048`) — routing host→tenant + lookup domain
    terverifikasi (fondasi host-resolved untuk SEO/rute publik).
  - **`visitor-analytics`** (#220, `sql/049`–`051`) — telemetri kunjungan + rollup +
    purge terjadwal.
  - **`media-library`** (#221, ADR-0036, `sql/052`–`054`) — **inversi kepemilikan media**:
    satu modul memiliki seluruh objek media per-tenant; port `media_library`; `news_media`
    dipensiunkan.
  - **`data-lifecycle`** (#222, ADR-0037, `sql/055`–`056`) — retensi/arsip/purge generik +
    **legal-hold non-bypassable** (guard + 1 aturan SoD maker-checker di base).
  - **`seo-distribution`** (#223 discovery + #224 redirect governance, ADR-0038/0039,
    `sql/057`–`061`) — renderer metadata SEO terpusat (canonical/hreflang/robots/OG/JSON-LD,
    host diturunkan server) + rute discovery publik (`robots.txt`/sitemap/feed) + **tata
    kelola redirect** (aturan exact-path, telemetri 404, hook `src/middleware.ts` fail-open,
    guard open-redirect beku). Mengonsumsi capability `seo_facts` (disediakan `blog_content`).
  - **`form-drafts`** (#230, `sql/062`–`063`) — draft store server-side generik untuk form
    multi-langkah (payload JSONB opaque, penolakan key mirip-rahasia, purge dua fase).
  - **`site-search`** (#231, ADR-0040, `sql/064`–`065`) — indeks PostgreSQL FTS
    **lintas-konten** per tenant atas konten publik terbit + query/suggest publik
    host-resolved + halaman `/search` + admin index/settings/diagnostics. Seam kontribusi
    baru `ModuleDescriptor.searchSources` (`MODULE_CONTRACT_VERSION` 2.2.0): modul konten
    MENDEKLARASIKAN sumber, agregator menemukannya lewat `listModules()` — tidak ada modul
    yang bergantung pada `site_search`.
  - **`comments`** ([ADR-0041](adr/0041-comments-module-admission.md), `sql/066`–`067`) —
    komentar **moderation-first** di atas resource TERBIT & publik: thread, komentar
    ber-kedalaman-terbatas, riwayat moderasi append-only, laporan, setting per-tenant,
    telemetri anti-abuse terminimalisasi, langganan notifikasi-balasan terenkripsi, antrean
    moderasi admin `/admin/comments`. Seam kontribusi `commentableResources`
    (`MODULE_CONTRACT_VERSION` 2.3.0), **nol `AccessAction` baru**. Tulang punggung
    keamanan: batas publikasi di perbatasan resource→thread, simpan-teks-polos +
    escape-saat-render (tak ada XSS tersimpan), respons publik seragam (tanpa oracle),
    PII penulis di-hash/mask. Diverifikasi terhadap Postgres nyata: 67 migrasi bersih,
    FORCE RLS di 7 tabel, grant worker persis matriks.

- **Cache tepi Varnish auto-aktivasi** ([ADR-0042](adr/0042-varnish-edge-cache-auto-activation.md),
  #234/#237, `sql/068`) — subsistem `src/lib/edge-cache/`, VCL `infra/varnish/`, antrean purge
  transaksional `awcms_edge_cache_purges` (FORCE RLS), worker `bun run edge-cache:purge`, gate
  `bun run edge-cache:surfaces:check`, skill `awcms-edge-cache`, dokumen
  [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md). **Default `off` =
  no-op total.** Tiga lapis default-deny independen; sinyal tekanan hanya mengubah _berapa
  lama_, tidak pernah _apa_ yang boleh di-cache. Emisi purge terpasang di jalur tulis
  `blog_content` dan `theming` (publish/rollback/retire, #246). `news_portal`/`media_library`
  sengaja TIDAK — keduanya tidak memiliki surface ter-deklarasi, jadi ban untuk key-nya tak
  akan cocok apa pun sementara antrean melapor sukses. Gate `edge-cache:surfaces:check`
  menuntut call-site purge dari tiap modul yang MEMILIKI surface, sehingga kewajibannya
  muncul sendiri begitu salah satunya mendeklarasikan surface.
  **AKTIF di staging sejak 2026-07-26** (`EDGE_CACHE_MODE=on`, Varnish 7.5 di
  depan Traefik, worker purge tiap menit) — dan pengaktifan itulah yang
  membongkar TIGA bug yang lolos review dan `bun run check`: ekspresi ban
  dengan spasi literal (ditolak Varnish, tetap balas 200), method `BAN` yang
  Bun kirim sebagai `GET`, dan policy RLS `sql/068` yang memakai GUC
  `awcms.tenant_id` sehingga **publish blog gagal 500** saat cache menyala
  (diperbaiki `sql/070`). Ketiganya melapor sukses sambil tidak bekerja. Detail
  - gate baru di [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md)
    §Pelajaran.
- **Rekonsiliasi DNS subdomain tenant** (#236, `sql/069`) — `ensureServingRecord`
  desired-state (drift → `PUT`, tidak pernah `POST` kedua), `reconcileServingRecords`,
  `bun run tenant-domain:dns:sync` sebagai `awcms_worker` SELECT-only. Tanpa
  `TENANT_DOMAIN_SERVING_TARGET` job no-op — tidak ada default, karena menebak berarti
  outage seluruh platform.
- **Dua environment ter-deploy nyata** — produksi `awcms.ahlikoding.com`, staging
  `awcms-staging.ahlikoding.com` (Coolify, host yang sama, DB & secret terpisah). Staging
  ter-migrasi penuh (69) dan berjalan sebagai role least-privilege terpisah. Rincian,
  termasuk jebakan "user Coolify itu superuser sehingga RLS inert", di
  [`awcms/environments.md`](awcms/environments.md).

## 4. Backlog / langkah berikutnya

- **Serap tulang punggung awcms-mini → awcms (fondasi bisnis + SaaS control plane).**
  Peta eksekusi di
  [`awcms/absorb-awcms-mini-backbone-roadmap.md`](awcms/absorb-awcms-mini-backbone-roadmap.md).
  **Temuan audit 2026-07-25:** lima modul sudah di-`Accepted` oleh ADR di repo ini tetapi
  **tidak ada kodenya** — `organization_structure` (ADR-0016), `document_infrastructure`
  (ADR-0017), `data_exchange` (ADR-0018), `integration_hub` (ADR-0019), `reference_data`
  (ADR-0021); kelimanya matang di mini. [ADR-0020](adr/0020-erp-extension-readiness-contracts.md)
  (kontrak kesiapan ERP) juga `Accepted` tanpa implementasi `_shared`. Klaster SaaS control
  plane (7 modul mini) **belum di-admit sama sekali** di sini dan butuh ADR admission baru
  sebelum baris implementasinya boleh dikerjakan.
- **Serap awcms-micro → awcms (program utama, [ADR-0035](adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)).**
  Peta bergelombang & urutan dependensi ada di
  [`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md) — satu PR
  atomic per modul, adaptasi (rename `awcms_micro_` → `awcms_`, migrasi lanjut dari nomor
  berikutnya setelah `sql/070`), lulus `bun run check`. Progres:
  - **Wave 0 — SUDAH:** `tenant-domain` (#219), paritas admin shell/chrome (#229).
    **BELUM:** pustaka komponen `src/components/ui/` + paritas design-token (#229 menyentuh
    shell admin, bukan pustaka komponen reusable). Seam kontribusi descriptor
    (`dataLifecycle`, capability `seo_facts`, `searchSources`, `commentableResources`) sudah
    mendarat sepanjang Wave 1; `newsletterContentSources` belum.
  - **Wave 1 — SUDAH:** `visitor-analytics` (#220), `media-library` (#221, inversi ADR-0036),
    `data-lifecycle` (#222, ADR-0037), `seo-distribution` (#223/#224, ADR-0038/0039 — discovery
    **dan** redirect governance, LENGKAP), `form-drafts` (#230), `site-search` (#231, ADR-0040).
    `comments` ([ADR-0041](adr/0041-comments-module-admission.md), `sql/066`–`067`).
    **BELUM:** `newsletter`, `social-publishing` (mengaktifkan hook publish yang
    kini no-op di `blog-content`).
- **Environment ter-deploy — SELESAI, tiga fase setara.** Produksi
  `awcms.ahlikoding.com`, staging `awcms-staging.ahlikoding.com`, dan
  development lokal kini identik: migrasi **70**, 118 tabel, 197 permission, RLS
  `ENABLE`+`FORCE` 109/118, runtime sebagai `awcms_app` (bukan superuser), owner
  `admin@ahlikoding.com` dengan role `owner` 197/197, dan
  `PUBLIC_DEFAULT_TENANT_*` di-pin per fase. Isolasi dibuktikan sebagai
  `awcms_app` (`0 / 1 / 0`), bukan diasumsikan. Suite DB-gated jalan di dev
  (harness 142 + legacy 64, nol gagal). Detail dan jebakannya di
  [`awcms/environments.md`](awcms/environments.md).
- **Cache tepi Varnish ([ADR-0042](adr/0042-varnish-edge-cache-auto-activation.md), `sql/068`).**
  Tier cache OPSIONAL di depan aplikasi, default MATI dan no-op saat mati. Allow-list
  surface fail-closed (`src/lib/edge-cache/`), aktivasi otomatis berbasis tekanan origin,
  VCL default-deny (`infra/varnish/`), antrean invalidasi tahan-lama + worker
  `bun run edge-cache:purge`, gate `bun run edge-cache:surfaces:check`.
  **SUDAH sejak #246:** emisi purge dari `theming` (publish/rollback/retire, satu
  transaksi dengan perubahannya) dan gate kepemilikan — tiap modul yang memiliki
  surface ter-deklarasi WAJIB punya call-site purge. **BELUM:** surface discovery
  ber-resolusi-host (`serveDiscovery` tak menerima `locals`). Rinci di
  [`awcms/edge-cache-architecture.md`](awcms/edge-cache-architecture.md).
  - **Wave 2 — INTI SELESAI:** delta auth/admin. **SUDAH:** penataan sidebar per-tenant
    (#272, `sql/071`–`072`); **password reset lewat email** (`sql/073`) — dua endpoint publik
    enumeration-safe + `/forgot-password`/`/reset-password`, single-use ditegakkan dengan row
    lock, reset mencabut semua sesi, identity SSO-only ditolak di jalur permintaan DAN
    penebusan, pengiriman lewat capability port `auth_notification` (bukan INSERT lintas-modul
    ke `awcms_email_messages`); **self-registration ber-persetujuan admin** (`sql/074`–`075`,
    default MATI, tak pernah menyimpan kredensial — approval membuat akun dengan password tak
    terpakai lalu mengirim link reset); layar `/admin/security` (postur deployment read-only +
    policy autentikasi tenant + enforcement MFA + daftar provider OIDC read-only) —
    endpoint-nya ada sejak #184/#185, layarnya tidak, jadi policy hanya bisa diubah lewat
    `curl`. **Inti Gelombang 2 SELESAI**; sisa opsional: login OIDC Google spesifik, reframe
    default `online-security-config`, paritas halaman admin modul Gelombang 0–1.
  - **Wave 3 — BELUM:** trajektori e-commerce/toko online (ADR sendiri).
  - Sebelum tiap port berikutnya: **cek inversi-vs-net-baru** (mis. media sudah jadi satu modul
    pemilik — konsumen wajib lewat port `media_library`, jangan buat tabel media baru).
    (`blog-content` + `news-portal` SUDAH di-port — PR #214.)
- **Rute publik host-resolved**: `tenant-domain` sudah mendarat; adopsi rute `/news/**` +
  rute konten host-based `/blog/{slug}` (agar `<loc>` sitemap SEO resolve tanpa tenantCode)
  masih follow-up (lihat README `seo-distribution` §follow-up).
- **Port generator `repo:inventory`** dari mini agar `repo-inventory.md` jadi ter-generate.
- **Seam yang menunggu penyedia**: business-scope resolver base masih NO-OP fail-closed;
  SoD base kini ship **1 rule** (`data_lifecycle.legal_hold_maker_checker`, ADR-0037) — bukan
  lagi 0 (rule ilustratif tambahan tetap di fixture).

## 5. Kontrak alur kerja (ringkas)

1. **Mini-first**: fitur fondasi diuji di `awcms-mini` dulu, lalu **diport** ke sini
   (rename prefix `awcms_mini_` → `awcms_`, penomoran migrasi lanjut). Lihat
   [`awcms/alur-pengembangan-mini-first.md`](awcms/alur-pengembangan-mini-first.md).
2. **Branch dulu** (jangan commit ke `main`); satu PR = satu perubahan atomic.
3. **`bun run check` PENUH** sebelum PR (lint + docs + kontrak + typecheck + test + build;
   `bun run format` dulu bila perlu). Changeset wajib untuk perubahan perilaku.
4. Migration/OpenAPI/AsyncAPI disinkronkan setiap perubahan schema/API/event.

## 6. Jebakan yang tak terlihat dari kode (baca sebelum menyentuh area terkait)

- **Migration terapan itu immutable**: edit `sql/NNN` yang sudah jalan (bahkan komentar)
  memblokir `db:migrate` di deployment jalan — koreksi lewat migration baru.
- **RLS `ENABLE` tanpa `FORCE` itu inert** untuk table owner; wajib `FORCE` +
  role non-owner (`awcms_app`). Uji RLS di bawah role `awcms_app` LOGIN, bukan superuser.
- **4xx yang di-`return` dari dalam `withTenant` itu COMMIT** — bukan rollback.
- **Keyset cursor**: timestamptz mikrodetik vs `Date` JS milidetik → bawa `created_at`
  sebagai teks presisi penuh, jangan re-parse ke `Date`.
- **Snapshot OpenAPI beku**: test subset add-only — jangan edit snapshot; evolusi via
  `INTENTIONALLY_EVOLVED_PATHS` allow-list.
- **Postgres lokal**: host bisa rusak, dan koneksi host→container kini bisa timeout di
  sandbox → jalankan `db:migrate` + test DB-gated **di dalam** container bun yang berbagi
  network namespace dengan container Postgres (`docker run --network container:<pg> oven/bun …`).
  Catatan: image bun tanpa git → 2 test `check-docs-integration` gagal palsu di container
  (verifikasi di host/CI).
- **CI**: GitGuardian & CodeQL adalah required check; CodeQL run kadang orphan di antrean →
  picu ulang dengan empty commit; flake Postgres CI → `gh run rerun --failed`.
- **Subagent di working tree bersama** bisa memindahkan HEAD → verifikasi
  `git branch --show-current` sebelum commit.

Detail lebih dalam ada di skill terkait (`awcms-new-migration`, `awcms-abac-guard`,
`awcms-testing`, `awcms-sync-hmac`, dst.) dan di ADR.

## 7. Cara melanjutkan

- Mulai unit kerja: skill `awcms-implement-issue` (orkestrator) → `awcms-new-module` /
  `awcms-new-migration` / `awcms-new-endpoint` / `awcms-new-event`.
- Port dari mini: skill `awcms-port-from-mini`.
- Review/keamanan: skill `awcms-pr-review`, `awcms-security-review`, subagent
  `awcms-reviewer` / `awcms-security-auditor`.
- Perbarui **dokumen ini** setiap ada perubahan state besar (modul/migrasi baru, keputusan
  tata kelola, backlog selesai) agar tetap jadi titik-lanjut yang akurat.
