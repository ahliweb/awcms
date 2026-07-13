# Database Migration Runner

> **Status dokumen (AWCMS).** Mekanisme runner migrasi ini diwarisi
> langsung dari base teknis `awcms-mini` (Issue 0.2 di repo asal) dan
> belum diadaptasi/diverifikasi ulang di repo AWCMS — belum ada migrasi
> domain ERP yang ditulis. Konvensi di bawah adalah standar yang berlaku
> begitu migration pertama modul ERP ditambahkan.

Dokumen ini mencatat runner migrasi PostgreSQL AWCMS.

## Perintah

```bash
DATABASE_URL=postgres://awcms:awcms_password@localhost:5432/awcms bun run db:migrate
```

`DATABASE_URL` wajib berasal dari environment. Jangan commit `.env`, dump database, atau kredensial production.

## Kontrak runner

- Runtime memakai Bun melalui `bun scripts/db-migrate.ts`.
- Driver memakai `Bun.SQL`, bukan `pg` atau adapter Node.js.
- File migrasi dibaca dari `sql/` dan diurutkan berdasarkan nama file.
- Nama file wajib mengikuti `NNN_awcms_<area>_<description>.sql`.
- Runner memastikan tabel `awcms_schema_migrations` tersedia.
- Migration yang sudah tercatat akan di-skip.
- Checksum SHA-256 disimpan untuk setiap migration yang applied.
- Jika migration yang sudah applied berubah, runner berhenti dan meminta migration baru.
- Setiap migration baru dijalankan dalam transaction runner; wrapper `BEGIN; ... COMMIT;` luar boleh ada pada file lama dan akan dilepas sebelum eksekusi.
- Error menghentikan proses dengan exit code non-zero.
- Pesan error tidak mencetak nilai `DATABASE_URL`.

## Alur

```mermaid
flowchart TD
  A[Baca sql/*.sql] --> B[Validasi nama file]
  B --> C[Hitung checksum]
  C --> D[Ambil advisory lock]
  D --> E{Sudah tercatat?}
  E -- Ya --> F{Checksum sama?}
  F -- Ya --> G[Skip]
  F -- Tidak --> H[Stop non-zero]
  E -- Tidak --> I[Jalankan dalam transaction]
  I --> J[Catat name + checksum]
  J --> K[Lanjut]
  G --> K
```

## Aturan membuat migration baru

1. Tambahkan file baru di `sql/` dengan nomor berikutnya.
2. Jangan edit migration yang sudah pernah applied di environment bersama atau production.
3. Jangan menaruh secret, dump data customer/finansial/payroll, atau nilai environment nyata di SQL.
4. Schema tenant-scoped (termasuk entitas ERP: ledger, inventory, procurement, manufacturing, HR/payroll) wajib mengikuti standar PostgreSQL + RLS pada dokumen governance/ADR terkait (lihat ADR-0001 dan ADR foundation lain yang akan menyusul untuk RLS/RBAC-ABAC).
5. Resource yang bisa dihapus wajib memakai kolom soft delete sesuai standar ADR soft-delete/immutability yang diwarisi dari base.
</content>
