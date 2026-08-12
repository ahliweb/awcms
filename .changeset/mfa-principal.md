---
"awcms": minor
---

feat(auth): MFA pindah ke principal — satu manusia, satu authenticator (ADR-0087, #423)

Gelombang 7 PR 7.3, `sql/114`. Faktor MFA dan recovery code berhenti menjadi milik
identitas per-tenant dan menjadi milik MANUSIA: `awcms_principal_mfa_factors` dan
`awcms_principal_mfa_recovery_codes`, GLOBAL tanpa RLS, ber-kunci `principal_id`.
Enkripsi `sql/024` dipakai apa adanya — yang pindah KEPEMILIKAN, bukan kriptografi.
Permukaan HTTP tidak berubah satu berkas pun: seam-nya ada di `application/mfa.ts`,
yang tetap ber-parameter `(tenantId, identityId)` karena Anda bertindak sebagai
anggota sebuah tenant; hanya penyimpanannya yang global.

YANG SENGAJA TIDAK IKUT PINDAH, dan alasannya bukan kehati-hatian melainkan
serangan yang konkret. `awcms_mfa_challenges` tetap tenant-scoped karena challenge
global bisa ditukar menjadi sesi di tenant yang bukan penerbitnya — persis yang
PR 7.4 harus larang. `awcms_tenant_mfa_policies` tetap tenant-scoped karena policy
global memberi satu tenant kuasa atas postur keamanan tenant lain. Faktornya milik
manusia; kewajibannya milik tenant.

RENCANANYA MEMINTA BARIS AUDIT DI SETIAP TENANT TERJANGKAU, DAN PENOLAKANNYA ADALAH
TEMUAN PR INI. Edisi pertama ADR-0087 menyalin rencana itu dengan kalimat percaya
diri bahwa penulisan lintas-tenant "tidak melanggar RLS karena melewati port audit".
Basis data membantahnya: `awcms_identities` FORCE RLS, jadi
`WHERE principal_id = … AND tenant_id <> …` mengembalikan NOL BARIS SELAMANYA —
kode yang mengenumerasi tenant terjangkau akan hijau di 41 gerbang dan diam-diam
tidak pernah menemukan apa pun — dan `awcms_audit_events` menolak INSERT
ber-`tenant_id` lain. Satu-satunya jalan adalah `SECURITY DEFINER` lintas-tenant
(yang ADR-0086 sudah tolak untuk kerabat masalah ini) atau toggle `NO FORCE` saat
request. DAN SEANDAINYA BISA PUN IA TIDAK SEHARUSNYA: daftar tenant lain tempat
sebuah alamat punya identitas adalah ORACLE KEANGGOTAAN LINTAS-TENANT, diserahkan
kepada pemegang `mfa_admin.reset` lewat endpoint yang tugasnya memulihkan orang.
Penggantinya menyatakan JANGKAUAN, bukan DAFTAR: `crossTenantReach: true` pada baris
audit `critical` tenant yang bertindak, plus `disabled_by_tenant_id` pada baris
faktor yang GLOBAL — satu-satunya jejak yang bertahan di sisi manusia yang
kehilangan faktornya, dan satu-satunya yang bisa menjawab "kenapa MFA saya hilang".

KONSEKUENSI YANG DINYATAKAN, BUKAN DISEMBUNYIKAN: reset administratif oleh admin
tenant A kini mencabut authenticator yang dipakai orang itu di tenant B. Ini
SATU-SATUNYA tempat di repo tempat tindakan admin tenant mengubah state yang
disandari tenant lain, dan ia diperlakukan sebagai pengecualian yang disengaja —
tetap `identity_access.mfa_admin.reset` (tanpa permission baru), tetap step-up
segar, tetap `reason` wajib, tetap audit `critical`.

LOCKOUT PER-FAKTOR IKUT MENJADI GLOBAL, dengan ketiga tuas pemulihannya di PR yang
sama seperti yang ADR-0086 tuntut: recovery code, `disable` mandiri + enroll ulang,
dan reset administratif. Sebelumnya lockout faktor di tenant A tidak bisa dibatalkan
admin tenant B; sesudahnya pemulihannya justru lebih baik dari sebelumnya.

BACKFILL MEMPERTAHANKAN AUTHENTICATOR YANG BENAR-BENAR ADA DI TANGAN ORANGNYA:
`ORDER BY last_used_step DESC, activated_at DESC` — nomor langkah TOTP sebanding
lintas faktor, jadi yang tertinggi adalah aplikasi di ponsel yang orang itu masih
pegang. "Terbaru dibuat" akan memilih enrolment di perangkat yang sejak itu hilang.
Migrasi TIDAK menolak jalan pada tabrakan (berbeda dari `sql/112`): dua faktor di
dua tenant adalah satu orang dalam keadaan yang dibuat produk ini sendiri, dan
memblokir deploy untuk keadaan yang sah adalah gerbang yang salah sasaran. Yang
dipakai sebagai gantinya perintah baru `bun run identity:mfa-collisions:preflight`,
yang melaporkan setiap manusia terdampak SEBELUM jendela deploy — plus satu kelas
temuan yang tidak diminta rencana: faktor hidup pada identitas TANPA principal,
yang tidak ikut pindah sama sekali dan karena itu memblokir.

GERBANG `identity:principal-access:check` KINI MENJAGA TIGA TABEL DENGAN ALLOW-LIST
TERPISAH PER TABEL, bukan satu daftar gabungan — supaya `principal-mfa-store.ts`
tidak diberi izin membaca `password_hash` dan `principal-store.ts` tidak diberi izin
menyentuh faktor. Satu daftar gabungan akan menjadikan "modul identity-access"
sebagai batasnya, yang bukan batas sama sekali. Empat mutasi nyata memerahkannya.

Tabel `awcms_identity_mfa_*` lama dipertahankan TERISI sebagai sejarah (preseden
ADR-0079) dan diturunkan ke `SELECT` lewat `RETIRED_TENANT_TABLE_PRIVILEGES` —
penurunan hak itu yang membuat supersession-nya nyata: tabel faktor lama yang masih
bisa DITULIS adalah tempat kedua untuk meng-enroll, dan satu manusia dengan dua
faktor kedua yang hanya salah satunya diperiksa login lebih buruk dari salah satu
tabel saja.

`BOUNDED_BY_DESIGN` 11 → 13, dan raise-nya menjawab bar yang dipasang raise
sebelumnya: argumennya bukan AUTHORSHIP (entri 1–10) maupun DERIVASI (entri 11)
melainkan SKEMA — index unik parsial `(principal_id, factor_type) WHERE status <>
'disabled'` membuat basis data MENOLAK baris hidup kedua untuk seorang manusia,
siapa pun penulisnya.

DUA SENSUS PREFLIGHT DIPERBAIKI, DAN CACATNYA HANYA TERLIHAT KARENA DIJALANKAN.
Keduanya mengulang tenant di dalam `withTenantOrThrow` lalu bersandar pada RLS
untuk memotong barisnya. Superuser dan role migrasi MELEWATI RLS sepenuhnya, dan
menjalankan skrip ops sebagai owner adalah setup lumrah — jadi setiap iterasi
membaca seluruh instalasi dan menandainya dengan tenant yang sedang giliran.
Sensus MFA yang baru melipatgandakan hitungannya (dua faktor di-seed dilaporkan
empat, dengan tenant yang salah). Yang lebih buruk sensus principal PR 7.1 yang
sudah mendarat: satu manusia yang sah bekerja di dua tenant dilaporkan sebagai
DUA tabrakan MEMBLOKIR — menyuruh operator memutuskan akun NYATA mana yang
duplikat, persis pada kasus yang menjadi alasan principal ada. Keduanya kini
ber-predikat `tenant_id` eksplisit; regresinya berbasis source karena
perilakunya menuntut dua tenant dan koneksi owner yang tak dimiliki suite
default, dan test yang skip bukan regression test.
