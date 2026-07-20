# Rencana Pilot Turunan #187 — Purchase Requisition (`awcms-erp-pilot`), Increment 1

> **Status: rencana (belum dieksekusi).** Dokumen ini adalah rencana implementasi
> Increment-1 untuk Issue #187 (pilot aplikasi turunan). Tidak ada kode yang
> ditulis oleh dokumen ini. Melengkapi (bukan menggantikan)
> [`derived-app-pilot-plan.md`](derived-app-pilot-plan.md) — yang memilih
> kandidat pilot — dengan rencana teknis konkret untuk domain
> purchase-requisition yang dipilih #187. Untuk **runbook eksekusi
> langkah-demi-langkah** (signature seam base terverifikasi + koreksi + DDL/
> deskriptor konkret), lihat
> [`derived-app-pilot-purchase-requisition-execution.md`](derived-app-pilot-purchase-requisition-execution.md).

## Konteks

Epic #177 (fondasi ERP turunan awcms) selesai kecuali **#187**: membangun satu
aplikasi turunan pilot nyata untuk MEMBUKTIKAN extension model AWCMS end-to-end
(composition seam #178, migration ownership, API/event contribution #182, RLS,
authorization #179/#180/#181, workflow approval, audit, deployment, upgrade
path) — bukan sekadar desain dokumentasi. #187 sengaja memilih domain **netral &
minimal: purchase requisition (permintaan pengadaan internal)** — draft → submit
→ approve/reject via workflow AWCMS → status/audit timeline → reporting
projection sederhana → domain events. TANPA purchase order, receiving, vendor
invoice, accounting posting, tax, inventory, payment.

Aturan keras #187: **pilot TIDAK menambah logika ERP ke `ahliweb/awcms`**. Domain
hidup di repo turunan terpisah; repo base hanya dapat PR fondasi generik terpisah
bila terbukti perlu. #187 di repo base adalah TRACKER acceptance/evidence.

## Keputusan (dikonfirmasi)

