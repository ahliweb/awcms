# Contoh Modul Domain Minimal

> **Status (2026-07-14):** Repo `awcms` baru pada tahap fondasi ulang (lihat
> [ADR-0001](../../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) —
> **belum ada modul ERP yang diimplementasikan** dan `src/` belum eksis.
> Setiap path/perintah di dokumen ini (`src/modules/...`, `bun run ...`,
> skill, dsb.) adalah **pola target** yang akan berlaku begitu implementasi
> fondasi dimulai — diadaptasi dari base
> [awcms-mini](https://github.com/ahliweb/awcms-mini) yang sudah fully
> implemented dan modul contohnya sudah teruji nyata di sana. Gunakan
> dokumen ini sebagai referensi mekanisme (struktur folder, migration+RLS,
> ABAC, endpoint, kontrak API/event, test), bukan sebagai bukti bahwa kode
> ini sudah berjalan di repo `awcms`.

Contoh konkret satu modul domain ERP minimal — dari struktur folder sampai
test checklist — sebagai referensi praktis untuk modul domain ERP pertama
yang akan dibangun di repo ini (finance, inventory, procurement,
manufacturing, HR/payroll, dst.).

> **Ini adalah template, bukan modul yang sudah ada.** Domain contoh di sini
> (`expense-category` — pencatatan kategori beban/expense sederhana untuk
> modul finance) sengaja dipilih sebagai domain ERP paling minimal yang
> masuk akal (satu entitas master data, tanpa alur transaksi/approval
> berjenjang) — bukan modul finance/inventory penuh. Salin polanya, **ganti
> nama domain, entitas, permission, dan field** sesuai modul ERP nyata yang
> sedang dibangun — jangan salin `expense-category` apa adanya ke produksi.
> Tidak satu pun kode di dokumen ini ada di `src/modules/` repo ini; repo ini
> belum punya folder `src/` sama sekali pada tahap fondasi ulang ini.

## Struktur folder

Direncanakan mengikuti pola modul aktif base (`domain/` untuk logika murni
tanpa I/O, `application/` untuk orkestrasi transaksi/DB, `api/` untuk tipe
request/response spesifik endpoint bila diperlukan, route Astro tetap di
`src/pages/api/v1/...` — bukan di dalam folder modul):

```
src/modules/expense-category/
├── module.ts
├── README.md
├── domain/
│   └── expense-category-validation.ts   # validasi murni, tanpa DB
└── application/
    └── expense-category-directory.ts    # fungsi yang menerima `tx`, menjalankan query
```

Route endpoint tetap ada di `src/pages/api/v1/finance/expense-categories/index.ts`
(atau path sesuai domain Anda) — konsisten dengan seluruh modul aktif base,
yang tidak menaruh route Astro di dalam folder modul.

## `module.ts` — descriptor awal

Modul baru direncanakan **selalu** mulai `version: "0.1.0"`,
`status: "experimental"` — naik ke `active`/`1.0.0` setelah memenuhi
kriteria "matang" (test integrasi + security checklist lengkap, lihat
§Checklist keamanan di bawah):

```typescript
import { defineModule } from "../_shared/module-contract";

export const expenseCategoryModule = defineModule({
  key: "expense_category",
  name: "Expense Category",
  version: "0.1.0",
  status: "experimental",
  description:
    "Kategori beban/expense tenant-scoped untuk modul finance — contoh modul domain ERP minimal.",
  dependencies: ["identity_access"],
  api: {
    openApiPath: "openapi/awcms-public-api.openapi.yaml",
    basePath: "/api/v1/finance/expense-categories"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: ["awcms.expense-category.expense-category.registered"]
  }
});
```

`dependencies: ["identity_access"]` karena modul ini memakai
`evaluateAccess`/`resolveTenantContext` milik `identity-access` — pola yang
sama seperti modul aktif lain, bukan menulis ulang RBAC/ABAC-nya sendiri.

## Migration PostgreSQL + RLS

**Wajib**: `tenant_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY` di migration yang
sama, index berprefiks `(tenant_id, …)`. Setiap tabel domain baru **harus**
menyertakan `FORCE` sendiri di migration yang membuatnya:

```sql
-- NNN_awcms_expense_category_schema.sql — contoh modul domain ERP minimal.

CREATE TABLE IF NOT EXISTS awcms_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  category_code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_expense_categories_status_check
    CHECK (status IN ('active', 'retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_expense_categories_code_dedup
  ON awcms_expense_categories (tenant_id, category_code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_expense_categories_tenant_idx
  ON awcms_expense_categories (tenant_id);

-- ENABLE dan FORCE wajib SATU migration yang sama — jangan pisah ke
-- migration terpisah, dan jangan lupakan FORCE (RLS tanpa FORCE tidak
-- berlaku untuk owner/migrasi role).
ALTER TABLE awcms_expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_expense_categories FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_expense_categories_tenant_isolation
  ON awcms_expense_categories
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Grant DML ke role least-privilege aplikasi (migration role-separation
-- awal membuat role ini; tabel baru tetap perlu grant eksplisit sendiri).
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_expense_categories TO awcms_app;
```

Konvensi penomoran migration dan checksum runner mengikuti pola
`NNN_awcms_<area>_<desc>.sql` — jangan menulis migration di luar pola ini.

## Seed permission/role/policy

Domain baru menambah permission-nya sendiri, mengikuti pola penamaan
`<module>.<resource>.<action>` yang sudah dipakai modul aktif lain (bukan
menyalin isi ilustratif, hanya polanya):

```sql
INSERT INTO awcms_permissions (key, module_key, description) VALUES
  ('expense_category.expense_category.read', 'expense_category', 'Lihat daftar kategori beban tenant'),
  ('expense_category.expense_category.write', 'expense_category', 'Buat/ubah kategori beban tenant')
ON CONFLICT (key) DO NOTHING;
```

Assign permission ke role lewat `awcms_role_permissions` seperti pola modul
lain — **tidak ada grant implisit**: tanpa baris di tabel ini, ABAC
default-deny menolak semua akses ke permission baru.

## Service/application function

`application/expense-category-directory.ts` — menerima transaksi (`tx`) dari
`withTenant`, tidak membuka koneksi sendiri:

```typescript
export type RegisterExpenseCategoryInput = {
  tenantId: string;
  categoryCode: string;
  name: string;
};

export async function registerExpenseCategory(
  tx: Bun.TransactionSQL,
  input: RegisterExpenseCategoryInput
) {
  const rows = await tx`
    INSERT INTO awcms_expense_categories (tenant_id, category_code, name)
    VALUES (${input.tenantId}, ${input.categoryCode}, ${input.name})
    RETURNING id, category_code, name, status, created_at
  `;

  return rows[0];
}
```

Validasi murni (format `categoryCode`, panjang `name`, dst.) tetap di
`domain/expense-category-validation.ts` tanpa import DB apa pun — dipanggil
dari route sebelum `application/` dijalankan, konsisten dengan pemisahan
domain/application modul aktif lain.

## Endpoint REST — route tipis

Pola standar (auth → tenant context → ABAC guard → validasi → idempotency
bila high-risk → service+transaksi → response helper):

```typescript
// src/pages/api/v1/finance/expense-categories/index.ts
import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { extractBearerToken } from "../../../../../modules/identity-access/application/session-lookup";
import {
  fetchGrantedPermissionKeys,
  resolveTenantContext
} from "../../../../../modules/identity-access/application/auth-context";
import { recordDecisionLog } from "../../../../../modules/identity-access/application/decision-log";
import { evaluateAccess } from "../../../../../modules/identity-access/domain/access-control";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { registerExpenseCategory } from "../../../../../modules/expense-category/application/expense-category-directory";
import { validateExpenseCategoryInput } from "../../../../../modules/expense-category/domain/expense-category-validation";

const GUARD_REQUEST = {
  moduleKey: "expense_category",
  activityCode: "expense_category",
  action: "write" as const
};

export const POST: APIRoute = async ({ request }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");
  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const body = await request.json();
  const validation = validateExpenseCategoryInput(body);
  if (!validation.valid) {
    return fail(400, "VALIDATION_ERROR", validation.message);
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const context = await resolveTenantContext(tx, tenantId, tokenHash, now);
      if (!context) {
        return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
      }

      const grantedPermissionKeys = await fetchGrantedPermissionKeys(
        tx,
        tenantId,
        context.tenantUserId
      );
      const decision = evaluateAccess(
        context,
        GUARD_REQUEST,
        grantedPermissionKeys
      );
      await recordDecisionLog(
        tx,
        tenantId,
        context.tenantUserId,
        GUARD_REQUEST,
        decision
      );

      if (!decision.allowed) {
        return fail(403, "ACCESS_DENIED", decision.reason);
      }

      const expenseCategory = await registerExpenseCategory(tx, {
        tenantId,
        categoryCode: body.categoryCode,
        name: body.name
      });

      // High-risk domain action (mempengaruhi klasifikasi beban finance) ->
      // audit trail.
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: context.tenantUserId,
        moduleKey: "expense_category",
        action: "expense_category.registered",
        resourceType: "expense_category",
        resourceId: expenseCategory.id,
        message: `Expense category ${expenseCategory.category_code} registered.`
      });

      return ok(expenseCategory);
    },
    { workClass: "interactive" }
  );
};
```

Bila endpoint ini dianggap mutation high-risk yang perlu aman diulang (retry
client), tambahkan parameter `Idempotency-Key` dan bungkus dengan
`findIdempotencyRecord`/`saveIdempotencyRecord` (`src/modules/_shared/idempotency.ts`)
— pola idempotency yang sama dipakai endpoint keputusan workflow approval
(mis. persetujuan pengeluaran/expense).

## Snippet OpenAPI

Kontrak API direncanakan sebagai artefak GENERATED — jangan edit langsung.
Tambahkan path baru ke fragment sumber modul ini,
`openapi/modules/<module-key>.openapi.yaml` (bikin baru bila modul ini belum
punya satu — satu file per modul/tag, jangan campur dengan modul lain), lalu
jalankan `bun run openapi:bundle` untuk regenerate file bundle publikasi.
Kontrak yang DIPUBLIKASIKAN tetap tunggal — hanya representasi sumber yang
dipecah per modul:

```yaml
/api/v1/finance/expense-categories:
  post:
    tags:
      - Expense Category
    summary: Register a new expense category for the caller's tenant
    operationId: expenseCategoriesRegisterExpenseCategory
    security:
      - bearerAuth: []
        tenantHeader: []
    parameters:
      - $ref: "#/components/parameters/CorrelationId"
      - $ref: "#/components/parameters/RequestId"
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ExpenseCategoryRegisterRequest"
    responses:
      "200":
        description: Expense category registered.
        content:
          application/json:
            schema:
              allOf:
                - $ref: "#/components/schemas/ApiSuccess"
                - type: object
                  required: [data]
                  properties:
                    data:
                      $ref: "#/components/schemas/ExpenseCategoryResponse"
      "400":
        $ref: "#/components/responses/BadRequest"
      "401":
        $ref: "#/components/responses/Unauthorized"
      "403":
        $ref: "#/components/responses/Forbidden"
      "500":
        $ref: "#/components/responses/InternalError"
```

`ExpenseCategoryRegisterRequest`/`ExpenseCategoryResponse` didefinisikan
sekali di `components.schemas` fragment modul ini (atau di file sumber
bersama bila genuinely dipakai 2+ modul), sama seperti skema modul aktif
lain. Jalankan `bun run openapi:bundle` lalu `bun run api:spec:check` setelah
menambah path — pemeriksaan ini gagal bila `info.version` bukan SemVer,
path/schema tidak konsisten, bundle basi relatif terhadap fragment sumber,
`operationId` duplikat, path parameter tidak cocok, response error bukan
`ApiError`, atau security metadata tidak eksplisit.

## Snippet AsyncAPI (bila mutation menghasilkan event domain)

Tambahkan channel baru ke `asyncapi/awcms-domain-events.asyncapi.yaml` hanya
bila mutation ini perlu disinkronkan lintas node (outbox) atau dikonsumsi
async oleh sistem lain — bukan wajib untuk setiap endpoint:

```yaml
channels:
  awcms.expense-category.expense-category.registered:
    address: awcms.expense-category.expense-category.registered
    messages:
      DomainEvent:
        $ref: "#/components/messages/DomainEvent"
    description: Emitted when a new expense category is registered for a tenant.
operations:
  publishExpenseCategoryRegistered:
    action: send
    channel:
      $ref: "#/channels/awcms.expense-category.expense-category.registered"
    messages:
      - $ref: "#/channels/awcms.expense-category.expense-category.registered/messages/DomainEvent"
```

Konsisten dengan pola base: dokumentasi kontrak ini tidak mensyaratkan
dispatcher pub/sub konkret — payload event yang sama bisa dikirim lewat sync
outbox (`awcms_sync_outbox`) bila deployment butuh sinkronisasi
offline-first (mis. gudang/cabang yang sesekali offline).

## Checklist layar UI/admin

- [ ] Token desain base dipakai (bukan warna/spacing hardcode).
- [ ] 4-state pattern: loading, empty, error, ready.
- [ ] Aksesibilitas WCAG 2.1 AA (label, fokus, kontras).
- [ ] Semua string lewat katalog `.po`, bukan hardcode Bahasa
      Indonesia/Inggris langsung di komponen.
- [ ] Aksi high-risk (mis. retire kategori beban yang masih dipakai transaksi
      aktif) menampilkan konfirmasi eksplisit sebelum submit.

## Checklist test

- [ ] **Unit** — `domain/expense-category-validation.ts` diuji tanpa DB
      (kasus valid/invalid, boundary format `categoryCode`).
- [ ] **Integration** — endpoint `POST /api/v1/finance/expense-categories`
      diuji terhadap PostgreSQL nyata (bukan mock): tenant isolation, ABAC
      allow/deny, response shape.
- [ ] **Keamanan** — uji RLS benar-benar `FORCE` (query lintas tenant harus 0
      baris, bukan hanya "terlihat benar" di path bahagia); uji ABAC
      default-deny (permission belum diseed → akses ditolak).
- [ ] **Kontrak** — `bun run api:spec:check` hijau setelah path/schema baru
      ditambahkan.

## Checklist keamanan sebelum dianggap siap produksi

Diterapkan ke domain contoh ini, sekaligus jadi baseline untuk modul ERP
nyata pertama:

- [ ] Tenant context lewat `withTenant()`/`resolveTenantContext` — tidak ada
      `WHERE tenant_id` manual dari input klien.
- [ ] ABAC default-deny — permission
      `expense_category.expense_category.write`/`.read` diseed eksplisit,
      tidak ada grant implisit.
- [ ] RLS `ENABLE`+`FORCE` di migration yang sama, policy isolasi tenant,
      index berprefiks `(tenant_id, …)`.
- [ ] Audit — `expense_category.registered` (dan aksi high-risk domain lain,
      mis. retire) menghasilkan baris `awcms_audit_events` via
      `recordAuditEvent`.
- [ ] Idempotency — bila endpoint dianggap high-risk/retry-sensitive, terima
      `Idempotency-Key`.
- [ ] Redaksi — bila entitas domain Anda punya identifier sensitif (NIK,
      NPWP, nomor rekening, dst. — umum di modul finance/HR-payroll),
      terapkan redaksi/masking yang sama seperti pola NPWP/NIK/email di base
      sebelum simpan/tampil/log.
- [ ] `bun run api:spec:check` hijau.
- [ ] `bun run production:preflight` hijau sebelum go-live.

## Lihat juga

- [`../18_configuration_env_reference.md`](../18_configuration_env_reference.md)
  — referensi environment variable fondasi.
- [`../templates/module-proposal-template.md`](../templates/module-proposal-template.md),
  [`../templates/module-admission-decision-checklist.md`](../templates/module-admission-decision-checklist.md)
  — proses admission modul baru.
- `AGENTS.md` (root repo) — alur kerja wajib setiap task, termasuk disiplin
  ADR.
