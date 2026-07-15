# AWCMS Repository Inventory (generated)

> **Status dokumen:** standar/template, bukan hasil generate nyata. Repo `awcms` belum punya modul, migrasi, test, atau kontrak OpenAPI apa pun untuk diinventarisasi — tabel di bawah adalah **struktur target** yang akan diisi otomatis begitu `scripts/repo-inventory-generate.ts` diimplementasikan dan modul pertama (fondasi: tenant/identity/access, lalu ERP) mulai ditambahkan. Mekanisme (generated-file, freshness check, sumber data) diadaptasi dari basis `awcms-mini` yang sudah menjalankannya secara nyata.

> **GENERATED FILE — jangan diedit manual.** Setelah diimplementasikan, dokumen ini akan diproduksi oleh `bun run repo:inventory:generate` (`scripts/repo-inventory-generate.ts`) dari module registry repo sendiri, migrasi `sql/*.sql`, `tests/`, dan kontrak OpenAPI yang di-bundle — jangan pernah diedit langsung. `bun run repo:inventory:check` (bagian dari `bun run check`) wajib menggagalkan build bila berkas ini basi relatif terhadap regenerasi baru.

**Freshness.** Dokumen ini sengaja tidak menyertakan timestamp generasi (stempel wall-clock akan membuat setiap regenerasi ter-diff meski tidak ada perubahan bermakna). Ia selalu mendeskripsikan state repository **pada commit tempat ia di-commit** — checkout tag/commit mana pun dan berkas ini (atau `bun run repo:inventory:generate` yang segar) mendeskripsikan state itu, tidak pernah state lain. State issue/label/milestone GitHub dilacak terpisah di `docs/awcms/github/` (menyusul, di-refresh on-demand lewat `bun run github:snapshot:refresh` — panggilan jaringan langsung, sengaja di luar `bun run check`).

## Modul

Belum ada modul terdaftar di `src/modules/index.ts`'s `listModules()` — repo ini baru berisi keputusan rebuild (ADR-0001), `AGENTS.md`, dan dokumen governance. Begitu implementasi dimulai, tabel ini akan diisi otomatis dengan bentuk yang sama seperti basis:

| Key           | Version | Status | Type | Dependencies |
| ------------- | ------- | ------ | ---- | ------------ |
| _(belum ada)_ | —       | —      | —    | —            |

Urutan modul yang direncanakan (lihat `AGENTS.md` §Peta modul, [`01_canvas_induk.md`](01_canvas_induk.md)):

1. **Fondasi** (dari basis `awcms-mini`): `tenant_admin`, `identity_access`, `profile_identity`, `logging`, `sync_storage`, `workflow`, `reporting`, `module_management`.
2. **ERP — Finance**: general ledger, AP/AR, ekspor pajak/Coretax.
3. **ERP — Inventory**: gudang, penyesuaian stok, transfer.
4. **ERP — Procurement**: purchase request/order, manajemen vendor.
5. **ERP — Manufacturing**: BOM, production order.
6. **ERP — HR/Payroll**: employee, payroll run, absensi.
7. **Integrasi**: payment gateway, marketplace, logistik, Coretax.

Modul baru wajib mengikuti struktur modular monolith yang sama dengan basis (`module.ts` + `domain/`/`application/`/`infrastructure/`/`api/`) dan didaftarkan di `src/modules/index.ts` supaya generator inventaris ini mendeteksinya otomatis.

## Migrasi

Belum ada berkas migrasi di `sql/`. Konvensi penomoran yang wajib diikuti (lihat ADR-0001 dan referensi ADR-0014 milik basis soal reserved namespace): base modular monolith standar (fondasi tenant/identity/access/sync/dsb., bila di-porting literal dari `awcms-mini`) memakai namespace `1-899`; migrasi modul ERP/integrasi milik `awcms` sendiri **dimulai dari `900` ke atas**, agar tidak pernah bentrok dengan nomor migrasi fondasi yang di-porting atau di-referensikan dari basis.

| #                     | File |
| --------------------- | ---- |
| _(belum ada migrasi)_ | —    |

## Tabel & Row-Level Security

Belum ada tabel. Begitu migrasi pertama diterapkan, standar wajib (`AGENTS.md` "PostgreSQL + RLS wajib") berlaku untuk setiap tabel tenant-scoped maupun entitas bisnis ERP (ledger, payroll, inventory, dst.): setiap tabel semacam itu wajib punya `ENABLE ROW LEVEL SECURITY` (dan `FORCE ROW LEVEL SECURITY` untuk peran aplikasi least-privilege — lihat [`deployment-profiles.md`](deployment-profiles.md) §Model dua-peran basis data) atau masuk daftar exempt yang direview eksplisit.

**Kandidat allow-list exempt RLS** (pola yang sama seperti basis — hanya berlaku untuk tabel infra/registry global, bukan data bisnis):

| Tabel (pola)              | Alasan                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `awcms_schema_migrations` | Ledger migrasi — infra bookkeeping, bukan data tenant.                               |
| `awcms_tenants`           | Registry tenant itu sendiri — tabel root yang direferensikan `tenant_id` tabel lain. |
| `awcms_permissions`       | Katalog permission — global, RLS-free.                                               |
| `awcms_modules`           | Registry modul — katalog global yang sama untuk setiap tenant.                       |

Tidak ada tabel bisnis ERP (jurnal, transaksi stok, payroll run, dst.) yang boleh masuk daftar exempt ini — seluruh tabel semacam itu wajib RLS+FORCE tanpa pengecualian.

## Tests

Belum ada test file di `tests/`. Struktur direktori target (mengikuti pola basis):

| Direktori     | Test files |
| ------------- | ---------- |
| `(root)`      | 0          |
| `e2e`         | 0          |
| `integration` | 0          |
| `modules`     | 0          |
| `unit`        | 0          |

## Routes / Operations (ringkasan)

Belum ada kontrak OpenAPI yang di-bundle (`bun run openapi:bundle`, menyusul). Route<->contract parity akan ditegakkan `bun run api:spec:check`'s route-parity check begitu diimplementasikan — dokumen ini hanya akan jadi ringkasan read-only, bukan enforcement terpisah.

## GitHub issue/label/milestone snapshot

Dilacak terpisah di `docs/awcms/github/` (menyusul) — di-refresh on-demand lewat `bun run github:snapshot:refresh` (panggilan `gh` API langsung, bukan bagian `bun run check`). Regenerasi sebelum setiap rilis/audit, bukan pada jadwal tetap.

## Lihat juga

- `AGENTS.md` — aturan wajib RLS/RBAC-ABAC/idempotency/audit yang menentukan bentuk tabel/modul yang akan diinventarisasi dokumen ini.
- [`01_canvas_induk.md`](01_canvas_induk.md) — peta modul dan tahapan pengembangan yang direncanakan.
- [`deployment-profiles.md`](deployment-profiles.md) — model dua-peran basis data dan penegakan RLS yang berlaku untuk setiap tabel yang akan didaftar di sini.
