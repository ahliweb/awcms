🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0118-the-newsletter-endpoints-answer-a-browser-on-another-origin.md)

<!-- i18n-source-hash: sha256:2c33fe0e00173863eabfa0053fe1294dae1712443564780c27dab9ca83a6b1af -->

# ADR-0118 — Endpoint buletin menjawab peramban di origin lain, dan menyelesaikan tenant milik origin itu

- **Status:** Diterima
- **Tanggal:** 2026-08-28
- **Pengambil keputusan:** ahliweb
- **Memperluas:** [ADR-0103](0103-newsletter-is-its-own-module.id.md) — perilaku modulnya tidak berubah; yang ditambahkan adalah siapa yang boleh memanggilnya dan daftar siapa yang mereka capai. Mengikuti [ADR-0107](0107-a-readers-browser-may-search-and-the-origin-names-the-tenant.id.md) alih-alih membuat kebijakan lintas-origin kedua.
- **Terkait:** `src/modules/newsletter/domain/newsletter-cors.ts`, `src/modules/newsletter/application/public-newsletter-preflight.ts`, `scripts/api-consumer-contract.ts`, [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.id.md) (permukaan publik keluarga ini milik `awcms-astro`), Isu #745, `awcms-astro` [#79](https://github.com/ahliweb/awcms-astro/issues/79)

## Konteks

Modul `newsletter` terbit 21 Agustus 2026 dengan tiga endpoint publik anonim —
`subscribe`, `confirm`, `unsubscribe` — masing-masing dibangun untuk dipanggil
dari sebuah halaman publik. Menurut ADR-0070 halaman publik keluarga ini tidak
ada di repo ini: ia sebuah situs `awcms-astro` yang dibangun statis di origin
yang berbeda. Konsumennya sudah menulis caller-nya dan tidak bisa menyalakannya.

Empat hal menghalanginya, terukur dan bukan diduga, dan tiap satunya menutupi
yang berikutnya.

### 1. Preflight-nya tidak pernah dijawab

Kontraknya JSON, jadi POST lintas-origin selalu ter-preflight. `OPTIONS` ada di
`SAFE_METHODS` Astro dan akan lolos `security.checkOrigin` — tetapi tidak ada
rute buletin yang mengekspornya, jadi peramban tidak pernah mengirim POST-nya
sama sekali.

### 2. Jawabannya tidak akan terbaca

Tidak satu rute pun mengirim `Access-Control-Allow-Origin`. Preflight yang
terjawab akan diikuti POST yang diterima server dengan senang hati dan dibuang
peramban.

### 3. Tenant-nya diselesaikan dari HOST, dan host itu CMS ini

`withNewsletterTenant` mencerminkan entry point pencarian yang **host-resolved**.
Host sebuah permintaan dari situs statis adalah deployment ini, jadi sebuah
langganan dari situs akan diselesaikan lewat rantai host dan mendarat di tenant
mana pun yang memiliki hostname deployment ini — atau, kalau gagal, di
`PUBLIC_DEFAULT_TENANT_ID`. Bukan kegagalan yang akan dilihat siapa pun:
**keberhasilan yang salah**, dan isolasi FR-NWL-002 dikalahkan oleh permintaan
yang seharusnya tunduk padanya.

`site_search` menemui persis ini dan menyelesaikannya di ADR-0107. Docblock
buletin sendiri menyatakan ia mencerminkan modul itu "persis"; yang ia cerminkan
separuh yang tidak punya masalahnya.

### 4. Tautan konfirmasi menunjuk halaman yang tidak ada

`buildConfirmationUrl` diberi `resolveRequestOrigin(url, request)` — origin
tempat permintaan API itu tiba, yaitu CMS ini — dan `NEWSLETTER_CONFIRM_PATH`
adalah `/newsletter/confirm`. Tidak ada halaman seperti itu di repo ini:
`src/pages/newsletter/` tidak ada. Setiap email konfirmasi yang pernah dikirim
modul ini menaut ke 404 di origin ini, jadi `consent_at` tidak pernah bisa
ditulis dan tidak ada pelanggan yang pernah bisa menjadi `active`. Double opt-in
bukan setengah terjangkau; ia tidak terjangkau.

## Keputusan

**Ketiga endpoint buletin menjawab peramban lintas-origin, dan tenant sebuah
permintaan lintas-origin datang dari `Origin`-nya, diverifikasi terhadap
`awcms_tenant_domains`.**

### 1. `OPTIONS` di ketiga rute, satu implementasi

`src/modules/newsletter/application/public-newsletter-preflight.ts` menjawab
setiap preflight; rutenya hanya memasok kunci limiter miliknya sendiri. Tiga
implementasi berarti tiga kesempatan memberikan sesuatu yang salah satunya tidak
bermaksud memberikannya.

Selalu `204`, apa pun keputusannya — penolakan adalah KETIADAAN
`Access-Control-Allow-Origin`, bukan kode status. Origin yang tahu ia ditolak
telah tahu bahwa origin LAIN tidak akan ditolak, dan itu oracle yang sudah
ditolak oleh badan respons endpoint ini.

Preflight diklasifikasikan dari header lebih dulu dan dibatasi laju **sebelum**
pencarian domain, di bawah kunci per-IP yang sama dengan POST yang didahuluinya.
Sebuah preflight adalah bagian dari permintaan itu, bukan permintaan kedua, dan
`Access-Control-Max-Age` (600 detik) menjaga pembaca tidak membayar dua kali.

### 2. Izinnya sempit

