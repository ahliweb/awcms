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

| Aspek      | Nilai (per commit ini)                                                                                       | Sumber kebenaran                          |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Versi      | **6.0.0** (rilis nyata pertama 2026-07-21, tag `v6.0.0`); 13 changeset MINOR/PATCH menunggu rilis berikutnya | `package.json`, `CHANGELOG.md`, tag `v*`  |
| Modul base | **18** (lihat daftar di ARCHITECTURE.md)                                                                     | `src/modules/index.ts`                    |
| Migrasi    | **61** (`sql/001`–`061`)                                                                                     | `ls sql/`                                 |
| ADR        | **40** (`0000`–`0039`)                                                                                       | `docs/adr/README.id.md` (indeks ter-gate) |
| Kontrak    | OpenAPI modular per-modul + AsyncAPI                                                                         | `openapi/`, `asyncapi/`                   |

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

Modul (18): `tenant-admin`, `identity-access`, `profile-identity`, `logging`,
`module-management`, `sync-storage`, `workflow-approval`, `reporting`, `email`,
`domain-event-runtime`, `theming`, `blog-content`, `news-portal`, **`tenant-domain`**,
**`visitor-analytics`**, **`media-library`**, **`data-lifecycle`**, **`seo-distribution`**.
(Lima terakhir = gelombang penyerapan awcms-micro, 2026-07-24/25 — lihat §3/§4.)

> Catatan: generator `repo:inventory` **belum diport** dari `awcms-mini`, jadi
> [`awcms/repo-inventory.md`](awcms/repo-inventory.md) adalah placeholder — jangan
> jadikan sumber angka. Gunakan ARCHITECTURE.md / registry / `sql/`.

## 3. Yang sudah selesai (jangan dibangun ulang)

- **18 modul** aktif dengan RLS `FORCE`, pemisahan role DB
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
- **Kontrak OpenAPI modular** per-modul + bundler deterministik (ADR-0026), **family
  compatibility manifest + CI conformance** (ADR-0032).
- **Penyerapan awcms-micro — Wave 0/1 (2026-07-24/25, PR #218–#224, `sql/046`–`sql/061`).**
  Lima modul baru diserap satu-PR-atomic-per-modul lewat pipeline delta → coder →
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

## 4. Backlog / langkah berikutnya

- **Serap awcms-micro → awcms (program utama, [ADR-0035](adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)).**
  Peta bergelombang & urutan dependensi ada di
  [`awcms/absorb-awcms-micro-roadmap.md`](awcms/absorb-awcms-micro-roadmap.md) — satu PR
  atomic per modul, adaptasi (rename `awcms_micro_` → `awcms_`, migrasi lanjut dari
  `sql/061`), lulus `bun run check`. Progres:
  - **Wave 0 — SUDAH:** `tenant-domain` (#219). **BELUM:** pustaka `src/components/ui/`
    (seam kontribusi descriptor `dataLifecycle`/`seo_facts` sudah mendarat sepanjang Wave 1).
  - **Wave 1 — SUDAH:** `visitor-analytics` (#220), `media-library` (#221, inversi ADR-0036),
    `data-lifecycle` (#222, ADR-0037), `seo-distribution` (#223/#224, ADR-0038/0039 — discovery
    **dan** redirect governance, LENGKAP). **BELUM:** `form-drafts`, `site-search`, `comments`,
    `newsletter`, `social-publishing` (mengaktifkan hook publish yang kini no-op di `blog-content`).
  - **Wave 2 — BELUM:** delta auth/admin (self-registration, password reset, admin security UI,
    sidebar menu per-tenant).
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
