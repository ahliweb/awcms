🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0088-tenant-selection-and-switching.md)

<!-- i18n-source-hash: sha256:4dbbfdc8ffb534c0322935239b4c4932a0d3c345765cfe05cc8d52648f8e9dca -->

# ADR-0088 — Memilih tenant, dan berpindah antar tenant, tanpa pernah bisa mengotorisasi

- **Status:** Diterima (2026-08-12).
- **Konteks:** Issue #423 Gelombang 7 PR 7.4 — PR terakhir gelombang ini. Migrasi
  `sql/115`.
- **Membangun di atas:**
  [ADR-0085](0085-one-human-one-credential-many-tenants.md) (principal adalah
  fakta AUTENTIKASI, tidak pernah fakta OTORISASI — ADR ini adalah ujian
  pertama kalimat itu),
  [ADR-0086](0086-the-lockout-counter-is-global.md) (kredensial dan lockout
  sudah global, yang membuat login tanpa tenant mungkin sama sekali),
  [ADR-0087](0087-mfa-moves-to-the-principal.md) (faktor MFA sudah milik
  manusia, jadi satu enrolment memenuhi kewajiban tenant mana pun yang dipilih),
  dan [ADR-0049](0049-machine-credentials-and-session-introspection.md)
  (jenis bearer dibawa oleh namespace hash-nya — ditiru **persis** di sini).

## Keputusan

Login tanpa `x-awcms-tenant-id` berhenti menjadi `400 TENANT_REQUIRED` dan
menjadi **`409 MEMBERSHIP_SELECTION_REQUIRED`** yang membawa **token seleksi**
berumur ≤120 detik dan sekali pakai. Token itu ditukar di
`POST /api/v1/auth/session/tenant` menjadi sesi pada tenant yang **disebut
pemanggil**. Sesi yang sudah ada dapat berpindah lewat
`POST /api/v1/auth/session/switch`.

> **Token seleksi tidak boleh PERNAH mengautentikasi `authorizeInTransaction`.**

Kalimat itu adalah invarian paling berbahaya di seluruh program #423, dan ia
ditegakkan dengan cara yang sama seperti ADR-0049 memisahkan kredensial mesin
dari sesi: **jenisnya dibawa oleh namespace hash**, `isPrincipalSelectionHash()`
diperiksa **sebelum** apa pun di dalam gerbang, dan hash principal menghasilkan
401 keras **tanpa satu baris decision log pun**.

## `409` TIDAK membawa daftar keanggotaan, dan itu bukan penghematan

Rencana Gelombang 7 membayangkan sebuah picker. PR 7.1 bahkan menulis bahwa
index `awcms_identities (principal_id)` "melayani query setiap keanggotaan
manusia ini, yang menjadi dasar tenant switch Gelombang 7".

**Query itu tidak bisa melihat lebih dari satu tenant.** Diukur, bukan
disimpulkan — sebagai `awcms_app` terhadap basis data nyata berisi satu manusia
dengan identitas di dua tenant:

| Yang ditanyakan                                            | Hasil   |
| ---------------------------------------------------------- | ------- |
| semua keanggotaan principal itu, di dalam konteks tenant A | 1 baris |
| sama, tanpa konteks tenant (jalur login tanpa header)      | 0 baris |

`awcms_identities` FORCE RLS. Ini **kelas temuan yang sama** dengan yang
menjatuhkan rencana "audit di kedua tenant" pada ADR-0087, dua PR berturut-turut:
sebuah rencana yang mengasumsikan pembacaan lintas-tenant yang policy-nya
larang.

Yang membedakan: di sini ada jalan keluar yang buildable — **tabel proyeksi
keanggotaan global** yang di-maintain setiap penulis identitas. Itu
**DITOLAK**, dan penolakannya keputusan produk, bukan keterbatasan teknis:

- Ia adalah, secara harfiah, **direktori keanggotaan lintas-tenant** — bentuk
  yang ADR-0087 tolak untuk dibangun dalam wujud lain (daftar tenant terjangkau
  reset MFA). Menolaknya di satu tempat lalu membangunnya di tempat lain
  sebulan kemudian bukan konsistensi.
