# ADR-0087 — MFA pindah ke principal, dan satu admin tenant kini menjangkau keluar

- **Status:** Diterima (2026-08-12).
- **Konteks:** Issue #423 Gelombang 7 PR 7.3. Migrasi `sql/114`. Perintah
  preflight baru `bun run identity:mfa-collisions:preflight`.
- **Membangun di atas:**
  [ADR-0085](0085-one-human-one-credential-many-tenants.md) (`awcms_principals`,
  dan empat kontrol yang menggantikan RLS — ADR ini memakai keempatnya lagi,
  bukan menurunkan versi yang lebih longgar),
  [ADR-0086](0086-the-lockout-counter-is-global.md) (penghitung yang dipindahkan
  wajib membawa serta setiap tuas pemulihannya), dan
  [ADR-0027](0027-mfa-totp-session-assurance-step-up.md) (MFA TOTP + step-up,
  yang skema dan enkripsinya TIDAK berubah di sini).

## Keputusan

Faktor MFA dan recovery code berhenti menjadi milik sebuah identitas per-tenant
dan menjadi milik **manusia**: `awcms_principal_mfa_factors` dan
`awcms_principal_mfa_recovery_codes`, keduanya GLOBAL dan tanpa RLS, ber-kunci
`principal_id`.

Enkripsi secret **tidak berubah** — konstruksi, kunci, dan format ciphertext
`sql/024` dipakai apa adanya. ADR ini memindahkan KEPEMILIKAN, bukan kriptografi.

### Yang TIDAK ikut pindah, dan kenapa

`awcms_mfa_challenges` dan `awcms_tenant_mfa_policies` tetap tenant-scoped di
bawah FORCE RLS.

Sebuah challenge adalah **satu percobaan login di satu tenant** — ia lahir dari
sebuah `POST /auth/login` yang membawa `x-awcms-tenant-id` dan mati saat sesi di
tenant itu terbit. Menjadikannya global akan membuat challenge yang diterbitkan
tenant A bisa ditukar menjadi sesi di tenant B, yaitu persis bentuk serangan yang
PR 7.4 nanti larang untuk principal token.

Sebuah policy adalah **keputusan produk sebuah tenant**. Faktornya global, tetapi
KEWAJIBANNYA lokal: tenant B boleh menuntut MFA meski tenant A tidak, dan orang
yang sama memakai satu authenticator untuk memenuhi keduanya. Menjadikan policy
global akan memberi satu tenant kuasa memaksa kebijakan keamanan tenant lain.

> Faktornya milik manusia; kewajibannya milik tenant.

## Konsekuensi yang wajib dinyatakan: reset admin kini menjangkau keluar tenant

Reset MFA administratif oleh admin tenant A kini **global** — ia menonaktifkan
authenticator yang sama yang dipakai orang itu di tenant B.

Ini **satu-satunya tempat di seluruh repo tempat tindakan admin tenant
menjangkau keluar tenantnya**, dan karena itu ia diperlakukan sebagai
pengecualian yang disengaja, bukan efek samping:

1. **Ber-permission** — tetap `identity_access.mfa_admin.reset`, default-deny,
   plus step-up (ADR-0027 F3). Tidak ada permission baru.
2. **Tercatat sebagai jangkauan, bukan sebagai daftar.** Baris audit
   `mfa_admin_reset` di tenant yang bertindak (severity `critical`, `reason`
   wajib) membawa `crossTenantReach: true` ketika sebuah faktor benar-benar
   dicabut. Ia menyatakan bahwa tindakan itu keluar dari tenant, tanpa menyebut
   keluar ke mana.
3. **Jejaknya menempel pada barisnya, bukan pada log tenant lain.**
   `awcms_principal_mfa_factors.disabled_by_tenant_id` mencatat tenant yang
   memerintahkan reset (NULL bila tak ada yang memerintahkan: `disable`
   self-service, atau faktor yang distandown backfill `sql/114`). Baris itu GLOBAL,
   jadi ia bertahan di sisi manusia yang kehilangan faktornya — tempat satu-satunya
   yang bisa menjawab "kenapa MFA saya hilang" tanpa satu tenant menulis ke log
   tenant lain.

### Rencana meminta baris audit di SETIAP tenant. Itu tidak bisa dibangun, dan penolakannya adalah temuan

