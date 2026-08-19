🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:0671baf3c64756c213f5360ed58cd062294ead0c14459900c4906c85dafa1805 -->

# Scripts AWCMS

Skrip tooling/ops repo, dijalankan lewat Bun (`bun scripts/<x>.ts` atau target
`bun run <name>` di `package.json`).

## Inventaris

Tabel di bawah **dihasilkan dari `package.json`** oleh
`bun run scripts:inventory:generate`, dan `bun run scripts:inventory:check`
(di rantai `check`) menolak kalau ia basi.

Alasannya bukan kerapian. Versi tulis-tangan sebelumnya mendaftar 12 dari 52
skrip sebagai aktif, dan tabel pendampingnya menyebut lima belas tooling sebagai
"belum diport" padahal semuanya sudah mendarat — sebagian bahkan sudah ada di
rantai `bun run check` (`api:docs:check`, `modules:compose:check`,
`db:work-class:check`, dan seluruh worker per-modul). Klaim **negatif** adalah
jenis yang berbahaya: "X belum ada" makin salah seiring waktu dan tak pernah
gagal sendiri, tak seperti klaim positif yang langsung pecah begitu kodenya
berubah. Pembacanya akan menyimpulkan `db:work-class:check` masih perlu dibangun,
lalu membangun duplikatnya.

<!-- BEGIN GENERATED: script-inventory -->

<!-- Dihasilkan `bun run scripts:inventory:generate`. JANGAN diedit tangan. -->

107 target menjalankan berkas di `scripts/`; 48 di antaranya
ada di rantai `bun run check` (kolom **Gate**), sisanya dijalankan manual,
terjadwal, atau oleh workflow CI tertentu.

