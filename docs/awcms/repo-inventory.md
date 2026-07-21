# AWCMS Repository Inventory (generated)

> **Status dokumen:** standar/template, BUKAN hasil generate nyata — dan **isi body di bawah kini USANG**. Body masih menyatakan "belum ada modul" dan "belum ada migrasi"; itu **tidak lagi benar** — repo `awcms` sekarang punya **11 modul** (urutan `src/modules/index.ts`: `logging`, `tenant-admin`, `profile-identity`, `identity-access`, `module-management`, `domain-event-runtime`, `sync-storage`, `workflow-approval`, `email`, `reporting`, `theming`) dan **34 migrasi** (`sql/001`–`034`). Sumber kebenaran keadaan kode saat ini adalah [`../ARCHITECTURE.md`](../ARCHITECTURE.md), bukan berkas ini. Tabel di bawah adalah **struktur target** yang baru akan terisi akurat begitu `scripts/repo-inventory-generate.ts` (`bun run repo:inventory:generate`) diimplementasikan/di-port dari `awcms-mini`. Mekanisme (generated-file, freshness check, sumber data) diadaptasi dari basis `awcms-mini` yang sudah menjalankannya secara nyata.

> **GENERATED FILE — jangan diedit manual.** Setelah diimplementasikan, dokumen ini akan diproduksi oleh `bun run repo:inventory:generate` (`scripts/repo-inventory-generate.ts`) dari module registry repo sendiri, migrasi `sql/*.sql`, `tests/`, dan kontrak OpenAPI yang di-bundle — jangan pernah diedit langsung. `bun run repo:inventory:check` (bagian dari `bun run check`) wajib menggagalkan build bila berkas ini basi relatif terhadap regenerasi baru.

**Freshness.** Dokumen ini sengaja tidak menyertakan timestamp generasi (stempel wall-clock akan membuat setiap regenerasi ter-diff meski tidak ada perubahan bermakna). Ia selalu mendeskripsikan state repository **pada commit tempat ia di-commit** — checkout tag/commit mana pun dan berkas ini (atau `bun run repo:inventory:generate` yang segar) mendeskripsikan state itu, tidak pernah state lain. State issue/label/milestone GitHub dilacak terpisah di `docs/awcms/github/` (menyusul, di-refresh on-demand lewat `bun run github:snapshot:refresh` — panggilan jaringan langsung, sengaja di luar `bun run check`).

## Modul

Repo ini kini punya **11 modul aktif** yang terdaftar di `src/modules/index.ts`'s `listModules()`. Nilai akurat per-kolom (version/status/type/dependencies) dibaca dari registry nyata — sumber kebenaran keadaan kode saat ini adalah [`../ARCHITECTURE.md`](../ARCHITECTURE.md) dan registry itu sendiri, bukan tabel statis di bawah. Urutan `src/modules/index.ts`: `logging`, `tenant-admin`, `profile-identity`, `identity-access`, `module-management`, `domain-event-runtime`, `sync-storage`, `workflow-approval`, `email`, `reporting`, `theming`. Begitu `bun run repo:inventory:generate` diimplementasikan/di-port, tabel ini akan diisi otomatis dengan bentuk yang sama seperti basis:

| Key                      | Version | Status | Type | Dependencies |
| ------------------------ | ------- | ------ | ---- | ------------ |
| _(lihat registry nyata)_ | —       | —      | —    | —            |

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

Repo ini kini punya **34 berkas migrasi** di `sql/` (`001`–`034`). Konvensi penomoran: seluruh migrasi berurutan sekuensial mulai `001`. Reserved namespace `900+` untuk jalur aplikasi-turunan **sudah dicabut oleh ADR-0034** (keluarga AWCMS = template dipakai-langsung, tidak ada repo derivatif) — modul domain/website ditambahkan langsung ke `src/modules/` dan migrasinya melanjutkan penomoran sekuensial yang sama. Daftar file lengkap dibaca dari `sql/*.sql`; sumber kebenaran adalah filesystem `sql/`, bukan tabel statis di bawah.

| #                     | File |
| --------------------- | ---- |
| _(lihat `sql/*.sql`)_ | —    |

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
