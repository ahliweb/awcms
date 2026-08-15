🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0049-machine-credentials-and-session-introspection.md)

<!-- i18n-source-hash: sha256:8cf655a6ea2e11d4e541bd6c5561faae31921e381f9fd6973307cabfbc9f2491 -->

# ADR-0049 — Kredensial mesin baca-saja (service account bearer) + introspeksi sesi lintas-origin

- **Status:** Accepted
- **Tanggal:** 2026-08-01
- **Pengambil keputusan:** @ahliweb
- **Menutup:** [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) §Konsekuensi — dua kontrak yang menahan `awcms-astro`, yang ADR itu sebut "satu percakapan desain, bukan dua"
- **Melaksanakan:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (endpoint introspeksi sesi milik `identity_access`; desain permukaannya di [`../awcms/jualanku/05-kontrak-sesi-dan-bff.md`](../awcms/jualanku/05-kontrak-sesi-dan-bff.md) §3)
- **Terikat pada:** [ADR-0048](0048-frontend-role-split-awcms-astro-internal-admin.md) §1 — memindahkan layar tidak memindahkan izinnya; permukaan otorisasi tetap SATU
- **Fitur fondasi pertama yang dirintis langsung di sini** di bawah rezim ADR-0047 §2, karena itu wajib memenuhi §3 (ADR, review keamanan `auth`/`access`, `bun run check` penuh, RLS `FORCE`, ABAC default-deny) dan §4 (dicatat sebagai divergence di [`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml) **saat mendarat**)

## Konteks

Satu-satunya bearer yang diterima repo ini adalah **token sesi** ber-hash
(`awcms_sessions`, `sql/004`). Sebuah proses build tidak bisa memegangnya, dan
bukan karena kebetulan konfigurasi:

- sesi **kedaluwarsa** dan tidak diperpanjang oleh pemakaian;
- reset password **mencabut seluruh sesi** identitas itu (`sql/073`) — build
  akan mati diam-diam setiap kali seorang manusia mengganti passwordnya;
- step-up MFA **merotasi** token sesi (`sql/024`, anti-fixation);
- sesi terikat pada satu identitas manusia, sehingga "siapa yang menarik konten
  ini" selamanya terjawab dengan nama seseorang.

`.env.example` milik `awcms-astro` menyuruh operator mengisi "a BUILD-TIME,
READ-ONLY token" — instruksi untuk menerbitkan sesuatu yang **tidak bisa
diterbitkan siapa pun**, di repo mana pun di keluarga ini. ADR-0047
memverifikasinya terhadap staging, bukan menyimpulkannya dari dokumen.

Kebutuhan kedua datang dari arah berlawanan. BFF `awcms-astro` memegang token
sesi milik pengguna dan perlu menanyakan "sesi ini masih hidup? milik siapa?
perannya apa?" tanpa menyentuh basis data `awcms` dan tanpa menaruh token di
browser. ADR-0045 sudah memutuskan endpointnya; kodenya tidak pernah ditulis.

Keduanya bertemu di titik yang sama: **apa yang berhak dilakukan sebuah
pemanggil yang bukan manusia**. Karena itu satu ADR, bukan dua.

## Keputusan

### 1. Kredensial mesin MENGAUTENTIKASI; ia tidak pernah MENGOTORISASI

Tabel baru `awcms_machine_credentials` (tenant-scoped, `FORCE` RLS) menyimpan
hash token, dan setiap baris **terikat pada satu `awcms_tenant_users` yang sudah
ada** — sebuah service account. Setelah prinsipal itu di-resolve, seluruh rantai
di bawahnya **tidak berubah sama sekali**: `resolveModuleEnabled` →
`fetchGrantedPermissionKeys` → `evaluateAccess` (RBAC + ABAC DSL, default-deny,
deny-overrides-allow) → decision log → chokepoint SoD.

Alternatif "kredensial membawa daftar izinnya sendiri" **ditolak**: itu
permukaan otorisasi KEDUA, persis yang ADR-0048 §1 larang. Yang boleh
dilakukan sebuah kredensial harus dijawab oleh mesin izin yang sama dengan yang
menjawab pertanyaan itu untuk manusia.

### 2. Cakupannya hanya bisa MENYEMPITKAN, tidak pernah melebarkan

`allowed_permission_keys text[]` wajib ada dan wajib tidak kosong. Izin efektif
sebuah kredensial adalah **irisan**:

```
efektif = izin_service_account  ∩  allowed_permission_keys
```

Menambahkan role ke service account **tidak** melebarkan kredensial yang sudah
terbit. Daftar kosong berarti tidak bisa apa-apa (fail-closed), bukan
"tanpa batas" — arah default yang berlawanan adalah cara sebuah allow-list
berubah menjadi hiasan.

### 3. BACA-SAJA, ditegakkan sebelum izin dilihat sama sekali

Permintaan yang diautentikasi kredensial mesin **ditolak** kecuali
`guard.action` ada di allow-list baca-saja, yang hari ini berisi tepat satu
nilai: `read`. Penolakan terjadi di chokepoint yang sama
(`authorizeInTransaction`), **sebelum** pencarian izin, dan **tidak bergantung**
pada apa pun yang dipegang service account.

Konsekuensinya yang disengaja: token build yang bocor tidak bisa mengubah apa
pun — bahkan bila operator salah mengarahkannya ke akun `owner`. Melebarkan
allow-list ini butuh ADR-nya sendiri; ia bukan konstanta yang boleh ditambah
sambil lalu.

### 4. Token membawa tenant-nya sendiri

Format: `awcmsm_<tenantIdHex32>_<rahasia base64url 32 byte>`. Prefix `awcmsm_`
**tidak rahasia** dan berfungsi sebagai diskriminator: sebuah token dikenali
sebagai token mesin **sebelum** query apa pun, jadi tetap satu pencarian per
permintaan dan sebuah token mesin tak pernah bisa dicari di ruang nama tabel
sesi (atau sebaliknya). Yang disimpan tetap hanya SHA-256-nya.

Ini juga yang menutup cacat kontrak PERTAMA di ADR-0047 untuk klien build:
tenant diturunkan **dari token**, sehingga build hanya butuh satu variabel
lingkungan dan header tenant tidak lagi relevan untuknya. Bila header tenant
tetap dikirim dan berbeda, **token yang menang** dan headernya diabaikan — ia
input tak-terautentikasi, dan kredensial itu memang hanya berlaku untuk
tenant-nya sendiri, jadi mengabaikannya tidak bisa menaikkan hak apa pun.

**Header kanonis untuk sesi manusia tetap `x-awcms-tenant-id` — tidak ada alias
baru.** Menambahkan `X-Tenant-Code`/`X-Tenant-Id` berarti setiap rute di masa
depan wajib menghormati tiga ejaan, dan sebuah alias yang terlewat di satu rute
adalah 400 yang membingungkan, bukan kegagalan yang jelas. Pemanggil manusia
lintas-origin adalah BFF, yang menurunkan tenant dari host — bukan dari
tebakan klien.

### 5. Kedaluwarsa wajib, pencabutan langsung, pemakaian terlihat

`expires_at` `NOT NULL` (batas atas 365 hari, ditegakkan domain): tidak ada
kredensial abadi. Pencabutan berlaku pada permintaan berikutnya karena
pencarian membaca baris yang sama — inilah alasan token buram ber-hash dipilih
alih-alih JWT bertanda tangan, yang tidak punya jawaban untuk "cabut sekarang"
tanpa daftar yang harus dibaca juga.

Deaktivasi service account berlaku **seketika**: jalur mesin mensyaratkan
`awcms_tenant_users.status` dan `awcms_identities.status` aktif — sengaja lebih
ketat dari jalur sesi, yang tidak memeriksa keduanya tetapi dibatasi masa
berlaku sesi. Tidak ada apa pun yang mencabut kredensial saat sebuah akun
dinonaktifkan, jadi mewarisi kelonggaran itu berarti meninggalkan kunci yang
masih bekerja selama berbulan-bulan. Lebih ketat hanya bisa menolak; ia tak
pernah bisa memberi apa yang jalur sesi tolak.

`last_used_at` diperbarui **paling sering sekali per jam** (satu `UPDATE`
bersyarat), supaya kredensial yang menganggur atau bocor bisa terlihat tanpa
menambahkan satu tulisan ke setiap permintaan baca.

Plaintext hanya ditampilkan **sekali** saat penerbitan dan tidak pernah bisa
diambil lagi. Tidak ada "petunjuk" potongan token yang disimpan: ia tidak
menambah kemampuan identifikasi apa pun di atas `id`+`name`, dan ia adalah
bahan rahasia.

### 6. Decision log mencatat kredensialnya, bukan hanya akunnya

`awcms_abac_decision_logs` mendapat kolom nullable `machine_credential_id`.
Tanpa itu, pertanyaan forensik yang sebenarnya — "**token yang mana** yang
membaca ini" — tak punya jawaban, karena beberapa kredensial boleh menunjuk
service account yang sama.

### 7. `GET /api/v1/auth/session` — introspeksi, khusus sesi

Milik `identity_access`. Menerima **hanya token sesi**; kredensial mesin
mendapat 401 generik yang sama seperti token tak dikenal (kredensial mesin tak
punya sesi untuk diintrospeksi, dan membedakannya akan menjadikan endpoint ini
oracle jenis-token).

Mengembalikan **klaim aman saja**: `identityId`, `tenantId`, `displayName`,
`roles[]`, `assuranceLevel`, `expiresAt`, `scopes[]`. Tidak pernah
mengembalikan token, hash token, status password, secret/recovery MFA, atau
identifier mentah (email/telepon). Sesi tidak ada, kedaluwarsa, dan dicabut
menghasilkan **satu bentuk respons yang sama**. `Cache-Control: private,
no-store`, dan dibatasi laju lewat `src/lib/security/rate-limit.ts`.

Ia **bukan** duplikat `GET /api/v1/auth/me`: `me` mengembalikan
`loginIdentifier` mentah (email) dan tidak menyebut peran/assurance/kedaluwarsa
— tepat kebalikan dari yang boleh dilihat header portal publik.

### 8. Penerbitan & pencabutan adalah aksi admin ter-audit

Aktivitas permission baru `machine_credentials` dengan `read`/`create`/`revoke`
— bukan pelebaran `access_control`. Alasannya sama dengan yang dicatat
`sql/075` untuk `registration_requests`: menerbitkan kredensial yang bisa
membaca data tenant tanpa manusia adalah otoritas tersendiri, dan menggabungkannya
ke `access_control.configure` akan menjadikan setiap penyunting role sebagai
penerbit kredensial sebagai efek samping. `create` dan `revoke` terpisah karena
hanya satu di antaranya yang menciptakan kemampuan baru.

## Konsekuensi

**Yang terbuka.** `awcms-astro` bisa menarik konten terbit saat build dengan
satu env var, dan BFF-nya bisa memvalidasi sesi portal tanpa menyentuh basis
data `awcms`. Keduanya adalah "korban" yang ADR-0047 sebut namanya.

**Rute lama ikut aman tanpa disentuh.** Penegakan ada di
`authorizeInTransaction` dan penurunan tenant ada di `resolveAuthInputs` — dua
fungsi yang SEMUA rute lewati, baik yang memakai `defineTenantRoute` maupun 200-an
rute yang masih menulis rantainya sendiri. Rute yang membaca header tenant
langsung tanpa `resolveAuthInputs` (mis. `/api/v1/auth/me`) tidak mengenal token
mesin sama sekali dan menolaknya — arah kegagalan yang benar.

**Biaya yang diterima — divergence keluarga.** `awcms-mini`/`awcms-micro` tidak
punya konsep ini. Dicatat di `awcms-family-compatibility.yaml` saat mendarat,
sesuai ADR-0047 §4; repatriasinya dibahas ADR pemulangan nanti.

**Risiko yang dinamai supaya bisa ditolak.** "Baca-saja" mudah dibaca sebagai
"tidak berbahaya". Ia tetap kredensial yang membaca data tenant tanpa manusia
di belakangnya: kebocoran = kebocoran data, bukan sekadar gangguan. Karena itu
kedaluwarsanya wajib, cakupannya wajib disempitkan, pemakaiannya terlihat, dan
penerbitannya ter-audit.

## Alternatif yang dipertimbangkan

**JWT/kunci asimetris.** Ditolak: tanpa daftar pencabutan ia tidak bisa dicabut,
dan begitu daftar itu ada, keunggulan "tanpa lookup"-nya hilang — sementara
token buram ber-hash sudah menjadi pola sesi repo ini.

**Menumpang `awcms_sessions` dengan kolom `kind`.** Ditolak: setiap invarian
tabel itu mengandaikan manusia. "Cabut semua sesi saat reset password" akan
mematikan build; rotasi step-up mengandaikan ada yang bisa melakukan step-up.

**Membangunnya di `awcms-astro`.** Ditolak ulang (ADR-0047 §Alternatif):
`awcms-astro` tidak punya basis data dan bukan penerbit identitas. ADR-0048
memberinya layar internal, bukan identity store.

**Menerima `X-Tenant-Code` sebagai alias.** Ditolak — lihat §4.
