# ADR-0086 — Penghitung lockout menjadi GLOBAL

- **Status:** Diterima (2026-08-12).
- **Konteks:** Issue #423 Gelombang 7 PR 7.2. **Menutup
  [#430](https://github.com/ahliweb/awcms/issues/430).** Migrasi `sql/113`.
- **Membangun di atas:**
  [ADR-0085](0085-one-human-one-credential-many-tenants.md) (`awcms_principals`,
  tanpanya temuan ini tidak punya tempat untuk diperbaiki),
  [ADR-0066](0066-shared-rate-limiting-and-full-auth-surface-coverage.md) (rate
  limit bersama yang sengaja fail-open — dan bersandar pada lockout sisi basis
  data justru karena ia TIDAK fail-open), dan
  [ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md) (kolom
  lama menjadi sejarah, bukan dihapus).

## Keputusan

`awcms_identities.failed_login_count`/`locked_until` berhenti memutuskan apa pun.
Penghitungnya pindah ke `awcms_principals`, yang punya tepat satu baris per
manusia dan **tidak punya kolom tenant untuk dirotasi**.

## Kenapa ini menutup #430

`awcms_identities` UNIQUE pada `(tenant_id, login_identifier)`, jadi satu manusia
anggota N tenant punya N penghitung. `POST /api/v1/auth/login` menuntut
`x-awcms-tenant-id` di muka, dan nilainya bukan rahasia — halaman `/login`
menerbitkan pemilih tenant.

Rotasi header itu karena itu memilih baris identitas yang berbeda, dan setiap
baris membawa penghitungnya sendiri. Setelah ADR ini, rotasi yang sama memilih
identitas berbeda tetapi **principal yang SAMA** — dan principal-lah yang
di-increment.

Properti yang sebenarnya menutup temuan ini bisa dinyatakan dalam satu kalimat:
**baris yang di-increment jalur login wajib dipilih oleh sesuatu yang tidak bisa
divariasikan penyerang.**

## Kenapa test regresinya berbasis SOURCE

Test perilaku menuntut basis data, sementara suite default berjalan tanpa satu —
sehingga asersi yang paling penting hanya akan hidup di workflow DB-gated. Lebih
buruk: test perilaku LULUS DENGAN ALASAN YANG SALAH begitu penghitungnya diam-diam
jatuh kembali ke identitas. Lima kegagalan dalam satu tenant tetap mengunci; kasus
rotasinya justru yang tak seorang pun menulis.

`tests/global-lockout-regression.test.ts` karena itu menegakkan bentuk
strukturalnya, dan dibuktikan dengan **mengembalikan cacat #430 yang asli** —
mutasi itu memerahkannya.

## Yang paling mudah salah, dan sudah pernah menggigit repo ini

Memindahkan PENULIS tanpa memindahkan PEMBACANYA. Lockout GLOBAL dengan reset
PER-TENANT bukan setengah perbaikan — ia **lebih buruk daripada yang
digantikannya**: penyerang yang mengunci `alice@corp.com` dari semua tenant tidak
bisa dibatalkan oleh tautan reset yang baru saja dikirimkan kepadanya.

Empat jalur wajib ikut pindah, dan **dua di antaranya ditemukan dengan grep, bukan
dengan penalaran**:

| Jalur                        | Kewajiban                                                             |
| ---------------------------- | --------------------------------------------------------------------- |
| `/auth/login` sukses         | bersihkan penghitung global                                           |
| reset password               | ganti kredensial principal + bersihkan                                |
| ganti password               | sama                                                                  |
| **SSO callback**             | bersihkan — membuktikan identitas lewat IdP adalah autentikasi sukses |
| **verifikasi enrolment MFA** | sama                                                                  |

Dua yang terakhir sebelumnya hanya membersihkan salinan tenant-scoped. Tanpa
perbaikan, orang yang terkunci oleh percobaan password akan masuk lewat IdP
dengan sukses **dan tetap terkunci** di jalur password, sementara tuas yang dulu
melepaskannya sudah tidak memutuskan apa pun.

## Trade-off yang diambil dengan sadar: DoS lockout

Penghitung global berarti penyerang yang tahu sebuah alamat bisa mengunci
korbannya dari **semua** tenant, bukan satu. Itu memperbesar blast radius, dan
issue-nya menuntut trade-off ini diambil BERSAMA tuas pemulihannya — bukan
sesudahnya.

Karena itu kelima jalur pemulihan di tabel atas mendarat **di PR yang sama**.
Reset password lewat surat tetap bekerja, dan kini bekerja **lintas tenant
sekaligus**, yang justru merupakan pemulihan yang lebih baik daripada sebelumnya.

Yang DITOLAK sebagai mitigasi sementara sebelum gelombang ini: penghitung global
berbasis Redis (ia fail-open justru saat dibutuhkan, dan `checkSharedRateLimit`
sendiri fail-open), dan fungsi `SECURITY DEFINER` yang mengagregasi lintas tenant
(ia membawa DoS yang sama tanpa satu pun tuas pemulihannya).

## Migrasi tidak boleh melemahkan kontrol yang dipindahkannya

Backfill mengambil `MAX(failed_login_count)` dan `MAX(locked_until)` lintas
identitas milik principal itu. Mengambil `0` — atau penghitung baris mana pun
yang kebetulan terurut pertama — akan **melepaskan setiap lockout yang sedang
berlaku** pada saat deploy. `MAX` adalah satu-satunya agregat yang tidak bisa
melemahkan kontrol yang sedang dimigrasikannya.

Kolom identitas DIBIARKAN di tempatnya dan tetap terisi — sejarah, preseden
ADR-0079. Menghapusnya di migrasi yang sama yang berhenti membacanya akan
memusnahkan satu-satunya bukti tentang apa yang dipegang penghitung per-tenant.

## Konsekuensi

- **#430 ditutup.**
- Increment tetap dihitung DI-DB, bukan read-modify-write — cacat Issue #483
  diwarisi sebagai perbaikan, bukan diulang sebagai kesalahan baru.
- Kredensial dipromosikan ke principal saat login sukses pertama, satu login pada
  satu waktu, alih-alih dalam satu jendela migrasi.
- Reset dan ganti password kini mengubah kredensial **di semua tenant** — itulah
  arti "satu manusia, satu kredensial", dan surat resetnya perlu mengatakannya.
- PR 7.3 memindahkan MFA; PR 7.4 menambahkan pemilihan dan perpindahan tenant.
