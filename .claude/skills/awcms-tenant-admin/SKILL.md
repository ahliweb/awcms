---
name: awcms-tenant-admin
description: Kelola modul tenant_admin AWCMS — tenant root, hierarki office (CRUD + soft-delete/restore), tenant settings, dan setup wizard satu-kali yang bootstrap tenant/owner pertama. Gunakan saat menambah/mengubah endpoint office atau tenant settings, menyentuh alur setup awal, atau mengubah hierarki office.
---

# AWCMS — Tenant Admin (office, tenant settings, setup wizard)

Baca `src/modules/tenant-admin/README.md` untuk detail penuh tiap tabel dan
endpoint — skill ini merangkum keputusan yang sudah dibuat supaya tidak
di-re-derive. Skema: `sql/002_awcms_tenant_office_schema.sql` (tenant, office,
tenant_settings), `sql/006_awcms_setup_wizard_schema.sql` (`awcms_setup_state`
singleton), `sql/020` (FK komposit parent office, lihat di bawah).

## Kapan pakai skill ini vs skill generik

Melengkapi (bukan menggantikan) `awcms-new-endpoint`, `awcms-new-migration`,
`awcms-abac-guard` — itu tetap dipakai untuk cara membangun endpoint/migration/
guard. Skill ini menyediakan konteks domain `tenant_admin` spesifik yang tidak
jelas dari sekadar membaca satu file migration.

## Yang sudah ada — pakai ulang, jangan re-derive

- **`awcms_tenants`** — root multi-tenant, unique `tenant_code`. **RLS-free
  secara sengaja** (tidak ada `tenant_id` untuk difilter) — setiap query ke
  tabel ini WAJIB `WHERE id = <tenantId>` eksplisit di kode aplikasi, RLS
  tidak menolong di sini. `awcms_offices`/`awcms_tenant_settings` tenant-scoped
  normal, RLS `ENABLE`+`FORCE`.
