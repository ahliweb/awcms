---
"awcms": patch
---

fix(auth): penghitung lockout login dinaikkan di dalam SQL — K percobaan paralel berhenti berbiaya satu increment

Jalur login password menaikkan `awcms_identities.failed_login_count` dengan
**read-modify-write di JavaScript**: `SELECT` tanpa `FOR UPDATE`, `+1` di
`evaluateLoginAttempt`, lalu `UPDATE … SET failed_login_count = <nilai JS>`.
Transaksinya READ COMMITTED, jadi dua kegagalan berbarengan sama-sama membaca
`N` dan sama-sama menulis `N+1`.

**Diukur terhadap PostgreSQL nyata: empat percobaan gagal paralel meninggalkan
penghitung di `1`.** Penyerang tidak butuh tenant kedua, IP kedua, atau
identitas kedua — hanya perlu berhenti mengirimnya satu per satu.

Perbaikannya meniru `mfa.ts` yang sudah benar sejak mendarat:

```sql
SET failed_login_count = failed_login_count + 1,
    locked_until = CASE WHEN failed_login_count + 1 >= $max
                        THEN $lockoutCandidateAt ELSE locked_until END
```

`evaluateLoginAttempt` tetap memutuskan izin/tolak dan tetap murni; yang ia
berhenti lakukan adalah **mengarang nilai penghitung**. Field `failedLoginCount`
dihapus dari hasilnya — bukan dibiarkan lalu diabaikan, karena field yang
terbaca otoritatif dan tidak dipakai adalah undangan untuk dipakai lagi. Satu
test meng-assert ketiadaannya.

**Klaim yang menopang keputusan lain, dan tidak benar.**
`src/lib/security/rate-limit.ts` menyandarkan postur **fail-open**-nya saat
Redis mati pada kalimat *"per-identity lockout is enforced in PostgreSQL,
atomically"*. Saat Redis mati, kontrol yang tersisa justru yang bisa dikalahkan
dengan mengirim percobaan berbarengan. Kalimat itu dan dua salinannya di
`docs/awcms/standar-performa-dan-keamanan.md` diperbaiki, keduanya kini
**menyebut statement-nya** alih-alih kata "atomik" — kata itulah yang tetap
tampak benar sementara mekanismenya tidak.

`.claude/skills/awcms-security-hardening/SKILL.md` diperbaiki dua tempat. Salah
satunya berbunyi *"atomik di DB (CAS/`FOR UPDATE`, bukan read-modify-write JS)"*
— menamai persis bentuk yang seharusnya dihindari, untuk kode yang memakainya.
Skill yang salah lebih berbahaya daripada dokumen basi: agen berikutnya
mengikutinya.

`docs/awcms/repo-assessment-2026-08-04.md` **sengaja tidak disentuh** — ia
catatan bertanggal, dan menyunting temuan lama adalah memalsukan rekaman.

**Gerbang readiness-nya juga diperbaiki, bukan cuma disesuaikan.**
`checkLoginLockoutImplemented` (severity `critical`) hanya memanggil fungsi
murni dan meng-assert ia mengembalikan timestamp — hijau selama dua tahun di
atas lockout yang bisa ditahan di satu. Kini ia memeriksa **dua** hal: kebijakan
menandai kegagalan sebagai terhitung, **dan** rute benar-benar menulis increment
sebagai ekspresi atas kolomnya.

**Test yang dibutuhkan tidak ada sebelumnya.** Seluruh test lockout murni domain
dan **nol** menaikkan penghitung lewat rute nyata, jadi suite-nya tidak akan
pernah melihat cacat ini maupun perbaikannya.
`tests/integration/login-lockout-concurrency.integration.test.ts` menembakkan K
percobaan **paralel** dan membaca barisnya. Dibuktikan **MERAH** dengan
mengembalikan read-modify-write aslinya: `Expected: 4, Received: 1`.

Terpisah dari #430 dan tidak menutupnya: #430 soal **keying**
(`(tenant, email)` versus manusia), ini soal **atomisitas** pada satu baris.
Keduanya bertumpuk — sampai sekarang tiap baris penghitung juga lebih murah
dinaikkan daripada yang tertulis.

Menutup #483.
