# ADR-0083 — Template ini men-deploy ke SATU environment, dan akarnya bukan 404

- **Status:** Diterima (2026-08-11).
- **Amandemen (11 Agustus 2026, sebelum ADR ini di-commit dan dirilis):** versi
  pertama ADR ini **mempertahankan** `staging` sebagai
  `ModuleDeploymentProfile` yang sah dan menolak penghapusannya. Pemilik repo
  membatalkan posisi itu; keputusan yang berlaku adalah `staging` **dihapus
  seluruhnya**. Alasan yang di-override tidak dihapus — ia tercatat utuh di
  §"Posisi yang di-override".
- **Konteks:** Audit kesiapan deploy 11 Agustus 2026 (putaran keenam,
  `docs/PROJECT_STATE.md` §4). Tanpa migrasi.
- **Mengubah:**
  [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
  — konsekuensi "`/` adalah 404" dicabut, lihat §"Akar berhenti menjadi 404".
- **Membangun di atas:**
  [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (pengembangan
  terbatas di dua repo) dan
  [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)
  (pembagian peran dengan `awcms-astro`).

## Keputusan

Repo ini punya **tepat satu deployment hidup**: **production** di
`awcms.ahlikoding.com`. Tidak ada staging miliknya sendiri.

`staging` **DIHAPUS seluruhnya** dari `ModuleDeploymentProfile` di
`src/modules/_shared/module-contract.ts`. Union-nya menjadi `development |
production | offline-lan`. Yang hilang bukan cuma environment kedua milik repo
ini, melainkan **profilnya**: nama `staging` berhenti ada di kontrak modul, di
dokumen profil, dan di setiap rujukan yang mengikutinya.

Keputusan itu diambil pemilik repo setelah menimbang posisi sebaliknya — posisi
yang ADR ini tulis lebih dulu dan kini catat di §"Posisi yang di-override".
Yang menentukan: sebuah template yang membawa profil yang **deployment
acuannya sendiri tidak pakai** adalah profil yang tidak pernah dijalankan siapa
pun di sini, dan **profil deployment yang tak pernah dijalankan itu klaim,
bukan kapabilitas**.

## Posisi yang di-override

Versi pertama ADR ini memutuskan sebaliknya, dan argumennya ditulis ulang di
sini **utuh, bukan dihapus**. ADR di repo ini bernilai justru karena alternatif
yang ditolak beserta alasannya ikut tersimpan; pembalikan yang menghapus
jejaknya memaksa orang berikutnya menurunkan ulang seluruh pertimbangan dari
nol — dan orang berikutnya biasanya menurunkan yang berbeda.

**Yang dulu diputuskan.** `staging` TETAP salah satu profil yang sah. Yang
berubah cuma **topologi deployment repo ini**, bukan kapabilitas templatenya.
Instalasi turunan yang dibangun dari template ini melayani bisnis sungguhan,
punya data dan trafik yang memang pantas dilatih dulu, dan berhak atas keempat
profil itu beserta seluruh kontrak isolasi staging yang sudah tertulis.
Menghapus `staging` dari union tipe berarti **mencabut sesuatu dari setiap
pemakai template demi menyederhanakan satu deployment demonstrasi** — dan
perbedaan itu disebut sebagai keseluruhan alasan ADR ini aman.

**Kenapa pemilik repo membatalkannya.** Argumen di atas berdiri di atas satu
premis yang tidak pernah diperiksa: bahwa sebuah nama di union tipe adalah
kapabilitas. Ia bukan. `ModuleDeploymentProfile` dibandingkan sebagai string
biasa oleh `module-composition.ts`, dan komentar di berkas kontraknya sendiri
sudah mengakui bahwa sinkronisasi daftar itu dengan dokumen profil adalah
"kewajiban dokumentasi, bukan ditegakkan compile-time". Jadi yang sesungguhnya
ditawarkan `staging` kepada instalasi turunan adalah **sebuah label dan
sepotong prosedur** — keduanya tetap bisa mereka tulis sendiri, dan prosedurnya
tetap tertulis (lihat §Konsekuensi). Yang tidak bisa mereka pinjam adalah bukti
bahwa label itu masih benar: tidak ada satu pun deployment yang menjalankannya,
tidak ada gerbang yang memerah ketika ia membusuk, dan tidak ada orang yang
akan menyadarinya. Repo ini punya riwayat panjang dokumen percaya-diri yang
menjelaskan dunia yang tidak ada — §"Apa yang sebenarnya dikoreksi ADR ini" di
bawah adalah contoh yang baru saja mahal. Mempertahankan `staging` berarti
menyimpan satu lagi, kali ini di dalam tipe.

## Kenapa sebuah template tidak butuh staging-nya sendiri

Staging ada untuk **melatih perubahan terhadap data dan trafik sungguhan sebelum
menyentuhnya**. Repo ini tidak punya keduanya: deployment hidupnya ada untuk
menunjukkan dan memvalidasi template, bukan melayani bisnis. Yang akan
"di-stage" adalah templatenya sendiri — dan template divalidasi oleh rantai 39
gerbang plus suite integrasi ber-Postgres di CI, bukan oleh salinan kedua yang
berjalan.

Maka staging di sini bukan jaring pengaman, melainkan **environment kedua yang
harus dirawat**: satu set secret lagi, satu database lagi yang butuh backup, satu
antrean migrasi lagi, satu domain lagi, dan satu tempat lagi yang bisa
diam-diam basi. Biaya itu nyata dan berulang; imbalannya nol.

## Apa yang sebenarnya dikoreksi ADR ini

Yang mendorong ADR ini bukan preferensi arsitektural. Per 11 Agustus 2026,
**kenyataan sudah berbeda dari dokumen, dan dokumennya yang kalah**:

- Baris aplikasi produksi (`got4etcblum9kowdv4mrixqo`) **tidak ada** di tabel
  `applications` Coolify — bukan soft-delete; `deleted_at` pun tidak ada.
- Tidak ada database produksi di `standalone_postgresqls`; yang ada hanya
  `awcms_staging`.
- Container `awcms-staging-varnish` memasang rule Traefik
  ``Host(`awcms-staging.ahlikoding.com`) || Host(`awcms.ahlikoding.com`)``,
  sehingga **domain produksi dilayani deployment staging di atas database
  staging** (`APP_ENV=staging`).

Jadi topologi dua-environment sudah berhenti berlaku beberapa waktu lalu, dan
`docs/awcms/environments.md` terus menjelaskan dunia yang tidak ada. ADR ini
membuat dokumen dan kenyataan sepakat **dengan memilih satu**, bukan dengan
membangun kembali yang kedua.

Ada pelajaran operasional yang ikut dicatat karena ia menyesatkan selama
berjam-jam: `https://awcms.ahlikoding.com` menjawab **200**, sehat, sepanjang
waktu itu. **Respons 200 di domain produksi bukan bukti produksi hidup.**
Verifikasi kepada `applications`/`standalone_postgresqls`, bukan kepada `curl`.

## Akar berhenti menjadi 404

[ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
menerima `/` = 404 dengan premis yang dinyatakan terbuka: `awcms-astro` yang
memikul halaman publik, jadi akar domain bukan milik aplikasi ini.

Premis itu benar untuk sebuah **situs**. Ia tidak benar untuk **domain
deployment template ini sendiri**: tidak ada `awcms-astro` di depan
`awcms.ahlikoding.com` (per hari ini kedua app `awcms-astro` di host itu
berstatus `exited`), jadi pintu depan domain itu adalah aplikasi ini. Dan
sebuah pintu depan yang menjawab 404 kepada siapa pun yang mengetik nama
domainnya adalah cacat, bukan keputusan.

Karena itu `src/pages/index.astro` melayani **halaman landing informasional**:
apa itu AWCMS, apa yang ada di dalamnya, dan tautan ke `/login`. Batasnya
sengaja sempit, dan tiap batas menjawab sesuatu:

- **Tanpa data tenant.** Halaman ini hidup di akar domain deployment, bukan di
  dalam sebuah tenant. Membacanya dari basis data akan membuat pintu depan
  bergantung pada resolusi tenant yang (per `PUBLIC_TENANT_RESOLUTION_MODE`
  kosong) memang tidak menyala.
- **Tanpa skrip klien BARU.** Satu-satunya skrip di halaman ini adalah
  `THEME_INIT_SCRIPT_BODY` yang sudah ada — hash-nya sudah berada di `script-src`
  tanpa syarat, jadi CSP tidak berubah sama sekali dan tidak ada bookkeeping
  hash baru. Ia dipakai karena tanpanya halaman ini akan mengabaikan preferensi
  gelap/terang pengunjung; menulis ulang paletnya di blok
  `prefers-color-scheme` sendiri akan menduplikasi token dan membuat dua sumber
  kebenaran warna.
- **Tanpa enumerasi.** Tidak menyebut nama tenant, jumlah tenant, versi, atau
  status modul kepada pengunjung anonim. `/login` sudah memutuskan sendiri
  seberapa banyak yang ia tampilkan (ADR sebelumnya: picker tenant ber-plafon);
  halaman ini tidak menambah permukaan itu.
- **`noindex` TIDAK dipasang.** Ini satu-satunya halaman di repo ini yang
  memang pantas terindeks: ia mendeskripsikan template, bukan data siapa pun.

Catch-all `src/pages/[...path].ts` **tidak berubah**. Astro memberi peringkat
`[...path]` paling rendah, jadi `index.astro` menang di `/` dan setiap path
tak-dikenal tetap mendapat 404 bersih yang tidak membocorkan apa pun (Issue
#540, dijaga `tests/e2e/not-found.e2e.ts`).

## Yang DITOLAK

1. **Membangun ulang environment produksi terpisah dan mengembalikan staging.**
   Itu memulihkan biaya yang §"Kenapa sebuah template" baru saja tunjukkan tidak
   dibeli siapa pun, dan melakukannya hanya karena dokumen lama menjanjikannya.
2. **Mempertahankan `staging` di `ModuleDeploymentProfile` sebagai "kapabilitas
   template".** Ini keputusan versi pertama ADR ini, dan ia **di-override** —
   uraian lengkapnya di §"Posisi yang di-override". Ringkasnya: nama profil
   yang tidak pernah dijalankan tidak menawarkan apa pun yang tidak bisa
   ditulis sendiri oleh instalasi yang benar-benar membutuhkannya, sementara
   biayanya dibayar terus-menerus oleh setiap pembaca yang mengira ia terjaga.
3. **Membiarkan `awcms.ahlikoding.com` dilayani deployment `APP_ENV=staging`.**
   Ia bekerja hari ini, dan itulah persoalannya: nama environment berhenti
   berarti apa pun, dan orang berikutnya yang membaca `APP_ENV` untuk memutuskan
   sesuatu yang berbahaya akan mendapat jawaban yang salah dengan percaya diri.
4. **Menjadikan halaman landing sebagai halaman tenant ber-tema.** Akan
   mengikat pintu depan domain pada `theming` + resolusi tenant, dan menjadikan
   404 (atau halaman kosong) sebagai mode kegagalan pertama justru pada
   permukaan yang ADR ini ada untuk memperbaikinya.
5. **Meredirect `/` ke `/login`.** Pengunjung yang belum tahu AWCMS itu apa
   disodori formulir kredensial. Sebuah pintu depan menjelaskan dirinya dulu;
   tautan login ada di halaman itu bagi yang memang mencarinya.

## Konsekuensi

- **Tidak ada lagi latihan pra-produksi untuk migrasi, dan ini biaya nyata.**
  Sebelumnya staging bisa menerima `sql/NNN` lebih dulu. Sekarang tidak. Yang
  menggantikannya: suite integrasi CI berjalan di atas layanan Postgres nyata,
  dan runbook operator **mewajibkan backup yang sudah diverifikasi bisa
  di-restore** sebelum migrasi diterapkan (`deploy/backup/restore-postgres.sh`,
  mode verify-only). Itu mitigasi, bukan pengganti setara — dicatat di sini
  supaya keputusan berikutnya tahu apa yang sudah dilepas.
- **Instalasi turunan yang menginginkan tingkat pra-produksi memakai
  `development`, atau menegakkan deployment `production` KEDUA.** Keduanya
  jalur nyata dan keduanya lebih jujur daripada nama ketiga: `development`
  untuk environment yang memang bukan produksi, `production` kedua untuk mirror
  yang harus berperilaku persis seperti produksi (dan karena itu **harus**
  memakai konfigurasi produksi, bukan konfigurasi yang lebih longgar karena
  namanya lain). Yang hilang adalah namanya, bukan tingkatannya.
- **Kontrak isolasi yang dulu diarsipkan di bawah nama "staging" TIDAK ikut
  hilang** — ia berlaku untuk **environment kedua apa pun**: database dan role
  `awcms_app` sendiri, secret sendiri (bukan salinan milik produksi), integrasi
  keluar mati (`R2_ENABLED=false`, `EMAIL_ENABLED=false`, sync nonaktif),
  `NEWS_PORTAL_PROFILE` **dihapus** bukan diisi nilai lain, provider DNS
  `manual`, token purge cache tepi berbeda per environment, dan password owner
  yang tidak pernah sama meski identifier-nya sama. Ia tetap hidup di
  `docs/awcms/environments.md` dan `docs/awcms/deployment-profiles.md`, kini
  ditulis sebagai aturan untuk **environment kedua**, bukan sebagai lampiran
  sebuah profil bernama `staging`. Ia mahal untuk diturunkan ulang —
  sebagiannya dibayar dengan kesalahan nyata di staging `awcms-micro` — jadi ia
  **dipindahkan, bukan dihapus**, dan pemindahan itu adalah syarat keputusan
  ini, bukan pembersihan yang menyusul.
- `docs/awcms/environments.md` dan `docs/awcms/deploy-coolify.md` menyusut ke
  satu environment untuk repo ini, dan `docs/awcms/deployment-profiles.md`
  menyusut ke **tiga** profil.
- Rule Traefik yang memetakan `awcms.ahlikoding.com` ke Varnish staging harus
  dicabut saat produksi ditegakkan kembali; sampai itu terjadi, domain produksi
  melayani data staging. Pembongkaran app, database, dan Varnish staging itu
  sendiri adalah pekerjaan infrastruktur terpisah dari repo ini.
- `/` terindeks. Tidak ada permukaan baru yang terautentikasi: halaman ini nol
  query, nol skrip, nol input.
