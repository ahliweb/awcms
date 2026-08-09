# ADR-0073 — `suspended` adalah status LAYANAN, bukan status login

- **Status:** Accepted
- **Tanggal:** 2026-08-09
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #429 (Gelombang 0 dari #423), [`../awcms/program-model-keanggotaan-2026-08-09.md`](../awcms/program-model-keanggotaan-2026-08-09.md), [ADR-0053](0053-platform-scoped-permissions.md) (gerbang platform-scope + prinsip deklarasi sisi-kode), [ADR-0054](0054-tenant-provisioning.md) §2 (kenapa tindakan lintas-tenant platform-scoped), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (kredensial mesin berumur sampai setahun)

## Konteks

### 1. Enum yang tidak pernah ditegakkan

`awcms_tenants.status` menerima `'suspended'` sejak `sql/002`. Nilai itu dibaca
di **empat** tempat — `identity-access/domain/login-policy.ts`,
`application/password-reset.ts`, `application/self-registration.ts`, dan
`pages/api/v1/auth/sso/[providerKey]/start.ts` — ditambah resolver host publik
dan resolver tenant platform.

`authorizeInTransaction` **tidak pernah membacanya**.

### 2. Asimetrinya mengarah ke sisi yang salah

| Permukaan                        | Setelah suspend, sebelum ADR ini                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Situs publik tenant              | **mati seketika** (resolver host menuntut `status = 'active'`)                                   |
| Login baru                       | ditolak                                                                                          |
| **Sesi admin yang sudah terbit** | **penuh akses sampai kedaluwarsa sendiri**                                                       |
| **Machine credential**           | **tidak tersentuh** — jalurnya tak pernah menyentuh `awcms_tenants`, dan umurnya sampai 365 hari |

Pelanggan yang ditangguhkan kehilangan hal yang **dilihat pengunjungnya** dan
mempertahankan hal yang **bisa mengubah datanya**. Untuk penangguhan karena
penyalahgunaan atau perintah hukum, "situsnya kami matikan tetapi stafnya masih
bisa menulis lewat API" bukan penangguhan.

### 3. Kenapa ini murah

`resolveTenantContext` **tidak** membaca `awcms_tenants` — asumsi awal issue-nya
keliru di titik itu. Tetapi `awcms_tenants` adalah tabel akar yang sengaja
RLS-free (ADR-0003), jadi ia bisa di-JOIN pada query tenant-user yang **sudah**
berjalan. Statusnya karena itu ikut terbawa **tanpa round-trip tambahan**.

### 4. Gerbang yang bisa dibatalkan satu baris UPDATE bukan gerbang

Prinsip yang sama sudah ditulis ADR-0053 §3 untuk gerbang platform-scope: kolom
basis data memutuskan **siapa yang diberi**, kode memutuskan **apakah gerbangnya
ditanyakan**. Allow-list "apa yang masih boleh saat ditangguhkan" karena itu
adalah deklarasi kode, bukan setting.

## Keputusan

Kami memutuskan untuk:

**A. Menegakkan status layanan tenant di chokepoint**, untuk sesi **dan**
machine credential, dengan `403 TENANT_SUSPENDED` dan
`matchedPolicy: "tenant_suspended"`. Diputuskan **sebelum** permission dicari —
alasan yang sama dipakai penolakan read-only machine credential tepat di
bawahnya: jawabannya tidak boleh bisa bergantung pada apa yang dipegang aktor.

Tidak ada sapuan pencabutan sesi, dan tidak diperlukan: pemeriksaannya pada
**tenant**, bukan pada kredensial, jadi setiap sesi hidup dan setiap machine
credential ditolak sejak permintaan berikutnya.

**B. Memperlakukan `inactive` sama dengan `suspended`.** `sql/002` menerima
`active | inactive | suspended`; jalur login sudah menolak apa pun yang bukan
`active`. Menegakkan satu status dan membiarkan satu lagi dilayani akan
memperkenalkan ulang asimetri §2 dalam bentuk yang lebih kecil.

**C. Memblokir shell admin untuk tenant yang layanannya berhenti**, di
`resolveSsrContext`. Satu baris di sana mencakup ke-32 layar, karena
`src/middleware.ts` merutekan setiap `/admin/*` melaluinya. Tanpa ini, penegakan
di §A menghentikan API dan meninggalkan seluruh UI admin hidup — yaitu sebagian
besar dari yang dilihat operator.

