---
name: awcms-new-migration
description: Buat migration SQL PostgreSQL AWCMS yang benar. Gunakan setiap kali menambah/mengubah tabel, kolom, index, constraint, atau RLS. Menegakkan penamaan NNN_awcms_<area>_<desc>.sql, tenant_id, RLS, index FK, timestamptz, dan numeric sesuai doc 04 & 10.
---

# AWCMS — New SQL Migration

Ikuti standar di `docs/awcms/04_erd_data_dictionary.md` dan `docs/awcms/10_template_kode_coding_standard.md`.

## Penamaan

```text
sql/NNN_awcms_<area>_<description>.sql
```

- `NNN` berurutan, nol di depan (mis. `023`).
- **Jangan** me-rename migration yang sudah rilis; koreksi = migration baru.
- Cek nomor terakhir di `sql/` sebelum menambah.

## Aturan wajib

1. `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (perlu `pgcrypto`).
2. Tabel tenant-scoped **wajib** kolom `tenant_id uuid NOT NULL`.
3. Timestamp = `timestamptz`; uang/quantity = `numeric` (bukan float).
4. `CREATE TABLE IF NOT EXISTS` dan `CREATE INDEX IF NOT EXISTS`.
5. Index untuk `(tenant_id)`, setiap FK child, dan `(tenant_id, created_at DESC)` untuk transaksi/log.
6. `CHECK` constraint untuk kolom enum-like (status, type).
7. **RLS wajib** untuk tabel tenant-scoped (lihat template).
8. **Jangan** membungkus dengan `BEGIN;`/`COMMIT;`/`ROLLBACK;`/`START
TRANSACTION;` — `scripts/db-migrate.ts` mengelola transaksi migration
   itu sendiri dan `assertNoTransactionControl` akan MENOLAK (error,
   bukan warning) migration apa pun yang mengandung statement kontrol
   transaksi di level top-level (di luar comment/string
   literal/dollar-quoted body). Tulis DDL langsung tanpa wrapper.
9. **Tidak** menyimpan password/API key/secret plaintext.
10. Tabel master/config/draft yang deletable wajib soft delete (`deleted_at`, `deleted_by`, `delete_reason`) + index/partial unique aktif.
11. Tabel BARU tanpa `tenant_id`/RLS (global, dibaca/ditulis lintas
    tenant — mis. katalog konfigurasi, registry) **tidak** ikut
    `ALTER DEFAULT PRIVILEGES` di migration 013 yang otomatis meng-grant
    tabel tenant-scoped ke `awcms_app` (Issue #683, epic #679, lihat
    `sql/045_awcms_db_role_separation.sql`'s header) — grant
    eksplisit di migration ANDA sendiri, hanya hak yang benar-benar
    dipakai jalur kode (jangan blanket `SELECT/INSERT/UPDATE/DELETE`),
    dan tambahkan tabel itu ke `RLS_FREE_TABLES` DAN
    `ALLOWED_GLOBAL_TABLE_GRANTS` di `scripts/security-readiness.ts` —
    tanpa keduanya, `checkRuntimeRoleGlobalTableGrants` akan GAGAL
    (critical, blocking go-live) begitu migration Anda memberi grant apa
    pun ke tabel itu tanpa terdaftar di allowlist.

## Template

```sql
CREATE TABLE IF NOT EXISTS awcms_<name> (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid
);

CREATE INDEX IF NOT EXISTS awcms_<name>_tenant_idx
  ON awcms_<name> (tenant_id);
CREATE INDEX IF NOT EXISTS awcms_<name>_tenant_created_idx
  ON awcms_<name> (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS awcms_<name>_active_idx
  ON awcms_<name> (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
-- Konvensi nama index: SUFFIX `_idx` (unique: `_uidx` atau `_key`), bukan
-- prefix `idx_` — lihat 15 migration terakhir/83 index nyata
-- (mis. sql/071, sql/075: `awcms_data_exchange_import_batches_tenant_status_idx`,
-- `awcms_reference_tenant_codes_tenant_active_idx`).

ALTER TABLE awcms_<name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_<name> FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_<name>_tenant_isolation ON awcms_<name>
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

## Menggunakan `SECURITY DEFINER` (bootstrap read sebelum tenant context ada)

Kadang sebuah query harus jalan **sebelum** tenant context ada sama sekali
(mis. resolusi publik `hostname`/`tenantCode` -> `tenant_id`), padahal
tabelnya `FORCE ROW LEVEL SECURITY`. Jangan lepas `FORCE ROW LEVEL
SECURITY` untuk mengakalinya — buat fungsi `SECURITY DEFINER` yang sempit.
Checklist wajib (detail lengkap + alasan tiap butir:
`docs/adr/0003-postgresql-rls-multi-tenant.md` §Checklist; contoh kanonik:
`sql/033_awcms_tenant_domain_lookup_function.sql`, Issue #559):

1. Konfirmasi role pemilik migration benar-benar superuser (`SELECT
rolsuper FROM pg_roles`) — keamanan mekanisme ini datang dari situ, bukan
   dari RLS/`FORCE`.
2. Body fungsi SQL statis/tetap, parameter selalu argumen fungsi
   diparameterkan — tidak ada dynamic SQL/string concatenation.
3. Minimalkan kolom yang di-return — tidak ada kolom sensitif kecuali
   benar-benar dibutuhkan.
4. `REVOKE ALL ... FROM PUBLIC` lalu `GRANT EXECUTE` eksplisit ke role
   spesifik (mis. `awcms_app`) — ini **tidak** otomatis tercakup
   `ALTER DEFAULT PRIVILEGES` migration 013 (itu hanya tabel/sequence).
5. `SET search_path = public, pg_temp` di definisi fungsi.
6. `STABLE`/`IMMUTABLE` untuk fungsi read-only, bukan `VOLATILE` default.
7. Verifikasi empiris terhadap DB yang berjalan (bukan asumsi dari
   dokumentasi PostgreSQL semata) sebelum melaporkan mekanisme ini aman.
8. Kalau ada query kedua yang kondisional setelah fungsi ini (mis. "kalau
   baris ditemukan, query lagi ke tabel lain"), pertimbangkan apakah beda
   jumlah round-trip antar outcome jadi timing side-channel — gabungkan
   jadi satu query via `JOIN` kalau tabel kedua sudah RLS-free/publicly
   readable.

## Append-only & immutable

- Posted sales document & stock movement: **append-only**, tidak di-update/delete. Koreksi lewat reversal/return/adjustment.
- Jangan tambahkan soft delete ke entitas posted/append-only/audit/security log/exported tax batch.
- Untuk business key yang boleh dipakai ulang setelah arsip, gunakan partial unique index `WHERE deleted_at IS NULL`.

## Verifikasi

```bash
bun run db:migrate   # tidak double-run, berhenti saat error
```

Setelah migrate: cek row count kritis, constraint/index, partial unique soft delete, dan RLS aktif. Update ERD/data dictionary bila perlu (doc 04) dan matrix migration (doc 13).