| Target                                   | Skrip                                          | Gate |
| ---------------------------------------- | ---------------------------------------------- | ---- |
| `access:chokepoint:check`                | `access-chokepoint-check.ts`                   | ✅   |
| `access:decision-log:coverage:check`     | `access-decision-log-coverage-check.ts`        | ✅   |
| `access:entitlement:deny-only:check`     | `access-entitlement-deny-only-check.ts`        | ✅   |
| `access:grant-readers:check`             | `access-grant-readers-check.ts`                | ✅   |
| `access:permissions:enforcement:check`   | `permission-enforcement-check.ts`              | ✅   |
| `admin:screen-coverage:check`            | `admin-screen-coverage-check.ts`               | ✅   |
| `analytics:purge`                        | `visitor-analytics-purge.ts`                   | —    |
| `analytics:rollup`                       | `visitor-analytics-rollup.ts`                  | —    |
| `api:consumer-contract:check`            | `api-consumer-contract.ts`                     | ✅   |
| `api:consumer-contract:generate`         | `api-consumer-contract.ts`                     | —    |
| `api:docs:check`                         | `api-docs-check.ts`                            | ✅   |
| `api:docs:generate`                      | `api-docs-generate.ts`                         | —    |
| `api:spec:check`                         | `api-spec-check.ts`                            | ✅   |
| `api:tenant-route:check`                 | `tenant-route-factory-check.ts`                | ✅   |
| `blog:ads:drop-readiness`                | `blog-ads-drop-readiness.ts`                   | —    |
| `blog:ads:ingest`                        | `blog-ads-ingest.ts`                           | —    |
| `blog:publish:scheduled`                 | `blog-scheduled-publish.ts`                    | —    |
| `build:asset-budget:check`               | `client-asset-budget.ts`                       | —    |
| `build:inline-scripts:check`             | `build-inline-script-check.ts`                 | —    |
| `changesets:policy:check`                | `changeset-policy-check.ts`                    | —    |
| `check:astro-scripts:check`              | `astro-script-typecheck.ts`                    | ✅   |
| `check:docs`                             | `check-docs.mjs`                               | ✅   |
| `check:docs:translation`                 | `check-docs-translation.mjs`                   | ✅   |
| `comments:resources:check`               | `comments-resources-check.ts`                  | ✅   |
| `comments:retention`                     | `comments-retention.ts`                        | —    |
| `config:env:coverage:check`              | `env-contract-coverage-check.ts`               | ✅   |
| `config:validate`                        | `validate-env.ts`                              | —    |
| `data-lifecycle:archive-purge`           | `data-lifecycle-archive-purge.ts`              | —    |
| `data-lifecycle:registry:check`          | `data-lifecycle-registry-check.ts`             | ✅   |
| `data-lifecycle:table-coverage:check`    | `data-lifecycle-table-coverage-check.ts`       | ✅   |
| `data-lifecycle:worker-grants:check`     | `data-lifecycle-worker-grants-check.ts`        | ✅   |
| `db:fk-index:check`                      | `db-fk-index-check.ts`                         | ✅   |
| `db:migrate`                             | `db-migrate.ts`                                | —    |
| `db:pool:health`                         | `db-pool-health.ts`                            | —    |
| `db:tenant-context:check`                | `tenant-context-usage-check.ts`                | ✅   |
| `db:work-class:check`                    | `work-class-registry-check.ts`                 | ✅   |
| `db:work-class:generate`                 | `work-class-registry-generate.ts`              | —    |
| `deps:audit:check`                       | `dependency-audit-check.ts`                    | ✅   |
| `docs:i18n:stamp`                        | `docs-i18n-stamp.mjs`                          | —    |
| `docs:i18n:stamp:check`                  | `docs-i18n-stamp.mjs`                          | ✅   |
| `domain-events:deliveries:purge`         | `domain-event-deliveries-purge.ts`             | —    |
| `domain-events:dispatch`                 | `domain-events-dispatch.ts`                    | —    |
| `edge-cache:purge`                       | `edge-cache-purge.ts`                          | —    |
| `edge-cache:surfaces:check`              | `edge-cache-surfaces-check.ts`                 | ✅   |
| `email:dispatch`                         | `email-dispatch.ts`                            | —    |
| `email:provider:health`                  | `email-provider-health.ts`                     | —    |
| `email:queue:purge`                      | `email-queue-purge.ts`                         | —    |
| `email:templates:seed-defaults`          | `email-templates-seed-defaults.ts`             | —    |
| `entitlements:backfill`                  | `identity-access-entitlement-backfill.ts`      | —    |
| `family:conformance:check`               | `family-conformance-check.ts`                  | ✅   |
| `form-drafts:purge`                      | `form-draft-purge.ts`                          | —    |
| `graph:artifacts:check`                  | `graph-artifacts-check.ts`                     | ✅   |
| `i18n:catalog:check`                     | `i18n-catalog-check.ts`                        | ✅   |
| `i18n:compile`                           | `i18n-compile.ts`                              | —    |
| `i18n:screens:check`                     | `i18n-screen-coverage-check.ts`                | ✅   |
| `identity-access:business-scope:expiry`  | `identity-access-business-scope-expiry.ts`     | —    |
| `identity-access:permissions:backfill`   | `identity-access-owner-permission-backfill.ts` | —    |
| `identity-access:sod-registry:check`     | `identity-access-sod-registry-check.ts`        | ✅   |
| `identity-access:subscription-lifecycle` | `identity-access-subscription-lifecycle.ts`    | —    |
| `identity:mfa-collisions:preflight`      | `identity-mfa-collisions-preflight.ts`         | —    |
| `identity:principal-access:check`        | `identity-principal-access-check.ts`           | ✅   |
| `identity:principals:preflight`          | `identity-access-principal-preflight.ts`       | —    |
| `idn-regions:activate`                   | `idn-regions-activate.ts`                      | —    |
| `idn-regions:import`                     | `idn-regions-import.ts`                        | —    |
| `idn-regions:rollback`                   | `idn-regions-rollback.ts`                      | —    |
| `jobs:crontab:check`                     | `jobs-crontab.ts`                              | ✅   |
| `jobs:crontab:generate`                  | `jobs-crontab.ts`                              | —    |
| `logging:lint:check`                     | `logging-lint-check.ts`                        | ✅   |
| `logs:audit:purge`                       | `audit-log-purge.ts`                           | —    |
| `memory:docs:check`                      | `sync-agent-memory.ts`                         | —    |
| `memory:docs:restore`                    | `sync-agent-memory.ts`                         | —    |
| `memory:docs:sync`                       | `sync-agent-memory.ts`                         | —    |
| `modules:compose:check`                  | `validate-module-composition.ts`               | ✅   |
| `modules:composition:inventory:check`    | `module-composition-inventory-check.ts`        | ✅   |
| `modules:composition:inventory:generate` | `module-composition-inventory-generate.ts`     | —    |
| `modules:dag:check`                      | `validate-module-graph.ts`                     | ✅   |
| `modules:jobs:check`                     | `module-job-registry-check.ts`                 | ✅   |
| `modules:routes:check`                   | `validate-module-routes.ts`                    | ✅   |
| `modules:table-writes:check`             | `table-write-ownership-check.ts`               | ✅   |
| `news-media:reconcile`                   | `news-media-r2-reconcile.ts`                   | —    |
| `openapi:bundle`                         | `openapi-bundle.ts`                            | —    |
| `project-state:inventory:check`          | `project-state-inventory.ts`                   | ✅   |
| `project-state:inventory:generate`       | `project-state-inventory.ts`                   | —    |
| `push:dispatch`                          | `push-dispatch.ts`                             | —    |
| `push:queue:purge`                       | `push-queue-purge.ts`                          | —    |
| `push:vapid:generate`                    | `push-vapid-generate.ts`                       | —    |
| `redis:health`                           | `redis-health.ts`                              | —    |
| `release:verify`                         | `release-verify.ts`                            | —    |
| `repo:inventory:check`                   | `repo-inventory.ts`                            | ✅   |
| `repo:inventory:generate`                | `repo-inventory.ts`                            | —    |
| `reporting:exports:dispatch`             | `reporting-exports-dispatch.ts`                | —    |
| `reporting:projections:refresh`          | `reporting-projections-refresh.ts`             | —    |
| `reporting:projections:registry:check`   | `reporting-projection-registry-check.ts`       | ✅   |
| `scripts:inventory:check`                | `scripts-inventory.ts`                         | ✅   |
| `scripts:inventory:generate`             | `scripts-inventory.ts`                         | —    |
| `security:readiness`                     | `security-readiness.ts`                        | —    |
| `site-origin:check`                      | `site-origin-check.ts`                         | ✅   |
| `site-search:reconcile`                  | `site-search-reconcile.ts`                     | —    |
| `site-search:sources:check`              | `site-search-sources-check.ts`                 | ✅   |
| `skills:check`                           | `skills-check.ts`                              | ✅   |
| `subject-data:coverage:check`            | `subject-data-coverage-check.ts`               | ✅   |
| `subject-data:registry:check`            | `subject-data-registry-check.ts`               | ✅   |
| `sync:objects:dispatch`                  | `object-sync-dispatch.ts`                      | —    |
| `sync:objects:purge`                     | `object-queue-purge.ts`                        | —    |
| `tenant-domain:dns:sync`                 | `tenant-domain-dns-sync.ts`                    | —    |
| `version:check`                          | `version-check.ts`                             | ✅   |
| `workflow:escalations:dispatch`          | `workflow-escalations-dispatch.ts`             | —    |

