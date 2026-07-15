# Scripts AWCMS

Skrip tooling/ops repo, dijalankan lewat Bun (`bun scripts/<x>.ts` atau target
`bun run <name>` di `package.json`). Basis dasar ini diadaptasi dari repo acuan
[awcms-mini](https://github.com/ahliweb/awcms-mini) dan dipangkas ke apa yang
**benar-benar bisa berjalan** di atas fondasi Sprint 1–2 saat ini — skrip
worker per-modul menyusul begitu modul ERP-nya ada.

## Aktif (fondasi)

| Target                    | Skrip                       | Fungsi                                                                               | Di `check`?                                                  |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `db:migrate`              | `db-migrate.ts`             | Runner migration SQL (checksum + advisory lock)                                      | —                                                            |
| `check:docs`              | `check-docs.mjs`            | Mermaid, tautan internal, penamaan (sisa `awcms_mini_`), nama service docker compose | ✅                                                           |
| `api:spec:check`          | `api-spec-check.ts`         | Validasi OpenAPI/AsyncAPI + route parity `src/pages/api/v1`                          | ✅                                                           |
| `modules:dag:check`       | `validate-module-graph.ts`  | Validasi seluruh registry modul membentuk DAG (no cycle/self/dup/missing dependency) | ✅                                                           |
| `logging:lint:check`      | `logging-lint-check.ts`     | Gate: tak ada error/console.error mentah tanpa redaksi di `src/**`, `scripts/**`     | ✅                                                           |
| `config:validate`         | `validate-env.ts`           | Validasi kontrak env (`process.env` atau `--file <path>`) sebelum boot/deploy        | — (butuh env)                                                |
| `db:pool:health`          | `db-pool-health.ts`         | Probe `GET /api/v1/database/pool/health` (pool/work-class/circuit-breaker)           | — (butuh server)                                             |
| `changesets:policy:check` | `changeset-policy-check.ts` | Wajibkan changeset baru untuk PR yang mengubah file non-docs/non-agent-tooling       | — (PR-diff-shaped, lihat `.github/workflows/changesets.yml`) |

`bun run check` = `lint → check:docs → api:spec:check → modules:dag:check → logging:lint:check → typecheck → test → build`.

`config:validate` tidak masuk `check` karena membutuhkan environment nyata;
jalankan manual sebelum deploy, mis. `bun run config:validate` (membaca
`process.env`) atau `bun scripts/validate-env.ts --file .env.example`.

`changesets:policy:check` tidak masuk `check` karena berbentuk PR-diff
(membandingkan `origin/main...HEAD`) — dijalankan sebagai workflow CI
terpisah (`.github/workflows/changesets.yml`), bukan bagian dari check yang
aman dijalankan di satu checkout lokal mana pun.

## Ditunda (butuh infrastruktur yang belum ada)

Skrip acuan berikut belum diport karena bergantung pada arsitektur/modul yang
belum dibangun di repo ini. Diadaptasi begitu prasyaratnya ada:

| Target acuan                                                                                                                                                                                                                                                                            | Prasyarat yang belum ada                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `openapi:bundle`, `api:docs:generate`, `api:docs:check`                                                                                                                                                                                                                                 | Pemecahan OpenAPI jadi fragment per-modul (`openapi/modules/*.yaml`) — kini 1 file   |
| `repo:inventory:generate` / `:check`                                                                                                                                                                                                                                                    | Bergantung pada `openapi:bundle` + `module-composition` (Module Management)          |
| `config:docs:check`                                                                                                                                                                                                                                                                     | Rekonsiliasi 3-arah `.env.example` ↔ doc 18 (butuh doc 18 disamakan ke env repo ini) |
| `modules:sync`, `modules:compose:check`, `extension:check`, `modules:composition:inventory:*`                                                                                                                                                                                           | Modul Module Management + `application-registry` (aplikasi turunan)                  |
| `db:work-class:generate` / `:check`                                                                                                                                                                                                                                                     | Tabel/registry work-class                                                            |
| `database:capacity:check`                                                                                                                                                                                                                                                               | Validasi kapasitas lintas-instance (preflight)                                       |
| `logs:audit:purge`                                                                                                                                                                                                                                                                      | Modul `data-lifecycle` (retensi) — modul `logging` sudah ada, worker menyusul        |
| `domain-events:dispatch`, `sync:objects:dispatch`                                                                                                                                                                                                                                       | Modul domain-event-runtime + outbox                                                  |
| `i18n:extract` / `:pot:check` / `:parity:check`                                                                                                                                                                                                                                         | Setup i18n (`.po`/`.pot`) + UI                                                       |
| `security:readiness`, `production:preflight`, `resilience:dr-drill`, `performance:*`                                                                                                                                                                                                    | Mengagregasi gate/modul di atas + server berjalan                                    |
| Worker per-modul (`email:*`, `blog:*`, `news-media:*`, `social-publishing:*`, `analytics:*`, `reporting:*`, `workflow:*`, `integration-hub:*`, `data-exchange:*`, `reference-data:*`, `organization-structure:*`, `form-drafts:*`, `identity-access:business-scope:*`/`sod-registry:*`) | Modul ERP/CMS terkait                                                                |

Lihat peta sprint di
[`docs/awcms/11_implementation_blueprint.md`](../docs/awcms/11_implementation_blueprint.md)
dan skill terkait di [`.claude/skills/`](../.claude/skills/README.md)
(`awcms-new-migration`, `awcms-new-endpoint`, `awcms-module-management`, dst.).