- **Setup wizard** (`application/platform-bootstrap.ts`'s
  `bootstrapPlatformTenant`, dipanggil `POST /api/v1/setup/initialize`) —
  **satu-satunya tempat** yang membuat tenant, office, owner profile, identity,
  tenant_user, role, dan access assignment sekaligus dalam SATU transaksi,
  melintasi tabel `tenant_admin`, `profile_identity`, DAN `identity_access` —
  sengaja jadi composition-root function berdiri sendiri, bukan edge
  `dependencies` modul (`dependencies` statis di situ akan salah menyiratkan
  `tenant_admin` tidak bisa berfungsi sama sekali tanpa dua modul lain aktif).
  Invariant: `awcms_setup_state` (`id boolean PRIMARY KEY DEFAULT true`, tanpa
  `tenant_id`/RLS) dikunci PERMANEN setelah sukses sekali (`INSERT ... ON
CONFLICT (id) DO NOTHING RETURNING id` — 0 baris = sudah terinisialisasi,
  `outcome: "already_initialized"`); `GET /api/v1/setup/status` (public) balik
  `{ locked: false }` atau `{ locked: true, tenantId, lockedAt }`. Role
  `owner` yang dibuat di sini `is_system=true` dan digrant SELURUH baris
  `awcms_permissions` yang ada SAAT bootstrap jalan (`SELECT id FROM
awcms_permissions`, bukan daftar hardcoded) — jalur e2e-nya migrasi →
  `POST /setup/initialize` TANPA module permission-sync di antaranya (lihat
  skill `awcms-abac-guard`'s aturan "guard hanya pada action yang ter-seed").
  Jangan bangun jalur setup kedua atau bootstrap sebagian (mis. hanya tenant
  tanpa owner) — akan meninggalkan tenant yang tak punya siapa pun dengan akses.
- **Tenant settings** (`GET/PATCH /api/v1/settings`, guard
  `tenant_admin.tenant_settings.{read,update}`) — 1:1 per tenant, RLS tenant
  isolation normal (beda dari `awcms_tenants` sendiri). `application/
tenant-settings-directory.ts` (`fetchTenantSettings`/`updateTenantSettings`),
  domain `settings-validation.ts`'s `validateUpdateTenantSettingsInput`.
- **Office CRUD** (`GET/POST /api/v1/offices`, `GET/PATCH/DELETE
/api/v1/offices/{id}`, `POST /api/v1/offices/{id}/restore`) — guard
  `tenant_admin.office_management.{read,create,update,delete}`. `GET
/api/v1/offices` **keyset-paginated** (maks 100/halaman, terbaru dulu,
  `nextCursor` opaque, cursor rusak → `400` bukan diam-diam halaman 1 — pola
  sama skill `awcms-performance`'s pagination keyset). Layar admin
  `admin/offices.astro`: create form, inline edit per-baris, soft-delete
  per-baris, section "Deleted offices" + tombol Restore — semua gate hanya
  UX, script bundled eksternal lewat `sendJson`/`postJson`
  (`src/lib/ui/admin-form-client.ts`, lihat skill `awcms-ui-screen`).
- **Tidak ada office yang `is_system`-protected** — beda dari role (skill
  `awcms-abac-guard`'s invariant `is_system`), office `head_office` hasil
  bootstrap TIDAK dikecualikan dari soft-delete/restore normal (verifikasi:
  `office-directory.ts` tidak punya cek `is_system`/proteksi khusus apa pun).
  Kalau menambah aturan "office terakhir tidak boleh dihapus" atau semacamnya
  di masa depan, itu keputusan BARU, bukan sesuatu yang sudah ditegakkan.

## Office soft-delete + restore (Issue #171) — gotcha wajib diketahui

- `DELETE /api/v1/offices/{id}` — guard `office_management.delete`. Soft
  delete (`deleted_at/deleted_by/delete_reason`), **bukan** hard delete: baris
  tetap restorable dan `office_code`-nya langsung bebas dipakai ulang oleh
  office lain (partial unique index `WHERE deleted_at IS NULL`). Body
  opsional/bodyless — `reason` yang ada disimpan+diaudit, `reason` string
  kosong ditolak (bukan diam-diam disimpan sebagai `""`). Audit `delete`
  severity `warning`. 404 bila id tak ada/tenant lain/sudah terhapus.
- `POST /api/v1/offices/{id}/restore` — guard **`office_management.update`**
  (BUKAN `.delete`, dan BUKAN action `restore` tersendiri — activity ini
  sengaja tidak punya permission `restore` sendiri; un-delete diperlakukan
  sebagai edit siklus-hidup record, otoritas yang sama dengan mengubah office
  biasa). Idempotent-safe: restore ulang pada baris yang sudah live → `404`.
- **Gotcha partial-unique-index-on-restore**: restore bisa **409
  `OFFICE_CODE_ALREADY_EXISTS`** bila office LIVE lain sudah mengambil kode
  yang sama selagi baris ini terhapus — partial unique index memicu `23505`
  Postgres pada UPDATE restore, BUKAN pada create biasa saja.
  `restoreOffice` (`office-directory.ts`) sengaja membaca `office_code` baris
  terhapus **sebelum** UPDATE — nilai itu dipakai untuk pesan
  `DuplicateOfficeCodeError` yang presisi, SEKALIGUS berfungsi sebagai cek
  eksistensi (id live/absen → tak ada baris terbaca → `404` sebelum tulis apa
  pun). `23505` ditangkap **di dalam** `withTenant` (pola sama
  `awcms-identifier-masking-notes`/skill `awcms-idempotency`) — kalau
  ditangkap DI LUAR `withTenant`, transaksi sudah abort (`25P02`) dan audit
  event berikutnya di baris kode yang sama akan gagal, mengubah 409 yang
  seharusnya jadi 500. Setelah `23505` tertangkap, JANGAN tulis apa pun lagi
  ke `tx` yang sama.
- Ketiga sebab parent office buruk di `createOffice` — tidak ada, milik
  tenant lain, sudah soft-deleted — sengaja gagal **identik**
  (`ParentOfficeNotFoundError`, satu pesan generik). Membedakannya di
  response adalah oracle keberadaan yang justru ditutup oleh advisory ini
  (lihat di bawah) — jangan pernah membedakannya lagi.

## FK komposit parent office (GHSA-r7cx-c4jh-cvvw) — kenapa bukan FK biasa

`parent_office_id` dulu `REFERENCES awcms_offices (id)` saja — FK ke primary
key tidak berkata apa pun soal tenancy, jadi admin tenant A bisa mengirim
`parentOfficeId` milik tenant B dan dapat `200 OK` (hierarki menyeberang
tenant, field itu sekaligus jadi existence oracle). **RLS tidak menolong dan
memang tidak bisa** di sini — PostgreSQL menjalankan pemeriksaan integritas
referensial dengan hak pemilik tabel dan **melewati RLS** (terbukti tembus
walau `FORCE ROW LEVEL SECURITY` aktif, `sql/017`); RLS membatasi apa yang
bisa di-`SELECT` sebuah query, bukan apa yang boleh direferensikan sebuah
constraint. Dua lapis, TIDAK redundan:

1. **FK komposit** `(tenant_id, parent_office_id) → (tenant_id, id)`
   (`sql/020`) — invarian level database, berlaku walau tidak ada kode
   aplikasi yang jalan.
2. **Validasi aplikasi** (`createOffice` → `fetchOfficeById(tx, tenantId,
parentOfficeId)`) — mengubah parent buruk jadi `400` yang benar (bukan FK
   violation → 500), DAN menolak parent yang sudah soft-deleted, yang tidak
   bisa diungkapkan FK mana pun (baris soft-deleted masih ada secara fisik).

Aturan yang harus dijaga kalau menyentuh `createOffice`/`updateOffice`:
pemeriksaan parent **wajib mendahului tulis pertama** — `withTenant` COMMIT
saat callback-nya return normal, jadi route yang menangkap error DI DALAM
transaksi lalu return 4xx tetap **mem-persist** apa pun yang tertulis sebelum
throw.

## Belum tersedia (jangan asumsikan sudah ada)

Seed ABAC policy row (`awcms_abac_policies` kosong untuk tenant baru — RLS
evaluator memakai aturan generik `evaluateAccess`), event AsyncAPI
`tenant.created`/`access.assignment`, role selain `owner` dibuat otomatis,
module-management enable/disable per tenant (itu modul terpisah, lihat skill
`awcms-module-management`).

## Verifikasi (test)

Office CRUD + soft-delete/restore + FK komposit cross-tenant rejection +
`OFFICE_CODE_ALREADY_EXISTS` on restore — cari test integrasi modul ini
(`tests/integration/`) sebelum menambah skenario baru, pola assert sama
`withTenant`/keyset cursor yang sudah ada. Setup wizard: sekali-jalan
(`already_initialized` pada panggilan kedua), owner mendapat SEMUA permission
saat itu.

## Skill terkait

`awcms-new-endpoint`, `awcms-new-migration`, `awcms-abac-guard` (guard
seeded-action + `is_system` invariant role, bukan office), `awcms-ui-screen`
(pola markup `offices.astro`), `awcms-performance` (pagination keyset),
`awcms-module-management` (enable/disable modul per tenant, di luar scope
modul ini).
