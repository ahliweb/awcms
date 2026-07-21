---
name: awcms-theming
description: Kelola/konsumsi modul theming AWCMS — presentasi tenant-selectable via theme descriptor build-time tepercaya (ADR-0034 Fase 3, modul website pertama yang di-port LANGSUNG ke base ini). Gunakan saat menambah/mengubah endpoint `/api/v1/theming/*`, mengubah lifecycle draft→validate→preview→publish→rollback/retire, menyentuh security spine validasi CSS by-rejection, atau menambah theme baru ke registry base. Sesuai src/modules/theming/README.md dan ADR-0034 (awcms-micro ADR-0029).
---

# AWCMS — Theming (presentasi tenant-selectable)

Baca `src/modules/theming/README.md` dan `src/modules/theming/module.ts` untuk
detail penuh — skill ini merangkum keputusan yang sudah dibuat supaya tidak
di-re-derive. Modul `theming` (`type: "domain"`, `status: "active"`, versi
`1.0.0`) adalah modul website **pertama yang diimplementasikan LANGSUNG di base
awcms** (ADR-0034 Fase 3, "template dipakai-langsung"; diadaptasi dari
awcms-micro `theming` / ADR-0029). ADR-0034 mencabut larangan
`no-content-website-modules`, jadi modul konten/website memang boleh hidup di
`src/modules/` — **tidak ada** repo turunan, `application-registry.ts`, atau
`extension:check`. Registry base naik 10 → 11 modul.

Skema di repo ini: `sql/033_awcms_theming_config_schema.sql` (tiga tabel
tenant-scoped) dan `sql/034_awcms_theming_permissions.sql` (seed permission
katalog global). Verifikasi selalu dengan `ls sql/ | grep theming` sebelum
mengutip nomor migrasi.

## Kapan pakai skill ini vs skill generik

Melengkapi (bukan menggantikan) `awcms-new-endpoint`, `awcms-new-migration`,
`awcms-abac-guard`, `awcms-idempotency`, `awcms-audit-log` — itu tetap dipakai
untuk cara membangun endpoint/migration/guard/idempotency/audit. Skill ini
menyediakan konteks domain `theming` spesifik: pemisahan theme (kode) vs config
(data), security spine validasi CSS, immutability published version, dan model
preview.

## Dua hal yang dipisahkan KETAT (theme = kode, config = data)

- **Theme** = `ThemeDescriptor` yang disusun `theme-registry.ts` dari theme base
  in-repo yang sudah direview, di-bundle saat BUILD-TIME. Sumber tepercaya,
  **bukan** baris database, **bukan** artefak upload. Theme baru ditambahkan
  LANGSUNG ke `theme-registry.ts` (contoh: `themes/default-theme.ts` = theme
  `aria`) — tidak ada seam theme repo turunan (dihapus ADR-0034 Fase 2).
- **`ThemeConfig`** = DATA konfigurasi tenant ATAS sebuah theme: override design
  token, pilihan slot variant, id media asset, urutan section, penempatan nav.
  Tersimpan di DB (`awcms_theming_config_versions` + `awcms_theming_tenant_state`,
  sql/033, RLS FORCE), di-schema-validate & dibatasi di `domain/theme-config.ts`
  sebelum disimpan.

Yang me-render HANYA `src/layouts/PublicThemeLayout.astro` (build-time
tepercaya). **Tidak ada kolom template eksekutabel di mana pun di skema** — tidak
ada Astro/JS/SQL/eval/raw HTML yang di-authoring tenant.

## Security spine — `domain/css-value-validation.ts` (validasi by-rejection)

Setiap NILAI design-token divalidasi dengan **PENOLAKAN, bukan sanitasi**
(menolak, bukan strip → menyingkirkan seluruh kelas
`js/incomplete-multi-character-sanitization`):

- `assertSafeCssPrimitive` — charset-terbatas, panjang-dibatasi
  (`MAX_CSS_TOKEN_VALUE_LENGTH`), bebas control-char, menolak
  `url(` / `expression` / `@import` / `javascript:` / `/*` / `;{}<>` /
  backslash / paren tak seimbang.