**D. Allow-list berbasis PERMISSION KEY, dideklarasikan di kode.** Unitnya kunci
penuh, bukan `AccessAction`: mengizinkan `read` akan membuka setiap permukaan
baca di setiap modul, yang adalah sebagian besar produk. Melebarkan daftar itu
**butuh ADR**, disiplin yang sama dibawa `MACHINE_CREDENTIAL_ALLOWED_ACTIONS`.

**E. Tenant PLATFORM dikecualikan, dua lapis.** Kontrol yang bisa merusak
remedinya sendiri bukan kontrol.

Ini menuntut resolver baru. `resolvePlatformTenant` sengaja menuntut
`status = 'active'` supaya "tak ada yang jadi platform" tidak pernah terbaca
"semua orang jadi platform" — benar untuk **otoritas**, dan salah untuk
pengecualian ini: platform tenant yang ter-suspend akan membuat resolvernya
mengembalikan `null`, pengecualiannya bernilai false, dan operatornya ditolak
untuk **setiap** aksi termasuk yang akan mengangkat penangguhan itu.
`resolvePlatformTenantIdIgnoringStatus` menjawab pertanyaan yang berbeda —
"tenant mana yang memegang otoritas platform" — dan tidak memberi apa pun:
permission platform-scoped tetap lewat `resolvePlatformTenant` dan cek aktifnya,
tak berubah.

Lapis kedua: endpoint `suspend` **menolak** menangguhkan tenant platform dengan
`409 PLATFORM_TENANT_PROTECTED` — pesan yang bisa dipahami, alih-alih pintu
terkunci.

**F. `disable` dan `restore` adalah DUA permission**, keduanya `scope: platform`.
Saat insiden Anda menginginkan orang yang bisa mengembalikan pelanggan **tanpa**
bisa memutus pelanggan — pemisahan yang sama sudah ditarik `machine_credentials`
antara `create` dan `revoke`.

## Konsekuensi

- **Positif:** penangguhan menjadi nyata di seluruh permukaan; machine
  credential berumur setahun berhenti menjadi lubang; transisinya tercatat
  append-only di jejak audit tenant **target**, sehingga pelanggan bisa melihat
  layanannya dihentikan, oleh siapa, dan kenapa.
- **Negatif / trade-off:** blok SSR bersifat semua-atau-tidak, tidak seperti
  allow-list per-permission di chokepoint. Hari ini tidak ada layar yang
  dibutuhkan tenant tertangguh (penagihan datang di Gelombang 5); ketika ada,
  cabang itu harus menumbuhkan allow-list yang sama. Dicatat di kodenya supaya
  ditemukan saat itu.
- **Negatif:** tenant tertangguh yang membuka `/admin` dialihkan ke `/login`,
  yang lalu juga menolaknya. Pesannya buruk. Ia tetap jauh lebih baik daripada
  akses admin penuh, dan memperbaikinya adalah pekerjaan layar.
- **Netral:** dua permission baru mencapai tenant SETUP lewat migrasi. Deployment
  yang tenant platform-nya bukan tenant setup wajib menjalankan
  `bun run identity-access:permissions:backfill` — jebakan yang sudah tercatat.
- **Netral:** tombolnya belum ada. `/admin/tenants` sudah mendaftar setiap tenant
  beserta statusnya, jadi itu suntingan layar, bukan permukaan baru; kedua kunci
  masuk `NOT_YET_SCREENED` yang hanya boleh menyusut.

## Alternatif yang dipertimbangkan

- **Mencabut semua sesi saat suspend, alih-alih memeriksa di chokepoint** —
  ditolak. Ia tidak menyentuh machine credential sama sekali, dan sebuah sapuan
  adalah kejadian sekali yang bisa dilewati kredensial yang terbit setelahnya.
  Memeriksa tenant menutup keduanya, selamanya, tanpa pekerjaan latar.
- **Menegakkan hanya `suspended`, membiarkan `inactive`** — ditolak, §B.
- **Allow-list berbasis `AccessAction`** — ditolak, §D: terlalu kasar sampai tak
  bermakna.
- **Allow-list sebagai kolom/pengaturan** — ditolak, §4. Penangguhan yang bisa
  dibatalkan diam-diam oleh sebuah baris bukan penangguhan.
- **Satu permission untuk suspend dan restore** — ditolak, §F.
- **Mengizinkan penangguhan tenant platform, dengan peringatan** — ditolak, §E.
  Tidak ada pemulihan in-band, dan sebuah peringatan bukan kontrol.
