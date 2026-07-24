# ADR-0035 — awcms sebagai template online-first hybrid, siap ERP + SaaS terintegrasi, dan superset keluarga (menyerap awcms-micro)

- **Status:** Accepted
- **Tanggal:** 2026-07-24
- **Pengambil keputusan:** @ahliweb
- **Menyempurnakan (partial supersede):** [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) — khusus bagian **positioning**: tabel scope §Keputusan.1 dan identitas "offline-first" untuk `awcms`. **Menegaskan kembali** (tidak diubah) ADR-0034 §Keputusan.2 & §3 (template dipakai-langsung, TIDAK ada repo turunan, modul domain hidup langsung di `src/modules/`) dan seluruh konvensi runtime.
- **Menegaskan kembali:** ADR-0001 (Bun-only/RLS/RBAC-ABAC), ADR-0003 (RLS FORCE), ADR-0004 (default-deny, deny-overrides-allow), ADR-0006 (outbox/sync — kini menjadi _paruh offline_ dari mode hybrid), ADR-0007/0008 (kontrak), ADR-0011 (capability ports).
- **Selaras dengan:** awcms-micro (tetap template website full-online yang ramping) dan awcms-mini (tetap template fondasi hybrid offline-first, siap SaaS).

## Konteks

ADR-0034 memposisikan `awcms-mini` / `awcms` / `awcms-micro` sebagai **tiga template sejajar dipakai-langsung**, dibedakan oleh **scope**, dan mencatat `awcms` sebagai **offline-first / LAN-first** dengan scope "fondasi ERP + kontrak kesiapan ERP". Positioning itu menyisakan dua hal yang kini ingin diubah oleh maintainer:

1. **Mode operasi.** `awcms` dipakai untuk solusi ERP/back-office dan SaaS yang **terhubung online sebagai keadaan normal** (multi-cabang tersinkron, portal pelanggan, integrasi provider). Memasarkannya sebagai "offline-first" salah menaruh prioritas: yang benar adalah **hybrid online + offline dengan prioritas online-first** — online adalah jalur utama, offline/LAN adalah mode ketahanan (bukan sebaliknya seperti `awcms-mini`).
2. **Scope.** Batas scope ADR-0034 antara `awcms` (ERP/back-office) dan `awcms-micro` (website full-online → toko online) membuat kapabilitas website/e-commerce, UI/UX, dan pengerasan auth yang **sudah matang di `awcms-micro`** seolah "milik repo lain". Padahal produk ERP/SaaS nyata membutuhkannya (portal publik, katalog, toko online, SEO, komentar, newsletter, media library, self-registration). Maintainer memutuskan `awcms` menjadi **superset**: fondasi awcms-mini + skop ERP + **seluruh** klaster website/e-commerce awcms-micro.

Perubahan ini **positioning & scope**, bukan arsitektur runtime, dan **tidak** menghidupkan kembali jalur repo-turunan yang dihapus ADR-0034.

## Keputusan

### 1. `awcms` = template online-first hybrid, siap ERP + SaaS terintegrasi

Mode operasi kanonik `awcms` adalah **hybrid online + offline dengan prioritas online-first**: konektivitas online adalah jalur utama dan default deployment; kapabilitas offline/LAN (outbox/sync HMAC, ADR-0006) tetap ada dan didukung sebagai **mode ketahanan**, bukan asumsi utama. `awcms` diposisikan **siap ERP** (mengonsumsi kontrak kesiapan ERP ADR-0020 dengan modul domain langsung di `src/modules/`) dan **dibangun untuk SaaS terintegrasi** (multi-tenant, portal publik, integrasi provider).

`awcms` **dikembangkan dari basis teknis `awcms-mini`** (mengadopsi stack & standar modular-monolith-nya) dan mengambil kapabilitas matang dari `awcms-micro`. Ini adalah pernyataan **lineage/positioning**, bukan pengembalian model "base-wajib + turunan": ketiganya tetap template dipakai-langsung (ADR-0034 §Keputusan.1 poin governance tetap berlaku; hanya baris scope/mode `awcms` yang disempurnakan di sini).

