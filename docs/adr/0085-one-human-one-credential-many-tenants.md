# ADR-0085 — Satu manusia, satu kredensial, banyak tenant

- **Status:** Diterima (2026-08-12).
- **Konteks:** Issue #423 Gelombang 7 PR 7.1, dan prasyarat penutupan
  [#430](https://github.com/ahliweb/awcms/issues/430). Migrasi `sql/112`. Gerbang
  baru `identity:principal-access:check` (rantai 40 → 41).
- **Membangun di atas:**
  [ADR-0003](0003-postgresql-rls-multi-tenant.md) (isolasi tenant lewat RLS — dan
  batasnya, yang ADR ini justru berdiri di luarnya),
  [ADR-0049](0049-machine-credentials-and-session-introspection.md) (jenis bearer
  dibawa oleh namespace hash-nya), dan
  [ADR-0053](0053-platform-scoped-permissions.md) (dua mekanisme independen,
  supaya satu baris yang bocor tidak cukup).

## Keputusan

`awcms_principals` — GLOBAL, tanpa RLS, satu baris per manusia, ber-kunci alamat
email ter-normalisasi. `awcms_identities` mempertahankan setiap baris, setiap
`id`, dan kedelapan foreign key masuknya **persis di tempatnya**; ia hanya
mendapat satu kolom `principal_id` yang nullable.

Ini **penurunan makna, bukan pemindahan data.** Tidak ada satu pun foreign key
yang bergerak, dan `resolveTenantContext` maupun `authorizeInTransaction` tidak
pernah tahu principal itu ada.

Gelombang ini menaikkan otoritas **satu PR sekali**: PR 7.1 membuat barisnya, PR
7.2 memindahkan login (dan **menutup #430**), PR 7.3 memindahkan MFA, PR 7.4
menambahkan pemilihan dan perpindahan tenant.

## Kalimat yang membuat ketiadaan RLS bisa dipertahankan

> **Principal adalah fakta AUTENTIKASI, tidak pernah fakta OTORISASI.**

Kalimat itu wajib verbatim di sini karena ia yang membedakan tabel ini dari
setiap tabel lain yang RLS-nya bukan pilihan. Memegang principal **tidak memberi
apa pun**: setiap permission tetap di-resolve lewat `awcms_tenant_users` di bawah
FORCE RLS, lewat chokepoint yang sama seperti kemarin.

`awcms_permissions` adalah preseden tabel global — tetapi ia katalog yang tidak
memberi apa pun hanya karena ada. Tabel kredensial bukan itu. Karena itu **empat
kontrol menggantikan RLS**, dan keempatnya ditegakkan, bukan dijanjikan:

| #   | Kontrol                                                                                           | Ditegakkan oleh                                                  |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Hak basis data dipersempit — `REVOKE ALL`, lalu `SELECT, INSERT, UPDATE`, **tidak pernah DELETE** | `sql/112` + `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` + suite DB-gated |
| 2   | Invarian bentuk-baca                                                                              | `bun run identity:principal-access:check`                        |
| 3   | `password_hash` tidak pernah meninggalkan modul store                                             | tipe `PrincipalIdentity` + `tests/principal-store.test.ts`       |
| 4   | Batas otorisasi tidak berubah                                                                     | test yang menolak setiap nama tabel otorisasi di dalam store     |

### Kenapa DELETE ditahan permanen

Bukan kerapian. Principal adalah objek yang menjadi sandaran login seorang
manusia **di seluruh tenant sekaligus**. Runtime tidak punya operasi yang
seharusnya menghapus satu, dan pemulihan dari baris yang salah terhapus adalah
**restore**, bukan INSERT — setiap `awcms_identities.principal_id` yang
menunjuknya harus diturunkan ulang. UPDATE dipertahankan karena PR 7.2
mempromosikan kredensial ke dalamnya.

### Kontrol 2 membatasi CALL SITE, bukan ROW

Ini rumusan yang perlu dipegang: **RLS membatasi BARIS yang boleh dilihat sebuah
query; gerbang ini membatasi CALL SITE yang boleh mengeluarkan query sama
sekali.** Hanya berkas dalam allow-list boleh menyebutnya, dan setiap query di
sana wajib berkunci `id =` atau `email_normalized =` — tidak pernah scan
tak-berbatas, tidak pernah `LIKE`, tidak pernah `LIMIT`/`OFFSET`. Tabel
kredensial yang bisa dipindai adalah endpoint enumerasi yang tinggal satu
refactor lagi, dan tidak ada policy RLS di sana untuk memotong hasilnya.

## Kenapa backfill-nya aman: ia tidak memindahkan satu rahasia pun

`password_hash` dibiarkan **NULL** pada setiap principal. Kredensial
**DIPROMOSIKAN** saat login sukses pertama (PR 7.2): password diverifikasi
terhadap hash IDENTITAS persis seperti hari ini, dan baru kemudian ditulis ke
principal.

Sampai itu terjadi, principal adalah cangkang kosong yang tidak mengautentikasi
apa pun — sehingga backfill yang salah **tidak bisa mengunci siapa pun**, karena
baris identitas masih satu-satunya kredensial yang berlaku. Itulah yang
membedakan migrasi ini dari setiap migrasi kredensial yang pernah menakutkan.

## Migrasi ini MENOLAK berjalan pada basis data yang bertabrakan

`awcms_identities` UNIQUE pada `(tenant_id, login_identifier)`, jadi `A@x.com`
dan `a@x.com` adalah dua baris sah hari ini dan satu principal sesudahnya.
Menggabungkannya tidak pernah berupa patch — ia percakapan dengan pelanggan
tentang baris mana yang orangnya dan mana duplikat.

`sql/112` karena itu `RAISE EXCEPTION` alih-alih menebak.
`bun run identity:principals:preflight` (#440) menjawab pertanyaan yang sama
secara read-only dan berbulan-bulan lebih awal — itulah seluruh alasan ia
dibangun sebelum berkas ini. **Menabrak exception itu di jendela deploy berarti
sensusnya tidak dijalankan.**

Satu detail urutan di dalamnya layak dicatat karena kegagalannya senyap: toggle
`NO FORCE` harus mendahului cek tabrakan. `awcms_identities` FORCE RLS dan
policy-nya membaca `current_setting('app.current_tenant_id')`; hitungan
lintas-tenant yang dikeluarkan sebelum toggle akan melihat **nol baris** dan
selalu lulus. Cek yang hanya bisa melihat nol adalah cek yang selalu lulus.

## Yang DITOLAK

1. **Memindahkan `password_hash` ke principal di dalam migrasi.** Backfill yang
   memindahkan rahasia adalah backfill yang mode gagalnya "kredensial ada di dua
   tempat". Promosi saat pakai pertama menghapus seluruh kelas itu.
2. **`principal_id` NOT NULL.** Identitas yang dibuat penulis yang belum diajari
   tentang principal harus **terlihat tak-tertaut**, bukan menjadi 500. Sebuah
   pass berikutnya bisa menemukan dan memperbaikinya; sebuah 500 hanya bisa
   dilaporkan pengguna.
3. **Normalisasi yang lebih pintar** — pembuangan titik, penghapusan `+tag`,
   Unicode folding. Masing-masing menggabungkan alamat yang di sebagian penyedia
   adalah orang yang berbeda, dan penggabungan tidak bisa dibatalkan dengan cara
   yang laporan tabrakan bisa.
4. **DELETE untuk `awcms_app`** — §"Kenapa DELETE ditahan permanen".
5. **Hak apa pun untuk `awcms_worker`.** Tidak ada job terjadwal yang membaca
   atau menulis kredensial.
6. **Menempatkan pembacaan principal di luar modul store "karena praktis".**
   Itulah yang dilarang kontrol 2, dan gerbangnya menolak sebelum review sempat.

## Konsekuensi

- Rantai `bun run check` menjadi **41 segmen**.
- `awcms_principals` wajib hadir DUA KALI — di
  `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` dan di peta hak `security-readiness.ts` —
  atau `tests/repo-inventory.test.ts` memerah dari dua sisi.
- `BOUNDED_BY_DESIGN` naik 10 → 11, dengan argumen yang **berbeda jenis** dari
  sepuluh sebelumnya: bukan "ditulis manusia" melainkan **diturunkan** —
  populasinya proyeksi dari `awcms_identities`, jadi ia tak bisa tumbuh lebih
  cepat dari tabel yang sudah ada di ledger warisan, dan selalu lebih kecil.
- **#430 belum ditutup oleh PR ini.** Penghitung lockout masih per-`(tenant,
email)`; PR 7.2 yang memindahkannya, dengan test regresi yang merotasi header
  tenant dan menuntut penghitungnya TIDAK ter-reset.