- `validateColorValue` / `validateDimensionValue` (unit dari
  `DIMENSION_UNIT_ALLOW_LIST`) / `validateNumberValue` / `validateFontStack` —
  grammar ketat & linear (no-ReDoS).
- Font family dipilih dari **allow-list per-theme**; stack CSS yang di-emit
  adalah milik descriptor, jadi tidak ada nilai font yang pernah di-authoring
  tenant.

`serializeThemeTokensCss` aman by-construction (re-validasi tiap nilai) dan
meng-emit blok `:root { --awcms-theme-* }` yang disajikan sebagai **stylesheet
EXTERNAL same-origin** (`/theming/{tenantCode}/tokens.css`,
`src/pages/theming/[tenantCode]/tokens.css.ts`) — jadi CSP `style-src 'self'`
aplikasi TIDAK PERNAH dilemahkan (tak ada `<style>` inline per-request). Jangan
regresi ini menjadi inline style.

## Lifecycle — draft → validate → preview → publish → rollback/retire

Route admin di `src/pages/api/v1/theming/*`:

- **draft** (`PUT /api/v1/theming/draft`, `draft.ts`) — satu working copy mutable
  per tenant. Guard `theming.config.update`.
- **validate** (`POST /api/v1/theming/validate`, `validate.ts`) — dry-run
  read-only, mengembalikan token CSS yang AKAN diproduksi. Guard
  `theming.config.read` (bukan mutasi).
- **preview** (`POST /api/v1/theming/preview`, `preview.ts` → halaman
  `src/pages/theming/preview/[token].astro` + `preview-tokens/[token].css.ts`) —
  sesi terautorisasi berumur pendek & **non-indexable**. Token disimpan sebagai
  **hash SHA-256** (`domain/preview-token.ts`), `X-Robots-Tag: noindex`,
  `private, no-store`, namespace URL berbeda dari stylesheet publik (tidak bisa
  meracuni cache publik/CDN). Guard `theming.preview.create`.
- **publish** (`POST /api/v1/theming/publish`, `publish.ts`) — INSERT versi baru
  **immutable** lalu jadikan tampilan live. Guard `theming.version.publish`.
- **rollback** (`POST /api/v1/theming/rollback`, `rollback.ts`) — pindahkan
  active pointer ke versi published lebih awal. Guard `theming.version.restore`.
- **retire** (`POST /api/v1/theming/retire`, `retire.ts`) — kosongkan active
  pointer; situs fallback ke theme default. Guard `theming.version.archive`.
- **index** (`GET /api/v1/theming`, `index.ts`) — baca state, theme tersedia,
  draft, dan histori versi. Guard `theming.config.read`.

## Immutability published version — TIGA lapis

`awcms_theming_config_versions` memegang satu `draft` mutable per tenant PLUS
versi `published` bernomor (monotonic per tenant). Published **tidak pernah**
bisa dimutasi, ditegakkan di **tiga lapis**: (1) engine aplikasi hanya
INSERT-only, tak pernah UPDATE baris published lama; (2) trigger
`BEFORE UPDATE OR DELETE` di sql/033 RAISES pada percobaan mutasi/hapus baris
`status = 'published'`; (3) active pointer (theme + versi mana yang live) hidup
di `awcms_theming_tenant_state`, jadi rollback/retire **memindahkan pointer**,
tak pernah menyentuh baris versi. "Sebuah perubahan = sebuah versi baru".

## Preview retention — read-filter, bukan purge job

`awcms_theming_preview_sessions` TIDAK punya background purge (engine generik
`data_lifecycle` tidak ada di base ini; GRANT worker awcms-micro sengaja
di-drop — tak ada `awcms_worker`). Sesi tetap aman karena **setiap read
memfilter `expires_at >= now()`** (`application/theme-preview-directory.ts`) —
sesi kedaluwarsa jadi inert. Jangan asumsikan ada job pembersih.

