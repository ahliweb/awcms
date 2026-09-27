---
"awcms": patch
---

fix(control-center): vendor the OMES contracts and health-check directories into the production runtime image

`Dockerfile.production`'s `runtime` stage copied only `node_modules`, `dist`, and
`package.json`, but `src/modules/omes-control/domain/contracts/loader.ts` reads the
vendored OMES contract snapshot (`PIN.json`, schemas, state tables, fixtures) from
disk at request time via `path.resolve(process.cwd(), VENDORED_CONTRACTS_DIR)` —
never bundled into `dist/`. Every production container built from this Dockerfile
therefore ENOENT'd on that read: `/admin/omes/arsitektur` rendered but its data never
loaded, and every worker route that validates against a vendored schema
(enroll/poll/result/heartbeat/ai-privacy-posture/hermes-orchestration-*) would have
rejected every real request — unnoticed only because no worker was enrolled yet on
`omes-cms.ahlikoding.com`.

The `runtime` stage now also copies `src/modules/omes-control/contracts` (the fix),
plus `sql`, `openapi`, and `asyncapi` — the same class of defect in
`src/modules/module-management/application/health-registry.ts`, whose
`migrations_applied`, `openapi_documented`, and `asyncapi_documented` module health
signals (`/api/v1/modules/[moduleKey]/health`) read those directories the same way.
Those reads are try/caught rather than throwing, so the symptom there is every
module's health check silently reporting `fail` in production rather than an ENOENT.

Adds `tests/dockerfile-runtime-disk-reads.test.ts`, which asserts every directory the
runtime code reads from disk is copied into the `runtime` stage — deriving the
contracts path from the loader's own exported `VENDORED_CONTRACTS_DIR` constant so a
path change there can't silently desync the Dockerfile again.

Refs ahliweb/omes#246.
