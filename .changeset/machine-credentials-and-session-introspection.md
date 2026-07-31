---
"awcms": minor
---

Kredensial mesin baca-saja + `GET /api/v1/auth/session` — dua kontrak yang
menahan `awcms-astro`, dibangun sebagai satu desain (ADR-0049).

Satu-satunya bearer yang repo ini terima adalah token **sesi** ber-hash, dan
sebuah build tidak bisa memegangnya: sesi kedaluwarsa, dicabut seluruhnya saat
password reset, dan dirotasi step-up MFA. `.env.example` milik `awcms-astro`
menyuruh operator mengisi "a BUILD-TIME, READ-ONLY token" — instruksi untuk
menerbitkan sesuatu yang tidak bisa diterbitkan siapa pun, di repo mana pun di
keluarga ini.

**Kredensial MENGAUTENTIKASI; ia tidak pernah MENGOTORISASI.** Setiap baris
`awcms_machine_credentials` (`sql/082`, tenant-scoped, `FORCE` RLS, FK komposit)
terikat pada satu `awcms_tenant_users` yang sudah ada. Setelah prinsipalnya
resolve, rantai module-enabled → RBAC → ABAC → decision log → SoD berjalan apa
adanya. Kredensial yang membawa daftar izinnya sendiri akan menjadi permukaan
otorisasi KEDUA — persis yang ADR-0048 §1 larang.

Tiga pembatas, semuanya fail-closed:

- **Menyempitkan, tak pernah melebarkan.** Izin efektif = irisan
  `allowed_permission_keys` dengan izin service account. Menambah role ke akun
  itu tidak melebarkan kredensial yang sudah terbit; daftar kosong berarti tidak
  bisa apa-apa, bukan "tanpa batas".
- **Baca-saja**, diputus SEBELUM izin dilihat dan terlepas dari apa pun yang
  dipegang akunnya — token yang bocor tak bisa mengubah apa pun walau diarahkan
  ke `owner`.
- **Kedaluwarsa wajib** (maks 365 hari) dan pencabutan berlaku pada permintaan
  berikutnya, karena autentikasi membaca baris yang sama. Itulah yang token buram
  ber-hash beli dan JWT bertanda tangan tidak punya jawabannya.

**Token membawa tenant-nya sendiri** (`awcmsm_<tenantIdHex>_<rahasia>`), jadi
klien build cukup satu env var dan header tenant tidak lagi relevan untuknya —
menutup cacat header ADR-0047 tanpa menambah alias `X-Tenant-Code` yang setiap
rute masa depan harus ingat menghormatinya. Hash-nya ber-ruang-nama
`mc-sha256:`, dan `hashSessionToken()` men-dispatch pada prefix token, sehingga
183 rute yang sudah memanggilnya mendapat dukungan ini tanpa satu pun perubahan
tanda tangan — dan satu jenis bearer tak pernah bisa dicari di ruang nama
jenis lain.

`GET /api/v1/auth/session` mengembalikan klaim aman saja untuk BFF lintas-origin
(`identityId`/`tenantId`/`displayName`/`roles`/`assuranceLevel`/`expiresAt`/`scopes`)
— bukan duplikat `/auth/me`, yang justru mengembalikan email mentah dan diam soal
peran/assurance/kedaluwarsa. Satu bentuk 401 untuk setiap kegagalan, termasuk
saat yang disodorkan kredensial mesin, supaya endpoint ini tak bisa dipakai
mengklasifikasi bearer. Ia memperkenalkan `defineSelfServiceTenantRoute` —
seam untuk rute terautentikasi yang subjeknya pemanggil itu sendiri, sehingga
`workClass` tetap wajib dan `api:tenant-route:check` tetap satu-arah alih-alih
menumbuhkan allowlist kedua.

Decision log mendapat `machine_credential_id` nullable: beberapa kredensial boleh
menunjuk service account yang sama, jadi tanpa kolom itu "token yang MANA yang
membaca ini" tak punya jawaban.

Diverifikasi terhadap PostgreSQL nyata (83 migrasi bersih, 18 test integrasi) —
dan verifikasi itulah yang menemukan jebakan yang lolos typecheck: **`Bun.SQL`
tidak mem-bind array JS sebagai array Postgres**. `${["a","b"]}` sampai ke server
sebagai teks `a,b` (22P02), dan bentuk satu elemen paling berbahaya karena tiba
sebagai `a` yang terlihat seperti string biasa.

Dicatat sebagai divergence keluarga di `awcms-family-compatibility.yaml` **saat
mendarat**, sesuai ADR-0047 §4 — fitur fondasi pertama yang dirintis langsung di
sini selama pembekuan `awcms-mini`/`awcms-micro`.

Security review pra-merge menemukan dua hal dan menutup keduanya: deaktivasi
service account kini **langsung** mematikan kredensialnya (jalur mesin
mensyaratkan status tenant-user **dan** identitas aktif — sengaja lebih ketat
dari jalur sesi, karena tak ada apa pun yang mencabut kredensial saat akun
dinonaktifkan dan umurnya bisa setahun), dan respons penerbitan kini
`private, no-store` karena badannya membawa kredensial hidup. Yang pertama
dibuktikan dengan mengembalikan cacatnya: dua test integrasi merah, lalu hijau
lagi setelah dipulihkan.
