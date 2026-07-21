# Runbook Eksekusi Increment-1 — Pilot Turunan #187 (`awcms-erp-pilot`, Purchase Requisition)

> **⚠️ DEPRECATED ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)).** Model aplikasi-turunan di repo terpisah DICABUT — keluarga AWCMS (`awcms-mini`/`awcms`/`awcms-micro`) kini template **dipakai-langsung**, tanpa membuat repo derivatif (kembangkan modul langsung di template). Dokumen ini dipertahankan sebagai catatan historis.

> **Status: rencana eksekusi terperinci (belum dieksekusi).** Dokumen ini TIDAK
> menulis kode. Ia adalah runbook langkah-demi-langkah untuk pekerjaan yang
> **sengaja TIDAK dikerjakan di repo base `ahliweb/awcms`** — implementasi domain
> pilot hidup di repo turunan terpisah `ahliweb/awcms-erp-pilot` (aturan keras
> #187: pilot tidak menambah logika ERP ke repo base). Melengkapi (bukan
> menggantikan) [`derived-app-pilot-purchase-requisition-plan.md`](derived-app-pilot-purchase-requisition-plan.md)
> (rencana level-atas) dan [`derived-app-pilot-plan.md`](derived-app-pilot-plan.md)
> (pemilihan kandidat) dengan **signature seam base yang sudah diverifikasi ke
> kode** + koreksi terhadap asumsi rencana + DDL/deskriptor konkret.
>
> Semua path file & signature di bawah dikutip dari kode base repo ini
> (`ahliweb/awcms`) yang akan **di-vendor apa adanya** ke repo turunan; nomor
> baris bisa bergeser antar rilis — perlakukan sebagai peta, verifikasi ulang
> saat mengeksekusi.

## 0. Kenapa dokumen ini ada (scope "tidak dikerjakan di repo ini")

Epic #177 (fondasi ERP turunan) selesai kecuali #187: membangun satu aplikasi
turunan pilot nyata untuk MEMBUKTIKAN extension model end-to-end. #187 di repo
base = **tracker acceptance/evidence saja**. Implementasi nyata (modul domain +
migrasi 900+ + route + test) tidak boleh mendarat di `ahliweb/awcms`. Karena itu
"pekerjaan Increment-1" tidak dieksekusi di repo ini — yang mendarat di repo ini
adalah **rencana + runbook** ini sebagai artefak perencanaan yang bisa dieksekusi
kapan pun di repo turunan (oleh sesi berikutnya atau tim turunan).

Deliverable repo base = dua dokumen (`*-plan.md` + runbook ini) + update tracker
#187 saat repo turunan sudah punya bukti PR hijau.

## 1. Peta seam base yang di-REUSE — signature terverifikasi

Semua di bawah **di-reuse apa adanya** dari base yang di-vendor; JANGAN
reimplement. Route composition root (file route) yang menginjeksi port
(ADR-0011) adalah satu-satunya tempat wiring.

### 1.1 Auth & guard (identity-access)

| Seam             | Signature (terverifikasi)                                                                                                                                             | File                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Guard chokepoint | `authorizeInTransaction(tx, tenantId, tokenHash, now, guard, options?)` → `{allowed, context, grantedPermissionKeys}`; `options` memuat `hierarchyPort?`, `sodRules?` | identity-access/application/access-guard.ts  |
| ABAC evaluator   | `evaluateAccess(context, request, grantedPermissionKeys, businessScopeFacts?, abac?)` → `AccessDecision`                                                              | identity-access/domain/access-control.ts:253 |
| High-risk cek    | `isHighRiskAction(action: AccessAction): boolean`                                                                                                                     | access-control.ts:177                        |

- **`evaluateAccess` param ke-4 = `businessScopeFacts`, BUKAN `sodRules`** (koreksi
  terhadap rencana). SoD bukan parameter fungsi domain ini; enforcement SoD
  additive di chokepoint aplikasi via `options.sodRules` di
  `authorizeInTransaction` (memanggil `checkHighRiskSoDConflicts` setelah
  keputusan RBAC/ABAC).
