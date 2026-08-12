---
"awcms": minor
---

feat(auth): penghitung lockout menjadi GLOBAL — menutup #430 (ADR-0086, #423)

Gelombang 7 PR 7.2. Penghitung pindah dari `awcms_identities` (UNIQUE per
`(tenant_id, login_identifier)`) ke `awcms_principals`, yang punya tepat satu
baris per manusia dan tak punya kolom tenant untuk dirotasi.

Merotasi `x-awcms-tenant-id` kini memilih identitas berbeda tetapi principal yang
SAMA. Properti yang menutup temuan itu: baris yang di-increment wajib dipilih
oleh sesuatu yang tidak bisa divariasikan penyerang.

LIMA jalur pemulihan ikut pindah di PR yang sama — login sukses, reset password,
ganti password, SSO callback, dan verifikasi enrolment MFA. Dua terakhir
ditemukan dengan grep: keduanya hanya membersihkan salinan tenant-scoped,
sehingga orang yang terkunci akan masuk lewat IdP dengan sukses dan TETAP
TERKUNCI di jalur password. Lockout global dengan reset per-tenant bukan setengah
perbaikan melainkan lebih buruk dari yang digantikannya.

Backfill mengambil `MAX()`: mengambil `0` akan melepaskan setiap lockout yang
sedang berlaku pada saat deploy.