`content-type` satu-satunya header yang diizinkan — itulah yang menjaga
permintaannya keluar dari cabang form-like Astro, tempat `checkOrigin` menjawab
403 — dan `POST, OPTIONS` satu-satunya metode. Tidak pernah `*`: origin yang
digemakan selalu origin yang sudah menyelesaikan sebuah tenant lewat
`awcms_tenant_domains`.

**Tanpa `Access-Control-Allow-Credentials`**, dan itu perbedaan yang disengaja
dari beacon kunjungan. Beacon butuh kredensial karena kunci pengunjung anonimnya
sebuah cookie. Endpoint ini tidak membaca cookie, tidak menulis cookie, dan
tidak mengautentikasi siapa pun — sebuah langganan dibuktikan token yang tiba
lewat email. Izin ber-kredensial akan menjadi izin yang jelas lebih lebar yang
dibeli tanpa manfaat, pada endpoint yang mengirim surat.

### 3. Tenant permintaan lintas-origin datang dari origin-nya

`withPublicNewsletterTenant` mengklasifikasikan `Origin` lebih dulu dan, saat
permintaannya lintas-origin, menyelesaikan tenant-nya dengan
`resolvePublicTenantByHost` **dan tidak lebih** — tanpa default env, tanpa
default setup-state. Pemanggil yang menyebut hostname yang tidak dilayani
deployment ini `refused` dan mendapat badan netral yang sama dengan semua orang,
tidak pernah daftar milik orang lain.

Origin yang ditolak membayar `padUnresolvedNewsletterTenantLatency`, persis
seperti host yang tidak terselesaikan. Tanpa itu, "origin ini tenant deployment
ini" akan terbaca dari WAKTU respons meski badannya tidak berkata apa-apa.

### 4. Tautan konfirmasi dibangun di atas origin yang diizinkan

Untuk langganan lintas-origin yang diizinkan, URL token dibangun di origin
pemanggilnya sendiri — aman digemakan justru karena permintaannya hanya sampai
ke cabang itu dengan menyelesaikan sebuah tenant lewat `awcms_tenant_domains`.
`Origin` yang tidak diverifikasi di sini akan menjadi cara membuat deployment
ini mengirim email berisi token sah kepada orang asing, menunjuk situs yang
dipilih pengirimnya.

Untuk langganan same-origin, ia tetap seperti sebelumnya.

## Konsekuensi

- **Konsumennya bisa menyalakan caller-nya.** `awcms-astro`#79 sudah menulis
  formulir langganannya dan menahannya di belakang flag yang di-hard-code;
  ketiga jalurnya masuk `COMMITTED_PATHS` pada perubahan yang sama, sehingga
  bentuknya dibekukan sebelum panggilannya menjadi nyata — urutan yang dituntut
  `scripts/api-consumer-contract.ts`.
- **Double opt-in bekerja, di atas sebuah situs.** Tautan konfirmasinya mendarat
  di halaman yang dilayani situs, yang mengirimkan tokennya kembali ke sini.
- **Deployment tanpa situs di depannya tetap tidak bisa mengonfirmasi.** Tautan
  same-origin tetap menunjuk `/newsletter/confirm` di origin ini, dan repo ini
  tidak melayani halaman itu. Itu dinyatakan alih-alih diperbaiki: menambahkan
  halaman pembaca publik di sini akan bertentangan dengan ADR-0070, yang menaruh
  permukaan publik keluarga ini di repo satunya. Yang berubah adalah kasus yang
  PUNYA situs kini bekerja; kasus yang tidak punya memang tidak pernah bekerja
  dan sekarang terlihat.
- **429 dan 400 validasi tidak membawa izin CORS.** Keduanya dijawab sebelum
  origin diklasifikasikan — limiter sengaja berjalan sebelum pembacaan basis
  data mana pun — jadi pemanggil lintas-origin melihat permintaan yang gagal,
  bukan badannya. Mengikuti ADR-0107, keduanya tetap membawa `Vary: Origin`,
  karena cache tidak boleh menyerahkan jawaban yang bergantung origin kepada
  origin lain. Ongkosnya: pembaca yang salah ketik alamat tidak diberi tahu
  lebih dari yang sudah dikatakan pesan netral — yang untuk endpoint anti-oracle
  memang itu saja yang akan ia dapat.
- **Satu permukaan lagi dibekukan terhadap konsumennya.** Mengubah bentuk
  permintaan atau respons ketiganya sekarang memerahkan CI repo ini, bukan
  peramban seorang pembaca beberapa pekan kemudian.

## Ditolak

- **Mematikan `security.checkOrigin` untuk rute-rute ini.** Ia tidak bisa
  dikecualikan per-rute dari dalam aplikasi — Astro memasangnya sebelum
  `src/middleware.ts` — dan mematikannya global berarti menukar jaminan
  se-repo demi kenyamanan satu modul. Penolakan yang sama dibuat ADR-0107 dan
  #637.
- **`Access-Control-Allow-Origin: *`.** Endpoint ini mengirim surat. Wildcard
  akan membiarkan halaman mana pun di internet melakukannya.
- **Melayani `/newsletter/confirm` dan `/newsletter/unsubscribe` dari repo
  ini.** Itu akan bekerja, dan itu akan mengembalikan halaman yang dihadapkan ke
  pembaca ke repo yang justru dikosongkan ADR-0070 darinya. Situs yang
  memilikinya.
- **Memercayai `Origin` untuk tautan konfirmasi tanpa pencarian domain.** Ia
  satu header saja dari membuat deployment ini mengirim token sah kepada orang
  asing, menunjuk host yang dipilih pengirimnya.
- **Kebijakan CORS yang berbeda per endpoint.** Tiga izin yang harus tetap
  identik adalah tiga izin yang tidak akan identik.
