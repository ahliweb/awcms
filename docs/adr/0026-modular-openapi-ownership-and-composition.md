# ADR-0026 — Kontrak OpenAPI modular: kepemilikan per modul, bundle deterministik, dan kontribusi fragment dari aplikasi turunan

- **Status:** Accepted
- **Tanggal:** 2026-07-19
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #182 (epic #177 "Kesiapan fondasi ERP turunan", Wave 1), ADR-0008 (versioning kontrak independen), ADR-0025/ADR-0014 (composition seam #178), ADR-0013 (extension boundary), ADR-0022 (modul ERP di repo ekstensi), ADR-0023 (bilingual docs), `openapi/awcms-public-api.src.yaml`, `openapi/modules/*.openapi.yaml`, `scripts/openapi-bundle.ts`, `scripts/api-spec-check.ts`, `scripts/api-docs-generate.ts`, `openapi/README.md`, `docs/awcms/api-contribution-guide.md`

## Konteks

Sampai Issue #182, kontrak REST publik awcms terpusat pada satu berkas monolitik `openapi/awcms-public-api.openapi.yaml` (~153 KB, 96 path, 118 operasi). Pola ini masih terkelola pada fondasi 10 modul, tetapi menjadi bottleneck saat aplikasi ERP turunan menambah banyak modul: tidak ada batas kepemilikan per modul, setiap perubahan menyentuh satu berkas raksasa, dan tidak ada mekanisme bagi modul turunan menyumbang kontraknya sendiri tanpa mengedit berkas base.