### 2. `awcms` = superset keluarga (menyerap awcms-micro)

`awcms` **menyerap** klaster website/e-commerce, UI/UX, dan pengerasan auth `awcms-micro` **langsung ke `src/modules/`** template ini (bukan repo terpisah, konsisten ADR-0034 §2/§3). Cakupan penyerapan (delta terhadap yang sudah ada di `awcms`):

- **Modul website/konten:** `media-library`, `tenant-domain` (routing host→tenant), `form-drafts`, `seo-distribution`, `site-search`, `comments`, `newsletter`, `social-publishing`, `visitor-analytics`, `data-lifecycle`. (`theming`, `blog-content`, `news-portal` sudah ada.)
- **UI/UX:** pustaka komponen `src/components/ui/` + paritas design-token, diselaraskan dengan overhaul admin `awcms` yang sudah ada (PR #215), bukan menimpanya.
- **Auth/admin:** self-registration, password reset, admin security policy UI, per-tenant sidebar menu, delta OIDC (mis. login Google spesifik) — **hanya yang belum ada** di `awcms` (yang sudah punya MFA, OIDC/SSO generik, ABAC DSL, business-scope, SoD, Turnstile, break-glass).
- **Trajektori e-commerce/toko online** (katalog/storefront/keranjang/checkout online) adalah epik lanjutan ber-ADR sendiri (belum dibangun di micro juga).

Peta eksekusi bertahap (per-modul, satu PR atomic, lulus `bun run check`) ada di [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md). Penyerapan mengikuti pola **adaptasi bukan salin** (rename prefix `awcms_micro_` → `awcms_`, penomoran migrasi lanjut dari `sql/045`).

### 3. Posisi ketiga template setelah ADR ini

| Repositori    | Mode operasi                           | Scope                                                     |
| ------------- | -------------------------------------- | --------------------------------------------------------- |
| `awcms-mini`  | **hybrid offline-first**, siap SaaS    | Fondasi reusable generik (standar modular-monolith)       |
| `awcms`       | **hybrid online-first**, siap ERP+SaaS | **Superset**: ERP/back-office + website + e-commerce      |
| `awcms-micro` | full-online                            | Website full-online → toko online (ramping, website-only) |

`awcms` menjadi template "paling lengkap": fondasi mini + ERP + seluruh website/e-commerce micro, online-first, offline tetap didukung. `awcms-micro` tetap template full-online website-only yang ramping (tidak membawa skop ERP). `awcms-mini` tetap fondasi hybrid offline-first.

## Konsekuensi

- **Reposisi dokumen (langkah dokumen ini):** README/README.id, AGENTS, PROJECT_STATE, paket `docs/awcms/` (01/06/09/10/12/13/15, alur-pengembangan-mini-first, README index, api-contribution-guide) disetel ke positioning baru; dokumen lama yang menyebut `awcms` "offline-first" atau "ERP di repo turunan terpisah" diperlakukan usang/diperbarui.
- **Manifest keluarga:** `awcms-family-compatibility.yaml` field `role` diperbarui (drop rujukan ADR-0022, nyatakan online-first hybrid superset); rasionalisasi divergence Turnstile diselaraskan ("jaminan offline-first" → "mode offline/LAN dari hybrid"). `reviewDate` divergence tidak diubah. Gate `family:conformance:check` tetap hijau.
- **Kontrak:** tidak ada kenaikan. `MODULE_CONTRACT_VERSION` sudah `2.0.0` (dinaikkan oleh ADR-0034); penyerapan modul memakai kontrak yang sama.
- **`sync-storage`/ADR-0006:** dipertahankan sebagai **paruh offline** dari mode hybrid — tetap load-bearing, hanya diprioritaskan di bawah jalur online.
- **Tidak berubah:** seluruh konvensi runtime (Bun-only, RLS FORCE, RBAC/ABAC default-deny, kontrak OpenAPI/AsyncAPI, registry base, gate CI) dan model tata kelola ADR-0034 (dipakai-langsung, tanpa repo turunan). ADR ini mengubah **positioning & scope**, bukan mekanisme.
