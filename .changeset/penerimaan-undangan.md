---
"awcms": minor
---

feat(auth): undangan diterima, dan keanggotaan lahir di satu fungsi (ADR-0082, #423)

Gelombang 4 PR 4.2, penutup gelombang. Dua endpoint publik —
`GET /api/v1/auth/invitations/{token}` (preview) dan
`POST /api/v1/auth/invitations/{token}/accept` — plus halaman
`/accept-invitation`.

**`materializeMembership()` sengaja SATU fungsi dengan SATU pemanggil.** Sudah
ada tiga tempat yang melahirkan keanggotaan di repo ini
(`approveRegistrationRequest`, `jitProvisionIdentity`, `bootstrapPlatformTenant`),
dan ketiganya pernah menyimpang sekali pada detail yang paling penting
(`verification_status`). Yang keempat ini ditulis sebagai satu fungsi supaya
Gelombang 7 punya persis satu tempat untuk diarahkan ulang saat identity menjadi
principal global. Mengarahkan ulang ketiganya SEKARANG akan menjadikan PR ini
refactor self-registration dan SSO sekaligus — dan memerahkan
`tests/access-assignment-writers.test.ts`, yang menyebut `self-registration.ts`
sebagai pemanggil langsung `grantRolePolicy` di asersi non-hampanya.

**Penolakan `is_system` diperiksa kedua kalinya di sini**, bukan seremonial:
sebuah peran bisa ditandai system, di-soft-delete, atau keluar dari katalog di
antara saat undangan dikirim dan saat ia diterima. Test integrasi mengubah peran
itu di antara kedua momen dan menuntut penerimaannya ditolak — plus bahwa TIDAK
ADA akun setengah jadi yang tertinggal.

**Penerimaan tidak menerbitkan sesi.** Undangan yang mencetak sesi akan
melangkahi kebijakan MFA tenant (`required_for_all` akan menghasilkan anggota
ber-sesi penuh tanpa faktor kedua), melangkahi
`isPasswordLoginDisabledForIdentity` pada tenant SSO-only, dan melangkahi rate
limit login. Undangan mencetak AKUN; siapa yang boleh memegang sesi adalah
keputusan `/login`.

**Kedaluwarsa dijawab 404, bukan 410.** Tak dikenal, tercabut, sudah diterima,
kedaluwarsa, dan milik tenant lain semuanya menjawab identik. Preview
mengembalikan nama tenant dan nama pengundang, dan **tidak pernah** alamatnya.

**Satu cacat PR 4.1 diperbaiki di sini, ditemukan saat menulis halamannya:**
`buildInvitationUrl` hanya memuat `?token=`, sementara kedua endpoint publiknya
menuntut header `X-AWCMS-Tenant-ID` — jadi tautannya menghasilkan halaman yang
tak bisa melakukan panggilan yang menjadi alasan keberadaannya. Kini ia membawa
tenant juga, disegel AES-256-GCM jadi satu `?p=` bila
`AUTH_URL_PARAM_ENCRYPTION_KEY` diset, persis seperti tautan reset password.

Ledger `tests/shared-rate-limit.test.ts` naik **11 → 13** dan
`tests/auth-source-rate-limit.test.ts` **7 → 9**; prosa ADR-0066 §C yang menulis
"sebelas" diberi catatan pembaruan alih-alih dibiarkan menua sendirian — angka
itu hidup di berkas test, bukan di `scripts/`, jadi ia yang paling mudah
terlupa.

Diverifikasi terhadap PostgreSQL nyata: 16 test integrasi baru lulus, dan kunci
barisnya dibuktikan load-bearing — menghapus `FOR UPDATE OF i` membuat penerimaan
kedua MELEMPAR (tabrakan 23505 di tengah transaksi, yaitu 500 bagi orang yang
menekan tombol dua kali) alih-alih ditolak bersih.