1. **Repo**: buat `ahliweb/awcms-erp-pilot` di GitHub (outward-facing).
2. **Konsumsi base**: **VENDOR** — salin source tree base awcms (v5.1.1) ke repo
   turunan, isi `src/modules/application-registry.ts` dengan registry domain, pin
   versi base yang di-vendor di family-compatibility manifest (#183). Upgrade =
   re-vendor versi base berikutnya. Base files TAK diedit (kecuali
   `application-registry.ts` = satu-satunya seam).
3. **Scope Increment 1**: vertical slice inti **+ approval workflow penuh**:
   scaffold repo + modul `purchase-requisition` (header + lines, draft CRUD,
   submit) + migrasi bernomor **900+** di repo turunan (RLS FORCE, soft-delete draft, immutability
   pasca-submit) + RBAC/ABAC domain + REST + OpenAPI fragment + integrasi
   workflow-approval (submit→task→approve/reject, self-approval + SoD +
   business-scope guard) + domain events created/submitted/approved/rejected +
   audit + idempotency + test berlapis + 3 gate komposisi lulus + CI. Admin UI
   (SSR), reporting projector, Docker/Coolify/backup, upgrade-path doc =
   increment BERIKUTNYA (bukan increment-1).

## Pola derived-app (dari docs base — otoritatif)

- `application-registry.ts`: derived repo REPLACE `undefined` dengan
  `ApplicationModuleRegistry { id, modules, migrationNamespace }`. Satu-satunya
  file base yang diedit; `src/modules/index.ts` + tiap base `module.ts` TAK
  disentuh (guardrail ADR-0013 §5/§9).
- Migration namespace turunan: **rangeStart 900, rangeEnd 999** (base reservasi
  1–899, ADR-0014). Jadi migrasi purchase-requisition bernomor **900+** (file
  `900_*.sql` dst di direktori `sql/` **repo turunan**, bukan repo base ini).
- Modul domain: `src/modules/purchase-requisition/` struktur
  `domain/application/infrastructure/api` + `module.ts` + `README.md`.
- OpenAPI per-modul (#182): fragment sendiri
  `openapi/modules/purchase-requisition.openapi.yaml`, ditunjuk
  `ModuleDescriptor.api.openApiPath`; JANGAN edit fragment base atau bundle
  generated.
- 3 gate WAJIB lulus: `modules:compose:check`,
  `modules:composition:inventory:check`, `extension:check`.
- Reuse (bukan reimplement): `evaluateAccess`/`authorizeInTransaction` (ABAC
  default-deny), workflow-approval engine, `recordAuditEvent`, domain-event
  outbox, idempotency helper, `_shared/api-response.ts`, keyset-pagination.
- Fixture contoh nyata: `tests/fixtures/derived-application-example/`
  (example-crm; example-erp-extension belum dimaterialisasi — hanya dirujuk
  docs) — pola replikasi.

## Scaffolding modul (konkret)

**Registry** (`src/modules/application-registry.ts`, satu-satunya base file
diedit):

```ts
export const applicationModuleRegistry: ApplicationModuleRegistry = {
  id: "awcms-erp-pilot",
  modules: [purchaseRequisitionModule],
  migrationNamespace: {
    label: "awcms-erp-pilot",
    rangeStart: 900,
    rangeEnd: 999
  }
};
```

**`ModuleDescriptor` wajib (6)**: key (snake_case, tak boleh tabrak base →
`prohibited_base_override`), name, version ("0.1.0"), status ("experimental"),
description, dependencies (`["tenant_admin","identity_access"]`, plus `"workflow"`
dan `"domain_event_runtime"`). **`type` WAJIB "domain"** (bukan base/system →
`invalid_module_type`). Opsional dipakai: `api {openApiPath, basePath}`,
`permissions [{activityCode, action, description}]`,
`events {asyncApiPath, publishes}`, `sodRules`, `navigation` (path unik global),
`jobs` (command `^bun run …`).

**SoD rule** (fixture example-crm sudah punya `requisition` maker/checker — pola
langsung): `ruleKey purchase_requisition.requester_approver_separation`,
`ownerModuleKey` = key, `conflictingPermissionKeys ≥2`
(`…requisition.create` vs `…requisition.approve`),
`scopeApplicability same_scope_only`, `severity high`,
`exceptionPolicy {allowed, requiresApprovalPermission:
identity_access.business_scope_exceptions.approve, maxDurationDays}`.

**Layout**: `src/modules/purchase-requisition/{domain,application,infrastructure}/`
plus `module.ts` dan `README.md`. **Route HTTP di
`src/pages/api/v1/purchase-requisitions/*.ts`** (Astro, BUKAN di folder modul).
`defineModule()` = identity fn untuk inferensi tipe.

**Migrasi** (di `sql/` **repo turunan**): file
`900_awcms_purchase_requisition_schema.sql` dst — pola nama
`^\d{3}_awcms_[a-z0-9_]+\.sql$`, nomor ≥900. Runner `scripts/db-migrate.ts`
enumerasi semua `sql/*.sql` (nomor konvensi saja); checksum immutable. Gate
komposisi HANYA cek range `migrationNamespace` deklaratif vs 1–899 (bukan
filesystem) → WAJIB deklarasi 900–999.

**OpenAPI**: fragment sendiri `openapi/modules/purchase-requisition.openapi.yaml`
(hanya `paths` + `components.schemas`; redefine path/schema base →
`BundleConflictError`). Bundle `bun run openapi:bundle` + `api:spec:check`.

**3 gate** (bagian `bun run check`, pure no-I/O): `modules:compose:check` (rule
engine: duplicate_key/prohibited_base_override/invalid_type/capability/
namespace_overlap/nav_conflict/job), `modules:composition:inventory:check` (regen
`docs/awcms/module-composition-inventory.json` via
`modules:composition:inventory:generate` lalu commit), `extension:check` (derived
mode: id non-empty + modules ≥1 + validity).

**Template siap-pakai**: `docs/awcms/examples/minimal-domain-module.md` (layout,
migrasi+RLS, route, snippet OpenAPI/AsyncAPI, checklist) + fixture
`tests/fixtures/derived-application-example/`.

## Seam base yang di-REUSE (bukan reimplement)

Route referensi kanonik: `src/pages/api/v1/workflows/tasks/[id]/decisions.ts`
(auth + idempotency + decision + audit + event dalam satu handler).

**Rantai route mutasi high-risk**: `resolveAuthInputs` → guard
400/401/IDEMPOTENCY_REQUIRED → `readJsonBody` → validasi domain →
`withTenant(sql, tenantId, fn, {workClass:"interactive"})` →
`authorizeInTransaction(tx, tenantId, tokenHash, now, guard, {hierarchyPort?})` →
cek idempotency replay → kerja domain → `recordAuditEvent` → `appendDomainEvent`
→ `ok(data, {correlationId})` → `saveIdempotencyRecord`.

| Concern                                 | Reuse                                                                                                                                                 | File                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Auth resolve                            | `resolveAuthInputs`                                                                                                                                   | identity-access/application/access-guard.ts             |
| Guard chokepoint                        | `authorizeInTransaction` → `{allowed,context,grantedPermissionKeys}`                                                                                  | access-guard.ts                                         |
| Tenant tx (RLS+pool+breaker)            | `withTenant(...,{workClass})`                                                                                                                         | lib/database/tenant-context.ts                          |
| ABAC (default-deny, self-approval, SoD) | `evaluateAccess`/`isHighRiskAction`                                                                                                                   | identity-access/domain/access-control.ts                |
| Workflow start (on submit)              | `startWorkflowInstance(tx,{workflowKey,resourceType:"purchase_requisition",resourceId,requestedByTenantUserId,...})`                                  | workflow-approval/application/workflow-instance.ts      |
| Workflow decision                       | `recordWorkflowTaskDecision` / `fetchTaskWithInstanceForDecision` / `findEligibleAssignment`                                                          | workflow-instance-decision.ts                           |
| Audit                                   | `recordAuditEvent(tx,{...})` (auto-redaksi)                                                                                                           | logging/application/audit-log.ts                        |
| Domain event outbox                     | `appendDomainEvent(tx,tenantId,{eventType,eventVersion,aggregateType,aggregateId,producerModule,payload})` + registry                                 | domain-event-runtime/application/append-domain-event.ts |
| Idempotency                             | `computeRequestHash`/`findIdempotencyRecord`/`saveIdempotencyRecord` (tabel `awcms_idempotency_keys` bersama)                                         | \_shared/idempotency.ts                                 |
| Response                                | `ok`/`created`/`fail`                                                                                                                                 | \_shared/api-response.ts                                |
| Keyset pagination                       | `KEYSET_CURSOR_CREATED_AT_SQL`/`encode/decodeKeysetCursor` (BUKAN dari JS Date)                                                                       | \_shared/keyset-pagination.ts                           |
| Reporting projeksi                      | `ProjectionDescriptor` di module.ts (strategi **cursor_table** = projector background TANPA network I/O, `runCursorStreamPass` workClass maintenance) | reporting/domain/projection-registry.ts                 |

**Keputusan desain kunci**: approve/reject PR pakai **endpoint PR-spesifik
sendiri** (`POST /purchase-requisitions/{id}/approve|reject`, guard
`purchase_requisition.requisition.approve` via `authorizeInTransaction`) yang di
dalam satu transaksi: `recordWorkflowTaskDecision` + transisi status PR + audit +
event. Alasan: endpoint workflow generik menjaga izin _workflow_, jadi SoD rule
`requisition.create` vs `requisition.approve` TAK akan menyala di sana. Endpoint
PR-sendiri membuat SoD + self-approval (via `requestedByTenantUserId` di-lookup
sebelum guard) benar-benar menggigit.

**Port injection (di composition root = file route, ADR-0011)**:

- `BusinessScopeHierarchyPort` (#180): base default `resolved:false` →
  fail-closed deny. Approval ber-scope WAJIB inject resolver nyata di route PR,
  else selalu deny. Contoh inject:
  `identity/business-scope/assignments/index.ts`.
- `sodRules` PR mengalir OTOMATIS lewat `collectSoDRuleDescriptors(listModules())`
  → `high-risk-sod-guard.ts` (tak perlu wiring per-route).
- `WorkflowNotificationPort`: base wire NONE → node `notify` no-op (email belum
  diport) — OK untuk increment-1 (approver via inbox task, bukan email).
- Domain event: register di `DOMAIN_EVENT_TYPE_REGISTRY` + `events.publishes` di
  module.ts + channel asyncapi + parity test
  (`domain-event-registry-parity.test.ts`). Konsumen `domain_event`-strategy
  butuh edit statik consumer-registry → untuk projeksi PR pakai **cursor_table**
  biar modul self-contained.

## Deploy / compat / CI / env (reality-check penting)

**Reality-check yang mengubah rencana:**

- **Gate `extension.manifest.json` (ADR-0015) BELUM diimplementasikan** di base.
  `extension:check` HANYA validasi seam komposisi. File
  `_shared/extension-manifest-contract.ts` + `extension-compatibility.ts` TAK ADA
  (hanya `src/lib/semver/compare.ts` ada). → Pin versi base = tulis
  `extension.manifest.json` (`compatibleAwcmsRange` ke base v5.1.1) sebagai
  DOKUMEN + review manual; JANGAN andalkan gate (belum ada sampai #183 hilir).
- **`production:preflight` TAK ADA** scriptnya (docs merujuk, package.json nihil).
  Jalankan perintah underlying satu-satu.
- **`AUTH_JWT_SECRET` TIDAK dipakai** base (docs keliru). Env WAJIB hanya
  `APP_ENV`, `APP_URL`, `DATABASE_URL` (validator `scripts/validate-env.ts`).
  Base pakai session cookie + `AUTH_IP_HASH_SECRET`.
- **Artefak deploy base minim**: hanya `Dockerfile.production` + `.dockerignore` +
  `.env.example` + `deploy/pgbouncer/`. docker-compose/systemd/nginx/backup/
  create-app-role = BELUM ADA (harus ditulis pilot) → tapi ini **increment
  BERIKUTNYA**, bukan increment-1.

**Family-compatibility manifest**: `awcms-family-compatibility.yaml` +
`.schema.json` + `_shared/family-contract.ts` = manifest BASE→standard (base
declare konformansi ke mini), IKUT ter-vendor apa adanya; `family:conformance:check`
tetap jalan di CI turunan (lulus selama base tak diubah). Ini BEDA dari
`extension.manifest.json` (derived→base, belum ada gate).

**CI turunan** = `bun run check` (chain: lint → check:docs → api:spec/docs →
modules:dag → **compose → inventory → extension** → reporting/sod registry →
**family:conformance** → logging:lint → typecheck → test → build) + carry-over
job: `integration-tests` (RLS+role-sep di postgres:18.4, DUA suite terpisah tak
boleh tabrak satu `bun test`), `e2e-smoke` (Playwright), `minimum-supported` (Bun
1.3.0), `hygiene`, `codeql`. `security:readiness` = perintah go-live (butuh DB
ter-migrate), BUKAN di `bun run check`.

## Batas Increment-1 (yang DIKERJAKAN vs DITUNDA)

**Increment-1 (INI):** scaffold repo turunan (vendor base) + modul
`purchase_requisition` vertical slice (header+lines, draft CRUD, submit) +
**approval workflow penuh** (submit→instance→task→approve/reject via endpoint
PR-spesifik, self-approval + SoD + business-scope guard) + domain events
created/submitted/approved/rejected + audit + idempotency + REST + OpenAPI
fragment + AsyncAPI channel + test berlapis + 3 gate komposisi + `bun run check`

- CI (`bun run check` + integration-tests + hygiene + codeql). `extension.manifest.json`
  sebagai dokumen. Migrasi bernomor 900+ di `sql/` repo turunan.

**DITUNDA ke increment berikutnya:** SSR admin UI (list/search/create/submit/
task-approval/timeline/reporting), reporting projector cursor_table + refresh
job, docker-compose LAN/prod + backup/restore + systemd/nginx + Coolify guide +
create-app-role, upgrade-path doc, e2e-smoke Playwright PR-spesifik, `active`
maturity promotion.

## Rencana eksekusi Increment-1

### Fase A — Repo turunan (vendor)

1. Buat repo GitHub **`ahliweb/awcms-erp-pilot`** (private) + checkout lokal
   (mis. `/home/data/dev_bun/awcms-erp-pilot`).
2. Vendor base awcms v5.1.1: salin tree (git snapshot bersih, tanpa `.git` base),
   init git baru, `bun install`. Rename `package.json` name → `awcms-erp-pilot`
   (version 0.1.0). Pertahankan semua gate/skills/CI/docker.
3. Baseline `bun run check` HIJAU (registry masih `undefined` = base murni).
4. Tulis `extension.manifest.json` (compatibleAwcmsRange base v5.1.1, doc).
   Sesuaikan `.github/workflows/*` untuk repo turunan (nama image, dst).

### Fase B — Modul purchase_requisition

5. Migrasi (di `sql/` repo turunan) `900_awcms_purchase_requisition_schema.sql`:
   `awcms_pr_requisitions` (header: id, tenant_id, code, title,
   requester_tenant_user_id, business_scope ref, status enum
   draft/submitted/approved/rejected/cancelled, version int, workflow_instance
   ref, submitted metadata, timestamps, deleted_at draft-only) +
   `awcms_pr_requisition_lines` (id, tenant_id, requisition_id, komposit FK
   `(tenant_id, requisition_id)`, item desc, qty, uom, est_unit_cost, line_no).
   RLS ENABLE+FORCE + policy `app.current_tenant_id`, index `(tenant_id, …)`,
   GRANT `awcms_app`. Immutability pasca-submit (trigger/CHECK + guard aplikasi:
   hanya draft mutable). `901_awcms_seed_purchase_requisition_permissions.sql`:
   seed `purchase_requisition.requisition.{read,create,update,submit,approve,reject}`
   ke `awcms_permissions`.
6. `src/modules/purchase-requisition/{domain,application,infrastructure}/` +
   `module.ts` (defineModule: type domain, api, permissions, events.publishes,
   **sodRules requester≠approver**) + README. `domain/` = state machine murni.
7. Isi `src/modules/application-registry.ts` (id `awcms-erp-pilot`, modules
   `[purchaseRequisitionModule]`, migrationNamespace 900–999). Regen
   `modules:composition:inventory:generate`.
8. Route `src/pages/api/v1/purchase-requisitions/*.ts` (model dari
   `workflows/tasks/[id]/decisions.ts`): create draft, PATCH draft (lines),
   submit (→ `startWorkflowInstance`), approve/reject (PR-spesifik: guard
   `requisition.approve`, lookup `requestedByTenantUserId` sebelum guard,
   `recordWorkflowTaskDecision` + transisi status + audit + event, idempotent),
   list (keyset), detail/timeline. Inject `BusinessScopeHierarchyPort` di route.
9. OpenAPI fragment `openapi/modules/purchase-requisition.openapi.yaml` (+
   allow-list public-op sendiri). Domain events: register
   `DOMAIN_EVENT_TYPE_REGISTRY` + `events.publishes` + channel
   `asyncapi/awcms-domain-events.asyncapi.yaml` (parity test). Bundle +
   `api:spec:check`.

### Fase C — Test + gate + CI + PR + review + merge

10. Unit (state machine draft→submitted→approved/rejected; immutability;
    self-approval logic). Integration (DB nyata + role non-superuser: draft →
    submit → approve ubah status; requester TAK bisa approve sendiri; RLS FORCE
    fail-closed lintas tenant; immutability pasca-submit; SoD requester/approver
    ditolak/exception; idempotent replay; keyset presisi). Kontrak
    `api:spec:check`.
11. `bun run check` penuh HIJAU + 3 gate komposisi + regen inventory committed.
    CI turunan hijau (integration-tests postgres:18.4 + hygiene + codeql).
12. Changeset. Commit, push, PR di `ahliweb/awcms-erp-pilot`. Reviewer +
    security-auditor subagent (adversarial), address findings, merge.
13. Update tracker #187 (base) dengan link evidence PR turunan; JANGAN close
    (increment-1 ≠ seluruh #187 — UI/deploy/upgrade menyusul). Update memory
    (`awcms-derived-pilot-notes.md` baru) + skill bila perlu.

## Verifikasi (increment-1)

- `bun run check` penuh hijau di repo turunan.
- Integration DB-gated: buat draft → submit → approve mengubah status; requester
  TAK bisa approve sendiri (self-approval ditolak); RLS FORCE fail-closed lintas
  tenant di bawah role non-superuser; immutability pasca-submit ditegakkan.
- 3 gate komposisi + CI hijau; bukti extension model (base registry tak diedit
  selain `application-registry.ts`).
