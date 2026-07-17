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
    tenant — mis. katalog konfigurasi, registry): dokumentasikan alasannya
    di header migration, lalu daftarkan nama tabelnya ke `RLS_FREE_TABLES`
    di `scripts/security-readiness.ts` — kalau tidak, `checkRlsEnabled`
    menganggapnya tabel tenant-scoped tanpa RLS dan **memblokir go-live**.
    (`ALLOWED_GLOBAL_TABLE_GRANTS` **tidak ada** di script ini — itu masih
    milik awcms-mini; jangan cari/daftarkan ke sana.)
12. **JANGAN tulis blok `GRANT` per tabel.** Role `awcms_app` ada sejak
    `sql/019_awcms_db_role_separation.sql` (Issue #141), dan 019 memasang
    `ALTER DEFAULT PRIVILEGES` sehingga tabel/sequence baru yang dibuat
    pemilik migration **otomatis** ter-grant ke `awcms_app` — GRANT manual
    murni derau. Yang TIDAK otomatis: `FUNCTION` (lihat §SECURITY DEFINER)
    dan objek yang dibuat role LAIN. Role **`awcms_worker`/`awcms_setup`
    tidak ada** — `GRANT ... TO awcms_worker` yang disalin dari mini akan
    gagal jalan. Baca header `sql/019`: ia sengaja bukan port penuh
    pemisahan app/worker mini.

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
-- prefix `idx_` — mis. sql/013, sql/015:
-- `awcms_workflow_task_assignments_task_idx`,
-- `awcms_reporting_export_runs_scheduled_idx`.

ALTER TABLE awcms_<name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_<name> FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_<name>_tenant_isolation ON awcms_<name>
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

### `ENABLE` tanpa `FORCE` = RLS mati, bukan RLS lemah

**`FORCE` bukan pengetat opsional — tanpanya policy-mu tidak pernah dievaluasi.**
PostgreSQL melewati RLS untuk **pemilik tabel**, dan aplikasi ini connect
sebagai pemilik migration via `DATABASE_URL`. Jadi `ENABLE` sendirian
menghasilkan tabel yang _terlihat_ terlindungi — policy ada, `relrowsecurity`
true — sementara setiap query mengembalikan baris semua tenant.

Ini bukan hipotetis: migration 002-008 dan 010-012 mengirim **23 tabel**
seperti itu (termasuk `awcms_identities`, `awcms_sessions`), dan sebuah audit
sebelumnya justru mencatat "RLS ENABLE di semua tabel tenant-scoped" sebagai
bukti sehat. Diperbaiki `sql/017_awcms_enforce_rls_force.sql`.

Saat me-review/mengaudit RLS: **grep `FORCE`, bukan `ENABLE`**, dan periksa role
koneksi aplikasi. Koneksi `SUPERUSER`/`BYPASSRLS` melewati RLS _bahkan dengan_
`FORCE` — itu lapisan terpisah (role least-privilege `awcms_app`).

Cara membuktikan policy benar-benar menegakkan (bukan sekadar terdaftar): buat
DB sekali-pakai + role `NOSUPERUSER NOBYPASSRLS`, jalankan migration **sebagai
role itu** supaya ia jadi pemilik, seed dua tenant, lalu baca data tenant B
dengan `app.current_tenant_id` disetel ke tenant A. Harus nol baris.

**FK tidak dilindungi RLS.** Pemeriksaan integritas referensial dijalankan
dengan hak pemilik dan melewati RLS, jadi FK yang tidak tenant-scoped tetap
menerima nilai lintas tenant meski `FORCE` aktif. Untuk kolom self-reference
atau FK antar-tabel tenant-scoped, pakai FK **komposit**:

```sql
-- butuh UNIQUE (tenant_id, id) di tabel target
FOREIGN KEY (tenant_id, parent_id) REFERENCES awcms_<target> (tenant_id, id)
```

## Menggunakan `SECURITY DEFINER` (bootstrap read sebelum tenant context ada)

Kadang sebuah query harus jalan **sebelum** tenant context ada sama sekali
(mis. resolusi publik `hostname`/`tenantCode` -> `tenant_id`), padahal
tabelnya `FORCE ROW LEVEL SECURITY`. Jangan lepas `FORCE ROW LEVEL
SECURITY` untuk mengakalinya — buat fungsi `SECURITY DEFINER` yang sempit.
Checklist wajib (detail lengkap + alasan tiap butir:
`docs/adr/0003-postgresql-rls-multi-tenant.md` §Checklist). Base ini belum
punya contoh `SECURITY DEFINER` sendiri — rujukan kanoniknya ada di repo
awcms-mini (migration 033, tenant domain lookup function; Issue #559 di repo
itu), bukan di `sql/` repo ini:

1. Konfirmasi role pemilik migration benar-benar superuser (`SELECT
rolsuper FROM pg_roles`) — keamanan mekanisme ini datang dari situ, bukan
   dari RLS/`FORCE`.
2. Body fungsi SQL statis/tetap, parameter selalu argumen fungsi
   diparameterkan — tidak ada dynamic SQL/string concatenation.
3. Minimalkan kolom yang di-return — tidak ada kolom sensitif kecuali
   benar-benar dibutuhkan.
4. `REVOKE ALL ... FROM PUBLIC` lalu `GRANT EXECUTE` eksplisit ke role
   spesifik (mis. `awcms_app`) — ini **tidak** otomatis tercakup
   `ALTER DEFAULT PRIVILEGES` di `sql/019_awcms_db_role_separation.sql`
   (itu hanya `TABLES`/`SEQUENCES`, bukan `FUNCTIONS`). Nomor 013 di
   awcms-mini; di repo ini default-privilege awcms_app dipasang `sql/019`.
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
