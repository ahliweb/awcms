# ADR-0050 — BFF `awcms-astro` memperoleh sesi manusia lewat KODE HANDOFF sekali-pakai, bukan dengan mem-proksi password

- **Status:** Accepted
- **Tanggal:** 2026-08-01
- **Pengambil keputusan:** @ahliweb
- **Menutup pertanyaan yang sengaja ditinggalkan** [ADR-0048](0048-frontend-role-split-awcms-astro-internal-admin.md) §"Yang TIDAK diputuskan di sini" — "bentuk autentikasi internal di `awcms-astro`"
- **Melanjutkan:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (BFF satu-satunya jalur data), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (`GET /api/v1/auth/session` sudah ada dan dipakai di sini)
- **Terkait:** ADR-0027 (MFA/step-up), ADR-0028 (OIDC/SSO), ADR-0029 (Turnstile)

## Konteks

ADR-0048 memberi `awcms-astro` layar admin owner/internal dan **sengaja tidak
menjawab bagaimana penggunanya login**. ADR-0049 menyelesaikan setengahnya:
sebuah BFF yang SUDAH memegang token sesi bisa menanyakan "sesi ini milik siapa
dan masih hidup?" lewat `GET /api/v1/auth/session`. Yang belum dijawab adalah
langkah sebelumnya — **dari mana token itu datang**.

Yang sudah ada di kode dan mengikat jawabannya:

| Fakta                                                                                                                                                  | Berkas                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `POST /api/v1/auth/login` mengembalikan `{token, expiresAt}` **dan** menyetel dua cookie httpOnly (`awcms_session`, `awcms_tenant_id`, `SameSite=Lax`) | `src/pages/api/v1/auth/login.ts` |
| Login bisa TIDAK mengembalikan token: `401 MFA_REQUIRED` + `mfaChallengeToken` yang harus ditebus di endpoint terpisah                                 | idem, ADR-0027                   |
| Login bisa dialihkan seluruhnya ke OIDC provider tenant (redirect + callback)                                                                          | ADR-0028                         |
| Login bisa mensyaratkan token Turnstile pada profil full-online                                                                                        | ADR-0029                         |
| Sesi dicabut massal saat password reset **dan** saat tenant user dinonaktifkan                                                                         | `session-revocation.ts`          |

Cookie itu milik origin `awcms`. Browser di origin `awcms-astro` tidak akan
pernah mengirimkannya, dan tidak boleh — itu bukan kekurangan yang perlu
ditambal, itu batas origin yang bekerja.

## Keputusan

**`awcms` tetap satu-satunya tempat kredensial diterima.** `awcms-astro`
memperoleh sesi lewat **kode handoff sekali-pakai berumur pendek**:

```
browser ──► awcms-astro /internal/login  (tanpa form kredensial)
        ──► redirect ke awcms /login?handoff=<id BFF>&redirect_uri=…
            ── pengguna login DI awcms: password, MFA, OIDC, Turnstile —
               semua alur yang sudah ada, tak satu pun diimplementasi ulang
        ──► redirect balik ke awcms-astro dengan `code` sekali-pakai
BFF     ──► POST /api/v1/auth/session-handoff/redeem  (server-ke-server)
        ◄── { token, expiresAt }   → disimpan server-side, dipetakan ke cookie portal
```

Aturan yang mengikat bentuk itu:

1. **Password tidak pernah melintasi `awcms-astro`.** Repo itu bukan penerbit
   identitas (ADR-0047 §Alternatif, ADR-0048 §2); menerima password di sana
   menjadikannya permukaan kredensial dengan seluruh kewajiban yang menyertainya.
2. **Kode handoff bukan sesi.** Sekali pakai, umur pendek (≤60 detik), terikat
   pada satu klien BFF terdaftar dan satu `redirect_uri`, dan ditukar
   **server-ke-server** dengan kredensial klien BFF — bukan oleh browser.
   Kode yang bocor lewat log/Referer tidak berguna tanpa kredensial itu.
3. **Token sesi tidak pernah sampai ke browser.** BFF menyimpannya server-side
   dan hanya memberi browser cookie portal-nya sendiri (`HttpOnly`, `Secure`,
   `SameSite=Lax`).
