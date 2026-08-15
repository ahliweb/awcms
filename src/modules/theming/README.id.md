🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:a8f108d98767c15d699cf9c10bef705a1a77042208d0aef8f62c956316b09f79 -->

# theming — presentasi yang bisa dipilih tenant (ADR-0034 Fase 3)

Modul website PERTAMA yang diimplementasikan **langsung di basis awcms** — bukti
bagi keputusan ADR-0034 bahwa modul konten/website boleh tinggal di `src/modules/`
di sini ("template dipakai-langsung"), yang men-supersede pembatasan lama
`no-content-website-modules`. Diadaptasi dari `theming` milik awcms-micro (Issue
#269 / awcms-micro ADR-0029).

Membuat tenant bisa **memilih** tema tepercaya dan **mengonfigurasinya** lewat DATA
(design token, slot layout, media, urutan seksi) — **tanpa kode unggahan, tanpa
template sembarangan, tanpa CSS/HTML/JS mentah**.

## Dua hal yang dipisahkan ketat oleh modul ini

| Tepercaya, build-time (kode)                                                                                                                                | Ditulis tenant (data)                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sebuah **tema** = `ThemeDescriptor` yang disusun `theme-registry.ts` dari tema basis in-repo yang sudah ditinjau. Sumbernya ditinjau, di-bundle saat build. | Sebuah **`ThemeConfig`** = override token, pemilihan slot, id media, urutan seksi, penempatan nav. Disimpan di DB (`awcms_theming_config_versions` + `_tenant_state`, sql/033, RLS FORCE), tervalidasi skema dan berbatas. |
| `PublicThemeLayout.astro` — SATU-SATUNYA yang merender.                                                                                                     | —                                                                                                                                                                                                                          |

Tidak ada template dapat-dieksekusi yang tersimpan di database, di mana pun. awcms
tidak punya seam tema repo turunan (jalur aplikasi turunan DIHAPUS pada ADR-0034
Fase 2); tema baru tinggal langsung di registry basis ini.

## Tulang punggung keamanan — `domain/css-value-validation.ts`

Setiap NILAI design-token divalidasi dengan **PENOLAKAN, BUKAN sanitasi**:

- `assertSafeCssPrimitive` — terbatas charset, terbatas panjang, bebas karakter
  kontrol, dan menolak `url(` / `expression` / `@import` / `javascript:` / `/*` /
  `;{}<>` / backslash / kurung tak seimbang. Menolak (bukan membuang) menyingkirkan
  kelas `js/incomplete-multi-character-sanitization` sepenuhnya.
- `validateColorValue` / `validateDimensionValue` / `validateNumberValue` — tata
  bahasa ketat dan linear (anti-ReDoS).
- keluarga font dipilih dari **allow-list** per tema; stack CSS yang dipancarkan
  dimiliki descriptor, jadi tidak pernah ada nilai font yang ditulis tenant.
- `serializeThemeTokensCss` aman secara konstruksi (memvalidasi ulang setiap nilai)
  dan memancarkan blok `:root { --awcms-theme-* }` yang disajikan sebagai
  **stylesheet eksternal same-origin** (`/theming/{tenantCode}/tokens.css`) —
  sehingga CSP `style-src
'self'` aplikasi tidak pernah dilemahkan (tanpa `<style>` inline per-request).

## Daur hidup — draft → validate → preview → publish → rollback/retire

- **draft** — satu salinan kerja yang bisa diubah per tenant
  (`PUT /api/v1/theming/draft`).
- **validate** — uji coba baca-saja (`POST /api/v1/theming/validate`), mengembalikan
  CSS token yang akan dihasilkan.
- **preview** — sesi berumur pendek, **tidak-bisa-diindeks**, dan terotorisasi
  (`POST /api/v1/theming/preview` → `/theming/preview/{token}`): token disimpan
  sebagai hash, `X-Robots-Tag: noindex`, `private, no-store`, namespace URL berbeda
  dari stylesheet publik (tak bisa meracuni cache publik/CDN). Setiap pembacaan
  memfilter `expires_at >= now()`, jadi sesi basi bersifat inert (tidak ada job
  purge latar — engine data_lifecycle generik bukan bagian dari basis ini).
- **publish** — INSERT versi **immutable** baru dan menjadikannya tampilan hidup
  (`POST /api/v1/theming/publish`). Versi terbit tidak pernah bisa diubah (engine
  INSERT-only + trigger `BEFORE UPDATE/DELETE` di sql/033).
- **rollback / retire** — hanya memindahkan penunjuk aktif (`POST .../rollback`,
  `POST .../retire`); riwayat tetap utuh.

Semua mutasi berisiko tinggi mewajibkan `Idempotency-Key`, digerbangi ABAC, dan
diaudit.

## Berkas

- `domain/` — `css-value-validation.ts` (tulang punggung), `theme-descriptor.ts`
  (kontrak + gerbang CSP/a11y `assertValidThemeDescriptor`), `theme-config.ts`
  (validate + serialize), `theme-lifecycle.ts`, `preview-token.ts`,
  `theme-permissions.ts`.
- `themes/default-theme.ts` — tema basis `aria`. `theme-registry.ts` — composition
  root basis yang sudah ditinjau.
- `application/` — `theme-config-directory.ts`, `theme-preview-directory.ts`,
  `theme-service.ts` (orkestrasi + audit yang diinjeksikan),
  `theme-render-resolver.ts`, `theme-preview-render.ts`.
- composition root di `src/lib/theming/` (`theme-media.ts` — no-op yang
  terdokumentasi sampai sebuah modul media di-port, `theme-public-css.ts` —
  stylesheet publik yang di-resolve lewat `tenantCode`, `theme-preview.ts`).
- rute: `src/pages/api/v1/theming/*` (API admin),
  `src/pages/theming/[tenantCode]/tokens.css.ts` (publik),
  `src/pages/theming/preview/[token].astro` + `preview-tokens/[token].css.ts`.
- `src/layouts/PublicThemeLayout.astro` — layout render tepercaya.

## Adaptasi port vs awcms-micro (ADR-0034 Fase 3)

- **Tanpa seam tema repo turunan** — jalur aplikasi turunan DIHAPUS (ADR-0034
  Fase 2); tema tinggal langsung di `theme-registry.ts`.
- **`media_library` dilepas** — bukan bagian basis ini. Resolusi URL aset
  (`src/lib/theming/theme-media.ts`) adalah no-op terdokumentasi yang mengembalikan
  map kosong; aset dihilangkan dari render dan tema merosot dengan aman. Id aset
  yang tersimpan tetap DATA yang sah.
- **Descriptor purge `data_lifecycle` dilepas** — tidak ada engine/peran worker
  purge di basis ini; retensi preview menumpang filter baca `expires_at >= now()`.
- **Resolusi tenant publik berbasis `tenantCode`** (ADR-0009), bukan berbasis Host —
  stylesheet publik tinggal di `/theming/{tenantCode}/tokens.css`.

## Layar admin

`/admin/theming` (`src/pages/admin/theming.astro`) menggerakkan seluruh daur hidup:
pemilih tema, editor draft yang di-generate dari descriptor TERPILIH (satu kontrol
per token, slot, dan slot aset yang dideklarasikan — plus urutan seksi dan
penempatan nav), tombol Validate yang menampilkan `errors[]` tingkat-field dari
endpoint, tombol Preview yang memunculkan tautan preview sekali-pakai, serta
riwayat versi terbit dengan publish / rollback / retire. Pembacaan memanggil fungsi
application yang sama dengan yang dipakai `GET /api/v1/theming` di dalam satu
transaksi `withTenantOrThrow`; setiap penulisan menuju endpoint `/api/v1/theming/*`
yang berpenjaga, dengan `Idempotency-Key` baru per klik draft-save/publish/rollback/retire
dan tanpa kunci pada validate yang baca-saja. Entri `navigation` modul ini
(urutan 34, digerbangi `theming.config.read`) mendarat bersamanya. Dipatok oleh
`tests/admin-theming-page-contract.test.ts`.

## Tindak lanjut terdokumentasi (ditunda, API-first)

- **Dasbor preview responsif** (render breakpoint berdampingan) — konsol menautkan
  keluar ke sesi preview sebagai gantinya.
- **Domain event** (`awcms.theming.version.published` / `.rolled-back` /
  `.retired`) — publish/rollback/retire hari ini berupa hook sinkron yang diaudit.
- **Render aset media** — mendarat saat sebuah modul media di-port ke basis ini.
- **Adopsi rute publik** — layout + stylesheet token sudah siap; menyambungkan rute
  beranda publik ke `PublicThemeLayout` adalah tindak lanjut.
