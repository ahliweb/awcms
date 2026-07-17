---
"awcms": minor
---

Tambah role runtime least-privilege `awcms_app` (`sql/019_awcms_db_role_separation.sql`) — RLS akhirnya jadi batas keamanan nyata, bukan deklarasi kosong.

Migration 017 (PR #139) menutup bypass **pemilik tabel** lewat `FORCE ROW LEVEL SECURITY` di 23 tabel, tapi PostgreSQL melewati RLS **tanpa syarat** untuk SUPERUSER/BYPASSRLS — dan `DATABASE_URL` selama ini adalah role migration owner (biasanya superuser). Artinya setiap policy `awcms_*_tenant_isolation` di repo ini masih inert saat runtime: isolasi tenant sepenuhnya bergantung pada klausa `WHERE tenant_id` di aplikasi. Migration 019 memport bagian ke-2 migration 013 (`enforce_rls_least_privilege`) dari awcms-mini:

- `CREATE ROLE awcms_app NOLOGIN` (idempoten, tanpa password — password itu secret, diaktifkan operator lewat `ALTER ROLE awcms_app LOGIN PASSWORD '<secret>'`), bukan superuser, bukan BYPASSRLS, bukan pemilik tabel, hanya DML.
- Default GUC fail-closed `app.current_tenant_id = '00000000-0000-0000-0000-000000000000'`: query yang menyentuh tabel RLS di luar `withTenant()` mendapat **nol baris**, bukan error `unrecognized configuration parameter` dan bukan data tenant lain.
- `GRANT` minimal + `ALTER DEFAULT PRIVILEGES` supaya tabel baru tidak perlu boilerplate GRANT.

**Aksi operator (deployment-affecting):** setelah `bun run db:migrate`, aktifkan LOGIN + password untuk `awcms_app` lalu arahkan `DATABASE_URL` runtime ke role itu, dan jalankan migrasi berikutnya dengan `DATABASE_URL` ditimpa ke connection string owner. Tanpa langkah ini aplikasi tetap jalan seperti sebelumnya (sebagai owner) — tapi tanpa lapisan RLS. Lihat doc 18 §Model role database.

Sekaligus memperbaiki artefak fiktif yang menegaskan properti keamanan yang tidak dimiliki sistem (Issue #155): `client.ts` merujuk sebuah migration `045_awcms_db_role_separation` yang tidak pernah ada di repo ini, header `sql/014` mengklaim konvensi `FORCE` "sejak migration 002" (tidak benar sampai 017), `reporting/README.md` menyebut header `X-AWCMS-Mini-Tenant-ID` (sebenarnya `X-AWCMS-Tenant-ID`), `_shared/idempotency.ts` menyebut migration 012 (di sini 009), serta doc 13/18 yang mendaftarkan migration fiktif. `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` kini didokumentasikan jujur sebagai seam pool — **bukan** role `awcms_worker`/`awcms_setup` (itu migration 045 di awcms-mini, belum diport); operator yang mengikuti klaim lama akan mendapat `permission denied` di setiap job.
