🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](family-compatibility.md)

<!-- i18n-source-hash: sha256:000e88eaf084449605ba96a4c8ab4456596caaf7a75f36376f50eabb240bcca4 -->

# Manifes kontrak keluarga AWCMS

> **Status:** kontrak kerja operasional (Issue #183, epic #177, [ADR-0032](../adr/0032-family-compatibility-manifest-and-ci-conformance.md), di-anchor ulang oleh [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md)).
>
> **Judul dokumen ini dahulu berbunyi "terhadap standar AWCMS-Mini".** Poros itu dicabut ADR-0055: tidak ada standar keluarga eksternal, `awcms` mendefinisikan kontraknya sendiri, dan `awcms-mini`/`awcms-micro` adalah **arsip**. Dokumen [`alur-pengembangan-mini-first.md`](alur-pengembangan-mini-first.md) (uji di mini dulu, lalu port) dipertahankan sebagai catatan sejarah dan **DICABUT PERMANEN** sebagai alur kerja. [ADR-0015](../adr/0015-derived-application-compatibility-manifest.md) (manifest ke arah aplikasi turunan) juga sudah tidak berlaku sebagai jalur.

AWCMS **dahulu** dibangun ulang di atas standar modular-monolith [AWCMS-Mini](https://github.com/ahliweb/awcms-mini) ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — provenance yang benar selamanya. Sejak [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md), dokumen ini menjelaskan bagaimana repo ini menyatakan **kontrak yang ia MILIKI** secara machine-readable dan ditegakkan CI — kontrak yang [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro) ikat, dan yang menjadi tempat setiap **selisih sengaja dengan repo itu** dicatat beserta pemilik dan tanggal tinjaunya.

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
| Astro            | `^7.2.9`  | `^7.2.9`          | `package.json` `dependencies.astro`                            |
| `@astrojs/node`  | `^11.1.4` | `^11.1.4`         | `package.json` `dependencies`                                  |
| TypeScript       | `^7.0.2`  | `^7.0.2`          | `package.json` `devDependencies`                               |
| PostgreSQL       | `18.4`    | `18.4`            | `.github/workflows/ci.yml` `services.postgres`                 |

Minimum-supported **dijalankan nyata**, bukan sekadar dideklarasikan: job `minimum-supported` men-setup Bun `1.3.0` (== floor `engines.bun`) lalu menjalankan `bun install --frozen-lockfile` + `typecheck` + `build` (Astro SSR) + `family:conformance:check`. Gate meng-assert himpunan versi Bun di CI = TEPAT {current, minimum} DAN `ciMinimum` == floor `engines` — jadi menghapus job minimum atau menggeser floor memerahkan gate. Astro/@astrojs/node/TypeScript "minimum" == range caret current-nya, jadi tak butuh cell terpisah; PostgreSQL hanya 18.4 (tanpa floor terpisah). Runtime Astro SSR di atas Bun (adapter `@astrojs/node`) dieksekusi nyata oleh `bun run build` (di `check` DAN cell minimum) dan job `e2e-smoke` yang men-start server (`bun ./dist/standalone-entry.mjs`) → login → SSR render; keberadaan `e2e-smoke` di-assert `tests/family-conformance-ci-parity.test.ts` (tak ada test SSR standalone — build+start+probe duplikat hanya menjalankan ulang e2e-smoke).

## 5. Registry intentional divergence

Selisih sengaja dari kontrak yang repo ini ikat — hari ini berarti kontrak [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro), dan hanya itu — didaftar eksplisit di `intentionalDivergences`. **Bukan** backlog port yang belum selesai; tiap entri wajib `reason`, `owner`, `reviewDate` (gate gagal saat kedaluwarsa), dan `adr` (berkasnya harus ada).

**Daftar di bawah adalah isi manifes HARI INI.** Sembilan entri era-mini yang dulu menempati tabel ini dikosongkan ADR-0055 dan dipindah utuh ke [§Divergensi historis](#divergensi-historis-diarsipkan-oleh-adr-0055) — jangan mencampur keduanya.

| id                                  | Ringkasan                                                                                                                                                                                                          | ADR      | reviewDate |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------- |
| `hsts-include-subdomains`           | Repo ini kirim HSTS ber-`includeSubDomains`; `awcms-astro` tanpa itu — keduanya benar untuk permukaannya                                                                                                           | ADR-0068 | 2027-02-04 |
| `astro-files-not-type-checked`      | `astro check` tidak bisa jalan di sini (TypeScript 7 vs API programatik 6.x)                                                                                                                                       | ADR-0068 | 2027-02-04 |
| `owasp-edition-pin-owned-here`      | Pin edisi OWASP/ASVS dimiliki repo ini; `awcms-astro` mengikutinya                                                                                                                                                 | ADR-0068 | 2027-02-04 |
| `coop-corp-cross-origin-isolation`  | Repo ini kirim COOP/CORP; `awcms-astro` tidak — CORP DITOLAK eksplisit di sana                                                                                                                                     | ADR-0069 | 2027-02-04 |
| `admin-user-surface-in-awcms-astro` | ADR-0051 **sebagaimana ditulis** berbunyi seluruh layar admin di sini; ADR-0070 mempersempitnya ke layar SISTEM — permukaan admin **USER** (tak pernah `owner`) boleh di `awcms-astro` bila situsnya menyatakannya | ADR-0070 | 2027-02-04 |

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

## Divergensi historis (diarsipkan oleh ADR-0055)

> **Status: catatan sejarah, bukan kewajiban berjalan.** Sembilan entri di bawah
> dulu hidup di `intentionalDivergences` pada manifest dan digerbangi CI: tiap
> entri punya `owner` dan `reviewDate` yang, bila lewat, memerahkan build sampai
> perbedaannya dibenarkan ulang.
>
> [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md)
> mencabut kewajiban review itu. Pengembangan kini hanya berlangsung di
> `ahliweb/awcms` dan `ahliweb/awcms-astro`; `awcms-mini` adalah arsip, jadi
> "apakah perbedaan terhadap awcms-mini masih dibenarkan?" adalah pertanyaan
> yang jawabannya tidak akan pernah berubah.
>
> Entrinya dipertahankan **verbatim** karena alasannya masih menjelaskan kenapa
> kode ini berbentuk seperti sekarang — dan tautan ADR-nya tetap diverifikasi
> keberadaannya oleh `check:docs`, yang gagal pada tautan ke berkas yang tidak
> ada.

```yaml
intentionalDivergences:
  # The `no-content-website-modules` divergence (blog_content/news_portal/etc.
  # are not part of the base) was REVOKED by ADR-0034 (§Konsekuensi): website
  # modules may now live directly in `src/modules/` here ("template
  # dipakai-langsung"), and the first one — `theming` — is implemented in the
  # base (ADR-0034 Fase 3). Website/content modules that are not yet ported are
  # simply not-yet-ported (drift is tracked per-module), not a standing divergence.
  - id: platform-scoped-permissions
    summary: >-
      awcms_permissions carries a `scope` column (`tenant`/`platform`), and the
      authorization chokepoint refuses a platform-scoped permission unless the
      acting tenant is the platform tenant. awcms-mini has no such split — every
      permission there is tenant-scoped.
    reason: >-
      This base owns GLOBAL reference data (the Indonesia region dataset:
      no tenant_id, no RLS, served identically to every tenant), so it has
      actions with no honest per-tenant subject. Recorded as it lands, per
      ADR-0047 §4, because it is a foundation authorization primitive prototyped
      here while awcms-mini is frozen.
    owner: "@ahliweb"
    reviewDate: "2027-08-02"
    adr: 0053-platform-scoped-permissions.md
    since: "ADR-0053"
  - id: openapi-one-file-per-module
    summary: >-
      OpenAPI fragments are one-file-per-MODULE, not one-file-per-tag as in
      awcms-mini.
    reason: >-
      ModuleDescriptor.api.openApiPath is a single path per module, so a module
      owns exactly one fragment (a fragment may carry more than one tag).
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0026-modular-openapi-ownership-and-composition.md
    since: "#182"
  - id: oidc-ssrf-blocks-private-ip
    summary: >-
      The OIDC/SSO SSRF guard BLOCKS private/loopback/link-local/metadata IPs on
      issuer URLs — reversing awcms-mini's deliberate no-IP-block posture.
    reason: >-
      awcms is API-first with no assumed VPN-to-on-prem-IdP topology; SSRF
      defense is a headline requirement. A documented escape hatch exists only
      for loopback fake-IdP test hosts and is rejected in production.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0028-oidc-sso-tenant-aware-account-linking-break-glass.md
    since: "#185"
  - id: mfa-session-assurance-built-new
    summary: >-
      Session assurance (aal1/aal2), step-up, and enrollment-state-driven MFA
      enforcement are built new; awcms-mini has none, and the "full-online
      security" epic that gates MFA in mini is not ported.
    reason: >-
      MFA enforcement is driven by DB factor/enrollment state (fail-closed),
      not by a deployment-wide online-security flag, so disabling a flag can
      never bypass an enrolled second factor.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0027-mfa-totp-session-assurance-step-up.md
    since: "#184"
  - id: business-scope-base-resolver-noop
    summary: >-
      The base business-scope hierarchy resolver is a fail-closed NO-OP;
      awcms-mini's default adapter reads its own offices table.
    reason: >-
      The base ships no organization hierarchy of its own. A real resolver is
      supplied by a module that provides the business_scope_hierarchy
      capability port; with no provider, scope-gated high-risk actions deny by
      default.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0030-business-scope-hierarchy-generic-authorization-layer.md
    since: "#180"
  - id: sod-rules-illustrative-in-fixture
    summary: >-
      The base ships ZERO segregation-of-duties rules; awcms-mini hardcodes
      example rules into identity_access.
    reason: >-
      A base must not invent business rules. Illustrative SoD rules live only in
      the in-repo test-support fixture (tests/fixtures/example-domain-modules/);
      real rules are declared by domain modules added to the template.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0031-segregation-of-duties-conflict-enforcement.md
    since: "#181"
  - id: turnstile-keeps-deployment-profile-gate
    summary: >-
      Cloudflare Turnstile RETAINS the deployment-profile gate (LAN/offline
      exempt) — the one full-online gate MFA/OIDC deliberately dropped.
    reason: >-
      Bot protection is only meaningful for full-online profiles; forcing it on
      the offline/LAN resilience mode of the online-first hybrid would break that
      degraded-connectivity path.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0029-deployment-profile-aware-turnstile-bot-protection.md
    since: "#186"
  - id: semver-continues-legacy-major-line
    summary: >-
      The awcms release version continues the pre-rebuild legacy major line
      (5.x) rather than resetting to 1.0.0.
    reason: >-
      Continuity for existing deployments on the legacy line; the family
      contract version is tracked independently of the package release version.
    owner: "@ahliweb"
    reviewDate: "2027-07-19"
    adr: 0024-semver-numbering-continues-legacy-major-line.md
    since: "#177"
  # ADR-0047 §4 — the FIRST foundation feature prototyped directly here during
  # the awcms-mini/awcms-micro freeze, recorded as it lands rather than
  # discovered when the freeze lifts.
  - id: machine-credentials-read-only-bearer
    summary: >-
      awcms accepts a SECOND kind of bearer — a read-only, scope-narrowed
      machine credential bound to a service account — which no other family
      template has; and it exposes GET /api/v1/auth/session for cross-origin
      session introspection.
    reason: >-
      awcms-astro could not fetch its own content: the only bearer this family
      accepts is a hashed SESSION token, which no build can hold (sessions
      expire, are revoked by password reset, and are rotated by MFA step-up).
      Built here because the freeze leaves foundation work nowhere else to land.
      The divergence is contained: a credential AUTHENTICATES only, its
      permissions are the intersection with its service account's, and every
      request it makes is refused unless the action is read-only.
    owner: "@ahliweb"
    reviewDate: "2027-08-01"
    adr: 0049-machine-credentials-and-session-introspection.md
    since: "ADR-0049"
```
