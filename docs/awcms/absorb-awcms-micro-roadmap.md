# Roadmap Penyerapan awcms-micro → awcms

> **Sumber keputusan:** [ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
> (menyempurnakan positioning [ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)).
> `awcms` diposisikan **online-first hybrid, siap ERP + SaaS terintegrasi, dan superset
> keluarga** yang **menyerap** klaster website/e-commerce, UI/UX, dan pengerasan auth
> `awcms-micro` **langsung ke `src/modules/`** (bukan repo turunan; ADR-0034 §2/§3 tetap
> berlaku). Dokumen ini adalah **peta eksekusi bertahap** program itu. Sumber kebenaran
> state tetap kode + `sql/` + `bun run check`; perbarui tabel status di §5 saat sebuah
> modul selesai di-port.

Repo sumber port: `awcms-micro` (`/home/data/dev_react/awcms-micro`). Pola port sama seperti
alur mini-first ([`alur-pengembangan-mini-first.md`](alur-pengembangan-mini-first.md)) — kini
dengan awcms-micro sebagai sumber kedua.

## 1. Prinsip penyerapan (wajib per modul)

Setiap penyerapan = **satu PR atomic**, **adaptasi bukan salin**:

1. **Delta analysis dulu.** Bandingkan dengan yang SUDAH ada di `awcms` (§2). Port **hanya**
   yang belum ada; jangan menimpa/mundurkan kapabilitas awcms yang sudah lebih maju
   (mis. auth: awcms sudah punya MFA/OIDC/SSO/business-scope/SoD/Turnstile/break-glass).
2. **Rename prefix** `awcms_micro_` → `awcms_` (tabel, GUC, konstanta, env, katalog permission).
3. **Penomoran migrasi lanjut & rapat** dari migrasi tertinggi saat ini (`sql/045`;
   nomor berikutnya 046), **sekuensial tanpa gap** — gap sengaja milik micro (ranges ERP
   tak-diport) TIDAK dibawa ke sini. Migrasi terapan itu immutable; koreksi via migrasi baru.
4. **Drop dependensi/toolchain yang belum ada di awcms**; bila sebuah modul butuh seam yang
   belum ada, port seam-nya di Gelombang 0 dulu.
5. **RLS FORCE + tenant_id-first** untuk setiap tabel tenant-scoped; uji RLS di bawah role
   `awcms_app` LOGIN (bukan superuser).
6. **Sinkronkan kontrak**: fragment OpenAPI per-modul + bundle (ADR-0026), AsyncAPI untuk
   event baru. Snapshot beku → evolusi via `INTENTIONALLY_EVOLVED_PATHS`.
7. **Test** unit + integration (dua-world) + contract + security; **docs + skill** modul;
   **changeset**; daftarkan di `src/modules/index.ts`.
8. **Lulus `bun run check` PENUH** sebelum PR.

`MODULE_CONTRACT_VERSION` sudah `2.0.0` (dinaikkan ADR-0034) — tidak ada kenaikan kontrak
untuk penyerapan ini.

## 2. Delta: sudah ada di awcms vs yang diserap

**Sudah ada (JANGAN port ulang):** `tenant-admin`, `identity-access` (login, sesi, RBAC,
ABAC DSL, MFA TOTP + step-up, OIDC/SSO generik + break-glass, business-scope, SoD, Turnstile),
`profile-identity`, `logging`, `module-management`, `sync-storage`, `workflow-approval`,
`reporting`, `email`, `domain-event-runtime`, **`theming`, `blog-content`, `news-portal`**.

**Diserap dari awcms-micro (belum ada di sini):** pustaka UI `src/components/ui/`,
seam kontribusi konten, `media-library`, `tenant-domain`, `form-drafts`, `seo-distribution`,
`site-search`, `comments`, `newsletter`, `social-publishing`, `visitor-analytics`,
`data-lifecycle`; delta auth/admin (self-registration, password reset, admin security policy
UI, per-tenant sidebar menu, login OIDC Google spesifik — **verifikasi mana yang belum ada**);
trajektori e-commerce/toko online (epik lanjutan).

## 3. Gelombang & urutan dependensi

Modul dalam satu gelombang sebagian besar paralel secara logis, tetapi penomoran migrasi
menyerialkan urutan commit. Kerjakan berurut per baris.

### Gelombang 0 — infra fondasi (membuka jalan sisanya)

| Item                                                    | Sumber micro                                                     | Catatan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pustaka `src/components/ui/` + paritas design-token     | `src/components/ui/`, `src/styles/tokens.css`                    | **Rekonsiliasi** dengan overhaul admin awcms yang sudah ada (PR #215: `admin.css`/`admin-screens.css`) — jangan timpa. Komponen: DataTable, FilterBar, FormField, Pagination, StatusBadge, StateNotice, ConfirmDialog, ActionBanner + primitives wizard.                                                                                                                                                                                                                                                                              |
| Seam kontribusi pada `ModuleDescriptor`                 | `_shared/module-contract.ts`                                     | Tambah field descriptor `seo_facts`, `searchSources`, `commentableResources`, `newsletterContentSources` **bila belum ada** di `src/modules/_shared/module-contract.ts`. Dikonsumsi Gelombang 1.                                                                                                                                                                                                                                                                                                                                      |
| `media-library` (**wave INVERSI**, bukan Wave-0 aditif) | `src/modules/media-library/`, sql media-library micro            | ✅ **selesai** ([ADR-0036](../adr/0036-media-library-module-admission-ownership-inversion.md)). Bukan port aditif: **inversi kepemilikan ADR-0026** — registry R2 + presign/finalize/cancel + MIME sniffing + job `news-media:reconcile` **DIEKSTRAK keluar dari `news_portal`** ke `media_library`; port `news_media` dipensiunkan → `media_library`; migrasi permission destruktif `052`, tenant-state `053`, enforcement `054` (+ endpoint `POST /api/v1/media/enforcement`). Step 5b/5c/5d (`/admin/media`, srcset, PDF) ditunda. |
| `tenant-domain`                                         | `src/modules/tenant-domain/`, sql tenant-domain micro (ADR-0010) | Routing host→tenant; **buka rute publik `/news/**` host-resolved + custom domain** (prioritas tinggi, sudah ditandai di PROJECT_STATE). Adopsi [ADR-0010](../adr/0010-public-host-tenant-routing.md) yang sudah ada di awcms.                                                                                                                                                                                                                                                                                                         |

### Gelombang 1 — klaster website/konten (mengandalkan seam Gelombang 0; blog/news sudah ada)

| Item                                                                     | Sumber micro                                | Bergantung pada                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `form-drafts` + primitives wizard                                        | `src/modules/form-drafts/`                  | UI lib (G0)                                                                         |
| `seo-distribution` (+ endpoint publik sitemap/robots/RSS/Atom/JSON feed) | `src/modules/seo-distribution/` (ADR-0028)  | seam `seo_facts`; blog/news sudah ada (penyedia fakta)                              |
| `site-search`                                                            | `src/modules/site-search/` (ADR-0031 micro) | seam `searchSources`; konten published                                              |
| `comments`                                                               | `src/modules/comments/` (ADR-0032 micro)    | seam `commentableResources`; anti-abuse (honeypot/timing/rate-limit), PII hash+mask |
| `newsletter`                                                             | `src/modules/newsletter/` (ADR-0033 micro)  | seam `newsletterContentSources`; double-opt-in, suppression                         |
| `social-publishing`                                                      | `src/modules/social-publishing/`            | `blog-content` (mengaktifkan hook publish yang kini no-op)                          |
| `visitor-analytics`                                                      | `src/modules/visitor-analytics/`            | privacy-first; rollup/purge                                                         |
| `data-lifecycle`                                                         | `src/modules/data-lifecycle/`               | descriptor retensi per-modul + legal-hold                                           |

### Gelombang 2 — delta auth/admin + pengerasan online-first

- **self-registration** (public registration request + approval admin) — verifikasi belum ada.
- **password reset** enumeration-safe — **verifikasi**; bila awcms belum punya, port.
- **admin security policy UI** (`/admin/security`) untuk auth policy tenant.
- **per-tenant sidebar menu management** (`/admin/sidebar-menu`).
- **login OIDC Google spesifik** — awcms punya OIDC generik; port hanya bila diinginkan.
- **reframe default `online-security-config`** untuk online-first (gate full-online aktif
  sebagai default, LAN/offline tetap exempt sesuai divergence Turnstile).
- **paritas halaman admin** untuk semua modul baru Gelombang 0–1.

### Gelombang 3 — trajektori e-commerce/toko online (epik lanjutan, ADR sendiri)

Katalog/storefront/keranjang/checkout online. Belum dibangun di micro juga — rancang lewat
ADR baru + perencanaan tersendiri sebelum implementasi.

## 4. Verifikasi per PR

`bun run check` penuh (lint + docs + kontrak + typecheck + test + build); untuk perubahan UI
non-trivial tambahkan E2E `bun run test:e2e`. Uji RLS di bawah `awcms_app` LOGIN. Snapshot
OpenAPI beku (add-only). Changeset wajib.

## 5. Status penyerapan (perbarui saat selesai)

| Gelombang | Item                                                                          | Status               | PR   |
| --------- | ----------------------------------------------------------------------------- | -------------------- | ---- |
| 0         | `src/components/ui/` + token                                                  | ⏳ belum             | —    |
| 0         | Seam kontribusi `ModuleDescriptor`                                            | ⏳ belum             | —    |
| 0         | `media-library` (wave INVERSI, ADR-0036)                                      | ✅ selesai           | #221 |
| 0         | `tenant-domain`                                                               | ✅ selesai           | #219 |
| 1         | `form-drafts`                                                                 | ⏳ belum             | —    |
| 1         | `seo-distribution`                                                            | ⏳ belum             | —    |
| 1         | `site-search`                                                                 | ⏳ belum             | —    |
| 1         | `comments`                                                                    | ⏳ belum             | —    |
| 1         | `newsletter`                                                                  | ⏳ belum             | —    |
| 1         | `social-publishing`                                                           | ⏳ belum             | —    |
| 1         | `visitor-analytics`                                                           | ✅ selesai           | #220 |
| 1         | `data-lifecycle` ([ADR-0037](../adr/0037-data-lifecycle-module-admission.md)) | ✅ selesai           | —    |
| 2         | Delta auth/admin                                                              | ⏳ belum             | —    |
| 3         | E-commerce/toko online                                                        | ⏳ belum (butuh ADR) | —    |