4. **Introspeksi adalah sumber kebenaran, bukan cache.** BFF memanggil
   `GET /api/v1/auth/session`; `401` berarti sesi berakhir dan portal ikut
   logout **saat itu juga**. Ini bukan formalitas: sejak PR #319 deaktivasi
   tenant user mencabut sesi seketika, jadi "sudah dinonaktifkan tetapi masih
   melihat layar internal" adalah keadaan yang harus mustahil.
5. **Urutan logout terbalik itu bug.** Panggil logout `awcms` LEBIH DAHULU, baru
   hapus cookie portal — urutan sebaliknya meninggalkan sesi hidup di sumber
   kebenaran sementara pengguna yakin sudah keluar.
6. **CSRF di BFF**: origin/Referer check **dan** token double-submit untuk setiap
   mutasi. Salah satu saja tidak cukup (ADR-0045 §4).
7. **Tidak ada cache bersama** antara permukaan internal dan permukaan publik
   (ADR-0048 §3).

## Alternatif yang ditolak

**BFF mem-proksi password** (form login di `awcms-astro`, BFF memanggil
`POST /api/v1/auth/login` atas nama pengguna). Ditolak karena dua alasan
terpisah, dan yang kedua yang menentukan:

- Password akan melintasi dan (walau sekejap) berada di memori repo yang bukan
  identity store.
- **Login di sini bukan satu langkah.** Ia bisa berbalas `401 MFA_REQUIRED` +
  `mfaChallengeToken`, bisa dialihkan ke OIDC provider tenant, dan bisa
  mensyaratkan Turnstile. Mem-proksinya berarti mengimplementasi ulang
  kelanjutan MFA, callback OIDC, dan widget Turnstile **di repo kedua** — tiga
  alur keamanan yang sudah matang, teruji, dan ber-ADR di sini. Salinan kedua
  dari alur MFA adalah tempat paling mahal untuk membuat kesalahan pertama.

**Cookie lintas-site (`SameSite=None`) untuk `awcms_session`.** Ditolak: itu
memindahkan pemilihan tenant, CSRF, dan CORS ke klien — persis yang ADR-0045 §3
tolak — dan melonggarkan cookie yang juga dipakai admin `awcms` sendiri.

**Menjadikan `awcms` OIDC provider.** Ditolak untuk saat ini: `awcms` adalah
OIDC **consumer** (ADR-0028). Menjadi provider berarti membangun permukaan
protokol penuh (discovery, JWKS, token/refresh/userinfo, consent) untuk satu
klien tepercaya di jaringan yang sama. Kode handoff adalah bagian yang benar-benar
dibutuhkan dari alur itu, tanpa sisanya. Bila kelak ada klien ketiga yang tidak
tepercaya, keputusan ini ditinjau ulang — dan itu ADR-nya sendiri.

**Kredensial mesin (ADR-0049) untuk layar internal.** Ditolak: baca-saja secara
konstruksi, jadi tidak bisa melakukan aksi admin apa pun — dan yang lebih
penting, ia menghapus atribusi per-pengguna. Layar internal justru permukaan yang
paling butuh "siapa yang menekan tombol ini".

## Konsekuensi

**Yang harus dibangun di `awcms`** (belum ada saat ADR ini ditulis): tabel kode
handoff + klien BFF terdaftar, parameter `handoff`/`redirect_uri` di `/login`
dengan **allow-list `redirect_uri` yang ketat** (open-redirect di sini berarti
menyerahkan kode ke penyerang), dan `POST /api/v1/auth/session-handoff/redeem`
yang menukar kode sekali — di bawah kunci baris, bukan read-modify-write.

**Yang harus dibangun di `awcms-astro`**: rute `/internal/login`, penyimpanan
sesi BFF server-side, cookie portal, CSRF, dan pemanggilan introspeksi per
permintaan.

**Biaya yang diterima.** Satu redirect tambahan pada login internal, dan
kewajiban menjaga allow-list `redirect_uri` tetap sempit. Keduanya dibayar sekali;
salinan kedua dari alur MFA akan dibayar setiap kali alur itu berubah.

**Risiko yang dinamai supaya bisa ditolak.** Kode handoff adalah bahan
kredensial berumur pendek. Ia tidak boleh muncul di log akses, tidak boleh
diteruskan lewat `Referer`, dan penukarannya harus atomik. Bila salah satu dari
tiga itu tidak dipenuhi, bentuk ini tidak lebih aman dari yang ditolak di atas —
ia hanya terlihat lebih aman.