- Ia menciptakan **kewajiban penulis baru**: satu penulis identitas yang
  terlewat berarti tenant yang hilang dari picker **selamanya dan senyap** —
  persis mode kegagalan yang ADR-0086 bayar mahal untuk `principal_id` yang
  nullable, dan yang baru saja terulang sebagai `unlinked_factor` di ADR-0087.
- Ia menambah **tabel global keempat** yang tumbuh mengikuti keanggotaan, dengan
  baris basi setiap kali sebuah identitas dinonaktifkan.

**Gantinya: pemanggil menyebut tenantnya.** Itu bukan penurunan kemampuan yang
nyata — permukaan admin sudah host-resolved
([ADR-0059](0059-host-resolved-public-content-routes.md)), sehingga tenant diketahui
dari URL sebelum formulir login dirender; dan setiap klien API hari ini memang
sudah wajib mengirim `x-awcms-tenant-id`. Yang benar-benar hilang hanyalah
layar "Anda anggota tenant mana saja", dan harga sebenarnya dari layar itu
adalah sebuah direktori keanggotaan yang tidak boleh dimiliki siapa pun.

## Token seleksi hidup di `awcms_principals`, bukan di tabel kelima

Dua kolom: `selection_token_hash` (unik saat tidak NULL) dan
`selection_token_expires_at`. **Satu token hidup per manusia** — meminta yang
baru menghapus yang lama, preseden `deletePendingFactors` pada enrolment MFA
(hanya QR terakhir yang boleh dikonfirmasi).

Alternatifnya tabel `awcms_principal_selection_tokens` sendiri, dan ia lebih
buruk pada setiap sumbu yang penting: satu baris **per percobaan login
tanpa-tenant** berarti tabel yang tumbuh mengikuti **trafik**, sehingga ia butuh
deskriptor retensi, job purge, hak `DELETE` untuk `awcms_worker`, entri registry
lifecycle, dan entri allow-list gerbang — seluruh perkakas itu untuk baris yang
hidup 120 detik. Dua kolom pada baris yang **sudah** ada tidak tumbuh sama
sekali.

Konsekuensi yang diterima: dua login tanpa-tenant paralel oleh orang yang sama
membuat yang kedua membatalkan yang pertama. Jendelanya 120 detik, dan lebih
sedikit kredensial hidup adalah properti yang benar, bukan yang disesali.

**Gerbang `identity:principal-access:check` diperluas satu predikat**:
`selection_token_hash = ${…}` menjadi bentuk berkunci yang sah untuk
`awcms_principals`, di samping `id =` dan `email_normalized =`. Ia tetap
mengikat satu baris — index uniknya yang menjamin — dan pelebaran ini ditulis
di sini supaya ia keputusan review, bukan tambahan yang lolos karena praktis.

## Tiga gerbang yang tidak boleh dilewati jalur pemilihan

Menukar token menjadi sesi adalah **login yang setengah selesai**, bukan
pengiriman kunci. Setiap kontrol yang berlaku di `/auth/login` berlaku lagi saat
tenantnya akhirnya diketahui:

1. **Tenant `suspended`/tidak aktif ditolak** ([ADR-0073](0073-suspension-is-a-service-state-not-a-login-state.md)).
2. **Kebijakan auth tenant tujuan berlaku.** Tenant yang mematikan login
   password untuk sebuah identitas menolak penukaran itu — kalau tidak, memilih
   tenant menjadi jalan memutar mengelilingi kebijakan SSO-only.
3. **Kebijakan MFA tenant tujuan berlaku, dan ini yang paling mudah dilupakan.**
   Tenant B boleh mewajibkan MFA meski tenant A tidak. Menerbitkan sesi `aal1`
   ke dalam tenant B karena orangnya sudah membuktikan password di tempat lain
   akan membuat perpindahan tenant sebagai **bypass MFA** — dan yang paling
   dirugikan justru tenant yang postur keamanannya paling ketat. Jalur
   pemilihan dan perpindahan karena itu memakai gerbang yang **sama persis**
   dengan login: `MFA_REQUIRED` + challenge, atau `MFA_ENROLLMENT_REQUIRED` +
   grant enrolment. Sejak ADR-0087 faktornya sudah milik manusia, jadi
   authenticator yang sama memenuhi kewajiban tenant B tanpa enroll ulang.