- Urutan guard internal `evaluateAccess`: tenant_isolation → self_approval_deny
  (action `approve`/`force_decide` + `requestedByTenantUserId`) → business_scope
  (opt-in `requiredScopeType`/`requiredScopeId`) → ABAC deny → RBAC default_deny
  (`permissionKey`) → allow-constraint ABAC.
- `AccessRequest` = `{moduleKey, activityCode, action, resourceType?, resourceId?,
resourceAttributes?}`. `resourceAttributes` yang dikenali guard: `tenantId`,
  `requestedByTenantUserId`, `requiredScopeType`, `requiredScopeId`,
  `requiredScopeRelations`.

### 1.2 Tenant transaction

`withTenant(sql, tenantId, fn, {workClass})` — set `app.current_tenant_id`, pool,
circuit-breaker, dan **penangkap sentral** `IdempotencyRaceLostError` (→ replay
atau 409 IDEMPOTENCY_CONFLICT). `WorkClass` valid: `critical_transaction`,
`interactive` (default, dipakai route mutasi high-risk), `reporting`,
`background_sync`, `maintenance`. Semua mutasi PR interaktif =
`{workClass: "interactive"}`.

### 1.3 Workflow-approval (di-reuse untuk approval)

| Seam                | Signature                                                                                                                                                                                                                                  | File                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Mulai instance      | `startWorkflowInstance(tx, {tenantId, workflowKey, resourceType, resourceId, requestedByTenantUserId, facts?, now?, correlationId?, ...notifDeps})` → `{instanceId, workflowDefinitionId, workflowDefinitionVersion, finished, status}`    | workflow-approval/application/workflow-instance.ts:82 |
| Ambil task+lock     | `fetchTaskWithInstanceForDecision(tx, tenantId, taskId)` → `TaskWithInstanceRow \| undefined` (`FOR UPDATE OF t`)                                                                                                                          | workflow-instance-decision.ts:116                     |
| Assignment eligible | `findEligibleAssignment(tx, tenantId, taskId, decidingTenantUserId, workflowKey, resourceType, now)` → `AssignmentRow \| null` (`null` = bukan decider)                                                                                    | workflow-instance-decision.ts:144                     |
| Catat keputusan     | `recordWorkflowTaskDecision(tx, {tenantId, taskId, task, assignment, decidingTenantUserId, decision: "approve"\|"reject", reason?, now, correlationId?, ...notifDeps})` → `{instanceId, taskCompleted, instanceFinished, instanceStatus?}` | workflow-instance-decision.ts:216                     |

- `startWorkflowInstance` menyematkan versi definisi aktif (`lifecycle_status='active'`)
  ke instance. Melempar `WorkflowDefinitionNotActiveError` /
  `InvalidWorkflowFactsError`.
- `recordWorkflowTaskDecision` mengasumsikan pemanggil **sudah** mengecek
  `task.status === 'pending'` + ABAC; ia INSERT append-only ke
  `awcms_workflow_decisions`, hitung kuorum `COUNT(DISTINCT tenant_user_id)`, dan
  hanya saat task komplet memanggil `completeApprovalTaskAndAdvance`.
- **Port notifikasi opsional**: `WorkflowNotificationPort.enqueueNotification(tx,
request)`. Node `notify` di graph-engine skip diam-diam bila port tidak
  diinjeksi (default no-op). Untuk increment-1 (email belum di-port) JANGAN
  inject → approver bekerja lewat inbox task, bukan email. OK sesuai batas
  increment-1.

### 1.4 Domain event, audit, idempotency, response, pagination