AWCMS-Mini sudah memvalidasi pola fragment + bundler + generator dokumentasi + consistency gate (Issue #695/#700). ADR ini mencatat keputusan **port** pola itu ke awcms, dengan perbedaan struktural yang spesifik untuk awcms, tanpa menyalin modul konten mini (blog/news/dll) yang bukan skop repo ini.

Prinsip yang tetap mengikat: perubahan API wajib OpenAPI; kontrak publik tidak berubah tanpa changeset/ADR (ADR-0008); modul domain ERP tidak dibangun di base (ADR-0022); komposisi turunan 100% compile-time tanpa mengedit registry base (ADR-0013/0025).

## Keputusan

### 1. Struktur sumber: root fragment + satu fragment per modul, bundle di-generate

- `openapi/awcms-public-api.src.yaml` — root fragment: `openapi`/`info`/`servers`/`tags`/`security`, dan `components.securitySchemes`/`parameters`/`responses`, plus schema yang dipakai 2+ modul (atau tidak dipakai path mana pun). Untuk awcms hanya dua schema di root: `ApiError` (envelope error, dirujuk `components.responses`) dan `ApiMeta` (dirujuk banyak modul).
- `openapi/modules/<module>.openapi.yaml` — satu fragment per modul base pemilik API (10 modul) plus `foundation.openapi.yaml` untuk operasi platform yang benar-benar tak dimiliki modul (`health`, `db pool health`). Tiap fragment memiliki setiap path bertag modul itu plus setiap `components.schemas` yang HANYA dirujuk operasinya.
- `openapi/awcms-public-api.openapi.yaml` — **artefak GENERATED** oleh `bun run openapi:bundle`, di path yang sama seperti sebelumnya (setiap consumer — route-parity check, health-registry, generator dokumentasi — tetap membacanya). Tidak pernah diedit tangan.

**Perbedaan struktural awcms vs mini (didokumentasikan sengaja):** mini memakai konvensi "satu berkas = satu tag" (mis. `management-reporting.openapi.yaml` dan `reporting-projections.openapi.yaml` terpisah). awcms memakai **"satu berkas = satu modul"** karena `ModuleDescriptor.api.openApiPath` menunjuk tepat satu fragment. Konsekuensinya modul `reporting` memiliki KEDUA tag (`Management Reporting` + `Reporting Projections`) di satu `reporting.openapi.yaml`. `foundation.openapi.yaml` tidak dimiliki descriptor modul mana pun (tidak ada "modul foundation") — ia fragment berdiri sendiri yang tetap ikut di-bundle karena bundler mem-glob seluruh `openapi/modules/`.

### 2. Ekuivalensi kontrak dengan monolit pra-migrasi (tanpa perubahan perilaku API)

Migrasi memecah monolit TANPA mengubah URL, security, request/response, atau schema apa pun. Dibuktikan `tests/openapi-bundle.test.ts` yang membandingkan bundle hasil generate terhadap snapshot beku `tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml` secara semantik (deep-equal order-independent atas `paths`/`components.schemas`/`securitySchemes`/`parameters`/`responses`/`security`/`info`/`servers`).

Satu-satunya penyimpangan yang diizinkan dan didokumentasikan: deklarasi tag `Domain Event Runtime` yang sebelumnya DIPAKAI operasi `/api/v1/domain-events/*` tetapi tak pernah dideklarasikan di daftar `tags` top-level. Ditambahkan sebagai perbaikan dokumentasi murni (tidak ada perubahan path/schema/security) — sama pola dengan perbaikan mini pada Issue #695. Test memverifikasi tag bundle adalah SUPERSET tag monolit dengan satu-satunya tambahan itu.

### 3. Determinisme bundle

Bundler memuat fragment dalam urutan nama berkas ter-sort eksplisit (bukan urutan `readdir` yang tak dijamin stabil), me-re-sort seluruh kunci `paths` dan `components.schemas` alfabetis, memakai urutan kunci top-level tetap, dan memformat dengan Prettier project (tanpa randomness). `bun run openapi:bundle` idempoten: input sama → output byte-identik (dibuktikan test "bundling twice produces byte-identical output").

### 4. Kontribusi fragment dari aplikasi turunan lewat composition seam #178

`ModuleDescriptor.api.openApiPath` (field yang SUDAH ADA sejak fondasi — tidak perlu ditambah, jadi `MODULE_CONTRACT_VERSION` tidak dinaikkan) kini menunjuk fragment sumber tiap modul, bukan bundle monolit. Sebuah modul turunan menyumbang kontraknya dengan (a) mendeklarasikan `openApiPath` ke fragmentnya sendiri dan (b) build turunan mem-feed setiap `openApiPath` modul teregistrasi ke seam `buildBundledDocument(rootDir, { extraFragmentFiles })`. Fragment turunan tergabung ke bundle **tanpa mengedit fragment base mana pun**.

Guardrail override: fragment (base maupun turunan) yang mendeklarasikan ulang path atau schema yang sudah ada melempar `BundleConflictError` — modul turunan TIDAK PERNAH bisa diam-diam menimpa path/operation/schema base. Dibuktikan `tests/openapi-derived-fragment.test.ts` (merge sukses + dua kasus override ditolak) memakai fixture `tests/fixtures/derived-application-example/`.

### 5. Gate baru dan generator dokumentasi

- `bun run openapi:bundle` (`scripts/openapi-bundle.ts`) — merge fragment → bundle (mutasi; bukan bagian `check`).
- `bun run api:spec:check` (diperluas) — selain jaminan lama (route↔OpenAPI parity dua arah, `operationId` unik, security eksplisit + allow-list `security: []`, path-parameter), kini juga: **bundle freshness** (bundle commit == hasil generate; menangkap fragment diedit tanpa re-bundle DAN bundle diedit tangan), **standard error schema** (setiap response 4xx/5xx/`default` resolve ke envelope `ApiError`), **allow-list dipakai** (tiap entri `ALLOWED_PUBLIC_OPERATIONS` benar-benar ada). Konflik merge fragment turunan tersurface sebagai kegagalan spec-check.
- `bun run api:docs:generate` (`scripts/api-docs-generate.ts`) + `bun run api:docs:check` — generator dokumentasi Markdown deterministik `docs/awcms/api-reference.md` dari bundle + AsyncAPI (contoh nilai selalu sintetik, tanpa secret/hostname nyata), plus gate freshness read-only.

Ditambahkan ke `bun run check` (`api:docs:check`) DAN sebagai step eksplisit di `.github/workflows/ci.yml` (parity — invariant repo). `release.yml` menjalankan `bun run check` verbatim sehingga otomatis tercakup.

### 6. Versioning kontrak

`info.version` kontrak tetap SemVer independen dari versi package (ADR-0008), dinaikkan hanya saat BENTUK kontrak berubah. Migrasi ini tidak menaikkannya (kontrak ekuivalen; tag-declaration murni dokumentasi).

## Konsekuensi

- **Positif:** Kepemilikan API per modul menjadi eksplisit; perubahan menyentuh fragment kecil, bukan monolit. Modul turunan menyumbang kontrak tanpa mengedit base. Bundle deterministik + gate freshness menutup drift route↔fragment↔bundle↔docs. Envelope error terjaga seragam lintas fragment.
- **Netral:** Tidak menambah migration SQL, endpoint, atau event; tidak menaikkan `MODULE_CONTRACT_VERSION` (field `api.openApiPath` sudah ada). Bundle tetap di path lama sehingga consumer tak berubah.
- **Negatif/trade-off:** Menambah langkah `openapi:bundle` pada alur ubah-API (edit fragment → re-bundle → commit keduanya) — ditegakkan gate freshness agar tak lupa. Penulis kontrak harus tahu schema shared masuk root, schema milik-satu-modul masuk fragment.
- **Rekonsiliasi:** `docs/awcms/api-reference.md` sebelumnya adalah artefak mini yang ter-copy (docs-ahead-of-code: merujuk skrip/fragment yang belum ada, konten blog/news mini, `info.version 1.0.0`). Kini di-generate ulang dari kontrak awcms nyata.

## Alternatif yang dipertimbangkan

- **Mempertahankan monolit** — ditolak: bottleneck kepemilikan saat modul turunan bertambah (konteks epic #177).
- **Satu berkas = satu tag (konvensi mini)** — ditolak untuk awcms: `openApiPath` per modul tunggal lebih cocok dengan "satu berkas = satu modul"; §1.
- **Mengizinkan fragment turunan menimpa path base (override tersanksi)** — ditolak di scope ini: default-deny lebih aman; override eksplisit bisa ditambah kemudian bila ada kebutuhan nyata, lewat mekanisme tersendiri.
- **Menambah `additionalProperties: false`/`required` ke schema response saat migrasi** (agar drift lebih tajam terdeteksi) — ditolak: itu mengubah bentuk kontrak dan melanggar jaminan ekuivalensi migrasi; dilakukan terpisah dengan changeset/ADR sendiri bila diinginkan.
