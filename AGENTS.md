# AGENTS.md — Panduan Agent & Kontributor AWCMS

## Ringkasan proyek

AWCMS adalah **platform ERP dan integrasi solusi bisnis** milik AhliWeb. Repo ini dibangun ulang (lihat [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) di atas basis teknologi **awcms-mini** — *modular monolith standard* Bun + Astro 7 + PostgreSQL — namun skop produknya jauh lebih besar: modul ERP (keuangan, inventori, procurement, manufaktur, HR/payroll) dan integrasi dengan solusi bisnis eksternal (payment gateway, marketplace, Coretax, logistik).

Baca dokumen ini sebelum mengerjakan task apa pun di repo ini. Ini adalah kontrak kerja teknis — aturan wajib, guardrail keamanan, dan alur task.

## Alur kerja wajib setiap task

1. Mulai dari issue/ADR yang jelas scope-nya. Bila mengubah standar dasar, buat ADR dulu (lihat [`GOVERNANCE.md`](GOVERNANCE.md)).
2. Identifikasi dampak: schema (migration), API (OpenAPI), event (AsyncAPI), akses (RBAC/ABAC/RLS), mutation high-risk (idempotency), aksi sensitif (audit), data sensitif (masking).
3. Kerjakan atomic — satu PR = satu perubahan yang jelas dan terisolasi.
4. Tulis test yang gagal sebelum fix, lulus sesudahnya.
5. Perbarui dokumentasi (OpenAPI/AsyncAPI/docs/awcms) dan changeset bila perilaku berubah.
6. Validasi lokal (`bun run check`) sebelum membuka PR.

## Aturan wajib (non-negotiable)

- **Bun-only.** Tidak ada Node.js/npm/pnpm/yarn kecuali ada exception tertulis yang disetujui maintainer.
- **PostgreSQL + RLS wajib** untuk setiap tabel tenant-scoped maupun entitas bisnis (ERP: ledger, payroll, inventory, dst).
- **RBAC + ABAC default-deny** pada semua endpoint non-public.
- **Idempotency** wajib pada mutation high-risk: posting transaksi finansial, payroll run, cancel/return, stock adjustment, warehouse transfer, sync/integrasi eksternal.
- **Audit trail dengan redaksi** untuk aksi high-risk (login, access assignment, price/ledger change, transaksi posted/cancel/return, stock adjustment, resolusi konflik sync).
- **Soft delete** untuk resource yang deletable; **immutability** untuk data yang sudah posted/final (mis. jurnal yang sudah posted tidak diedit, hanya dikoreksi lewat entri baru).
- **Kontrak API/event wajib**: OpenAPI untuk REST, AsyncAPI untuk domain event, disinkronkan setiap perubahan.
- **Masking data sensitif**: data finansial/personal (NPWP, NIK, gaji, rekening bank) tidak boleh tampil polos di log atau response tanpa alasan eksplisit.
- **Outbox/queue untuk integrasi eksternal** — payment gateway, marketplace, Coretax, logistik terhubung lewat outbox, bukan panggilan sinkron langsung dari jalur transaksi kritikal.

## Guardrail keamanan

- Tidak ada secret/kredensial/dump database/data bisnis-finansial asli dalam kode, commit, issue, atau dokumentasi.
- Modul sensitif (auth, access, sync, finance, hr-payroll) memerlukan review keamanan tambahan sebelum merge.
- Laporan kerentanan mengikuti [`SECURITY.md`](SECURITY.md) — tidak ada issue publik untuk kerentanan yang bisa dieksploitasi.

## Struktur repository (target)

```
src/
  modules/
    <module>/
      module.ts
      domain/
      application/
      infrastructure/
      api/
tests/
scripts/
sql/
openapi/
asyncapi/
docs/
  adr/
  awcms/
```

## Peta modul (target awal)

| Kategori           | Modul contoh                                         |
| ------------------ | ------------------------------------------------------ |
| Fondasi (dari basis awcms-mini) | Tenant, Identity, Profile, Access (RBAC/ABAC), Sync, Workflow, Reporting |
| ERP — Finance       | General ledger, AP/AR, tax/Coretax export             |
| ERP — Inventory     | Warehouse, stock adjustment, transfer                 |
| ERP — Procurement   | Purchase request/order, vendor management             |
| ERP — Manufacturing | BOM, production order                                 |
| ERP — HR/Payroll    | Employee, payroll run, attendance                      |
| Integrasi           | Payment gateway, marketplace, logistik, Coretax        |

Modul baru mengikuti urutan: fondasi (tenant/identity/access) → modul ERP yang saling bergantung sesuai domain (mis. inventory sebelum manufacturing) → integrasi eksternal.

## Konvensi commit

Format [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <ringkasan>`. Lihat [`CONTRIBUTING.md`](CONTRIBUTING.md) untuk daftar type dan scope.

## Definition of Done

Lihat [`CONTRIBUTING.md`](CONTRIBUTING.md#definition-of-done).

## Peta dokumen

- [`README.md`](README.md) — gambaran umum & arah rebuild.
- [`GOVERNANCE.md`](GOVERNANCE.md) — tata kelola & pengambilan keputusan.
- [`docs/adr/`](docs/adr/README.md) — keputusan arsitektural (fondasi & ERP-spesifik).
- [`docs/awcms/`](docs/awcms/README.md) — paket dokumen teknis detail per modul (PRD/SRS/ERD/OpenAPI/AsyncAPI), disusun bertahap seiring modul ERP dikembangkan.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — proses kontribusi & Definition of Done.
- [`SECURITY.md`](SECURITY.md) — kebijakan keamanan & pelaporan kerentanan.

## Mulai dari sini

Repo ini masih tahap fondasi ulang — belum ada kode modul ERP. Sebelum menambah modul pertama, pastikan skeleton Astro + Bun + migration runner tersedia (lihat referensi arsitektur di ADR-0001), lalu tambah modul fondasi (tenant/identity/access) sebelum modul domain ERP.
