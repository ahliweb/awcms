# Tenant Admin

Tenant root, office hierarchy, tenant settings, dan setup wizard satu-kali.

## Schema

- `awcms_tenants` — root multi-tenant, unique `tenant_code`, `status` (active/inactive/suspended). **RLS-free** (lihat `application/tenant-settings-directory.ts` — endpoint wajib `WHERE id = <tenantId>` eksplisit).
- `awcms_offices` — hierarki kantor per tenant, unique `(tenant_id, office_code)` selama belum soft-deleted, RLS tenant isolation, soft delete standar. Parent hierarki dijaga FK **komposit** `(tenant_id, parent_office_id) → (tenant_id, id)` (`sql/020`), bukan FK ke `id` saja — lihat "Kenapa FK-nya komposit" di bawah.
- `awcms_tenant_settings` — 1:1 per tenant (timezone, feature flag generik), RLS tenant isolation.
- `awcms_setup_state` — singleton (`id boolean PRIMARY KEY DEFAULT true`, tanpa `tenant_id`/RLS), mengunci setup permanen setelah berhasil sekali.

Skema: `sql/002_awcms_tenant_office_schema.sql`, `sql/006_awcms_setup_wizard_schema.sql`.

## Setup wizard

- `GET /api/v1/setup/status` — public. `{ locked: false }` atau `{ locked: true, tenantId, lockedAt }`.
- `POST /api/v1/setup/initialize` — public, hanya sekali. Satu transaksi: klaim lock (`INSERT ... ON CONFLICT DO NOTHING`), buat tenant, `SET LOCAL app.current_tenant_id`, tenant_settings, office (`head_office`), profile+identity+tenant_user owner, role `owner` (`is_system=true`) berisi seluruh permission yang ada saat itu, assignment owner, kunci `setup_state`. Orkestrasi di `application/platform-bootstrap.ts`.

## Tenant settings

`GET/PATCH /api/v1/settings` — guard `tenant_admin.tenant_settings.{read,update}`.

## Offices

`GET/POST /api/v1/offices`, `GET/PATCH /api/v1/offices/{id}` — guard `tenant_admin.office_management.{read,create,update}`. Soft delete belum punya endpoint (belum ada permission `delete` yang di-seed — tambahkan lewat migration terpisah bila dibutuhkan).

`GET /api/v1/offices` **keyset-paginated**: maksimal 100 baris per halaman, urut **terbaru dulu**, plus `nextCursor` opaque (`null` di halaman terakhir). Cursor rusak → `400`, bukan diam-diam menyajikan halaman 1.

### Kenapa FK-nya komposit (GHSA-r7cx-c4jh-cvvw)

`parent_office_id` dulu `REFERENCES awcms_offices (id)` — FK ke primary key saja, yang tidak berkata apa pun soal tenancy. Admin tenant A bisa mengirim `parentOfficeId` milik tenant B dan dapat `200 OK`; hierarkinya menyeberang tenant, dan field itu sekaligus jadi existence oracle (id nyata milik tenant lain → 200, uuid acak → FK violation → 500).

**RLS tidak menolong dan memang tidak bisa**: PostgreSQL menjalankan pemeriksaan integritas referensial dengan hak pemilik tabel dan **melewati RLS** — jadi lookup parent di balik FK tetap melihat baris tenant B walau sesi dipin ke tenant A. Terbukti masih tembus setelah `FORCE ROW LEVEL SECURITY` aktif (`sql/017`). RLS membatasi apa yang bisa di-SELECT sebuah query; ia tidak membatasi apa yang boleh direferensikan sebuah constraint.

Dua lapis, tidak redundan:

1. **FK komposit** (`sql/020`) — invarian level database, berlaku walau tidak ada kode aplikasi yang jalan.
2. **Validasi aplikasi** (`createOffice` → `fetchOfficeById(tx, tenantId, parentOfficeId)`) — mengubah parent buruk jadi `400` yang benar (bukan FK violation → 500), **dan** menolak parent yang sudah soft-deleted, yang tidak bisa diungkapkan FK mana pun (baris soft-deleted masih ada secara fisik).

Ketiga sebab parent buruk — tidak ada, milik tenant lain, sudah soft-deleted — sengaja gagal **identik** (`ParentOfficeNotFoundError` → satu pesan yang sama). Membedakannya di response persis oracle yang ditutup advisory ini.

**Aturan yang harus dijaga**: pemeriksaan parent wajib mendahului tulis pertama di `createOffice`. `withTenant` COMMIT saat callback-nya return normal, jadi route yang menangkap error di dalam transaksi lalu return 4xx akan **mem-persist** apa pun yang tertulis sebelum throw. Begitu juga `DuplicateOfficeCodeError` (23505 → `409 OFFICE_CODE_ALREADY_EXISTS`): ditangkap **di dalam** `withTenant` supaya tidak dihitung circuit breaker (`tenant-context.ts` mengecualikan kelas 23 lewat cek `instanceof PostgresError` yang tidak lagi cocok begitu error-nya dibungkus), dan setelah tertangkap **tidak boleh menulis apa pun lagi** ke `tx` — transaksinya sudah abort, audit event di situ akan gagal 25P02 dan mengubah 409 jadi 500.

## Belum tersedia

Seed ABAC policy row (`awcms_abac_policies` kosong — evaluator memakai aturan generik di `evaluateAccess`), event AsyncAPI `tenant.created`/`access.assignment`, role selain `owner`, module-management (enable/disable modul per tenant).
