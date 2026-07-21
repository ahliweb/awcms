# ADR-0003 — PostgreSQL + RLS untuk isolasi multi-tenant

- **Status:** Accepted
- **Tanggal:** 2026-07-05
- **Terkait:** `docs/awcms/04_erd_data_dictionary.md`, `docs/awcms/16_backend_data_access_integration.md`

## Konteks

Base bersifat multi-tenant. Mengandalkan filter `tenant_id` di kode aplikasi saja rapuh — satu query yang lupa memfilter dapat membocorkan data lintas-tenant. Kami butuh pertahanan berlapis (defense in depth) di level database.

## Keputusan

Kami memutuskan memakai **PostgreSQL** dengan **Row Level Security (RLS)** pada semua tabel tenant-scoped: `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy `tenant_id = current_setting('app.current_tenant_id')`. Konteks tenant di-set per transaksi via `SET LOCAL` (`set_config(..., true)`) agar aman dengan PgBouncer transaction pooling. Query tetap memfilter `tenant_id` secara eksplisit sebagai lapisan pertama; RLS adalah lapisan kedua. Koneksi aplikasi produksi memakai role **non-superuser** (superuser bypass RLS).

## Konsekuensi

- **Positif:** kebocoran lintas-tenant tercegah di level DB walau kode keliru; teruji dengan role non-superuser.
- **Trade-off:** setiap transaksi wajib men-set konteks tenant; migration wajib menambah policy; ada sedikit overhead.
- **Netral:** UUID sebagai PK, `timestamptz`, `numeric` untuk uang/kuantitas menjadi standar turunan.

## Alternatif yang dipertimbangkan

- **Isolasi hanya di aplikasi** — ditolak: satu bug = kebocoran data lintas-tenant.
- **Database per tenant** — ditolak: biaya operasional dan migrasi tinggi untuk skala base.

## Checklist: menggunakan `SECURITY DEFINER` (bootstrap read sebelum tenant context ada)

RLS + `FORCE` (di atas) menutup akses tenant-scoped biasa, tapi beberapa
query harus dijalankan **sebelum** tenant context ada sama sekali (mis.
resolusi publik `hostname`/`tenantCode` -> `tenant_id`). Contoh ilustratif
(prospektif): saat modul `tenant_domain` di-port dari `awcms-mini`, resolver
lookup-nya (mis. fungsi `awcms_resolve_tenant_domain_lookup`, Issue #559,
epic #555) akan memakai pola `SECURITY DEFINER` ini. **Catatan status:** modul
`tenant_domain` **belum di-port** ke repo ini — belum ada migrasi lookup-nya
dan **tidak ada satu pun fungsi `SECURITY DEFINER` di `sql/` saat ini**; nomor
migrasi lookup-nya nanti **TBD (bukan `033`, yang kini dipakai skema
`theming`)**. Setiap fungsi `SECURITY DEFINER` baru di repo ini wajib
memenuhi checklist berikut sebelum dianggap aman (termasuk verifikasi empiris
terhadap DB yang berjalan, bukan diasumsikan dari dokumentasi PostgreSQL
semata):

1. **Konfirmasi role pemilik benar-benar superuser (atau owner tabel yang
   dituju)** — `SELECT rolsuper FROM pg_roles WHERE rolname = '<role>'`.
   Migration di repo ini berjalan sebagai `POSTGRES_USER` (`awcms`),
   yang memang superuser sungguhan — keamanan mekanisme ini TIDAK datang
   dari interaksi RLS/`FORCE`, melainkan dari dua pagar di bawah.
2. **Body fungsi wajib SQL statis/tetap** — tidak ada dynamic SQL/string
   concatenation dari parameter. Parameter selalu lewat argumen fungsi yang
   diparameterkan (`p_<nama> text`, dst.), tidak pernah diselipkan ke query
   string secara manual.
3. **Minimalkan kolom yang di-return** — hanya kolom yang benar-benar
   dibutuhkan pemanggil; jangan pernah kolom sensitif (token/secret hash,
   PII, dll.) kecuali pemanggil memang butuh dan sudah diaudit sengaja.
4. **`REVOKE ALL ... FROM PUBLIC` lalu `GRANT EXECUTE` eksplisit** ke role
   spesifik (mis. `awcms_app`) — PostgreSQL men-grant `EXECUTE` ke
   `PUBLIC` secara default saat `CREATE FUNCTION`; ini **tidak** otomatis
   ikut tercakup oleh `ALTER DEFAULT PRIVILEGES` migration 013 (klausa itu
   hanya berlaku untuk tabel/sequence, bukan function/routine).
5. **`SET search_path = public, pg_temp`** (atau schema spesifik yang
   relevan) di definisi fungsi — mengunci resolusi nama supaya tidak bisa
   dialihkan lewat `search_path` yang dikontrol caller (defense in depth
   standar untuk `SECURITY DEFINER`, tetap dilakukan walau owner sudah
   superuser).
6. **`STABLE`/`IMMUTABLE`, bukan default `VOLATILE`**, untuk fungsi
   read-only — mencerminkan perilaku `SELECT` biasa ke query planner.
7. **Verifikasi empiris, bukan asumsi** — sebelum menganggap mekanisme ini
   aman, buktikan langsung terhadap DB yang berjalan: (a) fungsi resolve
   rows lewat role least-privilege TANPA `app.current_tenant_id` GUC
   di-set; (b) `SELECT` langsung ke tabel yang sama dari role/session yang
   sama (tanpa fungsi) tetap 0 baris; (c) kolom yang di-return persis
   sesuai yang didokumentasikan, tidak lebih. `tests/integration/public-tenant-resolution.integration.test.ts`
   adalah contoh test yang membuktikan ketiganya.
8. **Hindari timing side-channel** — kalau fungsi ini dipanggil lalu diikuti
   query kedua yang kondisional (mis. "kalau baris pertama ditemukan, query
   lagi ke tabel lain"), pertimbangkan apakah beda jumlah round-trip antar
   outcome bisa dieksploitasi sebagai side-channel — gabungkan jadi satu query
   via `JOIN` kalau tabel kedua sudah RLS-free/publicly readable, seperti
   `awcms_tenants` (pola ini akan relevan saat resolver `tenant_domain` diport).