**Assurance tidak ikut berpindah.** Sesi baru lahir `aal1` meski sesi asalnya
`aal2`: step-up adalah bukti segar untuk **satu** tenant, dan membawanya
menyeberang berarti step-up di tenant A memuaskan tuntutan tenant B.

## Aturan non-switchable, dan pengambilalihan yang ia tutup

Sesi ber-`origin_auth` **`sso`** atau **`handoff`** TIDAK BOLEH berpindah.

Tanpa aturan itu: administrator IdP tenant B meng-assert `alice@corp.com` —
alamat yang boleh diklaim IdP-nya sendiri — menerima sesi tenant B yang sah,
lalu **berpindah ke tenant A** tempat Alice yang sebenarnya bekerja.
Pengambilalihan lintas-tenant lengkap, lewat fitur yang tampak seperti
kenyamanan, tanpa satu pun kontrol yang dilanggar: setiap langkahnya sah.

Yang membuat perpindahan aman hanyalah **kredensial global**: password yang
diverifikasi terhadap `awcms_principals` membuktikan manusianya, dan tidak ada
tenant yang bisa menerbitkannya. Sebuah assertion IdP membuktikan sesuatu yang
jauh lebih sempit — bahwa tenant itu bersedia menyebut Anda dengan nama itu.
`handoff` ikut ditolak dengan alasan yang sama: ia bukan bukti kredensial.

Sesi hasil perpindahan ber-`origin_auth = 'switch'` — nilai keempat yang
`sql/100` sudah antisipasi dan sengaja tidak masukkan ke CHECK waktu itu, dengan
kalimat "CHECK yang memuat nilai yang tak bisa diproduksi apa pun terbaca
sebagai kapabilitas yang sudah dikirim". `sql/115` kini memproduksinya, jadi
`sql/115` yang menambahkannya. Rantai `switch` → `switch` tetap boleh: akarnya
tetap password, dan rotasi step-up sudah membawa `origin_auth` maju
(`stepUpSession`), sehingga `sso` tidak bisa menyamar menjadi `switch`.

## Kredensial yang belum dipromosikan menolak login tanpa-tenant

`sql/112` sengaja membiarkan `password_hash` principal NULL; ia dipromosikan
saat login sukses pertama (ADR-0086). Login **tanpa** tenant tidak punya
identitas untuk diverifikasi sebagai cadangan — itulah inti bentuknya — jadi
manusia yang belum pernah login sejak migrasi mendapat kegagalan generik yang
sama dengan password salah.

Ini **sengaja tidak** diperhalus dengan pesan khusus: "akun ini belum pernah
login" adalah oracle enumerasi. Jalur pemulihannya sudah ada dan tidak butuh
apa pun yang baru — login satu kali dengan header tenant (bentuk yang dipakai
setiap klien hari ini) mempromosikan kredensialnya, dan login tanpa-tenant
bekerja sejak saat itu.

## DITOLAK

- **Daftar keanggotaan di respons 409** (yang rencananya minta). Mustahil di
  bawah FORCE RLS tanpa `SECURITY DEFINER`/`NO FORCE`, dan proyeksi global yang
  membuatnya mungkin adalah direktori keanggotaan lintas-tenant yang ADR-0087
  tolak. Lihat di atas.
- **Tabel `awcms_principal_selection_tokens` tersendiri.** Tumbuh mengikuti
  trafik untuk baris berumur 120 detik; dua kolom pada baris yang sudah ada
  tidak tumbuh sama sekali.
- **Membawa `aal2` menyeberang tenant.** Step-up tenant A akan memuaskan
  tuntutan tenant B.
- **Mengizinkan sesi SSO berpindah.** Pengambilalihan lintas-tenant lengkap;
  lihat di atas.
- **Token seleksi berumur panjang atau bisa dipakai ulang.** Ia satu-satunya
  bearer di sistem ini yang tidak terikat tenant; setiap detik dan setiap
  pemakaian tambahan adalah pelebaran murni.
- **Menjadikan token seleksi bearer yang diterima `resolveAuthInputs`.** Ia
  hanya boleh diterima oleh satu endpoint yang menukarnya, dan penolakan di
  gerbang diuji terhadap lima endpoint terjaga plus asersi nol decision log.