| Seam               | Signature                                                                                                                                                                                                                                                             | File / tabel                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Append event       | `appendDomainEvent(tx, tenantId, {eventType, eventVersion, aggregateType, aggregateId, aggregateVersion?, producerModule, payload, correlationId?, causationId?, actorTenantUserId?, occurredAt?})` → `{eventId, eventSequence, deliveriesCreated, skippedConsumers}` | domain-event-runtime/application/append-domain-event.ts:64 |
| Audit              | `recordAuditEvent(tx, {tenantId, moduleKey, action, resourceType, message, actorTenantUserId?, resourceId?, severity?, attributes?, correlationId?})` → `void` (auto-redaksi `attributes`)                                                                            | logging/application/audit-log.ts:36                        |
| Idempotency hash   | `computeRequestHash(payload): string` (SHA-256, key sorted deep)                                                                                                                                                                                                      | \_shared/idempotency.ts:37                                 |
| Idempotency lookup | `findIdempotencyRecord(tx, tenantId, requestScope, idempotencyKey)` → `IdempotencyRecord \| null`                                                                                                                                                                     | \_shared/idempotency.ts:92                                 |
| Idempotency save   | `saveIdempotencyRecord(tx, tenantId, requestScope, idempotencyKey, requestHash, responseStatus, responseBody)` → `void` (INSERT ON CONFLICT DO NOTHING; race → `IdempotencyRaceLostError`)                                                                            | tabel `awcms_idempotency_keys`                             |
| Response           | `ok(data, meta?)` 200 / `created(data, meta?)` 201 / `fail(status, code, message, meta?, details?, headers?)`; `meta = {correlationId?, requestId?}`                                                                                                                  | \_shared/api-response.ts                                   |
| Keyset SQL         | konstanta `KEYSET_CURSOR_CREATED_AT_SQL` (SELECT `to_char(... 'US' ...)` alias `created_at_cursor`)                                                                                                                                                                   | \_shared/keyset-pagination.ts:58                           |
| Keyset codec       | `encodeKeysetCursor(createdAtCursor, id)` / `decodeKeysetCursor(cursor)` → `KeysetCursor \| null`                                                                                                                                                                     | keyset-pagination.ts:69/102                                |

- **`eventVersion` bertipe string** (`"1.0"`); `producerModule` selalu eksplisit.
- Setiap `(eventType, eventVersion)` WAJIB terdaftar di
  `DOMAIN_EVENT_TYPE_REGISTRY` (else `UnregisteredDomainEventTypeError`).
