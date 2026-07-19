🇮🇩 Bahasa Indonesia (sumber) · 🇬🇧 [English (default)](family-compatibility.md)

# Kompatibilitas keluarga AWCMS terhadap standar AWCMS-Mini

> **Status:** kontrak kerja operasional (Issue #183, epic #177, [ADR-0032](../adr/0032-family-compatibility-manifest-and-ci-conformance.md)). Melengkapi [`alur-pengembangan-mini-first.md`](alur-pengembangan-mini-first.md) (uji di mini dulu, lalu port) dan [ADR-0015](../adr/0015-derived-application-compatibility-manifest.md) (manifest kompatibilitas ke arah aplikasi turunan).

AWCMS adalah **fondasi rebuild** di atas standar modular-monolith [AWCMS-Mini](https://github.com/ahliweb/awcms-mini) ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)). Dokumen ini menjelaskan bagaimana base ini menyatakan **conformance** terhadap standar keluarga itu secara machine-readable dan ditegakkan CI — supaya perbedaan terhadap standar bersifat eksplisit, dapat diuji, dan tidak bergantung perbandingan copy file secara manual.

## 1. Artefak

| Artefak                                                                                  | Peran                                                                                           |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml)               | Manifest deklaratif tunggal (root repo) — versi kontrak, versi stack, allow-list divergence.    |
| [`awcms-family-compatibility.schema.json`](../../awcms-family-compatibility.schema.json) | JSON Schema draft-07 untuk tooling eksternal/manusia.                                           |
| `src/modules/_shared/family-contract.ts`                                                 | Sumber kebenaran: `FAMILY_CONTRACT_VERSION`, tipe manifest, validator otoritatif (zero-import). |
| `scripts/family-conformance-check.ts`                                                    | Gate `bun run family:conformance:check` + generator evidence report.                            |
| `tests/family-conformance*.test.ts`                                                      | Contract test SEMANTIK yang memberi gigi tiap versi (mutation-provable).                        |

## 2. Family contract version — skema versioning ketujuh

`FAMILY_CONTRACT_VERSION` (`family-contract.ts`) adalah skema versioning **ketujuh** di atas enam yang sudah ada ([ADR-0008](../adr/0008-independent-contract-and-module-versioning.md)/[ADR-0015](../adr/0015-derived-application-compatibility-manifest.md): package release, kontrak REST, kontrak event, module descriptor, per-capability, extension-manifest). Ia adalah versi yang setiap fixture/snapshot conformance dipin.

- **MAJOR** — kontrak semantik sebuah kontrol reusable dilemahkan/dihapus sehingga aplikasi turunan yang ditulis terhadap family contract sebelumnya rusak (perubahan semantik default-deny/RLS/redaction/audit/idempotency/envelope/migration-immutability). Setiap perubahan seperti ini **breaking**.
- **MINOR** — kontrak baru ditambah, atau kontrak lama diperketat secara backward-compatible.
- **PATCH** — klarifikasi dokumentasi saja.

## 3. Versi kontrak yang dipin

Setiap versi yang dideklarasikan manifest dicek gate terhadap sumber nyata (mismatch → CI merah). Kontrak "family-owned" tidak punya konstanta berdiri sendiri; nomornya dipin ke `FAMILY_OWNED_CONTRACT_VERSIONS` dan diberi gigi oleh contract test semantik.

| Kontrak                       | Nilai   | Dipin ke                                                                |
| ----------------------------- | ------- | ----------------------------------------------------------------------- |
| module descriptor contract    | `1.3.0` | `MODULE_CONTRACT_VERSION` (`module-contract.ts`)                        |
| capability contract           | `1.0.0` | `CAPABILITY_CONTRACT_VERSIONS` (per capability key)                     |
| REST API contract             | `0.1.0` | `info.version` `openapi/awcms-public-api.openapi.yaml`                  |
| event API contract            | `0.1.0` | `info.version` `asyncapi/awcms-domain-events.asyncapi.yaml`             |
| response/error envelope       | `1.0.0` | family-owned; test envelope `_shared/api-response.ts`                   |
| tenant-context/RLS            | `1.0.0` | family-owned; test fail-closed di bawah `FORCE RLS`                     |
| audit/redaction               | `1.0.0` | family-owned; test redaction `_shared/redaction.ts`                     |
| idempotency                   | `1.0.0` | family-owned; test `_shared/idempotency.ts`                             |
| migration checksum (`sha256`) | `1.0.0` | family-owned; test `validateAppliedChecksums` (`scripts/db-migrate.ts`) |

## 4. Versi stack tervalidasi + compatibility matrix

Nilai `declared` di manifest WAJIB sama dengan nilai nyata di sumber yang ditunjuk (assertion compatibility matrix). Intent matrix: menguji versi **current** dan **minimum-supported**.

| Komponen         | Current   | Minimum-supported | Sumber                                                         |
| ---------------- | --------- | ----------------- | -------------------------------------------------------------- |
| Bun (pin)        | `1.3.14`  | `>=1.3.0`         | `package.json` `packageManager` / `engines.bun`                |
| Bun (CI current) | `1.3.14`  | —                 | `.github/workflows/ci.yml` job `quality` `setup-bun`           |
| Bun (CI minimum) | —         | `1.3.0`           | `.github/workflows/ci.yml` job `minimum-supported` `setup-bun` |
| Astro            | `^7.0.7`  | `^7.0.7`          | `package.json` `dependencies.astro`                            |
| `@astrojs/node`  | `^11.0.2` | `^11.0.2`         | `package.json` `dependencies`                                  |
| TypeScript       | `^7.0.2`  | `^7.0.2`          | `package.json` `devDependencies`                               |
| PostgreSQL       | `18.4`    | `18.4`            | `.github/workflows/ci.yml` `services.postgres`                 |

Minimum-supported **dijalankan nyata**, bukan sekadar dideklarasikan: job `minimum-supported` men-setup Bun `1.3.0` (== floor `engines.bun`) lalu menjalankan `bun install --frozen-lockfile` + `typecheck` + `build` (Astro SSR) + `family:conformance:check`. Gate meng-assert himpunan versi Bun di CI = TEPAT {current, minimum} DAN `ciMinimum` == floor `engines` — jadi menghapus job minimum atau menggeser floor memerahkan gate. Astro/@astrojs/node/TypeScript "minimum" == range caret current-nya, jadi tak butuh cell terpisah; PostgreSQL hanya 18.4 (tanpa floor terpisah). Runtime Astro SSR di atas Bun (adapter `@astrojs/node`) dieksekusi nyata oleh `bun run build` (di `check` DAN cell minimum) dan job `e2e-smoke` yang men-start server (`bun ./dist/server/entry.mjs`) → login → SSR render; keberadaan `e2e-smoke` di-assert `tests/family-conformance-ci-parity.test.ts` (tak ada test SSR standalone — build+start+probe duplikat hanya menjalankan ulang e2e-smoke).

## 5. Registry intentional divergence

Perbedaan sengaja dari standar mini didaftar eksplisit di `intentionalDivergences`. **Bukan** backlog port yang belum selesai — tiap entri wajib `reason`, `owner`, `reviewDate` (gate gagal saat kedaluwarsa), dan `adr` (file harus ada).

| id                                        | Ringkasan                                              | ADR      |
| ----------------------------------------- | ------------------------------------------------------ | -------- |
| `no-content-website-modules`              | Modul CMS/konten mini tidak diport ke base             | ADR-0022 |
| `module-type-without-derived`             | `ModuleType` tanpa "derived" (pakai "domain")          | ADR-0025 |
| `openapi-one-file-per-module`             | OpenAPI satu-file-per-modul, bukan per-tag             | ADR-0026 |
| `oidc-ssrf-blocks-private-ip`             | SSRF guard blokir IP privat (membalik keputusan mini)  | ADR-0028 |
| `mfa-session-assurance-built-new`         | Session assurance/step-up dibangun baru                | ADR-0027 |
| `business-scope-base-resolver-noop`       | Resolver hierarki base = NO-OP fail-closed             | ADR-0030 |
| `sod-rules-illustrative-in-fixture`       | Base ship 0 SoD rule; rule ilustratif hanya di fixture | ADR-0031 |
| `turnstile-keeps-deployment-profile-gate` | Turnstile pertahankan gate profil (LAN/offline exempt) | ADR-0029 |
| `semver-continues-legacy-major-line`      | Versi rilis lanjut lini major legacy (5.x)             | ADR-0024 |

## 6. Gate, contract test, dan evidence report

`bun run family:conformance:check` memvalidasi manifest terhadap schema DAN cross-reference tiap versi terhadap sumber nyata, memeriksa allow-list divergence, lalu meng-emit **evidence report** pass/fail per contract. Report dibangun hanya dari string versi + nama kontrak — **tidak pernah** memuat secret/DSN/env (di-assert `assertEvidenceReportSecretFree`). Tulis report ke file: `bun run family:conformance:check --report <path>` atau env `FAMILY_CONFORMANCE_REPORT_PATH`.

Contract test bersifat **semantik** dan **mutation-provable** — pelemahan kontrol membuat test/gate RED:

- **tenant-context fail-closed** — tanpa GUC tenant → nol baris; policy fail-open (`USING (true)`) → bocor semua baris (`tests/family-conformance-db.test.ts`, butuh Postgres).
- **response envelope** — bentuk `{success,data,meta}` / `{success:false,error:{code,message}}`; envelope drift terdeteksi.
- **redaction** — key/value sensitif → `[REDACTED]`; redactor dilemahkan → kebocoran terdeteksi.
- **idempotency** — hash stabil-urutan + peka-payload; hash collapse → konflik tak terdeteksi.
- **migration immutability** — edit migration terapan → `validateAppliedChecksums` throw (murni, tanpa DB).
- **module composition** — duplicate module key → komposisi invalid.

Wiring gate (pelajaran [ADR-0015](../adr/0015-derived-application-compatibility-manifest.md) §6): `package.json` `check` + langkah eksplisit `ci.yml` `quality` + `release.yml` warisi via `bun run check`. Test parity (`tests/family-conformance-ci-parity.test.ts`) menjaga langkah tak hilang diam-diam.

## 7. Checklist upgrade / mengubah kontrak

Saat sebuah perubahan menyentuh kontrak keluarga:

1. **Identifikasi kelas perubahan.** Menaikkan versi kontrak sumber (mis. `MODULE_CONTRACT_VERSION`), menambah/mengubah stack, atau mengubah semantik kontrol reusable?
2. **Perbarui sumber lebih dulu**, lalu **perbarui `awcms-family-compatibility.yaml`** agar cocok (versi kontrak + stack).
3. **Pelemahan kontrak = breaking.** Bila perubahan melemahkan default-deny/RLS/redaction/audit/idempotency/envelope/migration-immutability, naikkan **MAJOR** `FAMILY_CONTRACT_VERSION` dan perbarui contract test/snapshot yang dipin di PR yang sama.
4. **Divergence baru** butuh entri allow-list lengkap (reason/owner/reviewDate/adr) + ADR-nya.
5. **Jalankan** `bun run family:conformance:check` sampai hijau, lalu `bun run check` PENUH, lalu suite DB (`DATABASE_URL` di-set) termasuk `tests/family-conformance-db.test.ts`.
6. **Buktikan gate menggigit** — mutasi satu kontrak (mis. ubah versi di manifest) harus membuat gate RED sebelum di-revert.
7. **Changeset** + perbarui §Changelog di bawah bila `FAMILY_CONTRACT_VERSION` naik.

## 8. Runbook migrasi/upgrade stack

Menaikkan versi stack (Bun/Astro/@astrojs/node/TypeScript/PostgreSQL):

1. Bump di sumber otoritatif (`package.json` dan/atau `.github/workflows/ci.yml`).
2. Sinkronkan `stack.*.declared` di manifest.
3. `bun install` (Bun-only — tanpa npm/npx/pnpm/yarn), `bun run build`, `bun run check`.
4. Untuk PostgreSQL: jalankan `bun run db:migrate` + suite DB terhadap image baru; verifikasi `FORCE RLS` invariant (`tests/family-conformance-db.test.ts`).
5. Untuk minimum-supported: jalankan ulang suite pada versi minimum yang dinyatakan sebelum menaikkan floor `engines`.
6. `bun run family:conformance:check` hijau (assertion compatibility matrix declared == actual).

## 9. Kebijakan versioning + changelog family contract

`FAMILY_CONTRACT_VERSION` dinaikkan hanya oleh perubahan yang mengubah kontrak keluarga (bagian 2/7); versi rilis package berevolusi terpisah ([ADR-0024](../adr/0024-semver-numbering-continues-legacy-major-line.md)).

### Changelog

- **1.0.0** (Issue #183, 2026-07-19) — deklarasi pertama. Manifest + schema + gate `family:conformance:check` + contract test semantik + registry 9 intentional divergence.

## 10. Rujukan

- [`alur-pengembangan-mini-first.md`](alur-pengembangan-mini-first.md) — kontrak "uji di mini dulu, lalu port".
- [`../adr/0032-family-compatibility-manifest-and-ci-conformance.md`](../adr/0032-family-compatibility-manifest-and-ci-conformance.md) — keputusan penuh.
- [`../../AGENTS.md`](../../AGENTS.md) — alur kerja wajib setiap task.
