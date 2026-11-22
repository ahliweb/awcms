🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0168-passkeys-webauthn-are-a-principal-owned-phishing-resistant-factor-that-yields-aal2-with-self-implemented-attestation-none-verification.md)

<!-- i18n-source-hash: sha256:4303781e073a679e48097bc393e320795d5fa18a0d571412bdfaeb9717faec84 -->

# ADR-0168 — Passkey (WebAuthn) adalah faktor tahan-phishing milik principal yang menghasilkan `aal2`, dengan verifikasi `attestation: none` yang diimplementasikan sendiri

- **Status:** Diterima dengan amandemen (22 November 2026). Keputusan didelegasikan pemilik ke orchestrator dan diambil setelah tinjauan keamanan oleh `awcms-security-auditor` atas `origin/main` pada `16c8ebcd` (tidak ada temuan Critical; lima temuan High yang mengubah model data atau batas otorisasi, karena itu ada amandemen di bawah). Awalnya diusulkan 22 November 2026.
- **Tinjauan:** amandemen di §Amandemen (22 November 2026) bersifat **normatif dan menang** atas kalimat awal mana pun di dokumen ini; kalimat yang digantikannya ditandai _Digantikan oleh_ di tempatnya. Irisan implementasi S3 dan seterusnya **diblokir sampai S1 lulus gerbang G1 sampai G7** (A10). A1 sampai A5 mengubah model data dan batas otorisasi, sehingga diputuskan di sini, tidak diserahkan ke irisan. Hanya dokumen: ADR ini tidak menulis kode, migrasi, atau OpenAPI.
- **Tanggal:** 2026-11-22
- **Pengambil keputusan:** @ahliweb, didelegasikan ke orchestrator (keputusan K16 di [`docs/PROJECT_STATE.md`](../PROJECT_STATE.id.md) §4)
- **Terkait:** Issue [#1405](https://github.com/ahliweb/awcms/issues/1405) (ADR ini adalah langkah 1-nya); dependennya [#1406](https://github.com/ahliweb/awcms/issues/1406) (autentikasi klien native) dan [#1407](https://github.com/ahliweb/awcms/issues/1407) (step-up terikat hash aksi), keduanya menunggu ADR ini. [ADR-0027](0027-mfa-totp-session-assurance-step-up.id.md) (TOTP, `assurance_level`, step-up), [ADR-0028](0028-oidc-sso-tenant-aware-account-linking-break-glass.id.md) (break-glass), [ADR-0085](0085-one-human-one-credential-many-tenants.id.md) (principal), [ADR-0087](0087-mfa-moves-to-the-principal.id.md) (MFA milik principal), [ADR-0050](0050-bff-session-handoff-code.id.md) (handoff BFF), [ADR-0106](0106-domain-verification-proves-control-of-the-zone.id.md) (kendali domain), [`docs/awcms/mfa-totp-step-up.md`](../awcms/mfa-totp-step-up.id.md). Spesifikasi: W3C WebAuthn Level 3.

## Konteks

`identity-access` hanya punya satu faktor kedua: TOTP, ditambah kode pemulihan yang disimpan sebagai hash. Keduanya milik **principal** sejak ADR-0087 (`awcms_principal_mfa_factors`, `awcms_principal_mfa_recovery_codes`, `sql/114`). Sesi membawa `assurance_level IN ('aal1','aal2')` (`sql/024`), dan `requireStepUp` menyegarkan `stepped_up_at` setelah pemeriksaan TOTP atau kode pemulihan (`evaluateStepUp` di `src/modules/identity-access/domain/mfa-policy.ts` mengembalikan `not_stepped_up` kecuali sesi `aal2` dan masih segar).

ADR-0027 dan `sql/024` (baris 43) sama-sama menyatakan WebAuthn **di luar cakupan**. Pencarian "webauthn" dan "passkey" di `src/`, `sql/`, dan `docs/` hanya menemukan dua pernyataan itu dan satu sebutan "di luar cakupan" lain untuk tipe provider SSO di `docs/awcms/program-model-keanggotaan-2026-08-09.md`: belum ada yang dibangun.

TOTP punya kelemahan struktural yang tidak bisa dihilangkan dengan pembatasan laju: kode enam digit yang diketik di halaman tiruan masih sah di situs asli selama jendela TOTP (`AUTH_MFA_TOTP_WINDOW_STEPS=1`, periode 30 dtk). Ia **dapat di-phishing**. Aplikasi hilir yang memproses data sensitif membutuhkan faktor yang (a) terikat pada origin situs oleh authenticator, sehingga halaman tiruan tidak mendapat apa pun yang berguna, dan (b) terikat pada perangkat. #1407 juga membutuhkan assertion yang menandatangani hash aksi yang disetujui; itu hanya mungkin dengan WebAuthn, sehingga ADR ini adalah prasyaratnya.

Kendala yang sudah berlaku dan membentuk rancangan:

- **Bun-only, dua dependensi runtime** (`astro`, `@astrojs/node`); TOTP, token sesi, token reset, dan state OAuth semuanya dibangun di atas `node:crypto` tanpa pustaka autentikasi. Menambah dependensi runtime harus melewati `deps:audit:check`, `deps:license:check`, dan `deps:provider-changelog:check`.
- **Routing host multi-tenant.** `awcms_tenant_domains` (`sql/046`) memetakan hostname, termasuk domain kustom pelanggan, ke tenant. Kredensial WebAuthn terikat pada satu **RP ID** (sufiks domain terdaftar dari host halaman). Domain kustom karenanya tidak bisa berbagi satu kredensial.
- **`APP_URL` wajib** dan membangun URL callback OIDC (`.env.example`); permukaan admin ada di sana.
- **BFF `awcms-astro`** menjangkau awcms lewat kode handoff sekali pakai ([ADR-0050](0050-bff-session-handoff-code.id.md)); origin BFF bukan origin admin.
- **FORCE RLS dan tabel global.** ADR-0085/0087 menetapkan preseden tabel GLOBAL berkunci principal dengan empat kontrol pengganti (privilese dipersempit, gerbang bentuk-baca per pemanggil, invarian proyeksi, batas otorisasi yang tidak berpindah) di samping baris challenge sementara yang ber-scope tenant.

## Opsi pustaka verifikasi

| Opsi                                                                              | Apa itu                                                                                                     | Ringkasan                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Implementasi sendiri di atas WebCrypto Bun dan `node:crypto`** (rekomendasi) | Urai `clientDataJSON`, `authenticatorData`, subset CBOR, dan kunci COSE; verifikasi dengan `crypto.subtle`. | Tanpa dependensi; sejalan dengan cara TOTP dan token dibuat di sini. Cakupan dijaga kecil dengan **hanya mendukung `attestation: none`**, yang menghilangkan rantai X.509, FIDO MDS, dan semua format attestation. Kita memikul beban kebenarannya, sehingga gerbang spike di bawah wajib. |
| B. `@simplewebauthn/server`                                                       | Pustaka server yang banyak dipakai untuk pekerjaan yang sama.                                               | Kode yang dimiliki lebih sedikit dan mengikuti perubahan spesifikasi. Menambah dependensi runtime beserta transitifnya (parser CBOR dan ASN.1); rantai pasok, lisensi, dan kompatibilitas Bun harus diverifikasi saat diadopsi. Tidak diverifikasi oleh ADR ini.                           |
| C. Mendelegasikan ke penyedia identitas eksternal                                 | IdP menjalankan WebAuthn dan hasilnya dikonsumsi lewat OIDC (`docs/awcms/oidc-sso.md`).                     | Tanpa kode WebAuthn di sini. Tetapi kredensial lalu berada di luar system of record, step-up terikat hash aksi (#1407) tak terjangkau, dan akun lokal, break-glass, serta profil offline/LAN tidak punya passkey.                                                                          |

Klaim tentang opsi B (lisensi, irama pemeliharaan, kompatibilitas Bun, dependensi transitif) **sengaja tidak ditegaskan di sini**: ADR ini ditulis tanpa menjalankannya. Bila spike (S1 di bawah) jatuh kembali ke B, PR itu membawa buktinya, gerbang `deps:*`, dan amandemen ADR sendiri untuk dependensi runtime baru (issue mensyaratkan ADR terpisah dengan penilaian 11 kriteria yang sama sebelum dependensi apa pun ditambahkan). Opsi B adalah cadangan yang disebut namanya, bukan preferensi.

## Keputusan

> Baca §Amandemen (22 November 2026) bersama bagian ini. Bila keduanya berbeda, amandemen menang; kalimat yang digantikan dipertahankan dan ditandai agar penalarannya tetap dapat ditelusuri.

### 1. Model kredensial: principal memiliki passkey

Passkey adalah kredensial **manusia**, persis seperti faktor TOTP menjadi demikian di ADR-0087. Ia disimpan di tabel GLOBAL baru berkunci `principal_id`, bukan per identitas tenant. Tenant memegang **kewajiban** (kebijakan), tidak pernah faktornya: "faktor milik manusia; kewajiban milik tenant."

Konsekuensi yang dinyatakan di depan, karena sama dengan yang dinyatakan ADR-0087: reset administratif atas passkey kini menjangkau di luar tenant yang bertindak. Ia ditangani dengan cara yang sama (izin sendiri, step-up, alasan wajib, `crossTenantReach` di baris audit, jejak tersimpan di baris global), bukan sebagai efek samping.

### 2. Relying party ID dan origin

- **Satu RP ID untuk seluruh permukaan autentikasi**, diturunkan dari `APP_URL`, tidak pernah dari header `Host` permintaan. Verifikasi membandingkan `clientDataJSON.origin` dengan **daftar izin persis** (origin `APP_URL`; origin tambahan hanya lewat konfigurasi eksplisit) dan `authenticatorData.rpIdHash` dengan `SHA-256(rpId)`.
- **Domain kustom tenant bukan origin autentikasi.** Login, registrasi, dan step-up terjadi di origin admin. Passkey yang didaftarkan di sana tidak ditawarkan di `{domain-kustom}`; situs publik tenant tidak mengautentikasi staf. Ini harus dikonfirmasi terhadap rute sebenarnya di S1 (saat ini tidak diasumsikan ada permukaan login di domain kustom, tetapi klaimnya harus diperiksa, bukan dipercaya). _Digantikan oleh A5: klaim itu sudah diperiksa dan hari ini salah, karena `src/middleware.ts` tidak punya gerbang host untuk `/login` atau `/admin/*`; A5 menambahkan mekanismenya._
- Apakah `rpId` adalah host `APP_URL` persis atau domain induk terdaftarnya adalah **pertanyaan pemilik Q2 (terjawab: host persis, lihat §Jawaban)**: domain induk membolehkan subdomain saudara berbagi kredensial tetapi memperluas radius ledakan pengambilalihan subdomain (ADR-0106 membahas pembuktian kendali zona, bukan kebersihan subdomain). **Rekomendasi: host persis.** Mengubahnya kelak membatalkan semua passkey yang sudah terdaftar, sehingga nilainya disimpan per kredensial (`rp_id`) dan ketidakcocokan adalah kegagalan keras, bukan fallback.
- `awcms-astro` dan klien native (#1406) harus menjalankan upacara **di origin awcms** (peramban) atau lewat asosiasi platform (Digital Asset Links, `webcredentials` untuk Apple). Asosiasi native **di luar cakupan di sini** dan dicatat sebagai masukan bagi #1406. Untuk situs BFF, upacara terjadi di origin admin dan sesi dikirim lewat kode handoff yang ada; BFF tidak pernah melihat atau meneruskan assertion.

### 3. User verification, attestation, resident key

- **`userVerification: "required"`** untuk registrasi, login, dan step-up. Server menolak assertion yang flag `UV`-nya tidak menyala (`UP` juga harus menyala). Inilah yang membuat satu gestur dihitung dua faktor dan karenanya membenarkan `aal2`; tanpa UV, kunci tercuri yang terbuka sama dengan kata sandi tercuri.
- **`attestation: "none"`.** (A6 menyempurnakan sisi verifier: `fmt` apa pun diterima tetapi `attStmt` tidak pernah diverifikasi atau dipercaya.) Kita tidak perlu tahu model authenticator pengguna: passkey tersinkron (iCloud Keychain, Google Password Manager, pengelola kata sandi) memang tidak mengembalikan attestation yang berguna, dan menuntut `direct` akan mengecualikannya, menurunkan adopsi, dan mengimpor beban operasi kepercayaan sertifikat (FIDO MDS) yang tidak sanggup kita staf. Server menyimpan AAGUID hanya untuk audit. **Rekomendasi: `none`.** Bila pelanggan hilir kelak butuh kebijakan model perangkat keras, itu ADR terpisah (ia akan memasukkan kembali verifikasi format attestation, tepatnya kode yang dijauhkan §Opsi).
- **Resident (discoverable) key: `"preferred"`.** Ia memungkinkan autofill conditional-UI dan, kelak, login tanpa username, tetapi kredensial non-discoverable (banyak kunci perangkat keras yang penuh) tetap diterima untuk faktor kedua dan step-up. Login tanpa username adalah Q3.
- **Algoritma:** tawarkan hanya ES256 (-7), EdDSA (-8), dan RS256 (-257); tolak yang lain saat registrasi. Flag cadangan: simpan `backup_eligible` dan `backup_state`; apakah passkey **tersinkron** boleh memenuhi level lebih tinggi #1407 (passkey plus TOTP) adalah Q4.

### 4. Hubungan dengan `assurance_level`, step-up, dan TOTP

- Assertion sukses dengan `UV` menyala menghasilkan sesi `assurance_level = 'aal2'`. Naik dari `aal1` merotasi token sesi, memakai ulang aturan anti-fiksasi di `mfa-session-assurance.ts`; bentuk `aal2` tidak berubah.
- **Tiga pemakaian, satu model jaminan:** (a) _faktor kedua_ setelah kata sandi (atau SSO) menggantikan TOTP, (b) _login_ dengan passkey saja (Q3; **tidak di rilis pertama**, lihat §Jawaban), dan (c) _step-up_ untuk gerbang `requireStepUp` yang ada, menyegarkan `stepped_up_at`. TOTP tetap berfungsi tanpa perubahan: `requireStepUp`, `POST /auth/mfa/step-up`, dan kebijakan MFA tenant **tidak diubah** ADR ini (uji regresi di irisan implementasi).
- `awcms_sessions.origin_auth` punya CHECK lima nilai (`sql/117`: `password, sso, handoff, switch, delegated`). Login passkey memerlukan nilai keenam `passkey` (perubahan CHECK, bentuk sama dengan yang dilakukan `sql/117` untuk `delegated`) atau memakai ulang `password`. **Rekomendasi: tambah `passkey`**, karena "apa yang dihitung sebagai autentikasi ulang" di #1004 membaca `originAuth`, dan pemakaian ulang senyap akan membuatnya berbohong.
- Varian terikat hash aksi adalah #1407; ADR ini hanya menjamin primitif yang dibutuhkannya (challenge yang sepenuhnya dikendalikan server, dan UV ditegakkan).

### 5. Upacara

Aturan bersama, ditegakkan di kode verifikasi dan oleh tes:

1. **Challenge:** 32 byte acak dari CSPRNG, **sekali pakai**, disimpan di server sebagai digest SHA-256 dengan `purpose`, `principal_id` atau `session_id` (nullable untuk tanpa username), `expires_at`, dan `consumed_at`. Konsumsi adalah satu `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING` atomik; dua verifikasi bersamaan atas challenge yang sama tidak bisa sama-sama menang. TTL bawaan **120 dtk** (dapat dikonfigurasi, dengan batas bawah dan atas), bukan 300 dtk milik `AUTH_MFA_CHALLENGE_TTL_SEC`, karena tidak ada manusia yang mengetik kode. _Digantikan oleh A9: bawaannya 300 dtk (panduan batas waktu upacara WebAuthn, WCAG 2.2.1), karena ada orang yang menunggu prompt perangkat._
2. **Waktu:** hanya jam server; basis data adalah jam untuk TTL, sesuai aturan seluruh repo tentang jam aplikasi versus DB. Klien tidak pernah mengirim atau memperpanjang waktu.
3. **Pemeriksaan, berurutan, semuanya gagal-tertutup dengan satu galat seragam ke klien:** `clientDataJSON.type` (`webauthn.create` atau `webauthn.get`), kecocokan challenge (waktu-konstan, terhadap digest tersimpan), `origin` dalam daftar izin, `crossOrigin` tidak ada atau false, `rpIdHash`, `UP`, `UV`, kredensial milik principal yang diharapkan (untuk autentikasi dengan pengguna diketahui) atau teresolusi ke principal (discoverable), kredensial tidak dicabut, tanda tangan atas `authenticatorData || SHA-256(clientDataJSON)` dengan kunci COSE tersimpan, sign counter.
4. **Sign counter.** Banyak passkey tersinkron selalu melaporkan 0. Aturan: bila counter tersimpan dan counter yang disajikan keduanya 0, terima; selain itu counter yang disajikan **harus lebih besar** dari yang tersimpan. Counter yang tidak maju diperlakukan sebagai kemungkinan kloning: assertion ditolak, kredensial diberi `clone_suspected_at`, principal diberi tahu, dan baris audit `critical` ditulis. Kredensial yang dicurigai tidak bisa memenuhi `aal2` sampai pengguna mendaftarkannya ulang (atau admin menghapus tanda dengan step-up dan alasan). _Digantikan oleh A7: tidak ada "admin menghapus tanda"; pembaruannya compare-and-set atomik, karantina hanya bila BE=0, dan kloning yang dicurigai dicabut lalu didaftarkan ulang._
5. **Registrasi** tambahan: tolak `credentialId` yang sudah ada di mana pun (keunikan global, sehingga satu authenticator tidak bisa dipasang ke dua principal), set `excludeCredentials` ke kredensial principal yang ada, wajibkan `attestationObject.fmt = "none"` _(digantikan oleh A6: terima `fmt` apa pun, jangan pernah verifikasi atau percaya `attStmt`, catat `fmt` untuk telemetri)_, dan wajibkan sesi terautentikasi yang **baru di-step-up** untuk menambah kredensial (menambah faktor adalah tindakan berhak istimewa).
6. **Pembatasan laju** per principal dan per IP memakai pola limiter yang ada (`AUTH_MFA_RATE_LIMIT_*`); variabel `AUTH_PASSKEY_*` baru harus tercakup `config:env:coverage:check`.

### 6. Penyimpanan (deskriptif, bukan migrasi)

| Tabel                      | Scope                                      | Kolom (maksud)                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_principal_passkeys` | GLOBAL, tanpa RLS, berkunci `principal_id` | `id`, `principal_id` FK, `credential_id` bytea **unik global**, `public_key` bytea (COSE), `cose_alg`, `sign_count` bigint, `transports` text[], `aaguid`, `backup_eligible`, `backup_state`, `rp_id`, `label`, `created_at`, `last_used_at`, `revoked_at`, `revoked_reason`, `clone_suspected_at`, `disabled_by_tenant_id` (tanpa FK, seperti `sql/114`) |
| `awcms_passkey_challenges` | Ber-scope tenant, **FORCE RLS**            | `id`, `tenant_id`, `principal_id` nullable, `session_id` nullable, `purpose` (`register`, `authenticate`, `step_up`), `challenge_digest`, `created_at`, `expires_at`, `consumed_at`                                                                                                                                                                       |

Mengapa dipisah begini: kredensial hidup lintas tenant seperti orangnya (ADR-0087), sedangkan challenge adalah satu percobaan di satu tenant dan tidak boleh bisa ditukar menjadi sesi di tenant lain (argumen yang sama dengan ADR-0087 untuk `awcms_mfa_challenges`). Empat kontrol pengganti diterapkan tanpa diubah: GRANT dipersempit, gerbang bentuk-baca per pemanggil (`identity:principal-access:check` diperluas), invarian proyeksi agar `public_key` tidak pernah keluar dari modul penyimpan, dan memegang kredensial tidak memberi otorisasi. Kunci publik **bukan rahasia**, tetapi tidak dilog dan tidak dikembalikan API mana pun; **tidak ada kunci privat di sistem mana pun**, sehingga "tidak ada secret tersimpan" berlaku secara struktural. Retensi challenge terkonsumsi atau kedaluwarsa masuk registry data-lifecycle (`data-lifecycle:registry:check`, `data-lifecycle:table-coverage:check`); tabel baru masuk `subject-data:coverage:check`. Nomor migrasi ditetapkan saat irisannya ditulis.

### 7. Pengikatan perangkat, batas, pencabutan, audit

- Principal melihat daftar, **mengganti nama**, dan **mencabut** passkey-nya; daftar menampilkan label, transport, flag cadangan, waktu daftar dan pakai terakhir, tidak pernah materi kunci.
- **Batas:** paling banyak 10 kredensial aktif per principal (dapat dikonfigurasi); lantai keamanan yang berguna adalah **dua**, sehingga UI mendorong pendaftaran kedua (Q5 menanyakan apakah kebijakan boleh _mewajibkan_ dua).
- Pencabutan adalah status lunak (`revoked_at`, `revoked_reason`): baris tetap untuk audit dan agar `credential_id` yang dicabut tidak pernah bisa dipasang ulang. Mencabut kredensial juga mencabut sesi yang dibuatnya bila principal memilih "keluar di mana-mana"; ia tidak pernah diam-diam mengeluarkan sesi lain.
- Menghapus passkey **terakhir** milik principal yang kebijakan tenant-nya mewajibkannya ditolak kecuali jalur pemulihan sudah siap (§8).
- **Audit** (semua dengan redaksi; ID kredensial hanya muncul sebagai digest pendek): `passkey_registered`, `passkey_authenticated`, `passkey_stepped_up`, `passkey_renamed`, `passkey_revoked`, `passkey_rejected` (dengan kode alasan **kasar**, tidak pernah byte yang gagal), `passkey_clone_suspected` (critical), `passkey_admin_reset` (critical, dengan `crossTenantReach`), `passkey_recovery_used`. Registrasi, pencabutan, dan reset berisiko tinggi dan membawa `Idempotency-Key`.

### 8. Pemulihan tidak boleh turun ke password-saja atau TOTP-saja

- **Perlindungan utama adalah redundansi:** banyak kredensial (§7) termasuk satu passkey tersinkron.
- **Kode pemulihan:** kode pemulihan hash-only yang ada (milik principal) tetap, tetapi kode pemulihan **dapat di-phishing** dan karenanya **tidak dapat memenuhi** gerbang yang mensyaratkan passkey (kebijakan `passkey_required`, atau level 2 #1407). Satu-satunya kuasanya adalah membuka **sesi pemulihan** yang hanya boleh satu hal: mendaftarkan passkey baru, setelah masa tenang di bawah.
- **Pendaftaran setelah pemulihan punya jeda.** Memakai kode pemulihan, atau reset admin, memulai masa tenang yang dapat dikonfigurasi (usulan: 24 jam) sebelum passkey yang baru didaftarkan dapat memenuhi gerbang yang mensyaratkan passkey, dengan pemberitahuan di luar jalur (e-mail lewat modul e-mail yang ada) kepada principal saat dimulai. Inilah yang menghentikan "phish kode pemulihan, daftarkan kunci penyerang, langsung bertindak".
- **Reset admin** `identity_access.passkey_admin.reset`: default-deny, `requireStepUp`, `reason` wajib, maker/checker (Q6: wajib atau opsional), audit `critical` dengan `crossTenantReach`, masa tenang yang sama. Ia **tidak** di-seed ke peran tenant secara bawaan dan harus di-seed migrasi bila ditegakkan (repo ini sudah dua kali kena izin yang tak pernah di-seed). _Digantikan oleh A3: bootstrap memberi owner tenant semua izin katalog, sehingga "tidak di-seed ke peran tenant" hanya dapat dicapai lewat scope platform; maker/checker wajib._
- **Break-glass (ADR-0028).** Identitas break-glass mempertahankan jalur kata sandi lokal plus TOTP atau kode pemulihan walau kebijakan tenant `passkey_required`; ini pengecualian yang sama dengan yang diberikan ADR-0028 §9 terhadap gangguan SSO, dan tetap diaudit. Tenant karenanya tidak bisa mengunci dirinya dari pemulihan dengan menyalakan kebijakan, dan saat simpan kebijakan ditegakkan "minimal satu identitas break-glass aktif" seperti yang sudah dilakukan `saveTenantAuthPolicy` untuk SSO.
- Kewajiban tenant adalah kolom atau tabel kebijakan baru mengikuti `awcms_tenant_mfa_policies`; mewajibkan passkey adalah keputusan produk tenant dan bawaannya mati.

## Penilaian terhadap 11 kriteria

Dinilai untuk keputusan secara utuh: **adopsi passkey, milik principal, verifikasi `attestation: none` yang diimplementasikan sendiri** (opsi A), dibandingkan tidak berbuat apa-apa (TOTP saja).

| #   | Kriteria                 | Penilaian                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Kelebihan dan kekurangan | **+** Tahan phishing, terikat perangkat, satu gestur untuk dua faktor, membuka #1407 dan #1406. **−** Desain pemulihan sulit, passkey tersinkron memindahkan kepercayaan ke vendor platform, kita memikul kebenaran verifier.                                                                                                                                        |
| 2   | Keamanan                 | Terikat origin oleh authenticator; tidak ada rahasia bersama di sisi kita; tidak ada kunci privat yang bisa bocor. Risiko: bug verifier (dimitigasi gerbang spike, vektor resmi, tes negatif), pilihan RP ID (Q2), pemulihan sebagai jalur terlemah (§8 masa tenang, kode pemulihan tak bisa memenuhi gerbang passkey).                                              |
| 3   | Performa                 | Verifikasi adalah satu verify ECDSA/EdDSA dan dua lookup berindeks; konsumsi challenge satu UPDATE berindeks. Dapat diabaikan dibanding hashing kata sandi yang memang sengaja lambat. Latensi upacara didominasi gestur pengguna.                                                                                                                                   |
| 4   | Perawatan                | Kode sendiri sekitar beberapa ratus baris plus vektor, di `identity-access/domain`, murni dan mudah diuji unit. Spesifikasi WebAuthn berevolusi lambat; biayanya membaca ulang perubahan Level 3. Pustaka (opsi B) mengurangi ini dan menambah dependensi yang harus dipantau.                                                                                       |
| 5   | Skalabilitas             | Baris per manusia, bukan per permintaan; baris challenge berumur pendek dan tercakup retensi. Tanpa fan-out lintas tenant. Biaya tumbuh dengan jumlah pengguna, bukan lalu lintas.                                                                                                                                                                                   |
| 6   | Aksesibilitas            | Passkey menghapus langkah menyalin dan uji kognitif yang menjadi perhatian WCAG 2.2 SC 3.3.8 (Autentikasi Aksesibel, Minimum), dan bertumpu pada authenticator platform yang sudah dioperasikan pembaca layar. Syarat: tanpa tekanan waktu pendek yang keras di halaman, autofill conditional-UI, jalur alternatif non-passkey yang jelas, status lewat `aria-live`. |
| 7   | SEO                      | Tidak berlaku: layar autentikasi adalah permukaan admin `noindex`; tidak ada halaman publik yang berubah.                                                                                                                                                                                                                                                            |
| 8   | UI/UX                    | Prompt OS yang dikenal, lebih sedikit kode diketik. Butuh layar baru di bawah `/admin/account` (daftar, tambah, ganti nama, cabut, pemulihan) dan pilihan login; pesan gagal harus seragam, dan UI harus menjelaskan "perangkat hilang" sebelum itu terjadi.                                                                                                         |
| 9   | Kompatibilitas           | WebAuthn didukung peramban dan platform arus utama saat ini; lingkungan lama atau terkunci, sebagian profil kiosk/LAN, dan origin tak aman (butuh HTTPS atau `localhost`) jatuh ke TOTP, sehingga TOTP **tidak dihapus**. WebCrypto Bun mencakup verifikasi P-256, Ed25519, dan RSA (dikonfirmasi spike).                                                            |
| 10  | Kompleksitas operasional | Baru: variabel env, RP ID yang praktis tak dapat diubah setelah pengguna mendaftar, SOP pemulihan, pemeriksaan `security:readiness`, runbook admin. Profil offline/LAN: hanya berfungsi bila origin admin adalah secure context.                                                                                                                                     |
| 11  | Implikasi jangka panjang | Kredensial terdaftar menjadikan RP ID komitmen jangka panjang; maka Q2. Memposisikan repo untuk passkey native (asosiasi #1406) dan persetujuan aksi bertanda tangan (#1407). Related Origin Requests (Level 3) kelak dapat memperluas scope RP tanpa mendaftar ulang, tetapi tidak diandalkan sekarang.                                                             |

Tidak berbuat apa-apa membiarkan TOTP dapat di-phishing dan menghambat #1406/#1407; opsi B menukar kriteria 4 (kode lebih sedikit) dengan kriteria 2 dan 10 (rantai pasok baru yang diaudit); opsi C gagal di kriteria 1 dan 11 karena alasan pada tabel opsi.

## Pertanyaan terbuka untuk pemilik (terjawab, lihat §Jawaban)

1. **Q1 — Pustaka.** Setujui opsi A (sendiri, hanya `attestation: none`) dengan gerbang spike, opsi B sebagai cadangan bernama, atau wajibkan B sekarang?
2. **Q2 — RP ID.** Host `APP_URL` persis (rekomendasi) atau domain induk terdaftarnya? Ini praktis tak dapat dibalik setelah ada yang mendaftar.
3. **Q3 — Login hanya passkey.** Apakah login discoverable tanpa username (tanpa kata sandi lebih dulu) masuk rilis pertama, atau hanya faktor kedua dan step-up?
4. **Q4 — Passkey tersinkron.** Bolehkah passkey yang backup-eligible (tersinkron) memenuhi level 3 #1407, atau hanya kredensial terikat perangkat keras?
5. **Q5 — Dua kredensial.** Hanya dorongan, atau boleh kebijakan tenant mewajibkan minimal dua?
6. **Q6 — Reset admin.** Maker/checker wajib atau opsional? Dan masa tenang 24 jam, atau dapat dikonfigurasi per tenant?
7. **Q7 — `origin_auth`.** Tambah `passkey` ke CHECK `sql/117` (rekomendasi) atau pakai ulang `password`?
8. **Q8 — Bawaan kewajiban.** Konfirmasi kebijakan tenant "passkey wajib" bawaannya mati dan identitas break-glass dikecualikan.
9. **Q9 — Asosiasi native.** Konfirmasi asosiasi Digital Asset Links / `webcredentials` ditangani di dalam #1406, bukan di sini.

## Amandemen (22 November 2026)

Amandemen ini adalah hasil tinjauan keamanan yang disebut di baris Status. Sifatnya normatif. Tiap butir mencatat apa yang ada di `origin/main` hari ini agar pembaca dapat memeriksa premisnya.

**A1 (High, H1). Kode pemulihan milik principal dan tidak bergantung pada jenis faktor.** Kode diterbitkan saat principal mendaftarkan faktor pertamanya dari jenis apa pun, dan tidak dihapus ketika salah satu faktor dinonaktifkan. Perubahan skema menjadi bagian S2. Hari ini `awcms_principal_mfa_recovery_codes.factor_id` adalah `NOT NULL ... ON DELETE CASCADE` ke faktor TOTP (`sql/114`), dan `consumeRecoveryCode` (`src/modules/identity-access/application/principal-mfa-store.ts`) hanya berhasil selama faktor itu ber-`status = 'active'`. Principal yang satu-satunya faktor TOTP-nya diganti passkey akan kehilangan semua kode pemulihan.

**A2 (High, H2). Sesi mencatat cara ia di-step-up.** `awcms_sessions` mendapat `stepped_up_method` (`totp`, `recovery_code`, `passkey`) dan `stepped_up_passkey_id`, diisi oleh setiap penerbit sesi dan oleh `stepUpSession` (`src/modules/identity-access/application/mfa-session-assurance.ts`). Gerbang yang mensyaratkan passkey membacanya. Masa tenang pemulihan di §8 adalah `gate_eligible_at` per kredensial, dievaluasi di gerbang, bukan saat pendaftaran. Hari ini `sql/024` hanya punya `assurance_level` dan `stepped_up_at`, sehingga step-up kode pemulihan dan step-up passkey tak terbedakan.

**A3 (High, H3). Reset passkey ber-scope platform bila bisa melintasi tenant.** `identity_access.passkey_admin.reset` adalah izin ber-scope platform ([ADR-0053](0053-platform-scoped-permissions.id.md)) setiap kali principal sasaran punya identitas di tenant lain. Reset ber-scope tenant hanya menonaktifkan kredensial bagi tenant yang bertindak, dicatat di `disabled_by_tenant_id`. Maker/checker wajib. Alasannya: bootstrap memberi owner tenant semua izin katalog, sehingga sebuah izin hanya bisa tetap di luar peran tenant bila ber-scope platform (`src/modules/identity-access/domain/platform-scope.ts`).

**A4 (High, H4). Passkey sebagai faktor pertama adalah login kredensial lokal.** Ia tunduk pada `password_login_disabled` dan penegakan SSO di `evaluateTenantEntry` (`src/modules/identity-access/application/tenant-entry.ts`, yang sudah mengembalikan `password_login_disabled`). `passkey` adalah metode yang dapat dimatikan lewat pemeriksaan yang sama di tenant tujuan, sehingga perpindahan tenant tidak dapat dipakai untuk mencapai tenant yang telah menonaktifkan kredensial lokal.

**A5 (High, H5). Permukaan autentikasi hidup di satu host.** `/login`, `/admin/*`, dan endpoint upacara passkey hanya dilayani di host `APP_URL`. Host lain menerima 301 ke sana. Endpoint passkey menolak `Origin` lain. UI tidak pernah menawarkan fallback TOTP di host non-kanonik. Related Origin Requests tidak pernah diturunkan dari `awcms_tenant_domains`. Hari ini `src/middleware.ts` menjaga `/admin` lewat sesi (`PROTECTED_PREFIX`) tetapi tidak punya gerbang host untuk `/login` atau `/admin/*`; itulah sebabnya kalimat awal "domain kustom bukan origin autentikasi" adalah klaim tanpa mekanisme.

**A6 (Medium, M1 dan M2). Pemeriksaan verifier yang normatif.** Semuanya gagal-tertutup dengan satu galat seragam ke klien.

1. Hash byte mentah `clientDataJSON`. UTF-8 ketat, tolak BOM.
2. `type` persis. `challenge` base64url ketat, dicocokkan lewat digest DAN purpose DAN tenant DAN principal/sesi dalam `WHERE` konsumsi.
3. Daftar izin `origin` string persis. `crossOrigin` tidak ada atau false. `topOrigin` tidak ada.
4. `authData` minimal 37 byte. `rpIdHash` terhadap `rp_id` tersimpan per kredensial. UP=1 dan UV=1. AT dan ED menentukan parsing. `credentialId` paling banyak 1023 byte. Kunci COSE diparse sebagai tepat satu item CBOR, byte sisa ditolak. AT=0 pada assertion.
5. BE=0 berarti BS=0. BE tidak pernah berubah sejak registrasi.
6. `rawId` sama dengan credentialId di `authData` sama dengan `b64url(id)`. Galat kredensial duplikat seragam.
7. Konsistensi COSE `alg` dengan `kty`/`crv`: -7 dengan EC2 P-256, -8 dengan OKP Ed25519 (tanpa Ed448), -257 dengan RSA minimal 2048 bit dan e=65537. Algoritma selalu dari data tersimpan, bukan dari assertion. Tolak titik di luar kurva.
8. Tanda tangan ECDSA berformat DER. Verifikasi lewat `node:crypto` dengan `dsaEncoding: 'der'`, atau konverter DER ke P1363 yang ketat yang menolak encoding non-kanonik, r atau s sama dengan nol atau minimal n, dan byte sisa. Vektor Wycheproof, termasuk kelas CVE-2022-21449, wajib.
9. Kredensial assertion harus ada di `allowCredentials` yang tidak kosong. `userHandle` harus memetakan ke principal yang sama.
10. Batas CBOR: kedalaman paling banyak 4, tanpa panjang tak terhingga, tanpa tag, tanpa float, tanpa kunci map duplikat, integer paling banyak 2^53, input paling banyak sekitar 16 KiB.

`attestationObject.fmt` apa pun diterima, tetapi `attStmt` tidak pernah diverifikasi atau dipercaya. `fmt` dicatat untuk telemetri. Ini menggantikan kalimat "wajibkan `fmt = none`" di §5.5.

**A7 (Medium, M3). Sign counter.** Pembaruan adalah compare-and-set atomik (`UPDATE ... WHERE id = $id AND sign_count < $n RETURNING`). Karantina (`clone_suspected_at`) hanya berlaku bila BE=0. BE=1 (passkey tersinkron) dengan counter yang tidak maju ditolak dan diaudit pada `high`. Tidak ada "admin menghapus tanda": kloning yang dicurigai dicabut dan didaftarkan ulang.

**A8 (Medium, M4). Passkey adalah faktor aktif di setiap tempat faktor aktif dibaca.** Ia dihitung di `findActiveMfaFactor` (`src/modules/identity-access/application/mfa.ts`), `mfa-required-holders` dan `mfa-enrolment-gate` (keduanya di `src/modules/identity-access/application/`). Respons `mfa_challenge` mendaftar metode yang tersedia. Grant pendaftaran mengizinkan registrasi passkey. Faktor pertama principal memakai `reauthenticateForEnrollment` (`src/modules/identity-access/application/mfa-enrollment-reauth.ts`, #1004); faktor berikutnya memakai step-up.

**A9 (Medium, M5, M6 dan M9). Challenge dan kebersihan upacara.**

- TTL challenge bawaan adalah **300 dtk** (panduan batas waktu upacara WebAuthn, WCAG 2.2.1). Ini menggantikan 120 dtk di §5.1.
- `mfa_challenge_id` mengikat faktor kedua ke verifikasi kata sandi yang mendahuluinya.
- Opsi tanpa sesi mensyaratkan tenant eksplisit dan bucket per sumber.
- Pertimbangkan opsi stateless bertanda HMAC plus insert-saat-konsumsi (digest unik), sehingga upacara yang ditinggalkan tidak menulis apa pun.
- `expires_at` diindeks dan dicakup pembersihan data-lifecycle.
- Tidak ada `allowCredentials` dikembalikan sebelum autentikasi.
- Galat verifikasi seragam dan bekerja sama banyak. Kegagalan assertion tidak pernah dihitung ke penguncian TOTP.

**A10. Gerbang go/no-go S1.** S3 dan seterusnya tidak dimulai sebelum semuanya lulus.

- **G1:** tidak ada matematika kurva atau bigint buatan sendiri. Ketersediaan P-256, Ed25519, dan RSA dibuktikan pada Bun yang dipatok CI. Jangan mengiklankan -8 bila tidak ada.
- **G2:** vektor uji spesifikasi dan Wycheproof lulus 100%.
- **G3:** uji diferensial terhadap `@simplewebauthn/server` **di luar repositori ini** (matriks authenticator virtual CDP plus perangkat nyata), dengan nol ketidaksepakatan tak terjelaskan.
- **G4:** matriks merah: setiap pemeriksaan punya tes yang gagal bila pemeriksaan itu dihapus.
- **G5:** tes fuzz dan properti: tidak ada crash, tidak ada accept, paling banyak 1 ms per input.
- **G6:** modul murni paling banyak sekitar 600 baris tanpa dependensi.
- **G7:** tinjauan keamanan sebelum S3.

NO-GO berarti opsi B, lewat ADR dependensinya sendiri. Semuanya dikirim di balik `AUTH_PASSKEY_ENABLED=false`.

**A11 (Medium, M8). Definition of Ready.** Model ancaman, analisis privasi (templat), dan matriks izin ada sebelum irisan implementasi pertama. `user.id` adalah 32 sampai 64 byte acak per principal, tidak pernah e-mail atau login id. `user.name` dan `displayName` adalah PII yang disinkronkan ke vendor platform dan masuk analisis privasi.

**Butir Low (normatif).**

- `Permissions-Policy: publickey-credentials-create=(self), publickey-credentials-get=(self)`.
- Gagal-tertutup saat start bila `APP_URL` bawaan atau localhost di produksi, bukan https, punya port atau path, atau berupa alamat IP. Profil LAN ber-IP karenanya tidak bisa memakai passkey.
- Pemberitahuan di luar jalur pada SETIAP registrasi, dengan tautan "bukan saya" yang mencabut kredensial baru dan sesinya selama masa tenang.
- Setelah penghapusan subjek data, simpan hanya digest credential-id ([ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md)).
- Pertimbangkan Ed25519 yang terspesifikasi penuh (-19) di samping -8.
- `requireStepUp(..., { method: "phishing_resistant" })` adalah tindak lanjut setelah A2.
- Pengikatan perangkat untuk #1406 TIDAK boleh bersandar pada passkey; pakai kunci per-instalasi yang tak dapat diekspor (mirip DPoP).

**Kalimat yang digantikan.** Kalimat awal berikut diganti dan ditandai di tempatnya: klaim domain kustom di §2 (A5); TTL 120 dtk di §5.1 (A9); `fmt` harus `none` di §5.5 (A6); "admin menghapus tanda" di §5.4 (A7); "tidak di-seed ke peran tenant" dan maker/checker opsional di §8 (A3); login hanya passkey di rilis pertama (Q3).

## Jawaban atas Q1 sampai Q9 (22 November 2026)

- **Q1 (pustaka).** Opsi A (verifier sendiri di WebCrypto dan `node:crypto`), dijaga gerbang G1 sampai G7 (A10). `@simplewebauthn/server` hanya dipakai sebagai oracle diferensial di luar repositori. NO-GO berarti opsi B lewat ADR dependensinya sendiri.
- **Q2 (RP ID).** Host persis dari `APP_URL` yang tervalidasi. `rp_id` disimpan per kredensial. Related Origins tidak pernah diturunkan dari domain tenant. `config:validate` mengunci nilainya (lihat butir Low amandemen untuk pemeriksaan saat start).
- **Q3 (login hanya passkey).** Tidak ada login tanpa kata sandi di rilis pertama: hanya faktor kedua dan step-up. Tanpa kata sandi adalah irisan berikutnya, dengan ADR sendiri, setelah A4, A9, dan pengerasan opsi tanpa sesi di A9 (M5(b)).
- **Q4 (passkey tersinkron dan #1407).** Level 3 di #1407 berarti passkey apa pun plus TOTP; tidak pernah disebut "hanya perangkat keras", karena tanpa attestation BE=0 tak terbukti. Level terikat perangkat keras butuh ADR attestation sendiri.
- **Q5 (dua kredensial).** Dorongan secara bawaan. Tenant boleh menetapkan `min_passkeys = 2` hanya bila `passkey_required` menyala, ditegakkan pada DELETE kredensial dan lewat banner masa tenggang, tidak pernah sebagai penghalang login.
- **Q6 (reset admin).** Maker/checker wajib. Reset ber-scope platform bila sasarannya lintas-tenant (A3). Bawaan masa tenang berasal dari konfigurasi operator (24 jam, dengan batas bawah); tenant hanya boleh memperpanjangnya untuk gerbangnya sendiri, dan dievaluasi di gerbang (A2).
- **Q7 (`origin_auth`).** Tambahkan `passkey` ke CHECK `sql/117` pada `awcms_sessions.origin_auth` (hari ini lima nilai). `passkey` dapat dimatikan di bawah penegakan SSO tenant tujuan (A4), dan `reauthenticateForEnrollment` mendapat cabang passkey.
- **Q8 (bawaan kewajiban).** Bawaan mati; identitas break-glass dikecualikan. Menyimpan kebijakan memvalidasi minimal satu identitas break-glass aktif. Bentuknya meniru `awcms_tenant_mfa_policies`.
- **Q9 (asosiasi native).** Ditangani di #1406, dengan satu persyaratan ditambahkan di sini: host `APP_URL` melayani `/.well-known/assetlinks.json` dan `apple-app-site-association`, dan daftar izin origin menerima nilai `android:apk-key-hash:<b64url>` yang dikonfigurasi eksplisit, tidak pernah wildcard.

## Konsekuensi

- **Positif:** faktor tahan-phishing yang terikat perangkat; prasyarat #1407 terbuka; TOTP dan kode pemulihan tetap berfungsi, tanpa migrasi faktor yang ada.
- **Negatif:** verifier yang harus kita buktikan benar; pilihan RP ID yang praktis permanen; pemulihan adalah permukaan serangan baru yang butuh SOP dan pemeriksaan kesiapan sendiri; satu tabel global berkunci principal lagi yang kontrolnya harus dijaga sejalan dengan ADR-0087.
- **Netral:** CHECK `awcms_sessions.origin_auth` melebar satu nilai (Q7); `AccessAction` mendapat izin bergaya `passkey_admin.reset`; gerbang `security:readiness`, `config:env:coverage:check`, `data-lifecycle:*`, dan `subject-data:*` masing-masing mendapat entri.
- **Radius ledakan ADR itu sendiri:** nol. Tidak ada perubahan kode, migrasi, OpenAPI, atau dependensi bersama ADR ini. Amandemen memang mengubah apa yang harus dibangun irisan implementasi (A1 sampai A5 mengubah model data dan batas otorisasi).

## Garis besar implementasi (setelah diterima; ditulis di sini, tidak dibuka sebagai issue)

Setiap irisan berukuran S atau M dan dapat ditinjau mandiri. ADR Diterima dengan amandemen, dan gerbang Definition-of-Ready (A11) harus lulus. **S3 dan seterusnya diblokir sampai S1 lulus G1 sampai G7 (A10)**; NO-GO berarti opsi B lewat ADR dependensinya sendiri, bukan pengecualian. S2 membawa perubahan skema A1, A2, dan A3 (dan CHECK `sql/117` dari Q7). Semuanya dikirim di balik `AUTH_PASSKEY_ENABLED=false`.

| Irisan | Ukuran | Isi                                                                                                                                                                                                                                                                                                    |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1     | M      | **Spike verifier dan modul domain murni**: subset CBOR, urai COSE, urai authData, verifikasi tanda tangan, aturan counter, dijalankan terhadap vektor uji WebAuthn resmi dan pembanding dengan authenticator nyata serta satu implementasi acuan **di luar repo**. Gerbang: go/no-go opsi A. Tanpa DB. |
| S2     | S      | `sql/NNN` untuk `awcms_principal_passkeys` dan `awcms_passkey_challenges`, grant, FORCE RLS pada challenge, CHECK `origin_auth` (Q7), registrasi lifecycle dan subject-data, tes RLS/probe.                                                                                                            |
| S3     | M      | Endpoint registrasi dan pengelolaan (options, verify, list, rename, revoke), audit, idempotency, izin di-seed, OpenAPI, tes negatif (replay, origin salah, rpId salah, UV tidak ada, kredensial principal lain, lintas tenant).                                                                        |
| S4     | M      | Upacara autentikasi: faktor kedua, step-up, dan (bila Q3) login discoverable; sesi `aal2` dengan rotasi; tes regresi yang membuktikan `requireStepUp` dan TOTP tidak berubah.                                                                                                                          |
| S5     | M      | Pemulihan: aturan sesi pemulihan, masa tenang dan pemberitahuan, reset admin dengan step-up dan alasan (maker/checker sesuai Q6), kebijakan tenant dengan penjaga break-glass, perlindungan kredensial terakhir, SOP di `docs/awcms/`.                                                                 |
| S6     | S/M    | Layar admin di bawah `/admin/account` dan pilihan login, katalog i18n, a11y (conditional UI, `aria-live`, tanpa timer pendek), entri navigasi dalam perubahan yang sama dengan layarnya.                                                                                                               |
| S7     | S      | `docs/awcms/passkey-webauthn.md` (EN dan ID), pemeriksaan `security:readiness`, cakupan env, runbook, changeset.                                                                                                                                                                                       |

#1407 dimulai setelah S4 mendarat. #1406 membaca §2 untuk masukan asosiasi native dan tidak menunggu S5 sampai S7.

## Referensi

[#1405](https://github.com/ahliweb/awcms/issues/1405), [#1406](https://github.com/ahliweb/awcms/issues/1406), [#1407](https://github.com/ahliweb/awcms/issues/1407); [ADR-0027](0027-mfa-totp-session-assurance-step-up.id.md); [ADR-0028](0028-oidc-sso-tenant-aware-account-linking-break-glass.id.md); [ADR-0050](0050-bff-session-handoff-code.id.md); [ADR-0085](0085-one-human-one-credential-many-tenants.id.md); [ADR-0087](0087-mfa-moves-to-the-principal.id.md); [ADR-0106](0106-domain-verification-proves-control-of-the-zone.id.md); `sql/024_awcms_mfa_totp_schema.sql`, `sql/046_awcms_tenant_domain_schema.sql`, `sql/114_awcms_principal_mfa.sql`, `sql/117_awcms_delegated_access.sql` (CHECK origin_auth); `src/modules/identity-access/domain/mfa-policy.ts`; `src/modules/identity-access/application/mfa-session-assurance.ts`; `docs/awcms/mfa-totp-step-up.md`; W3C Web Authentication Level 3.