- **Keyset presisi (jebakan #158)**: `createdAt` cursor adalah **TEKS mikrodetik**,
  bukan JS `Date`. `timestamptz` = mikrodetik; `Date` hanya milidetik → cursor
  dari `Date` melewati baris pada milidetik yang sama. WHERE mem-bind
  `${cursor.createdAt}::timestamptz`. Bawa `created_at_cursor` di SELECT, jangan
  rekonstruksi dari `Date`.

## 2. Reality-check & koreksi terhadap rencana (WAJIB baca sebelum eksekusi)

Temuan yang mengubah rencana level-atas — hasil verifikasi ke kode:

1. **`submit` BUKAN `AccessAction` yang valid.** Union `AccessAction`
   (access-control.ts:27) tidak memuat `submit`. Rencana yang men-seed permission
   `purchase_requisition.requisition.submit` akan menghasilkan action yang tak
   pernah lolos guard (default-deny senyap). **Resolusi (pilih satu, catat di
   ADR turunan):**
   - **(Direkomendasikan) PR fondasi generik ke base**: tambah `submit` ke union
     `AccessAction` sebagai action **non-high-risk** (submit adalah aksi generik
     tiap dokumen approvable; union ini memang tumbuh per-fitur — workflow,
     reporting, MFA, SoD). #187 mengizinkan "PR fondasi generik terpisah bila
     terbukti perlu". Ini bukti nyata gap fondasi yang disurface pilot. Kecil,
     reusable, tidak mengandung logika ERP.
   - **(Interim tanpa sentuh base)** guard endpoint submit dengan action valid
     yang berbeda-permission: activityCode `requisition_submission` + action
     `create` → permission `purchase_requisition.requisition_submission.create`
     (semantik: "membuat submission"; non-high-risk; distinct dari
     `requisition.update` untuk edit draft).
2. **Event domain workflow di-emit di dalam application layer, bukan di route.**
   `startWorkflowInstance`/`recordWorkflowTaskDecision` sudah meng-`appendDomainEvent`
   untuk event **workflow** (`awcms.workflow.instance.*`). Event **domain PR**
   (`created/submitted/approved/rejected`) adalah event TERPISAH milik modul
   pilot — di-append oleh kode modul pilot sendiri di dalam transaksi route,
   dengan `producerModule: "purchase_requisition"` dan channel/registry sendiri.
   Jangan berharap workflow layer memancarkannya.
3. **`reject` non-high-risk** (access-control.ts:64). `isHighRiskAction("reject")`
   = false → gerbang SoD **action-time** (yang hanya menyala pada high-risk) TIDAK
   berjalan saat reject. Itu sengaja & aman (menolak = konflik tetap ditolak).
   SoD requester≠approver tetap digigit oleh (a) gerbang **assignment-time**
   (tak bisa memegang izin create+approve di scope sama) dan (b) gerbang
   action-time pada `approve` (yang high-risk). Reject tidak perlu SoD action-time.
4. **`awcms_app` TIDAK butuh GRANT eksplisit per tabel.**
   `sql/019_awcms_db_role_separation.sql` sudah `GRANT ... ON ALL TABLES` +
   `ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES TO awcms_app`. Migrasi tabel
   baru hanya perlu GRANT eksplisit ke `awcms_worker` **bila ada job** (mis.
   projector). Increment-1 menunda projector → **tak perlu GRANT worker apa pun**.
5. **`awcms_permissions` katalog GLOBAL** (`sql/005`): tanpa `tenant_id`, tanpa
   RLS, unique `(module_key, activity_code, action)`. Seed via migrasi
   (`ON CONFLICT DO NOTHING`) WAJIB — descriptor `module.ts` hanya di-sync lazily,
   jadi tanpa seed migrasi owner role bootstrap default-denied sampai sync
   berikutnya (pola `sql/028`).
6. **`migrationNamespace` murni deklaratif.** Gate komposisi membandingkan range
   `{rangeStart, rangeEnd}` vs konstanta base `{1, 899}` — **tak membaca
   `sql/*.sql`**. Yang WAJIB benar adalah deklarasi `900–999` di
   `application-registry.ts`; nomor file fisik hanya konvensi runner.
7. **`ModuleType` tak punya `"derived"`** (`base|system|domain|integration`).
   Modul pilot WAJIB `type: "domain"` (else gate `invalid_module_type`).
8. **Gate `extension.manifest.json` (ADR-0015) belum ada**; `extension:check`
   hanya validasi seam komposisi. Pin versi base = tulis `extension.manifest.json`
   sebagai DOKUMEN + review manual, jangan andalkan gate. `production:preflight`
   juga tak ada scriptnya — jalankan underlying satu-satu. `AUTH_JWT_SECRET` tak
   dipakai base (env wajib: `APP_ENV`, `APP_URL`, `DATABASE_URL`).

## 3. Fase A — Scaffold repo turunan (vendor)

1. Buat repo GitHub **`ahliweb/awcms-erp-pilot`** (private) + checkout lokal
   (mis. `/home/data/dev_bun/awcms-erp-pilot`).
2. **Vendor base v5.1.1**: salin snapshot tree base bersih (tanpa `.git` base),
   `git init` baru, `bun install`. Ubah `package.json` `name` → `awcms-erp-pilot`,
   `version` `0.1.0`. Pertahankan semua gate/skills/CI/Dockerfile.production.
3. **Baseline `bun run check` HIJAU** dengan registry masih `undefined` (base
   murni). Ini membuktikan vendor bersih sebelum menyentuh apa pun.
4. Tulis **`extension.manifest.json`** (dokumen; `compatibleAwcmsRange` menunjuk
   base v5.1.1). Sesuaikan `.github/workflows/*` untuk repo turunan (nama image,
   dsb). Set env wajib `APP_ENV`/`APP_URL`/`DATABASE_URL`.

## 4. Fase B — Modul `purchase_requisition`

### 4.1 Migrasi skema (di `sql/` **repo turunan**, nomor 900+)

File `900_awcms_purchase_requisition_schema.sql` — pola nama runner
`^\d{3}_awcms_[a-z0-9_]+\.sql$` (`scripts/db-migrate.ts`), checksum immutable
setelah applied. Ikuti template `sql/027_awcms_business_scope_assignments_schema.sql`
(pola paling representatif) + `sql/020` (composite FK tenant-scoped).

Elemen WAJIB tiap tabel tenant-scoped:

- `tenant_id uuid NOT NULL REFERENCES awcms_tenants (id)`.
- **Composite FK** `(tenant_id, xxx_id)` menunjuk `UNIQUE (tenant_id, id)` tabel
  target — BUKAN FK kolom-tunggal (RI-check berjalan sebagai OWNER dan **bypass
  RLS**, FK tunggal bisa menunjuk lintas tenant meski FORCE).
- `ADD CONSTRAINT ..._tenant_id_key UNIQUE (tenant_id, id)` pada tabel yang jadi
  target FK tabel lain (mis. header ditunjuk lines).
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` **lalu**
  `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` (ENABLE saja inert untuk owner).
- `CREATE POLICY ..._tenant_isolation ON ... USING (tenant_id =
current_setting('app.current_tenant_id')::uuid);`
- Index selalu diawali `tenant_id`: `(tenant_id, status)`, dan
  `(tenant_id, created_at, id)` untuk keyset.
- **Tidak perlu GRANT** (blanket `awcms_app` dari `sql/019`).

**`awcms_pr_requisitions`** (header): `id uuid PK`, `tenant_id`, `code text`,
`title text`, `requester_tenant_user_id uuid NOT NULL`, kolom business-scope
(`scope_type`, `scope_id`), `status text` CHECK
`('draft','submitted','approved','rejected','cancelled')`, `version int NOT NULL
DEFAULT 1`, `workflow_instance_id uuid`, `submitted_at timestamptz`, `created_at`/
`updated_at timestamptz NOT NULL DEFAULT now()`, `deleted_at timestamptz` (draft-
only soft-delete). Composite FK `(tenant_id, requester_tenant_user_id)` →
`awcms_tenant_users (tenant_id, id)`. `UNIQUE (tenant_id, id)` (target lines).
`UNIQUE (tenant_id, code)`.

**`awcms_pr_requisition_lines`**: `id uuid PK`, `tenant_id`, `requisition_id uuid
NOT NULL`, composite FK `(tenant_id, requisition_id)` →
`awcms_pr_requisitions (tenant_id, id)`, `item_description text`, `quantity
numeric(18,4)`, `uom text`, `estimated_unit_cost numeric(18,4)`, `line_no int`.
Index `(tenant_id, requisition_id, line_no)`.

**Immutability pasca-submit**: guard aplikasi (hanya `status='draft'` mutable) +
pertahanan DB (trigger/CHECK menolak UPDATE kolom bisnis saat `status <> 'draft'`,
kecuali transisi status resmi). Soft-delete hanya untuk draft.

File `901_awcms_seed_purchase_requisition_permissions.sql`: seed katalog
permission (pola `sql/028`):

```sql
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('purchase_requisition', 'requisition', 'read',   '...'),
  ('purchase_requisition', 'requisition', 'create', '...'),
  ('purchase_requisition', 'requisition', 'update', '...'),
  ('purchase_requisition', 'requisition', 'approve','...'),
  ('purchase_requisition', 'requisition', 'reject', '...')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
```

Untuk submit: tambahkan baris sesuai resolusi §2.1 yang dipilih (jika PR base
`submit`: `('purchase_requisition','requisition','submit',...)`; jika interim:
`('purchase_requisition','requisition_submission','create',...)`).

### 4.2 Modul `src/modules/purchase-requisition/`

Struktur `{domain,application,infrastructure}/` + `module.ts` + `README.md`.
`domain/` = state machine murni (draft→submitted→approved/rejected/cancelled;
transisi legal + invariant immutability, tanpa I/O). Deskriptor via
`defineModule()` (identity fn, `_shared/module-contract.ts`,
`MODULE_CONTRACT_VERSION 1.3.0`).

Field `ModuleDescriptor` WAJIB: `key: "purchase_requisition"` (snake_case, tak
boleh tabrak base → `prohibited_base_override`), `name`, `version: "0.1.0"`,
`status: "experimental"`, `description`, `dependencies:
["tenant_admin","identity_access","workflow","domain_event_runtime"]`. WAJIB
tambahan: **`type: "domain"`**. Opsional dipakai:

- `api: {openApiPath: "openapi/modules/purchase-requisition.openapi.yaml",
basePath: "/api/v1/purchase-requisitions"}`.
- `permissions: [{activityCode, action, description}]` — sinkron dengan seed §4.1.
- `events: {asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml", publishes:
["awcms.purchase-requisition.created", ".submitted", ".approved", ".rejected"]}`
  (tiap string = nama channel AsyncAPI).
- `sodRules: [...]` (lihat §4.3).
- `navigation` (path unik global; ditunda ke increment UI berikutnya bila tak
  ada layar).

Isi **`src/modules/application-registry.ts`** (satu-satunya base file diedit,
guardrail ADR-0013):

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

Lalu regen inventory: `bun run modules:composition:inventory:generate` → commit
`docs/awcms/module-composition-inventory.json`.

### 4.3 SoD rule (requester ≠ approver)

Pola langsung dari fixture example-crm
(`tests/fixtures/derived-application-example/modules/example-crm/module.ts`,
`example_crm.requisition_approval_separation`). `SoDRuleDescriptor`:

```ts
{
  ruleKey: "purchase_requisition.requester_approver_separation",
  ownerModuleKey: "purchase_requisition",
  description: "Pemohon PR di suatu scope tak boleh sekaligus meng-approve PR di scope yang SAMA (requester/approver separation).",
  conflictingPermissionKeys: [
    "purchase_requisition.requisition.create",
    "purchase_requisition.requisition.approve"
  ],
  scopeApplicability: "same_scope_only",
  severity: "high",
  exceptionPolicy: {
    allowed: true,
    requiresApprovalPermission: "identity_access.business_scope_exceptions.approve",
    maxDurationDays: 7
  }
}
```

`sodRules` mengalir OTOMATIS ke enforcement lewat
`collectSoDRuleDescriptors(listModules())` → `high-risk-sod-guard.ts` (tak perlu
wiring per-route). Gate `sod:registry:check` memvalidasi kumpulan rule saat
`listModules()` menyertakan modul pilot.

### 4.4 Route HTTP (composition root)

Route di **`src/pages/api/v1/purchase-requisitions/*.ts`** (Astro, BUKAN di folder
modul). Model kanonik: `src/pages/api/v1/workflows/tasks/[id]/decisions.ts`
(auth + idempotency + decision + audit + event dalam satu handler).

**Urutan rantai mutasi high-risk (terverifikasi dari decisions.ts):**

1. `resolveAuthInputs` → guard 400/401/`IDEMPOTENCY_REQUIRED`.
2. `readJsonBody` → validasi domain.
3. `withTenant(sql, tenantId, async (tx) => { ... }, {workClass: "interactive"})`.
4. Di dalam tx, untuk approve/reject: **`fetchTaskWithInstanceForDecision` paling
   awal** (mengisi `requestedByTenantUserId` untuk self-approval check) →
   `authorizeInTransaction(tx, tenantId, tokenHash, now, guard, {hierarchyPort,
sodRules})`.
5. **Cek idempotency replay SETELAH guard** (`findIdempotencyRecord`).
6. `findEligibleAssignment` (untuk decision) → kerja domain (transisi status).
7. `recordWorkflowTaskDecision` (approve/reject) — melakukan event workflow +
   transisi task internal.
8. `appendDomainEvent(tx, tenantId, {producerModule: "purchase_requisition", ...})`
   untuk event **domain PR** (created/submitted/approved/rejected).
9. `recordAuditEvent(tx, {...})`.
10. Bangun `ok(data, {correlationId})` **lalu** `saveIdempotencyRecord` (body
    disimpan dari `ok(...).clone().json()`).

Endpoint:

- `POST /purchase-requisitions` — create draft (guard `requisition.create`).
- `PATCH /purchase-requisitions/{id}` — edit draft + lines (guard
  `requisition.update`; tolak bila non-draft — immutability).
- `POST /purchase-requisitions/{id}/submit` — guard sesuai resolusi §2.1;
  `startWorkflowInstance(tx, {workflowKey, resourceType: "purchase_requisition",
resourceId: id, requestedByTenantUserId, ...})` + transisi draft→submitted +
  event `.submitted` + audit.
- `POST /purchase-requisitions/{id}/approve` — **endpoint PR-spesifik** (BUKAN
  endpoint workflow generik), guard `requisition.approve` (high-risk → SoD +
  self-approval + business-scope benar-benar menggigit). Di dalam satu tx:
  `recordWorkflowTaskDecision(decision:"approve")` + transisi status +
  event `.approved` + audit, idempotent.
- `POST /purchase-requisitions/{id}/reject` — guard `requisition.reject`
  (non-high-risk), simetris approve.
- `GET /purchase-requisitions` — list keyset (`KEYSET_CURSOR_CREATED_AT_SQL` +
  `encode/decodeKeysetCursor`).
- `GET /purchase-requisitions/{id}` — detail + timeline (dari
  `awcms_workflow_decisions` + audit/event).

**Inject port di route (composition root, ADR-0011):**
`BusinessScopeHierarchyPort` (#180) — base default `resolved:false` → fail-closed
deny; approval ber-scope WAJIB inject resolver nyata (contoh
`identity/business-scope/assignments/index.ts`), else selalu deny.
`WorkflowNotificationPort` — JANGAN inject (increment-1 no-email → node `notify`
no-op).

**Keputusan desain kunci** (kenapa endpoint PR-spesifik): endpoint workflow
generik hanya menjaga izin _workflow_, jadi SoD rule `requisition.create` vs
`requisition.approve` TAK menyala di sana. Endpoint approve/reject PR-sendiri +
lookup `requestedByTenantUserId` sebelum guard membuat SoD + self-approval nyata.

### 4.5 OpenAPI fragment + AsyncAPI + domain event registry

- **OpenAPI**: `openapi/modules/purchase-requisition.openapi.yaml` — hanya
  `paths:` + `components.schemas:` (bukan OpenAPI valid mandiri; `$ref` ke shared
  components base resolve saat bundle). Ditunjuk `ModuleDescriptor.api.openApiPath`,
  di-merge lewat seam `extraFragmentFiles` bundler (`scripts/openapi-bundle.ts`)
  **tanpa mengedit fragment base**. Redefine path/schema base →
  `BundleConflictError`. `bun run openapi:bundle` lalu `api:spec:check`
  (bundle commit harus byte-match; route parity).
- **AsyncAPI**: tambah channel di `asyncapi/awcms-domain-events.asyncapi.yaml`
  (address = nama event, message `$ref DomainEvent`, + `operations:` `action:
send`) untuk tiap event PR, DAN entri `events.publishes` di `module.ts`.
- **Registry event**: daftarkan tiap `(eventType, eventVersion)` di
  `DOMAIN_EVENT_TYPE_REGISTRY` (`domain-event-runtime/domain/event-type-registry.ts`,
  bentuk `{eventType, eventVersion, description}`). Parity test
  (`domain-event-registry-parity.test.ts`) menegakkan: registry↔AsyncAPI
  dua-arah, `events.publishes` memuat entri milik modul, tak ada duplikat.
- Consumer strategi `domain_event` butuh edit consumer-registry statik → untuk
  projeksi PR (increment berikutnya) pakai **`cursor_table`** biar modul
  self-contained.

## 5. Fase C — Test, gate, CI, PR, review, merge

### 5.1 Test berlapis

- **Unit** (tanpa DB): state machine draft→submitted→approved/rejected;
  invariant immutability pasca-submit; logika self-approval (requester =
  approver → tolak); validasi transisi ilegal.
- **Integration** (DB nyata `postgres:18.4` + role **non-superuser** `awcms_app`
  LOGIN, dua-world harness): draft → submit → approve mengubah status; requester
  TAK bisa approve sendiri (self-approval deny); **RLS FORCE fail-closed lintas
  tenant** (di bawah role non-superuser — ENABLE saja tak cukup); immutability
  pasca-submit ditegakkan; SoD requester/approver ditolak + jalur exception;
  idempotent replay (key sama → response sama; hash beda → 409); presisi keyset
  (baris pada mikrodetik sama tak terlewat).
- **Kontrak**: `api:spec:check` (bundle fresh + route parity + standard error
  schema).

Catatan harness: dua suite DB-gated (RLS/role-sep vs ad-hoc) **tak boleh tabrak
satu `bun test`** — step terpisah di CI. Reset circuit-breaker per `beforeEach`.

### 5.2 Gate & CI

`bun run check` penuh HIJAU, termasuk **3 gate komposisi**: `modules:compose:check`
(duplicate_key / prohibited_base_override / invalid_module_type /
migration_namespace_overlap 1–899 vs 900–999 / navigation_path_conflict /
invalid_job_descriptor / capability), `modules:composition:inventory:check` (regen

- commit `module-composition-inventory.json`), `extension:check` (derived mode:
  `id` non-empty + modules ≥1). Plus `sod:registry:check`, `family:conformance:check`
  (lulus selama base tak diubah), `logging:lint`, typecheck, test, build.

CI turunan carry-over: `integration-tests` (RLS + role-sep, dua suite terpisah),
`e2e-smoke` (Playwright — PR-spesifik ditunda), `minimum-supported` (Bun 1.3.0),
`hygiene`, `codeql`. `security:readiness` = perintah go-live (butuh DB
ter-migrate), **bukan** bagian `bun run check`.

### 5.3 PR & tracker

1. Changeset. Commit atomic, push, buka PR di **`ahliweb/awcms-erp-pilot`**.
2. Review adversarial: subagent `awcms-reviewer` + `awcms-security-auditor`;
   address findings; merge.
3. **Update tracker #187 (repo base)** dengan link evidence PR turunan. **JANGAN
   close** — increment-1 ≠ seluruh #187 (UI/deploy/upgrade menyusul).
4. Update memory (`awcms-derived-pilot-notes.md`) + skill bila perlu.

## 6. Batas Increment-1 (DIKERJAKAN vs DITUNDA)

**Increment-1 (INI):** scaffold repo (vendor) + modul `purchase_requisition`
vertical slice (header+lines, draft CRUD, submit) + approval workflow penuh
(submit→instance→task→approve/reject endpoint PR-spesifik, self-approval + SoD +
business-scope guard) + domain events created/submitted/approved/rejected + audit

- idempotency + REST + OpenAPI fragment + AsyncAPI channel + test berlapis + 3
  gate komposisi + `bun run check` + CI + `extension.manifest.json` sebagai dokumen.
  Migrasi bernomor 900+ di `sql/` repo turunan.

**DITUNDA ke increment berikutnya:** SSR admin UI (list/search/create/submit/
task-approval/timeline/reporting), reporting projector `cursor_table` + refresh
job (butuh GRANT `awcms_worker`), docker-compose LAN/prod + backup/restore +
systemd/nginx + Coolify + create-app-role, upgrade-path doc, e2e-smoke
Playwright PR-spesifik, promosi maturity `active`.

## 7. Verifikasi Increment-1 (Definition of Done)

- `bun run check` penuh hijau di repo turunan (base registry tak diedit selain
  `application-registry.ts`).
- Integration DB-gated di bawah role non-superuser: draft → submit → approve
  mengubah status; requester TAK bisa approve sendiri; RLS FORCE fail-closed
  lintas tenant; immutability pasca-submit ditegakkan; SoD requester/approver
  ditolak + exception; idempotent replay; keyset presisi.
- 3 gate komposisi + CI hijau; bukti extension model (registry seam satu file).
- Tracker #187 diperbarui dengan link evidence (tidak ditutup).

## 8. Daftar keputusan terbuka (perlu diputuskan saat eksekusi)

1. **Resolusi action `submit`** (§2.1): PR fondasi generik ke base (menambah
   `submit` ke `AccessAction`) **vs** interim `requisition_submission.create`.
   Rekomendasi: PR base generik (kecil, reusable, bukti gap fondasi yang
   disurface pilot — persis tujuan #187).
2. **Workflow definition PR**: butuh seed `awcms_workflow_definitions`
   (`workflowKey` PR, node approval + `notify` no-op, kuorum) di migrasi turunan
   agar `startWorkflowInstance` menemukan definisi `active`. Tentukan
   single-approver vs kuorum.
3. **Business-scope resolver nyata** yang diinject di route approve — reuse
   assignment resolver base atau resolver pilot-spesifik.