## Guard, idempotency, audit

- **ABAC** — setiap route memakai `authorizeInTransaction` di dalam `withTenant`
  dengan `{ moduleKey: "theming", activityCode, action }`. Konstanta di
  `domain/theme-permissions.ts` (`THEMING_CONFIG_ACTIVITY_CODE = "config"`,
  `THEMING_VERSION_ACTIVITY_CODE = "version"`, `THEMING_PREVIEW_ACTIVITY_CODE =
"preview"`) — reuse konstanta, jangan re-type literal (mirror persis seed
  sql/034). Default-deny; akses ditolak → `403`, tidak pernah data kosong diam.
- **Idempotency** — SEMUA mutasi high-risk (publish/rollback/retire) WAJIB
  `Idempotency-Key` (`findIdempotencyRecord`/`saveIdempotencyRecord`; key ulang
  dengan payload beda → `409`). Lihat `awcms-idempotency`.
- **AccessAction** — `archive` DITAMBAHKAN ke union `AccessAction` dan ke
  `HIGH_RISK_ACTIONS` (`identity-access/domain/access-control.ts`; retire = high
  risk karena mengubah tampilan publik). `publish`/`restore` sudah high-risk
  sebelumnya. `config.update`/`config.read`/`preview.create` bukan anggota
  `HIGH_RISK_ACTIONS`, tapi `config.update` & `preview.create` tetap diaudit.
- **Audit** — publish/rollback/retire mencatat audit event (`recordAuditEvent`,
  hook sinkron; BELUM domain event — lihat follow-up). Lihat `awcms-audit-log`.

## Permission catalog

Enam permission `theming.*` (sql/034, katalog GLOBAL `awcms_permissions` tanpa
tenant_id/RLS, unik `(module_key, activity_code, action)`, seed idempotent
`ON CONFLICT DO NOTHING`): `config.read`, `config.update`, `version.publish`,
`version.restore` (rollback), `version.archive` (retire), `preview.create`.
Tenant lama TIDAK retroaktif mendapatkannya — hanya tenant yang dibuat setelah
migrasi ini jalan (di-seed owner saat setup-wizard bootstrap).

## Port adaptations vs awcms-micro (ADR-0034 Fase 3)

- **`media_library` di-drop** — belum ada di base. Resolusi URL asset
  (`src/lib/theming/theme-media.ts`) adalah no-op terdokumentasi (map kosong);
  asset dihilangkan dari render, theme degrade dengan aman. Id asset tersimpan
  tetap DATA valid.
- **Resolusi tenant publik `tenantCode`-based** (ADR-0009), bukan Host-based —
  stylesheet publik di `/theming/{tenantCode}/tokens.css`.
- **Tanpa migration/GRANT worker** — tabel mewarisi grant `awcms_app` dari
  `ALTER DEFAULT PRIVILEGES` sql/019; tak ada GRANT eksplisit.

## Belum tersedia (follow-up terdokumentasi, API-first)

Layar admin UI penuh (token editor + preview dashboard responsif) — `navigation`
sengaja tidak dideklarasikan. Domain event
(`awcms.theming.version.published/.rolled-back/.retired`) — publish/rollback/
retire masih hook sinkron teraudit, `events` tidak dideklarasikan. Rendering
media asset — menanti modul media di-port. Adopsi public-route (mewire home
route publik ke `PublicThemeLayout`) — layout + stylesheet siap, wiring
menyusul. Verifikasi status ini di `module.ts`/README sebelum mengklaim ada.

## Skill terkait

`awcms-new-endpoint`, `awcms-new-migration` (RLS FORCE + trigger immutability),
`awcms-abac-guard` (permission `theming.*`), `awcms-idempotency` (publish/
rollback/retire), `awcms-audit-log`, `awcms-module-management` (registry base +
komposisi build-time, ADR-0034), `awcms-new-module` (pola menambah modul domain
LANGSUNG ke `src/modules/`).