Rencana Gelombang 7 menuliskan "diaudit di log kedua tenant". Edisi pertama ADR
ini menyalinnya, dengan kalimat percaya diri bahwa penulisan lintas-tenant "tidak
melanggar RLS karena melewati port audit, satu panggilan per tenant". **Basis
data membantahnya**, dan itu ketahuan dengan memeriksa policy alih-alih
mempercayai rencana:

- `awcms_identities` FORCE RLS dengan
  `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`, jadi
  `WHERE principal_id = … AND tenant_id <> …` mengembalikan **nol baris
  selamanya**. Kode yang mengenumerasi tenant terjangkau akan hijau di setiap
  gerbang dan diam-diam tidak pernah menemukan apa pun.
- `awcms_audit_events` FORCE RLS dengan policy yang sama dan tanpa `WITH CHECK`
  terpisah — sehingga `INSERT` ber-`tenant_id` lain ditolak policy, bukan
  diterima.

Jadi kewajiban itu hanya bisa dipenuhi dengan mencabut properti yang membuat
repo ini layak dipercaya: `SECURITY DEFINER` lintas-tenant (yang ADR-0086 sudah
tolak untuk kerabat masalah ini) atau toggle `NO FORCE` saat request.

**Dan seandainya bisa pun, ia tidak seharusnya.** Mengenumerasi tenant lain
tempat sebuah alamat punya identitas adalah **oracle keanggotaan lintas-tenant**:
admin tenant A yang memegang `mfa_admin.reset` akan belajar di mana lagi seorang
manusia bekerja, dari sebuah endpoint yang tugasnya memulihkan orang. Kewajiban
"catat jangkauannya" karena itu dipenuhi dengan menyatakan BAHWA ia menjangkau
keluar, plus jejak pada baris global — bukan dengan daftar yang tidak boleh
dimiliki siapa pun.

## Lockout per-faktor ikut menjadi global, dengan tuas pemulihannya

`failed_verify_count`/`locked_until` menempel pada faktor, jadi memindahkan
faktor memindahkan lockout — konsekuensi yang sama yang ADR-0086 ambil untuk
password, diambil sadar di sini juga: penyerang yang tahu password seseorang bisa
mengunci authenticator orang itu di **semua** tenant sekaligus.

Aturan ADR-0086 berlaku penuh: **trade-off itu hanya boleh diambil bersama tuas
pemulihannya, di PR yang sama.** Tuasnya ada tiga dan ketiganya kini juga global:
recovery code, self-service `disable` + enroll ulang, dan reset administratif.
Sebelum ADR ini, lockout faktor di tenant A tidak bisa dibatalkan oleh admin
tenant B; sesudahnya, siapa pun dari ketiga jalur itu memulihkan orangnya
sepenuhnya. Pemulihannya lebih baik dari sebelumnya, bukan lebih buruk.

## Backfill: pertahankan authenticator yang benar-benar ada di tangan orangnya

`awcms_identity_mfa_factors` unik pada `(tenant_id, identity_id, factor_type)`
selama status ≠ `disabled`, jadi satu manusia yang ter-enroll di N tenant memiliki
N secret BERBEDA. Setelah faktor ber-kunci principal, hanya satu yang boleh aktif.

Baris yang dipertahankan dipilih `ORDER BY last_used_step DESC, activated_at DESC`
— **bukan** yang terbaru dibuat. `last_used_step` adalah nomor langkah TOTP dan
karena itu sebanding lintas faktor: yang tertinggi adalah authenticator yang
paling belakangan benar-benar dipakai, yaitu yang ada di ponsel yang orang itu
masih pegang. Memilih `activated_at` tertinggi akan memilih enrolment
terbaru — yang bisa saja dilakukan di ponsel yang sejak itu hilang, dan itu
mengunci orangnya. Sisanya menjadi `disabled` ber-`disabled_at`, tidak dihapus.

Ini penerapan aturan ADR-0086 yang sama: **migrasi tidak boleh melemahkan kontrol
yang dipindahkannya**, dan di sana jawabannya `MAX()` karena `0` akan melepaskan
lockout yang sedang berlaku. Di sini jawabannya "terakhir dipakai" karena
"terbaru dibuat" akan melepaskan orang dari authenticator-nya.