<!-- END GENERATED: script-inventory -->

## Yang tidak masuk `check`, dan kenapa

Rantai `check` harus aman dijalankan di checkout lokal mana pun tanpa database,
tanpa server, dan tanpa konteks PR. Yang di luar rantai ada karena melanggar
salah satu syarat itu:

| Target                                                                  | Kenapa di luar `check`                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `security:readiness`                                                    | Butuh database termigrasi — memeriksa RLS `FORCE`, role app non-superuser, grant worker/setup                  |
| `config:validate`                                                       | Butuh environment nyata (`process.env`, atau `--file <path>`). Jalankan sebelum deploy                         |
| `db:migrate`, `db:pool:health`, `redis:health`, `email:provider:health` | Butuh database/Redis/provider yang berjalan                                                                    |
| Seluruh worker terjadwal                                                | Butuh database, dan dijalankan cron/systemd — lihat `ModuleDescriptor.jobs` + `GET /api/v1/modules/{key}/jobs` |
| `changesets:policy:check`                                               | Berbentuk PR-diff (`origin/main...HEAD`); dijalankan `.github/workflows/changesets.yml`                        |
| `release:verify`                                                        | Hanya bermakna pada commit ber-tag `vX.Y.Z`; dijalankan job `validate` di `.github/workflows/release.yml`      |
| `*:generate`                                                            | Pasangan tulis dari sebuah `*:check`. Yang menggerbangi CI adalah `:check`-nya                                 |

Urutan otoritatif rantai `check` ada di `package.json` langsung — sengaja tidak
diduplikasi di sini supaya tidak drift.

## Jadwal job

Tidak didaftar di sini. Sumber kebenarannya `ModuleDescriptor.jobs` (per modul,
membawa `purpose`, `recommendedSchedule`, `environmentNotes`,
`safeInOfflineLan`), disajikan lewat `GET /api/v1/modules/{moduleKey}/jobs` dan
digerbangi `bun run modules:jobs:check`. Lihat
[`docs/awcms/deployment-profiles.md`](../docs/awcms/deployment-profiles.md)
§Job registry.

## Ditunda (belum ada di repo ini)

Skrip acuan berikut belum diport karena bergantung pada arsitektur yang belum
dibangun. `scripts:inventory:check` **menolak** kalau salah satu dari nama di
bawah ternyata sudah terdaftar di `package.json` — itu tepat cara tabel
sebelumnya membusuk.

Nama-nama ini boleh disebut sebagai **target** di `docs/awcms/` dan
`.claude/skills/` (dokumen yang diadaptasi dari repo acuan), tetapi tidak boleh
muncul sebagai `bun run <target>` di berkas **current-state**: `README*.md`,
`AGENTS.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`,
berkas ini, README modul `src/**`, dan **komentar kode** di `src/`/`scripts/`.
`check:docs` menggerbanginya. Cakupan sumber itu ditambahkan setelah ditemukan
enam komentar di `src/modules/module-management/` yang menyuruh pembacanya
menjalankan target `modules:sync` — perintah yang tak pernah ada di repo ini
(mekanisme sesungguhnya `POST /api/v1/modules/sync`) — sementara `bun run check`
tetap hijau karena gate lamanya hanya membaca lima berkas markdown akar.

| Target acuan                                    | Prasyarat yang belum ada                                           |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `config:docs:check`                             | Rekonsiliasi tiga-arah `.env.example` ↔ doc 18 ↔ `validate-env.ts` |
| `i18n:extract` / `:pot:check` / `:parity:check` | Setup i18n (`.po`/`.pot`) + UI                                     |
| `database:capacity:check`                       | Validasi kapasitas lintas-instance (preflight)                     |
| `production:preflight`, `resilience:dr-drill`   | Mengagregasi gate di atas + server berjalan                        |
| `performance:*`                                 | Harness beban + environment berukuran produksi                     |

Lihat peta sprint di
[`docs/awcms/11_implementation_blueprint.md`](../docs/awcms/11_implementation_blueprint.md)
dan skill terkait di [`.claude/skills/`](../.claude/skills/README.md).
