# Panduan Kontribusi API untuk Modul Domain/Website (Issue #182, ADR-0026)

> **Reframing [ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md).** Jalur "aplikasi turunan di repo terpisah" (ADR-0022) DICABUT — keluarga AWCMS kini template **dipakai-langsung**. Baca dokumen ini dengan pemetaan: "repo/modul turunan" = modul domain/website yang ditambahkan **langsung ke `src/modules/`** template ini. Pipeline OpenAPI modular (fragment per-modul + bundler + composition seam) tetap nyata dan berlaku; hanya framing repo terpisah yang usang.

Dokumen ini menjelaskan cara sebuah **modul domain/website** (mis. ERP di
atas base AWCMS) menyumbang kontrak REST untuk domainnya
sendiri, **tanpa mengedit fragment OpenAPI root/base** maupun berkas bundle.

Baca dulu: [`openapi/README.md`](../../openapi/README.md) (struktur fragment +
bundler) dan [ADR-0026](../adr/0026-modular-openapi-ownership-and-composition.md)
(keputusan kepemilikan/komposisi).

## Prinsip

- **Kepemilikan per modul.** Satu modul = satu fragment
  `openapi/modules/<module>.openapi.yaml`. Setiap modul memiliki fragmentnya
  sendiri; ia tidak menambahkan path/operation/schema ke fragment modul lain.
- **Bundle di-generate, deterministik.** Kontrak publik akhir selalu hasil
  `bun run openapi:bundle` — tidak pernah diedit tangan. Input sama → output
  byte-identik.
- **Default-deny override.** Fragment modul TIDAK bisa menimpa path,
  operation, atau schema root/base/shared. Percobaan menimpa melempar
  `BundleConflictError` dan menggagalkan gate.
- **Envelope seragam.** Semua response error (4xx/5xx) wajib resolve ke schema
  `ApiError` shared (root fragment). Response sukses memakai pola
  `success: true` + `data`. Gate `standard error schema` menegakkan ini.
- **Kontrak = wajib.** Setiap route `/api/v1/**` wajib punya operasi OpenAPI dan
  sebaliknya (route↔contract parity). `operationId` wajib unik global.

## Langkah

1. **Buat fragment modul** (termasuk modul domain/website) di `src/modules/`
   template ini ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md):
   template dipakai-langsung, tidak ada repo turunan terpisah), mis.
   `openapi/modules/<module>.openapi.yaml`. Isi `paths` (path modul
   Anda, semua di bawah `basePath` modul, mis. `/api/v1/<domain>/...`) dan —
   bila perlu — `components.schemas` yang HANYA dipakai modul Anda. Rujuk
   komponen shared base lewat `$ref` seperti biasa
   (`#/components/responses/BadRequest`, `#/components/schemas/ApiMeta`,
   `#/components/parameters/CorrelationId`). Fragment TIDAK berdiri sendiri
   sebagai OpenAPI valid — itu wajar; `$ref` shared resolve setelah merge.

2. **Deklarasikan `api.openApiPath`** di `module.ts` modul Anda,
   menunjuk fragment tersebut:

   ```ts
   api: {
     openApiPath: "openapi/modules/<module>.openapi.yaml",
     basePath: "/api/v1/<domain>"
   }
   ```

   Field ini juga yang dibaca readiness-check `module_management`
   (`openapi_documented`) untuk memastikan modul mendokumentasikan API-nya.

3. **Gabungkan lewat composition seam.** Build mem-feed setiap
   `openApiPath` modul teregistrasi ke seam `extraFragmentFiles`:

   ```ts
   import { buildBundledDocument } from "./scripts/openapi-bundle";
   const bundle = await buildBundledDocument(process.cwd(), {
     extraFragmentFiles: registeredModules
       .map((m) => m.api?.openApiPath)
       .filter((p): p is string => Boolean(p))
   });
   ```

   Alternatif paling sederhana: taruh fragmentnya di
   `openapi/modules/` sehingga ikut ter-glob oleh bundler default. Yang
   penting: **fragment root/base yang sudah ada tidak diedit langsung.**

4. **Regenerate + validasi:**

   ```bash
   bun run openapi:bundle
   bun run api:docs:generate
   bun run api:spec:check
   bun run api:docs:check
   ```

   Commit fragment Anda, bundle yang di-generate, dan referensi Markdown dalam
   satu PR.

## Kesalahan umum

- **Menimpa path/schema base** → `BundleConflictError`. Pilih path/nama schema
  yang unik untuk domain Anda.
- **Response error inline (bukan `ApiError`)** → gate `standard error schema`
  merah. Pakai `$ref: "#/components/responses/*"` atau `#/components/schemas/ApiError`.
- **Route tanpa operasi (atau sebaliknya)** → gate route parity merah.
- **`operationId` bertabrakan dengan operasi base** → gunakan prefiks domain
  (mis. `listSalesInvoices`, bukan `list`).
- **Mengedit `openapi/awcms-public-api.openapi.yaml` langsung** → gate bundle
  freshness merah (bundle di-generate, bukan sumber).

## Versioning

`info.version` kontrak adalah SemVer independen dari versi package (ADR-0008):
PATCH = dokumentasi, MINOR = tambahan backward-compatible (endpoint/field
opsional baru), MAJOR = breaking (hapus/rename field/endpoint, ubah bentuk
response). Perubahan bentuk kontrak base wajib changeset + (bila keputusan
arsitektural) ADR.