**Migrasi TIDAK menolak jalan pada tabrakan.** Ia berbeda dari `sql/112`, yang
`RAISE EXCEPTION` pada email bertabrakan, dan perbedaannya prinsipil: dua alamat
yang berbeda hanya pada huruf besar-kecil adalah **kemungkinan dua orang**, dan
menggabungkannya tak bisa dibatalkan. Dua faktor TOTP di dua tenant adalah **satu
orang dalam keadaan yang sah**, yang dibuat produk ini sendiri — memblokir deploy
untuk keadaan normal adalah gerbang yang salah. Yang dipakai sebagai gantinya:
`bun run identity:mfa-collisions:preflight` melaporkan setiap principal
ber-faktor lebih dari satu **sebelum** jendela deploy, sehingga keputusan
"siapa kehilangan apa" bisa dilihat, bukan ditemukan.

Tabel lama dipertahankan terisi sebagai sejarah (preseden
[ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md)), dan
`RETIRED_TENANT_TABLE_PRIVILEGES` menurunkan haknya ke `SELECT` saja.

## Empat kontrol yang menggantikan RLS, dipakai ulang utuh

Kedua tabel baru mewarisi kontrak ADR-0085 tanpa pelonggaran:

| #   | Kontrol                                                              | Ditegakkan oleh                                                  |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Hak dipersempit — `SELECT, INSERT, UPDATE, DELETE`, tanpa `TRUNCATE` | `sql/114` + `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` + suite DB-gated |
| 2   | Invarian bentuk-baca, per-call-site                                  | `bun run identity:principal-access:check` (kini multi-tabel)     |
| 3   | `secret_ciphertext` tidak pernah meninggalkan modul store            | tipe `PrincipalFactor` + test                                    |
| 4   | Batas otorisasi tidak bergerak                                       | test yang menolak setiap nama tabel otorisasi di dalam store     |

Satu perbedaan disengaja terhadap `awcms_principals`: **`DELETE` diizinkan di
sini.** Alasan ADR-0085 menahannya adalah bahwa principal adalah sandaran login
seorang manusia dan pemulihan dari baris yang salah terhapus adalah restore.
Recovery code justru sebaliknya — menghapusnya adalah operasi normal yang sudah
dilakukan `disable`, `regenerate`, dan reset admin sejak ADR-0027, dan baris yang
hilang berarti "kode itu tidak berlaku", bukan "orang ini tidak bisa login".

Kontrol 2 diperluas dari satu tabel menjadi tiga. Gerbangnya dulu memakai satu
konstanta `TABLE`; ia kini beriterasi atas daftar tabel principal, masing-masing
dengan allow-list berkasnya sendiri — supaya `principal-mfa-store.ts` tidak
diberi izin menyentuh kredensial, dan `principal-store.ts` tidak diberi izin
menyentuh faktor.

## DITOLAK

- **Mengizinkan BANYAK faktor aktif per principal** (mencabut batasan
  faktor-tunggal supaya nol orang kehilangan apa pun saat backfill). Ia melemahkan
  kontrol yang sedang dipindahkan: satu tebakan kode akan diuji terhadap N secret
  sekaligus, sehingga peluang cocok naik ~N kali, dan `failed_verify_count`
  tersebar di N baris sehingga lockout per-faktor berhenti mengikat.
- **Migrasi yang `RAISE EXCEPTION` pada tabrakan.** Lihat di atas: memblokir
  deploy untuk keadaan yang sah.
- **Memindahkan `awcms_mfa_challenges` ke principal.** Challenge global bisa
  ditukar menjadi sesi di tenant yang bukan penerbitnya.
- **Memindahkan `awcms_tenant_mfa_policies` ke principal.** Memberi satu tenant
  kuasa atas postur keamanan tenant lain.
- **Baris audit di setiap tenant terjangkau** (yang rencananya minta). Mustahil
  di bawah FORCE RLS tanpa `SECURITY DEFINER` atau toggle `NO FORCE` saat
  request, dan daftar tenantnya sendiri adalah oracle keanggotaan lintas-tenant.
  Lihat bagian di atas.
- **Menonaktifkan diam-diam faktor yang kalah saat backfill tanpa preflight.**
  Kehilangan authenticator yang tidak bisa dilihat sebelum terjadi adalah insiden
  dukungan, bukan migrasi.
