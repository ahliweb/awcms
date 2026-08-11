# awcms

## 8.0.0

### Major Changes

- 26334bd: feat(kontrak,config): konsekuensi KODE dari hilangnya profil `staging` — `MODULE_CONTRACT_VERSION` 2.5.0 → 3.0.0, predikat "online" Redis, enum `APP_ENV`

  Sisi kode dari penghapusan `staging` ([ADR-0083](docs/adr/0083-this-template-deploys-to-one-environment.md) sebagaimana diamandemen 11 Agustus 2026). Union `ModuleDeploymentProfile` kini `development | production | offline-lan`; yang berikut ini adalah akibat-akibatnya yang tidak selesai dengan menghapus satu baris.

  **`MODULE_CONTRACT_VERSION` naik MAJOR, bukan PATCH "sinkronisasi dokumentasi".** Aturan file itu sendiri berkata MAJOR untuk field yang dihapus, dan preseden `2.0.0` sudah menaikkan MAJOR untuk tipe ekspor yang dihapus. Union yang MENYEMPIT adalah penarikan kemampuan: sebuah `module.ts` yang sah terhadap `2.5.0` — deskriptor mana pun dengan `deploymentProfiles: ["staging", ...]` — berhenti dikompilasi. Menyebutnya PATCH akan membiarkan konsumen hilir mem-pin `^2` lalu menerima tipe yang tak bisa ia penuhi. `awcms-family-compatibility.yaml` ikut di-update: gerbang `family:conformance:check` mem-cross-check angka itu terhadap konstanta sumbernya, jadi keduanya tak bisa berpisah diam-diam. Nol modul base mendeklarasikan `deploymentProfiles`, jadi radius ledakan di dalam repo ini nol — kenaikannya untuk konsumen yang membaca angka, bukan diff.

  **`isOnlineEnvironment` di `src/lib/redis/config.ts` tidak sekadar kehilangan satu cabang.** Predikat itu sebenarnya menanyakan "apakah deployment ini terjangkau dari jaringan yang tidak kita kendalikan, sehingga Redis polos tanpa autentikasi adalah paparan nyata?" — dulu dijawab `staging || production` karena itulah dua nilai `APP_ENV` yang menamai deployment ter-host. Kini `production` adalah seluruh himpunannya: maksudnya utuh, enumerasinya yang memendek. `development`/`test` tetap di luar dengan alasan yang sama seperti sebelumnya, dan `APP_ENV` kosong/tak dikenal tetap diam persis seperti dulu. Melebarkannya menjadi "apa pun selain development/test" adalah keputusan LAIN — ia akan mulai memperingatkan setiap pemanggil tanpa `APP_ENV`, termasuk `redis:health` yang dijalankan ad hoc — dan bukan di sini tempat mengambilnya. Dua pesan temuannya ikut berhenti menjanjikan environment yang tidak ada.

  **`APP_ENV=staging` kini DITOLAK `bun run config:validate`.** Membiarkannya di daftar nilai sah berarti gerbang itu menerima nama environment yang tidak ada — persis kegagalan yang ADR-0083 tutup. `test` BUKAN profil deployment dan tetap tinggal: ia dipakai harness (drill DR/performa yang menolak `production`) dan tidak pernah menamai sebuah deployment.

  Yang hanya terasa saat mengembangkan:

  - **Penutupan union itu diuji, dan buktinya dijalankan.** `tests/module-composition.test.ts` menambah satu `@ts-expect-error` atas `const removed: ModuleDeploymentProfile = "staging"`. Komposisi build-time membandingkan profil sebagai string biasa, jadi tidak ada apa pun di runtime yang akan menyadari `staging` kembali — hanya tipe yang bisa. Dibuktikan menggigit dengan mengembalikan `"staging"` ke union: `tsc --noEmit` merah dengan `TS2578: Unused '@ts-expect-error' directive`, lalu dikembalikan.
  - **Enam sebutan "staging" lain di `src/` dan `scripts/` sengaja TIDAK disentuh.** Semuanya bukan rujukan ke profil: kata kerja bahasa Inggris ("staging the policy", "staging credentials ahead of go-live"), sebutan generik untuk salinan situs non-produksi yang masih boleh dijalankan pemakai template, atau PROVENANCE historis (cacat kontrak ADR-0047 memang diverifikasi terhadap staging; invalidasi Varnish yang tak pernah bekerja memang ketahuan dengan menaruhnya di depan staging). Menghapus profil dari union tidak membuat satu pun kalimat itu menjadi salah, dan menyapunya akan menghapus sejarah yang menjelaskan kenapa kodenya berbentuk begitu.

### Minor Changes

- 9862234: feat(push): adapter FCM HTTP v1 — tanpa dependensi, tanpa satu pun origin CSP baru

  `PUSH_PROVIDER=fcm` mengaktifkan pengiriman ke klien **native** Android/iOS.
  Server → Google, jadi ia tidak menyentuh browser: nol byte di anggaran aset
  klien dan nol origin CSP baru. Itulah pembagian yang ADR-0074 tetapkan —
  FCM HTTP v1 ditahan, SDK FCM Web ditolak.

  **Tanpa menambah dependensi.** `google-auth-library` dan `firebase-admin`
  sama-sama melakukan ini, dan keduanya akan jadi dependensi runtime baru di repo
  yang hidup dengan dua. Presedennya sudah tertulis: `src/lib/auth/jwt-verify.ts`
  melakukan verifikasi JWT tanpa `jose`. Assertion service-account (RFC 7523)
  ditandatangani RS256 lewat `crypto.subtle`, tak pernah implementasi RSA
  tangan-sendiri.

  Test yang paling menanggung beban bukan percabangan status — itu mudah benar dan
  mudah diuji. Yang bisa salah secara halus dan senyap adalah assertion-nya: JWT
  yang ditolak Google terlihat persis seperti masalah kredensial, dan "tambahkan
  `google-auth-library`" adalah kesimpulan yang akan diambil siapa pun setelah
  satu jam begitu. Jadi assertion-nya tidak sekadar dihasilkan — ia
  **diverifikasi**, dengan kunci publik pasangannya, lewat `crypto.subtle`.
  Pasangan kunci RSA nyata dibangkitkan di dalam test, diekspor ke bentuk PEM
  PKCS#8 yang sama dengan terbitan Google, dan dilewatkan parser sungguhan.

  **Kredensial wajib base64.** `config:validate` mem-parse `.env` baris demi
  baris, dan `private_key` adalah blok PEM multi-baris — ditempel mentah ia
  terpotong diam-diam dan kegagalannya muncul saat kirim pertama, bukan saat boot.
  Parser-nya pure dan dipakai **kedua** sisi, jadi validator tak bisa berbeda
  pendapat dengan benda yang ia validasi. Pesan kegagalannya menyebut **nama
  field**, tak pernah nilai: ada test yang meng-assert `private_key` tak muncul.

  **Tiga keputusan yang halus:**

  - **Token mati tidak memicu circuit breaker.** Antrean normal membawa ribuan
    token basi; kalau itu dihitung sebagai kegagalan provider, satu batch
    registrasi lama menghentikan pengiriman ke setiap perangkat sehat — dan
    gejalanya menunjuk ke FCM. Diuji dua arah: sepuluh `UNREGISTERED` berturut
    meninggalkan breaker `closed`, lima `UNAVAILABLE` membukanya.
  - **Kode error dibaca SEBELUM status.** Versi pertama memeriksa `status === 401`
    lebih dulu, dan **test menangkapnya**: `THIRD_PARTY_AUTH_ERROR` (juga HTTP 401) dilaporkan sebagai "token kadaluwarsa", sehingga adapter mencetak token
    baru dan mengulang — menghabiskan satu round-trip untuk ditolak dengan alasan
    sama, dan melabeli kesalahan konfigurasi permanen sebagai kedaluwarsa.
  - **401 disegarkan tepat sekali.** Token yang mati di tengah batch berharga satu
    panggilan tambahan, bukan seluruh sisa batch; token baru yang tetap ditolak
    adalah masalah kredensial dan berhenti di situ (non-retryable).

  Setiap panggilan keluar lewat `ssrfSafeFetch`, bukan `fetch` telanjang: tujuannya
  diturunkan dari `token_uri` sebuah kredensial dan dari baris langganan — nilai
  yang datang dari luar kode ini. Seam-nya sebuah TIPE, bukan pembungkus `fetch`,
  supaya test menggerakkan adapter tanpa jaringan **dan tanpa harus mematikan
  guard-nya** — test yang harus mematikan guard sedang menguji jalur berbeda dari
  yang dijalankan produksi.

  `healthCheck` membuktikan kredensialnya, bukan jalur kirim: mengirim notifikasi
  nyata butuh token perangkat nyata, dan mengarang satu akan dijawab
  `UNREGISTERED` — FCM sehat yang melapor gagal.

  `web_push` masih **belum** diterima `PUSH_PROVIDER`. Test yang dulu meng-assert
  `fcm` ditolak kini meng-assert `fcm` diterima dan `web_push` tidak — itulah guna
  meng-assert yang negatif: daftarnya tak bisa tumbuh mendahului kodenya tanpa
  test itu ikut disunting di perubahan yang sama.

- 15ab660: feat(push): adapter Web Push (VAPID) — nol byte klien, nol origin CSP, diverifikasi terhadap vektor RFC 8291

  `PUSH_PROVIDER=web_push` mengaktifkan pengiriman ke **browser** lewat RFC 8030 +
  8291 + 8292. Inilah yang ADR-0074 pilih sebagai ganti SDK FCM Web, dan alasannya
  terukur: SDK itu **45.041 B** melawan plafon **21.000 B** per berkas, dan
  menuntut `www.gstatic.com` di `script-src` plus dua origin `googleapis.com` di
  `connect-src` — melawan CSP yang punya enam direktif, **tidak punya
  `connect-src` sama sekali**, dan sebuah test yang mengunci nol origin pihak
  ketiga (ADR-0029).

  `PushManager.subscribe()` adalah API browser, bukan `fetch` dari skrip halaman.
  Jadi jalur ini berharga **nol byte klien dan nol origin CSP**. Anggaran aset
  tetap 140.008 / 180.000 B, tak bergerak satu byte pun.

  ## Kenapa buktinya vektor RFC, bukan round-trip

  Ini kode paling berisiko di seluruh program push, dan alasannya perlu disebut
  lebih dulu: **push service tidak memvalidasi payload.** Ia meneruskan ciphertext
  ke browser, dan browser yang tak bisa mendekripsinya membuang notifikasi itu
  **diam-diam**. Key schedule yang salah menghasilkan sistem yang menerima setiap
  pesan, mencatat setiap kirim sebagai **sukses**, dan tidak mengantarkan apa pun
  — tanpa satu error pun di mana pun dalam rantai.

  Test round-trip tidak bisa menangkap itu: ia membuktikan encryptor dan decryptor
  sepakat, bukan bahwa keduanya cocok dengan spesifikasi. Keduanya bisa salah baca
  spec dengan cara yang sama, yang persis mode kegagalan di atas.

  Jadi implementasinya mereproduksi **contoh kerja RFC 8291 sendiri** (§5 dan
  Lampiran A):

  | Nilai                        | Cocok                           |
  | ---------------------------- | ------------------------------- |
  | `ecdh_secret`                | ya                              |
  | `PRK_key`                    | ya                              |
  | `IKM`                        | ya                              |
  | `PRK`                        | ya                              |
  | `CEK`                        | ya                              |
  | `NONCE`                      | ya                              |
  | **body terenkripsi lengkap** | **ya, 144 byte, byte per byte** |

  Angka-angka itu datang dari pihak ketiga; mereproduksinya adalah bukti
  interoperabilitas, bukan konsistensi diri. Masing-masing di-assert terpisah agar
  kegagalan menyebut **langkah mana** yang menyimpang, bukan sekadar melaporkan
  ciphertext-nya tak cocok lagi.

  HKDF ditulis di atas HMAC `crypto.subtle` alih-alih memakai
  `deriveBits({name:"HKDF"})` — justru supaya nilai-nilai antara itu **bisa
  diamati**; `deriveBits` melakukan extract-then-expand sebagai satu operasi buram.
  Dua puluh baris RFC 5869, nol kriptografi yang diciptakan sendiri.

  ## Detail yang halus dan diuji
  - **Pasangan kunci ECDH server ephemeral per pesan** — desain RFC, bukan
    optimasi yang belum dikerjakan: satu pasangan yang dipakai ulang membuat setiap
    notifikasi ke satu pelanggan berbagi key schedule, sehingga memulihkan satu
    plaintext memulihkan semuanya. Diuji: dua kirim dengan payload identik
    menghasilkan salt DAN keyid berbeda.
  - **`aud` VAPID adalah ORIGIN endpoint**, bukan endpoint-nya. Menandatangani
    endpoint penuh adalah kesalahan klasik yang gejalanya 401 dan terbaca seperti
    masalah kunci. Pemanggil menyerahkan endpoint dan tak pernah audience.
  - **Tanda tangan ES256 adalah r||s mentah 64 byte**, bukan DER — bentuk DER
    ditolak setiap push service dan didiagnosis oleh tak satu pun dari mereka.
  - **Langganan mati tidak memicu circuit breaker** (sepuluh `410` berturut
    meninggalkan breaker `closed`), konsisten dengan adapter FCM.
  - Token VAPID di-cache per **origin**: satu batch 500 pelanggan Firefox berharga
    satu tanda tangan, bukan 500.

  ## Operasional

  `bun run push:vapid:generate` mencetak satu pasangan kunci dalam bentuk persis
  yang `.env` inginkan. Ia ada alih-alih "pakai openssl" karena formatnya spesifik
  dan mudah salah secara halus: publik = **titik P-256 tak-terkompres 65 byte**,
  privat = **skalar mentah 32 byte**, keduanya base64url tanpa padding —
  sementara `openssl ecparam` mengeluarkan PEM, dan tiap resep konversinya
  berpeluang menyerahkan bentuk terbungkus DER, yang **berhasil diimpor di sini**
  lalu ditolak setiap push service sebagai 401.

  Perintah itu juga mencetak peringatan bersama kuncinya, bukan menyimpannya di
  dokumen: **merotasi pasangan kunci tidak me-re-key langganan yang ada** — ia
  membuat semuanya permanen tak-terkirimi sampai penggunanya berlangganan ulang,
  karena kunci publik dipanggang ke dalam tiap langganan saat `subscribe()`.

  `SsrfFetchOptions.body` melebar menerima `Uint8Array`: body Web Push adalah
  ciphertext `aes128gcm`, dan tak ada penyandian teks yang selamat melewati
  `string`. `fetch` selalu menerima keduanya; hanya tipenya yang lebih sempit dari
  benda yang ia teruskan.

- 5fcf7bf: fix(keamanan): approve registrasi berhenti bisa memberikan role `owner`

  `POST /api/v1/registration-requests/{id}/approve` memvalidasi `roleIds` hanya
  dengan `SELECT id FROM awcms_roles WHERE tenant_id = … AND deleted_at IS NULL`
  (`identity-access/application/self-registration.ts`), lalu menulis langsung ke
  `awcms_access_assignments`. Tidak ada penyaringan `is_system`.

  `owner` **adalah** system role, dan `tenant-admin/application/platform-bootstrap.ts`
  men-seed-nya dengan **seluruh** katalog permission tenant. Jadi prinsipal yang
  hanya memegang `identity_access.registration_requests.{read,approve}` — peran
  yang docblock rutenya sendiri rancang agar **tidak** menyentuh katalog RBAC
  ("the authority to admit someone to a tenant is not the authority to edit
  roles") — bisa meng-approve dengan `roleIds: [<id owner>]` dan mencetak akun
  ber-izin penuh. Dan bukan lewat `curl` saja: `/admin/registrations` merender
  picker dari `listRoles`, yang tidak menyaring `is_system`, sehingga `owner`
  tampil sebagai salah satu opsi di dropdown.

  Jalur resmi menolaknya sejak awal: `user-admin.ts#assignRole` melempar
  `SystemRoleAssignmentError` dan rutenya digerbangi `access_control.assign`
  (→ `409 ROLE_SYSTEM_PROTECTED`). **Dua penulis satu tabel dengan dua aturan
  berbeda** — itu kelas cacatnya, bukan satu baris yang terlewat.

  Perbaikannya:

  - Service menolak sebelum menulis apa pun (`outcome: "system_role"` +
    `roleCodes`). Sengaja **bukan** dikolapskan ke `unknown_role`: role-nya ada
    dan layar reviewer baru saja merendernya, jadi menjawab "tidak ada" adalah
    kebohongan tentang baris yang mereka lihat. Ia juga tidak membocorkan apa pun
    — `registration_requests.read` sudah menampilkan daftar role tenant itu.
  - Route memetakannya ke **`409 ROLE_SYSTEM_PROTECTED`**, kode yang SAMA dengan
    `POST /api/v1/access/assignments` untuk penolakan yang sama.
  - Baris audit `registration_approved` kini membawa `roleCodes`, bukan hanya
    `roleCount`. Approval yang memberi role adalah pemberian privilese, dan
    `roleCount: 1` tak bisa menjawab satu-satunya pertanyaan auditor tentangnya.
  - Picker di `/admin/registrations` tidak lagi menawarkan system role —
    presentasi saja; otoritasnya tetap endpoint.

  Gerbang yang ikut mendarat, dan ia menutup KELASNYA bukan kejadiannya:
  `tests/access-assignment-writers.test.ts` menuntut **setiap** berkas `src/**`
  yang memuat `INSERT INTO awcms_access_assignments` juga membaca `is_system`,
  atau terdaftar sebagai pengecualian ber-alasan (hari ini tepat satu:
  `platform-bootstrap.ts` — bootstrap tenant memang perbuatan membuat owner
  pertama, berjalan sebelum ada sesi mana pun). Entri basi ikut memerahkan.
  Mutation-proven: mengembalikan cacat aslinya membuatnya MERAH dan menyebut
  berkasnya; menghapus filter picker memerahkan contract test.
  Dua test integrasi (`system_role` → nol baris `awcms_access_assignments`, nol
  identitas, request tetap `pending`; role biasa tetap diberikan dan disebut
  namanya) menjaga sisi database — arah kedua itu perlu, karena
  `AND is_system = false` yang salah tulis bisa menolak **semua** role sambil
  membuat test pertama tetap hijau.

  **Yang SENGAJA tidak dikerjakan di sini, dan alasannya.** Approval tetap boleh
  memberikan role NON-system tanpa pemanggilnya memegang
  `access_control.assign`. Itu desain yang tertulis eksplisit di docblock rutenya,
  dan menyempitkannya adalah perubahan **otoritas** — tempatnya ADR, bukan
  perbaikan bug. Konsekuensinya dinyatakan, bukan disembunyikan: tenant yang
  membuat role non-system ber-izin besar membuat pemegang `approve` bisa
  memberikannya. Yang ditutup PR ini adalah eskalasi ke katalog PENUH lewat role
  yang tak seorang pun bisa buat lewat API (`role-admin.ts#createRole` menulis
  `is_system` sebagai `false` tetap).

  Nol migrasi: kolom, katalog permission, dan proteksi system-role di jalur
  sebelah sudah ada — yang hilang hanya penegakannya di penulis kedua.

- be88f88: fix(keamanan): aset statis berhenti disajikan tanpa satu pun header keamanan

  `@astrojs/node` (mode `standalone`) menyusun handler-nya sebagai
  `staticHandler(req, res, () => appHandler(req, res))`. Handler statis jalan
  **lebih dulu**, dan `appHandler` — satu-satunya yang menjalankan
  `src/middleware.ts` — cuma jadi fallback ketika berkasnya tidak ada. Akibatnya
  setiap berkas yang benar-benar ada di `dist/client/` dijawab **tanpa**
  `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, dan tanpa `X-Correlation-ID`:
  `public/js/news-share.js`, `public/css/public-content.css`, dan seluruh
  `_astro/**`.

  Terukur pada build nyata sebelum perbaikan: `curl -sI /css/public-content.css`
  memberi **0** dari tiga header yang dicek, sementara `/api/v1/health` memberi
  **3**. Sesudah perbaikan keduanya **3**, dengan `Content-Type` dan
  `Cache-Control` milik `send` utuh.

  Dua komentar di repo ini menegaskan yang sebaliknya dan dipakai sebagai
  invarian — `astro.config.mjs` ("dipasang `src/middleware.ts` ke SETIAP
  response") dan `src/middleware.ts` ("Routing ALL responses … guarantees no
  response ever reaches Varnish unlabelled"). Keduanya benar untuk response yang
  di-render dan salah untuk berkas statis; sekarang keduanya menyebut batasnya.
  Satu bullet di `security-headers.ts` yang mendaftar `public/**` sebagai alasan
  CORP aman juga diperbaiki — sebelum ini ia menyatakan niat, bukan fakta.

  Dampak pada himpunan berkas hari ini sedang: dua aset milik sendiri plus bundel
  ber-hash, semuanya ber-MIME benar. Yang membuatnya ditutup sekarang dan bukan
  sekadar didokumentasikan adalah bahwa invarian itu **load-bearing** — ia alasan
  tertulis mengapa tidak ada lapisan header kedua di mana pun. Menjatuhkan satu
  berkas `.html` ke `public/` menyajikannya sebagai dokumen tanpa CSP dan tanpa
  `X-Frame-Options`, dan service worker (#466) mendarat di jalur yang sama.

  **Perbaikannya membungkus, bukan menulis ulang.** `src/lib/server/standalone-entry.ts`
  mematikan autostart adapter, mengimpor `handler` yang sudah dibangunnya, dan
  memasang `buildSecurityHeaders()` dengan `setHeader` sebelum mendelegasikan.
  Itu berarti `send` tetap yang menangani conditional GET, range request, 304,
  redirect `trailingSlash`, penolakan dotfile beserta pengecualian `.well-known`,
  dan `Cache-Control` immutable untuk `assetsDir` — menulis ulang semua itu demi
  empat header akan menukar bug header dengan kelas bug yang jauh lebih buruk.

  Pemasangannya adalah **lantai, bukan override**: Node menggabungkan
  `writeHead(status, headers)` di atas nilai `setHeader` dengan objek `writeHead`
  menang saat nama bentrok, jadi response yang di-render tetap membawa persis apa
  yang dihitung middleware. Klaim penggabungan itu yang diuji terhadap server
  `node:http` sungguhan di `tests/standalone-entry.test.ts`, dua arah — bukan
  sekadar "builder mengembalikan empat header", yang sudah hijau sepanjang bug ini
  hidup.

  Entrypoint produksi berpindah ke `dist/standalone-entry.mjs`: `package.json`
  `start`, `Dockerfile.production` `CMD`, dan job `e2e-smoke` di `ci.yml`.
  `tests/family-conformance-ci-parity.test.ts` kini meng-assert entry baru **dan**
  melarang entry adapter mentah, karena kembali ke sana adalah regresinya persis
  dan terlihat tak berbahaya di dalam diff.

- 26334bd: docs: `staging` dihapus dari kosakata profil, kontrak isolasinya pindah rumah

  Pagi ini dokumen-dokumen ini masih menulis `staging` sebagai profil deployment
  yang sah — sebuah kapabilitas yang ditawarkan template kepada pemakainya.
  Pemilik repo membatalkan itu: `staging` hilang seluruhnya, bukan sekadar tidak
  dijalankan di sini. Yang tersisa tiga — `development`, `production`,
  `offline-lan` — dan `deployment-profiles.md` kini mendokumentasikan tiga baris,
  bukan empat.

  **Yang tidak boleh ikut terbuang adalah kontraknya.** Database sendiri,
  role/password sendiri, secret sendiri, integrasi keluar mati, tanpa tulis ke
  bucket media produksi, provider DNS `manual`, token purge per-environment — itu
  mahal untuk diturunkan ulang, dan sebagiannya dibayar dengan kesalahan nyata di
  `awcms-micro`. Jadi ia dipindah-rumahkan, bukan dihapus: dari sebuah tingkatan
  bernama menjadi aturan untuk **environment kedua apa pun** yang seseorang
  dirikan di samping produksinya, di `environments.md` §Kontrak isolasi
  environment kedua. Kegagalannya tidak pernah peduli nama tingkatannya.

  Satu konsekuensi ikut ditulis alih-alih ditutupi: `staging` dulu satu-satunya
  nilai `APP_ENV` yang sekaligus production-like DAN boleh menjadi sasaran DR
  drill (`APP_ENV=production` tidak punya flag override sama sekali). Tanpa dia,
  rehearsal dan drill terpaksa berjalan di dua database — runbook preflight
  sekarang mengatakannya, bukan menyisakan resep yang akan ditolak interlock-nya
  sendiri.

  Catatan bertanggal **tidak** ditulis ulang. Probe 4 Agustus dan verifikasi host
  11 Agustus tetap menyebut `awcms_staging`/`awcms-staging-varnish`, karena itu
  memang nama sumber daya yang ada saat itu; yang ditambahkan hanyalah penunjuk
  bertanggal bahwa sumber daya itu sedang dibongkar dan namanya bukan nama sebuah
  profil.

- 8e5bea8: feat(auth): ganti password sendiri — dan step-up hanya diminta dari orang yang punya faktor kedua

  Gelombang 2 PR 2.4 dari #423. `POST /api/v1/auth/password/change`: pasangan dari
  `password/reset` — yang itu melayani orang yang **tidak bisa** masuk dan
  membuktikan penguasaan kotak surat; yang ini melayani orang yang **sudah** masuk
  dan membuktikan penguasaan kredensialnya. Self-service, nol izin baru.

  **Rencana program menulis "step-up aal2 + password lama". Bagian aal2-nya
  mendarat BERSYARAT, dan itu koreksi terhadap rencana, bukan penyederhanaan.**
  `requireStepUp` menolak setiap sesi yang tidak sedang `aal2`, dan orang tanpa
  faktor terdaftar **tidak akan pernah** bisa mencapai `aal2`. Mengirimkannya
  tanpa syarat berarti setiap pengguna tanpa MFA permanen tak bisa mengganti
  passwordnya — dan yang paling mungkin butuh justru mereka yang baru saja tahu
  passwordnya bocor. Itu jebakan ADR-0058 §E dengan baju berbeda: gerbang yang
  terbaca benar sambil menolak semua orang.

  Jadi aturannya bersyarat dan tiap bagian menanggung bebannya sendiri: **password
  lama adalah re-autentikasi untuk semua orang**, dan **faktor kedua yang segar
  diminta tambahan dari siapa pun yang punya**. Tak ada yang diminta kurang dari
  yang bisa ia berikan, dan tak ada yang diminta sesuatu yang tak bisa ia berikan.

  Step-up dievaluasi **sebelum** verifikasi argon2id: jauh lebih murah, dan menjaga
  penolakan step-up basi tidak sekalian menjadi jawaban apakah `currentPassword`
  yang dikirim benar.

  **Kebijakan SSO-only diperiksa ulang di sini**, tidak dipercaya dari waktu login:
  tenant bisa saja berpindah ke SSO-only sejak sesi ini terbit, dan seluruh maksud
  kebijakan itu adalah password tidak bisa dipakai masuk. Menulis password baru
  berarti menulis kredensial yang menurut kebijakan tak boleh bekerja. → `409`.

  **Sesi pemanggil selamat, sisanya mati.** Ganti password yang mengeluarkan Anda
  dari tab tempat Anda menggantinya terbaca sebagai kegagalan, sementara properti
  keamanannya tidak berubah — sesi pencuri termasuk yang mati. Penghitung lockout
  dibersihkan, alasan yang sama dipakai jalur reset: siapa pun yang menyerahkan
  password saat ini sudah membuktikan penguasaan kredensial, sinyal yang lebih kuat
  dari penghitung yang menguncinya; penyerang yang bisa sampai ke cabang itu sudah
  tahu passwordnya.

  **Dibatasi laju meski sudah terautentikasi.** `currentPassword` adalah rahasia
  yang bisa ditebak, jadi ini permukaan tebak-kredensial bahkan di balik sesi —
  kasus yang penting adalah sesi pinjaman atau curian dipakai memburu password yang
  tidak ikut terbawa. Di-key ke **sumber**, bukan ke akun: bucket ber-key identifier
  di sini memberi siapa pun yang bisa menjangkau endpoint tuas menahan ganti
  password satu orang — keberatan yang persis sama sudah tercatat menolak bucket
  login ber-key identifier.

  Sukses **dan** gagal sama-sama diaudit: `currentPassword` yang salah dikirim lewat
  sesi hidup adalah sinyal bahwa sebuah sesi dipakai orang yang tak tahu kredensial
  di belakangnya. Atributnya membawa bentuk perangkat dan pseudonim IP, dan **tak
  membawa password — bahkan panjangnya**. Asersinya berjalan terhadap nilai
  `attributes:` itu sendiri, bukan terhadap seluruh berkas: docblock menyebut kedua
  field, dan prosa tak boleh memutuskan test tentang perilaku.

  Password yang tidak berubah ditolak sebagai **validation error**, bukan dijawab
  sukses no-op: "berhasil diganti" dibaca orang sebagai "password lama saya sudah
  tidak berlaku", dan itu tidak akan benar.

- d8562b7: feat(auth): sesi bisa dilihat dan diakhiri sendiri — Gelombang 2 PR 2.1

  `GET /api/v1/auth/sessions` dan `DELETE /api/v1/auth/sessions/{id}`: di mana
  saya sedang masuk, dan akhiri yang bukan saya.

  **Nol permission baru, dan itu keputusan bukan kelalaian.** Subjeknya adalah
  pemanggil, dan rutenya tidak menerima `tenantUserId` — tidak ada orang lain yang
  bisa diarahkan. Mengarang permission untuk "lihat sesi sendiri" akan memasang
  tembok di depan fiturnya **dan** menanam jebakan latent-authz ADR-0058 §E: aksi
  yang tak di-seed apa pun menolak semua orang termasuk owner tenant, sementara
  kodenya terbaca seolah digerbangi benar. Konsekuensinya
  `access:permissions:enforcement:check` dan `admin:screen-coverage:check` tidak
  tersentuh sama sekali.

  **Tiga kolom sidik jari** (`sql/100`), karena daftar id opaque tidak bisa
  menopang keputusan "mana yang bukan saya": `client_ip_hash`,
  `user_agent_summary`, `origin_auth` (`password` | `sso` | `handoff`).

  Satu detail yang tidak ada di rencana dan hanya terlihat dengan membaca kedua
  sisi: **`hashClientIp` memakai kunci acak per-proses** bila
  `AUTH_IP_HASH_SECRET` tak diset. Dapat ditoleransi untuk atribut audit — masih
  non-reversible — dan **tidak** dapat ditoleransi untuk kolom yang dipersistenkan:
  sesudah restart perangkat yang sama menghasilkan hash berbeda, dan daftar yang
  dipakai orang untuk memutuskan "akhiri yang mana" akan menampilkan satu
  perangkat sebagai beberapa, diam-diam, ke arah yang menghasilkan pencabutan yang
  salah. Karena itu `persistableClientIpHash` mengembalikan **null** bila kuncinya
  tidak stabil; konsol menyebut pengelompokan tak tersedia alih-alih menampilkan
  yang keliru.

  **`origin_auth` tanpa default di kode.** Kompiler menyebut keempat penerbit
  sesi, satu per satu, dan tiap satu menamai alasannya. Sebuah default akan
  diam-diam menstempel yang paling umum ke penerbit yang lupa — justru field yang
  nanti dipakai menalar radius ledakan.

  **Rotasi step-up MEMBAWA asal aslinya.** Menaikkan assurance bukan
  mengautentikasi ulang; menstempel `password` di sana akan menulis ulang
  provenance sebuah sesi SSO tepat pada saat seseorang membuktikan faktor kedua.

  **Empat penolakan, satu bentuk.** Id tak dikenal, sesi orang lain, sesi tenant
  lain, dan yang sudah dicabut/kedaluwarsa semuanya `404` — membedakannya
  menjadikan endpoint ini oracle keberadaan id sesi. Kepemilikan ditegakkan di
  klausa `WHERE` UPDATE-nya, bukan oleh pembacaan sebelumnya. Mencabut sesi yang
  sedang dipakai dijawab `409` yang **menyebut penggantinya** (`/auth/logout`),
  bukan sukses senyap yang meninggalkan cookie mati.

  **Tanpa `last_seen_at`**, sengaja: ia harus ditulis di jalur baca otorisasi —
  satu UPDATE per request per sesi, selamanya — untuk kolom yang tugasnya kosmetik.

  CHECK-nya sengaja **tidak** memuat `switch`: tak ada endpoint tenant-switch di
  repo ini, dan CHECK yang memuat nilai yang tak bisa diproduksi apa pun terbaca
  sebagai kapabilitas yang sudah ada.

  Migrasi diterapkan dua kali ke Postgres nyata (apply + idempotensi).

- 845ec9f: feat(access): sebuah grant ber-scope hanya mencakup apa yang diberikan perannya

  [ADR-0080](docs/adr/0080-a-scoped-grant-covers-only-what-its-role-confers.md),
  Gelombang 3 PR 3.4. Tanpa migrasi.

  `BusinessScopeFact` mendapat `permissionKeys?`, dan predikat cakupan
  `evaluateAccess` mendapat satu klausa. Sebuah baris `awcms_access_policies` yang
  `scope_type`-nya bukan tenant-wide kini melahirkan fakta ber-scope yang membawa
  persis permission key yang diberikan perannya; fakta dari
  `awcms_business_scope_assignments` membawa `undefined` dan berperilaku persis
  seperti sebelumnya.

  **Seluruh argumen keamanannya bisa dibaca, bukan dipercaya.**
  `scopeFactQualifies` tidak punya cabang yang menghasilkan cakupan — satu-satunya
  nilai yang bisa disumbangkannya adalah `false`. Sisanya dibuktikan sebagai
  properti atas korpus (6 bentuk fakta × 5 himpunan relasi × 2 aksi × 4 himpunan
  kunci): jawaban ber-kualifikasi tak pernah `true` di mana jawaban
  tanpa-kualifikasi `false`. Ditambah satu assertion bahwa korpusnya **tidak
  hampa** — klausa yang tak melakukan apa-apa memuaskan properti pertama dengan
  sempurna, dan itulah cara test semacam ini biasanya berbohong.

  **Klausanya PERTAMA, sebelum `tenantWide`.** Fakta tenant-wide mencakup setiap
  scope yang diminta; kalau klausanya sesudahnya, fakta tenant-wide yang membawa
  kunci akan mencakup permission yang tidak diberikan perannya hanya karena ia
  mencakup semua scope. Urutan, bukan penyaringan, yang membuatnya benar — jadi
  di-assert.

  **Grant tenant-wide tidak melahirkan fakta sama sekali.** Ini arah yang akan
  menjadi pelebaran menyeluruh kalau salah: grant tenant-wide adalah _ketiadaan_
  pengurungan scope, bukan pengurungan ke scope bernama `tenant`, dan melahirkan
  fakta `tenantWide` darinya berarti memberikan jawaban gerbang #180 kepada setiap
  orang yang memegang peran apa pun. Test integrasi pertamanya adalah itu.

  **Kill switch build-time.** `SCOPE_NARROWING_ENABLED` bukan env var: dua instance
  dari satu deployment bisa berbeda pendapat tentang env var — restart bergulir,
  container basi, `--env-file` yang terlupa — dan aturan otorisasi yang jawabannya
  bergantung pada socket mana yang menerima request bukanlah aturan. Membaliknya
  berarti perubahan kode dan redeploy, dan itu memang maksudnya. Kedua keadaannya
  diuji (flag-nya parameter), jadi keadaan mati bukan keadaan yang belum pernah
  dijalankan.

  **Batas yang WAJIB dibaca sebelum permukaan penulisnya dibangun.** Kualifikasi
  scope hanya sekuat rute yang **menyatakan** required scope.
  `fetchGrantedPermissionKeys` tetap mengembalikan kunci dari semua grant — ia
  harus, karena gerbang RBAC berjalan lebih dulu dan kunci yang absen di sana
  membuat jalur ber-scope tak pernah terjangkau — sehingga pada rute yang tak
  menyatakan scope, sebuah grant ber-scope memberi permission itu di seluruh
  tenant. Hari ini inert (nol penulis, dan itu di-assert terhadap basis data
  sungguhan, bukan diargumentasikan), tetapi PR yang membangun permukaan admin
  untuk menulisnya tidak boleh mendarat tanpa menjawabnya.

  Satu test yang ADA memang berubah, dan alasannya layak disebut karena catatan
  reviewer rencana berbunyi "setiap test business-scope yang ada harus lulus tanpa
  diubah". Yang berubah bukan assertion-nya — `toHaveLength(1)` tetap
  `toHaveLength(1)` — melainkan **stub `tx`-nya**, yang dulu menjawab setiap
  statement dengan baris yang sama. Resolver kini mengeluarkan dua query, dan stub
  yang tak bisa membedakan keduanya akan menjawab pembacaan grant dengan baris
  assignment, melahirkan fakta yang tak diproduksi grant mana pun. Semantik domain
  memang tidak berubah: `business-scope-access-control.test.ts` lulus apa adanya.

- 33f082c: feat(access): tabel grant lama menjadi sejarah, dan lima pembaca yang sudah basi diperbaiki

  [ADR-0079](docs/adr/0079-the-legacy-grant-table-becomes-read-only-history.md).
  `sql/103` menyalin setiap baris `awcms_access_assignments` ke
  `awcms_access_policies` dengan **`id` dipertahankan** — rujukan audit menamai
  sebuah grant lewat id-nya, dan backfill yang mencetak id baru akan memutus
  semuanya secara senyap — lalu mencabut `INSERT`/`UPDATE`/`DELETE` dari
  `awcms_app`. `SELECT` sengaja ditahan: sejarah yang tak bisa dibaca bukan
  sejarah, ia hanya tak bisa diubah.

  **Yang dicari dan yang ditemukan bukan hal yang sama.** Yang direncanakan adalah
  backfill. Yang ternyata ada di sana: sejak PR sebelumnya (#506) memindahkan
  setiap PENULIS grant ke tabel baru, **lima pembaca masih membaca tabel lama** —
  dan untuk setiap tenant yang dibuat sesudah PR itu, mereka menjawab tentang
  tabel yang tak ditulis siapa pun. Tiap satunya salah dengan cara berbeda:

  - `GET /api/v1/auth/session` melaporkan owner **tanpa satu pun peran**;
  - `/admin/users` menampilkan setiap pengguna dengan daftar peran kosong;
  - `TenantContext.roles` kosong, sehingga kebijakan ABAC `subject.roles` berhenti
    cocok — `allow` yang berhenti cocok itu penyempitan (aman), tetapi **`deny`
    yang berhenti cocok adalah PELEBARAN**, dan tak ada yang mengamatinya;
  - SoD berhenti melihat grant RBAC biasa dan melaporkan "tak ada konflik";
  - guard `last_admin_blocked` menyimpulkan tenant tak punya administrator, jadi
    **owner terakhir bisa dinonaktifkan** — tenant terkunci tanpa jalan pulih di
    dalam aplikasi.

  38 gerbang hijau selama itu, `bun run check` lewat, dan test unit lewat — karena
  setiap satunya meng-assert sebuah pembaca terhadap **dirinya sendiri**. Tak ada
  yang menulis grant lewat penulis sungguhan lalu bertanya kepada para pembacanya.

  **Jadi perbaikannya bukan membetulkan lima query.** `activeRoleGrants`
  (`identity-access/application/grant-source.ts`) adalah satu-satunya definisi
  "peran apa yang sedang dipegang", disisipkan setiap pembaca sebagai subquery.
  Sebuah pembaca memakainya atau ia bukan pembaca:
  `tests/grant-source-parity.test.ts` mengunci itu secara statis dan
  `tests/integration/grant-readers.integration.test.ts` secara perilaku — yang
  kedua adalah bentuk yang akan menangkapnya sejak awal, karena sebuah pembaca
  bisa diarahkan ke tabel apa pun dan tetap ter-compile. Mengembalikan satu
  pembaca ke tabel lama memerahkan keduanya (diuji).

  **Fragmen, bukan VIEW.** View juga akan jadi satu definisi, tetapi yang pertama
  di repo ini harus menjawab `security_invoker` di perubahan yang sama — tanpanya
  view berjalan sebagai PEMILIKNYA dan **melewati FORCE RLS** tabel di bawahnya,
  dan setiap test RLS yang ada akan tetap hijau. Fragmen menghasilkan SQL yang
  persis sama dengan yang akan ditulis pembacanya, jadi RLS berlaku seperti
  sebelumnya dan jumlah query tidak bertambah.

  **`awcms_business_scope_assignments` sengaja TIDAK ikut dipensiunkan**, meski
  rencana program menyebut "dua tabel lama". `role_id` di sana tidak memberi satu
  pun permission key hari ini — hanya SoD yang membacanya, dan hanya sebagai
  fakta. Memindahkannya sekarang akan memberi setiap subjek ber-scope permission
  peran itu **di seluruh tenant**, karena belum ada yang mengualifikasi scope saat
  evaluasi sampai PR 3.4; dan `role_id`-nya nullable sedangkan tujuannya tidak.

  **Satu cacat lain ikut ketahuan, dan gerbangnya tak bisa melihatnya.**
  `awcms_setup` tak pernah diberi privilege pada tabel Policy, jadi setup wizard
  gagal `permission denied for table awcms_access_policies` di setiap deployment
  ber-`SETUP_DATABASE_URL` sejak #506. `checkWorkerSetupRoleGrants` memeriksa
  apakah grant COCOK dengan matriks yang dideklarasikan — dan kedua sisi memang
  masih setuju satu sama lain; tak ada yang memeriksa apakah matriksnya cocok
  dengan yang DIBUTUHKAN kode.

  Sisanya adalah kelas gerbang baru: tabel tenant-scoped yang sengaja read-only
  harus **dideklarasikan** di `RETIRED_TENANT_TABLE_PRIVILEGES`, dan ditegakkan
  **dua arah** — tabel terdaftar yang mendapatkan kembali `INSERT` gagal sekeras
  tabel tak-terdaftar yang kehilangan `SELECT`. Default keempat-verb untuk tabel
  tenant-scoped menanggung beban nyata (tabel FORCE RLS yang tak bisa ditulis
  runtime adalah `permission denied` yang menunggu request pertama), jadi
  membaliknya harus jadi kalimat yang ditulis seseorang, bukan efek samping sebuah
  migrasi.

- 4ba359e: feat(access): sebuah grant membawa scope-nya sendiri — dan dengan tabelnya kosong, jawabannya identik dengan hari ini

  Gelombang 3 PR 3.1 dari #423, [ADR-0078](docs/adr/0078-a-grant-carries-its-own-scope.md).
  `sql/102` menurunkan `awcms_access_policies` (+ riwayat append-only-nya), dan
  `fetchGrantedPermissionKeys` membaca **kedua** bentuk grant lewat `UNION ALL`.

  Hari ini sebuah grant adalah `awcms_access_assignments (tenant_user_id, role_id)`
  dan menjawab satu pertanyaan: apakah orang ini memegang peran itu **di mana pun**
  dalam tenant. Sebuah Policy menjawab yang lebih sempit — peran ini **pada scope
  ini** — yaitu bentuk yang membuat "editor satu kantor" bisa dinyatakan tanpa
  menciptakan sumbu otorisasi kedua.

  **Dengan tabel barunya kosong, hasilnya identik dengan sebelumnya.** Itu seluruh
  argumen keamanan PR ini, dan ia tentang `UNION ALL` di dalam sebuah string SQL —
  membacanya tidak membuktikan apa pun. Satu `JOIN` yang pindah ke subquery, satu
  predikat `tenant_id` yang hilang di satu sisi, satu `DISTINCT` yang berhenti
  mencakup satu kolom: semuanya terbaca baik-baik saja dan semuanya mengubah
  jawaban. Jadi oracle-nya menjalankan query sungguhan terhadap baris sungguhan,
  berdampingan dengan **transkripsi tangan** query pra-migrasi. Oracle yang berbagi
  sumber dengan benda yang ia adili tidak mengadili apa pun.

  Oracle itu punya **dua** paruh, dan keduanya perlu: ekuivalensi (tabel kosong →
  jawaban sama) **dan** efek (baris policy benar-benar memberi grant, dan kolom
  siklus hidupnya benar-benar menyaring). Tanpa paruh kedua, cabang `UNION ALL`
  yang diam-diam tidak mencocoki apa pun akan lulus paruh pertama dengan sempurna.

  **Tabel BARU, bukan kolom tambahan**, tiga alasan dan yang pertama menyelesaikan:
  `UNIQUE (tenant_id, tenant_user_id, role_id)` justru yang harus **mati** (satu
  peran di tiga scope = tiga baris), dan mencabut indeks unik dari tabel otorisasi
  yang hidup **di migrasi yang sama** dengan yang melebarkan makna tabelnya adalah
  perubahan dengan mode kegagalan terburuk yang tersedia: kalau salah, ia salah ke
  arah **membolehkan**, tanpa satu pun gerbang memerah. Dua alasan lainnya di ADR.

  **Dua tempat rencana program tidak diikuti, keduanya ke arah "jangan kirim yang
  belum bisa dipakai":**

  1. `subject_type` hanya menerima `'tenant_user'`. Rencana menulis
     `('tenant_user', 'user_group')` plus XOR dua kolom subjek, tetapi grup
     pengguna belum ada — CHECK yang memuat nilai yang tak bisa diproduksi apa pun
     terbaca sebagai kapabilitas yang sudah ada, dan `user_group_id` tanpa tabel
     tujuan adalah FK yang tak bisa ditulis. Disiplin yang sama dipakai `sql/100`
     untuk `origin_auth`. Kolom **diskriminatornya** ada sejak sekarang justru
     supaya penambahan nilai nanti bukan backfill.
  2. Tipe kembalian `fetchGrantedPermissionKeys` **belum** menjadi
     `{ keys, scopes }`. Field yang tak dibaca apa pun adalah bau
     kapabilitas-tak-terpakai yang persis dihapus ADR-0077, dan ia akan mengaduk
     **sebelas** call site di PR yang paling tak mampu menanggung diff tak
     berkaitan. Tipenya berubah di PR yang mengonsumsinya (3.4).

  **Namanya tidak boleh berubah**, dan ada test yang menjaganya:
  `access-chokepoint-check.ts` mengunci sinyal "handler ini memutuskan permission"
  pada literal `fetchGrantedPermissionKeys(`, sehingga rename meninggalkan gerbang
  itu **hijau sambil melaporkan nol handler yang memutuskan**.

  Penanggalan efektif dievaluasi **di basis data**: grant yang kedaluwarsa menurut
  gagasan aplikasi tentang waktu adalah grant yang bisa diperpanjang oleh bug
  aplikasi.

  `awcms_access_policies` masuk `GRANT_TABLES` gerbang `access:grant-readers:check`
  **di PR yang sama dengan yang menciptakannya**, jadi tak pernah ada berkas yang
  merakit join atasnya tanpa tercatat.

- a4812cb: feat(access): sebuah grup pengguna adalah subjek, dan ia memberi peran

  [ADR-0081](docs/adr/0081-a-user-group-is-a-subject-that-grants-roles.md),
  Gelombang 3 PR 3.5 — penutup gelombang. `sql/104` (dua tabel + `subject_type`
  melebar), `sql/105` (empat permission).

  Sebuah grup memegang grant di `awcms_access_policies` persis seperti orang
  memegangnya, dan keanggotaan menjangkau **setiap pembaca lewat SATU cabang**
  tambahan di `activeRoleGrants`.

  **Mode kegagalan senyap yang ditolak desain ini.** Sebuah grup bisa saja
  dibangun untuk memberi permission KEY langsung; dari luar tampilannya identik.
  Subjek akan memegang kuncinya sementara `subject.roles` tetap KOSONG — sehingga
  kebijakan tenant `subject.roles in ["editor"]` diam-diam berhenti cocok. Yang
  `allow` berhenti cocok itu penyempitan (aman, ada yang menyadarinya); yang
  **`deny` berhenti cocok itu INERT, yaitu pelebaran**, dan tak ada yang
  mengamatinya. SoD buta dengan cara yang sama, persis untuk grant yang keberadaan
  fitur grup dimaksudkan menciptakannya.

  Test integrasinya karena itu tidak berbunyi "keanggotaan bekerja". Ia berbunyi:
  peran turunan-grup sampai ke `subject.roles`, ke `fetchGrantedPermissionKeys`,
  ke resolver SoD, dan ke daftar admin — keempatnya, dalam satu assertion.

  **Gerbang yang diminta rencana tidak dibangun, dan itu bukan pemotongan.**
  `access:sod-fact-parity:check` mewajibkan kedua resolver merujuk satu konstanta
  bersama. ADR-0079 sudah menutup celahnya lebih rapat: para pembaca tidak lagi
  menyebut tabel grant sama sekali, mereka menyisipkan fragmennya, dan
  `access:grant-readers:check` menolak berkas yang merakit join sendiri. "Merujuk
  konstanta yang sama" bisa benar sementara kedua query berbeda; "memakai fragmen
  yang sama" tidak bisa.

  **Empat keputusan yang menanggung beban:**

  - **Memberi grup sebuah PERAN memakai `access_control.assign`**, bukan permission
    grup. Membaliknya adalah eskalasi tanpa nama yang jelas: administrator grup
    yang juga bisa memberi peran kepada grupnya sendiri bisa memberi `owner`
    kepada grup yang ia anggotai. `assignRoleToGroup` juga menolak peran
    `is_system` — di sini penolakan itu lebih penting daripada di jalur per-orang,
    karena grant kepada grup menjangkau juga setiap orang yang ditambahkan NANTI.
  - **`external_id`, bukan `group_code`, adalah kunci sinkron.** Rename di IdP
    tidak boleh meng-orphan grup. SCIM **tidak dibangun** — yang dibangun adalah
    penolakannya (`409 GROUP_EXTERNALLY_MANAGED`), karena suntingan lokal yang
    diam-diam dibatalkan sinkron berikutnya lebih buruk daripada yang tak pernah
    diterima. `source` juga tak pernah diterima dari request.
  - **Tak ada `delete`.** Memensiunkan grup adalah tiga keputusan — grant-nya,
    keanggotaannya, dan `external_id` yang besok disodorkan direktori lagi.
    Soft-delete sudah punya arti yang benar (`deleted_at IS NULL` ada di cabang
    grup, jadi grup terhapus memberi nol), tetapi permukaan yang menyetelnya
    menunggu keputusan itu.
  - **`UNION ALL`, bukan `UNION`.** Subjek bisa memegang peran yang sama langsung
    DAN lewat grup, dan tiap konsumen sudah men-dedupe apa yang perlu. Membayar
    sort di jalur otorisasi untuk menghemat mereka nol adalah membayar di tempat
    paling mahal.

  **Mencabut `NOT NULL` dari tabel otorisasi hidup**, kata-kata yang terdengar
  persis seperti perubahan yang DITOLAK ADR-0078. Perbedaannya: di sana yang
  dicabut indeks unik, yang salah ke arah MEMBOLEHKAN tanpa gerbang memerah. Di
  sini ia DIGANTI CHECK yang lebih ketat di blok yang sama — baris tanpa subjek,
  dengan dua subjek, atau dengan subjek yang tak sesuai diskriminatornya kini
  ditolak (diuji terhadap basis data, lewat koneksi yang melewati API). Dan indeks
  unik parsialnya wajib dapat saudara: `NULL` tidak sama dengan `NULL`, jadi yang
  lama berhenti membatasi apa pun begitu `tenant_user_id` boleh NULL.

  Plafon `BOUNDED_BY_DESIGN` naik dari 3 ke 5, dan **menaikkan baris itu adalah
  tindakan yang direview** — yaitu plafonnya bekerja, bukan gagal. Keempat entri
  adalah satu argumen dalam dua paruh: tabel yang barisnya grant buatan
  administrator, plus tabel yang dibatasi olehnya. Purge berbasis usia pada salah
  satunya menghapus otorisasi yang hidup.

- 26334bd: Profil deployment `staging` dihapus SELURUHNYA (ADR-0083, sebagaimana diamandemen)

  Bukan hanya environment staging milik repo ini yang dibongkar, melainkan
  `staging` sebagai profil deployment: ia keluar dari `ModuleDeploymentProfile`
  (`src/modules/_shared/module-contract.ts`), dari nilai `APP_ENV` yang diterima,
  dari `.env.example`, dan dari seluruh dokumentasi. Profil yang tersisa:
  `development` / `production` / `offline-lan`.

  **Ini membalik ADR-0083 edisi pertama.** ADR itu, ditulis hari yang sama,
  MEMPERTAHANKAN `staging` dan mendaftarkan penghapusannya sebagai DITOLAK dengan
  alasan "mencabut kapabilitas dari setiap pemakai template". Pemilik repo
  membatalkan argumen itu, dan karena ADR-0083 belum ter-commit dan belum dirilis
  ia **diamandemen di tempat** alih-alih di-supersede ADR baru — sebuah ADR yang
  berbunyi "`staging` tetap sah" di sebelah kode yang tak memuatnya adalah persis
  dokumen percaya-diri-dan-salah yang berulang kali menggigit repo ini.

  Alasan yang menggantikannya: **profil deployment yang tak pernah dijalankan
  siapa pun adalah klaim, bukan kapabilitas.** `staging` tidak pernah punya satu
  pun jalur kode yang memperlakukannya berbeda dari `production`; satu-satunya
  `APP_ENV=staging` yang benar-benar berjalan justru sedang melayani domain
  produksi di atas database staging. Pemakai template yang butuh environment kedua
  membuatnya dengan `APP_ENV=production` kedua dan basis data kedua.

  **Dampak bagi instalasi turunan (BREAKING pada level authoring, bukan runtime):**
  `module.ts` yang mendeklarasikan `deploymentProfiles: ["staging"]` kini gagal
  typecheck. Ganti ke profil yang tersisa, atau hilangkan field-nya (absennya
  berarti "tanpa batasan profil"). Komposisi build-time membandingkan string biasa,
  jadi tidak ada perilaku runtime yang berubah. Deployment yang menjalankan
  `APP_ENV=staging` harus pindah ke `APP_ENV=production` sebelum upgrade —
  `config:validate` menolak nilai lama.

  Sisi infrastruktur (di luar repo): produksi ditegakkan di `awcms.ahlikoding.com`;
  app Coolify, database, dan Varnish staging dibongkar setelah backup diambil DAN
  diverifikasi lewat restore-drill ke database scratch.

- 02b0f4d: feat(rute): keluarga `/news/**` dipensiunkan dengan 301 ke `/blog/{tenantCode}/**` (ADR-0071 §4); keputusan RUM ADR-0067 diambil

  **Ini perubahan URL publik.** Empat rute `/news/**` yang ADR-0059 daratkan tidak lagi dilayani repo ini, dan setiap permintaan ke sana kini **301 permanen** ke `/blog/{tenantCode}/**`. Tidak ada tenant yang perlu mengubah konfigurasi, dan tidak ada tenant yang bisa memilih untuk tetap dilayani — keluarga rutenya hilang untuk semua orang, sesuai [ADR-0071](docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md) yang membelah kosakata URL keluarga: `/blog/**` milik repo ini, `/news/**` milik `ahliweb/awcms-astro`.

  `publicRouteMode` masih `domain_default` sebagai bawaan modul, artinya `/news/**` **menyala** untuk setiap tenant yang tidak mematikannya. Menghapusnya tanpa penerus akan mematikan URL yang sitemap dan feed repo ini sudah iklankan; 301 adalah penerusnya.

  - **Redirect-nya adalah kebalikan dari yang sudah ada.** `domain/legacy-blog-redirect.ts` — yang memetakan `/blog/{tenantCode}` → `/news` — diganti `domain/retired-news-redirect.ts` yang memetakan arah sebaliknya, dan strategi 1 di `redirect-resolution-service.ts` dibalik bersamanya. Arah yang salah tidak melempar, tidak menggagalkan typecheck, dan hanya terlihat sebagai loop pada tenant yang kebetulan punya kedua bentuk hidup — jadi test pertamanya soal **arah**, dan ia menamai apa yang dijaganya.
  - **Tidak ber-policy, dan tidak digerbangi `seo_distribution` aktif.** Yang digantikannya adalah rewrite OPSIONAL yang tenant nyalakan; ini migrasi URL yang tak seorang pun pilih. Menggerbanginya pada modul yang bisa dimatikan tenant berarti tenant yang mematikannya justru yang URL terbitnya mati.
  - **Satu syarat bertahan, dan ia menjaga invarian ADR-0071 §3.** Tenant dengan `legacyTenantRouteEnabled: false` **tidak** mendapat redirect: ia sudah mematikan seluruh permukaan konten publiknya, jadi 301 ke `/blog/{tenantCode}` adalah 301 ke 404 yang pasti. "Jangan pernah mengiklankan URL yang tidak kita layani" berlaku untuk tujuan redirect, bukan hanya entri sitemap.
  - **`legacy_blog_redirect_enabled` (`sql/060`) pensiun tetapi tidak dihapus.** Migrasi terapan immutable dan di-checksum `scripts/db-migrate.ts`, dan permukaan API-nya sudah terbit. Tidak ada lagi yang membacanya — ia kini benar-benar inert, dan untuk alasan yang **diputuskan** alih-alih kebetulan.
  - **Batas segmen bukan hipotetis.** Repo ini punya nama kapabilitas `newsletter`; `startsWith("/news")` telanjang akan mem-301 `/newsletter` menjadi `/blog/{tenantCode}letter`. Ada testnya.

  Yang ikut dicabut bersama keluarga rutenya: `publicRouteMode`, `withHostResolvedBlogTenant`, `padUnresolvedHostRouteLatency`, `HOST_RESOLVED_PUBLIC_BASE_PATH`, dan `"/news"` dari `blog_content.api.routes`. Tabel base path SEO menciut dari tiga baris ke dua — tenant menyajikan `/blog/{tenantCode}` atau tidak menyajikan apa pun; baris `null` yang membawa invariannya tidak berubah.

  **Penanda §4 ADR-0071 dibalik ke SUDAH DILAKSANAKAN**, dan `tests/url-vocabulary-split.test.ts` memang **memerah di antara** penghapusan rute dan pembalikan penanda itu — gerbang yang ditulis untuk jendela ini terbukti menutupnya, bukan sekadar mengklaimnya.

  Yang hanya terasa saat mengembangkan:

  - **ADR-0067 berhenti `Proposed`.** Bagian RUM yang sengaja ditinggalkan pada 4 Agustus mendapat keputusannya: **Opsi B** — agregasi di titik masuk, nol baris mentah, Opsi C tetap ditolak. Statusnya `Accepted (belum diimplementasikan)` dan itu **digerbangi**: ADR ini kini punya entri di peta `tests/adr-implementation-status.test.ts`, yang menuntut kualifikasi selama artefaknya belum ada dan menuntut pencabutannya pada PR yang mendaratkannya. Artefak yang dipetakan **agregatnya**, bukan endpoint-nya — memetakan endpoint akan membiarkan implementasi baris-mentah memuaskan gerbangnya.
  - **`POST /api/v1/analytics/vitals` adalah permukaan tulis publik tanpa autentikasi**, kelas yang paling sedikit dimiliki repo ini. Adendum ADR-0067 menuliskan apa yang wajib dibawa PR implementasinya: rate limit ADR-0066 + batas badan sebelum satu baris ditulis, normalisasi rute ke POLA dari daftar rute nyata (bukan string klien), validasi rentang nilai metrik, dan `VISITOR_ANALYTICS_ENABLED` tetap saklarnya.
  - **Dua baris celah §9 berhenti berbohong.** C13 menyatakan approval rilis tertahan dan "GitHub Release terbaru masih `v6.4.0`" — `v7.0.0` dan `v7.0.1` sudah terbit. C7 menyatakan bagian RUM menunggu pemilik produk — tidak lagi. Nol celah `TERBUKA` tersisa di dokumen yang dilabeli LIVING dan disuruh dibaca sebelum go-live.

- f8fdcd8: feat(push): service worker + konsol `/admin/push-notifications` — modul jadi `active`

  Modul `push_delivery` mendapat permukaan operatornya, dan dengan itu berpindah
  dari `experimental` ke **`active`**. Perpindahan itu bukan pernyataan: ADR-0021
  kriteria 1 menolak modul `active` tanpa layar admin, **tanpa pengecualian**, dan
  modul ini memilih status jujur selama tiga PR daripada menulis carve-out —
  komentar test itu sendiri mencatat apa yang terjadi terakhir kali seseorang
  menulis carve-out: alasannya menua dan justru akan membiarkan sebuah modul
  **kehilangan** layarnya tanpa ketahuan.

  Tiga baris `NOT_YET_SCREENED` yang ditambahkan PR sebelumnya dihapus. Ledger itu
  hanya boleh **menyusut**: meninggalkannya setelah layar dibangun akan
  memerahkan `admin:screen-coverage:check`, dan itulah yang menjaga angkanya
  jujur.

  ## Dua audiens dalam satu halaman, dengan sengaja

  Separuh atas **self-service** — "notifikasi di perangkat ini" — dan tidak
  memerlukan permission apa pun: subjeknya adalah orang yang sedang melihatnya.
  Separuh bawah adalah antrean tenant dan butuh `diagnostics.read`.

  Keduanya berbagi halaman karena bersama-sama menjawab satu pertanyaan. "Saya
  sudah mengaktifkan notifikasi dan tidak ada yang datang" dijawab oleh panel
  perangkat (browser ini berlangganan?) **dan** panel antrean (ada yang masuk
  antrean, dan apa kata push service?) — dan operator yang harus mengorelasikan
  dua layar akan mengorelasikan dua momen waktu.

  ## Service worker: dua perilaku yang terlihat opsional dan tidak

  **Push tanpa payload tetap menampilkan notifikasi.** Beberapa push service
  mengirim "tickle" tanpa isi, dan payload yang gagal didekripsi tak terpakai.
  Diam bukan default yang aman: browser **mewajibkan** notifikasi terlihat untuk
  setiap push, menjawab yang senyap dengan "situs ini diperbarui di latar
  belakang" miliknya sendiri, dan bila berulang **mencabut izinnya**.

  **Target klik di-resolve terhadap origin ini lalu dibandingkan.**
  `push-target-path.ts` sudah memvalidasi sebelum baris ditulis, jadi ini tembok
  kedua — tapi inilah kode yang benar-benar menavigasi, dan notifikasi yang
  membawa nama serta ikon situs ini adalah kendaraan open-redirect paling
  meyakinkan yang ada. `new URL(path, origin)` yang membuatnya bisa diputuskan:
  `//evil.example/x` protocol-relative me-resolve ke origin lain dan tertangkap,
  sementara uji string "diawali `/`" akan meloloskannya.

  Ikon **tidak** diambil dari payload: ia akan di-fetch saat ditampilkan,
  menyerahkan alamat IP penerima dan fakta bahwa ia sedang online kepada siapa pun
  yang memilih URL-nya.

  Berkasnya ada di `public/` pada path **tetap**, dan itu bukan kemalasan:
  registrasi dikunci pada URL skrip, jadi nama ber-hash-konten akan berganti
  setiap build lalu meninggalkan setiap langganan yang dibuat build sebelumnya.

  ## Konversi kunci VAPID adalah tempat ini diam-diam rusak

  `atob` **menolak** alfabet base64url, jadi kunci yang mengandung `-` atau `_`
  melempar `InvalidCharacterError` saat `subscribe()` — dan kira-kira tiga
  perempat kunci nyata mengandung salah satunya, karena masing-masing dari 65 byte
  punya peluang menghasilkannya. Kunci yang kebetulan tidak mengandungnya bekerja,
  yang persis cara hal ini rilis hijau lalu gagal untuk sebagian besar deployment.
  Konversinya ditulis sendiri dan diuji dengan kunci yang **dipastikan**
  mengandung keduanya.

  ## Angka klien, disebut ulang supaya perbandingan ADR-0074 tetap jujur

  "Nol byte SDK" tetap benar dan itu memang klaimnya. Sisi klien tidak gratis:

  |                                                                    | Byte       |
  | ------------------------------------------------------------------ | ---------- |
  | `push-sw.js` (disalin apa adanya dari `public/`, tak diminifikasi) | 5.515      |
  | skrip halaman (terbundel + terminifikasi)                          | 4.659      |
  | **total**                                                          | **10.174** |
  | SDK FCM Web yang DITOLAK (halaman + service worker)                | **91.333** |

  Selisihnya 9×, kedua berkas SDK itu menembus plafon per-berkas 21.000 B, dan
  janji CSP ADR-0029 tetap utuh: `worker-src` jatuh ke `default-src 'self'`,
  service worker-nya same-origin, dan **tidak ada satu pun direktif yang berubah**.

  Anggaran aset: 150.182 / 180.000 B.

  ## `enqueuePushToRecipients` akhirnya punya pemanggil produksi

  `POST /api/v1/push/test`. Kesenjangan yang ADR-0074 catat di §Konsekuensi
  alih-alih dibiarkan ditemukan, kini ditutup dan ADR-nya diperbarui.

- 70483a0: feat(auth): `approvals` dan `reporting` memakai entry any-of (#450, R3)

  Ledger 7 → 5.

  `approvals` (dua panel, delapan permission) dan `reporting` (tiga panel, tujuh
  permission) — keduanya bentuk any-of yang sama: panel yang bisa dibaca
  independen, penolakan halaman hanya bila semua panel ditolak.

  `approvals` layak disebut: ia inbox persetujuan, jadi keputusan tentang siapa
  boleh MELIHAT tugas yang menunggu keputusannya kini ikut tercatat di
  `awcms_abac_decision_logs`, dan `deny` ABAC tenant berlaku pada pembacaannya —
  bukan hanya pada tombol Approve. Enam afordans tulisnya, termasuk tiga jalur
  `recovery` (`reassign`, `cancel`, `force_decide`), diputuskan lewat `can(...)`
  pada transaksi yang sama.

  `reporting` menyimpan satu detail yang mudah rusak saat dipindahkan: peta
  `reconciliationsByKey` diisi dengan satu query per proyeksi, berurutan di dalam
  transaksi yang sama. Ia tetap begitu — `tx` satu koneksi ter-reserve, jadi
  sebuah `Promise.all` di sana akan membocorkannya.

  Dua contract test-nya mengekstrak klaim hanya dari `permissionKey(...)`;
  ekstraktornya kini membaca kedua ejaan.

- b35fd65: feat(auth): `loadAdminScreen` mendapat entry ANY-OF, dan dua konsol pertama memakainya (#450, R3)

  Delapan konsol admin sisa punya bentuk yang sama: beberapa panel yang bisa
  dibaca secara independen, dan penolakan halaman hanya bila **semua** panel
  ditolak (`canSeeAnything = canReadNodes || canReadConflicts || canReadQueue`).

  Memaksa satu permission menjadi ENTRY untuk layar-layar itu akan menolak
  operator yang sah memegang baca satu panel dan bukan panel lain — **penyempitan
  akses nyata yang menyamar sebagai refactor**. Jadi helper-nya yang belajar
  bentuk itu, bukan layarnya yang dibengkokkan.

  `authorize` kini menerima array: diizinkan bila **setidaknya satu** diizinkan.
  Array KOSONG menolak — "tidak ada request yang mengotorisasi halaman ini" tidak
  boleh terbaca sebagai "request apa pun mengotorisasinya", penalaran fail-closed
  yang sama dengan tenant platform yang tak terselesaikan di `access-guard.ts`.

  Setiap request entry dievaluasi — daftarnya TIDAK di-short-circuit pada izin
  pertama — dan hasilnya dikembalikan lewat `entry: readonly boolean[]` mengikuti
  urutan deklarasi. Itu justru intinya: panel membaca jawabannya sendiri dari
  sana alih-alih bertanya lagi lewat `can()`, yang akan menulis baris
  `awcms_abac_decision_logs` KEDUA untuk keputusan identik dalam satu render —
  derau di jejak audit, bukan bukti.

  ## Aturannya diuji sebagai fungsi murni

  `selectEntryOutcome` diekstrak supaya setiap cabangnya bisa diuji tanpa
  database, dan `tests/admin-screen-entry.test.ts` baru menguji delapan hal —
  termasuk mutasi yang paling berbahaya: menulis aturannya sebagai "tidak SEMUA
  request ditolak" meloloskan `[]`, karena `[].every(...)` bernilai **true**.
  Sebuah layar yang kehilangan request entry-nya dalam sebuah suntingan akan
  terbuka untuk setiap pengguna terautentikasi tenant itu, tanpa satu gerbang pun
  merah.

  Sampai PR ini helper-nya belum punya test perilaku sama sekali — hanya gerbang
  struktural yang membuktikan layar meruteinya.

  ## Dua konsol pertama

  `sync` (tiga panel, enam permission) dan `domain-events` (tiga panel, lima
  permission). Ledger 9 → 7.

  Dua contract test-nya mengekstrak klaim hanya dari `permissionKey(...)`;
  ekstraktornya kini membaca kedua ejaan, sekelas dengan koreksi di batch 1, 4, 5
  dan platform-scope.

- 9d14876: feat(admin): layar `/admin/blog-settings` — pengaturan blog berhenti hanya bisa diubah lewat `curl`

  `GET`/`PATCH /api/v1/blog/settings` mendarat lengkap bersama Issue #543 —
  ter-guard di dalam `withTenant`, ter-audit, tervalidasi — dan punya **nol
  konsumen UI**. `rssEnabled` dan `sitemapEnabled` menentukan apakah feed dan
  sitemap tenant dilayani sama sekali, dan sampai sekarang satu-satunya cara
  mengubahnya adalah `curl`. Kapabilitas yang tak bisa dijangkau operator adalah
  kapabilitas yang sebenarnya tidak dimiliki deployment.

  **Ini BUKAN layar setting modul, dan bedanya load-bearing.**
  `/admin/modules/blog_content` (Module Management, generik) menulis
  `awcms_module_settings` — override per-tenant atas `settings.defaults`
  descriptor, yang hari ini tinggal `legacyTenantRouteEnabled`. Layar ini menulis
  `awcms_blog_settings`, tabel berbeda dengan permission berbeda
  (`blog_content.settings.*`) dan endpoint berbeda. README modul mencatat
  pemisahan dua-store itu sebagai keputusan.

  Risikonya karena itu bukan store yang hilang, melainkan **kontrol yang
  terduplikasi**: dua layar yang sama-sama tampak menawarkan "pengaturan blog"
  sambil menulis baris yang berbeda. Layar ini karena itu **tidak merender apa pun**
  dari store setting modul dan hanya menautkan ke layar generiknya. Field yang
  dicerminkan dua layar adalah field yang basi diam-diam, karena layar yang diedit
  belakangan menang dan tak satu pun mengatakannya.

  Dua field endpoint sengaja TIDAK ada di form, dan disebutkan namanya supaya
  absennya terbaca sebagai keputusan: `contentQualityChecklistPolicy` (peta
  override severity bersarang — menaruh kebijakan pemblokir-publish di balik
  textarea JSON tanpa umpan balik per-rule bukan kontrol yang layak) dan
  `socialPreviewFallbackImageMediaId` (mengetik UUID bukan media picker;
  `/admin/media` sudah memiliki pemilihan objek, dan field id mentah justru
  mengundang menempel id milik tenant lain yang endpoint-nya tolak sebagai galat
  validasi yang tak bisa ditindaklanjuti operator).

  Satu permission menggerbangi seluruh field (`settings.configure`) karena
  `sql/036` tidak men-seed permission tulis per-field — mengarang gerbang per-field
  di UI akan menyiratkan wewenang yang tak akan dihormati `authorizeInTransaction`
  mana pun.

  Entri navigasi digerbangi `settings.read`, bukan salah satu dari empat entri
  `blog_content` yang sudah ada: operator bisa memegang authoring blog tanpa
  memegang saklar discovery tenant. `tests/admin-blog-page-contract.test.ts`
  mematok jumlah entri navigasi persis supaya tiap kedatangan layar baru menjadi
  baris yang diedit dengan sengaja — dan ia memang memerah saat layar ini mendarat,
  lalu dinaikkan dari empat ke lima.

- 80310dc: feat(auth): lima layar admin berikutnya melewati chokepoint (#450, R3)

  Gelombang 1 batch 2. `registrations`, `modules`, `abac-policies`,
  `blog-settings`, dan `comments` berhenti memutuskan akses dari
  `ssr.permissions.has(...)` — himpunan RBAC mentah — dan berpindah ke
  `loadAdminScreen`, yang menjalankan `authorizeInTransaction` dan pembacaan
  datanya di dalam SATU transaksi.

  Yang dipulihkan pada kelima layar itu: evaluasi kebijakan ABAC (sebuah `deny`
  yang ditulis tenant lewat `/api/v1/abac/policies` ditegakkan di API dan **inert**
  di layar), `resolveModuleAvailability` (tenant yang mematikan modulnya sendiri
  tetap melihat layarnya penuh data), fakta business-scope, SoD saat-aksi, dan
  `recordDecisionLog` — sebuah pembacaan yang terjadi tidak meninggalkan baris yang
  menyatakan bahwa ia terjadi.

  `abac-policies.astro` adalah kasus yang paling tajam: ia layar tempat tenant
  **mengarang** kebijakannya, dan sampai sekarang kebijakan yang ditulisnya tidak
  berlaku pada halaman yang mendaftarkannya.

  Tiap afordans tulis (`approve`/`reject` registrasi, `enable`/`disable` modul,
  `configure` policy dan setelan blog, empat verb moderasi komentar) kini
  diputuskan lewat `can(...)` pada transaksi yang sama, bukan dari himpunan grant
  mentah — jadi `deny` menyembunyikan tombolnya alih-alih baru menolak saat
  ditekan. Endpoint tetap otoritasnya.

  Dua ledger menyusut bersama: `ADMIN_SCREEN_CHOKEPOINT_MIGRATION`
  (`access:chokepoint:check`) dan `NOT_YET_MIGRATED` (`api:tenant-route:check`),
  28 → 23. Keduanya menghitung utang yang sama dari sudut berbeda — "siapa
  memutuskan permission di luar chokepoint" versus "siapa membuka transaksinya
  sendiri" — dan catatan itu kini tertulis di header keduanya supaya PR migrasi
  berikutnya tidak menemukannya lewat gerbang merah.

  Teks remediasi `api:tenant-route:check` diperbaiki: ia masih berkata helper-nya
  "belum ada" dan menyuruh penulis layar baru **menunggu**. Banner "belum ada"
  menua ke arah sebaliknya dari koreksi biasa — ia menyuruh orang berhenti
  mengerjakan hal yang sudah bisa dikerjakan.

  Dua cabang mati ikut hilang: `registrations`, `modules`, dan `abac-policies`
  memeriksa `result instanceof Response` terhadap `withTenantOrThrow`, yang
  melempar dan tidak pernah mengembalikan `Response`. Ketiganya juga menelan
  kegagalan baca dengan `catch {}` kosong; kini kegagalan itu tercatat lewat
  `logAdminPageError` dengan `correlationId`, dan `error` tetap state ketiga yang
  tidak pernah dibaca sebagai penolakan.

- 8f631d2: feat(auth): lima layar admin berikutnya melewati chokepoint (#450, R3)

  Gelombang 1 batch 3. `users`, `roles`, `offices`, `sidebar-menu`, dan
  `tenant/domains` berpindah dari `ssr.permissions.has(...)` ke `loadAdminScreen`:
  `authorizeInTransaction` dan pembacaan datanya kini di dalam SATU transaksi.

  `users.astro` dan `roles.astro` adalah pasangan yang paling berarti di batch
  ini: keduanya **mendaftarkan siapa memegang apa**. Sampai sekarang membaca
  roster akses sebuah tenant tidak melewati evaluasi ABAC dan tidak meninggalkan
  satu baris pun di `awcms_abac_decision_logs` — sebuah `deny` yang ditulis tenant
  tentang `access_control` berlaku saat MENGUBAH keanggotaan dan tidak berlaku saat
  MEMBACANYA.

  `tenant/domains.astro` adalah satu-satunya layar yang tidak tertangkap glob
  `src/pages/admin/*.astro` tingkat-atas — blind spot yang sama yang membuat #424
  menyebut 31 padahal jumlah sebenarnya 32. Ia ikut di batch ini justru supaya
  tidak menjadi sisa terakhir yang terlupa.

  Enam afordans tulisnya (`create`, `update`, `delete`, `verify`, `set_primary`)
  kini diputuskan lewat `can(...)` pada transaksi yang sama.

  `roles.astro` mempertahankan logika R8-nya utuh — katalog permission masih
  disaring `includePlatformScoped` terhadap `resolvePlatformTenant(tx)`, dan
  pemuatan katalog itu tetap hanya terjadi bila `configure` diizinkan; bedanya
  sekarang izin itu jawaban chokepoint, bukan pembacaan himpunan grant mentah.

  Dua ledger menyusut bersama, 23 → 18: `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` dan
  `NOT_YET_MIGRATED`.

  Kebersihan: cabang mati `result instanceof Response` terhadap
  `withTenantOrThrow` dihapus di empat layar, dan pemeriksaan bentuk di
  `sidebar-menu.astro` (`"entries" in result`) — yang ada persis karena
  `Response` itu truthy — tidak lagi diperlukan sebab tipe `AdminScreenOutcome`
  membedakan `allowed`/`denied`/`error` secara langsung. `catch {}` kosong diganti
  `logAdminPageError` ber-`correlationId`.

- 7acdee0: feat(auth): empat layar admin ber-aktivitas-tunggal melewati chokepoint (#450, R3)

  Gelombang 1 batch 4: `index`, `blog-pages`, `blog-taxonomy`, `media` berpindah
  ke `loadAdminScreen`. Ledger 18 → 14.

  `index.astro` adalah halaman pendaratan yang pertama dilihat setiap operator,
  jadi ia juga tempat sebuah `deny` ABAC atas `reporting.dashboard.read` paling
  kasat mata inert-nya.

  `blog-pages` menggerbangi delapan permission — jumlah terbanyak dari layar mana
  pun sejauh ini — dan ketujuh afordans tulisnya kini diputuskan lewat `can(...)`
  pada transaksi yang sama.

  ## Satu keputusan yang sengaja tidak ditulis rapi

  Ketujuh `can(...)` di `blog-pages.astro` ditulis satu per satu, bukan di-loop
  atas array aksi. Versi loop-nya lebih enak dibaca dan **membuat ketujuhnya tidak
  terlihat** oleh `admin:screen-coverage:check`, yang matcher-nya hanya membaca
  triple literal: layar tetap menggerbangi dengan benar sementara gerbangnya
  melaporkan tujuh permission sebagai tidak punya layar sama sekali. Alasannya
  ditulis di layar itu supaya tidak "dirapikan" kembali nanti.

  ## Tiga contract test diperbaiki, sekelas dengan batch 1

  `admin-blog-taxonomy`, `admin-blog-pages`, dan `admin-media` mengekstrak klaim
  layar hanya dari `permissionKey(...)`. Sesudah migrasi sebuah layar menyatakan
  guard-nya sebagai objek literal `AccessRequest` — bentuk yang SAMA dengan
  rute — sehingga test-nya memerah. Membiarkannya berarti test itu menuntut layar
  tetap memutuskan dari himpunan grant mentah, yaitu cacatnya sendiri.

  Ekstraktor `pageKeys`/`pageTriplesFrom` kini menggabungkan ekstraktor guard yang
  sudah ada di berkas yang sama. Yang dipatok tetap sifatnya — "layar ini
  menggerbangi tepat kedelapan/keempat/kedua ini" — bukan sintaks yang kebetulan
  mengungkapkannya.

  Kebersihan: pemeriksaan bentuk `"tenantActivity" in result` di `index.astro`,
  yang ada persis karena `withTenant` mengembalikan `Response` yang truthy saat
  circuit terbuka, tidak lagi diperlukan — `AdminScreenOutcome` memisahkan
  `allowed`/`denied`/`error` secara langsung. `DASHBOARD_PERMISSION` dipertahankan
  sebagai konstanta TAMPILAN: ia dirender di state ditolak supaya operator bisa
  membaca kunci persis yang harus dimintanya.

- a49f3c9: feat(auth): tiga konsol besar berlayar-tunggal melewati chokepoint (#450, R3)

  `blog`, `analytics`, `theming` berpindah ke `loadAdminScreen`. Ledger 12 → 9.

  Ketiganya ber-aktivitas-jamak tetapi **state penolakannya selalu satu
  permission** (`!canRead` / `!canView`), jadi menjadikan permission itu ENTRY
  tidak mengubah siapa yang ditolak — ia hanya MENAMBAH gerbang yang tidak pernah
  diterapkan pemeriksaan grant mentah. Itu yang membedakan ketiganya dari delapan
  layar sisa, yang menolak hanya bila SEMUA permission bacanya absen; layar-layar
  itu butuh rancangan tersendiri dan tidak dipaksakan ke sini.

  `blog.astro` menggerbangi sebelas permission — terbanyak di repo ini.

  ## Satu gerbang sengaja TIDAK disentuh

  `analytics.astro` sudah lebih dulu menyelesaikan `raw_detail.read` lewat
  `evaluateFieldAccessInTransaction`, bukan `ssr.permissions.has(...)`. Ia
  keputusan tingkat-FIELD tentang kolom mana yang dibentuk pada sebuah baris
  (IP, user-agent, snapshot login), bukan tentang mencapai halaman — dan ia tidak
  pernah menjadi bagian dari cacat R3. Jadi ia tetap apa adanya: migrasi ini tidak
  punya alasan menulis ulang satu-satunya gerbang di layar itu yang sudah benar.

  `analytics` juga kini meneruskan `now` yang sama ke `loadAdminScreen` yang
  dipakainya menghitung rentang, jadi keputusan dan datanya dibaca pada satu jam.

  ## Dua contract test diperbaiki

  `admin-blog-page-contract` dan `admin-theming-page-contract` mengekstrak klaim
  layar hanya dari `permissionKey(...)`. `theming` tidak bisa sekadar memakai
  ulang ekstraktor guard di berkasnya: yang itu mencocokkan ROUTE, yang menyusun
  guard-nya dari konstanta `THEMING_*_ACTIVITY_CODE`, sementara layar menuliskan
  kode aktivitasnya. Jadi ia mendapat matcher literal sendiri.

- fef7cc4: feat(auth): dua layar platform-scoped berhenti menyalin aturan ADR-0053 (#450, R3)

  `tenants` dan `idn-regions` berpindah ke `loadAdminScreen`. Ledger 14 → 12.

  Keduanya bukan migrasi mekanis: masing-masing menyimpan **salinan kedua** aturan
  platform-scope ADR-0053, ditulis tangan di frontmatter sebagai
  `holds… && isPlatformTenant`, bebas menyimpang dari satu-satunya salinan yang
  mengikat di `access-guard.ts`.

  `authorizeInTransaction` memutuskan `platform_scope_required` **sebelum**
  permission dicari sama sekali. Itu lebih keras daripada yang disalin: baris grant
  yang sampai ke tenant yang salah — restore backup, INSERT tangan, jalur
  provisioning baru yang lupa `WHERE scope = 'tenant'` — menjadi inert, bukan
  mencukupi. Jadi salinan tangannya dihapus, tidak diporting.

  Asimetri keduanya berbeda dan itu yang membuat masing-masing menarik:

  - **`tenants`** — `tenant_provisioning.read` sendiri PLATFORM-scoped, jadi
    keputusan masuknya sepenuhnya milik chokepoint.
  - **`idn-regions`** — `dataset.read` TENANT-scoped sementara `configure` dan
    `restore` PLATFORM-scoped. `can(...)` menjalankan gerbang ADR-0053 yang sama
    dengan endpoint-nya, jadi dua tombol tulisnya kini digerbangi kode yang sama,
    bukan tiruannya.

  `resolvePlatformTenant` tetap dipanggil di kedua layar, kini **untuk TAMPILAN
  saja**: supaya layar bisa mengatakan MENGAPA sebuah kontrol tidak ada, bukan
  meninggalkan ruang kosong. Ia tetap di luar transaksi tenant — keduanya membaca
  tabel root bebas-RLS dan tidak butuh konteks tenant.

  ## Satu kalimat yang berhenti mengklaim apa yang tak lagi diketahui

  Pemberitahuan scope di `/admin/tenants` berbunyi "Your role carries the
  permission; the action is refused because of where it is being made". Sesudah
  migrasi kalimat itu **tidak bisa lagi dibuktikan**: gerbang platform menolak
  sebelum permission dicari, jadi halaman ini tidak tahu apakah pembacanya
  benar-benar memegangnya. Diganti menjadi klaim yang tetap benar — penolakannya
  soal DI MANA aksi dilakukan, dan tidak ada grant di tenant ini yang bisa
  membukanya.

  Dua state penolakan kini dipisah jujur: bukan tenant platform → catatan scope;
  tenant platform tetapi ditolak → catatan permission.

  ## Tiga test diperbaiki, dan alasannya sama dengan yang dihapus

  `tenant-provisioning` dan `admin-idn-regions-page-contract` mematok persis
  ekspresi `holds… && isPlatformTenant` yang menjadi cacatnya. Mempertahankannya
  akan menjadikan test itu alasan untuk MENYIMPAN duplikat aturan.

  Keduanya kini membuktikan sifat yang sama dari dua hal yang benar-benar
  menegakkannya: `scope` di deskriptor modul (data hidup — kalau
  `tenant_provisioning.read` pernah berubah menjadi `tenant`, layarnya diam-diam
  terbuka untuk setiap owner tenant, dan asersi atas teks halaman tidak akan
  menyadarinya) dan perutean lewat `loadAdminScreen`. Ekstraktor klaim
  `admin-idn-regions` juga digabungkan dengan bentuk objek-literal, sekelas dengan
  batch 1 dan 4.

- ea27ae6: feat(auth): R3 DITUTUP — ke-32 layar admin memutuskan di chokepoint (#450)

  Lima layar terakhir — `data-lifecycle`, `security`, `seo`, `site-search`,
  `blog-presentation` — berpindah ke `loadAdminScreen`. **Kedua ledger kini
  kosong**: `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` dan bagian layar admin di
  `NOT_YET_MIGRATED`.

  Tidak ada lagi layar admin yang memutuskan akses dari `ssr.permissions.has(...)`.
  Setiap render kini melewati evaluasi kebijakan ABAC, `resolveModuleAvailability`,
  fakta business-scope, SoD saat-aksi, dan `recordDecisionLog`.

  ## Tiga hal yang diporting VERBATIM, bukan "diperbaiki"

  `data-lifecycle` menerima **lima** request entry, dua di antaranya **tulis**
  (`legal_hold.create`, `plan.analyze`). Itulah `showAnything` selama ini: konsol
  ini mengizinkan siapa pun yang bisa melakukan apa pun di sini, termasuk orang
  yang boleh memasang legal hold tanpa bisa mendaftar hold yang sudah ada.
  Memangkasnya ke tiga baca akan diam-diam mengunci mereka.

  `security` memakai `mfa_admin.reset` sebagai gerbang BACA panel MFA. Modul ini
  tidak menyeed satu pun aksi baca MFA; permission reset itulah yang selama ini
  menggerbanginya. Diporting apa adanya, bukan "dikoreksi" ke permission yang
  tidak ada.

  `blog-presentation` memilih section aktif dari permission baca. Pemilihan itu
  pindah ke DALAM `load`, karena section mana yang tersedia kini jawaban
  chokepoint, dan fallback-nya harus dihitung dari jawaban yang sama. Helper
  file-local `can(activity, action)`-nya hilang — itu helper yang membuat
  `admin:screen-coverage:check` menumbuhkan matcher penyelesai-helper-nya.

  ## Gerbangnya diperketat, karena mutasi membuktikan ia bocor

  Setelah ledger kosong, saya menanam bypass nyata ke `users.astro` untuk menguji
  gerbangnya. Ia **hijau**: keluar dengan kode 0 sambil baris ringkasannya sendiri
  berbunyi _"1 still decide outside the chokepoint"_.

  Sebabnya kelonggaran se-BERKAS: sebuah layar yang memanggil `loadAdminScreen`
  untuk entry-nya boleh tetap memutuskan sebuah AFFORDANCE dari
  `ssr.permissions.has(...)`. Itu benar selama migrasi — layar setengah-jadi tidak
  boleh dilaporkan dua kali — dan salah begitu layar terakhir mendarat: ia jalan
  masuk kembali, satu tombol demi satu tombol.

  Rute mempertahankan kelonggaran itu (`defineTenantRoute` membungkus di level
  modul dan memanggil chokepoint sendiri, jadi ia benar-benar menutupi tiap
  handler di berkas). Layar tidak: satu berkas `.astro` = satu jalur render, jadi
  tidak ada handler saudara yang pantas ikut tertutupi. Asimetrinya dipatok test
  di kedua arah.

  ## Dua alarm yang menjadi inert pada nol, diganti

  Self-test detektor berbunyi "nol layar memutuskan sementara ledger tidak kosong
  = detektor rusak". Itu persis cek yang mati saat layar terakhir dimigrasikan:
  sejak itu nol adalah jawaban yang BENAR, dan nol dari detektor yang rusak tidak
  bisa dibedakan darinya. Diganti **probe sintetis** — `sliceScreen` ditanya
  tentang layar yang pasti bypass dan layar yang pasti tidak; keduanya harus
  benar, pada ukuran ledger berapa pun.

  Kedua, gerbang kini menuntut setiap layar benar-benar **TERUTE**, bukan sekadar
  diam: layar yang tidak membaca permission apa pun DAN tidak membuka chokepoint
  akan lolos filter bypass tanpa tertutupi apa pun.

  Aturan "hanya boleh menyusut" juga kehilangan penegaknya pada nol — entri basi
  adalah temuan, tetapi pada daftar kosong tidak ada yang bisa basi. Jadi
  `tests/access-chokepoint.test.ts` meng-assert kekosongan itu langsung.

  Ketiga arah kegagalan diuji dengan menanam cacatnya dan memastikan gerbangnya
  MERAH, bukan sekadar memastikan ia hijau hari ini.

- 660f844: feat(data-lifecycle): tabel milik infrastruktur bisa menjawab pertanyaan retensi — dan klasifikator kepemilikan yang memutuskan siapa boleh

  `awcms_edge_cache_purges` duduk di `TABLES_PREDATING_THE_RULE` bukan karena
  belum sempat, melainkan karena kontraknya tidak bisa menyatakannya: registry
  mewajibkan `ownerModuleKey` sama dengan key modul yang mendeklarasikan, dan
  tabel ini dimiliki `src/lib/edge-cache/` yang **sengaja** bukan modul.

  Masalahnya bukan satu tabel yang lolos. Ledger itu tidak bisa membedakan tabel
  yang **belum** dideskripsikan dari yang **tidak bisa** — keduanya satu baris —
  sehingga hitungannya berhenti bisa dibaca sebagai hitungan utang.

  **Satu koreksi terhadap premis Issue #479:** retensinya bukan tidak ada.
  `bun run edge-cache:purge` sudah memangkas baris `done` di atas tujuh hari sejak
  ADR-0042. Yang hilang adalah kemampuan **menyatakannya** — persis bentuk
  `executionMode: "delegated"`, yang satu-satunya penghalangnya adalah kata
  _module_.

  **Registry kedua, bukan `ownerModuleKey` yang dilonggarkan** (ADR-0076).
  `INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS` memakai `ownerPath` sebagai ganti key
  modul. Melonggarkan field-nya akan menghemat satu berkas dan membuat setiap
  deskriptor modul kehilangan penjagaannya: sebuah deskriptor yang **lupa**
  menyebut pemilik berhenti menjadi kesalahan dan mulai berarti "infrastruktur" —
  kesalahan ketik menjadi klaim kepemilikan.

  **Yang menahannya jadi tempat parkir bukan paragraf.** `data-lifecycle:registry:check`
  kini memindai `src/` dengan `ownerOfFile()` — fungsi yang sama yang dipakai
  `modules:table-writes:check` — dan menolak deskriptor infrastruktur untuk tabel
  yang penulisnya sebuah modul, untuk tabel yang tak ditulis siapa pun, dan untuk
  key yang namespace-nya sebuah modul terdaftar. Kepemilikan yang salah menjadi
  tak bisa dinyatakan, di kedua arah. Gerbangnya karena itu berhenti murni; itu
  harga yang dibayar sadar.

  **Dua perubahan perilaku ikut mendarat, karena tanpanya deskriptornya tidak benar:**

  - baris `failed` kini dipangkas setelah **180 hari**. Sebelumnya disimpan
    selamanya dengan sengaja — dan alasannya benar, mereka satu-satunya jejak
    bahwa sebuah invalidasi tak pernah mendarat. Alasan itu membatasi umur
    **bergunanya**, bukan memperpanjangnya tanpa akhir: setelah enam bulan konten
    yang gagal diinvalidasi sudah kedaluwarsa ribuan kali;
  - purge-nya kini menghormati **legal hold**, lewat `LegalHoldGuardPort` yang sama
    dengan tujuh adopter terdelegasi lain. Tanpa ini `legalHold.applicable: true`
    akan jadi deklarasi tanpa penegak.

  `GET /api/v1/data-lifecycle/registry` mendapat array `infrastructureDescriptors`
  (aditif) dan `/admin/data-lifecycle` mendapat kolom **Owner**; legal hold bisa
  menargetkan key-nya dari API maupun konsol. `POST /dry-run` menjawab 400
  ber-alasan alih-alih 404 "key tak dikenal" — planner-nya tak punya predikat
  status, jadi angka apa pun yang ia hasilkan akan memuat baris yang purge tak
  akan pernah sentuh.

  **Tanpa migrasi:** `GRANT SELECT, UPDATE, DELETE` ke `awcms_worker` dan index
  `(tenant_id, status, created_at)` sudah ada sejak `sql/068`.

  Ledger utang turun 110 → 109. Empat mutasi dibuktikan **merah** sebelum diklaim:
  legal hold dilucuti, prune `failed` diarahkan ke `completed_at` (kolom yang NULL
  pada baris yang justru dituju), deskriptor infrastruktur untuk tabel milik modul,
  dan registry dikosongkan setelah entri ledger dilepas.

  Menutup #479.

- 8307af4: feat(push): antrean pengiriman push mendarat sebagai outbox KEDUA, bukan consumer domain-event

  `awcms_domain_events` sudah punya dispatcher, DLQ, dan replay, jadi
  menggantungkan pengiriman push padanya adalah langkah pertama yang wajar bagi
  siapa pun. Ia tidak bisa, dan alasannya tertulis di berkasnya sendiri:
  `dispatch-domain-events.ts` menyatakan di header-nya bahwa CLAIM + handler +
  FINALIZE berjalan dalam **satu** transaksi, **sengaja**, dan memanggil handler
  di dalamnya — sementara **ADR-0006 melarang panggilan jaringan di dalam
  transaksi DB**. `broker-adapter-port.ts` sudah menuliskan konsekuensinya
  ("would need the lease-based shape back") dan ia sendiri **kode mati**:
  `getDomainEventBrokerAdapter()` nol pemanggil di seluruh repo.

  Yang membuat ini layak sebuah ADR: **tidak ada gerbang yang akan
  menangkapnya.** Consumer FCM yang didaftarkan dengan cara paling wajar akan
  menahan koneksi pool selama round-trip ke Google sambil memegang row lock, dan
  mengubah tiap kegagalan jaringan menjadi rollback event — sehingga event yang
  **sudah** terkirim dikirim ulang — dengan seluruh 37 gerbang hijau.

  Jadi: modul `push_delivery` (ADR-0074) dengan pola lease yang sudah terbukti
  tiga kali di sini (`email-dispatch`, `object-dispatch`, `purge-queue`), tiga
  tabel di `sql/093`, port `PushProvider`, adapter `log`, dan dua job —
  `bun run push:dispatch` serta `bun run push:queue:purge`.

  Empat keputusan ikut mendarat, masing-masing karena default-nya salah:

  - **Endpoint dan token adalah kredensial.** Endpoint Web Push dan token FCM
    sama-sama bearer-ish, jadi keduanya memakai disiplin tiga kolom yang sama
    dengan alamat email (`endpoint`/`_hash`/`_masked`), dengan kolom mentah
    disebut di **satu** berkas. Mask-nya memakai `origin` URL, bukan N karakter
    pertama — hitungan karakter tetap mendarat di tengah host untuk satu vendor
    dan di tengah path untuk vendor lain.
  - **`subscriptionGone` adalah cabang hasil tersendiri**, bukan
    `retryable: false`. `404`/`410`/`UNREGISTERED` bukan kegagalan kirim: itu
    langganan yang melaporkan dirinya mati. Melipatnya ke "gagal, jangan ulangi"
    meninggalkan endpoint nisan yang memungut satu kegagalan permanen per pesan,
    selamanya.
  - **Retensi `delegated`, bukan `generic`.** `HighVolumeTableDescriptor` tidak
    punya predikat status, jadi executor generik menghapus murni berdasarkan
    umur — diarahkan ke antrean, ia menghapus pekerjaan yang **belum terkirim**,
    dan lenyapnya terlihat persis seperti housekeeping berhasil. Dibuktikan
    terhadap Postgres nyata: dengan cutoff 400 hari ke depan, purge mengambil
    2 attempt + 1 pesan terminal dan **baris `queued` selamat**.
  - **`targetPath` hanya path same-origin**, divalidasi sebelum baris ditulis.
    Baris antrean ber-URL absolut adalah open-redirect tersimpan dengan
    notifikasi sistem sebagai kendaraannya, datang membawa nama dan ikon origin
    ini sendiri.

  Status modulnya **`experimental`, bukan `active`**, dan itu ditegakkan bukan
  kosmetik: `tests/admin-media-page-contract.test.ts` mewajibkan tiap modul
  `active` punya layar admin, TANPA pengecualian (ADR-0021), dan komentarnya
  sendiri mencatat apa yang terjadi terakhir kali orang menulis carve-out. Modul
  ini tidak mengambil pengecualian itu; ia mengambil status yang jujur — antrean
  dan worker-nya jalan, permukaan operatornya belum ada, dan itu kesenjangan
  nyata yang tutup bersama adapter di #466.

  Mendarat **inert**: tanpa `PUSH_ENABLED=true` dispatcher tidak mengklaim satu
  baris pun. `PUSH_PROVIDER` sengaja belum menerima `fcm`/`web_push` — menamainya
  sekarang membuat deployment lolos `config:validate` lalu gagal saat resolve.
  `config:validate` juga menolak `PUSH_ENABLED=true` tanpa adapter, karena tanpa
  itu setiap notifikasi yang diantre langsung menjadi `failed` dengan pesan yang
  hanya terlihat di buku percobaan kirim.

  **FCM Web ditolak, dengan angkanya**, di ADR-0074: 45.041 B versus plafon
  21.000 B per berkas, total 185.049 B versus 180.000 B, dan CSP repo ini
  mengunci nol origin pihak ketiga (ADR-0029) — sementara Web Push/VAPID memberi
  hasil sama dengan nol byte SDK dan nol origin baru.

- 874d03e: feat(keamanan): `suspended` berhenti menjadi status login dan menjadi status LAYANAN

  `awcms_tenants.status` menerima `'suspended'` sejak `sql/002`. Ia dibaca di jalur
  login/reset/registrasi/SSO-start dan di resolver host publik — dan **tidak pernah**
  di `authorizeInTransaction`.

  Asimetrinya mengarah ke sisi yang salah:

  | Permukaan                    | Setelah suspend, sebelum ini               |
  | ---------------------------- | ------------------------------------------ |
  | Situs publik tenant          | mati seketika                              |
  | Sesi admin yang sudah terbit | **penuh akses sampai kedaluwarsa sendiri** |
  | Machine credential           | **tidak tersentuh** — umur sampai 365 hari |

  Pelanggan yang ditangguhkan kehilangan hal yang **dilihat pengunjungnya** dan
  mempertahankan hal yang **bisa mengubah datanya**.

  Kini ditegakkan di chokepoint untuk sesi **dan** machine credential
  (`403 TENANT_SUSPENDED`), diputuskan **sebelum** permission dicari. Tidak ada
  sapuan pencabutan sesi, dan tidak diperlukan: pemeriksaannya pada **tenant**,
  bukan pada kredensial.

  Statusnya ikut lewat **JOIN pada query yang sudah berjalan** — `awcms_tenants`
  adalah tabel akar yang sengaja RLS-free, jadi nol round-trip tambahan.
  `resolveTenantContext` dipertahankan apa adanya karena tujuh pemanggil di luar
  chokepoint memakainya; `resolveTenantPrincipal` yang baru berbagi satu query
  dengannya sehingga keduanya tak bisa menyimpang.

  Shell admin ikut diblokir di `resolveSsrContext` — **satu baris** yang mencakup
  ke-32 layar, karena middleware merutekan tiap `/admin/*` melaluinya. Batasnya
  ditulis, bukan disembunyikan: ia semua-atau-tidak, dan ketika layar penagihan
  tiba di Gelombang 5 cabang itu harus menumbuhkan allow-list yang sama.

  Tenant **platform** dikecualikan dua lapis, dan lapis pertamanya menemukan
  jebakan: `resolvePlatformTenant` sengaja menuntut `status = 'active'`, jadi
  platform tenant yang ter-suspend akan membuatnya `null`, pengecualiannya
  bernilai false, dan operatornya ditolak **setiap** aksi termasuk yang mengangkat
  penangguhan itu. `resolvePlatformTenantIdIgnoringStatus` menjawab pertanyaan yang
  berbeda dan **tidak memberi apa pun** — permission platform-scoped tetap lewat
  resolver lama beserta cek aktifnya.

  `disable` dan `restore` adalah **dua** permission, keduanya `scope: platform`.

  Satu test menangkap lubang nyata saat dikerjakan: `scope: 'platform'` di basis
  data tidak berarti apa-apa sampai kuncinya juga terdeklarasi di **kode** —
  `tests/platform-scoped-permissions.test.ts` memerah sampai keduanya ditambahkan.
  Itulah inti ADR-0053: kolom memutuskan siapa yang diberi, kode memutuskan apakah
  gerbangnya ditanyakan.

- 1968a05: feat(auth): undangan diterima, dan keanggotaan lahir di satu fungsi (ADR-0082, #423)

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

- afdef4b: feat(access): setiap grant peran baru mendarat sebagai Policy — dan pencabutan mencari di KEDUA tempat

  Gelombang 3 PR 3.2 dari #423, menutup unit komitmen yang dibuka
  [ADR-0078](docs/adr/0078-a-grant-carries-its-own-scope.md). Sejak PR ini
  `awcms_access_policies` punya penulis produksi; tabel tanpa penulis adalah cacat
  yang ADR-0077 hapus, dan PROJECT_STATE §4 mencatat 3.1 dan 3.2 sebagai satu unit
  justru supaya keadaan itu tak pernah menetap.

  Tiga jalur pindah: `assignRole`, penerimaan pendaftaran mandiri, dan bootstrap
  tenant. `fetchGrantedPermissionKeys` membaca keduanya, jadi subjek yang diberi
  grant lewat jalur baru tak bisa dibedakan dari yang lewat tabel lama.

  **Ini BUKAN dual write.** ADR-0078 memilih tabel ketiga justru supaya
  expand/migrate/contract tidak butuh dual write. Satu grant baru mendarat di
  **satu** tabel. Menulis keduanya akan menghidupkan kembali kegagalan yang
  dihindari rancangan ini: dua tulis yang bisa berhasil terpisah, meninggalkan
  subjek yang memegang peran menurut satu tabel dan tidak menurut yang lain, tanpa
  cara menentukan mana yang benar.

  **Pencabutan harus mencari di kedua tempat.** `revokeRoleGrants` menghapus baris
  lama **dan** mencabut policy aktif, karena selama backfill (PR 3.3) belum jalan
  sebuah grant bisa hidup di mana saja. Penghapus yang hanya tahu tabel baru akan
  melaporkan sukses sementara perannya selamat — bentuk paling berbahaya yang
  tersedia di sini, karena ia gagal ke arah **AKSES TETAP ADA** dan tak ada yang
  mengamatinya.

  **Pemeriksaan duplikat tidak lagi gratis dari satu indeks unik**, jadi ia
  ditanyakan eksplisit terhadap kedua tabel sebelum menulis. Terjemahan 23505 tetap
  ada untuk satu kasus yang tersisa dan hanya itu: dua permintaan bersamaan yang
  memberi peran sama, di mana salah satunya kalah di indeks unik parsial.

  **Empat gerbang memerah dan tiap satunya benar:**

  1. `access:grant-readers:check` menangkap penulis bersama yang baru **dan**
     entri basi untuk `self-registration.ts` yang berhenti menyebut tabel grant.
     Persis dua arah yang dirancangkan gerbang itu, di PR pertama yang menggerakkannya.
  2. `modules:table-writes:check` menangkap `platform-bootstrap.ts` (milik
     `tenant_admin`) menulis tabel `identity_access`. Pengecualiannya **dipindahkan
     bersama** grant-nya alih-alih ditambahkan di sebelahnya: membiarkan tabel lama
     terdaftar setelah tak ada yang menulisnya berarti memaafkan penulis yang tak
     ada lagi.
  3. `tests/access-assignment-writers.test.ts` — penanda "penulis" harus berubah
     **dua kali**: tabelnya pindah, DAN sebuah berkas kini bisa menyebabkan grant
     tanpa memuat satu pun `INSERT`. Penanda yang cuma melihat INSERT akan
     diam-diam mempersempit aturan empat-penulis menjadi dua, dan `user-admin.ts`
     — pembawa penolakan system-role utama repo ini — akan keluar dari aturannya.
  4. Integrasi self-registration: helper `assignmentCount` menghitung satu tabel.
     Ia kini menghitung **union**, karena asersi di sekitarnya bertanya "apakah
     orang ini diberi grant", bukan "berapa baris di tabel ini" — dan salah satu
     asersinya adalah asersi keamanan ("peran sistem ditolak, dan penerimaan tidak
     menulis apa pun"), yang akan melaporkan nol untuk grant yang ada.

  `platform-bootstrap.ts` menulis INSERT-nya **inline** alih-alih memanggil penulis
  bersama: `tenant_admin` tidak boleh mengimpor kode aplikasi `identity_access` —
  DAG modul berjalan ke arah sebaliknya dan `modules:dag:check` menegakkannya.
  Duplikasinya dua INSERT dan dipatok test penulis di atas.

  Setiap grant yang ditulis hari ini **tenant-wide**. Scope yang lebih sempit bisa
  ditulis ketika PR 3.4 mengajari evaluasi mengualifikasinya — mengirimkan penulis
  untuk scope yang masih diabaikan evaluator berarti membagikan grant yang
  **terlihat sempit dan tidak**.

- c86b40a: feat(push): permukaan HTTP — perangkat sendiri self-service, sisanya lewat chokepoint

  Lima endpoint mendarat di `/api/v1/push`, dan pembelahannya adalah keputusan
  otorisasi, bukan penataan berkas.

  ## Perangkat SENDIRI tidak punya permission, dan itu disengaja

  `GET|POST /api/v1/push/subscriptions` dan `DELETE …/{id}` memakai
  `defineSelfServiceTenantRoute` (ADR-0049 §7): subjeknya adalah pemanggil, dan
  jawaban atas "boleh saya berlangganan di browser ini?" adalah "Anda sedang
  memegang sesinya". Rute-rute itu **tidak pernah menerima `tenantUserId`** — ia
  datang dari sesi yang di-resolve, jadi tak ada id untuk dibandingkan dengan apa
  pun.

  Menciptakan `push_delivery.subscriptions.create` justru akan menjadi jebakan
  latent-authz yang sudah pernah kena di repo ini (ADR-0058 §E): aksi yang tak
  di-seed role mana pun menolak **semua orang termasuk owner**, sementara kode
  pemanggilnya terbaca seolah tergerbangi dengan benar. Notifikasi push adalah
  untuk pengguna biasa; tembok permission di depannya adalah tembok di depan
  fiturnya.

  Yang menyentuh baris orang lain atau membuat deployment mengirim trafik nyata
  tetap lewat chokepoint — tiga permission (`sql/094`), dan itu seluruhnya:
  `diagnostics.read`, `messages.cancel`, `diagnostics.check`.

  ## Rute self-service ikut membawa cek suspensi

  ADR-0073 menjadikan `suspended` status LAYANAN, dan chokepoint menegakkannya
  untuk setiap rute tergerbangi. Rute self-service tidak lewat sana, jadi ia
  memeriksanya sendiri — kalau tidak, satu-satunya kelas endpoint yang melewati
  guard menjadi satu-satunya tempat tenant tersuspensi masih bisa menambah
  kapasitas keluar.

  ## Empat hal yang halus

  **Pencabutan oleh pengguna menghancurkan endpoint tersimpan.** Beda dari
  `disablePushSubscription`, yang mencatat apa kata push service tentang endpoint
  yang sudah mati dan menyimpannya sebagai bukti: yang ini mencatat apa kata
  ORANGNYA tentang endpoint yang mungkin masih hidup sempurna. Baris tetap ada,
  kredensialnya tidak.

  **`endpoint = EXCLUDED.endpoint` di upsert adalah pasangan wajibnya.** Tanpa
  pemikiran di atas ia terlihat mubazir — target konflik adalah HASH dari kolom
  itu sendiri, jadi di setiap kasus biasa nilainya identik. Ia ada untuk satu
  kasus: perangkat yang berlangganan ulang setelah dicabut akan kembali `active`
  sambil masih menunjuk nisan — sehat di konsol, tak terkirimi pada kenyataannya.

  **Kepemilikan ada di `WHERE`, bukan di baca-lalu-bandingkan.** Tak ada jendela
  di antara keduanya, dan tak ada keputusan yang harus diambil tentang baris yang
  sudah terbaca tapi tak boleh disentuh — persis cara oracle keberadaan lahir
  tanpa sengaja. "Tidak ada", "milik orang lain", dan "sudah dicabut" menjawab
  404 yang sama.

  **`POST /api/v1/push/test` mengirim ke perangkat pemanggil sendiri, dengan teks
  tetap.** Endpoint uji yang menerima penerima adalah permukaan
  notifikasi-sembarang: teks bermerek sistem, dipilih pengirim, dengan target
  klik, di lock screen kolega mana pun. Probe-nya perlu ada karena push gagal di
  tempat yang tak bisa dilihat apa pun di sistem ini — kunci VAPID yang tak cocok,
  service worker di scope salah, izin OS yang ditahan diam-diam — dan ketiganya
  menghasilkan antrean yang terkuras bersih dan perangkat yang tak menampilkan
  apa-apa.

  ## Satu bug yang hanya ketahuan karena diuji

  `isBlockedAddress` **gagal-tertutup untuk apa pun yang bukan literal IP** —
  benar di tempat ia biasa dipanggil (alamat hasil resolusi), fatal di sini:
  dipanggil langsung ia menjawab "diblokir" untuk
  `https://updates.push.services.mozilla.com/…` juga. Pendaftaran akan mustahil
  untuk **setiap** push service nyata, dengan pesan error yang menyebut alamat
  privat. Pertanyaan literal-IP kini hanya DIAJUKAN ketika host-nya memang
  literal.

  Setengah pertanyaan yang bergantung DNS sengaja **tidak** dijawab saat
  pendaftaran: jawaban DNS di sini sudah basi saat pengiriman. Otoritasnya tetap
  `ssrfSafeFetch` di jalur kirim, yang me-resolve tepat sebelum menyambung.

  ## Yang belum

  Modul tetap `experimental`: ADR-0021 kriteria 1 menolak modul `active` tanpa
  layar admin, tanpa pengecualian, dan konsolnya belum ada. Tiga permission-nya
  tercatat sementara di ledger satu-arah `NOT_YET_SCREENED` — bukan tiga
  keputusan, tiga baris yang dijadwalkan dihapus.

- 00bd70f: feat(auth): sesi orang lain bisa dilihat dan diakhiri — dengan `read` sebagai izin yang LEBIH mahal dari `revoke`

  Gelombang 2 PR 2.2 dari #423. `GET /api/v1/users/{id}/sessions` dan
  `POST /api/v1/users/{id}/sessions/revoke-all`, ditambah panel sesi di
  `/admin/users`. Pasangan self-service yang mendarat di PR 2.1 menyelesaikan
  subjeknya dari token pemanggil dan tak bisa diarahkan ke siapa pun; dua endpoint
  ini melakukan kebalikannya — subjeknya disebut di URL — jadi keduanya digerbangi,
  diaudit, dan dipecah ke **dua** izin.

  **Pemecahannya terbalik dari `machine_credentials`, dan justru itu isinya.**
  `sql/083` memisah `create`/`revoke` karena hanya satu dari keduanya MENCIPTAKAN
  kapabilitas. Di sini yang memisah adalah kebalikannya: hanya satu dari keduanya
  MENGUNGKAPKAN sesuatu. `read` adalah jendela permanen ke gerak-gerik seorang
  kolega — kapan ia masuk, dari berapa bentuk perangkat, jam berapa — dan itu tetap
  bahan pengawasan ketika yang membacanya administrator. `revoke` menghancurkan
  akses dan mengembalikan sebuah angka.

  Jadi yang dibeli pemecahan ini adalah arah yang penting saat insiden: seorang
  responder bisa diberi kemampuan mengeluarkan akun yang diduga jebol dari
  mana-mana **tanpa** sekalian diberi pandangan ke pergerakan semua orang. Satu izin
  yang mencakup keduanya membuat tindakan darurat yang aman berharga izin permanen
  yang tidak aman.

  **Sesi pemanggil tidak pernah ikut mati.** `UPDATE`-nya membawa
  `token_hash <> ${callerTokenHash}`, dan untuk target selain tenant user pemanggil
  sendiri klausa itu tidak mencocoki apa pun — hash token pemanggil tak bisa muncul
  di antara sesi identitas lain. Jadi ia gratis di kasus normal dan membeli satu
  properti di kasus tidak normal: administrator yang sedang membereskan insiden tak
  bisa mengeluarkan dirinya dari konsol yang sedang ia pakai dengan menekan baris
  yang kebetulan miliknya. `keptCallerSession` melaporkannya alih-alih diam —
  operator yang diberi tahu "3 diakhiri" sementara konsolnya masih hidup perlu tahu
  sebabnya, atau ia menyimpulkan kontrolnya tidak bekerja.

  Itu bukan lubang: mengeluarkan diri sendiri dari mana-mana adalah
  `DELETE /api/v1/auth/sessions/{id}` dan `POST /api/v1/auth/logout`, keduanya tanpa
  izin. Endpoint ini menolak menjadi cara ketiga untuk hal yang sudah dilakukan dua
  endpoint tak-berizin, dalam satu-satunya susunan di mana melakukannya adalah
  kecelakaan.

  **Aktivitas `user_sessions` baru, bukan `access_control` yang diperluas** — alasan
  yang sama ditulis `sql/075` untuk `registration_requests` dan `sql/083` untuk
  `machine_credentials`: melipatnya ke `access_control.read` akan menjadikan setiap
  pembaca katalog RBAC seorang pengamat gerak-gerik koleganya, sebagai efek samping,
  tanpa satu migrasi pun mengatakannya.

  **Empat keputusan yang lebih kecil:**

  - **Id yang tak berbentuk UUID dijawab 404, bukan 400.** 400 untuk "bukan uuid"
    plus 404 untuk "tak ada usernya" bersama-sama memberi tahu pemanggil id mana yang
    berbentuk benar DAN id mana yang ada.
  - **User nonaktif didaftar kosong, bukan 404.** `setTenantUserStatus` sudah
    mencabut sesinya, jadi daftar kosong adalah jawaban yang diharapkan — dan itulah
    yang sedang diperiksa operator saat itu. 404 tak bisa dibedakan dari salah id.
  - **Diaudit meski nol sesi diakhiri.** "Seseorang mencoba mengeluarkan akun ini
    dan tak ada yang tersisa untuk diakhiri" justru entri yang paling dicari
    investigasi; jejak audit yang hanya mencatat aksi efektif tak bisa
    membedakannya dari tak ada yang pernah melihat.
  - **Tanpa `Idempotency-Key`.** Panggilan kedua tidak menemukan apa pun yang hidup
    dan melaporkan `revokedCount: 0` — tak ada duplikat untuk ditekan, jadi tak ada
    yang perlu dilindungi respons tersimpan.

  `tokenHash` kini ikut diserahkan `defineTenantRoute` ke handler-nya. Nilainya sudah
  dihitung seam itu untuk `authorizeInTransaction`; menurunkannya kedua kali di dalam
  rute adalah cara dua turunan satu nilai mulai berbeda pendapat.

  `sql/101` hanya memperluas katalog global — tenant lama mendapatkannya lewat
  `bun run identity-access:permissions:backfill`, yang memberi tepat baris katalog
  yang LEBIH BARU dari role-nya sehingga tak bisa menghidupkan kembali izin yang
  sengaja dicabut admin.

- ba84e5b: feat(domain-events): buku pengiriman keluar dari ledger retensi — tiga predikat, dan `dead_letter` bukan salah satunya

  `awcms_domain_event_deliveries` mendapat deskriptor `dataLifecycle`, job
  `bun run domain-events:deliveries:purge`, dan barisnya dihapus dari
  `TABLES_PREDATING_THE_RULE`. Ini purge terdelegasi ketiga di repo ini, dan
  satu-satunya yang butuh lebih dari satu predikat di luar cutoff.

  ## `dead_letter` dikecualikan, dan itu jebakannya

  Ia **terlihat** terminal — dispatcher tak akan pernah mencobanya lagi sendiri —
  dan ia justru baris yang dibuka operator di `/admin/domain-events` untuk
  di-replay. Jendela retensi yang menyapunya akan menghapus **pekerjaan beserta
  buktinya**, dan penghapusannya tak bisa dibedakan dari antrean yang terkuras
  bersih. Hanya `delivered` dan `skipped` yang settled.

  ## Dua predikat lagi, dan keduanya soal foreign key

  `awcms_domain_event_replays` membawa **dua** FK NOT NULL ke tabel ini —
  `original_delivery_id` dan `replay_delivery_id`. Menghapus salah satu sisinya
  gagal pada constraint, dan purge yang setengah berhasil tiap malam lebih buruk
  daripada yang tak pernah jalan: error-nya intermiten dan backlog tetap tumbuh.
  Baris replay itu sendiri adalah catatan audit tindakan manual operator, jadi
  jawabannya adalah **melewati** delivery-nya, bukan melebarkan delete.

  `replay_of_delivery_id` adalah **self-FK**: satu percobaan replay adalah baris
  baru yang menunjuk balik ke aslinya. Constraint yang sama, perlakuan yang sama.

  Keduanya `NOT EXISTS` di dalam statement yang sama, bukan join dengan round-trip
  kedua — baris yang menjadi tereferensi antara SELECT dan DELETE tidak terhapus,
  karena tak ada jendela di antara keduanya.

  ## Index-nya parsial, dan index terdekat yang ada tidak berguna

  `awcms_domain_event_deliveries_tenant_status_idx` adalah `(tenant_id, status)`
  **tanpa kolom waktu sama sekali**. Pada tabel yang seluruh masalahnya adalah
  baris `delivered` menumpuk, itu berarti membaca setiap baris delivered di tenant
  untuk menemukan yang lama. `sql/097` menambah `(tenant_id, updated_at)` PARSIAL
  pada dua status yang bisa dipurge — jalur panas dispatcher adalah
  `status = 'pending'`, yang tak punya alasan menumpang index ini.

  ## Yang sengaja TIDAK dicakup

  `awcms_domain_events` — induknya, yang menyimpan payload — **tetap di ledger**.
  Menghapus delivery tidak mengecilkannya, dan berapa lama sebuah PAYLOAD layak
  disimpan adalah pertanyaan berbeda dari berapa lama sebuah TANDA TERIMA layak
  disimpan: yang pertama catatan bisnis yang di-replay hal lain, yang kedua
  pembukuan transport. Mengklaim keduanya dalam satu PR berarti menjawab yang
  mudah dan mengubur yang sulit.

- ac7922b: feat(data-lifecycle): `awcms_abac_decision_logs` mendapat retensi — dan sengketa otoritas proyeksinya diselesaikan

  Tabel tanpa batas terbesar di repo: satu baris untuk **setiap** keputusan
  otorisasi, ±8,6 juta baris/hari pada 100 req/s, dan **nol retensi** sejak
  `sql/005`. Ia tumbuh sebanding dengan **lalu lintas**, bukan dengan data
  pelanggan — sebuah tenant yang tidak menambah satu pun konten tetap menambah
  baris di sini tiap kali stafnya membuka layar. Ia juga tabel yang paling
  dibutuhkan saat insiden, persis ketika query terhadapnya paling lambat.

  **Job purge-nya, kalau ditulis hari ini, akan menghapus nol baris.** `sql/022`
  memberi `awcms_worker` hanya `SELECT`. `sql/091` memberi `DELETE`. Tanpa itu
  purge-nya berjalan, melapor sukses, dan tidak menghapus apa pun — kegagalan yang
  tidak berbunyi seperti kegagalan, melainkan seperti "tidak ada yang perlu
  dihapus".

  **Sengketa yang lahir bersama retensinya, diselesaikan di ADR-0072.** Modul
  `reporting` memakai tabel ini sebagai sumber cursor dan deskripsinya berbunyi
  "append-only — never updated/deleted, the ideal cursor_table source". Retensi
  membatalkan klaim itu, dan akibatnya bukan kosmetik: penghitung **inkremental**
  tidak terpengaruh purge, sementara **rebuild** menghitung ulang dari baris yang
  masih ada. Setelah purge pertama, operator yang menekan rebuild diam-diam
  **menghancurkan** hitungan historis dan menggantinya dengan yang lebih kecil,
  tanpa satu pun error.

  Keputusannya: keduanya diberi nama dan cakupan. Inkremental otoritatif untuk
  sepanjang-masa; rebuild otoritatif untuk "sejak horizon retensi". Deskripsi
  proyeksi diperbaiki di tempat implementor membacanya, dan sebuah test dua arah
  menjaga keduanya jujur terhadap satu sama lain.

  **Jendela 365 hari, bukan 90.** Angkanya tidak dipilih demi penyimpanan — ia
  horizon di mana proyeksi itu masih bisa di-rebuild. 90 hari akan memilih angka
  yang menyembunyikan koplingnya alih-alih menghadapinya.

  **Satu klaim di rancangan awal ternyata salah, dan tidak jadi ditulis.** Issue
  mengusulkan index `(tenant_id, created_at)` menaik karena purge memindai
  `ORDER BY … ASC` sementara index yang ada menurun. Btree PostgreSQL **bisa
  dipindai mundur**, jadi index yang ada sudah melayaninya tanpa sort. Index kedua
  hanya akan menambah beban tulis pada tabel yang paling sering ditulis di seluruh
  repo. Alasannya ditulis di header `sql/091` supaya usulan itu tidak lahir
  kembali.

  Retensi belum berlaku sampai `bun run data-lifecycle:archive-purge` dijadwalkan
  — pelajaran yang sama sudah tercatat untuk `AUDIT_LOG_RETENTION_DAYS`.

- 9b06820: feat(sync): antrean upload objek keluar dari ledger utang retensi — dan tabel di sebelahnya ternyata tak punya produsen

  `awcms_object_sync_queue` mendapat deskriptor `dataLifecycle`, job
  `bun run sync:objects:purge`, dan barisnya dihapus dari
  `TABLES_PREDATING_THE_RULE`.

  `delegated`, bukan `generic`, dengan alasan yang sama seperti dua antrean
  sebelumnya: `HighVolumeTableDescriptor` tak punya predikat status, jadi executor
  generik menghapus murni berdasarkan umur. Diarahkan ke antrean ini ia menghapus
  **upload yang belum terjadi** — termasuk baris `sending`, yang diklaim satu pass
  dispatcher dan lease-nya (`next_retry_at`) satu-satunya yang memulihkannya bila
  pass itu mati.

  ## Kursornya `created_at`, dan itu dipaksa skema bukan dipilih

  Antrean email dan push menyapu pada `updated_at` — saat baris berhenti bergerak.
  Tabel ini tidak punya kolom itu. `uploaded_at` terlihat seperti pengganti yang
  tepat dan justru salah: ia **NULL untuk setiap baris `failed`**, jadi kursor di
  atasnya membuat kegagalan abadi — satu kelas baris yang paling ingin dibatasi
  operator. Konsekuensinya ditulis, bukan dibiarkan disangka kelalaian: baris yang
  retry seminggu diukur dari sebelum percobaan terakhirnya.

  ## Tanpa index baru, dan itu kebalikan kasus email

  `awcms_object_sync_queue_tenant_status_created_idx` (`sql/012`) sudah persis
  bentuk jalur purge. Ia dideklarasikan DESC, yang tak berbiaya — PostgreSQL
  membaca btree mundur, jadi scan menaik tak butuh sort. Bandingkan dengan
  `sql/095`, di mana index dispatcher menutupi himpunan status **berlawanan** dan
  index baru memang harus ditambah.

  ## Temuan: `awcms_sync_outbox` punya NOL produsen

  Tabel kedua modul ini di ledger **tetap di sana**, dan itu keputusan, bukan
  kelalaian. Tak ada yang meng-INSERT ke dalamnya — bukan kode aplikasi, bukan
  trigger, bukan migrasi mana pun. Satu-satunya rujukannya adalah
  `POST /api/v1/sync/pull`, yang hanya SELECT; artinya endpoint itu **tak pernah
  bisa mengembalikan apa pun selain daftar event kosong**, sementara README modul
  menggambarkannya sebagai "local events available to be pulled by other nodes".

  Deskriptor retensi untuknya akan menjadi fiksi dua kali: predikat status
  terminal yang tak akan pernah cocok (tak ada yang menyetel status karena tak ada
  yang menulis baris), pada tabel yang tak bisa tumbuh. Dan lebih buruk — ia akan
  mengeluarkan tabel itu dari ledger, yaitu dari pandangan siapa pun.

  Ketiadaan itu **diasersikan**, bukan dikomentari: test memindai seluruh `src/`
  dan `sql/` untuk INSERT/UPDATE ke tabel itu. Kalau seseorang memasang
  produsennya, test merah — dan merahnya adalah sinyal bahwa tabel itu sudah
  menjadi antrean sungguhan dan butuh deskriptor sungguhan.

- 019bb17: feat(email): outbox email keluar dari ledger utang retensi

  Dua dari enam tabel yang issue #468 sebut — `awcms_email_messages` dan
  `awcms_email_delivery_attempts` — mendapat deskriptor `dataLifecycle`, sebuah
  job purge, dan barisnya dihapus dari `TABLES_PREDATING_THE_RULE`. Ledger itu
  jujur tentang apa yang tak bisa dilakukannya: _"tell you that an EXISTING table
  on that ledger is quietly eating the disk"_.

  Angkanya nyata: `awcms_email_delivery_attempts` menulis satu baris **per
  percobaan**, jadi satu pesan yang gagal berharga hingga enam baris permanen.

  ## Keduanya `delegated`, dan itu seluruh argumen keamanannya

  `HighVolumeTableDescriptor` membawa `cursorColumn` dan **tidak** membawa
  predikat status, jadi executor generik menghapus murni berdasarkan umur.
  Diarahkan ke antrean ini, ia menghapus surat yang **belum terkirim** — pesan
  yang tersangkut di balik gangguan provider lebih lama dari jendela retensi akan
  lenyap, dan lenyapnya terlihat persis seperti housekeeping yang berhasil.

  Dua status paling mudah terbalik, dan keduanya disebut eksplisit:
  `suppressed` **terminal** (alamatnya ada di daftar suppression saat dispatch —
  jawaban final), `sending` **tidak** (ia diklaim satu pass dispatcher yang
  mungkin sedang di tengah kirim, dan lease-nya yang memulihkannya bila pass itu
  mati).

  Daftar status terminal diturunkan dari CHECK constraint `sql/014`, bukan
  ditebak: status yang ditambahkan ke skema dan tidak ke sini akan menumpuk
  selamanya tanpa error di mana pun.

  ## `--dry-run` ada di sini, dan sengaja tidak ada di `push:queue:purge`

  Bukan inkonsistensi. Tabel push dibuat oleh PR yang sama dengan job-nya, jadi
  run pertamanya punya paling banyak satu jendela retensi di belakangnya. Dua
  tabel ini menumpuk sejak `sql/014` **tanpa retensi sama sekali**, jadi run
  pertama di deployment hidup adalah delete terbesar yang akan pernah dilakukan
  job ini, terhadap baris yang belum pernah dihitung siapa pun.

  ## Worker mendapat verb yang dulu sengaja ditolak

  `sql/022` memberi worker persis yang dibutuhkan **dispatcher** — SELECT/UPDATE
  pada messages, INSERT pada attempts — dan tidak lebih. Itu benar: dispatcher
  yang bisa DELETE adalah dispatcher yang bisa menghilangkan antrean karena satu
  bug. Purge adalah entrypoint worker kedua dengan pekerjaan berbeda, jadi
  `sql/095` memberinya DELETE, dan peta hak di `security-readiness.ts` ikut
  diperbarui — grant di SQL yang tak diketahui peta itu adalah privilege yang tak
  direview apa pun.

  Index-nya milik purge sendiri: `awcms_email_messages_dispatch_idx` menutupi
  himpunan status yang **berlawanan** (`queued`/`retry_wait`) dan berkunci pada
  `next_attempt_at`.

- 26334bd: ADR-0083: repo ini men-deploy ke SATU environment (production, `awcms.ahlikoding.com`) karena ia template, dan `/` berhenti menjadi 404 — `src/pages/index.astro` melayani halaman landing informasional bertaut `/login`, tanpa query basis data, tanpa enumerasi, dan tanpa skrip klien baru.
- 38a5fd5: feat(sync): satu outbox — `awcms_sync_outbox` dipensiunkan, dan `/sync/pull` membaca `awcms_domain_events`

  Issue #477 menanyakan bagaimana mengisi tabel yang tak pernah punya produsen.
  Jawabannya: jangan. Repo ini sudah punya outbox transaksional yang bekerja —
  `awcms_domain_events`, lengkap dengan dispatcher, DLQ, dan replay — dan outbox
  kedua yang tak pernah tersambung sebaiknya tidak mendapatkan produsen,
  melainkan dihapus (ADR-0077, `sql/099`).

  **Perilaku tidak berubah:** `/sync/pull` tetap menjawab `200` dengan daftar
  kosong. Yang berubah adalah **kenapa** ia kosong. Sebelumnya karena tak ada
  jalur; sekarang karena `SYNC_REPLICABLE_EVENT_TYPES` kosong — kebijakan yang
  tertulis di satu tempat dan bisa direview.

  **Kenapa allow-list-nya kosong, bukan diisi satu untuk "membuktikan
  mekanismenya".** Karena mekanismenya belum benar, dan menemukan itu adalah
  hasil paling berharga dari issue ini:

  - **visibilitas commit.** `event_sequence` diberikan saat `INSERT` tetapi
    terlihat saat `COMMIT`. Dua transaksi bisnis yang tumpang tindih bisa commit
    tidak berurutan, dan pembaca ber-cursor `event_sequence > checkpoint` yang
    berjalan di antaranya akan melihat 101, memajukan checkpoint, dan **tak pernah
    melihat 100** — kehilangan senyap dan permanen, pada protokol yang tugasnya
    justru tidak kehilangan apa pun. Dorman di tabel lama (nol penulis), **nyata**
    di `awcms_domain_events` (tujuh call site produksi di dua modul);
  - **proyeksi payload.** Node ber-HMAC bukan sesi. `redactEventPayloadForResponse`
    **tidak bisa** dipakai ulang: ia menutupi `email`/`phone`/`nik`/`npwp` —
    persis field yang perlu direplikasi — dan dipasang di permukaan admin.

  Repo ini sudah punya jawaban benar untuk yang pertama, dan bukan cursor:
  `appendDomainEvent` menulis satu baris `awcms_domain_event_deliveries` **per
  consumer di transaksi yang sama** dengan event-nya, jadi tak ada cursor untuk
  dilompati. Replikasi node yang sungguhan harus menumpang mekanisme itu.

  **Kenapa sekarang.** `last_pull_sequence` setiap node terbukti bernilai `0` —
  query lama tak pernah bisa memajukannya. Memindahkan sumber cursor hari ini
  berharga satu `DROP TABLE`; setelah ada produsen, ia berharga pemetaan sequence
  lintas-tabel per node.

  **Migrasinya MENOLAK, bukan menghancurkan:** ia menghitung baris lebih dulu dan
  `RAISE EXCEPTION` bila menemukan satu pun — dibuktikan terhadap Postgres nyata
  (`ERROR: awcms_sync_outbox holds 1 row(s)`). Diterapkan dua kali untuk
  membuktikan idempotensi; index cursor `(tenant_id, event_sequence)` ikut
  mendarat bersama endpoint yang akan memakainya, bukan nanti bersama entri
  allow-list pertama — perubahan satu baris yang diam-diam mengubah bounded scan
  menjadi full scan adalah jenis yang mendarat tanpa diukur siapa pun.

  `BOUNDED_BY_DESIGN` kembali **kosong**: tabelnya tidak ada lagi, jadi tak ada
  pertanyaan retensi untuk dijawab.

  Menutup #477.

- ba6a9a6: feat(auth): "keluarkan saya dari semua perangkat lain" — tanpa flag yang nilai satunya adalah logout yang lebih buruk

  Gelombang 2 PR 2.3 dari #423. `POST /api/v1/auth/sessions/revoke-all` mengakhiri
  setiap sesi hidup milik identitas pemanggil **kecuali** yang sedang dipakai.
  Self-service, nol izin baru, sejalan dengan dua endpoint di sebelahnya.

  **Flag `?exceptCurrent=true` dari rencana program tidak ikut mendarat.** Boolean
  itu hanya punya satu nilai yang jujur di sini: nilai satunya juga mengakhiri sesi
  yang sedang meminta, dan itu `POST /api/v1/auth/logout` — yang **juga**
  membersihkan cookie yang tak bisa dilihat rute ini. Jadi menerima flag-nya berarti
  mengirimkan logout kedua yang lebih buruk, yang satu-satunya ciri khasnya adalah
  meninggalkan pemanggil memegang cookie mati. Default yang tak boleh dibalik lebih
  jujur ditulis sebagai tiadanya parameter.

  Ini endpoint yang dicari orang setelah "sepertinya password saya bocor". Ia harus
  bekerja **sementara** mereka masih masuk, atau mereka memakainya lalu menemukan
  tak bisa mengganti password sesudahnya.

  **Ia tidak menyentuh kredensial dan tidak menyentuh penghitung lockout.**
  `completePasswordReset` mencabut sesi sebagai **akibat** perubahan kredensial; yang
  ini kebalikannya dan tetap begitu. Orang yang membereskan sesi liar belum
  membuktikan apa pun yang baru tentang kredensialnya, jadi tak ada yang
  membersihkan `failed_login_count` atau `locked_until` di sini — menyatukan keduanya
  akan menjadikan kebersihan sesi sebuah oracle reset lockout. Ada test yang
  meng-assert nol query menyebut `awcms_identities`.

  **Tidak diaudit, sengaja.** `awcms_audit_events` mencatat apa yang dilakukan
  **administrator terhadap orang lain**; endjoint admin pasangannya
  (`POST /api/v1/users/{id}/sessions/revoke-all`, PR 2.2) menulis entrinya. Orang
  yang merapikan sesinya sendiri bukan tindakan administratif atas siapa pun, dan
  mencatat tiap pembersihan self-service akan memenuhi jejak yang dibaca investigator
  dengan entri tentang orang yang bertindak atas dirinya sendiri.

  Jawabannya `200` dengan **angka**, bukan `204` kosong: "katanya berhasil, tapi
  apakah saya masih masuk di ponsel" adalah pertanyaan berikutnya, dan nol adalah
  jawaban nyata (memang tak ada yang lain) alih-alih kegagalan.

  Asersi "tanpa flag" dijalankan terhadap **kode dengan komentar dibuang** — docblock
  menyebut penolakannya dengan nama, dan sebutan dalam prosa tak boleh bisa
  memerahkan test tentang perilaku, maupun menghijaukannya.

- c51fe6a: feat(sse): koneksi SSE meng-otorisasi ulang setiap tick — ADR-0075, dan konsol push jadi pemakai pertamanya

  SSE mendarat dengan satu keputusan yang ditulis lebih dulu: **berapa lama sebuah
  keputusan otorisasi boleh dipakai.**

  `defineTenantRoute` mengembalikan koneksi ke pool dan melepas slot work-class
  **sebelum** satu byte pun sampai ke klien. Untuk request JSON itu benar dan
  hemat. Untuk koneksi tiga puluh menit ia mengubah keputusan sesaat menjadi
  **izin berdiri**: peran yang dicabut di menit kedua tetap dilayani sampai klien
  memutus sendiri. Itu persis postur yang baru saja dihapus #450 dari 32 layar
  admin.

  Yang membuatnya layak ADR bukan bahwa SSE berbahaya, melainkan bahwa
  **default-nya diam**: tak ada gerbang yang bisa melihat "keputusan ini berumur
  30 menit" — `access:chokepoint:check` menghitung handler yang memutuskan, bukan
  berapa lama keputusannya dipakai. Endpoint SSE yang benar menurut setiap aturan
  repo hari ini tetap menghasilkan izin berdiri, dan tak ada yang akan memberi
  tahu.

  **Keputusan (ADR-0075):** tiap tick membuka transaksi sendiri, memanggil
  `authorizeInTransaction` lagi, dan membaca snapshot hanya setelah ia
  mengizinkan. Deny bersifat terminal — tak dilewati, tak di-retry.

  **Ditolak:** TTL koneksi pendek + reconnect. Ia memindahkan pertanyaannya alih-
  alih menjawabnya (pencabutan masih terlambat sebesar TTL) dan menukar satu angka
  yang harus dijaga konsisten dengan dua.

  ## Dua nama event terminal, dan perbedaannya menanggung beban

  `authorization-revoked` versus `stream-error`. Memberi tahu klien bahwa aksesnya
  dicabut padahal basis data sekadar sibuk adalah kebohongan ke arah yang
  diselidiki sebagai bug perizinan — **dan** ia menyuruh klien yang taat untuk
  tidak pernah reconnect atas gangguan sementara. `EventSource` reconnect sendiri;
  klien menutupnya pada `authorization-revoked` supaya sesi yang dicabut tidak
  menggedor endpoint yang akan menolaknya tiap lima detik.

  ## Byte pertama ditulis segera, dan komentarnya menjelaskan kenapa

  `writeResponse` Astro memanggil `writeHead()` **tanpa** `flushHeaders()`, dan Bun
  menahan header sampai `write()` pertama. Terukur dengan `Bun.serve` nyata: header
  tiba di **+3013 ms** ketika byte pertama ditunda, **+1 ms** ketika langsung
  ditulis. Sampai itu `EventSource.onopen` tak pernah menyala dan klien menganggap
  koneksinya menggantung. Perbaikannya satu baris — dan justru karena sepele ia
  akan "dirapikan" orang berikutnya kalau alasannya tidak ditulis di sebelahnya.

  ## Satu bug yang ditangkap kompiler dan berarti lebih dari kompilasi

  `withTenant` — bukan `withTenantOrThrow` — **mengembalikan** `Response` saat pool
  atau circuit breaker menolak, bukan melempar. `catch` saja karena itu akan
  melewatkan jalur penolakan utama, dan sebuah `Response` akan mengalir ke klien
  sebagai kalau-kalau snapshot. Kini dipetakan eksplisit ke `stream-error`.

  ## Loop-nya fungsi, dan itu sebabnya bisa dibuktikan

  `runSseLoop` menerima efeknya sebagai parameter, jadi properti yang #467 minta —
  _"aliran BERHENTI ketika grant dicabut"_ — dibuktikan dengan memanggil sebuah
  fungsi, bukan dengan basis data, sesi, dan detik jam dinding. Test-nya
  mengasersikan bahwa deny mengakhiri loop, bahwa **tak ada** yang ditulis
  sesudahnya, dan bahwa otorisasi ditanya **tepat sekali lagi** — yang terakhir
  itulah bukti bahwa "tidak" pertama bersifat final.

  ## Pemakai pertamanya nyata

  `GET /api/v1/push/stream` mengalirkan ringkasan antrean ke konsol push, tiap 5
  detik, dengan plafon koneksi 10 menit. Operator yang menunggu backlog terkuras
  adalah kasus SSE paling kanonik yang ada, dan konsolnya baru saja dibangun.
  Daftar pesan dan percobaan **tidak** dialirkan: keduanya dibatasi 50 baris dan
  berubah bentuk bukan nilai.

  Fan-out multi-instance **belum ada, dan itu ditulis alih-alih didiamkan** — tiap
  koneksi mem-poll sendiri, yang bekerja pada default satu instance dan tidak akan
  pecah saat replika dinaikkan, hanya tidak menjadi lebih murah. Jebakan penerusnya
  ikut dicatat: `RedisClient` Bun yang sudah `subscribe` memblokir hampir semua
  perintah lain, jadi subscriber wajib koneksi terpisah.

  ## Dan satu gerbang yang buta terhadap dokumen baru

  `check:docs` membaca `git ls-files`, yaitu **index**, bukan working tree. Berkas
  `.md` yang baru dibuat dan belum di-stage karena itu tak terlihat olehnya —
  padahal dokumen baru justru yang paling mungkin membawa tautan salah.

  Ditemukan dengan cara paling mahal: ADR-0075 lolos `check:docs` **lokal** dengan
  tautan rusak ke berkas ADR yang tidak ada, lalu memerahkan CI setelah di-commit.
  Hijau lokal lalu merah di CI adalah kegagalan gerbang, bukan sekadar
  ketidaknyamanan — ia melatih orang untuk tidak mempercayai run lokalnya.

  Diperbaiki dengan `--others --exclude-standard`, dan dibuktikan: berkas
  tak-ter-track dengan tautan rusak kini **merah** di mesin lokal.

- a704a0a: feat(access): sebuah undangan membawa Policy-nya sendiri (ADR-0082, #423)

  Gelombang 4 PR 4.1. `awcms_invitations` + `awcms_invitation_policies`
  (`sql/106`, permission `sql/107`): sebuah undangan menyebut alamat dan membawa
  daftar peran yang akan dipegang orang itu begitu ia menerima. Peran-peran itu
  **inert** sampai penerimaan — yang mendarat di PR 4.2 — memanggil
  `grantRolePolicy`, penulis yang sama dengan setiap grant lain, sehingga
  `activeRoleGrants` tidak pernah perlu tahu tabel ini ada.

  **Mengundang dan memberi peran tetap dua otoritas.** Undangan ber-peran
  menuntut `identity_access.invitations.create` DAN
  `identity_access.access_control.assign` — pengulangan pemisahan ADR-0081 dengan
  taruhan lebih tinggi, karena grant lewat undangan menjangkau orang yang belum
  ada. `skip_email_confirmation` menuntut permission ber-`scope: 'platform'`
  (satu-satunya milik modul ini) kecuali alamatnya sudah memegang identitas aktif
  di tenant ini.

  **Kolom scope ada tetapi dipatok** `CHECK (scope_type = 'tenant' AND scope_id =
tenant_id)`. ADR-0080 menulis sendiri bahwa PR yang menambahkan penulis grant
  ber-scope tidak boleh mendarat tanpa menjawab batasnya; ini menjawabnya dengan
  menolak menjadi penulis itu, sambil menyisakan pelebaran nanti sebagai satu
  `DROP`/`ADD CONSTRAINT`.

  Resend **merotasi** token (tanpa rotasi, "kirim ulang" adalah permukaan
  perbanyakan token) dan digerbangi `create`; batas 5 kali hidup di CHECK basis
  data, dan ditegakkan di predikat UPDATE-nya sendiri, bukan lewat baca-lalu-tulis
  di JS.

  Perubahan yang ikut, dan alasannya:

  - `AuthNotificationPort` mendapat operasi KEDUA
    (`enqueueAuthAddressNotification`) alih-alih `recipientTenantUserId` yang
    nullable. Seorang undangan belum punya baris `awcms_tenant_users`, jadi
    operasi lama tidak bisa mengalamatinya — dan membuat field itu opsional akan
    meninggalkan setiap pemanggil lama satu salah-ketik dari mengantre pesan tanpa
    tujuan.
  - Kategori template `auth.invitation` + template default en/id.
  - `awcms_invitation_policies` masuk `BOUNDED_BY_DESIGN` (4 → 5): ia dibatasi
    induknya lewat `ON DELETE CASCADE`, dan cascade itu load-bearing — tanpanya
    purge `generic` induknya akan gagal di FK anak dan retensinya diam-diam tak
    pernah berjalan.
  - Empat permission baru masuk ledger `NOT_YET_SCREENED`; `/admin/invitations`
    adalah perubahan tersendiri (urutan yang sama dengan ADR-0056).
  - Tiga env baru dituliskan tangan di `.env.example` karena
    `config:env:coverage:check` hanya mencocokkan `process.env.X` dan buta
    terhadap `env.X` yang dilewatkan sebagai parameter — batas yang gerbangnya
    catat sendiri.

### Patch Changes

- fef7381: fix(test,gerbang): asersi anti-regresi chokepoint berhenti lolos secara hampa saat rename

  Dua asersi di `tests/access-chokepoint.test.ts` menjaga invarian utama ADR-0063
  — `ownershipGrant` **melebarkan** himpunan kunci, tidak pernah men-_short-circuit_
  ke `allowed: true` — dengan `expect(source).not.toMatch(/ownershipGrant…/)`.

  Regex-nya berlabuh pada literal nama variabel. `not.toMatch` terhadap pola yang
  **tidak akan pernah cocok** selalu hijau, jadi sebuah rename membuat keduanya
  lolos tanpa menguji apa pun.

  Diverifikasi, bukan diduga. Dengan `ownershipGrant`/`ownershipApplied` di-rename
  habis di `access-guard.ts` (0 kemunculan nama lama, 7 nama baru), asersi lama
  tetap **HIJAU**; asersi baru **MERAH**.

  Penggantinya menamai kedua variabel itu nol kali: ambil badan
  `authorizeInTransaction` saja (bukan seluruh berkas — deklarasi tipe
  `AuthorizeResult` di atasnya sah menulis `allowed: true;`), lalu tuntut **tepat
  satu** `allowed: true` dan indeksnya **setelah** `evaluateAccess(`. Sebuah early
  allow adalah kecocokan kedua, apa pun nama variabelnya.

  Dipasangkan test kedua yang **menuntut identifier itu ADA**. Aturan yang
  diadopsi: asersi berbasis sumber wajib rename-proof, **atau** dipasangkan asersi
  keberadaan — kalau tidak, ia menjaga mekanisme yang mungkin sudah tidak ada.

  Dua asersi hampa lain ikut ditutup di jalan: `expect(evaluate).toBeGreaterThan(-1)`
  sebelum perbandingan indeks (tanpanya perbandingannya berbunyi `> -1` dan lolos
  untuk penempatan apa pun), dan `expect(start).toBeGreaterThan(-1)` di pengekstrak
  badan fungsi (tanpanya seluruh asersi menjangkau string kosong — cacat #425 lahir
  kembali di dalam perbaikannya sendiri).

  **Sisi gerbang.** `scripts/access-chokepoint-check.ts` mengklasifikasi handler
  lewat literal `fetchGrantedPermissionKeys(`. Rename fungsi itu membuat setiap
  `decidesPermissions` bernilai false, `findChokepointBypasses` mengembalikan
  kosong, dan gerbang mencetak **"0 handler memutuskan permission"** lalu keluar
  dengan **sukses**. Nama itu justru akan berubah bentuk di #423 (tipe kembalinya
  diubah) — momen ketika orang paling tergoda menggantinya.

  Sekarang `deciding.length === 0` adalah kegagalan dengan pesan yang menyebut
  sinyalnya. Diverifikasi: sinyal yang tak lagi cocok apa pun → **MERAH** (dulu
  hijau).

  Nol perubahan runtime.

- 26334bd: fix(admin): CMS ini akhirnya bisa menerbitkan artikel lewat layarnya sendiri — form create mengirim `contentText: ""` ke validator yang menolaknya

  `/admin/blog` dan `/admin/blog-pages` mengirim `contentJson: {}` dengan
  `contentText: ""`, di bawah legenda yang menjanjikan editor body "belum bagian
  dari layar ini". `validateContentTextField` mewajibkan `contentText` tak-kosong,
  jadi **setiap** create dari kedua layar dijawab 400: tidak ada satu pun artikel
  atau halaman yang pernah bisa dibuat lewat UI-nya sendiri.

  Perbaikannya adalah INPUT yang hilang, bukan validator yang dilonggarkan.
  `content-quality-checklist.ts` tidak punya aturan "body ada", jadi melemahkan
  `validateContentTextField` akan membuat post yang benar-benar kosong lolos
  sampai `publish`.

  - **`<textarea>` body** pada form create kedua layar, dikonversi oleh
    `src/lib/ui/blog-body-editor.ts` menjadi `{ blocks: [{ type: "paragraph",
text }] }` — bentuk yang didefinisikan `content-block-rendering.ts`, bukan
    bentuk karangan sendiri. Tipe `ParagraphBlock` di-`Extract` dari union modul
    itu, sehingga perubahan di sana gagal di typecheck, bukan diam-diam
    menghasilkan blok yang tak dirender siapa pun.
  - **Jalur PATCH**: `/admin/blog` tidak punya form edit sama sekali (`grep -c
PATCH` = 0), jadi post yang sudah ada hanya bisa disunting lewat `curl`.
    Kini ada form edit ber-`?edit=<id>`, mengikuti pola `/admin/blog-pages` yang
    sudah ada (partial update, tanpa `Idempotency-Key` — kedua endpoint memang
    menolaknya). Form edit `/admin/blog-pages` ikut mendapat body dan excerpt.
  - **Editor MENOLAK menyunting body** yang memuat blok di luar `paragraph`
    (gallery, video embed). Blok-blok itu tak punya permukaan authoring di repo
    ini, dan textarea yang menulis ulangnya sebagai paragraf akan
    **menghancurkannya** pada simpan pertama. `readParagraphBodyText` menjawab
    `null`, dan layar tidak merender field body sama sekali untuk baris itu.
  - **Pesan galat menyebut field yang benar.** Sebelumnya setiap kegagalan
    dijawab "Check the title and slug" — justru dua field yang selalu BENAR,
    sementara yang ditolak API adalah `contentText`. `sendJsonWithFieldErrors`
    membaca `error.details` yang `sendJson` sengaja buang, dan hanya NAMA field
    yang ditampilkan lewat peta label layar (bukan teks pesan server). Cabang
    konflik slug juga diperbaiki: kode yang dikirim endpoint adalah
    `SLUG_CONFLICT`, sedangkan layar memeriksa `CONFLICT` yang tak pernah cocok.

  Baris `?edit=` divalidasi sebagai UUID di frontmatter: `fetchBlogPostById`
  mengikatnya sebagai `uuid`, dan `?edit=nonsense` akan membatalkan transaksi
  sehingga seluruh layar menjadi "posts could not be loaded" — "daftarnya rusak"
  untuk sesuatu yang sebenarnya "tidak ada post itu".

  Skrip klien tetap DIIMPOR (dua modul baru di `src/lib/ui/`), bukan inline:
  CSP `default-src 'self'` tanpa `'unsafe-inline'` memblokir `<script>` yang
  di-inline Astro saat tak ada import. Diverifikasi dari `dist/`: keduanya
  ter-emit sebagai `/_astro/*.js` eksternal, dan `import type` membuat renderer
  `content-block-rendering.ts` tidak ikut ke bundle browser.

  Penugasan taksonomi (`termIds`) TETAP absen di `/admin/blog`: picker-nya butuh
  katalog taksonomi, dan membacanya di bawah gerbang `posts.*` layar ini adalah
  pembacaan tanpa permission sendiri. `blog_content.taxonomies.read` milik
  `/admin/blog-taxonomy`, dan `tests/admin-blog-page-contract.test.ts` mengunci
  layar ini pada sebelas key — meminjam satu harus jadi keputusan yang ditulis di
  berkas itu.

- c31f2a2: chore(actions): `codeql-action` 4.37.4 → 4.37.6 dan `attest-build-provenance` 4.1.1 → 4.2.2

  Menggantikan tiga PR dependabot (#493, #494, #495) dengan satu.

  **`codeql-action/init` dan `codeql-action/analyze` WAJIB satu PR.** Dependabot
  memecahnya per-path, sehingga tiap PR memindahkan satu langkah ke SHA baru dan
  meninggalkan pasangannya di SHA lama — dan CodeQL menolak jalan dengan
  `init`/`analyze` yang tak sepadan. Keduanya di sini pindah ke SHA yang sama
  (`5595ccaf…`), yang memang SHA yang diusulkan kedua PR itu.

  Ini bukan preferensi gaya: dua PR yang masing-masing memerahkan `Analyze` tak
  bisa di-merge berurutan, karena yang pertama merah **sampai** yang kedua
  mendarat. Satu-satunya urutan yang hijau adalah satu PR.

  `attest-build-provenance` dinaikkan di **dua** langkah `release.yml` sekaligus
  (attest image + attest SBOM); membiarkan salah satunya berarti satu rilis
  menandatangani dua artefak dengan dua versi penanda tangan.

  Semua pin tetap SHA-pinned dengan komentar versi — bentuk yang sudah dipakai
  seluruh workflow di repo ini, dan yang membuat tag yang dipindahkan tidak bisa
  mengubah apa yang berjalan.

- c54c296: chore(deps): astro 7.1.6 → 7.2.0 dan @astrojs/node 11.0.3 → 11.1.0

  Menggantikan dua PR dependabot (#488, #489) dengan satu.

  **Digabung karena keduanya tak bisa hijau sendirian.** `family:conformance:check`
  membandingkan `awcms-family-compatibility.yaml` dengan `package.json` field demi
  field, jadi menaikkan satu dependensi tanpa memperbarui manifesnya membuat
  gerbang itu **merah** — dan itulah yang terjadi pada kedua PR dependabot. Manifes
  diperbarui di sini untuk keduanya sekaligus; memperbaikinya dua kali berarti dua
  PR yang masing-masing merah sampai yang lain mendarat.

  Adapter node dan astro juga berpasangan: `@astrojs/node@11.1.0` menyatakan
  `peerDependencies: { astro: "^7.0.0" }`, dan `bun install` **tidak menolak**
  peer mismatch — ia memasang dan diam. Jadi bukti bahwa pasangan ini benar bukan
  lockfile-nya melainkan `bun run build` yang hijau, yang dijalankan rantai `check`.

  **Satu koreksi yang ikut mendarat.** Divergensi `astro-files-not-type-checked`
  menyatakan "42 berkas `.astro` (22.328 baris)"; angka sesungguhnya **44 berkas
  (24.359 baris)**. Divergensi itu ada untuk mencatat BESARNYA paparan yang tidak
  diperiksa `tsc`, jadi ringkasan yang mengecilkannya adalah satu-satunya jenis
  kesalahan yang benar-benar merugikan di entri itu. Diukur ulang
  (`find src -name '*.astro'`), bukan ditaksir.

- 5944e94: fix(cache-tepi): tiga surface untuk rute yang tak ada lagi dicabut — dan gerbangnya berhenti menerima izin-cache yang inert

  [ADR-0061](docs/adr/0061-host-resolved-public-surfaces-are-edge-cacheable.md) §A
  menambahkan tiga entri `PUBLIC_CACHE_SURFACES` untuk keluarga host-resolved
  `/news/**`. [ADR-0071](docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
  kemudian **menghapus keluarga rutenya dari repo ini**, dan ketiga entri itu
  bertahan beberapa hari lebih lama dari rute yang mereka layani.

  Diverifikasi ke kode, bukan disimpulkan — keduanya sekaligus:
  `extractTenantCodeFromPath("/news/hello-world")` → `null` (`TENANT_CODE_PATH`
  hanya mengenal `blog|theming`), dan `publishEdgeCacheTenant` **nol pemanggil**
  untuk path itu (satu-satunya pemanggilnya `seo-distribution/presentation/discovery-route.ts:145`).
  Jadi ketiganya **inert**: `requiresTenant: true` membuat tenant yang tak
  ter-resolve gagal-tertutup, dan tak ada rute yang menyajikannya.

  **Inert bukan alasan membiarkannya.** Sebuah entri di registry ini adalah
  pernyataan berdiri bahwa cache **BERSAMA** boleh menyimpan sebuah path — lengkap
  dengan `rationale` yang berargumen mengapa itu aman — untuk rute yang tak bisa
  dibaca siapa pun. Pembaca berikutnya membacanya sebagai bukti keluarga itu
  hidup, dan `edge-cache:surfaces:check` yang melapor `OK — 11 declared surfaces`
  terbaca sebagai cakupan **11** hal, bukan 8.

  Yang berubah:

  - Ketiga entri (`news-index`/`news-taxonomy`/`news-post`) dicabut → **8
    surface**. Komentar header `surface-registry.ts` yang masih mengklaim "Their
    routes publish `locals.edgeCacheTenantId`" untuk keduanya dibetulkan: hari ini
    hanya rute discovery root yang mempublikasikannya.
  - **Gerbang baru `findSurfacesWithoutServingRoutes`**: tiap surface wajib punya
    entri `api.routes` di modul pemiliknya yang bisa menyajikannya. `api.routes`
    adalah otoritas yang tepat karena registry sudah memperlakukannya sebagai
    klaim modul atas ruang URL — `modules:routes:check` yang mengikatnya ke
    filesystem. Cakupan diperiksa **dua arah**: rute boleh lebih luas dari surface
    (`/blog` vs prefiks `/blog/`) atau lebih sempit (`/sitemap.xml` vs prefiks
    `/sitemap` dari `^\/sitemap(-\d+)?\.xml$`).
  - `tests/edge-cache.test.ts`: kelima pin `/news/**` pindah dari "resolve ke
    surface X" menjadi "**tidak** cacheable". Sengaja dipertahankan sebagai probe
    alih-alih dihapus — `/news/**` masih kosakata hidup di `awcms-astro`, jadi
    bentuk path itu akan terus muncul di hadapan pembaca, dan mendeklarasikan
    ulang surface untuk rute yang repo ini tak sajikan harus **memerahkan** daftar
    itu, bukan lewat tanpa terlihat.

  **Ekstraksi prefiksnya menangani alternasi satu tingkat, dan itu bukan
  hiasan.** `seo-feed` adalah `^\/(feed\.xml|atom\.xml|feed\.json)$`, yang prefiks
  polosnya `/` — prefiks yang cocok dengan **setiap** rute yang pernah
  dideklarasikan, sehingga aturan ini akan vakum persis untuk keluarga yang paling
  membutuhkannya. Alternasi diekspansi hanya bila **seluruh** cabangnya literal
  DAN grupnya mengakhiri pola; kalau tidak, prefiks berhenti di situ (menjatuhkan
  teks setelah grup diam-diam akan melebarkan apa yang dianggap "tercakup"). Test
  mengunci keduanya, plus satu asersi bahwa **setiap** cabang harus bisa disajikan
  — modul yang hanya mendeklarasikan `/feed.xml` tetap MERAH.

  **Mutation-proven:** mengembalikan satu entri `news-index` → gerbang MERAH
  menyebut surface, prefiks, dan `api.routes` yang dideklarasikan pemiliknya.
  Sebelum perubahan ini, kesebelas entri lolos: 8 lolos, tepat 3 gagal.

  Ikut dibetulkan: `tests/news-routes-edge-cache-contract.test.ts` **dihapus
  bersama rutenya**, tetapi masih dikutip tiga dokumen current-state
  (`edge-cache-architecture.md`, skill `awcms-edge-cache`, dan docblock test
  saudaranya). Aturan disclosure yang dijaganya — publikasikan tenant hanya pada
  jalur yang MENYAJIKAN, karena 404 boleh di-cache — **tidak ikut dicabut**; ia
  berlaku untuk tiap surface host-resolved berikutnya, dan kini dirujuk ke
  penjaganya yang masih ada. Kutipan di ADR-0061 sengaja **tidak** disentuh: ADR
  adalah catatan keputusan pada satu titik waktu.

- 26334bd: CSP menambahkan `img-src` dan `media-src` dari origin media terkonfigurasi, sehingga gambar DAN video R2 lintas-origin tidak lagi diblokir kebijakan aplikasi sendiri.
- 404202e: fix(ci): 36 test DB-gated berhenti hijau-palsu — lima berkas yang tak pernah dijalankan pipeline mana pun

  Suite DB-gated di akar `tests/` tak bisa berjalan satu proses dengan
  `tests/integration/` (empiris: 26 tabrakan), jadi kedua pipeline menjalankannya
  sebagai step tersendiri dengan **daftar berkas eksplisit**. Daftar eksplisit
  memang keputusan yang benar di situ — `bun test` telanjang akan menumbuhkan
  kembali tabrakannya — tetapi daftar eksplisit **drift**, dan yang ini drift.

  Ia lahir dengan **10** entri (#176). Lima berkas DB-gated mendarat sesudahnya
  (#188, #189, #190, #191) dan **tak satu pun PR-nya menyentuh daftar itu**:

  - `tests/mfa-integration.test.ts` — atomisitas lockout & replay counter di
    Postgres (CAS + `FOR UPDATE`), konsumsi recovery code sekali-pakai di bawah
    konkurensi, RLS FORCE, penolakan lintas-tenant.
  - `tests/mfa-login-e2e.test.ts` — enforcement enrollment + step-up pada handler
    login/step-up/admin-reset yang SEBENARNYA.
  - `tests/oidc-integration.test.ts` — penolakan lintas-tenant atas empat tabel
    OIDC, validasi klaim ID token, guard SSRF terhadap issuer privat.
  - `tests/turnstile-login-e2e.test.ts` — Turnstile berjalan SEBELUM lookup
    identitas/kerja password di handler nyata, gagal-tertutup, dan tiap rute
    terikat action-nya sendiri.
  - `tests/openapi-office-response-schema-postgres.test.ts` — konformansi payload
    respons terhadap schema `Office` di bundel OpenAPI.

  Hasilnya **36 test yang skip di setiap pipeline** sambil terbaca sebagai
  cakupan pada setiap run hijau. Dan bukan salah tafsir: header keempat berkas
  itu **menuliskan sendiri** bahwa mereka "runs in the dedicated legacy
  `bun test <files>` step" — step yang daftarnya tak pernah memanggil mereka.

  Tak ada yang bisa menangkapnya. `bun run check` memang berjalan dengan
  `DATABASE_URL` kosong, jadi berkas-berkas itu SEHARUSNYA skip di sana — skip
  bukan sinyal. Satu-satunya pengamat yang bisa membedakan "skip karena tak ada
  database" dari "skip selamanya" adalah pemeriksa yang membandingkan filesystem
  dengan workflow, dan pemeriksa itu **tidak butuh database**.

  Perbaikannya: kelimanya masuk daftar di **kedua** workflow (`ci.yml` dan
  `release.yml` — `release.yml` justru pipeline yang mereka tuju saat ditulis),
  komentar "These 9 files" yang sudah salah sejak lama dibetulkan jadi 15, dan
  `tests/db-gated-suite-ci-parity.test.ts` mengikat daftar itu ke filesystem
  **dua arah atas kedua workflow**:

  1. tiap berkas DB-gated di akar `tests/` wajib disebut;
  2. tiap entri wajib menunjuk berkas yang ADA dan MASIH DB-gated — entri yang
     berhentinya DB-gated akan berjalan di step yang seluruh tujuannya isolasi
     database sambil tak membuktikan apa pun;
  3. kedua pipeline wajib menjalankan himpunan yang SAMA — berkas yang ada di
     `ci.yml` tapi tidak di `release.yml` lebih buruk daripada yang tak ada di
     keduanya: PR hijau atas bukti yang rilis tak pernah periksa ulang, dan
     itulah persis cara kelima entri ini bertahan.

  **Mutation-proven tiga kali:** mengembalikan cacat aslinya (buang lima entri)
  → MERAH; entri menunjuk berkas tak-ada → MERAH; berkas berhenti DB-gated tapi
  tetap terdaftar → MERAH.

  **Catatan menghitung, karena draf pertama perubahan ini salah menghitungnya.**
  Menjalankan kelima berkas dengan `DATABASE_URL` kosong melaporkan **46 skip**,
  dan 46 **bukan** jumlah test: bun ikut menghitung **hook** yang di-skip, dan
  kelimanya punya persis `beforeAll` + `afterAll` — 36 test + 10 hook. Yang jujur
  adalah jumlah deklarasi (`grep -cE '^\s*(test|it)\('`), dan itulah yang kini
  benar-benar dieksekusi pipeline: 14 + 3 + 9 + 1 + 9, diverifikasi per berkas
  dari log run yang memulihkannya, bukan disimpulkan. Nol di antaranya merah —
  90 migrasi berlalu sejak berkas-berkas itu ditulis, dan ternyata tak ada yang
  membusuk.

  Dan gerbangnya menangkap satu cacat pada dirinya sendiri sebelum di-commit:
  draf pertama mencocokkan seluruh dokumen YAML, sehingga **komentar** yang
  menyebut nama berkas ikut terbaca sebagai entri daftar. Itu kelas cacat yang
  ADR-0062 sudah catat untuk ekstraktor path `skills:check`. Baris komentar kini
  dibuang lebih dulu, dan alasannya ditulis di berkasnya.

- d30f932: docs(blog_content): descriptor dan README berhenti menjanjikan keluarga `/news/**` yang sudah dihapus

  Pelaksanaan ADR-0071 §4 menghapus keempat rute `/news/**`, gerbang
  `withHostResolvedBlogTenant`, dan setting `publicRouteMode` dari kode — tetapi
  **deskripsi descriptor `blog_content` dan `README.md`-nya tidak ikut berubah**.
  Keduanya masih menyajikan ketiganya sebagai permukaan hidup:

  - `module.ts` `description` masih berbunyi "ADR-0059 adds the SECOND,
    host-resolved public family `/news/**` … carries its own switch
    `publicRouteMode`". Deskripsi descriptor bukan komentar — ia yang dibaca
    `listModules()` dan yang muncul di layar Module Management, jadi operator
    membacanya sebagai daftar kapabilitas.
  - `README.md` memuat ~180 baris yang mendokumentasikan gerbang, saklar, dan
    keempat rute itu, termasuk **tabel setting yang mencantumkan `publicRouteMode`
    sebagai field yang bisa ditulis** lengkap dengan write path
    `PATCH /api/v1/tenant/modules/blog_content/settings` — instruksi untuk menulis
    setting yang sudah tidak ada.

  Ini kelas cacat yang sama yang berulang di repo ini: dokumen yang membantah
  kodenya sendiri, dan tak satu gerbang pun melihatnya karena semua gerbang
  cakupan mengukur ENDPOINT, bukan prosa descriptor.

  Yang dipertahankan sebagai catatan historis, bukan dihapus: paragraf yang
  menyatakan keluarga itu PERNAH ada dan kenapa dipensiunkan. Menghapusnya akan
  membuat orang berikutnya mengusulkannya lagi sebagai fitur baru enam bulan
  kemudian — alasan yang sama dipakai tabel celah §9 untuk menahan baris yang
  sudah tertutup.

  Nol perubahan perilaku: hanya string deskripsi dan markdown.

- 26334bd: Perbaiki lima instruksi operator yang tidak bisa jalan: `.env.example` gagal `config:validate`-nya sendiri, `docker exec … email:dispatch` pada image tanpa `scripts/`, `production:preflight` yang tidak ada, tag image ber-`v`, dan checkout migrasi dari `main` bukan tag rilis.
- 33c7dba: docs(keluarga): `awcms-astro` dinyatakan memikul halaman publik + admin USER; mini/micro ditegakkan sebagai arsip (ADR-0070)

  Dua permintaan, dan hasil pemeriksaannya berbeda satu sama lain.

  **Yang KURANG: peran `awcms-astro`.** Pada 8 Agustus 2026 repo sebelah
  mendaratkan ADR-0034 — situs publik sebagai fungsi utama, plus permukaan admin
  untuk seorang **USER** bila situsnya menyatakannya lewat `permukaanAdmin`,
  dengan `owner` ditolak gerbang di sana. §Hubungan-nya menuliskan ketegangannya
  dengan ADR-0051 repo ini secara terbuka lalu menutupnya dengan permintaan yang
  tidak bisa ia penuhi sendiri: catat selisih ini sebagai divergence keluarga,
  karena "repo ini tidak bisa menulisnya sendiri". Tidak ada satu pun ADR di sini
  yang membolehkannya; ADR-0051 berbunyi **"seluruh layar admin … dibangun di repo
  `awcms`"**, dan satu-satunya ADR yang pernah memberi `awcms-astro` peran admin
  (ADR-0048) sudah di-supersede — lagipula peran yang diberikannya `owner`/internal,
  persis yang ditolak gerbang di sana.

  **Yang SUDAH ADA: penghentian mini/micro.** ADR-0047 membekukan keduanya dan
  ADR-0055 §1 menutup jalur port keluar; keduanya final. Yang tertinggal bukan
  keputusannya melainkan **penerapannya** — jadi tidak ada ADR ketiga yang
  mengulanginya, hanya penyuntingan berkas yang belum menyusul.

  - **[ADR-0070] MEMPERSEMPIT ADR-0051, tidak men-supersede-nya.** Sumbu pembagian
    layar bergeser dari AUDIENS (tenant vs owner/internal/platform) menjadi **APA
    YANG DIKELOLA**: admin **SISTEM** (modul, peran, tenant, jejak audit, apa pun
    lintas-tenant) tetap di sini di bawah satu shell `/admin/*`; admin **USER**
    (seseorang mengerjakan bagiannya sendiri di SATU situs) boleh di `awcms-astro`.
    Men-supersede akan mencabut ketiga gerbang pengganti ADR-0051 bersama
    keputusannya — kebalikan dari yang diinginkan.
  - **Ketiga gerbang pengganti ADR-0051 dikutip utuh dan tidak dilonggarkan
    sedikit pun** — termasuk klausa penegakan butir 3 ("tetap ditolak endpoint-nya
    kalau ia menebak URL-nya"), yang justru bagian yang klaim "tidak dilonggarkan"
    bersandar padanya. Temuan terbukanya untuk `idn_admin_regions.dataset.configure`/`.restore`
    sudah **ditutup** ADR-0052 (`sql/084`) lalu ADR-0053 (`sql/085`, scope
    `platform`), dan ADR ini tidak mengubahnya. Yang membuat penyempitan ini murah
    adalah kalimat ADR-0051 sendiri: yang menahan aksi lintas-tenant adalah gerbang otorisasi, bukan alamat
    repo tempat tombolnya digambar.
  - **Tidak ada kemampuan yang hanya ada di sana.** Setiap fitur yang dijangkau
    USER wajib juga bisa dikelola dari `/admin/*` di sini — jadi urutan kerjanya
    **`awcms` dulu, selalu**.
  - **Entri `admin-user-surface-in-awcms-astro`** masuk `intentionalDivergences`
    (`owner: @ahliweb`, `reviewDate: 2027-02-04`, sekohort dengan empat entri lain).
    Yang ditinjau bukan apakah admin USER boleh di sana — itu diputuskan — melainkan
    apakah **batasnya** masih di tempat yang sama.
  - **`family.role` di manifes dipersempit.** Ia satu-satunya pernyataan peran yang
    machine-readable, dan tidak ada tes yang meng-assert isinya — validator hanya
    menuntut string non-kosong. Itulah persis cara ia membusuk sampai mengklaim
    kepemilikan atas "every admin screen" berbulan-bulan setelah itu berhenti benar.
  - **ADR-0047 statusnya diperbaiki** `Accepted` → `Superseded by ADR-0055`, sesuai
    Aturan 2 indeks ADR sendiri. Isinya TIDAK ditulis ulang (Aturan 2 juga — ADR ditandai, bukan ditulis ulang); yang
    ditambahkan hanya banner bahwa §Keputusan butir 1 ("porting _out_ stays
    encouraged") sudah tidak berlaku. Ini sisa mini/micro yang paling berbahaya,
    karena statusnya membuat jalur port-keluar terbaca sebagai keputusan HIDUP.

  Yang hanya terasa saat mengembangkan:

  - **Kedua README nol menyebut `awcms-astro`** dan menyatakan keluarga terdiri dari
    tiga repo, dua di antaranya arsip. Wajah publik repo ini karena itu tidak memuat
    repo pasangannya yang hidup. Diperbaiki di kedua bahasa beserta hash i18n-nya.
  - **`AGENTS.md` memuat kontradiksi internal yang sudah ada sebelum ADR-0034 sisi
    sana:** tabel §"Di repo mana sebuah LAYAR dibangun" mengklaim `awcms` memikul
    "frontend PUBLIK", sementara tabel §"Di repo mana pekerjaan dilakukan" di berkas
    yang sama menyerahkan situs publik ke `awcms-astro`. Keduanya kini satu cerita.
  - **`docs/awcms/family-compatibility.md` §5 memuat daftar yang 100% salah** —
    sembilan entri era-mini, sementara manifes memuat empat entri yang sama sekali
    berbeda, dan tidak ada gerbang yang membandingkan keduanya. Judul dokumennya
    pun masih "terhadap standar AWCMS-Mini", poros yang dicabut ADR-0055.
  - **`awcms-sync-hmac` menggantungkan saklar keamanan pada repo arsip:**
    `SYNC_HMAC_ALLOW_LEGACY=false` disyaratkan menunggu `awcms-mini` diperbarui —
    syarat yang tidak akan pernah terpenuhi, sehingga celah pemalsuan v1 tidak akan
    pernah bisa dinyatakan tertutup. Dinyatakan ulang terhadap deployment nyata.
  - **Provenance tidak disapu.** ~40 rujukan `sql/`, riwayat versi kontrak di
    `module-contract.ts`, asal-usul modul di `index.ts`, dan penanda
    `<!-- sql-refs: awcms-mini … -->` semuanya DIPERTAHANKAN: yang pertama fakta
    permanen, yang terakhir load-bearing (menghapusnya memerahkan `check:docs`).
    Yang diubah hanya kalimat yang memperlakukan mini/micro sebagai standar atau
    antrean kerja yang HIDUP.

  **Nol perubahan kode berjalan, nol izin berpindah.** Ini keputusan tata kelola;
  seluruh gerbang teknis tetap utuh. Gerbang `reviewDate` dibuktikan menggigit
  dengan memundurkan tanggalnya, memastikan MERAH, lalu mengembalikannya.

  **Ditemukan verifikasi adversarial, dan ikut diperbaiki di sini.** Empat lensa
  membaca cabang ini sebelum ia di-push; yang mereka temukan bukan satu kesalahan
  melainkan satu bentuk kesalahan yang berulang — pernyataan diperbarui di tempat
  yang terlihat, dan tidak di tempat yang membantahnya.

  - **ADR-0051 dan ADR-0055 kini membawa penanda balik.** Sebelumnya rujukannya
    satu arah, sehingga pembaca yang membuka ADR-0051 langsung — dan `AGENTS.md`
    menautkannya di tiga tempat — mendapat aturan yang sudah dipersempit tanpa
    tanda apa pun. Itu persis bentuk kegagalan yang §Alternatif ADR-0070 katakan
    ingin dicegah. Keduanya mendapat banner; kalimatnya tidak ditulis ulang.
  - **Baris indeks ADR-0051** ikut ditandai `Accepted (dipersempit ADR-0070)` di
    kedua bahasa, meniru pola yang cabang ini sendiri pakai untuk ADR-0047.
  - **Tiga banner SOP faktual salah dan dihapus, bukan diparafrase**:
    `08_sop_operasional_user_guide.md` menyatakan `blog_content`, `data_lifecycle`,
    dan business-scope/SoD "belum ada di repo ini" padahal ketiganya live sejak
    `sql/035`–`sql/040`, `sql/055`–`sql/056`, dan `sql/027`–`sql/030`. Cacat ini
    mendahului cabang ini; tidak ada gerbang yang mengadu klaim "belum ada di
    `src/modules`" dengan isi `src/modules/`.
  - **`src/modules/_shared/family-contract.ts`** — satu-satunya pernyataan poros
    keluarga yang ada di KODE — masih menyatakan dirinya deklarasi konformansi ke
    standar `awcms-mini`, membantah header manifes yang cabang ini sendiri sunting
    ("self-anchored since ADR-0055").
  - Ditambah: rujukan "Aturan 3" yang sebenarnya Aturan 2, tanggal ADR-0052 yang
    tertulis 2 Agustus padahal 1 Agustus, alasan tidak memperluas ADR-0065 yang
    dibantah `COMMITTED_PATHS` di kodenya sendiri, daftar permukaan publik yang
    menghilangkan keluarga `/news/**` sambil mengatasnamakan ADR-0059, satu jangkar
    tautan rusak yang lahir di cabang ini, dan baris §11 `standar-performa-dan-keamanan.md`
    untuk divergence kelima.

- 02b0f4d: fix(keamanan): `bun audit` berhenti jadi klaim tanpa pemeriksa — tiga advisory `high` ditutup dan digerbangi

  `docs/awcms/standar-performa-dan-keamanan.md` menjadikan `bun audit` bukti untuk
  **tiga** tabel kepatuhan sekaligus — OWASP A06, ISO/IEC 27001 A.8.8, dan NIST
  SSDF RV.1 — sementara `grep -rn "bun audit" package.json .github/workflows/
scripts/` mengembalikan **nol** kemunculan. Tidak ada satu perintah pun yang
  menjalankannya. Baris A06 berbunyi "`bun audit` bersih per 4 Agustus 2026";
  dijalankan 8 Agustus ia keluar dengan **3 advisory high**:

  - `nanoid <3.3.17` (GHSA-2v37-7h3g-55p8), lewat `astro › vite › postcss`
  - `js-yaml >=3.0.0 <3.15.1` dan `>=4.0.0 <4.3.1` (GHSA-5p4m-2wfm-xmqj,
    CVE-2026-59870), lewat `astro`, `@astrojs/node`, dan `@changesets/cli`

  Ketiganya ditutup lewat `overrides`, dan yang ketiga adalah alasan yang dua
  lainnya tidak punya: mengoverride `js-yaml` SENDIRIAN **merusak tooling rilis**.
  `read-yaml-file@1.1.0` — dipatok transitif oleh `@changesets/cli@2.31.1`, yang
  sendirinya sudah versi terbaru — memanggil `yaml.safeLoad`, API yang dihapus di
  js-yaml 4. Dibuktikan dengan memanggilnya: `Function yaml.safeLoad is removed in
js-yaml 4`. Karena Bun 1.3.14 **mengabaikan diam-diam** baik `overrides`
  bersarang gaya npm maupun `resolutions` ber-path gaya yarn (keduanya tidak
  menghasilkan entri bersarang di `bun.lock`), override tidak bisa dipersempit ke
  satu jalur — jadi konsumennya yang dinaikkan: `read-yaml-file ^2.1.0`, versi
  terbaru yang masih CommonJS (`3.0.0` sudah `"type": "module"` sedangkan
  `@manypkg/get-packages` menjangkaunya lewat `require()`) dan sudah memakai
  `js-yaml ^4.1.1`.

  Gerbang barunya `bun run deps:audit:check`, disisipkan ke rantai `check`:

  - memblokir `high`/`critical`; `moderate`/`low` dicetak tetapi tidak memblokir,
    karena gerbang yang berbunyi pada derau adalah gerbang yang dihapus orang
  - **gagal-TERTUTUP** saat `bun audit` tidak bisa dijalankan — audit yang tak
    terjangkau registry melaporkan hijau yang sama dengan audit bersih, dan hanya
    satu dari keduanya yang benar
  - daftar pengecualian **KOSONG** dan dijaga tetap kosong; entri yang tidak lagi
    cocok dengan advisory mana pun **memerahkan** gerbang, sehingga daftarnya tak
    bisa jadi museum kerentanan yang sudah lama diperbaiki upstream

  Dua jebakan yang ditemukan sambil mengerjakan ini dan ditulis di header skrip
  supaya tidak ditemukan ulang: `bun update <nama>` pada dependensi **transitif**
  tidak memutakhirkan salinan bersarangnya — ia menambahkan paket itu sebagai
  dependensi **langsung** repo; dan `bun install` inkremental **tidak memangkas**
  `node_modules/*/node_modules/<pkg>` peninggalan instalasi sebelumnya, sehingga
  pohon direktori bisa memuat salinan rentan sementara gerbang hijau. Yang diaudit
  adalah lockfile — dan lockfile pula yang dikirim (`--frozen-lockfile` di CI dan
  image), jadi itu yang benar; "hijau" berarti lockfile-nya bersih, bukan setiap
  byte di `node_modules/`.

  Ketiga baris kepatuhan dikoreksi agar menamai gerbang yang berjalan, bukan
  perintah yang tersedia.

- 04c2899: feat(gerbang): `access:decision-log:coverage:check` mengunci jejak keputusan otorisasi

  `authorizeInTransaction` menulis satu baris `awcms_abac_decision_logs` di setiap
  jalur terminal. Properti itulah yang membuat sistem ini bisa menjawab "kenapa
  permintaan ini ditolak" dari sebuah tabel alih-alih dari tebakan — dan ia
  ditopang **kebiasaan review saja**.

  Program model keanggotaan menambahkan **tiga** cabang keluar baru ke fungsi yang
  sama: `TENANT_SUSPENDED`, `ENTITLEMENT_REQUIRED`, dan penolakan
  principal/delegasi. Regresi paling mungkin di seluruh program adalah salah satu
  darinya kembali lebih awal tanpa menulis log. Tidak ada yang akan menangkapnya:
  suite default berjalan **tanpa** PostgreSQL, jadi "sebuah baris ditulis" tidak
  bisa di-assert di sana; permintaannya tetap ditolak dengan benar, jadi tidak ada
  test yang gagal dan tidak ada pengguna yang mengeluh. Yang hilang hanya jejaknya
  — pada penolakan yang paling perlu dijelaskan ke pelanggan.

  Gerbang ini **hijau hari ini**. Nilainya bukan menemukan cacat sekarang,
  melainkan mengunci properti sebelum tiga cabang baru mendarat di atasnya.

  **Aturan naif salah, dan membaca guard-nya yang menunjukkan itu.** "Setiap
  `return` didahului `recordDecisionLog(`" keliru di dua arah sekaligus:

  - Return `401 AUTH_REQUIRED` **tidak bisa** menulis log — ia menyala ketika
    `context` bernilai null, jadi tidak ada `tenantUserId` untuk mengatribusikan
    barisnya. Menuntut log di sana berarti menuntut baris yang mustahil. Ia masuk
    daftar pengecualian ber-alasan.
  - Return `403 SOD_CONFLICT` didahului `recordDecisionLog` yang mencatat sebuah
    **allow** — keputusan ABAC-nya memang allow, dan SoD adalah deny aditif yang
    dicatat di `awcms_sod_conflict_evaluations`. Aturan "log tepat sebelum return"
    meluluskannya karena alasan yang salah; aturan "log di blok yang sama"
    menggagalkannya karena alasan yang salah.

  Jadi aturannya **dominansi**, diaproksimasi secara leksikal: untuk sebuah return,
  telusuri rantai blok yang melingkupinya dan cari `recordDecisionLog(` pada
  kedalaman blok itu sendiri, sebelum posisi return-nya. Log di dalam
  `if (machine && …) { … }` karena itu mencakup return cabang itu dan **tidak**
  mencakup return di luarnya.

  Lima mutasi memerahkan gerbang, diverifikasi lokal. Yang paling menentukan:
  memindahkan panggilan log ke **cabang saudara** — ia tetap ada di berkas dan
  tetap tekstual lebih dulu dari return-nya, dan gerbangnya tetap **MERAH**. Itu
  yang membedakan dominansi dari regex. Empat lainnya: cabang keluar baru tanpa
  log; log dominan dihapus; fungsi target di-rename (gerbang tidak boleh diam-diam
  OK); dan pengecualian basi untuk kode yang kini sudah menulis log.

  Batas yang ditulis, bukan disembunyikan: pengecualian di-key oleh **kode error**
  (bukan offset baris, yang membusuk tiap kali ada suntingan di atasnya), sehingga
  return kedua yang memakai kode yang sudah dikecualikan akan mewarisi
  pengecualiannya. Dan gerbang ini menalar **satu** fungsi —
  `evaluateFieldAccessInTransaction` sengaja di luar cakupan dan sengaja tidak
  menulis log.

  Nol perubahan runtime. Rantai `check` 36 → 37 segmen.

- 343d69e: feat(gerbang): kelas "hanya bisa lewat `curl`" berhenti dicari dengan tangan — 54 permission tanpa layar jadi angka yang hanya boleh mengecil

  [ADR-0051](docs/adr/0051-admin-screens-consolidated-in-awcms.md) memutuskan
  setiap layar admin SISTEM dibangun di repo ini, lalu **tidak memasang apa pun
  yang mengukur kepatuhannya**. Akibatnya "modul ini hanya bisa dipakai lewat
  `curl`" ditemukan dengan tangan — berulang kali, dan tiap kali terlambat.

  Pemeriksa yang tampak berdekatan menjawab pertanyaan lain:

  - `access:permissions:enforcement:check` — "apakah permission ini punya
    **penegak**?" Sebuah rute sudah cukup. Permukaan `curl`-only lolos selamanya.
  - `tests/admin-navigation-registry.test.ts` — "apakah tiap entri `navigation`
    menunjuk halaman, dan sebaliknya?" Modul tanpa `navigation` tak punya apa pun
    untuk diperiksa.
  - contract test per-layar — "apakah layar INI menggerbangi key yang benar?" Ia
    tak bisa melihat permission yang tak disebut layar mana pun.

  `bun run admin:screen-coverage:check` (murni, di rantai `check`, gerbang ke-36)
  menanyakan yang hilang: **apakah ada layar yang mengklaim permission ini?**
  Hasil pemindaian pertama: **32 layar mengklaim 133 dari 203 permission**; 16
  keputusan tertulis, **54 menunggu layar, tersebar di sembilan modul.**

  Dua daftar, dan pemisahannya adalah inti desainnya:

  - **`DELIBERATELY_UNSCREENED`** — keputusan ber-alasan ("operator memang tidak
    seharusnya menggerakkan ini dari halaman"), bentuk yang sama dengan register
    `permission-enforcement-check.ts`. Isinya diambil dari alasan yang **sudah
    tertulis di kode**: keenam `workflow.definition.*` (butuh editor graf; textarea
    JSON yang menerima graf rusak sampai `publish` menolaknya lebih buruk daripada
    tak ada), unggah media tiga-langkah, saklar `enforcement` satu-arah,
    `blog_content.ads.*` yang ADR-0044 pensiunkan jadi 410, dan tiga lainnya.
  - **`NOT_YET_SCREENED`** — ledger **satu arah** yang isinya bukan penilaian
    apa-apa, hanya "belum ada yang membangunnya". Memberi sebuah permission layar
    lalu meninggalkan barisnya di sini **memerahkan CI**, jadi angkanya selalu
    angka yang sebenarnya. Itulah yang membuatnya layak ditulis: sebelum berkas
    ini, "13 dari 21 modul tanpa layar" adalah kalimat yang harus diturunkan ulang
    dengan tangan, dan pernah diturunkan **salah** lebih dari sekali.

  Mencampur keduanya akan membuat pekerjaan yang belum selesai memperoleh
  penampilan sebuah penilaian — persis cara ADR-0058 menemukan enam entri
  pengecualian yang ternyata enam bug.

  Dua kelompok terbesar di ledger bukan kosmetik, dan namanya disebut di
  berkasnya: seluruh key `email.suppression.*` (alamat yang di-suppress berhenti
  menerima email **termasuk reset password**, dan tak ada halaman untuk
  melihat/menghapusnya) dan seluruh `identity_access.business_scope_*` (assignment
  plus alur exception maker/checker tanpa inbox untuk checker-nya).
  `module_management.settings.*` adalah yang punya alibi palsu: tiga dokumen
  menyatakan panel setting generik `/admin/modules/{key}` sudah ada, dan satu
  memakai klaim itu untuk membenarkan tidak membangun editor. Layar itu tak pernah
  ada (dikoreksi di PR sebelumnya).

  **Matcher-nya menyelesaikan helper file-first, dan itu load-bearing.** Matcher
  yang hanya membaca triple literal `permissionKey("m","a","x")` melaporkan
  **delapan** permission `blog_content` yang ter-ship dan bekerja sebagai
  tak-terklaim, karena `blog-presentation.astro` mengikat
  `const can = (activity, action) => …permissionKey("blog_content", activity, action)`
  lalu memanggilnya delapan kali dengan literal. Diverifikasi dengan membuang
  resolusi itu: **8 false positive**. Scanner yang menjawab "tak tercakup" untuk
  yang tercakup lebih buruk daripada tak ada scanner — ia melatih pembacanya
  menambah pengecualian sampai gerbangnya tak menanyakan apa pun, dan
  `permission-enforcement-check.ts` butuh empat draf untuk mempelajarinya.
  Resolusinya sengaja **sempit**: helper hanya dihitung bila badannya mengikat
  module key sebagai LITERAL dan meneruskan kedua parameternya sendiri. Selain itu
  dibiarkan tak-terselesaikan — dan gagal ke arah "tak-terklaim", arah yang
  memaksa manusia melihat.

  **Batas yang dinyatakan di docblock-nya:** gerbang ini menjawab "apakah ada yang
  mengklaim?", **bukan** "apakah kontrolnya benar". Tombol Restore `/admin/blog`
  mengklaim `posts.restore` sambil dirender pada baris yang pasti 404 (#351);
  gerbang ini akan berkata "tercakup" sepanjang waktu itu. Kebenaran kontrol tetap
  tugas contract test per-layar.

  **Mutation-proven empat arah:** permission tanpa layar & tanpa entri → MERAH;
  entri ledger basi (layarnya sudah ada) → MERAH "only ever shrinks"; resolusi
  helper dibuang → 8 false positive; layar menggerbangi key yang tak dideklarasikan
  siapa pun → MERAH. Plus 15 unit test atas aturannya, digerakkan snapshot
  tertanam.

- 04908df: Gerbang baru `data-lifecycle:table-coverage:check` (#437) — tabel baru tidak
  bisa lagi mendarat tanpa menjawab pertanyaan retensi.

  Rencananya menyebut gerbang atas tabel **volume-tinggi** yang daftarnya
  DITURUNKAN, bukan ditulis tangan. Tiga cara menurunkannya dibangun dan diukur
  terhadap skema ini, dan ketiganya gagal: _append-only di sumber_ (46 tabel —
  `INSERT … ON CONFLICT DO UPDATE` terbaca sebagai append), _tanpa jalur hapus_
  (94 tabel — repo ini memakai `ON DELETE CASCADE` di satu migrasi saja), dan
  _tak-terbatas menurut skema_ (121 dari 128 — tabel terbatas yang nyata berkunci
  pada teks terkurasi seperti `module_key`, yang tak bisa dibedakan dari nilai
  bebas lewat DDL). Gerbang yang daftar pengecualiannya 90% skema adalah daftar
  tulis-tangan yang menyamar.

  Jadi pertanyaannya diganti. Alih-alih menurunkan tabel MANA yang volume-tinggi —
  yang menuntut tahu bagaimana produknya dipakai — turunkan bahwa sebuah tabel
  ADA, lalu buat kewajibannya mustahil dilewati. Tabel diambil dari `sql/` lewat
  `deriveTableRlsStates`, fungsi yang sama yang dipakai `repo:inventory`, supaya
  ada SATU jawaban untuk "tabel apa saja yang ada".

  Tabel lolos lewat tiga jalan, dan tabel BARU hanya punya dua: deskriptor
  `dataLifecycle`; `BOUNDED_BY_DESIGN` (**mulai kosong**, wajib beralasan); atau
  `TABLES_PREDATING_THE_RULE` — 114 tabel yang sudah ada, hanya boleh MENYUSUT dan
  tertutup untuk tabel baru. Entri ledger yang sudah punya deskriptor adalah
  error, bukan duplikat yang ditoleransi, dan panjangnya dipatok test supaya entri
  ke-115 tidak bisa bersembunyi di antara 114 lainnya.

  Batasnya dinyatakan, bukan dibiarkan tersirat: ini tidak bisa memberi tahu bahwa
  tabel LAMA di ledger sedang memakan disk. Itu pertanyaan tentang lalu lintas,
  dan tempat jujurnya `security:readiness` terhadap basis data nyata.

  Rantai `check` 37 → 38 segmen.

- 5672add: `access:chokepoint:check` mendapat root kedua — layar admin — plus
  `loadAdminScreen` dan ledger migrasi satu-arah (#450, PROJECT_STATE §4 R3).

  Ke-32 layar `src/pages/admin/**/*.astro` memutuskan apa yang dirender dari
  `ssr.permissions.has(...)`, yaitu `fetchGrantedPermissionKeys` — **RBAC mentah**.
  Jalur itu melewati `authorizeInTransaction`, jadi ia melewati semua yang hanya
  ada di sana: policy `deny` ABAC yang ditulis tenant (ditegakkan di API, **inert
  di layar**), `resolveModuleAvailability` (tenant yang mematikan modulnya tetap
  melihat layarnya berisi data), fakta business-scope, SoD action-time, dan
  `recordDecisionLog` — sehingga sebuah pembacaan yang terjadi tidak meninggalkan
  satu baris pun yang mengatakannya. Yang **tidak** hilang, supaya temuannya tidak
  dibesar-besarkan: RBAC dasar tetap ditegakkan dan tidak pernah ada kebocoran
  lintas-tenant — `withTenantOrThrow` + FORCE RLS selalu ada di jalur itu.

  `loadAdminScreen` membuka SATU transaksi, memanggil chokepoint, lalu menjalankan
  `load` **di dalam transaksi yang sama**. Deny me-render state ditolak, bukan
  redirect. Refusal pool/circuit-breaker adalah state KETIGA — sebuah penolakan
  yang dirender sebagai "Anda tidak boleh melihat ini" adalah kebohongan ke arah
  yang diselidiki sebagai bug perizinan.

  Gerbangnya tetap SATU skrip: dua skrip berarti dua daftar pengecualian yang
  menyimpang, dan yang kedua selalu jadi yang longgar. Kedua root hanya berbeda di
  dua tempat — cara berkas diiris (`.astro` per-BERKAS: satu berkas = satu jalur
  render) dan apa yang dihitung sebagai memutuskan (`.permissions.has(`).

  `form-drafts.astro` ikut dimigrasikan supaya mekanismenya **dibuktikan**, bukan
  sekadar disediakan; ledger mendarat berisi 31, bukan 32.

  Dua koreksi yang muncul saat membangunnya: `stripComments` ditambahkan setelah
  sinyalnya cocok dengan komentar layar yang baru dimigrasikan yang menjelaskan
  bahwa ia TIDAK lagi memakai `ssr.permissions.has()`; dan `extractScreenClaims`
  menemukan bahwa `visitor_analytics.raw_detail.read` sudah lama diklaim layar
  `analytics.astro` lewat evaluator ABAC — satu baris `NOT_YET_SCREENED` yang basi
  sejak sebelum PR ini.

- 26334bd: `config:env:coverage:check` kini melihat env yang dibaca lewat alias `process.env`, bukan hanya `process.env.X` — 53 → 173 variabel terlihat, dan 26 variabel deployment nyata (termasuk seluruh `REDIS_*`) ditambahkan ke `.env.example`.
- e3aa680: `scripts:inventory:check` membandingkan SELURUH blok ter-generate, bukan hanya
  baris tabelnya (#442).

  `renderInventory()` menulis dua hal: kalimat hitungan dan tabel. Pemeriksanya
  memanggil `parseInventoryBlock()`, yang menyaring `line.startsWith("| \`")`—
jadi kalimat di atas tabel dihasilkan lalu tidak pernah dibandingkan dengan
apa pun.`main` hari ini berbunyi "78 target … 32 di antaranya" sementara
  tabelnya memuat 79 baris dan kebenarannya 79/33.

  Yang membuat ini layak diperbaiki bukan angkanya, melainkan **siapa yang
  menuliskannya**: git, bukan manusia. #435 dan #440 lahir dari base yang sama,
  masing-masing menambah satu target, jadi keduanya mengubah baris kalimat itu
  menjadi teks yang IDENTIK. Rebase yang kedua di atas yang pertama tidak
  menemukan konflik pada baris yang kedua sisinya sama, menggabungkan baris
  tabel yang berbeda dengan benar, dan menghasilkan blok yang separuhnya benar
  — nol konflik, nol gerbang merah.

  Arah itulah temuannya: pemeriksa lama meliputi tepat bagian yang git TIDAK
  BISA salah gabung dan melewatkan bagian yang BISA. Karena itu unit
  pembandingnya kini blok, dinormalisasi hanya terhadap apa yang prettier
  tulis ulang (padding kolom + garis pemisah) — sehingga apa pun yang
  generatornya diajari tulis berikutnya ikut tercakup tanpa ada yang perlu
  mengingatnya.

  Buktinya bukan test yang ditulis untuk hijau: gerbang yang sudah diperbaiki
  dijalankan terhadap `main` apa adanya dan MERAH pada cacat yang benar-benar
  ada di sana, lalu hijau setelah regenerasi. Nol perubahan runtime.

- 12fe682: fix(gerbang,docs): klaim "modul ini belum ada" berhenti bersembunyi di `src/modules/`

  `tests/module-absence-claims.test.ts` dibangun karena tiga skill menyatakan modul
  yang ada di `listModules()` sebagai tidak ada — klaim yang membuat agen tidak
  mencarinya, tidak memanggilnya, dan dengan senang hati men-stub ulang sesuatu
  yang sudah bekerja. Gerbang itu memindai `.claude/skills/*/SKILL.md` dan
  `docs/awcms/*.md`.

  **Kalimat yang sama persis ternyata ada di `src/modules/data-lifecycle/README.md`**
  — "`form_drafts`/`newsletter`/`comments` (unported in this base) are not
  registered as adopters here" — sementara `form_drafts` dan `comments` keduanya
  mendeklarasikan descriptor `dataLifecycle` nyata. Ia duduk **satu direktori di
  luar** korpus gerbangnya. README dan header descriptor sebuah modul justru
  tempat paling load-bearing untuk klaim semacam ini, karena itulah yang dibaca
  orang sebelum menyentuh modul tersebut.

  Dua pelebaran, dan yang kedua diperlukan agar yang pertama tidak sia-sia:

  1. Korpus ditambah `src/modules/*/README.md` dan `src/modules/*/module.ts`,
     di-assert terpisah supaya glob yang resolve ke nol tidak lolos secara hampa —
     mode kegagalan yang persis pernah terjadi pada `dot: true`.
  2. Daftar frasa ditambah bentuk **Inggris** (`not ported`, `unported`,
     `does not exist in this base`, `no longer exists`). Berkas di `src/modules/`
     ditulis dalam bahasa Inggris, jadi daftar Indonesia-saja akan memindai berkas
     baru itu sambil **tidak mencocokkan apa pun** di dalamnya.

  Dibuktikan lewat dua mutasi: mengembalikan kalimat ASLI membuat gerbang merah
  dan menyebut kedua modul; mempertahankan cacat itu **tetap tertanam** sementara
  frasa Inggris dilepas membuat gerbang **hijau** — jadi penambahan frasa itu
  load-bearing, bukan hiasan.

  **Tujuh dokumen yang membantah kodenya sendiri diperbaiki**, tiap klaim
  diverifikasi ke kode lebih dulu:

  - `media-library/module.ts` menyatakan `/api/v1/media/objects/*` dan
    `/admin/media` "NOT ported here" dan "declares no `navigation` yet (the
    `/admin/media` page it would point at does not exist in this base)" —
    keduanya ADA, dan entri `navigation`-nya dideklarasikan **40 baris di bawah**
    paragraf itu di berkas yang sama. Bukan cacat fungsional (layarnya
    terjangkau), tetapi deskripsi descriptor adalah yang dibaca `listModules()`
    dan tampil di layar Module Management.
  - `data-lifecycle/README.md` — di atas.
  - `blog-content/module.ts` masih menulis "Two entries … Taxonomy, presentation,
    settings and homepage composition are still sibling screens" setelah lima
    entri mendarat. Ini kelalaian saya sendiri dari PR sebelumnya.
  - `absorb-awcms-micro-roadmap.md` memesan `2.4.0` untuk
    `newsletterContentSources`; slot itu sudah dipakai `api.routes` (#267) dan
    `2.5.0` oleh ADR-0053. Kini `2.6.0`.
  - `module-contract.ts` melompati **entri changelog `2.4.0`** seluruhnya
    (2.3.0 → 2.5.0) — dan justru itulah sebab roadmap memesan slot yang sudah
    terpakai. Ditambahkan.
  - `docs/ARCHITECTURE.md` masih membingkai `newsletter`/`social-publishing`/dll.
    sebagai "belum di-port … urutan porting". ADR-0055 mencabut jalur itu:
    mini/micro ARSIP, kapabilitas DIBANGUN di sini lewat ADR admission sendiri.
  - `docs/adr/0067` menyebut `/news/**` sebagai permukaan HTML repo ini. Kalimat
    aslinya **dipertahankan** dengan catatan supersession — ia benar saat ditulis,
    dan ADR adalah catatan keputusan, bukan dokumen current-state. **Hanya
    kalimat konteks itu** yang disentuh; keputusan RUM di ADR yang sama tidak.

- 9f8744e: feat(gerbang): sebelas berkas membaca tabel grant — sekarang daftarnya tertulis, dan yang kedua belas memerahkan CI

  Gerbang baru `access:grant-readers:check` di rantai `check`. Setiap berkas yang
  menyebut `awcms_access_assignments` atau `awcms_role_permissions` ada di daftar,
  berikut **alasannya**; apa pun di luar itu menggagalkan build. Hijau hari ini,
  nol perubahan perilaku — dan itulah maksudnya.

  **Apa yang dijaganya.** Hari ini sebuah grant adalah `(tenant_user, role)` dan
  menjawab satu pertanyaan: apakah orang ini memegang role itu, **di mana pun**
  dalam tenant. Gelombang 3 program keanggotaan (#423) membuat grant membawa
  **scope**-nya sendiri, sehingga join yang sama berhenti berarti "boleh
  bertindak" dan mulai berarti "boleh bertindak **DI SUATU TEMPAT**" — dan tiap
  pembaca yang merakit join-nya sendiri tetap memberi jawaban lama yang lebih
  lebar sambil terlihat tak tersentuh.

  Itu bukan mode kegagalan hipotetis. Bentuknya persis PROJECT_STATE §4 R3, tempat
  31 layar admin memutuskan dari RBAC mentah dan **tiap satu di antaranya terbaca
  benar**.

  **Kenapa mendarat SEBELUM benda yang dijaganya.** Gerbang yang harus hijau hari
  ini paling murah ditambahkan hari ini — dan daftar yang ditulis **sesudah**
  perubahan berisiko adalah daftar yang ditulis orang yang sudah punya alasan
  memendekkannya. `access:decision-log:coverage:check` (#426) mendarat atas
  argumen yang persis sama, satu gelombang lebih awal.

  **Kenapa daftar BERKAS, bukan aturan call-graph.** Sinyal yang jujur adalah
  "berkas ini menyebut tabelnya". Aturan tentang modul mana boleh meng-IMPOR modul
  mana akan melewatkan semuanya: kesebelas berkas menjangkau tabelnya lewat
  template SQL, bukan impor, jadi DAG modul tak punya pendapat apa pun tentang
  mereka dan `modules:table-writes:check` hanya mengatur TULIS. **Tiga** dari
  sebelas berada **di luar** `identity_access`, dan tak satu pun melanggar gerbang
  yang sudah ada:

  - `tenant-admin/…/platform-bootstrap.ts` — menyemai grant owner tenant baru
    sebelum `identity_access` punya permukaan untuk melakukannya. Fakta urutan
    bootstrap, dicatat bukan dimaafkan.
  - `pages/api/v1/access/policies/simulate.ts` — sebuah **RUTE** yang merakit
    join-nya sendiri. Satu-satunya entri yang berupa refactor terjadwal, bukan
    keputusan: simulator ABAC yang menghitung himpunan grant berbeda dari jalur
    nyata **mensimulasikan sistem yang salah**, dan bedanya muncul sebagai policy
    yang berperilaku di produksi tidak seperti pratinjaunya.
  - `email/…/announcement-directory.ts` — menyelesaikan "siapa memegang role X"
    untuk menyasar pengumuman. Keanggotaan, bukan otorisasi, jadi jawaban
    union-lintas-scope tetap benar sesudah Gelombang 3. Terdaftar karena
    penalarannya tidak jelas dari call site-nya.

  **Komentar tidak bisa memutuskan hasilnya, dua arah.** Tiga berkas di repo ini
  membahas tabel-tabel itu di docblock dan tak menyentuhnya — mereka tidak masuk
  daftar. Sebaliknya, sebuah berkas tidak bisa **mempertahankan** slotnya dengan
  menyebut tabelnya di komentar setelah query-nya dicabut: entri basi dilaporkan.
  Keduanya diuji. `stripComments` dipakai ulang dari `access-chokepoint-check.ts`,
  yang sudah mencatat kenapa justru PERBAIKAN yang menanam false positive — sebuah
  perbaikan menjelaskan apa yang ia hapus.

  **Dibuktikan mengikat, bukan sekadar hijau:** menyisipkan
  `"SELECT 1 FROM awcms_access_assignments"` ke `src/pages/admin/roles.astro`
  membuat gerbangnya **merah** dengan pesan yang menyebut nama tabelnya dan
  alternatifnya. Pesan yang berkata "tidak" tanpa berkata "pakai ini" adalah pesan
  yang dipuaskan orang dengan menambah pengecualian.

  `awcms_permissions` sengaja **tidak** termasuk: ia katalog global tentang apa
  sebuah permission ITU, tak membawa grant, dan dibaca migrasi seed serta picker
  admin yang tak ada urusannya dengan daftar ini. Daftar sepanjang itu adalah
  daftar yang tak dibaca siapa pun.

- 86f2a81: fix(gerbang): `api:tenant-route:check` berhenti buta terhadap 32 layar admin

  Ke-32 layar `src/pages/admin/**/*.astro` membuka `withTenantOrThrow` sendiri dan
  memutuskan akses dengan `ssr.permissions.has()` saja — PROJECT_STATE §4 **R3**.
  Mereka tak terlihat oleh `access:chokepoint:check` (root-nya `src/pages/api/v1`)
  **dan** tak terlihat di sini, karena root gerbang ini berhenti di `src/pages/api`.

  Gerbang ini sudah mencocokkan `withTenantOrThrow(` sejak awal. Ia hanya tidak
  pernah diarahkan ke direktori tempat ke-32 layar itu tinggal.

  `ROUTES_ROOT` tunggal menjadi `SCAN_ROOTS`, tiap root membawa ekstensinya sendiri
  (`.ts` untuk API, `.astro` untuk admin) dan kalimat perbaikannya sendiri — karena
  jawabannya berbeda: rute API harus memakai `defineTenantRoute`, sedangkan layar
  admin **belum punya** factory untuk dipakai. Ke-32 layar masuk `NOT_YET_MIGRATED`
  (236 entri, dari 204).

  **Ratchet, bukan migrasi.** `defineAdminScreen` belum ada — ia Gelombang 1 dari
  \#423. Nilainya adalah sejak commit ini sebuah layar admin BARU tidak bisa lagi
  menambah utang R3, berbulan-bulan sebelum utangnya sendiri dilunasi.

  Penjaga nol-berkas kini **per-root**. Total gabungan akan membiarkan satu root
  sehat menutupi root kedua yang memindai nol berkas — persis "OK yang ceria dan
  tak bermakna" yang diperingatkan header berkas ini, satu direktori kemudian.
  Diverifikasi dengan mutasi: mengarahkan root admin ke direktori yang tidak ada
  **merah**, dan mempertahankan root sambil mengganti ekstensinya juga **merah**.

  Angka di issue #424 tertulis 31; yang benar **32**. Glob `src/pages/admin/*.astro`
  melewatkan `src/pages/admin/tenant/domains.astro`, satu-satunya layar di
  subdirektori. `find -name "*.astro"` menemukannya, dan 32 cocok dengan hitungan
  R3 yang sudah tercatat.

  Nol perubahan runtime. Nol migrasi. Nol permission.

- bfccbbe: IP klien untuk rate limit dihitung dari **kanan** `X-Forwarded-For`, bukan dari
  kiri (#438).

  `resolveClientIp` membaca entri paling KIRI, dengan prasyarat yang ditulis
  sebagai prosa: sah "hanya bila proxy itu MENIMPA (bukan menambah)" header.
  Prasyarat yang tidak bisa diverifikasi operator dari dalam kode bukan kontrol,
  dan kegagalan yang diizinkannya total, bukan sebagian: di belakang proxy yang
  MENAMBAH — perilaku RFC 7239, dan yang dilakukan
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` milik nginx —
  penyerang mengirim `X-Forwarded-For: <acak>`, proxy menambahkan peer aslinya di
  kanan, entri paling kiri tetap apa pun yang diketik penyerang, dan tiap request
  mendarat di bucket baru. Itu persis bypass yang `TRUSTED_PROXY_ENABLED`
  diperkenalkan untuk menutup, dibuka kembali oleh topologi yang ia layani.

  Gradien kepercayaan header itu berjalan kanan-ke-kiri. Jadi klien adalah entri
  sejauh `TRUSTED_PROXY_HOP_COUNT` (baru, default `1`) dari kanan, dan tidak ada
  posisi yang bisa dijangkau penyerang yang pernah dibaca. Default `1` **identik
  byte** dengan perilaku lama untuk satu-satunya topologi yang pernah sah: proxy
  yang menimpa mengirim satu nilai, dan di sana paling-kiri = paling-kanan.

  Header yang lebih pendek dari rantai yang dideklarasikan jatuh ke
  `clientAddress` — merosot ke over-limit (semua berbagi bucket proxy), bukan ke
  no-limit. Nilai hop yang malformed jatuh ke `1`, tidak pernah ke `0`: nol akan
  mengindeks lewat tepi kanan dan diam-diam mematikan kepercayaan header pada
  deployment yang mengira sudah menyetelnya. `config:validate` menolak
  `TRUSTED_PROXY_HOP_COUNT` yang diset tanpa `TRUSTED_PROXY_ENABLED=true`.

  Ini **tidak** mengadopsi aturan `resolveAnalyticsClientIp`, yang menolak header
  multi-nilai dan mengembalikan `null`. Itu benar di sana — IP analitik yang
  hilang berharga satu baris presisi. Di sini tidak ada `null` untuk
  dikembalikan, dan menolak multi-nilai akan meruntuhkan setiap klien di belakang
  rantai 2-hop yang sah menjadi satu bucket: seluruh pengguna tenant terkunci
  oleh dua puluh password salah. Prinsip sama, fallback berbeda.

  Dibuktikan dengan mutasi: mengembalikan `parts[0]` memerahkan 7 test.

- 5dd40fb: docs(seo,modul): redirect legacy `/blog/{tenantCode}` → `/news` berhenti disebut INERT; tiga komentar kode yang membantah kodenya sendiri diperbaiki

  Ditemukan saat verifikasi adversarial atas ADR-0070, di luar cakupannya, jadi dikerjakan terpisah.

  **Yang paling mahal: sebuah saklar dinyatakan tidak berefek, padahal berefek.** Enam tempat menyatakan auto-redirect legacy "INERT in awcms — no `/news` route family". Itu benar saat [ADR-0039](docs/adr/0039-seo-distribution-redirect-governance.md) menulisnya. [ADR-0059](docs/adr/0059-host-resolved-public-content-routes.md) kemudian mendaratkan keluarga `/news/**` — `/news`, `/news/{slug}`, `/news/category/{slug}`, `/news/tag/{slug}` — dan **setiap tujuan yang bisa dihasilkan pemetaan ini sekarang resolve**. Rantainya utuh dan hidup: `src/middleware.ts` → `resolvePublicRedirectForRequest` → `resolvePublicRedirect` → `resolveLegacyBlogRedirect`.

  Kenapa ini bukan sekadar kalimat basi: `legacy_blog_redirect_enabled` tetap `DEFAULT false`, jadi tidak ada yang berubah bagi operator yang membiarkannya. Tetapi seorang operator yang membaca komentar itu akan menyalakannya **dengan keyakinan bahwa itu no-op** — dan yang ia dapat adalah 301 permanen atas lalu lintas `/blog/{tenantCode}` yang hidup. 301 di-cache browser dan perantara; ia tidak dibatalkan dengan mengembalikan kolomnya ke `false`. Menyalakannya adalah migrasi URL konten, bukan preferensi, dan itu yang sekarang dikatakan keenam tempat itu.

  `sql/060` sengaja TIDAK disunting: migrasi terapan itu immutable dan di-checksum `scripts/db-migrate.ts`, jadi menyunting komentarnya akan memerahkan setiap environment yang sudah menerapkannya. Koreksinya hidup di README modul, yang menyebutkan hal itu eksplisit supaya pembaca berikutnya tidak "memperbaiki" migrasinya.

  **Nol perubahan perilaku.** Tidak ada default yang berubah dan tidak ada gerbang yang bergeser — yang berubah adalah apa yang repo ini katakan tentang perilaku yang sudah berlaku sejak ADR-0059.

  Tiga komentar lain yang membantah kodenya sendiri:

  - **`idn-admin-regions/module.ts`** membuka dengan "No `navigation`" tepat di atas blok `navigation` yang ia deklarasikan. Komentarnya benar untuk jeda antara ADR-0052 (mencabut permukaan HTTP-nya) dan ADR-0053 (mengembalikannya di balik gerbang platform-scoped, dan layarnya mendarat bersamanya, PR #332).
  - **`module-management/domain/sidebar-menu.ts`** menyatakan modul itu tidak punya navigasi di repo ini "karena layar operatornya ada di awcms-astro, ADR-0047" — dua kesalahan dalam satu kalimat: pembagian itu ADR-0048, bukan ADR-0047, dan keputusannya sudah dicabut (ADR-0051 mengonsolidasikan layar admin SISTEM ke sini; ADR-0047 sendiri di-supersede ADR-0055).
  - **`tenant-domain` dan `visitor-analytics`** masih menyebut "PORT DEFERRAL" pada deskriptor modulnya. ADR-0055 §1 menutup jalur port, dan yang ditunda `tenant_domain` — keluarga rute konten host-resolved — justru sudah mendarat di `blog_content` sebagai `/news/**` (ADR-0059).

- 27e6074: docs(state,ci): `PROJECT_STATE` berhenti membantah kodenya sendiri; tiga job CI jadi required check

  **Ruleset `main only` naik dari 7 ke 10 required status check.** Tiga job
  `ci.yml` berjalan di setiap PR tanpa memblokir merge apa pun: `Integration tests
(RLS + DB role separation)`, `E2E smoke (Playwright)`, dan `Minimum-supported
versions (Bun 1.3.0 floor)`. Job `integration-tests` adalah **satu-satunya**
  tempat Postgres nyata dijalankan — isolasi RLS, pemisahan role DB, dan seluruh
  anggaran query hidup di sana — sementara job `quality` sengaja berjalan dengan
  `DATABASE_URL: ""`. Artinya required check yang ada **buta secara struktural**
  terhadap kelas itu: pelanggaran isolasi tenant memerahkan CI tanpa menahan
  merge, dan seluruh penalaran "gerbang X ada di rantai" hanya sekuat kebiasaan
  orang membaca CI merah.

  Biaya yang diterima dan dinyatakan, bukan disembunyikan: job integrasi menarik
  image Postgres dari Docker Hub, sehingga outage registry kini memblokir merge.
  Itu terjadi sekali pada 8 Agustus (run `31234082007`, tiga retry semuanya
  timeout) — satu kegagalan dari 14 run yang disampel, dan **bukan** kegagalan
  test. Empat jenis aturan ruleset lainnya diverifikasi tidak berubah.

  **Tiga klaim `docs/PROJECT_STATE.md` yang dibantah kode diperbaiki:**

  - §4 mencatat anggaran query sudah mendarat, lalu beberapa ratus baris kemudian
    masih menulis "dari 34 gerbang, satu memeriksa performa" dan "pembangun
    sitemap belum beranggaran" — padahal `query-budget-admin.integration.test.ts`
    sudah mencakupnya. Hitungan itu **tidak diperbarui melainkan dihapus**, diganti
    rujukan ke `standar-performa-dan-keamanan.md` §8 sebagai satu-satunya tempat ia
    dipelihara. Menduplikasi angka adalah penyebab basinya, bukan gejalanya.
  - "sebelas permission dari **43**" → **41**. `sql/089` mencabut
    `blog_content.seo.configure` dan `.posts.export` saat ADR-0058 mengosongkan
    daftar pengecualian. Diverifikasi lewat `listModules()`: 21 modul, 203
    permission, `blog_content` 41.
  - `posts.export` masih disajikan sebagai "absen yang digerbangi contract test".
    Ia tidak ada lagi untuk diabsenkan — dicabut justru karena tak ada endpoint
    yang menegakkannya.

  **Satu entri jebakan §6 diperkuat karena ia menyuruh memverifikasi hal yang
  tidak cukup.** "Subagent di working tree bersama bisa memindahkan HEAD →
  verifikasi `git branch --show-current`" — nama branch yang baru dibuat SELALU
  terlihat benar; yang harus diverifikasi adalah **commit induknya**. Ini terjadi
  pada 8 Agustus: PR #409 dibuat saat HEAD berada di branch sesi lain, membawa 32
  berkas alih-alih 10, dan merge-nya mendaratkan seluruh isi PR #408 ke `main`
  tanpa PR itu di-review. Gejala yang terlewat: pesan squash memuat pesan commit
  PR lain sebagai butir.

- 41ff13e: docs(kosakata): `/blog/**` di sini, `/news/**` di `awcms-astro` — ADR-0071 men-supersede ADR-0059

  [ADR-0070](docs/adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) menyatakan `awcms-astro` memikul halaman publik sebagai fungsi utama, tetapi §Konsekuensi-nya masih menyebut keluarga `/news/**` sebagai permukaan publik repo ini. Akibatnya kedua repo boleh melayani berita publik, pada dua alamat, dari satu sumber konten yang sama — dua jawaban untuk satu pertanyaan, dan pertanyaannya ditanyakan setiap kali sebuah deployment dibangun.

  **ADR-0071 membelah kosakata URL publik keluarga: satu keluarga rute per repo, dan tidak pernah keduanya di satu repo.** `/blog/{tenantCode}/**` di sini (path-scoped, ADR-0009); `/news/**` di `awcms-astro` (sebuah tab bernama `news` ber-`urutanSeksi: "terbaru"`, ADR-0033 repo sana).

  - **Yang dibelah URL, bukan kepemilikan konten.** Keduanya dilayani modul `blog_content` yang sama di sini, dan repo sebelah membacanya lewat `GET /api/v1/blog/posts` yang sudah dibekukan ADR-0065. Aturan cermin ADR-0070 §4 — tidak ada kemampuan yang hanya ada di sana — karena itu terpenuhi tanpa pekerjaan tambahan: tidak ada kemampuan yang **pindah**, yang pindah rendering halamannya.
  - **ADR-0059 di-supersede, tetapi dua keputusannya dinyatakan ULANG** supaya tidak ikut gugur: invarian §C (tenant yang mematikan permukaan publiknya mendapat sitemap **kosong**, bukan sitemap berisi tautan yang pasti 404) dan penolakan §E mendeklarasikan surface cache tepi host-resolved sebelum kunci per-host diverifikasi di VCL. Men-supersede mencabut seluruh keputusan sebuah ADR; kedua hal itu tidak boleh ikut tercabut diam-diam.
  - **Premis ADR-0061 §A gugur ke arah yang menguntungkan.** ADR itu menyimpulkan cache tepi "mempercepat bentuk warisan dan tidak menyentuh bentuk maju sama sekali" — benar, tetapi bersandar pada premis bahwa `/blog/{tenantCode}` sedang ditinggalkan. Ia kini kosakata permanen, dan ia path-scoped, jadi sudah bisa di-cache hari ini. ADR-0061 diberi banner, **tidak** di-supersede: analisisnya tetap benar untuk rute discovery root, yang adalah mayoritas isinya.

  Yang hanya terasa saat mengembangkan:

  - **Ada jendela nyata antara aturan ini dan kodenya, dan ia digerbangi.** Empat rute masih ada di `src/pages/news/` dan `publicRouteMode` masih `domain_default` — artinya `/news/**` **menyala** untuk setiap tenant yang tidak mematikannya. `tests/url-vocabulary-split.test.ts` mengikat penanda §4 pada keberadaan rutenya **dua arah**: rute ada → ADR wajib berkata BELUM; rute hilang → wajib berkata SUDAH, pada PR yang sama.
  - **Kualifikasi `Accepted (belum diimplementasikan)` tidak bisa dipakai, dan itu informatif.** Gerbangnya mengikat kualifikasi pada **keberadaan** artefak yang dijanjikan (absen → berkualifikasi, ada → polos). ADR ini menjanjikan sebuah **penghapusan**, jadi arahnya terbalik, dan aturan (d) gerbang itu melarang kualifikasi dipakai di luar petanya. Karena itu §4 mendapat gerbangnya sendiri: disiplin dua arah yang sama, untuk bentuk janji yang berlawanan.
  - **PR implementasinya wajib membawa 301, bukan 404.** URL `/news/**` sudah diiklankan sitemap dan feed repo ini; mematikannya tanpa penerus adalah biaya SEO yang dibayar pembaca. Ia juga wajib **mematikan auto-redirect legacy** `/blog/{tenantCode}` → `/news`, yang arahnya terbalik di bawah aturan ini — ia akan mengirim lalu lintas ke keluarga yang repo ini tidak lagi layani.
  - **Penanda §4 memakai prefiks yang kebal prosa.** Draf pertama mencocokkan kata telanjang dan menghitung DUA: daftar langkah §4 sendiri menyuruh implementernya membalik penanda itu, jadi ia mengeja keadaan tujuannya. Penanda status yang bisa dijatuhkan instruksinya sendiri adalah penanda yang melaporkan kata-katanya, bukan keadaannya.

  **Nol perubahan kode berjalan.** Modul `blog_content`, kontrak ADR-0065, seluruh layar admin, dan setiap izin tetap persis seperti sebelumnya.

- c22e88a: fix(auth): penghitung lockout login dinaikkan di dalam SQL — K percobaan paralel berhenti berbiaya satu increment

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
  Redis mati pada kalimat _"per-identity lockout is enforced in PostgreSQL,
  atomically"_. Saat Redis mati, kontrol yang tersisa justru yang bisa dikalahkan
  dengan mengirim percobaan berbarengan. Kalimat itu dan dua salinannya di
  `docs/awcms/standar-performa-dan-keamanan.md` diperbaiki, keduanya kini
  **menyebut statement-nya** alih-alih kata "atomik" — kata itulah yang tetap
  tampak benar sementara mekanismenya tidak.

  `.claude/skills/awcms-security-hardening/SKILL.md` diperbaiki dua tempat. Salah
  satunya berbunyi _"atomik di DB (CAS/`FOR UPDATE`, bukan read-modify-write JS)"_
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

- 4dfa4df: fix(typecheck): kode mati berhenti lolos ke `main` — `tsc` menolak local & parameter tak terpakai

  CodeQL alert #147 (`js/unused-local-variable`) melaporkan impor mati
  `MEDIA_PERMISSIONS` di `src/pages/api/v1/media/objects/index.ts` — di `main`,
  seminggu setelah ia merge. Tidak ada satu pun dari 34 gerbang rantai `check`
  yang bersuara: `lint` adalah `prettier --check` yang memformat dan tidak pernah
  menganalisis, dan repo ini tidak memakai ESLint/oxlint. `tsc` sudah berjalan di
  setiap PR dan akan menangkapnya dalam hitungan detik, tetapi `tsconfig.json`
  meng-`extends` `astro/tsconfigs/strict`, sementara `noUnusedLocals` dan
  `noUnusedParameters` berada satu tingkat di atas di `strictest`. Repo sudah
  memetik `noUncheckedIndexedAccess` dan `noImplicitOverride` dari `strictest`;
  dua ini sekadar tidak ikut terbawa.

  Menyalakan keduanya memunculkan temuan kedua yang TIDAK dilaporkan CodeQL:
  flag `timedOut` di `src/lib/jobs/job-runner.ts`, ditulis oleh timer timeout job
  dan tidak pernah dibaca, bersebelahan dengan klasifikasi status yang justru
  menyimpulkan `"timeout"` lewat eliminasi (`terminatedBy ? "terminated" :
"timeout"`). Flag itu dihapus, dan invarian yang membuat eliminasi tersebut
  sahih kini ditulis eksplisit di tempatnya: `controller` tidak pernah keluar dari
  fungsi kecuali sebagai `signal` read-only, jadi hanya ada dua pemanggil
  `abort()`. Sumber abort ketiga wajib mengembalikan klasifikasi menjadi positif —
  kalau tidak, abort-nya akan tercatat di log job sebagai timeout yang tak pernah
  terjadi.

  Perubahan perilaku: tidak ada. `timedOut` tidak pernah dibaca, sehingga
  menghapusnya tidak dapat mengubah status job mana pun; dua parameter di
  `seo-distribution/application/redirect-resolution-service.ts` hanya diberi
  awalan garis bawah karena kedua strategi redirect sengaja berbagi satu
  signature (`resolveLegacyBlogRedirect` mengenali tenant dari PATH, bukan dari
  HOST). Yang berubah adalah kelas cacat ini sekarang gagal secara lokal dan di
  PR, bukan muncul sebagai alert keamanan mingguan setelah mendarat.

  `tests/typecheck-unused-code-gate.test.ts` menjaga keduanya — setelan compiler
  dapat dihapus dalam commit yang sama dengan galat yang mengganggu seseorang,
  tanpa sinyal apa pun. Kedua sisi diuji karena masing-masing inert sendirian:
  flag tak berarti bila tidak ada perintah yang menjalankan `tsc`, dan
  menjalankan `tsc` tak membuktikan apa pun bila flag-nya hilang.

- 7448c6d: Tiga layar admin pertama melewati chokepoint (#450, R3): `audit-trail`,
  `profiles`, `email-templates`.

  Ketiganya kini memutuskan lewat `authorizeInTransaction` dan membaca di dalam
  transaksi yang sama, jadi policy `deny` ABAC tenant, ketersediaan modul, fakta
  business-scope, SoD, dan `recordDecisionLog` berlaku pada jalur BACA-nya. Pada
  `audit-trail` itu punya bentuk yang enak disebut: **pembacaan jejak audit kini
  ikut teraudit.**

  `canCreate` di `profiles` dan `email-templates` juga diputuskan chokepoint lewat
  `can()` alih-alih diambil dari set grant mentah — jadi `deny` tenant
  menyembunyikan formulirnya, bukan sekadar menggagalkan POST di baliknya.

  Dua cabang mati ikut hilang: `profiles` dan `email-templates` memeriksa
  `result instanceof Response` terhadap `withTenantOrThrow`, yang tidak pernah
  mengembalikan `Response` — ia melempar.

  Ledger `access:chokepoint:check` 31 → **28**, dan ledger `api:tenant-route:check`
  ikut menyusut tiga baris; dua gerbang menghitung utang yang sama dari dua sudut
  dan bergerak bersama.

  Satu test yang saya tulis di PR fondasi ikut diperbaiki: ia mematok "31 layar
  memutuskan, 1 memakai chokepoint" — dua angka yang berubah tiap PR migrasi dan
  melatih penulis berikutnya untuk mengedit angka alih-alih membacanya. Diganti
  identitas yang berlaku di SETIAP titik migrasi: ledger memuat semua-dan-hanya
  layar yang masih bypass.

- 69714a5: docs(kosakata,gerbang): `/news/**` berhenti hidup di dokumen yang paling banyak dibaca — dan gerbangnya berhenti bisa dibohongi berkas `.astro`

  [ADR-0071](docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
  membelah kosakata URL publik — `/blog/**` permanen di repo ini, `/news/**` milik
  `ahliweb/awcms-astro` — dan §4-nya sudah berbunyi **SUDAH DILAKSANAKAN**:
  `src/pages/news/` tidak ada, `withHostResolvedBlogTenant` dan `publicRouteMode`
  hanya tersisa sebagai komentar sejarah.

  Dokumennya belum menyusul, dan yang paling parah justru yang paling banyak
  dibaca:

  - **`AGENTS.md`** — berkas **pertama yang dibaca setiap agen** — masih memuat
    blockquote "**Jendela yang masih terbuka**" yang menyatakan keempat rute
    "MASIH ADA di `src/pages/news/`" dan **MENJADWALKAN** penghapusannya, sambil
    menyebut `tests/url-vocabulary-split.test.ts` sebagai penegak jadwal itu.
    Sebuah jadwal untuk pekerjaan yang sudah selesai membuat pembaca berikutnya
    mencari berkas yang tidak ada lalu menyimpulkan repo-nya rusak — atau
    membangun ulang keluarga rute yang **dilarang tiga paragraf di atasnya**.
  - **`docs/ARCHITECTURE.md`** — "Rute `/news/**` host-resolved kini **SUDAH
    ada**".
  - **`docs/PROJECT_STATE.md`** — entri "Rute publik host-resolved — SELESAI"
    berada di bawah heading **"Yang sudah selesai (jangan dibangun ulang)"**.
  - **`docs/awcms/standar-performa-dan-keamanan.md`** — baris §11 masih
    membingkai "kapan memakai `awcms-astro` alih-alih rute publik `awcms`"
    sebagai pilihan per situs.
  - **`.claude/skills/awcms-blog-content/SKILL.md`** — frontmatter mengiklankan
    "**DUA keluarga rute publik**", dan badannya menyatakan Issue #560 "menambah
    `src/pages/news/` (7 `APIRoute` paralel)". Skill DIIKUTI, bukan sekadar
    dibaca.

  Semuanya ditulis ulang **per konteks**, bukan dengan `sed` seragam — dan dua
  kutipan yang sengaja dipertahankan (agar catatan "apa yang dulu dipercaya" tidak
  hilang) dipagari penanda `<!-- historis:mulai -->`/`<!-- historis:selesai -->`.

  **Dan gerbangnya sendiri punya dua lubang.**

  1. **Ia hanya membaca ADR + filesystem, tak pernah dokumen.** Kelima klaim di
     atas lolos aturan (a)–(d) tanpa satu pun memerah. Aturan **(e)** menutupnya:
     selama rutenya tidak ada, dokumen **current-state** tidak boleh menyatakan
     keluarga itu ADA. Deteksinya **sempit dengan sengaja** — sebuah token
     (`src/pages/news`, `publicRouteMode`, `withHostResolvedBlogTenant`,
     `/news/**`) hanya memerah bila berdampingan dengan **frasa klaim keberadaan**
     dalam jarak 160 karakter. Larangan token telanjang akan memerahkan kalimat
     yang justru BENAR — README dan descriptor `blog_content` menyebut ketiganya
     persis untuk mengatakan bahwa mereka hilang, dan itu teks yang paling
     dibutuhkan pembaca. Gerbang yang memerah pada prosa benar melatih pembacanya
     melemahkannya; `skills:check` butuh tiga draf untuk belajar itu.
     Korpusnya ditulis eksplisit dan **tidak** melebar ke seluruh `docs/awcms/`
     (§10 sudah menolaknya); ADR sengaja **di luar** korpus — ADR-0059 memang
     harus tetap berkata `/news/**` ada, itu catatan keputusan pada satu waktu.
  2. **Ia mengikat EMPAT NAMA BERKAS, bukan direktori.** `NEWS_ROUTE_FILES`
     mendaftar `index.ts`/`[slug].ts`/`category/[slug].ts`/`tag/[slug].ts`, jadi
     sebuah `src/pages/news/index.astro` — rute yang sama, ekstensi yang justru
     lebih lazim untuk halaman Astro — menghidupkan kembali keluarga itu tanpa
     satu pun asersi bergerak. **Diverifikasi terhadap gerbang LAMA, bukan
     disimpulkan:** menaruh berkas satu baris di sana meninggalkannya di
     **9 pass / 0 fail**. Kini ia memindai direktorinya.

  Mutation-proven keduanya: mengembalikan teks AGENTS.md hari ini → MERAH
  menyebut `AGENTS.md:98`; menaruh `src/pages/news/index.astro` → MERAH menyebut
  berkasnya.

  Proksimitas 160 karakter itu sendiri lahir dari satu false positive nyata:
  pemasangan token↔frasa se-BARIS memerahkan baris skill sepanjang **1.721
  karakter**, di mana "sudah ada" (tentang helper iklan/widget) duduk ~300
  karakter dari sebutan `src/pages/news` yang tak berhubungan. Vonisnya kebetulan
  benar tentang berkasnya dan salah tentang alasannya — jenis yang paling buruk,
  karena ia mengajari pembaca bahwa pesan gerbang tak bisa dipercaya.

  Nol perubahan kode produksi. Tiga entri surface cache tepi `news-*` yang kini
  inert dan komentar `surface-registry.ts` yang menyertainya **sengaja tidak
  disentuh di sini** — itu perubahan kode dengan pemeriksanya sendiri, dan
  dikerjakan sebagai unit terpisah.

- 26334bd: Backup/restore PostgreSQL, manifest crontab 22 job terjadwal, dan timeout migrasi yang tak bisa dilupakan operator: tiga perkakas yang selama ini hanya disebut dokumen kini benar-benar ada.
- 808df00: fix(admin,auth): panel sesi yang tak bisa ditutup di ponsel, dan body yang dibaca di dalam transaksi

  Dua cacat dari review terhadap PR yang mendarat hari ini (#496, #498). Keduanya
  hijau di seluruh 38 gerbang, dan keduanya hanya terlihat dengan membaca dua
  berkas bersamaan.

  **1. `<tr hidden>` TIDAK tersembunyi di dalam tabel stacked.** `admin.css`
  mengubah tiap baris `.data-table--stack` menjadi kartu di bawah `--bp-md`
  lewat `.data-table--stack tr { display: block }`. Selektor itu berspesifisitas
  (0,1,1); aturan user-agent yang membuat atribut `hidden` bekerja —
  `[hidden] { display: none }` — berspesifisitas (0,1,0). Aturan author menang,
  jadi `hidden` **diam-diam berhenti menyembunyikan**, dan berhentinya persis di
  layout yang tak diperiksa siapa pun lebih dulu.

  Akibatnya bukan kosmetik seperti kedengarannya: baris detail yang tak bisa
  menutup akan me-render isinya untuk **setiap** baris tabel sekaligus, dan tombol
  yang seharusnya membukanya tidak melakukan apa pun yang terlihat. Panel sesi di
  `/admin/users` mendarat dengan persis itu.

  Perbaikannya `.session-panel-row[hidden] { display: none }` — (0,2,0), menang
  dua arah — dan **di luar** media query, karena media query tak menambah
  spesifisitas sehingga satu aturan meliputi kedua layout.

  Test regresinya menegakkan sifat UMUM, bukan satu berkas: tiap layar admin yang
  memakai tabel stacked **dan** menyembunyikan baris dengan atribut `hidden` wajib
  membawa aturan `[hidden] { display: none }`-nya sendiri. Draf pertamanya
  **dipuaskan oleh komentar CSS-nya sendiri** yang mengutip aturan itu verbatim —
  mutasi yang MENGHAPUS perbaikannya tetap hijau. Komentar kini dibuang sebelum
  pencocokan; ini kali keenam bentuk itu muncul di repo ini, dan selalu
  PERBAIKAN-lah yang menanam false positive, karena sebuah perbaikan menjelaskan
  apa yang ia hapus.

  **2. `POST /auth/password/change` membaca body di DALAM transaksi.**
  `await request.json()` menunggu **klien**. Melakukannya di dalam `withTenant`
  menahan satu koneksi pool tercadang — berikut slot work-class-nya — selama
  pemanggil memilih untuk mengirim body-nya, sehingga satu permintaan lambat
  menjadi koneksi yang ditahan terhadap setiap permintaan lain di pool.
  `queueTimeoutMs` membatasi **memperoleh** koneksi, tak pernah **menahan**-nya.

  `defineTenantRoute` punya `prepare` justru untuk ini; seam self-service tidak
  punya, jadi rutenya tak punya tempat lain. Seam-nya kini punya `prepare` yang
  sama bentuknya — penambahan murni, nol call site berubah. `beforeTransaction`
  tidak bisa mengerjakannya: ia hanya mengembalikan `Response | undefined`, jadi
  body yang di-parse di sana tak punya tempat tujuan dan harus di-parse dua kali.

  Asersinya **posisional**, bukan "apakah muncul": `prepare` dan `handler`
  sama-sama menyinggung body dengan satu atau lain cara, dan pertanyaannya adalah
  di sisi mana batas transaksi pembacaan itu berada.

- 9e89c63: Rate limit permukaan auth publik mendapat plafon per-SUMBER yang kuncinya tidak
  bisa dipilih penyerang (#447).

  Tujuh rute tak-terautentikasi mengunci bucket-nya pada `${clientIp}:${tenantId}`,
  dan `tenantId` adalah header `x-awcms-tenant-id` mentah — tidak divalidasi, tidak
  dicari. Pemeriksaan pertama terjadi di dalam `withTenant`, jauh setelah limiter
  memutuskan. Jadi kunci bucket-nya **dipilih penyerang**: UUID acak yang berbeda
  per request memberi bucket segar setiap kali, dan limiternya tidak mengikat sama
  sekali — bukan "N kali lebih longgar" seperti yang ditulis #430.

  Yang membuatnya mahal, bukan sekadar berantakan: `verifyPasswordOrDummy`
  menjalankan argon2id `m=64MB` bahkan saat identifier tidak resolve (Issue #147,
  dan itu benar — ia yang menghentikan endpoint ini jadi oracle enumerasi). Tiap
  request yang lolos berharga 64 MiB plus CPU-nya. Docblock limiternya sendiri
  menyebut skenario itu sebagai hal yang ia ada untuk mencegahnya.

  **Bukan** diperbaiki dengan memvalidasi header lebih awal: UUID acak adalah UUID
  yang valid, dan memeriksa keberadaan tenant sebelum kerja password justru
  memasang oracle enumerasi TENANT — persis selisih waktu yang desain dummy-hash
  hilangkan untuk identitas. Yang mengikat adalah plafon yang kuncinya tidak bisa
  dipilih: satu bucket per SUMBER (`clientIp` saja), diperiksa berdampingan dengan
  bucket per-tenant yang sudah ada, **di dalam satu fungsi** supaya rute tidak bisa
  mengambil separuhnya. Plafon sumber diperiksa lebih dulu: menghabiskan slot
  per-tenant untuk request yang akan ditolak plafon sumber akan membiarkan lalu
  lintas penyerang mengisi bucket tenant nyata — mengubah bypass menjadi DoS
  terhadap pengguna tenant itu.

  `AUTH_SOURCE_RATE_LIMIT_MAX` (default 60) wajib ≥ `AUTH_LOGIN_RATE_LIMIT_MAX`,
  ditegakkan `config:validate`. Itulah yang membuat perubahan ini **terbukti inert
  pada deployment satu tenant** — di sana bucket per-tenant selalu penuh lebih
  dulu — dan karenanya bisa mendarat tanpa flag.

  Rute ketujuh (`sso/[providerKey]/start.ts`) tidak ada di daftar issue-nya; test
  strukturalnya yang menemukannya setelah enam pertama dikonversi tangan.

- 497aaef: docs(state): putaran kelima 11 Agustus — Gelombang 4 selesai

  `docs/PROJECT_STATE.md` §4 mencatat putaran ini: apa yang mendarat (ADR-0082,
  #512, #513), empat tempat rencana program tidak diikuti beserta alasannya yang
  diperiksa terhadap kode, dua cacat yang ditemukan dengan MENJALANKAN bukan
  membaca, tujuh penolakan, dan satu batas gerbang yang wajib dibaca sebelum
  config module berikutnya memakai pola `env: NodeJS.ProcessEnv = process.env`.

  Daftar ini ada DI SINI karena aturan yang sama dengan empat putaran sebelumnya:
  daftar yang tidak ditulis ke repo harus diturunkan ulang, dan menurunkan ulang
  berharga satu audit penuh sementara menuliskannya berharga satu paragraf.
  Penolakan ikut tertulis, karena penolakan yang tidak tercatat akan diusulkan
  lagi.

  `src/modules/identity-access/README.md` mendapat bagian Undangan. README modul
  adalah dokumen current-state yang menjelaskan setiap fitur lain modul ini;
  membiarkan permukaan sebesar ini tak tertulis di sana adalah bentuk penuaan yang
  persis dikeluhkan ADR-0062 tentang skill — dengan bedanya README dibaca, bukan
  diikuti.

- 3a6f3c0: docs(state): putaran rekomendasi 8 Agustus 2026 dicatat sebagai titik-lanjut, bukan sebagai pesan commit

  Putaran ini dimulai dengan **menurunkan ulang** daftar rekomendasi putaran
  sebelumnya, karena daftar itu tidak pernah ditulis ke repo: lima PR yang mendarat
  darinya (#411–#415) hanya bisa dibaca ulang dari pesan commit-nya, dan
  scratchpad sesi yang memuat peringkatnya sudah hilang.

  Menuliskan daftarnya di §4 adalah harga satu paragraf; menurunkannya ulang adalah
  harga satu audit penuh (enam sumbu, verifikator skeptis, 24 temuan bertahan).

  Dicatat: enam yang mendarat (R1 eskalasi `owner`, R2 36 test DB-gated
  hijau-palsu, R4 `/news/**` di dokumen + surface cache inert, R5 aturan 5
  `skills:check`, R6 gerbang cakupan layar admin) dengan nomor PR dan angka
  hasilnya, empat yang tersisa (R3 layar admin melewati ABAC saat MEMBACA, R7
  permukaan tanpa layar, R8 permission platform lewat editor role, R9 lima gerbang
  buta, R10 status C7/RUM) dengan bukti ringkas masing-masing, dan **empat usulan
  yang DITOLAK beserta alasannya** — karena penolakan yang tidak tertulis akan
  diusulkan lagi enam bulan kemudian, aturan yang §9 dokumen standar sudah pakai
  untuk barisnya sendiri.

- 2e749fd: docs(reporting): descriptor berhenti menjanjikan "derived applications" — jalur itu dicabut ADR-0034

  String `description` descriptor `reporting` berbunyi "Derived applications add
  their own domain-specific reporting views (and may contribute their own
  projection descriptors via `reportingProjections`) on top of this base."

  [ADR-0034](docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  **menghapus jalur aplikasi-turunan seluruhnya** — tidak ada lagi
  `src/modules/application-registry.ts`, `extension:check`, namespace migrasi
  `900+`, maupun manifest kompatibilitas turunan; `ModuleType` valid tinggal
  `base | system | domain | integration`. `docs/PROJECT_STATE.md` §1 menyatakan
  eksplisit bahwa dokumen yang masih menyebut jalur itu sebagai jalur aktif adalah
  **usang**.

  Ini bukan komentar: `description` adalah yang dibaca `listModules()` dan tampil
  di layar Module Management, jadi operator membacanya sebagai penjelasan cara
  memperluas sistem — ke arah yang tidak ada. Diganti dengan mekanisme yang
  benar-benar berlaku: modul domain ditambahkan **langsung** di `src/modules/`.

  **Temuan yang lebih besar dan SENGAJA tidak disapu di sini:** rujukan ke jalur
  turunan yang sama masih ada di **24 berkas lain** di `src/` (~29 situs), semuanya
  komentar kode — `identity-access/application/access-guard.ts`,
  `workflow-approval/infrastructure/condition-action-registry.ts`,
  `_shared/ports/business-scope-hierarchy-port.ts`, `sync-storage/domain/sync-conflict.ts`,
  dan seterusnya. Semuanya menjelaskan **siapa yang menyediakan adapter/entri** di
  sebuah seam ekstensi, jadi masing-masing butuh kalimat pengganti yang benar
  menurut konteksnya, bukan `sed` seragam — dan penyapuan buta atas 25 berkas
  adalah cara melahirkan 25 kalimat yang salah dengan percaya diri. Dikerjakan
  sebagai unit sendiri, dengan hitungannya dicatat di sini supaya tidak hilang.

- ac46b63: docs(src): 23 rujukan ke jalur aplikasi-turunan yang ADR-0034 hapus, ditulis ulang per konteks

  [ADR-0034](docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  menghapus jalur aplikasi-turunan seluruhnya — tidak ada lagi
  `src/modules/application-registry.ts`, `extension:check`, namespace migrasi
  `900+`, maupun manifest kompatibilitas turunan. `docs/PROJECT_STATE.md` §1
  menyatakan eksplisit bahwa dokumen yang masih menyebutnya sebagai jalur aktif
  adalah **usang**. Toh 29 situs di `src/` masih menyebutnya, dan hampir semuanya
  menjawab pertanyaan yang paling sering ditanyakan pembaca sebuah seam: **siapa
  yang menyediakan adapter/entri di sini?** — dengan jawaban yang tidak ada.

  23 ditulis ulang menjadi mekanisme yang benar-benar berlaku: **modul domain yang
  ditambahkan langsung di `src/modules/`**. Beberapa butuh kata yang berbeda karena
  konteksnya memang berbeda, dan itulah alasan ini tidak dikerjakan dengan `sed`:

  - `metrics-port.ts` / `prometheus-text-adapter.ts` — yang memasang adapter
    observability adalah **deployment** lewat composition root, bukan modul.
  - `family-contract.ts` — yang bisa dirusak perubahan MAJOR adalah **konsumen**
    kontrak keluarga (mis. `ahliweb/awcms-astro`), bukan "aplikasi turunan".
  - `logger.ts` baris kedua — "A derived app's sink" → "A registered sink":
    kalimatnya tentang sink mana pun yang terdaftar, bukan tentang siapa
    mendaftarkannya.
  - `email-template-categories.ts` — namespace `derived.*` dan fungsi
    `registerDerivedEmailTemplateCategory` adalah **identifier nyata di kode** dan
    TIDAK diubah; hanya prosa di sekitarnya.

  **Enam situs sengaja DIBIARKAN karena benar secara historis**, dan menghapusnya
  justru akan menghilangkan catatan kenapa jalur itu tidak ada:

  - `module-contract.ts` changelog `2.0.0` — ia menamai pencabutannya.
  - `business-scope-hierarchy-port.ts` (3 situs) — mengutip judul issue #180 dan
    menjelaskan bahwa resolver itu "permanently unfillable once ADR-0034 deleted
    that pathway". Prosa itu sudah tepat.
  - `email-template-categories.ts` — kutipan teks issue.
  - Satu catatan penanda yang ditambahkan perubahan ini sendiri.

  Nol perubahan perilaku: seluruhnya komentar dan satu baris JSDoc. Menyusul PR
  sebelumnya yang memperbaiki string `description` descriptor `reporting` — satu
  situs yang BUKAN komentar, karena `listModules()` membacanya dan ia tampil di
  layar Module Management.

- f9ae9c0: fix(identity-access): sensus principal menjawab kategori ketiganya — dan berhenti mengklaim sesuatu yang salah

  `bun run identity:principals:preflight` adalah langkah pertama #430 dan
  prasyarat Gelombang 7. Ia menghitung dua dari tiga kategori yang diminta
  issue-nya: tabrakan di dalam satu tenant, dan identifier yang bukan email.
  Kategori ketiga — **identitas yang tidak bisa dikirimi surat** — hilang.

  Yang lebih penting: docblock-nya **mengklaim** kategori kedua sudah menjawab
  kategori ketiga, dengan kalimat _"ia tidak akan pernah bisa menerima undangan
  maupun reset password"_. Itu **tidak benar**.

  Kedua predikatnya berbeda, dan berbeda di **dua arah**:

  - `looksLikeEmail` (sensus) menuntut titik di domain dan menolak spasi;
  - `isMailableLoginIdentifier` (yang benar-benar dipakai jalur reset password)
    hanya menuntut `@` dengan bagian kiri dan kanan tak kosong.

  Jadi `a@localhost` **bukan email** menurut sensus tetapi **bisa dikirimi surat**
  menurut kode yang mengirimnya — dan sensus melaporkan satu himpunan sambil
  menjelaskan himpunan lain. Itulah cara sebuah sensus menyesatkan migrasi yang ia
  ada untuk menurunkan risikonya.

  Perbaikannya **mengimpor** `isMailableLoginIdentifier`, bukan menyalin bentuknya.
  Ejaan kedua untuk "bisa dikirimi surat apa tidak" adalah kelas cacat yang sudah
  mahal di repo ini: sensus melaporkan satu himpunan, kode pengirim bertindak atas
  himpunan lain, dan keduanya terlihat benar bila dilihat sendiri-sendiri.

  Dibuktikan **merah** dengan mengganti impor itu kembali menjadi salinan:
  `a@localhost` adalah kasus yang membedakan keduanya, dan tanpa impornya test itu
  gagal.

  Kedua temuan tetap **advisory** — `clear` tetap terikat hanya pada tabrakan
  di dalam satu tenant. Sebuah advisory yang memblokir akan mengubah sensus
  menjadi gerbang, dan sensus yang menolak selesai tidak memberi tahu apa pun
  tentang sisa estate-nya.

  Tidak menutup #430: itu soal **keying**, dan perbaikannya principal global di
  Gelombang 7. Ini melengkapi langkah read-only yang issue-nya sebut sebagai
  miliknya.

- 3edcd7d: feat(identity): `identity:principals:preflight` — sensus read-only menjelang principal global

  Prasyarat Gelombang 7 dari program model keanggotaan, dan sengaja mendarat
  **berbulan-bulan** sebelum migrasinya.

  `awcms_identities` UNIQUE pada `(tenant_id, login_identifier)`; sebuah principal
  UNIQUE pada alamat ternormalisasi. Dua baris di **satu** tenant yang hanya beda
  huruf besar-kecil atau spasi adalah **legal hari ini** dan **mustahil** sesudahnya
  — dan perbaikannya tidak pernah berupa patch. Ia percakapan dengan pelanggan
  tentang akun mana yang orangnya dan mana yang duplikat.

  Percakapan itu tidak bisa terjadi di dalam jendela migrasi. Menjalankan sensus
  ini lebih awal mengubah migrasi-yang-batal menjadi dukungan-pelanggan-terjadwal.

  Normalisasinya **sengaja konservatif**: huruf kecil + trim, tidak lebih. Bukan
  normalisasi yang diterapkan penyedia email — tanpa buang titik, tanpa buang
  `+tag`, tanpa lipat Unicode. Masing-masing menggabungkan alamat yang di sebagian
  penyedia adalah **orang yang berbeda**, dan penggabungan tak bisa dipulihkan
  sementara laporan tabrakan bisa. Tugas sensus adalah menemukan apa yang akan
  ditolak migrasinya, jadi ia menerapkan persis aturan itu dan tidak lebih.

  Dua kelas temuan, dan hanya satu memblokir. **Tabrakan dalam satu tenant** →
  memblokir. **Identifier bukan email** → advisory: ia tetap menjadi principal,
  hanya tidak akan pernah bisa menerima undangan atau reset password.

  Yang **tidak** dilaporkan sebagai masalah: alamat yang sama di **dua** tenant.
  Itu justru yang dimungkinkan migrasinya — menandainya berarti melaporkan
  fiturnya sebagai cacat.

  Read-only, per-tenant, di role `awcms_app` biasa (`withTenantOrThrow`) — jadi
  tanpa kredensial owner. Sound secara konstruksi untuk temuan yang memblokir:
  tabrakan dalam-satu-tenant menurut definisinya ada di dalam satu tenant.

  Keluar dengan kode 0 **meskipun tidak bersih**: ini sensus, bukan gerbang. Ia
  melaporkan keadaan DATA, yang bukan regresi siapa pun dan bukan milik pipeline
  mana pun; exit non-nol akan menyangkut sesuatu yang bukan tempatnya, atau
  mengajari orang mengabaikannya. Migrasi Gelombang 7 yang menolak, dengan keras,
  di titik ketika menolak adalah jawaban yang benar.

- 26334bd: fix(seo): sitemap berhenti membuang senyap setiap URL setelah yang ke-200

  Tenant dengan lebih dari 200 post kehilangan sisanya dari `/sitemap-{n}.xml` —
  tanpa error di mana pun. Index tetap mengiklankan `ceil(count / 10 000)` anak,
  tiap anak tetap balas `200 OK` dengan XML yang valid, dan satu-satunya gejala
  adalah halaman yang tak pernah muncul di mesin pencari berminggu-minggu
  kemudian.

  Sebabnya dua angka yang tak pernah dipertemukan. `discovery-limits.ts`
  menetapkan `SITEMAP_URLS_PER_PAGE = 10000` dan `buildSitemapPagePayload`
  memintanya ke provider dalam **satu** panggilan; `blog-content`
  (`seo-facts-port-adapter.ts`) menjepit `pageSize` ke 200. `listWindow` membaca
  `page.items` sekali lalu berhenti.

  **`pageSize` itu PERMINTAAN, bukan jaminan.** Itu tertulis di port sejak awal —
  tiap provider boleh menjepitnya — dan halaman terjepit tidak bisa dibedakan dari
  halaman yang memang habis, **kecuali** lewat `nextCursor`. Kode lama tidak
  pernah melihat `nextCursor` di jalur ini, jadi 200 baris pertama tampak seperti
  seluruh korpus.

  Perbaikannya menyerang keduanya:

  - `listProviderSlice` baru **memaging** `nextCursor` sampai jatah satu halaman
    anak terpenuhi atau providernya habis. Cursor diperlakukan **opaque**:
    dikembalikan apa adanya, tak pernah di-parse, di-encode ulang, apalagi
    dilewatkan `Date` — cursor keyset di repo ini membawa `timestamptz`
    presisi-penuh (mikrodetik) sementara `Date` hanya milidetik, jadi satu
    round-trip saja melewatkan tiap baris di dalam mikrodetik yang terpotong.
    Itu kelas cacat yang **sama persis** dengan yang sedang diperbaiki di sini,
    cuma sumbernya lain.
  - `SITEMAP_URLS_PER_PAGE` turun ke **1000** — disetel terhadap apa yang port
    memang sanggup layani (5 permintaan × 200), bukan terhadap plafon protokol
    50k. `SEO_FACTS_PROVIDER_PAGE_SIZE = 200` menamai ukuran yang provider hormati,
    dan `SITEMAP_PROVIDER_REQUESTS_PER_PAGE = 50` membatasi jalannya cursor supaya
    provider yang menjepit sangat rendah (atau yang mengembalikan cursor tanpa
    henti) berharga sejumlah query tetap, bukan loop tak terbatas — pertahanan
    amplifikasi ADR-0038 §7 tidak dikendurkan untuk menambal ini.
  - `offset` kini hanya menempatkan permintaan **pertama** sebuah slice; sisanya
    ditempatkan cursor sendirian. Mengirim keduanya akan melompat ganda pada
    provider yang menghormati masing-masing secara independen — port memang
    memenangkan `cursor`, tapi kebenaran satu slice tak boleh bergantung pada
    tie-break itu.

  Bonus yang ikut tertutup: window yang membentang **dua provider** dulu juga
  memotong ekor provider pertama, karena `remaining` hanya berkurang sebanyak
  halaman terjepit sebelum pindah ke provider berikutnya.

  `BLOG_CONTENT_SEO_MAX_LIST_PAGE_SIZE` kini diekspor, jadi sisi konsumen bisa
  meng-assert anggaran permintaannya terhadap **angka provider yang sebenarnya**,
  bukan salinannya — menurunkan jepitan itu memerahkan test alih-alih diam-diam
  memotong sitemap lagi.

  Regresinya dibuktikan, bukan diklaim (`tests/seo-sitemap-window-paging.test.ts`,
  korpus 201 dan 1201 entri): mengembalikan window satu-permintaan yang lama
  membuatnya **MERAH** dengan `Expected: 201, Received: 200` — persis satu entri
  yang hilang. Providernya palsu tapi jujur pada dua hal yang menentukan: ia
  menjepit `pageSize`, dan ia mencari cursor lewat pencocokan string **persis**,
  sehingga round-trip `Date` gagal berisik di situ alih-alih melewatkan baris
  diam-diam.

- f0abb53: fix(gerbang,docs): skill dan README modul berhenti menamai layar admin yang tak ada — dan satu keputusan yang bersandar pada layar fiktif dikoreksi

  `skills:check` menggerbangi path `src/…`, ADR, dan target `bun run` — tetapi
  **bukan** klaim yang paling sering dipakai pembaca untuk bertindak. Sebuah skill
  jarang menulis "`src/pages/admin/site-search.astro` ada"; ia menulis "layarnya
  `/admin/search`". Aturan **5** menutup itu: tiap URL `/admin/…` yang dikutip
  wajib resolve ke halaman nyata.

  Empat klaim yang sudah ter-ship, masing-masing gagal ke arah yang memakan waktu
  orang:

  - **`awcms-site-search`** mendaftar `/admin/search` di bawah judul
    "**Yang BELUM ada (jangan klaim ada)**" — padahal `src/pages/admin/site-search.astro`
    sudah mendarat. Salah dua kali: layarnya ada, dan alamatnya bukan itu. Skill
    DIIKUTI, jadi ini menyuruh agen membangun ulang layar yang sudah bekerja.
  - **`awcms-blog-content`** menyatakan `/admin/blog/widgets` dan `/admin/blog/ads`
    "sudah ada sejak #543". Direktori `src/pages/admin/blog/` **tak pernah ada**;
    widget hidup di `/admin/blog-presentation?section=widgets`, dan **iklan tidak
    punya layar sama sekali**.
  - **README `blog_content`** memuat peta 14 baris `/admin/blog/*` yang **satu**
    entri-nya resolve. Blok itu sebenarnya sudah berlabel "(spesifikasi mini)"
    dengan peringatan di atasnya — label yang bisa dibaca manusia dan tak terlihat
    gerbang, jadi ia kini ditandai `<!-- aspirational:mulai -->`.
  - **README `reporting`/`workflow-approval`** memuat paragraf yang justru
    MENGOREKSI (`/admin/reporting/projections` dan `/admin/workflows` "never
    existed here"). Kalimat semacam itu harus boleh menyebut path-nya, jadi ia
    dipagari `<!-- historis:mulai -->` — konvensi yang sama yang
    `tests/url-vocabulary-split.test.ts` pakai.

  **Korpusnya mencakup `src/modules/<nama>/README.md`, dan itulah intinya.** README
  modul lebih otoritatif daripada skill bagi siapa pun yang menyentuh modul itu,
  dan ia tidak digerbangi sebagaimana descriptor digerbangi — asimetri yang sama
  yang `tests/module-absence-claims.test.ts` harus tutup untuk klaim-absen.
  Membatasi aturan ini ke `.claude/skills` berarti menggerbangi turunannya dan
  membiarkan sumbernya.

  **Temuan yang lebih besar dari rot dokumen, ditemukan sambil mengerjakan ini.**
  Tiga tempat menyatakan layar `/admin/modules/blog_content` "sudah ada", dan satu
  di antaranya memakai klaim itu untuk **membenarkan sebuah keputusan**: "visual
  settings editor … sengaja tidak dibangun; layar generik (Module Management,
  sudah ada) cukup". Diverifikasi: `src/pages/admin/modules.astro` hanya mendaftar
  modul dan menyalakan/mematikannya — **nol editor setting**, dan tak ada rute
  `/admin/modules/{key}`. Sementara itu `GET`/`PATCH
/api/v1/tenant/modules/{moduleKey}/settings` **ada dan ter-guard**. Jadi setiap
  setting modul di repo ini — bukan hanya milik `blog_content` — hari ini hanya
  bisa diubah lewat `curl`, dan alasan tertulis untuk tidak membangun editornya
  bersandar pada layar yang tak pernah ada. Teksnya dikoreksi; **layarnya sendiri
  adalah gap permukaan kelas ADR-0051 yang berdiri sendiri** dan tidak dikerjakan
  di sini.

  Detail aturannya:

  - Path ber-`...`, `*`, atau segmen `{param}`/`[param]` dilewati — itu pola,
    bukan alamat. Query string dan fragment dipotong, karena
    `/admin/blog-presentation?section=widgets` adalah alamat nyata.
  - **Token awal-baris ikut dibaca**, bukan hanya yang berbacktick: peta rute
    hidup di blok berpagar, dan instans terburuk dari cacat ini justru satu
    blok ```txt yang tak satu pun entri-nya berbacktick.
  - Skill aspirational dikecualikan dengan alasan yang sama seperti aturan 1:
    subjeknya tidak ada, jadi layarnya juga tidak.
  - Korpus kosong **memerahkan** gerbang alih-alih lolos hampa.

  **Mutation-proven empat arah:** cacat asli `awcms-site-search` → MERAH; pagar
  aspirational dilepas dari peta spesifikasi mini → MERAH; glob korpus diarahkan
  ke nama yang tak ada → MERAH ("would pass vacuously"); layar palsu ditanam di
  README modul lain → MERAH menyebut berkas dan path-nya.

- d08e3c4: docs(state): putaran keempat 10 Agustus — Gelombang 3 selesai, tiga cacat hidup ditemukan sambil menutupnya

  `docs/PROJECT_STATE.md` §4 mencatat putaran ini: apa yang mendarat (ADR-0079,
  ADR-0080, ADR-0081), tiga tempat rencana program tidak diikuti beserta alasannya
  yang diperiksa terhadap kode, sepuluh penolakan, dan batas yang wajib dibaca
  sebelum permukaan penulis grant ber-scope dibangun.

  Daftar ini ada DI SINI karena aturan yang sama dengan tiga putaran sebelumnya:
  daftar yang tidak ditulis ke repo harus diturunkan ulang, dan menurunkan ulang
  berharga satu audit penuh sementara menuliskannya berharga satu paragraf.
  Penolakan ikut tertulis, karena penolakan yang tidak tercatat akan diusulkan
  lagi.

- c413ee0: docs(sync): outbox sisi server berhenti dijanjikan bekerja — dan keluar dari ledger utang ke daftar pengecualian ber-alasan

  `awcms_sync_outbox` tidak ditulis apa pun: nol `INSERT` di kode aplikasi, di
  trigger, dan di migrasi mana pun. `POST /api/v1/sync/pull`, satu-satunya
  pembacanya, karena itu hanya bisa menjawab `events: []` — selamanya. Sebuah node
  yang mengintegrasikan protokol ini menerima `200 OK` dengan `hasMore: false` dan
  menyimpulkan server memang tak punya perubahan, bukan bahwa jalurnya tak pernah
  tersambung. Kegagalan senyap dengan status sukses.

  Sementara itu README modul menggambarkannya tanpa kualifikasi apa pun — _"local
  events available to be pulled by other nodes"_ — dan mendaftarkan endpoint-nya
  bersebelahan dengan saudaranya yang bekerja.

  **Dinyatakan di tiga tempat yang benar-benar dibaca:** README modul (klaimnya
  diperbaiki, dan §"Belum tersedia" mendapat entri pertamanya soal ini), deskripsi
  tag OpenAPI — yang **ter-render ke `docs/awcms/api-reference.md`** — dan komentar
  tabelnya.

  Deskripsi operasi `/sync/pull` sendiri **tidak** diubah, dan alasannya ditulis di
  tempat gantinya: `tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml`
  beku, dan `tests/openapi-bundle.test.ts` mewajibkan tiap path pra-migrasi
  byte-identical. Deskripsi tag tidak ikut dibekukan (hanya nama tag yang
  dibandingkan), jadi itulah permukaan yang tersedia — dan kebetulan permukaan
  yang lebih baik, karena ia muncul di dokumen yang dibaca manusia.

  **Tabelnya pindah dari `TABLES_PREDATING_THE_RULE` ke `BOUNDED_BY_DESIGN`.**
  Ledger utang membawa tepat satu alasan — _"nobody asked the retention question of
  these"_ — dan alasan itu **sudah tidak benar** untuk tabel ini: pertanyaannya
  diajukan di #468 dan dijawab. Selama ia duduk di sana, sebuah tabel yang **tak
  bisa** dideskripsikan terlihat persis seperti tabel yang **belum**, yaitu
  kebingungan yang melahirkan #477 dan #479.

  Entri ini juga yang pertama di `BOUNDED_BY_DESIGN` — daftar yang sengaja dimulai
  kosong — dan satu-satunya yang premisnya **diperiksa mesin** alih-alih
  diperdebatkan: `tests/object-queue-purge.test.ts` memindai tiap `.ts` dan `.sql`
  di `src/` dan `sql/`, dan gagal begitu sebuah produsen muncul. Dibuktikan dengan
  menanam `INSERT INTO awcms_sync_outbox` palsu → **merah**. Test yang sama kini
  juga meng-assert entri pengecualiannya, sehingga keduanya bergerak bersama: hari
  seseorang menyambungkan produsennya, satu run mengatakan sekaligus bahwa
  klaimnya batal dan entri mana yang harus pergi.

  **Yang TIDAK diputuskan:** apakah tabel dan endpoint-nya disambungkan atau
  dipensiunkan. Itu keputusan produk, bukan teknis — repo ini sudah punya outbox
  transaksional yang bekerja (`awcms_domain_events`, lengkap dengan dispatcher,
  DLQ, dan replay), jadi pertanyaan pertamanya bukan "bagaimana mengisinya"
  melainkan **apakah ia perlu ada**, dan yang kedua adalah event mana yang boleh
  diterima sebuah node — pelebaran akses, bukan penyambungan kabel. Menghapusnya
  juga bukan langkah bebas: snapshot kontrak beku mewajibkan tiap path pra-migrasi
  tetap ADA, tanpa allow-list untuk penghapusan.

  #477 tetap terbuka untuk keputusan itu, kini dengan pertanyaan yang sudah
  dipersempit dan tanpa dokumen yang menjanjikan sesuatu yang tak ada.

- e575ac4: fix(keamanan): permission ber-`scope: 'platform'` berhenti bisa dilekatkan ke role tenant biasa (R8)

  `listPermissionCatalog` mengembalikan **seluruh** katalog global tanpa predikat
  `scope`, jadi editor role menawarkan permission ber-`scope: "platform"`
  (ADR-0053) kepada tenant mana pun, dan `grantPermissionToRole` menerimanya.

  **Ini bukan privilege escalation, dan penting untuk mengatakannya.** Gerbang
  platform di chokepoint selalu menolaknya saat runtime, dan ia memutuskan dari
  deklarasi **sisi kode** — jadi tidak ada baris basis data yang bisa mengangkatnya.

  Yang hilang adalah **redundansi**, dan **kejujuran**. Seorang administrator bisa
  memberikan permission itu, melihatnya tercantum di role, lalu menyimpulkan bahwa
  ia berlaku. Ia tidak. Grant yang **tampak diberikan** tetapi tidak akan pernah
  berlaku adalah jawaban yang salah untuk "siapa bisa melakukan apa" — persis
  jawaban yang harus dipercaya review akses berikutnya. ADR-0058 menghabiskan satu
  dokumen penuh pada kelas ambiguitas itu.

  **Nol migrasi.** Rancangan pertama memberi tiap role kolom `permission_scope`.
  Itu pemisahan yang lebih halus — ia akan membedakan role di dalam tenant platform
  yang boleh dan tidak boleh memegang permission platform — tetapi **bukan R8**, dan
  ia menuntut migrasi, kolom baru, serta penegakannya sendiri.

  Batasan yang R8 gambarkan lebih sederhana dan sudah diputuskan: permission
  platform hanya boleh **dijalankan** oleh tenant platform. Jadi filter yang jujur
  adalah _"apakah tenant yang bertindak adalah tenant platform"_ — tanpa perubahan
  skema sama sekali, dan persis predikat yang sudah dipakai gerbang runtime. Kolom
  per-role tetap tersedia untuk hari ketika least privilege **di dalam** tenant
  platform menjadi pertanyaannya.

  Dua sisi, dan yang kedua yang jadi kontrolnya:

  - `listPermissionCatalog(tx, { includePlatformScoped })` — **wajib** dinyatakan,
    bukan flag opsional ber-default permisif: pemanggil yang lupa mendapat compile
    error, bukan picker yang diam-diam melebar.
  - `grantPermissionToRole` memeriksa ulang di server dan menolak dengan
    `409 PLATFORM_SCOPE_REQUIRED`. Menyaring dropdown menghentikan kecelakaan,
    bukan permintaan yang ditulis tangan.

  Permission id yang tidak dikenal **tidak** ditolak di sini — ia jatuh ke foreign
  key yang melempar `PermissionNotFoundError`. Satu tempat memutuskan "apakah ini
  ada", dan bukan fungsi ini.

  Menutup PROJECT_STATE §4 **R8**.

- 26334bd: fix(db): purge retensi undangan mendapat GRANT yang tak pernah dibuat `sql/106`

  `identity-access/module.ts` mendaftarkan `awcms_invitations` sebagai deskriptor
  `dataLifecycle` ber-`executionMode: 'generic'` (retensi 90 hari), sementara
  `sql/106` membuat tabelnya dan memberi `awcms_worker` **nol** hak — satu-satunya
  kemunculan kata GRANT di berkas itu adalah prosa. Deployment ini menjalankan
  peran worker terpisah (`WORKER_DATABASE_URL` menunjuk `awcms_worker`,
  `docs/awcms/environments.md`), jadi `sql/108` memberi `SELECT, DELETE`, dan
  `WORKER_ROLE_GRANTS` diperbarui di perubahan yang sama supaya matriksnya tidak
  menyimpang dari migrasinya.

  **Kenapa ini bukan sekadar "purge menghapus nol baris".** `sql/091` mencatat
  versi lunak dari kegagalan ini: DELETE yang hilang membuat purge berjalan,
  melapor sukses, dan tidak menghapus apa pun. Di sini bahkan BACAnya hilang, dan
  `archive-purge-job.ts` tidak punya satu pun blok `catch` — `permission denied`
  yang pertama keluar dari loop tenant dan membatalkan SELURUH invocation,
  sehingga setiap deskriptor sesudahnya tidak pernah dijangkau. Yang membuatnya
  tidur hari ini hanyalah job-nya belum dijadwalkan; penjadwalan pertama adalah
  saat ia ditemukan.

  Verb-nya diturunkan dari mesinnya, bukan dari analogi: `SELECT` karena subquery
  DELETE dan `RETURNING created_at`-nya sama-sama menuntutnya (dan
  `planLifecycleDryRun` menghitung baris), `DELETE` karena purge menghapus. Tanpa
  INSERT dan UPDATE — worker yang bisa menulis di sini bisa mengalamatkan tawaran
  keanggotaan ke mailbox mana pun atau merotasi `token_hash` ke nilai pilihannya.
  `awcms_invitation_policies` sengaja tidak diberi apa-apa: barisnya ikut induknya
  lewat `ON DELETE CASCADE`, dan aksi referensial dijalankan dengan hak pemilik
  constraint, bukan hak peran yang menghapus.

  **Test yang MEMATOK cacat ini dibalik.** `tests/invitation-contract.test.ts`
  menyatakan "no GRANT to awcms_worker or awcms_setup" di bawah komentar "neither
  the worker nor the setup wizard touches these tables" — keliru secara faktual
  sejak hari ia ditulis. Kini berkas itu menuntut grant-nya ADA (di `sql/108`,
  karena migrasi terapan tidak boleh disunting), menuntut deskriptornya memang
  `generic`/`hard_delete`, dan menuntut worker TIDAK mendapat INSERT/UPDATE.

  **Plus: `bun run security:readiness` berhenti gagal pada deployment sehat.**
  Detektor hardcoded-secret melaporkan **11 false positive** (exit 1) dalam tiga
  bentuk — tipe union literal string, konstanta ber-akhiran
  `_PREFIX`/`_HEADER`/`_ACTION` yang menamai label wire alih-alih memegang
  kredensial, dan template literal ber-interpolasi. Ketiganya dikecualikan secara
  sempit dan terpisah: union dikenali dari `|` + literal berikutnya (yang tidak
  punya arti sebagai NILAI), dua lainnya menuntut NAMA dan NILAI sama-sama
  cocok, mengikuti bentuk pengecualian `_ENV` yang sudah ada. Dibuktikan tetap
  tajam dengan menanam kredensial sungguhan lalu mencabutnya: `sk_live_...`,
  `AKIAIOSFODNN7EXAMPLE` di dalam backtick tanpa interpolasi, JWT di balik nama
  ber-akhiran `_HEADER`, dan base64 di balik `_ACTION` semuanya tetap memerah.
  Klaim komentar "no such case exists in this repo today" diperbaiki, karena
  sebelas kasusnya ada.

## 7.0.1

### Patch Changes

- b2b6ce6: CI job `quality` kini menjalankan `bun run check` PENUH alih-alih cermin manual per-step yang sempat kehilangan 16 dari 34 gerbang di PR (di antaranya `access:permissions:enforcement:check` dan `access:chokepoint:check` — keduanya tidak pernah jalan di CI PR sejak mendarat). Bentuk cermin manual mengulang persis pelajaran PR #770; guard paritasnya (`tests/family-conformance-ci-parity.test.ts`) kini mengikat bentuk struktural anti-drift: step `run: bun run check` ber-`DATABASE_URL: ""` (pola job Validate release.yml), bukan kehadiran satu gerbang bernama.
- 5a085df: Dua celah standar ditutup dengan pemeriksanya: kompresi yang diwarisi kini
  dinyatakan, dan CodeQL berhenti mengklaim `.astro`.

  **C3 — kompresi diwarisi dari lapisan yang repo ini tak miliki.**
  `security:readiness` memuat `checkResponseCompressionOwnership`: ia memindai
  lima lapisan yang repo ini KIRIM (`src/middleware.ts`, `astro.config.mjs`,
  `infra/varnish/default.vcl`, `infra/varnish/docker-compose.varnish.yml`,
  `Dockerfile.production`) dan, karena tak satu pun mengompresi, menuntut blok
  bertanda `kompresi-tepi` di `docs/awcms/environments.md` menyebut tier
  pengompresi (Cloudflare) beserta akibatnya: deployment di luar CDN pengompresi
  menyajikan seluruh teks tanpa kompresi. Cabang pertama resep C3 (memindahkan
  kompresi ke sini) sudah **dicabut** asesmen §9.3 — kompresor kedua adalah dua
  tempat yang memutuskan hal yang sama. Yang ditutup adalah ketidakterlihatannya;
  repo ini tetap tidak mengompresi apa pun, dan tidak ada gerbang yang melihat
  lapisan luarnya. Dua arah dibuktikan `tests/security-readiness-compression.test.ts`:
  blok dihapus/dikosongkan/penanda separuh → MERAH; kompresi menyala di lapisan
  yang dikirim → pemeriksa menyebut `berkas:baris` dan menuntut blok ditulis
  ulang; komentar `do_gzip` dan `Vary: Accept-Encoding` tidak dihitung sebagai
  kompresi.

  **C16 — `codeql.yml` mengklaim memindai "TypeScript/Astro source".** CodeQL
  tidak punya ekstraktor Astro, jadi 42 berkas `.astro` (22.328 baris — permukaan
  yang sama yang C4 sebut) berada di luar setiap pemindaian sementara komentar
  repo menyatakan sebaliknya. Langkah `State coverage` kini menulis ke ringkasan
  run berapa berkas dianalisis dan berapa `.astro` TIDAK, dihitung `git ls-files`
  saat run; komentar matriksnya berhenti mengklaim Astro. Dijaga
  `tests/codeql-coverage-statement.test.ts`: langkah hilang, angka ditulis
  tangan, atau klaim Astro kembali → MERAH. Postur keluarga kini satu kalimat —
  `.astro` tidak teranalisis statik di repo mana pun, dan kedua repo
  mengatakannya sendiri.

  Tidak ada perubahan perilaku runtime: `security:readiness` bertambah satu
  pemeriksa `warning` (tidak pernah memblokir go-live), dan `codeql.yml`
  bertambah satu langkah ringkasan.

- 2812720: Bangun ulang graf pengetahuan graphify: `graph.json` kini membawa nama komunitas, dan cakupan `.sql` dipulihkan

  Artefak di `graphify-out/` — bukan kode runtime. Tidak ada perubahan perilaku aplikasi, API, skema, atau permission; tingkat `patch` dipakai karena gerbang `changesets:policy:check` menuntut satu tingkat bump eksplisit dan tidak menerima changeset kosong.

  Graf terakhir dibangun 29 Juli, 88 commit yang lalu. Rebuild inkremental atas 409 file berubah dan 35 terhapus membawanya dari 8.247 ke 9.574 node, 24.098 ke 26.456 edge, 495 ke 570 komunitas.

  Tiga cacat senyap ikut tertutup:

  - **`graph.json` tidak membawa `community_name` sama sekali.** Ia dibangun sebelum langkah pelabelan menulis label kembali ke sana, jadi `graphify query`, server MCP, dan konsumen GraphRAG mencetak `community=27` alih-alih nama komunitas — sementara label kurasinya hanya hidup di `.graphify_labels.json`, yang tidak ter-track. Sekarang 570 dari 570 node bernama di dalam artefak yang ter-track, sehingga label bertahan di clone baru.
  - **Sidecar `.graphify_labels.json.sig` sudah basi dua hari terhadap labelnya** dan hanya cocok untuk 6 dari 495 komunitas. Satu jalannya `cluster-only` akan menamai ulang 489 komunitas memakai nama file hub dan menghapus nama kurasi tanpa peringatan apa pun. Sekarang cocok 570 dari 570.
  - **`tree_sitter_sql` hilang setelah pemutakhiran graphify 0.9.27 → 0.9.35,** sehingga setiap berkas `.sql` menyumbang nol node sementara ekstraksi tetap melapor sukses. Di repositori yang tulang punggungnya `sql/NNN`, itu lubang cakupan, bukan kekurangan kosmetik.

  Label lama juga mengandung cacat yang persis dilarang aturan penamaan komunitas: dua pasang duplikat dan 43 dari 495 berbentuk nama berkas — sisa penamaan hub otomatis. Seluruh 570 label ditulis ulang dan diverifikasi nol hilang, nol duplikat, nol berbentuk nama berkas. Pemeriksaan integritas graf bersih, dan `--update` sesudahnya melaporkan nol berkas berubah.

- b5d6be2: Artefak graphify berhenti menuntut changeset, dan permukaan render-nya berhenti mengintai untuk ikut ter-commit

  Tiga pembenahan kebersihan repositori di sekitar `graphify-out/`, tidak satu pun menyentuh perilaku aplikasi.

  **Gerbang changeset mengecualikan tiga artefak graf yang ter-track.** Sebelum ini setiap pembangunan ulang graf harus mengarang changeset `patch`, sehingga penyegaran artefak murni menaikkan versi rilis dan menulis baris changelog yang tak bisa ditindaklanjuti pengguna paket mana pun. `graph.json`, `manifest.json`, dan `cost.json` kini dikecualikan — `GRAPH_REPORT.md` sudah lebih dulu lewat pola `.md`.

  Pengecualiannya **dienumerasi, bukan `/^graphify-out\//`**, dengan alasan yang sama membuat temuan security-auditor di PR #715 mempersempit entri `.claude/`: pengecualian se-direktori juga menutupi apa pun yang dijatuhkan proses lain ke sana kelak. Berkas artefak keempat harus melewati daftar ini secara sengaja, bukan mewarisi pengecualian yang tak pernah ditinjau untuknya. Sebuah test membuktikan kesempitan itu: melebarkan pola menjadi se-direktori membuat test merah, dan hanya test itu.

  **Empat artefak render graphify masuk `.gitignore`.** `graph.svg`, `graph.graphml`, `GRAPH_TREE.html`, dan `*-callflow.html` berjumlah 49 MB pada graf 9.574 node, melawan 15 MB milik `graph.json`. Melacaknya akan melipatempatkan lebih dari apa yang ditambahkan setiap penyegaran graf ke riwayat selamanya, dan tiap berkas membusuk dengan cara yang sama seperti `graph.html` — yang sudah lebih dulu diabaikan dengan alasan tertulis yang sama. Semuanya satu perintah dari regenerasi.

  **`graphify-out/.graphify_labels.json.sig` tidak lagi dilacak.** Aturan `.gitignore` `graphify-out/.*` bermaksud mengeluarkannya sejak awal, tetapi aturan tidak bisa membatalkan pelacakan berkas yang sudah terlanjur ter-commit. Salinan yang ter-track hanya bisa basi: ia adalah tanda tangan keanggotaan komunitas yang berpasangan dengan `.graphify_labels.json`, yang memang tak pernah dilacak — jadi sebuah clone menerima tanda tangan tanpa label yang ia jelaskan. Nama komunitas tetap aman di `graph.json`, yang membawanya per-node.

- ce99272: Impor dataset wilayah menulis SQL NULL, bukan string `"null"`. `tx.array(values, "text")` tidak bisa membawa NULL — Bun menyerialkan elemen `null` menjadi teks empat karakter `"null"` (diprobe terhadap PostgreSQL 18.4 di Bun 1.3.14; varian tanpa tipe pun bukan NULL). Akibatnya impor nyata mengisi setiap kolom nullable dengan `'null'`: 38 provinsi ber-`parent_code` `'null'` dan 7.285 kecamatan ber-`local_term` `'null'`, yang dirender apa adanya oleh layar lookup dan membuat filter `IS NULL` mengembalikan nol baris. Nilai null kini melintas sebagai sentinel dan dipulihkan `NULLIF(t.col, '')` di SELECT — benar juga bila Bun kelak mengirim NULL sungguhan. Digerbangi test integrasi yang hanya bisa merah di database nyata.
- ebd4b1b: Artefak rilis bertahan lebih lama dari gerbang persetujuan yang menunggunya

  `release.yml` mengunggah SBOM, tarball sumber, dan checksum dengan `retention-days: 1`, lalu menggantung job penerbitan di balik gerbang environment `release` yang **tidak punya batas waktu sama sekali**. Setiap persetujuan yang datang lebih dari 24 jam setelah build karena itu menerbitkan apa-apa: artefaknya sudah hilang.

  Itu bukan skenario teoretis. Run v7.0.0 mati persis begitu — build selesai 5 Agustus 08:43 UTC, artefaknya kedaluwarsa 24 jam kemudian, dan persetujuan yang tiba 8 Agustus langsung menabrak `Artifact not found for name: release-artifacts`. Yang membuatnya mahal: tidak ada satu pun kalimat di teks kegagalan yang menyebut retensi, jadi kegagalannya terbaca seperti masalah unggah, bukan seperti run yang sudah tidak mungkin diterbitkan sejak dua hari sebelumnya. Rilis itu menggantung 63 jam sebelum ada yang menyentuhnya, dan pada jam ke-24 ia sebenarnya sudah mati.

  Retensi dinaikkan ke 30 hari — sama dengan batas GitHub sendiri untuk berapa lama sebuah run boleh menunggu persetujuan. Dengan begitu setiap gerbang yang masih bisa disetujui punya artefak untuk disetujui, dan kedua batas itu berhenti saling bertentangan.

  `ci.yml` memakai `retention-days: 5` dan tidak diubah: tidak ada job di sana yang menunggu di balik gerbang, jadi retensinya tidak pernah berlomba dengan keputusan manusia.

- bcd5422: Catatan rilis dipotong ke batas body GitHub alih-alih menjatuhkan penerbitan

  `release.yml` menyalin satu seksi `CHANGELOG.md` mentah-mentah menjadi body GitHub Release. GitHub menolak body di atas 125.000 karakter dengan `HTTP 422: body is too long` — dan penolakan itu datang **setelah** penandatanganan, attestation, dan push image semuanya berhasil. Hasilnya run yang mati dengan image tertandatangani dan ter-attest di registry, tetapi tanpa rilis yang menunjuk kepadanya.

  v7.0.0 gagal persis di sini: seksinya 186.449 karakter, 49% di atas batas. Ini juga bukan kejutan mendadak — v6.0.0 sudah 103.262 karakter, jadi langit-langitnya sudah didekati beberapa rilis tanpa ada apa pun yang melaporkan jaraknya.

  Sekarang langkah ekstraksi mengukur hasilnya dan memotong bila perlu, menyisipkan pemisah plus tautan ke `CHANGELOG.md` pada tag itu supaya teks utuhnya selalu satu klik jauhnya. Anggarannya dihitung dalam **byte** melawan langit-langit **karakter**: untuk UTF-8 byte selalu lebih besar atau sama dengan karakter, jadi anggaran byte hanya bisa terlalu berhati-hati, tidak pernah melampaui. Pemotongan mundur ke batas baris terakhir supaya body tak pernah berakhir di tengah karakter atau di tengah markdown.

  Diuji terhadap seksi v7.0.0 yang sesungguhnya: 186.449 byte turun menjadi 117.351 karakter, UTF-8 utuh, berakhir rapi. Seksi berukuran normal (v6.4.0, v6.3.0, v6.0.0) melewatinya tanpa disentuh.

## 7.0.0

### Major Changes

- 611286f: **Security / breaking:** region-dataset activation and rollback become operator jobs; their HTTP endpoints are removed and their permissions revoked.

  `POST /api/v1/idn-regions/datasets/{id}/activate` and `POST /api/v1/idn-regions/datasets/rollback` both swapped the Indonesia administrative-region dataset served to **every** tenant — those tables are global, with no `tenant_id` and no RLS. But `sql/081` seeded their permissions (`idn_admin_regions.dataset.configure` / `.restore`) into the **global** ABAC catalogue, and `POST /api/v1/setup/initialize` grants the whole catalogue to each new tenant's `owner` role. So an ordinary tenant owner held authority over data served to other tenants, and ABAC could not see anything wrong: it evaluates the permission, not who the action ultimately affects.

  Replaced by `bun run idn-regions:activate -- --dataset <code|uuid>` and `bun run idn-regions:rollback`, both dry-run by default and writing only with `--commit`, running as `awcms_worker`. This matches `bun run idn-regions:import`, which ADR-0046 §5 had already made job-only for the identical reason: a global action has no request-time tenant subject for an ABAC guard to evaluate.

  `sql/084` revokes both permissions and any role grants that already reference them. Two permissions remain for this module, both genuinely read-only: `region.read` and `dataset.read`.

  **Breaking:** two OpenAPI paths are removed. No consumer existed — no screen in this repo called them, and a repo-wide search found no caller.

  **Accepted cost, stated rather than hidden:** these actions no longer write an `awcms_audit_events` row. That table is tenant-scoped while the action is global; the old row landed in whichever tenant's log the clicking owner belonged to, misrepresenting a global change as that tenant's and staying invisible to every other affected tenant. Evidence now lives on the dataset row itself (`status`, `activated_at`, `activated_by`) plus the command's own output. A correct cross-tenant audit needs a global log this base does not have yet.

  See ADR-0052.

### Minor Changes

- dc54236: ADR-0044 §4 Fase 2, langkah pertama: `awcms_news_portal_ad_placements` kini
  punya targeting (`target_type` global/widget/post/page + `target_id`), sehingga
  ia bisa menyatakan segala yang bisa dinyatakan sistem iklan free-URL yang akan
  dipensiunkan.

  Penggabungan ADR-0044 meninggalkan `blog_content` memiliki DUA sistem iklan,
  masing-masing punya kemampuan yang tidak dimiliki lawannya. Yang lama menerima
  `image_url` bebas — URL apa pun, tanpa registry media — tetapi bisa menarget
  post dan page. Yang baru mengikat `media_object_id` sebagai foreign key ke objek
  media terverifikasi, tetapi setiap barisnya efektif site-wide.

  Yang berbasis media adalah yang bertahan, karena `image_url text` persis
  merupakan jalan pintas yang dituju ADR-0036 saat membalik kepemilikan media.
  Tetapi menghapus yang lama LEBIH DULU akan diam-diam memusnahkan targeting
  per-post dan per-page — iklan yang dibeli untuk satu artikel berhenti muncul,
  tanpa satu pun error. Karena itu pelebaran ini berdiri sendiri, sebelum satu
  baris pun dipindahkan.

  Migrasi 078 SENGAJA tidak memindahkan data dan tidak menghapus tabel. Ingest
  `awcms_blog_ads.image_url` ke `media_library` (dengan laporan residu yang bisa
  di-dry-run) dan penghapusan kedua tabel lama adalah langkah terpisah
  berikutnya, dalam urutan itu.

  - `placement_key` tetap SLOT (di mana pada halaman); `target_type`/`target_id`
    adalah SCOPE (halaman mana). Keduanya ortogonal.
  - Render sebuah halaman mengembalikan iklan bertarget halaman itu DIGABUNG
    dengan setiap iklan `global` untuk slot yang sama — perbaikan yang disengaja
    atas sistem lama yang mencocokkan satu scope persis dan menyerahkan
    penggabungan ke pemanggil.
  - Aturan berpasangan (`target_id` wajib untuk tipe bertarget, terlarang untuk
    `global`) adalah CHECK di basis data, bukan hanya di validator seperti tabel
    lama. Diuji dengan INSERT sebagai peran admin — penulis yang persis tidak bisa
    dijangkau aturan tingkat-aplikasi.
  - `target_id` polimorfik (post/page/widget), jadi tidak ada foreign key yang
    bisa menjangkaunya. Keberadaannya diperiksa saat tulis; target yang dihapus
    KEMUDIAN bukan error dan tidak pernah menjadi error — barisnya sekadar
    berhenti cocok.
  - Baris yang ditulis dengan bentuk pra-078 bernilai `global`, jadi tidak ada
    iklan lama yang berubah perilakunya. Dibuktikan terhadap PostgreSQL 16 nyata,
    bukan disimpulkan dari default kolom.

- 52e333a: Add the `/admin/approvals` inbox and put `workflow_approval` in the admin sidebar.

  The module shipped a complete engine — graph definitions, quorum, delegation, escalation, administrative recovery — and no screen, so every approval in this base could only be decided with `curl`. Under ADR-0051 the screen belongs here.

  The inbox lists tasks with the same filters the JSON route accepts (status, workflow key, resource type, overdue, safe search) over keyset pagination, and offers approve/reject, reassign and force-decision per row, a per-instance history panel carrying the cancel action, and the delegation ledger with create and revoke. Reads go through this module's own application functions inside one `withTenantOrThrow`, awaited sequentially; instance history is fetched only when `?instance=` names one, because doing it per row would be up to 100 queries for a list nobody expanded.

  Writes go to the guarded endpoints, all six with a fresh `Idempotency-Key` per click — unlike `/admin/reporting` there is no exception here, because every one of them requires the header.

  Cancel sits on the instance panel rather than the task row: cancelling ends the whole instance and every pending task under it, so offering it beside a single task would misrepresent its blast radius.

  `tests/admin-approvals-page-contract.test.ts` pins the page's eight permission keys against what the routes enforce and the descriptor declares. Two traps are specific to this module and both would deny every caller while reading perfectly: the permission namespace is `workflow`, not `workflow_approval` (the directory, README and descriptor name all say the latter), and approve/reject share one permission — `approval.approve` is the ability to decide, not its direction, and `approval.reject` is seeded nowhere.

  The six `definition.*` permissions are deliberately left to their own screen: authoring a node graph needs a real editor, and a raw-JSON textarea that accepts a malformed graph until publish rejects it is a worse affordance than none. The contract test asserts they stay off this page, so the split remains a decision rather than a gap.

  `MAX_REASON_LENGTH` — written out as a bare `500` in five separate files — moves to `workflow-approval/domain/reason-bounds.ts`, imported by all of them and by the form that renders it as `maxlength`.

  Also corrects `workflow-approval/README.md`, which described an `/admin/workflows` page that never existed in this repo.

- 4b998bf: feat(blog-content): `/admin/blog-pages` — the page console (ADR-0057 step 3)

  Completes ADR-0057. The screen drives **all eight** `pages.*` permissions —
  `read`/`create`/`update`/`publish`/`archive`/`delete`/`restore`/`purge` — four
  of which had no surface at all until the previous change, and so no screen
  could have driven them.

  Two views, because delete and archive are different axes: the default lists
  live pages, `?view=deleted` lists the bin. Control placement follows what each
  endpoint accepts — Restore on bin rows, Publish/Archive/Delete on live rows,
  Purge on both. `listBlogPagesForAdmin` gains the `deletedOnly` filter that makes
  the bin reachable.

  `pages.update` is driven through the structure fields this screen owns (title,
  slug, page type, menu order), not a body editor. Re-parenting is deliberately
  absent: the API performs no cycle detection, and a control that can make a page
  its own ancestor is worse than none.

  The status filter offers the three states a page can reach, not all five —
  there is no `pages.schedule` and no review queue.

  Sidebar gains a second `blog_content` entry, gated on `pages.read` rather than
  `posts.read`.

- c0163b1: Add the `/admin/blog` post lifecycle console and put `blog_content` in the admin sidebar.

  `blog_content` is the largest module in this repo — 43 permissions across 15 activity codes and ~30 route files — and until now it had no screen at all. Under ADR-0051 the screens belong here; this is the first, and it covers the surface an editor uses every day.

  The console lists posts with the module's own admin search/status filters and page-number pagination, and drives eleven permissions: `posts.read`/`create`/`update`/`publish`/`schedule`/`archive`/`delete`/`restore`/`purge` plus `revisions.read`/`restore`. Reads go through `listBlogPostsForAdmin` and `listBlogRevisions` inside one `withTenantOrThrow`, awaited sequentially; revisions are fetched only when `?post=` names one. Every mutation posts to the guarded endpoint.

  Pagination is page-number rather than keyset, which is the opposite of `/admin/approvals` — deliberately. `listBlogPostsForAdmin` is LIMIT/OFFSET by design for a human-browsed table with "page 2, 3" controls, and its own header comment records that choice.

  The other 32 permissions belong to sibling screens that are not in this change (pages, taxonomy, templates/menus/widgets, settings/seo/theme, internal links, homepage sections, ad placements). Two absences are different in kind, and `tests/admin-blog-page-contract.test.ts` asserts both rather than leaving them to look like gaps:

  - **`posts.export` is declared and seeded by `sql/036`, and no endpoint anywhere enforces it.** The test proves this by scanning every route under `src/pages/api/v1/blog/`, so a future export endpoint fails it and forces the screen question to be answered instead of missed.
  - **`search.read` has a route and the page still does not use it.** The admin list already searches by title `ILIKE`, which tolerates the empty query that the `websearch_to_tsquery` surface behind `search.read` rejects.

  There is also no body/content editor: authoring a post body needs a rich-text surface plus SEO fields, terms and featured media. `posts.update` is still driven, through "submit for review".

  The module-specific trap the contract test pins: `submit-review` is gated on `posts.update`, not a `posts.submit` or `posts.review` — neither is seeded anywhere — and that route builds its guard in two pieces, so a regex over guard triples cannot see it and the test asserts it directly. Idempotency splits too: six lifecycle mutations require an `Idempotency-Key`, while `POST /api/v1/blog/posts` requires none by documented design, because a retry duplicating a create is caught by the `(tenant_id, locale, slug)` partial unique index.

  `MAX_TITLE_LENGTH`/`MAX_EXCERPT_LENGTH` are now exported from `content-validation.ts` so the form's `maxlength` comes from the same constants the validator enforces.

  Also corrects `blog-content/README.md`, whose §Admin UI described a fifteen-screen `/admin/blog/*` tree that never existed in this repo. It is kept, clearly marked as the awcms-mini specification, because it is a useful target for the sibling screens.

- 9e0da39: `/admin/blog-presentation` — templates, menus, widgets and theme, the fourth
  blog console.

  Four activities on one screen because they answer one question (how the blog
  looks) and each is a short bounded list. `?section=` reads only the section
  being shown, and a section the operator cannot read is not offered at all.

  The eight permissions are gated as four INDEPENDENT pairs: holding
  `widgets.configure` must not reveal a template control.

  Three deliberate absences, each mutation-proven:

  - **menu ITEMS are not editable.** `PATCH /api/v1/blog/menus/{id}` replaces the
    whole item list, so a flat form would delete every item it did not render.
    The client never sends the key at all;
  - **no "revert to tenant default" for the theme.** `upsertBlogThemeSettings`
    only INSERTs or UPDATEs and no delete route exists, so an override is
    one-way. The screen states that instead of offering a control that cannot
    succeed;
  - **no bin, no Restore.** Templates, menus and widgets all soft-delete with no
    counterpart and no `*.restore` permission to build one against.

  `key` is sent on create and never on update, because the update inputs have no
  `key` field.

- e20c942: `/admin/blog-taxonomy` — the categories-and-tags console, third sibling of
  `/admin/blog` and `/admin/blog-pages`.

  Drives both `taxonomies.*` permissions. `configure` gates create, update AND
  delete together, because `sql/036` seeds no per-verb rows — the permission is
  the capability "manage taxonomy", not one flag per verb, and a screen that
  invented `taxonomies.create` would gate on authority nothing honours.

  Three deliberate absences, each held by the contract test:

  - **no bin view and no Restore.** Term soft delete is one-way BY DESIGN (no
    restore route, no `taxonomies.restore` to build one against), so a bin would
    imply a way back that does not exist. The confirmation states the finality
    instead — copy promising recoverability is what made #351 hard to see;
  - **no re-parenting on edit.** Neither term route detects cycles, so pointing a
    parent at its own descendant is accepted and every reader then walks forever.
    Create still offers a parent: a term with no children cannot close a loop;
  - **no `Idempotency-Key`.** None of the three term endpoints reads it.

- 5368c23: Add the `/admin/domain-events` operator console and put `domain_event_runtime` in the admin sidebar.

  The module shipped consumers, deliveries, retry/dead-letter and replay with no screen, so the only way to see why an event never arrived — or to unstick it — was `curl`. Under ADR-0051 the screen belongs here.

  All five of the module's permissions are driven from this one page: the consumer registry with pause state and backlog counts (pause/resume), the delivery list filtered by status/consumer/event type with replay on dead-lettered rows, and the outbox itself with a payload inspector. Reads go through this module's own application functions inside one `withTenantOrThrow`, awaited sequentially; every mutation posts to the guarded endpoint.

  The interesting part is the idempotency split, which the screen reproduces exactly: `replay` sends an `Idempotency-Key` because each call does new work (it enqueues another attempt), while `pause` and `resume` send none because setting a flag twice has the same end state — `resume` takes no body at all. Sending a key to `pause` would imply a replay contract that endpoint does not have; omitting it on `replay` would render a button that always fails with `IDEMPOTENCY_REQUIRED`.

  `tests/admin-domain-events-page-contract.test.ts` pins all five permission keys against what the routes enforce and the descriptor declares, pins the three-way idempotency split per request rather than as a global count, and asserts the endpoints themselves still disagree the way the page assumes. The module-specific trap: pause and resume are opposite actions sharing ONE permission, `consumers.manage` — `consumers.pause` and `consumers.resume` read better and are seeded nowhere, so inventing them would hide both buttons from every operator including the owner.

  `MAX_REASON_LENGTH`, written out twice, moves to `domain-event-runtime/domain/reason-bounds.ts`.

- 05c247c: Add `/admin/media` and put `media_library` in the admin sidebar — the last module in this base without a screen.

  It was listed for two waves beside modules that were genuinely only missing a page, and that was wrong for this one. [ADR-0056](docs/adr/0056-media-library-admin-surface.md) found that five of eleven permissions were enforced by nothing, five application functions had zero callers, and there was **no list function at all** — so this screen could not have been built on the surface that existed, whatever the permission catalog said. `attach`/`detach` were revoked (§A), `delete`/`restore`/`purge` got endpoints (§B), and the browse listing got its own function and route (§C). This is what those three were for.

  The console browses with §C's filters — status, mime type, and the three-way `live`/`deleted`/`all` — then deletes, restores, and purges. Reads go through `listMediaObjects` inside one `withTenantOrThrow`; writes post to the guarded endpoints, each with a fresh `Idempotency-Key`. Unlike `/admin/blog` there is no opt-out, and unlike `/admin/sync` there is no endpoint that declines the header: all three here require it.

  **Three deliberate absences**, each pinned by `tests/admin-media-page-contract.test.ts` so they stay decisions rather than becoming gaps:

  - **Upload** (`media.create`/`.verify`/`.cancel`) — a three-step browser flow (create session → PUT the bytes straight to R2 → finalize) with real file input, progress, and client-side failure modes. A button that starts a session this page cannot finish leaves a `pending_upload` row behind on every misclick, which is precisely the litter the reconciliation job exists to clean up.
  - **`enforcement.read`/`.enable`** — a tenant-wide, ONE-WAY content policy switch, not an object action. It belongs on `/admin/security` with the other policy controls; offering it beside a row of files would misrepresent its blast radius.
  - **No `<img>` preview.** A registry row can be `pending_upload` or `failed` — the bytes may be absent, unverified, or the very thing an operator is here to delete. Rendering them is how a policy-violating image gets shown one more time, to the person removing it.

  The delete prompt asks for a real reason rather than sending a placeholder, because it lands on an audit row that outlives the object, and its `maxlength` comes from the constant the validator enforces. Purge is the only irreversible action and is the only one behind a `confirm`. It is also the only failure this screen names specifically: `MEDIA_OBJECT_REFERENCED` gets "remove that reference first" rather than "please try again", because retrying will never succeed while the foreign key is live.

  **This closes ADR-0021's first criterion.** `idn-admin-regions` is now the only module without a screen, and that is a documented decision (ADR-0052 moved its lifecycle to operator jobs). The contract test asserts it repo-wide, so the next module to land without `navigation` turns CI red instead of quietly becoming a second exception.

  Mutation-proven four ways: gating a control on the revoked `media.detach`, dropping one mutation's `Idempotency-Key`, rendering a preview `<img>`, and removing the navigation entry each turn it red.

- 821387b: Add the `/admin/reporting` console and put `reporting` in the admin sidebar.

  `reporting` had seven permissions and, between them, one page: `/admin` renders four of its five dashboard views. Everything Issue #753 built — the projection registry, live freshness, rebuild, reconciliation, scheduled exports and artifact download — had no screen at all, and neither did `email-health`, the fifth dashboard view. All of it was reachable only by `curl`. Under ADR-0051 the screen belongs here.

  The console renders each registered projection with its live freshness status, metric values and most recent reconciliation, plus rebuild history, scheduled-export management, on-demand export, and the export-run history with checksum-verified download links. It deliberately does not repeat the four aggregations `/admin` already shows; a projection links to its own `drillDownPath` instead.

  Reads reuse this module's own application functions inside one `withTenantOrThrow` transaction, awaited sequentially. `listProjectionSummariesForTenant` is handed the caller's real granted-permission set, so the per-descriptor `requiredPermission` filter stays honest on this path too. Writes go to the guarded `/api/v1/reports/*` endpoints — five with a fresh `Idempotency-Key` per click, `reconcile` with none, because that endpoint mutates no business state and requires none.

  `tests/admin-reporting-page-contract.test.ts` pins all seven permission keys against what the routes enforce and the descriptor declares. Three plausible-but-wrong guesses would each have rendered a control that denies every caller including the owner: `projections.cancel` for cancelling a rebuild (it is `projections.rebuild`), `projections.read` for reconciling (it is `projections.analyze`), and `exports.configure` for triggering an export (it is `exports.export`).

  `MIN_EXPORT_INTERVAL_MINUTES` / `MAX_EXPORT_INTERVAL_MINUTES` / `MIN_REASON_LENGTH` / `MAX_REASON_LENGTH` move to `reporting/domain/operator-input-bounds.ts` and are now imported by both the three routes that validate them and the form that renders them as `min` / `max` / `maxlength`, so the browser cannot accept what the server rejects.

  Also corrects `reporting/README.md`, which described an `/admin/reporting/projections` page and a `submitJson` helper that never existed in this repo.

- 48d5bcb: Add `/admin/security` — the screen for authentication policy that the endpoints
  have been waiting for since #184/#185.

  Tenant auth policy (password/SSO/break-glass/JIT/allowed domains) and MFA
  enforcement have been fully implemented and guarded for two releases, reachable
  only by hand-writing `curl`. This renders them: deployment posture (read-only),
  the tenant authentication policy, MFA enforcement level, and a read-only list of
  configured OIDC providers.

  **It adds no enforcement of its own.** Every mutation posts to the real endpoint
  and inherits its ABAC guard, its break-glass rule and its audit row. The
  permission checks decide what to render, never what is allowed.

  **The gates reuse the endpoints' exact permission keys** — including
  `mfa_admin.reset` as the MFA _read_ gate, which reads like a mistake and is
  precisely what `GET /api/v1/auth/mfa/policy` requires. Inventing a friendlier
  `mfa_admin.read` that no migration seeds would hide the section from everyone
  including the owner, which is the latent-authz bug this repo has already shipped
  twice. `tests/admin-security-page-contract.test.ts` extracts the guard triples
  from the route sources and the `permissionKey(...)` triples from the page and
  requires the second to be a subset of the first; mutation-proven — swapping in
  `mfa_admin.read` turns three tests red.

  **Deployment posture is shown because the tenant policy cannot be judged without
  it.** `ssoRequired` with `AUTH_SSO_ENABLED=false` produces a tenant nobody
  outside the break-glass list can sign into, and that contradiction was
  previously invisible from any screen. It now renders as a warning. No key or
  secret value is displayed — only whether a control is active.

  **The break-glass picker deals in identity ids**, not tenant_user ids: the
  policy column stores identity ids, both are uuid, and passing the wrong one is
  accepted by the endpoint, filtered out as ineligible, and saved as an empty
  list — a silent no-op exactly where an operator is trying to keep themselves
  able to log in. New `listBreakGlassCandidates` uses the same predicate as
  `fetchEligibleBreakGlassIdentityIds`, and an integration test pins the two
  together across inactive identities, inactive memberships, locked identities and
  cross-tenant rows, so the picker can never offer an option the save path
  discards.

  `409 BREAK_GLASS_REQUIRED` surfaces verbatim rather than collapsing into a
  generic failure: the caller is already an authenticated admin holding
  `sso_policy.update`, so it leaks nothing they cannot read directly, and a
  generic message would leave them retrying the one change the server will never
  accept.

  OIDC provider CRUD stays API-only — a form that posts a client secret deserves
  its own change.

- b993159: Render the admin sidebar from the module registry instead of a hand-written array.

  `ModuleDescriptor.navigation` was already synced to `awcms_module_navigation`
  and served by `GET /api/v1/modules`, while `AdminLayout.astro` rendered a
  separate static list. Nothing compared them and both had rotted: three declared
  entries pointed at admin pages that do not exist (`/admin/blog`, two
  `/admin/news-portal/*`) and were being published as valid menu items, while
  eight pages that do exist were unknown to the registry.

  The sidebar now composes from `listModules()` through the new
  `module-management/domain/sidebar-menu.ts` (ported from awcms-micro, without
  its per-tenant override tables). Tenant-disabled modules and the caller's
  permissions both filter it, so an operator no longer sees links to screens that
  will only deny them. `tests/admin-navigation-registry.test.ts` binds
  declarations to the filesystem in both directions.

  `AdminLayout`'s `active` prop is gone — the current entry derives from the
  request path, which cannot disagree with itself the way `/admin/comments` did
  (it never passed one and was never highlighted).

- 16cf031: Add the `/admin/sync` operator console and put `sync_storage` in the admin sidebar.

  The module shipped node management, conflict resolution and the object upload queue with no screen, so an operator could see on the dashboard that sync was unhealthy and had no way to act on it except `curl`. `application/sync-directory.ts` has named "the future `/admin/sync` SSR page" in its own header comment since it was written. Under ADR-0051 this is that page.

  All six of the module's permissions are driven here: the node list with activate/deactivate, the conflict list with the three resolutions and an optional note, and the object queue with retry on `failed` entries, keyset-paginated. Reads go through this module's own application functions inside one `withTenantOrThrow`, awaited sequentially.

  `fetchSyncConflicts` is new in `sync-directory.ts`, and `GET /api/v1/sync/conflicts` now calls it too — the query used to be inline in that route, which was fine while it was the only reader; a screen that re-wrote it would be free to drift from the endpoint it is meant to mirror. The endpoint keeps its exact wire format: `fetchSyncConflicts` returns `null` for an unresolved conflict's resolution fields, and the route maps them back to `undefined` so they stay absent from the JSON rather than becoming `null` — that is a contract change, not a refactor.

  **None of the three mutations sends an `Idempotency-Key`**, because none of the endpoints requires one: all three are naturally idempotent state transitions (`status = 'active'`, `'resolved'`, `'pending'`) rather than requests that do fresh work per call. Sending one would imply a replay contract they do not have. `tests/admin-sync-page-contract.test.ts` pins that in both directions, so an endpoint that later starts requiring a key turns the contract red instead of failing silently at runtime.

  The HMAC node protocol (`push`/`pull`/`objects`/`status`) gets no controls, and the test asserts the page never names those paths: they authenticate a node by signature, not an administrator by session, so a button for them would be a control no browser can legitimately use and whose failure would read as a bug rather than a category error.

  The module-specific latent-authz trap the test also pins: resolving a conflict is `conflict_resolution.approve`. Both `conflict_resolution.resolve` and `.update` read better than the permission that exists, and neither is seeded anywhere.

- 2c722ee: Add the `/admin/audit-trail` viewer and put `logging` in the admin sidebar.

  `logging` has exactly one HTTP surface (`GET /api/v1/logs/audit`) and had no screen, so the tenant's audit history — the record of every high-risk action the system takes — was readable only by `curl`. For the module whose whole purpose is accountability, that is a poor place to have no UI.

  The screen lists events newest-first with a resource-type filter and a per-event detail disclosure (correlation id + the already-redacted `attributes`, rendered as escaped text, never as HTML). It is read-only and ships **no client script at all**: the audit trail is append-only by design, so the filter is a plain `method="get"` form that works with JavaScript disabled.

  `listAuditEvents` clamps to 100 rows and has no cursor, so the page states that bound whenever the view is full rather than letting a truncated audit log read as "this is everything that happened". Adding keyset pagination to that endpoint is a follow-up with its own OpenAPI change, deliberately not smuggled in here.

- c6b9ceb: Freeze and gate the API slice `ahliweb/awcms-astro` consumes (ADR-0065).

  The existing frozen snapshot is the pre-#182-migration monolith, and every
  surface that repo actually calls landed after it — `/auth/session` and
  `/access/machine-credentials` (ADR-0049), `/media/objects` (#318),
  `/media/public-origin` (#370), the `/blog/posts` cursor traversal (#317).
  Searching the snapshot for them returns zero. So a response-shape change to any
  of them was green here and broke the other repo's build: a failure surfacing
  where whoever caused it is not looking.

  `bun run api:consumer-contract:check` freezes 6 paths plus the 16 components
  their `$ref`s reach. The closure is the point — freezing path objects alone
  would be near-useless, since a path is a few lines of `$ref` and the interesting
  breakages happen in the schema.

  The rule is additive-superset: a new optional field passes, a rename or retype
  fails. Regenerating is deliberate and means the consumer must change too, which
  the fixture header and the failure message both say — whoever reads that message
  is in the wrong repo to realise it unaided. A missing consumer path throws
  rather than silently shrinking the contract.

  This is a schema contract, not a behavioural one: a change of meaning with an
  unchanged shape is not caught.

  No migrations, no permissions, no runtime change.

- da9b51f: ADR-0044 §4 Fase 2, langkah kedua: job `bun run blog:ads:ingest` yang
  memindahkan sistem iklan free-URL ke sistem berbasis media — dan **melaporkan
  setiap baris yang tidak bisa dipindahkan**.

  Pratinjau adalah default, bukan flag. Job scheduled lain memakai `--dry-run`
  sebagai opt-in karena mereka berjalan tanpa penunggu dan mode normalnya adalah
  bekerja. Yang ini kebalikannya: ia tidak menulis apa pun sampai diberi
  `--apply`. Kesalahan mahal di sini bukan "lupa pratinjau", melainkan
  "sudah pratinjau, lalu tidak pernah membaca residunya" — oleh operator yang
  sebentar lagi menghapus tabel sumbernya.

  **Yang otomatis hanya satu kasus, dan itu disengaja.** Sebuah iklan pindah bila
  `image_url`-nya sudah merupakan URL publik salah satu objek media tenant itu
  yang **terdaftar** di registry. Selain itu — remote, malformed, object key milik
  tenant lain, atau byte di bucket yang tidak diklaim baris registry mana pun —
  menjadi residu, dilaporkan lengkap dengan URL-nya untuk diunggah ulang manusia
  lewat media library.

  Dua jalan pintas yang ditolak, dan alasannya:

  - **Mengambil URL eksternal dari server.** Itu primitif SSRF, dan tempat
    terburuk untuk membangunnya adalah skrip migrasi data yang dijalankan sekali,
    di bawah tekanan waktu, oleh operator yang sedang mengawasi jumlah baris
    alih-alih egress. Repo ini sudah memutuskan sikapnya soal ini di jalur
    discovery OIDC (ADR-0031).
  - **Mendaftarkan objek yang ada di bucket tapi tanpa baris registry.** Itu akan
    membuat skrip migrasi mencetak baris `verified` untuk byte yang tidak pernah
    ia ambil, sniff, atau batasi ukurannya — persis pernyataan yang menjadi alasan
    keberadaan pipeline unggah. Peran `awcms_worker` bahkan tidak diberi INSERT
    yang memungkinkannya (`sql/079`).

  Rincian lain:

  - `--apply` **wajib** disertai `--placement-key=<key>`. Sistem lama tidak punya
    konsep slot, yang baru menuntut satu dari dua belas, dan tidak ada di data
    lama yang menyatakan mana. Job menolak menebak.
  - Idempoten lewat `source_legacy_ad_id` di bawah unique index PARSIAL dengan
    `NULLS NOT DISTINCT` (`sql/079`). Keduanya load-bearing: tanpa `NULLS NOT
DISTINCT` sebuah run kedua menggandakan seluruh iklan `global`; tanpa
    predikat parsial, index itu justru menolak pekerjaan editorial biasa. Kedua
    sisi dibuktikan dengan mutasi terhadap PostgreSQL 16 nyata.
  - Job tidak menulis satu pun statement sendiri — semuanya di
    `application/legacy-ad-ingest-directory.ts`, milik modul pemilik tabel
    (`modules:table-writes:check`).
  - Tidak ada tabel yang dihapus. Menghapus `awcms_blog_ads` adalah keputusan
    manusia yang sudah membaca laporan residu, bukan efek samping dari job yang
    menghasilkannya.

  Ditemukan sambil jalan: seluruh blok `NEWS_MEDIA_R2_*` tidak pernah ada di
  `.env.example`, jadi operator yang menyalin berkas itu tak punya cara menemukan
  lima variabel wajib `media_library`. Sekarang terdokumentasi.

- 3f9a2ab: ADR-0044 §4 Fase 2, langkah ketiga: jalur TULIS iklan free-URL ditutup, dan
  gerbang kesiapan yang membuat penghapusan tabel bisa dibuktikan alih-alih
  dipercaya.

  `POST /api/v1/blog/ads` dan `PATCH /api/v1/blog/ads/{id}` sekarang menjawab
  **410 ENDPOINT_RETIRED**, tanpa auth dan tanpa sentuhan basis data. Keduanya
  menyimpan `imageUrl` teks bebas — URL apa pun yang diketik admin, dirender
  langsung ke `<img src>` halaman publik. Itulah bypass managed-media yang ditutup
  ADR-0036, dan ia terbuka selama masih ada rute yang bisa menulisnya.

  **Urutannya yang menjadi isi perubahan ini.** Job ingest memindahkan apa yang
  ada saat ia berjalan. Jalur tulis yang masih terbuka membiarkan editor membuat
  iklan free-URL di jendela antara ingest dan penghapusan — iklan yang tidak
  bermigrasi ke mana pun dan lenyap saat tabelnya hilang, tanpa satu pun laporan
  menyebut ia pernah ada.

  Menutup `POST` saja tidak cukup: `PATCH` bisa menulis ulang `imageUrl` pada
  iklan yang sudah ada — bypass yang sama lewat rute yang lebih senyap, dan yang
  tidak menghasilkan baris baru untuk diperhatikan siapa pun.

  `GET` dan `DELETE` sengaja bertahan. Operator yang menyelesaikan laporan residu
  harus bisa membaca baris yang disebut laporan itu, dan mempensiunkan yang tidak
  ingin ia buat ulang — `blog:ads:drop-readiness` menghitung iklan yang
  soft-delete sebagai sudah-diputuskan.

  **`bun run blog:ads:drop-readiness`** menjawab "bolehkah kedua tabel lama
  dihapus sekarang?" dari data, dan keluar non-nol selama jawabannya belum.
  Migrasi penghapusan tak bisa dibatalkan dan membawa serta iklan situs hidup;
  seluruh pengaman epik ini menjadi hiasan bila langkah terakhirnya diambil atas
  dasar ingatan seseorang bahwa ia sudah menjalankan ingest. Kolom
  `source_legacy_ad_id` (`sql/079`) membuatnya jadi sebuah join.

  Iklan lama terhitung sudah-diputuskan bila ada baris penerus yang menyebutnya,
  ATAU bila ia soft-delete. Selain itu memblokir. **Tidak ada flag override** —
  gerbang yang bisa disuruh lulus adalah gerbang yang tak perlu dipenuhi siapa
  pun.

  Catatan proses: mutasi pertama saya terhadap query kesiapan (menghapus predikat
  `p.tenant_id = a.tenant_id`) **lolos ketujuh test** — RLS diam-diam mengerjakan
  apa yang diklaim predikat itu. Dua mekanisme diklaim, dan test yang tak bisa
  membedakannya hanya membuktikan setidaknya satu ada. Test kedelapan menjalankan
  penilaian yang sama sebagai peran admin yang melewati RLS sepenuhnya, sehingga
  predikatnya menjadi satu-satunya penghalang — dan mutasi itu kini merah.

- 267749e: feat(blog-content): blog pages can be published (ADR-0057)

  `pages.publish`, `pages.archive`, `pages.restore` and `pages.purge` have been
  seeded since `sql/036` and enforced by nothing. That was not a spare catalogue
  row: `createBlogPage` wrote a literal `'draft'`, `updateBlogPage` never touched
  `status`, and the scheduled-publish job reads only posts — so **no code path
  could publish a page**, while public page search filtered on
  `status = 'published'` and always returned nothing.

  Four guarded, audited, `Idempotency-Key`-bearing routes close it:
  `POST /api/v1/blog/pages/{id}/publish`, `/archive`, `/restore`, `/purge`.
  Publish runs the same content-quality checklist posts do, which the page
  preview endpoint has been reporting with nothing to gate.

  The page lifecycle is deliberately narrower than posts' — no `review`, no
  `scheduled`, since no `pages.schedule` permission was ever seeded. `purge`
  reports the ad placements it leaves inert rather than refusing or cascading.

  Also adds `bun run access:permissions:enforcement:check`: every declared
  permission must have an `authorizeInTransaction` guard or a recorded reason.
  It found five further gaps beyond pages, all now recorded and tracked.

  No migrations — the columns, CHECK, index and catalogue rows already existed.

- 505a5e4: `GET /api/v1/blog/posts` dapat traversal stabil ber-cursor — build feed tidak
  lagi berhenti di 100 post.

  Endpoint ini hanya punya `?limit=` (maks 100) dan tanpa cursor, jadi tidak ada
  cara membaca lebih dari 100 post. Adapter `awcms-astro` **melempar** saat
  menyentuh batas itu alih-alih memotong diam-diam, sehingga situs dengan lebih
  dari 100 artikel tidak bisa di-build sama sekali.

  Yang TIDAK dilakukan: menambahkan `?cursor=` ke urutan yang sudah ada.
  Default-nya `updated_at DESC` — benar untuk tabel admin dan tidak sah sebagai
  kunci keyset, karena menyunting sebuah post memindahkannya: satu baris bisa
  melintasi batas halaman di antara dua permintaan lalu terlewat atau muncul dua
  kali, dan tak ada apa pun yang bisa mendeteksinya. Sebuah cursor hanya sah di
  atas urutan yang tidak berubah oleh tulisan yang dibalapinya.

  Jadi `?order=created_at` memilih traversal stabil (kolom immutable) dan
  `?cursor=` hanya berlaku bersamanya; `?cursor=` di atas urutan default **ditolak
  400** dengan alasannya, bukan diam-diam dilayani. Default endpoint tidak berubah
  sama sekali — tabel admin tetap urut `updated_at`.

  `nextCursor` dicetak di lapisan yang masih memegang teks presisi mikrodetik,
  tidak pernah diturunkan ulang dari `Date` JS di rute. Itu bukan kehati-hatian
  teoretis: `timestamptz` menyimpan mikrodetik, `Date` hanya milidetik, dan driver
  MEMBULATKAN KE BAWAH — cursor dari `Date` menunjuk instant yang lebih awal dari
  barisnya sendiri dan melewatkan setiap baris yang berbagi milidetik itu (Issue
  #158; terukur: 105 baris → halaman 2 berisi 4, batch-insert → halaman 2 berisi
  0).

  Diverifikasi terhadap PostgreSQL nyata dengan kasus terburuknya: 25 post
  di-insert dalam SATU statement sehingga berbagi `created_at` sampai mikrodetik.
  Mutation-proven — mengganti sumber cursor jadi `new Date(row.created_at)`
  memerahkan 3 dari 5 test.

  `BlogPostSummary` mendapat field `createdAt` (aditif).

- 300a407: Add `?locale=` to `GET /api/v1/blog/posts`.

  This closes item 2 of `awcms-astro`'s ADR-0021 hold list, which recorded on 2 August 2026 that the filter was still absent and that the build therefore had to pull **every** locale and pair them up client-side — correct, and wasteful for a single-language site.

  Exact match, not a prefix: `en` does not sweep in `en-GB`. A `LIKE 'en%'` implementation would look right until someone published a regional variant they did not want served.

  Absent means every locale, which stays the correct default for the admin table — hiding a translation because the operator did not name its language would be the surprising answer. An **empty** `?locale=` is a 400 rather than being read as absent: a caller that meant to filter and silently got the unfiltered feed builds a site containing every translation of every article, and nothing anywhere fails.

  The shape is deliberately **not** validated beyond non-empty and a 35-character bound. `awcms_blog_posts.locale` is plain `text NOT NULL DEFAULT 'id'` and the write path accepts any non-empty string, so a read filter stricter than the write path would make a stored locale unreachable — a row that exists, that the admin table shows, and that no query can select.

  All three list functions take it (`listBlogPosts`, `listBlogPostsPage`, `listBlogPostsFullPage`), because the route branches between them on `view`/`order` and a filter wired into two of the three would stay invisible until someone changed a query string. `listBlogPosts` collapses its two-branch `status ? … : …` into the single `${param}::text IS NULL` statement its paged siblings already use — two optional filters written the old way is four copies of one SELECT, and a third would make it eight.

  Verified against a real database (`tests/integration/blog-post-locale-filter.integration.test.ts`, six tests) because the failure mode of a parsed-but-unapplied parameter is a 200 with the wrong rows — the same shape as the `view=full` defect this endpoint already shipped once. Mutation-proven: dropping the SQL predicate turns all six red, and dropping the parameter at one of the three route call sites turns the pure contract test red.

- a526e69: Give `business_scope_hierarchy` a real provider: `tenant_admin` resolves `office` scopes against `awcms_offices` (ADR-0060).

  `POST /api/v1/identity/business-scope/assignments` is permission-gated, SoD-evaluated, audited, idempotency-keyed and RLS-protected — and until now it refused **every input in every deployment**. Its only composition root injected a NO-OP adapter that resolved every scope to `resolved: false`, and the reserved `tenant` scope type is rejected by the validator as unassignable (#180 review F2), so both roads led to a denial. Everything downstream was dead with it: no assignment rows to read, so `businessScopeFacts` was never populated, the expiry job never had anything to expire, and SoD's `same_scope_only` matching never had a scope to match.

  The NO-OP was correct when written — ADR-0011/0014 expected a DERIVED application to inject its own hierarchy resolver — and then ADR-0034 deleted that pathway and ADR-0055 confined development to this repo. Its `providedBy` named `organization_structure`, a module ADR-0016 accepted and nobody ever wrote here. What was missing was never the hierarchy: `awcms_offices` has had `parent_office_id` since `sql/002`, FORCE RLS since `sql/017`, and a composite cross-tenant-proof parent FK since `sql/020`.

  The new adapter resolves the `office` scope type and nothing else. Only LIVE rows resolve — not soft-deleted, not `inactive`, same tenant only — and dead rows are skipped anywhere in a chain, so a live office under a deactivated parent gets a shorter ancestor chain rather than borrowing coverage through a resource its tenant switched off. Every bound REFUSES rather than truncates (cycle, depth, result count): a truncated list still claims `resolved: true`, which would answer a coverage question from part of the graph with no signal the rest existed.

  One read-path hardening ships with it: `resolveBusinessScopeFacts` minted a covers-everything fact from `scope_type = 'tenant'` alone. It now requires that row to name this tenant. No supported path can write such a row, which is exactly why the check belongs there — a row carrying it came from outside the service and passed no validation at all.

  The NO-OP adapter is deleted (zero callers once the root is rewired); `optional: true` stays on the consumption, so a tenant with no offices still works and still fails closed. Zero migrations, zero new permissions, no change to any existing endpoint's behaviour — a route must still opt into scope-gated authorization explicitly, and none does today.

- 1551473: `POST /api/v1/comments/admin/{id}/delete` — the moderator half of a transition
  this module has implemented since ADR-0041 (ADR-0058 §B).

  `applyModerationAction` has accepted `"delete"` all along, it is legal from all
  four non-terminal statuses, and the moderation queue can already filter on
  `deleted` — so moderators could see soft-deleted comments without being able to
  delete one. The only actor who could reach that state was the comment's own
  author, inside the edit window.

  This is the one irreversible moderator action, and it stays that way: `deleted`
  remains terminal and recovering a deleted comment remains an operator/database
  action. It is accepted because the state was already reachable, the row, body
  and append-only moderation history all survive, and every other moderator
  action is reversible and keeps the body in the queue — leaving no in-band
  answer for content that must be pulled permanently. Bulk moderation
  deliberately does not gain it.

  `delete` now also resolves the comment's open reports, alongside
  `approve`/`reject`/`spam`: a deleted comment cannot be acted on again, so
  leaving them open would inflate the queue's report count forever. No existing
  caller is affected — nothing could reach that branch with `delete` before.

  Permission-enforcement coverage moves from 202/205 with 3 exceptions to 203/205
  with 2, and the two that remain are exactly the revocations ADR-0058 §C/§D
  decided.

- 0385fb1: Terbitkan kosakata blok `content_json` sebagai kontrak yang bisa dibaca mesin,
  dan patok ketiga tempat ia dinyatakan agar tak bisa menyimpang diam-diam.

  Sampai perubahan ini kosakata itu hidup di dua tempat: tipe TypeScript
  `ContentBlock` (tak terlihat siapa pun di luar `tsc`) dan **satu kalimat prosa**
  di salah satu dari lima kemunculan `contentJson` di OpenAPI — empat sisanya
  hanya menyebut `type: object`. Konsumen yang membaca kontrak punya peluang empat
  dari lima untuk tidak mempelajari apa pun tentang isi field itu.

  Akibatnya nyata dan sudah terjadi: `awcms-astro` menurunkan ulang kosakata itu
  dengan membaca, lalu keliru dalam tiga hal sekaligus — mengarang tipe
  `ordered_list` yang tak ada, dan menjatuhkan `gallery` serta `video_news` karena
  keduanya tak punya field `text` sementara fallback-nya merender `text`. Tidak
  ada yang gagal di mana pun. Daftar bernomor keluar berbutir dan bagian bermedia
  lenyap dari halaman yang tayang.

  Kosakata yang hanya hidup di prosa akan diturunkan ulang, dan penurunan ulang
  itulah tempat ia patah.

  - `CONTENT_BLOCK_TYPES` — kosakata sebagai nilai RUNTIME, disatukan dengan union
    `ContentBlock` lewat assertion saling-assignable. Menambah varian ke union
    tanpa menambahnya ke konstanta (atau sebaliknya) **memerahkan typecheck**,
    bukan sebuah test yang mungkin tak dijalankan orang. Terbukti dua arah.
  - Skema `BlogContentBlock` + `BlogContentJson` di OpenAPI: `oneOf` enam varian
    lengkap dengan field-nya, dirujuk dari **kelima** kemunculan `contentJson`.
    Dua bentuk yang paling mudah salah tebak diberi catatan eksplisit — urutan
    adalah FIELD pada `list` (bukan tipe `ordered_list`), dan `gallery`/
    `video_news` TIDAK punya field `text`.
  - `tests/content-block-contract.test.ts` memaku kontrak OpenAPI dan `switch`
    renderer ke konstanta yang sama, plus menegaskan setiap tipe merender sesuatu
    yang tak kosong dan tak ada varian HTML mentah. Diuji dengan mutasi: kontrak
    menyebut tipe berbeda (1 merah), satu `contentJson` kembali `type: object`
    polos (1 merah), renderer berhenti menangani `gallery` (2 merah).

- c244697: Tutup dua celah keamanan yang asesmen 4 Agustus 2026 (§9.1, §9.2) temukan, keduanya
  di lapisan yang tak punya pemeriksa sendiri.

  **`AUTH_COOKIE_SECURE` tidak lagi gagal-terbuka saat tidak diset.** Aturan produksi
  `scripts/validate-env.ts` dulu hanya menolak string literal `"false"`, sementara
  runtime menyetel `secure: process.env.AUTH_COOKIE_SECURE === "true"`. Ejaan salah
  (`"1"`/`"TRUE"`/`"yes"`) memang sudah ditolak aturan tipe `bool` — diverifikasi
  dengan menjalankan validator, bukan membacanya — sehingga yang benar-benar lolos
  tepat satu keadaan, dan ia justru keadaan **bawaan**: variabel tidak diset sama
  sekali. Produksi seperti itu mengirim cookie sesi tanpa atribut `Secure` sambil
  `bun run config:validate` melaporkan konfigurasi bersih. Aturannya kini `!== "true"`
  dengan pesan yang menyebutkan nilai terbaca. Non-produksi sengaja tidak dituntut:
  dev berjalan di `http://`, dan `environments.md` sudah mencatat itu sebagai selisih
  per-environment yang disengaja.

  **`Cross-Origin-Opener-Policy` dan `Cross-Origin-Resource-Policy` kini dikirim**
  (`same-origin`, keduanya tanpa gerbang produksi — tidak seperti HSTS, keduanya tidak
  menunggu TLS). Keduanya "dianjurkan" OWASP Secure Headers Project dan berlaku di sini
  justru karena repo ini punya sesi manusia dan 42 halaman ber-render: COOP memutus
  tautan browsing-context-group ke window mana pun yang membuka kita, dan CORP menutup
  jalur penyematan `no-cors` yang CORS sendiri tidak tutup. Tidak ada kapabilitas yang
  hilang — repo ini tak pernah memancarkan `Access-Control-Allow-Origin`, gambar artikel
  disajikan origin R2 yang berbeda, dan Turnstile berjalan di frame anak yang tidak
  diatur COOP.

  Kedua perbaikan mutation-proven: mengembalikan aturan lama membuat test keadaan-ABSEN
  merah, dan asersi header menyasar NILAI-nya, bukan sekadar keberadaannya.

- 3beee6c: Core Web Vitals kini diukur di LAB — Opsi D ADR-0067, nol data pengunjung.

  Spec baru `tests/e2e/cwv-lab.e2e.ts` (harness E2E Playwright yang sudah ada,
  bukan harness kedua) mengukur **LCP** dan **CLS** halaman `/login` via
  `PerformanceObserver` ber-`buffered: true`, dengan CLS dihitung per definisi
  session-window CWV. Ambang kelulusan = ambang "baik" CWV (LCP ≤ 2500 ms,
  CLS ≤ 0,1) — sebagai batas LAB satu mesin: detektor regresi, BUKAN p75
  lapangan. INP sengaja tidak diukur/diklaim (tanpa interaksi nyata ia tidak
  bermakna di lab).

  Gerbangnya env-gated (`E2E_CWV_LAB=1`, dinyalakan job CI `e2e-smoke`); saat
  env tidak diset ia MENCETAK pernyataan skip eksplisit, dan saat berjalan LCP
  yang tidak terekam adalah kegagalan — gerbang ini tidak pernah hijau senyap.
  Script baru: `bun run perf:cwv:lab`. Tidak ada skrip klien, endpoint, tabel,
  atau sentuhan pada `visitor_analytics`; keputusan RUM (Opsi B) tetap milik
  pemilik produk — status ADR-0067 tidak berubah.

- 36d012f: Add the `/admin/data-lifecycle` console and put `data_lifecycle` in the admin sidebar.

  The module shipped its registry / legal-hold / dry-run / run-history API (ADR-0037) with no screen at all, so the entire surface was reachable only by `curl` and its own README recorded the screen as an open follow-up. The console renders the code-declared lifecycle registry, the legal-hold ledger with a place-hold form and per-hold release, the on-demand dry-run planner with its categorized counts, and the run history that is itself retention evidence.

  Reads reuse the same application functions the JSON endpoints call, inside one `withTenantOrThrow` transaction. Writes go to the guarded `/api/v1/data-lifecycle/*` endpoints — the two hold mutations with a fresh `Idempotency-Key` per click, the dry-run with none, because that endpoint mutates nothing and requires none. Real archive and purge stay job-only; the screen has no control for them because they have no HTTP surface.

  `legal_hold.create` and `legal_hold.release` are gated **separately**: `data_lifecycle.legal_hold_maker_checker` makes holding both a `critical` SoD conflict, so gating both controls on one permission — the tidier-looking choice — would be wrong for every real operator. `tests/admin-data-lifecycle-page-contract.test.ts` pins that, plus the page's six permission keys against what the routes enforce and the descriptor declares, so a plausible-but-unseeded key (`legal_hold.delete`, `plan.read`) cannot silently hide a panel from everyone including the owner.

- 9800a0e: Buat penolakan pool database tak bisa lagi menyamar sebagai data, dan hentikan
  inversi backpressure yang sudah hidup di jalur job.

  `withTenant<T>(...): Promise<T>` mengembalikan `503 DATABASE_BUSY` (breaker
  open / work-class saturasi) dan `409` idempotency lewat `as T` — cast yang
  artinya persis "berhenti memeriksa". Header-nya menyatakan "in practice every
  real call site uses `T = Response`"; itu sudah lama tidak benar. **58 berkas di
  `src/`+`scripts/` yang bukan handler HTTP** (15 di antaranya `.astro`) dan 24
  berkas test memakainya untuk mengambil DATA; begitu tipe-nya dijujurkan,
  compiler membuktikan 30 di antaranya benar-benar membaca field dari nilai yang
  bisa berupa `Response`.

  Kerusakannya nyata, bukan teoretis. `purgeExpiredAuditEvents` berjanji
  `Promise<number>`; di bawah work-class `maintenance` (SATU slot) ia
  mengembalikan `Response`. `runBoundedBatches` berhenti "sampai satu pass
  mengembalikan `count: 0`" — dan `Response` tak pernah `=== 0`, sehingga job yang
  seluruh tujuannya mengalah justru menjalankan 50 pass penuh per tenant ke
  database yang baru saja menolak, lalu melaporkan `totalCount` sebagai string
  `"0[object Response]…"` (karena `number + Response` itu konkatenasi). Test
  mutasinya mereproduksi persis output itu.

  Sekarang ada dua bentuk, dan compiler yang memilihkan:

  - **`withTenant(...)` → `Promise<T | Response>`.** Jalur request meneruskan
    `503`-nya apa adanya, lengkap dengan `Retry-After`; 275 pemanggilan di 204
    berkas rute yang callback-nya memang sudah mengembalikan `Response` tidak
    berubah satu baris pun (`Response | Response` itu `Response`).
  - **`withTenantOrThrow<T>(...)` → `Promise<T>`.** Untuk semua yang bukan handler
    HTTP. Melempar `DatabaseBusyError` yang MEMBAWA response `503` yang sama
    (jadi kedua bentuk tak bisa menyimpang), dan kini diklasifikasi `retryable`
    oleh job runner alih-alih jatuh ke `unknown`.

  Tak ada lagi satu pun `as T` di modul itu.

  `db:tenant-context:check` (baru, di rantai `check`) menutup dua sisa yang tak
  terlihat compiler: hasil `withTenant` yang **dibuang** (`await withTenant(...)`
  sebagai statement — 503-nya lenyap tanpa jejak), dan pemanggilan dari `.astro`,
  yang tak pernah dibaca `tsc --noEmit`. Gate itu langsung menemukan tiga
  pembuangan nyata di jalur auth: dua di antaranya melewatkan audit event
  `sso_account_linked`/`mfa_challenge_issued` sambil tetap menjawab seolah sudah
  tertulis.

- 4430aa4: The root discovery surfaces are edge-cacheable, and aggregate surfaces are now
  invalidated by the modules that author them (ADR-0061 §B).

  `serveDiscovery` accepts Astro's `locals` and publishes the resolved tenant after
  `build(ctx)` produces a payload; all six routes (`/robots.txt`, `/sitemap.xml`,
  `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json`) forward it. Three
  registry entries follow: `seo-robots` (600s, config-derived and the most stable),
  `seo-sitemap` (300s, index and child pages), `seo-feed` (300s, RSS/Atom/JSON with
  `?locale=` as the only permitted parameter).

  Publishing after the payload check matters here even more than it did for
  `/news/**`: `build` returns `null` for "sitemaps disabled", "feeds disabled" and
  "page out of range", all of which collapse into the same generic 404 as an
  unknown host. It also means `/sitemap-99999.xml` matches the surface but never
  publishes a tenant, so walking page numbers cannot fill the cache.

  Discovery bodies turn out to have two authors, and only one of them owned the
  surface. `PUT /api/v1/seo/config` now enqueues a purge — the tenant-wide
  `noindex` switch alone rewrites `/robots.txt`. But the bodies are aggregated from
  every `seo_facts` provider, so publishing a post changes `/sitemap.xml` without
  touching anything `seo_distribution` writes, and a module purge tags
  `t:<tenant>:m:<moduleKey>`, so `blog_content`'s purge could not reach it. Left
  alone that would have purged `/blog/{code}/feed.xml` on publish while `/feed.xml`
  — the same content — sat stale until TTL, with nothing reporting it.

  `enqueueModuleContentPurge` therefore also covers modules that declare a
  `consumes` dependency on the changing module and own a declared surface. It is
  read from the module registry, so `blog_content` never names `seo_distribution`;
  and it is limited to surface owners, because a ban on a key that tags no cached
  object matches nothing while the queue reports success.

  No migration, no permission, no OpenAPI change. With `EDGE_CACHE_MODE` unset the
  subsystem remains a no-op.

- dfd8e64: Host-resolved public surfaces can be cached at the edge (ADR-0061 §A).

  ADR-0042 §8 defines two sources for the tenant a cached object is tagged with,
  and prefers the one a route publishes on `locals.edgeCacheTenantId` — the only
  source available to a surface whose tenant comes from the request rather than
  from a path segment. That branch had no writer anywhere in the repo, so it was
  unreachable and every host-resolved surface was uncacheable by construction:
  edge caching accelerated `/blog/{tenantCode}/**` (the legacy shape) and nothing
  of the `/news/**` family that ADR-0059 made the go-forward one.

  The four `/news/**` routes now publish their resolved tenant through
  `publishEdgeCacheTenant`, and the registry declares `news-index`,
  `news-taxonomy` and `news-post` — mirroring the TTLs and reasoning of their
  `blog-*` counterparts, owned by `blog_content`, whose existing module purge
  already invalidates them.

  Publication happens only on the path that actually serves the resource. A 404 is
  a cacheable status, so publishing before the "no such post/term" branch would
  annotate a missing-resource 404 with `Surrogate-Control` while an unknown-host
  404 gets `private, no-store` — answering "does this hostname map to a live
  tenant?" from one request, through a second channel over the question the
  route family's latency padding exists to close.

  No migration, no permission, no OpenAPI change. With `EDGE_CACHE_MODE` unset
  (every deployment's default) the whole subsystem remains a no-op.

- a3d1dc2: Tegakkan bahwa setiap variabel env yang dibaca kode ada di `.env.example`.

  `tests/env-required-vars-doc.test.ts` sudah membandingkan daftar var **WAJIB**
  yang didokumentasikan dengan yang ditegakkan. Separuh yang lebih besar tak
  terjaga: var yang opsional tapi **mengubah perilaku**. Sebelas menumpuk di sana,
  termasuk:

  - **`TENANT_DOMAIN_DNS_PROVIDER`** — dua nilainya adalah "tak melakukan panggilan
    keluar sama sekali" dan "bicara ke API DNS sungguhan". Tak ada di
    `.env.example`, doc 18, maupun `validate-env.ts`.
  - **`R2_ACCOUNT_ID`/`R2_BUCKET`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`** —
    `R2_ENABLED=false` dikirim sendirian, jadi operator yang menyalakannya tak
    punya template untuk empat kredensial yang lalu diwajibkan uploader.
  - **Empat `SITE_SEARCH_*_RATE_LIMIT_*`** — kontrol penyalahgunaan pada dua
    endpoint publik anonim, bukan sekadar tuning.
  - `FORM_DRAFT_RETENTION_DAYS`, `OBJECT_SYNC_UPLOAD_TIMEOUT_MS`, dan blok
    `TENANT_DOMAIN_CLOUDFLARE_*`.

  Yang terakhir lebih buruk dari sekadar absen: `.env.example` merujuk "the
  `TENANT_DOMAIN_CLOUDFLARE_*` settings **above**" padahal tak ada satu pun di
  seluruh berkas itu.

  Nilai default yang dicatat diverifikasi ke kode, bukan ditebak — retensi form
  draft 30 hari (bukan 90) dan timeout object-sync 10000ms (bukan 30000).

  `config:env:coverage:check` (baru, di rantai `check`) menargetkan `.env.example`,
  bukan doc 18: berkas itulah yang **disalin** operator, sementara var yang hanya
  ada di prosa harus sudah diketahui lebih dulu untuk bisa dicari. Placeholder
  ber-komentar sudah cukup — pola yang sudah dipakai `EMAIL_MAILKETING_*` — jadi
  secret tetap tak masuk repo. Batas yang dinyatakan terbuka di header gate: ia
  hanya mencocokkan `process.env.X`, jadi modul config yang mengoper
  `env: NodeJS.ProcessEnv` lalu membaca `env.X` tak terlihat.

- c244697: Postur standar keluarga dan kontrak konsumen: tiga celah asesmen putaran kedua
  ditutup, satu dinyatakan terblokir dengan alasan eksternal yang diverifikasi.

  **Kontrak konsumen `awcms-astro` dipisah `CONSUMED` vs `COMMITTED`** (§9.5).
  `CONSUMER_PATHS` semula membekukan enam permukaan karena diturunkan dengan
  mem-grep repo sebelah **tanpa membuang komentar** — tiga di antaranya prosa: sebuah
  docblock tipe, sebuah komentar yang menjelaskan kenapa build justru TIDAK memanggil
  `/auth/session`, dan sebuah pesan error yang memberi tahu manusia cara menerbitkan
  kredensial. Repo sebelah punya jawaban otoritatifnya dan menggerbanginya ("tepat
  tiga permukaan", komentar dibuang lebih dulu). Kini tiga permukaan yang benar-benar
  dipanggil dipisahkan dari dua yang **dijanjikan ADR** tetapi belum dipanggil
  (`/auth/session`, `/access/machine-credentials` — keduanya milik BFF ADR-0050 yang
  belum dibangun). `/api/v1/blog/posts/{id}` keluar dari kontrak sepenuhnya:
  ADR-0018 di repo sebelah menghapus fetch per-id, jadi membekukannya mengikat repo
  ini pada bentuk yang tak punya pembaca. Tiap entri `COMMITTED` wajib menyebut ADR
  yang menjanjikannya, dan sebuah test menegakkan bahwa ADR itu punya berkas.

  **Dua lubang `bun run skills:check` ditutup** (§9.6). Pembebasan
  `ASPIRATIONAL_SKILLS` dulu bersifat per-SKILL dan **total**: `awcms-performance`
  terdaftar dengan alasan yang menyebut PERINTAH sementara pembebasannya juga menutupi
  PATH, sehingga skill itu bisa berkata "perintah ini tidak ada" di banner-nya dan
  "gunakan suite yang sudah ada di `src/lib/performance/`" enam puluh baris kemudian —
  direktori yang tidak ada — tanpa gerbang berpendapat. Kini ada blok bertanda
  `<!-- aspirational:mulai -->` yang membatasi pembebasan ke passage yang memang
  memerlukannya; sisanya tetap digerbangi, dan `awcms-performance` keluar dari daftar.
  Lubang kedua mekanis: ekstraktor path hanya melihat path berbacktick **satu baris**,
  sehingga path yang terpotong pembungkusan markdown tak terlihat — aturan 1 sebenarnya
  berbunyi "path yang disebut DAN kebetulan muat satu baris wajib ada", dan selisih itu
  tak tertulis di mana pun. Keduanya mutation-proven.

  **ADR-0068 menuliskan pin edisi standar dan tiga divergence keluarga.**
  `awcms-astro` ADR-0028 menyatakan mengikuti edisi OWASP repo ini dan tidak
  mendahuluinya — sementara keputusan itu tidak pernah ada, karena pinnya datang lewat
  sebuah skill lalu diikuti karena sudah tertulis. `intentionalDivergences` yang kosong
  sejak ADR-0055 kini memuat tiga entri ber-`reviewDate`: HSTS `includeSubDomains`
  (benar di kedua sisi, alasan berbeda), `.astro` tak-terperiksa-tipe, dan pin edisi itu
  sendiri.

  **`astro check` TIDAK bisa ditambahkan, dan itu diverifikasi bukan diasumsikan.**
  `@astrojs/check` menuntut API programatik TypeScript 6.x; repo ini di 7.0.2, yang
  tidak menyediakannya. Dipasang, dijalankan, ditolak, lalu dependensinya dicabut lagi
  alih-alih meninggalkan 73 paket yang tak bisa berbuat apa-apa. Dicatat sebagai
  divergence bertanggal, bukan sebagai janji.

  **ADR-0067 mendapat Opsi D — pengukuran lab.** Ketiga opsi draf pertama semuanya RUM,
  sehingga seluruh keputusan bertabrakan dengan postur privasi `visitor_analytics` dan
  menunggu. Pengukuran lab (Playwright, sudah terpasang) mengumpulkan **nol** data
  pengunjung dan menjawab pertanyaan yang berbeda — "apakah perubahan ini membuat
  halaman lebih lambat" — jadi ia tidak perlu menunggu keputusan RUM.

- 703f666: Foreign-key columns must be index-reachable — the repo's first performance gate
  (ADR-0064, `sql/090`).

  The 2026-08-04 assessment measured **zero of 28 gates** touching performance, so
  an unindexed foreign key lands with CI fully green and surfaces months later as
  "the admin screen got slow".

  Postgres indexes a foreign key's referenced side automatically and its
  referencing side not at all, so a bare FK column pays twice: every parent
  `DELETE`/`UPDATE` sequentially scans the child table to enforce the constraint,
  and the parent→child join has no index either. Measured here: 182 FK columns, 14
  unreachable, with `awcms_blog_ads` carrying no index at all beyond its primary
  key.

  The rule is tenant-aware — reachable means leading an index, or being the second
  column after `tenant_id`. The literal "must lead" rule is violated by 40 of 182,
  and forty migrations on the day a gate lands is not a gate but an exemption list
  waiting to be written. Since RLS `FORCE` guarantees every tenant-scoped query
  carries `tenant_id`, a `(tenant_id, fk)` composite is the index those joins
  actually use. The residual is stated rather than hidden: that composite does not
  help enforce the constraint on a parent delete. The relaxation is bounded and
  tested both ways — a second column after anything else does not count, and
  neither does a third column after `tenant_id`.

  `sql/090` adds thirteen indexes (additive, `IF NOT EXISTS`, no data moved).
  `awcms_setup_state.tenant_id` is the single exemption: a hard singleton holding
  exactly one row.

  Zero permissions, zero OpenAPI change, zero runtime change.

- 40f645a: feat(form-drafts): add the `/admin/form-drafts` ops screen and its sidebar entry

  `form_drafts` shipped a complete admin API but no screen and no `navigation`
  entry, so the module was invisible in the admin sidebar and the only way to see
  or clear a tenant's accumulated drafts was the JSON API or the daily
  `form-drafts:purge` job.

  Adds `/admin/form-drafts`: a filter bar (module key / wizard key / status)
  driving the same filters `GET /api/v1/form-drafts` accepts, the bounded
  newest-first list, a collapsed read-only payload inspector, and a per-row
  delete that calls `DELETE /api/v1/form-drafts/{id}`. Registered in the sidebar
  under System, gated on `form_drafts.draft.read`.

  Deliberately not included: a create form, a step editor, and a submit button.
  Drafts are produced by other modules' wizards, and submitting is a domain
  transition that wizard owns — a janitor screen that flipped a draft to
  `submitted` would report work as finished while nothing downstream ran.

  No schema, endpoint, or permission change.

- 1922f79: Add the host-resolved public content family `/news/**` (ADR-0059), and make the SEO discovery base path follow the route family that actually serves.

  `tenant_domain` has mapped hosts to tenants since #219 and the discovery surfaces (`robots.txt`, sitemaps, feeds) and `/search` have been host-resolved since #223/#231 — but the content those surfaces point at could only be read through `/blog/{tenantCode}/{slug}`. A tenant on its own domain therefore published URLs carrying the very identifier the domain exists to remove. Four routes close that: `/news`, `/news/{slug}`, `/news/category/{slug}`, `/news/tag/{slug}`, resolving the tenant from the request through `withHostResolvedBlogTenant` — the same shape as `site_search`/`comments`, including the latency padding that keeps "unknown host" and "live tenant" indistinguishable in time as well as in body. The family has its own per-tenant switch, `publicRouteMode`, symmetric with the legacy family's `legacyTenantRouteEnabled`.

  The backlog asked for `/blog/{slug}`, and that shape was refused with evidence: probed in this repo, Astro reports the route "is defined in both" `src/pages/blog/[slug].ts` and `src/pages/blog/[tenantCode]/index.ts`, still builds, and lets one silently shadow the other — "a collision will result in a hard error in following versions of Astro". Resolving the ambiguity at runtime would be worse: whoever can write a post slug could shadow another tenant's listing URL. The archived `publicBasePath`/`publicLabel` settings are not adopted either, because they move a page's links without moving the route that serves them.

  `seo_distribution` now chooses its base path instead of assuming one: `/news` while the host-resolved family is live, `/blog/{tenantCode}` when a tenant switched that off but kept the legacy family, and **no provider at all** when both are off — an empty sitemap rather than one full of certain 404s. That invariant is mutation-proven against a real database.

  Also corrected, because it was recorded as a decision: the "every sitemap `<loc>` 404s for host-resolved tenants" defect in `docs/PROJECT_STATE.md` never existed. `discovery-providers.ts` has scoped the adapter to `/blog/{tenantCode}` since the module landed (#223), and the `/blog` default it was blamed on has zero callers in `src/`.

  Zero migrations, zero permissions, zero OpenAPI change. `/news/**` is deliberately not yet a declared edge-cache surface: its path is identical for every tenant, so the cache key has to carry the host first.

- 2739d31: Tambah modul `idn_admin_regions` — master data wilayah administratif Indonesia
  yang ber-versi, ter-provenance, dan bisa di-rollback (ADR-0046).

  Hampir setiap aplikasi bisnis Indonesia di atas template ini butuh wilayah resmi:
  alamat pelanggan, cabang, wilayah kerja, agregasi laporan per provinsi. Tanpa
  modul bersama, setiap aplikasi menyalin CSV-nya sendiri — versi berbeda-beda,
  tanpa asal-usul, tanpa cara membuktikan versi mana yang sedang dipakai.

  Yang mendarat:

  - **Skema ber-versi** (`sql/080`): `awcms_idn_region_datasets` (satu baris per
    impor, dengan repo/commit/checksum/nomor Kepmendagri) dan
    `awcms_idn_admin_regions` (91.599 wilayah milik satu versi). Impor berikutnya
    menulis **di samping**, bukan menimpa — itulah yang membuat rollback jadi
    pembalikan status, bukan impor ulang.
  - **Impor sebagai JOB** (`bun run idn-regions:import`, dry-run default): mem-parse
    dump upstream sebagai TEKS (tanpa mesin SQL, tanpa MySQL, tanpa jaringan) dan
    menolak impor parsial — baris tak terparse, kode ganda, induk hilang, atau satu
    tingkat kosong semuanya menggagalkan impor. Dataset baru selalu mendarat
    `validated`, tak pernah langsung `active`.
  - **Aktivasi/rollback sebagai aksi admin ter-audit** (ABAC + `Idempotency-Key`),
    dengan aturan "hanya satu dataset aktif" ditegakkan **partial unique index di
    database** — bukan pemeriksaan aplikasi yang bisa disusupi dua request
    bersamaan.
  - **Lookup API** `/api/v1/idn-regions/*`: filter tingkat/induk/nama, paginasi
    keyset, default ke dataset aktif, dan `?dataset=<code>` untuk membandingkan
    versi lama.
  - **Dataset ter-vendor** (`data/idn-admin-regions/`, ~4,2 MB): agar impor
    deterministik dan offline, dan agar "versi wilayah mana yang jalan di build
    ini" terjawab dari commit, bukan dari keadaan internet hari itu.

  Dua keputusan yang mengikat pembaca berikutnya:

  - **Kedua tabel GLOBAL** — tanpa `tenant_id`, tanpa RLS. Provinsi "Aceh" sama
    untuk semua tenant. Yang menggantikan RLS bukan kepercayaan: keduanya wajib
    terdaftar di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` sehingga privilege tiap role
    dinyatakan eksplisit (`awcms_app` SELECT + UPDATE dataset saja, `awcms_worker`
    jalur tulis, **nol DELETE untuk keduanya**), dan setiap endpoint tetap melewati
    sesi + konteks tenant + ABAC default-deny. Yang global adalah BARISNYA, bukan
    izinnya.
  - **Ini bukan API resmi Kemendagri.** Dataset komunitas (`cahyadsn/wilayah`, MIT)
    yang mengemas Kepmendagri. Caveat itu dibawa di kode, di respons API, dan di
    layar admin — bukan hanya di dokumen. Nomor keputusan direkam **per berkas**
    dari header masing-masing: berkas yang diimpor menyebut **300.2.2-2138/2025**,
    sementara `awcms-mini` merekam satu kalimat menyebut 2430 untuk semua berkas —
    koreksi yang digerbangi test provenance.

  Diverifikasi terhadap PostgreSQL 18.4 nyata: 81 migrasi bersih, impor 91.599
  baris (38 provinsi / 514 kabupaten-kota / 7.285 kecamatan / 83.762 desa-kelurahan),
  impor ulang byte identik = no-op, dan nilai turunan yang mudah salah terbukti
  benar pada baris nyata (`Desa Adat` di Papua, `Kota Administrasi` di DKI, jalur
  leluhur "Papua, Kabupaten Jayapura, Sentani, Desa Adat Yoboi").

- fc138df: Kredensial mesin baca-saja + `GET /api/v1/auth/session` — dua kontrak yang
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

- 1b852b8: Revoke `media_library.media.attach` and `media_library.media.detach` (ADR-0056 §A).

  Both were seeded into the global permission catalog by `sql/052`, and `POST /api/v1/setup/initialize` grants that catalog whole to every new tenant's `owner` role. Neither was ever checked: no route, no application function, no job. They named a write that stopped existing at ADR-0036 — before that inversion, `awcms_news_media_objects.owner_resource_type`/`.owner_resource_id` held the object→content relation and attach/detach were real operations on this module's own table; after it, a media object's attachment is stated by the consumer's FK (`awcms_blog_posts.featured_media_id`, `awcms_news_portal_ad_placements.media_object_id`), so attaching means updating the consumer's row under the consumer's permission.

  `sql/087` deletes the grants first, then the catalog rows — reversed, the catalog delete hits the `awcms_role_permissions` FK. The two zero-caller functions (`attachNewsMediaObject`, `detachNewsMediaObject`) are deleted with them, and `media-object-directory.ts` keeps a marker where they were so the next reader learns why the module has no attach path rather than assuming one is missing.

  The `attached` **status** survives deliberately: `sql/041`'s CHECK still admits it and `isNewsMediaObjectSafeForPublicReference` still treats it as safe to reference, so any row already in that state keeps resolving. What is gone is the ability to write it — which nothing did. `verified` is what the finalize flow produces and it is equally referenceable.

  This is a real authorization change, and it is the narrow half of the ADR: `delete`/`restore`/`purge` are equally ungated today and are deliberately left alone here, because unlike these two they describe operator needs that currently have no answer at all. §B gives them endpoints.

  Also corrects ADR-0056 §A, whose first edition said all five dead functions were deleted — contradicting §B, which uses three of them. Two are deleted; three are kept and given a surface.

- ad5f1e6: Give `media_library`'s delete/restore/purge permissions the endpoints they never had (ADR-0056 §B), and fix a Postgres error-code check that could never be true.

  All three permissions have been in the global catalog since `sql/052`, granted whole to every tenant owner, and enforced by nothing — no route, no application function, no job. The functions behind them were written and had zero callers. So an object uploaded by mistake, orphaned, or violating policy disappeared only if the reconciliation job happened to categorise it that way, on the job's own schedule; there was no way for an administrator to remove one, and no way to undo it if they were wrong.

  - `DELETE /api/v1/media/objects/{id}` — soft delete, body `{ reason }` required and bounded at 500 characters. The reason is part of the request hash, so replaying one key with a different reason is a different request rather than a stored response describing a reason nobody sent.
  - `POST /api/v1/media/objects/{id}/restore` — the undo. A live object answers 404: "there was nothing to undo" and "it worked" must not share a response.
  - `POST /api/v1/media/objects/{id}/purge` — hard-deletes the registry row of an already soft-deleted object.

  All three are `HIGH_RISK_ACTIONS` and require `Idempotency-Key`, each under its own scope so a delete's key cannot collide with a purge's.

  **Soft delete breaks live references, deliberately.** `resolveMediaReferences` filters `deleted_at IS NULL`, so a post whose `featured_media_id` points at a deleted object resolves to nothing immediately. That is the intended outcome for the case this serves, and `restore` is what makes it recoverable. Nothing here scans for referencing rows first: that would make a System Foundation module know its own consumers.

  **`purge` clears the registry, not the R2 bytes.** The `news-media:reconcile` job owns the bucket; a second writer would mean two processes with different ideas of what is safe to remove. Accepted, stated cost: a window where the R2 object outlives its registry row, closed by the next reconciliation tick.

  `awcms_news_portal_ad_placements.media_object_id` is a hard NOT NULL FK, so purging a still-referenced object answers `409 MEDIA_OBJECT_REFERENCED`. That path runs inside a **savepoint** — in PostgreSQL a `23503` aborts the whole transaction, so catching it without one turns a caller-actionable 409 into a 500 at the COMMIT `withTenant` performs. Verified against a real database rather than reasoned about.

  That verification turned up a second thing. **The SQLSTATE is on `error.errno`, not `error.code`** — Bun sets `code` to its own `"ERR_POSTGRES_SERVER_ERROR"` for every server error alike, so `error.code === "23505"` is not a subtly wrong check but one that can never be true, leaving everything downstream of it dead. Ten sites in this repo already used `String(error.errno)`. One did not: `tenant-provisioning.ts`, where `POST /api/v1/tenants` promises `409 duplicate_tenant_code` and served a 500 on the concurrent-duplicate race the savepoint exists for (its pre-check SELECT hid the ordinary case). Fixed here rather than filed, and `tests/postgres-sqlstate-detection.test.ts` now gates it repo-wide — mutation-proven by restoring the original defect.

  `media_library` now has zero ungated permissions. ADR-0056 §C (a list function and its own route) is what remains before the screen.

- e5225e3: Add `listMediaObjects` and `GET /api/v1/media/objects/list` (ADR-0056 §C) — the last piece before `/admin/media`.

  Until now the application layer had only point lookups: `fetchNewsMediaObjectById`, `fetchNewsMediaObjectsByIds`, `fetchNewsMediaObjectByObjectKey`. There was no way to ask "what media does this tenant have", so a browse screen could not be built on the existing surface at all, whatever the permission catalog said.

  **It gets its own route rather than a mode on the resolver.** `GET /api/v1/media/objects` demands `?ids=` — it is a batch resolver built for the `awcms-astro` build to swap ids for public URLs. Teaching it a "no `ids` means list everything" branch would turn a request that is a 400 today into a dump of the entire registry: a contract change wearing the clothes of an addition, and one no existing caller could opt out of.

  `list` cannot be read as an object id, because `[id].ts` and its children now require a uuid and answer 400 otherwise. That closes the path ambiguity from the other side, so Astro's static-before-dynamic precedence is not the only thing keeping `/list` and `/{id}` apart.

  **The listing deliberately outgrows the resolver's safety rule.** It returns rows in any status — `pending_upload`, `failed`, `orphaned` — and, with `deletion=deleted|all`, soft-deleted ones. `isNewsMediaObjectSafeForPublicReference` admits only `verified`/`attached`; an administrator opens this list precisely because of the objects that are _not_ healthy, and §B's lifecycle endpoints would otherwise have no way to find their targets. `media.read` keeps it inside the tenant, and nothing returned here may be used as a public reference.

  `deletion` is three states rather than a boolean `includeDeleted`: "show me what I deleted" is the question restore and purge exist to answer, and a boolean cannot ask it. It defaults to `live`, so deleted objects are opt-in.

  Filters and cursors are **refused when malformed, never ignored** — a silently dropped filter answers 200 with a page nobody asked for, and a corrupt cursor treated as "no cursor" serves page 1 to a caller paging through page 4, forever.

  The cursor carries full-precision `created_at` text, never a JS `Date`. A media registry is one of the likeliest places to resurrect Issue #158, because a batch upload writes many rows inside a single millisecond. `tests/integration/media-object-list.integration.test.ts` inserts 107 rows in ONE statement — so they share a transaction timestamp exactly — and walks every page; reverting the cursor to `Date` loses 57 of them and turns four tests red.

  The projection omits `bucket_name`/`storage_driver` (deployment facts a browse screen has no use for) and `owner_resource_type`/`owner_resource_id` (vestigial since ADR-0036 moved attachment to the consumer's FK — shipping them would invite a screen to present them as current).

  ADR-0056 is now complete. What remains is the `/admin/media` screen itself.

- 7ff6aa9: `GET /api/v1/media/objects` — resolusi referensi media batch, sehingga artikel
  terbit tidak lagi kehilangan gambarnya di konsumen luar.

  `awcms_blog_posts` membawa `featured_media_id` dan `seo_image_media_id`, tetapi
  `media_library` **tidak mengekspos satu pun endpoint baca** — hanya upload
  session dan flag enforcement. Konsumen di luar proses karena itu bisa melihat
  bahwa sebuah post PUNYA gambar tanpa cara apa pun mengetahui URL-nya. Itulah
  sebab `article-images.ts` di `awcms-astro` mengembalikan `src: undefined` dan
  setiap artikel terbit tanpa gambarnya, sementara tidak ada satu pun yang gagal.

  Logika resolusinya bukan hal baru: `MediaLibraryPort.resolveMediaReferences`
  sudah melakukannya untuk konsumen in-process sejak ADR-0036. Ini panggilan yang
  sama lewat HTTP, dengan aturan keamanan yang sama — hanya objek `verified` /
  `attached`, satu tenant, tidak soft-deleted, yang resolve. Tanpa migrasi:
  permission `media_library.media.read` sudah diseed sejak `sql/052` sambil
  menunggu permukaannya (ADR-0026 langkah 5d).

  Dua keputusan bentuk yang tidak sepele:

  - **Batch, bukan satu-per-id.** Build feed me-resolve seluruh gambar satu halaman
    sekaligus; satu request per id membuat situs 200 post jadi ribuan round-trip,
    sementara query di bawahnya memang sudah satu `id = ANY(...)`.
  - **Id yang gagal DILAPORKAN, bukan dibuang.** Mengembalikan hanya yang berhasil
    membuat "resource ini tidak punya gambar" dan "referensi gambarnya rusak"
    menjadi respons yang sama — ambiguitas yang membuat celah ini bertahan tanpa
    disadari. Semua sebab kegagalan dilebur ke satu ember (`unresolved`) supaya
    endpoint-nya tidak jadi oracle atas sebab mana; id yang bukan uuid ditolak 400
    karena "Anda mengirim sampah" adalah fakta yang berbeda.

  Read-only, jadi kredensial mesin (ADR-0049) boleh memegangnya — inilah yang
  melengkapi build feed.

  Diverifikasi terhadap PostgreSQL nyata (7 test): objek belum-terverifikasi,
  soft-deleted, dan milik tenant lain masing-masing TIDAK PERNAH resolve; batch
  campuran resolve sebagian alih-alih gagal utuh; dan objek yang sama tetap
  resolve dari tenant pemiliknya (memastikan kegagalan lintas-tenant itu memang
  tenant scoping, bukan baris rusak).

- 2ac4708: `GET /api/v1/media/public-origin` — the origin media public URLs are served
  from, so a build client never holds a second copy of it.

  `awcms-astro` ships a strict CSP and must name the media host in `img-src` at
  BUILD time: an image resolved correctly still renders as nothing when
  `img-src 'self'` blocks the host it lives on. Reading the origin off a
  `publicUrl` does not help, because the policy is written before any object is
  fetched, and a build with no images would then emit no `img-src` at all. The
  only alternative left was copying `NEWS_MEDIA_R2_PUBLIC_BASE_URL` into the
  consumer by hand — two copies of one value that agree until one is edited, with
  a failure (images silently blocked) that names its cause nowhere.

  Reports `origin` (scheme + host + port, for the host-wide CSP form) and
  `baseUrl` (path included, for the tighter prefix form); neither choice is this
  API's to make.

  A deployment serving no public media answers `200` with `configured: false`
  rather than an error, so a LAN/offline build omits the entry instead of
  failing. A value that is set but unparseable — or on a scheme that cannot serve
  media, `data:` above all — is reported the same way and never echoed back:
  handing a consumer a malformed origin puts it in a CSP header, where a browser
  either rejects the whole policy or allows something nobody wrote down.

  Gated on `media_library.media.read`, the permission a build client already
  holds; no new authority on any credential, and machine credentials stay
  read-only (ADR-0049). No migration.

- 68da201: Lebur `news_portal` ke `blog_content` — satu modul konten, tanpa fitur hilang.

  `news_portal` sudah berhenti membawa bebannya sendiri. 11 berkas melawan 59,
  3 tabel melawan 18, nol capability disediakan, nol rute publik, dan konsumen
  WAJIB `public_content` milik `blog_content` — setiap tipe section homepage-nya
  dibangun di atas data modul itu. Seam capability ada untuk menggambarkan
  hubungan dua modul yang masuk akal berubah sendiri-sendiri; dua ini tidak bisa.

  Yang lebih menentukan: keduanya mengapalkan sistem iklan, dan yang satu
  melemahkan kontrol keamanan yang lain. `awcms_blog_ads.image_url` menerima URL
  apa pun, sementara `awcms_news_portal_ad_placements.media_object_id` adalah FK
  ke objek media terverifikasi. Selama keduanya hidup, sebuah tenant bisa
  menyalakan enforcement managed-media (ADR-0036) dan tetap menerbitkan gambar
  remote sembarangan lewat pintu yang lain.

  Tapi keduanya bukan fitur sama dengan dua ejaan. Yang lama punya penargetan
  `post`/`page` yang tidak dimiliki yang baru; yang baru punya 12 slot penempatan,
  4 mode rotasi, dan prioritas yang tidak dimiliki yang lama. Mengganti salah satu
  dengan yang lain akan menghapus kemampuan tanpa suara — jebakan yang justru
  menjadi alasan perubahan ini ditulis sebagai UNION, dan alasan penyatuan tabel
  iklan dikerjakan terpisah setelah tabel tujuannya diperlebar lebih dulu.

  Perubahan ini:

  - memindahkan 8 berkas `domain/`+`application/` ke `src/modules/blog-content/`;
  - **mempertahankan nama tabel dan path API** (`awcms_news_portal_*`,
    `/api/v1/news-portal/*`), mengikuti preseden ADR-0036 yang memindahkan
    registry media tanpa me-rename `awcms_news_media_objects`. Rename memakan
    setiap FK, policy, index, dan konsumen sambil tidak membeli apa pun yang
    descriptor dan inventori belum catat;
  - me-repoint 4 permission lewat `sql/076` dengan urutan insert → pindahkan
    grant → hapus. Urutannya adalah keseluruhan poinnya: menghapus lebih dulu
    akan mencabut kapabilitas dari setiap tenant yang memilikinya, dengan semua
    gerbang tetap hijau;
  - menaikkan `media_library` dari `optional` menjadi capability wajib bagi
    `blog_content`, karena ad placement yang diserap memegang FK nyata — itulah
    alasan `news_portal` dulu mendeklarasikannya non-optional;
  - men-DROP `awcms_news_portal_tenant_state` (`sql/077`). Penulisnya tidak pernah
    diport, jadi tabel itu inert; tabel FORCE-RLS tanpa pemilik dan tanpa penulis
    adalah klaim palsu yang berdiri di depan setiap gerbang inventori;
  - mempertahankan preset `news_portal` dengan namanya. Preset menamai niat, bukan
    modul, dan niatnya tidak berubah.

  `tests/news-portal-merge.test.ts` menjaga janji "union, bukan pengurangan":
  setiap fitur yang selamat dipaku ke sesuatu yang bisa diamati — entri registry,
  permission terdeklarasi, prefix rute yang diklaim, berkas di disk, atau urutan
  statement di migrasinya.

- 9ce56e2: Bandingkan dua registry job yang selama ini mendeskripsikan skrip yang sama tanpa
  ada yang membandingkannya.

  `JOB_WORK_CLASS_REGISTRY` menyatakan anggaran pool sebuah skrip, dan sudah
  ditegakkan ke ground truth — generatornya MENOLAK jalan saat peta dan disk
  berselisih. `ModuleDescriptor.jobs` menyatakan sebuah job untuk APA dan seberapa
  sering operator harus menjalankannya (`recommendedSchedule`), dan disajikan lewat
  `GET /api/v1/modules/{moduleKey}/jobs`. Yang pertama ditegakkan ke filesystem;
  yang kedua tidak ditegakkan ke apa pun.

  Akibatnya sebuah skrip worker bisa sepenuhnya masuk model kapasitas tapi tetap
  tak terlihat di satu-satunya permukaan yang dibaca operator untuk tahu bahwa job
  itu perlu dijadwalkan — dan dua memang begitu:

  - **`tenant-domain:dns:sync`** — modul `tenant_domain` tak mendeklarasikan `jobs`
    sama sekali. Deskriptornya ditambahkan (jadwal: tiap 15 menit; `manual` sebagai
    default tak melakukan panggilan keluar).
  - **`edge-cache:purge`** — tak ada modul `edge_cache` untuk menggantungkan
    deskriptornya: edge cache adalah infrastruktur `src/lib/` (ADR-0043), sementara
    `ModuleDescriptor.jobs` di-key per modul. Dicatat sebagai pengecualian dengan
    alasan STRUKTURAL, bukan "belum sempat".

  `modules:jobs:check` (baru, di rantai `check`) menegakkan keduanya: tiap skrip di
  work-class registry wajib punya deskriptor dengan `recommendedSchedule` tak
  kosong. Job yang tak dijadwalkan tak pernah jalan dan tak ada yang memberi tahu —
  tak ada gate, tak ada health check, tak ada alarm.

  Tabel §Job registry di `deployment-profiles.md` dihapus alih-alih diperbarui: ia
  salinan tangan yang menua persis seperti yang diperkirakan, memuat tiga command
  ERP yang tak pernah ada sambil melewatkan sepuluh job yang benar-benar dikirim.
  §Shared worker runner juga dikoreksi — ia mengklaim ketujuh dispatcher memakai
  `runJob`, padahal `email:dispatch` dan `sync:objects:dispatch` memakai claim-lease
  per baris, yang justru MENGIZINKAN worker paralel; empat job lain belum memakai
  keduanya dan kini terdaftar apa adanya.

- 285b73d: Tenant-module matrix and per-module audit summary — the rest of #261.

  `GET /api/v1/tenant/modules/matrix` returns every module with this tenant's
  enabled state, its protected flag, and two lifecycle warnings computed by
  re-running the REAL `evaluateModuleEnable`/`evaluateModuleDisable` rather than a
  UI-side re-derivation that would drift from the endpoints. Two queries total;
  the rest is pure.

  The warnings are one-directional on purpose — `dependencyWarning` only for a
  disabled module, `reverseDependencyWarning` only for an enabled one. The other
  combinations cannot arise, and asking `evaluateModuleEnable` about an
  already-enabled module short-circuits to `MODULE_ALREADY_ENABLED`: an answer
  that looks like a check and is not one.

  No health column, unlike awcms-micro's matrix: that one is fed by a batched
  health reader this base does not have, and a per-row read would be 21 queries
  inside one transaction.

  `GET /api/v1/modules/{moduleKey}/audit` returns recent module-management
  activity for one module, guarded by `logging.audit_trail.read` — these are
  audit-log rows, so the audit-log permission governs them. The caller-supplied
  `?limit=` is clamped to 1..50, with NaN/Infinity falling back to the default.

- 1ffb11c: Tenant module presets: named profiles a tenant can be brought to in one action.

  `minimal`, `website`, `news_portal` and `back_office`. A preset ENABLES what it
  lists and DISABLES every enabled, unlisted, unprotected module — enable-only
  would make presets useless as a way to REACH a profile, since a tenant that once
  enabled `blog_content` and then applied `minimal` would stay non-minimal
  forever.

  Ported from awcms-micro (Issue #261) with its planning logic intact, but not its
  preset set: `back_office` has no counterpart there, and micro's R2/SaaS presets
  are not reproduced because the subsystems that distinguished them do not exist
  in this base — a preset naming an absent module is a dead profile.

  `GET /api/v1/tenant/modules/presets?preset=<name>` returns a dry-run plan,
  because applying one disables things and an operator should see that list first.
  `POST /api/v1/tenant/modules/presets/{presetName}/apply` executes it through the
  existing lifecycle primitives, so each change runs the real validation and a
  rejection is reported per module rather than swallowed.

  No migration and no new permission: an apply is a sequence of enables and
  disables, so it guards on `module_management.tenant_modules.disable`.

- 049e36d: Make route ownership derivable: `ModuleApiContract.routes` and
  `modules:routes:check`.

  `basePath` was the only ownership claim a descriptor could make, and
  `tenant_admin` declared `basePath: "/api/v1"` — a prefix of every route in the
  application. Resolving a route to its longest-matching `basePath` handed
  `tenant_admin` 36 routes it does not own (all of
  `/api/v1/{access,roles,users,abac,identity}`, which are `identity_access`, plus
  `/api/v1/tenant/modules`, which is `module_management`), while 30 public routes
  matched nothing at all.

  `api.routes` is a list of owned prefixes, longest-prefix wins — because
  ownership genuinely is not one prefix: `/api/v1/tenant` is split between
  `tenant_domain` and `module_management`, and public surfaces (`/blog`,
  `/robots.txt`, `/search`, `/theming`, `/login`) belong to modules too.

  `bun run modules:routes:check` (check chain + `ci.yml`) requires every file
  under `src/pages` outside `/admin/**` to resolve to exactly one module or be
  named in a reviewed `PLATFORM_ROUTES` allow-list. It also rejects `/`, `/api`
  and `/api/v1` as claims outright — a coverage-only rule cannot see them, since a
  prefix matching everything leaves nothing uncovered.

  `MODULE_CONTRACT_VERSION` 2.3.0 -> 2.4.0 (additive; `routes` omitted means
  `[basePath]`). `openapi_documented` readiness now checks every owned prefix
  rather than the display `basePath`, which for `tenant_admin` had been matching
  any path at all.

- f8d9c39: `bun run identity-access:permissions:backfill` — tutup celah yang dibuka SETIAP
  migrasi seed permission, tanpa menghidupkan kembali grant yang sengaja dicabut.

  Role `owner` sebuah tenant menerima izinnya **sekali**, saat tenant itu dibuat
  (`platform-bootstrap.ts`: `INSERT … SELECT id FROM awcms_permissions`). Migrasi
  seed berikutnya hanya memperluas katalog global. Jadi setiap tenant yang lebih
  tua dari sebuah modul akan menerima `403 ACCESS_DENIED` pada permukaan admin
  modul itu, dan tidak ada satu pun yang mengatakannya. Ini sudah terjadi di
  produksi (2026-07-26: owner kehilangan 18 permission setelah migrasi 062–070) dan
  akan terjadi lagi pada `sql/083`.

  **Kenapa "grant semua yang hilang" ditolak.** Bentuk itulah yang dianjurkan
  `environments.md` sebelumnya (`LEFT JOIN … WHERE rp.permission_id IS NULL`), dan
  ia tidak bisa membedakan "belum pernah ada saat tenant dibuat" dari "dicabut
  admin dengan sengaja" — surface role admin memang menyediakan penghapusan itu.
  Ia akan mengembalikan persis grant yang seseorang putuskan untuk dihapus, di
  seluruh tenant sekaligus, tanpa jejak. Arah kegagalannya juga yang paling buruk:
  melewatkan sebuah permission terlihat sebagai 403 yang bisa dilaporkan; memberi
  permission yang tak seharusnya tidak terlihat sama sekali.

  **Aturannya**: hanya permission yang **baris katalognya lebih baru** dari role
  owner yang di-grant. Yang lebih tua tidak mungkin merupakan tambahan yang
  terlewat — ia ada saat seed pertama, jadi ketidakhadirannya adalah keputusan.
  Perbandingannya `>` bukan `>=`: bootstrap menulis role dan grant-nya dalam satu
  transaksi, sehingga permission ber-stempel sama dengan role-nya JUSTRU bagian
  dari seed asli.

  Dry-run **default** (`--commit` untuk menulis, `--tenant <kode>` untuk rollout
  bertahap), idempoten (`ON CONFLICT DO NOTHING`), satu entri audit per tenant yang
  benar-benar berubah — dan tidak ada entri saat tak ada perubahan, karena log
  pemeliharaan yang berbunyi di setiap no-op melatih pembacanya untuk
  mengabaikannya. Role kustom tidak pernah disentuh.

  Diverifikasi terhadap PostgreSQL nyata (6 test integrasi) termasuk hal yang
  paling penting: 403 yang jadi alasan tool ini ada benar-benar hilang setelah
  backfill, sementara permission yang sengaja dicabut **tetap** ditolak sesudahnya.
  Aturannya mutation-proven: mengganti seleksinya jadi "semua yang hilang"
  memerahkan 3 test unit dan 4 test integrasi.

- 5702ab1: Ownership-based grants now run through the authorization chokepoint (ADR-0063).

  Three handlers — `PATCH /api/v1/blog/posts/{id}`,
  `POST /api/v1/blog/posts/{id}/submit-review` and `PATCH /api/v1/blog/pages/{id}`
  — decided permissions themselves from `fetchGrantedPermissionKeys` plus a domain
  rule, never calling `authorizeInTransaction`. That skipped the ABAC evaluator,
  the ADR-0053 platform-scope gate, ADR-0060 business-scope facts and #181 SoD. The
  visible consequence: a tenant's explicit ABAC `deny` was honoured on some routes
  and silently ignored on these three.

  None of the three was sloppiness. They enforce the product rule that an author
  may edit their own unpublished content **even without** holding the permission —
  an authorization axis the permission catalogue cannot express — while the
  chokepoint returns `denied` before any domain rule is consulted. Putting it in
  front would have deleted the author path: a functional regression that looks like
  a security tightening.

  `authorizeInTransaction` therefore gains `ownershipGrant`, which **widens** the
  permission set being evaluated instead of short-circuiting the decision. Tenant
  isolation, an ABAC deny, business scope and SoD can all still refuse. Machine
  credentials are excluded, since a credential authenticates and never authorizes.
  The decision log labels ownership allows `ownership_grant:<reason>` so an auditor
  can tell them from RBAC allows.

  New gate `bun run access:chokepoint:check` holds the class: every handler calling
  `fetchGrantedPermissionKeys` must go through the chokepoint or be a reasoned
  exemption keyed `<file>#<METHOD>`. It slices **per handler**, because a per-file
  reading is what produced the original mis-analysis — `blog/posts/[id].ts` calls
  the chokepoint in `GET` and `DELETE` while `PATCH` did not. Two exemptions:
  pre-authentication login, and the self-introspection endpoint that calls
  `evaluateAccess` directly.

  Behaviour changes in one direction only: an action that previously slipped past
  ABAC can now be refused by a tenant's own policy.

  No migrations, no new permissions, no OpenAPI change.

- 6ed60e0: Add email password reset — the flow this repo has shipped a template for since
  `sql/014` and never had a caller for.

  `email`'s `auth.password_reset` category, default template, and declared
  variables (`userName`/`resetUrl`/`expiresInMinutes`) have existed unused all
  along, so an operator who locked themselves out had no in-band recovery. Two
  public endpoints (`POST /api/v1/auth/password/{forgot,reset}`), two pages
  (`/forgot-password`, `/reset-password`), and one table (`sql/073`,
  `awcms_password_reset_tokens`, RLS `FORCE`, only a `sha256` of a 256-bit CSPRNG
  token ever stored) close it. Adapted from awcms-micro Issue #496.

  **Neither endpoint is an oracle.** `forgot` returns one fixed 200 body for
  every outcome — unknown identifier, inactive identity or tenant-user, SSO-only
  identity, a non-mailable identifier, and a queued email are indistinguishable.
  `reset` returns one generic rejection for not-found, expired, already-used,
  deactivated-since-issue and password-login-disabled-since-issue. The specific
  reason survives only in the tenant-scoped, RLS-protected audit trail.

  **Single use is enforced by the database, not by JavaScript.** Redemption reads
  the token `FOR UPDATE`; without that lock two requests carrying the same link
  both observe `used_at IS NULL` and both reset the password. That is
  mutation-proven — removing the lock turns the concurrency test red.

  **An SSO-only identity cannot recover a password**, checked on the request path
  and re-read at redemption so a live link does not survive the tenant turning
  password login off. Without it, reset would be a supported, unauthenticated way
  to mint a working password on a tenant that deliberately disabled them.
  Break-glass identities are exempt, matching `login.ts`.

  **A completed reset revokes every session of that identity**, `aal2` included,
  and clears the lockout counters — the link holder proved control of the mailbox.

  **Delivery goes through a new `auth_notification` capability port**, not an
  `INSERT` into `awcms_email_messages`. That table belongs to `email` (ADR-0013
  §6) and the micro original wrote into it directly; it also cannot be a
  `dependencies` edge, because `email` already depends on `identity_access` and
  the reverse would close a cycle. A tenant with no active template reports
  `delivery_unavailable` — logged and audited for the operator, invisible to the
  caller.

  Optional hardening: with `AUTH_URL_PARAM_ENCRYPTION_KEY` set, the emailed link
  carries one opaque AES-256-GCM `?p=` value instead of `?token=…&tenantId=…`.
  Unset, it falls back to plain params — the token is a 256-bit CSPRNG value
  either way, so this tightens a deployment rather than gating the feature.

  Also: `/login`'s auth styles move to a shared `src/styles/auth.css` and its
  tenant picker to `tenant-admin`'s `tenant-picker-directory.ts`, both now used by
  all three auth pages instead of being copied twice.

- a30eb06: Add PLATFORM-scoped permissions, and bring back the region-dataset console at `/admin/idn-regions`.

  ADR-0051 made a rule normative — an action whose effect crosses tenant boundaries must have a platform-scoped gate and must not sit in the catalogue seeded to tenant roles — but the primitive that rule needs did not exist. ADR-0052 therefore could not guard region-dataset activation/rollback; it could only delete them. This builds the gate (ADR-0053) and restores the surface behind it.

  `awcms_permissions` gains a `scope` column (`tenant` | `platform`, default `tenant`), declared in code as `ModulePermissionDescriptor.scope` (`MODULE_CONTRACT_VERSION` 2.5.0, additive). The blanket grant in `bootstrapPlatformTenant` — `SELECT id FROM awcms_permissions`, which is what handed cross-tenant authority to every tenant owner in the first place — now filters on it, so the next platform permission is safe the moment it is declared rather than the moment someone remembers. The owner backfill excludes them too.

  Platform authority belongs to the platform tenant, resolved `PLATFORM_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_CODE` → `awcms_setup_state.tenant_id`, and held by that tenant's `owner` role. `authorizeInTransaction` refuses a platform-scoped permission unless the acting tenant is that tenant — decided before permissions are looked up, and fail-closed when none resolves, so a grant row that reached the wrong tenant is inert rather than sufficient. The trigger is read from the code declaration, not the database column: were both the database, one `UPDATE` would remove the gate along with the grant filter and nothing would go red.

  Tenancy mode (`single`/`multi`) is derived from the active-tenant count, never configured — a stored flag would have to be flipped by whoever provisions tenant number two, and forgetting means the deployment keeps behaving as if one tenant owned everything. The mode never relaxes a gate.

  While `PLATFORM_TENANT_ID` is unset, `PUBLIC_DEFAULT_TENANT_ID` is a security control: repointing which site renders on an unmatched host also repoints platform authority. That is a deliberate trade-off, made separable without a migration by the dedicated variable, and made visible by a new `security:readiness` check that reports which tenant holds the authority and warns when it is not the bootstrap tenant.

- bc0ab66: `POST /api/v1/profiles/{id}/restore` — the counterpart `DELETE
/api/v1/profiles/{id}` shipped without (ADR-0058 §A).

  `sql/003` gave `awcms_profiles` `restored_at`/`restored_by` and an index on
  `(tenant_id, deleted_at)`, and `party-directory.ts` exported `softDeleteParty`
  with nothing to undo it. Nothing in the repo could write either column, so a
  soft-deleted profile was permanent while `profile_management.restore` sat
  seeded in the catalogue and enforced by nothing.

  The precondition is the `WHERE … deleted_at IS NOT NULL`, not a read before the
  write: two concurrent restores that both read first would both proceed and
  audit two restorations of one profile. `delete_reason` is kept — why the
  profile was deleted stays true after it is restored. A profile that does not
  exist and a profile that is not soft-deleted answer the same 404, so the route
  cannot be used to probe which profile ids exist.

  Permission-enforcement coverage moves from 201/205 with 4 exceptions to 202/205
  with 3.

- a21f684: Beri `--dry-run` pada dua job retensi destruktif yang selama ini tak punya, dan
  hentikan headernya mengklaim kemiripan yang tidak ada.

  `form-drafts:purge` **menghapus baris secara fisik**; `comments:retention`
  meng-NULL-kan kolom identitas penulis **secara tak terbalikkan** lalu menghapus
  langganan yang tak pernah dikonfirmasi. Keduanya menyatakan di headernya sendiri
  bahwa mereka meniru `scripts/audit-log-purge.ts` — yang sudah punya pratinjau
  sejak dikirim. Keduanya tidak. Jadi satu-satunya cara mengetahui radius ledakan
  run pertama adalah menjalankannya.

  Dua hal yang membuat pratinjau ini bukan sekadar penghitung:

  - **Satu fungsi cutoff, dipakai bersama.** `resolveFormDraftRetentionCutoff` dan
    `resolveCommentsRetentionCutoff` diekstrak, lalu jalur nyatanya ikut memakai —
    dua salinan `now - days * 86400000` akan menyimpang begitu salah satunya
    diedit, dan pratinjau yang tak sepakat dengan run yang dipratinjaunya lebih
    buruk daripada tak ada.
  - **Legal hold ditanya, dan dilaporkan.** Deskriptor yang di-hold membuat run
    nyata tak menyentuh apa pun; pratinjau yang mengabaikannya akan melaporkan
    backlog yang tak akan pernah disentuh run mana pun — justru angka yang paling
    mungkin ditindaklanjuti operator. `comments:retention` melaporkan
    `heldTenants` supaya "tak ada yang perlu dikerjakan" bisa dibedakan dari
    "sedang di-hold".

  Header keduanya juga dikoreksi: alih-alih mengklaim meniru job yang memakai
  `runJob`, keduanya kini menyatakan apa yang memang TIDAK mereka punya (advisory
  lock, telemetry `JobResult`, cancellation kooperatif) dan bahwa karenanya
  keduanya harus dijadwalkan dari SATU entri cron. Migrasi ke `runJob` tetap
  dilacak di isu #291.

- 5935dc7: Revoke `blog_content.seo.configure` and `blog_content.posts.export`
  (ADR-0058 §C/§D, `sql/089`), completing the ADR and emptying the
  permission-enforcement exception list.

  Both were seeded by `sql/036` and declared by the descriptor, and neither ever
  had an enforcer. They are revoked rather than surfaced for different reasons:
  `seo.configure` is a second authorisation axis over
  `seo_default_title`/`seo_default_description`, which
  `blog_content.settings.configure` already governs through
  `PATCH /api/v1/blog/settings`; `posts.export` has no export machinery anywhere
  in the repo, so building one to justify a catalogue row would be the tail
  wagging the dog.

  Because `POST /api/v1/setup/initialize` grants the whole catalogue to each new
  tenant's `owner` role, every tenant owner has been holding authority over two
  actions nothing checks. No behaviour changes — nothing ever read them.

  The migration deletes the role grants before the catalogue rows (the FK runs
  that way), is idempotent, and ships no rollback: restoring the grants would
  re-advertise a surface that does not exist.

  `bun run access:permissions:enforcement:check` now reports **203/203 with zero
  exceptions** — every declared permission in the repo has an enforcer.

- ac7503d: Add admin-approved self-registration — off by default, and it never stores a
  credential.

  `POST /api/v1/auth/register` records a request; `/admin/registrations` reviews
  it; approval creates the account. Two migrations (`sql/074` schema, `sql/075`
  permissions), one public page (`/register`), three guarded admin endpoints.

  **Off unless `AUTH_SELF_REGISTRATION_ENABLED=true`**, and a disabled deployment
  answers `404` — the same answer a nonexistent route gives, so the switch is not
  discoverable by probing. An always-on public endpoint that writes a row is a
  spam surface every deployment would otherwise inherit. It is a deployment-level
  gate like `AUTH_MFA_ENABLED`, so turning it on opens registration for every
  tenant; per-tenant granularity is recorded as a follow-up rather than implied.

  **The public path creates no account and accepts no password.** It writes a
  `pending` row and nothing else, rejects every privilege field (`roleIds`,
  `status`, `tenantUserId`), and the validator returns exactly two keys — proven
  twice, at runtime by asserting the returned key set and structurally by
  enumerating which fields are read off the untrusted body. Mutation-proven:
  leaking `roleIds` through the validator turns both red.

  **Approval issues a credential the applicant must claim, which is a deliberate
  departure from awcms-micro.** micro stores an argon2id hash chosen by an
  unverified stranger for an account that may never exist. Here the identity is
  created with an _unusable_ password — the hash of 32 CSPRNG bytes discarded
  immediately — and the applicant receives a password-reset link through the same
  flow `/forgot-password` uses. So no anonymous submitter's secret is ever stored,
  a rejected or abandoned request leaves no credential behind, a spam flood costs
  an INSERT rather than an argon2id hash, and the applicant proves mailbox control
  before the account works. The cost is stated rather than hidden: `approve`
  returns `delivery: "queued" | "unavailable"` so the admin screen can say when
  the link could not be sent instead of showing a success for an account nobody
  can get into.

  **Enumeration-safe.** An address that already has an account, one with a request
  already pending, an inactive tenant and a fresh request all return the identical
  200 — "this address is already registered" is the single most useful sentence an
  attacker could be handed here. The audit event records which it was, without the
  submitted address on a miss.

  **`approve` and `reject` are separate permissions** under a new
  `registration_requests` activity. `access_control` is the RBAC catalog, not the
  authority to admit a person, and `/api/v1/users` in this repo is read-only — so
  approval is the first admin path that materializes an identity at all, and
  clearing spam should not require the ability to admit anyone. `roleIds` is
  optional and defaults to none; an unknown role refuses the whole approval rather
  than granting the subset that resolved.

  **Approval is race-safe**, with `FOR UPDATE` on a `status = 'pending'`
  predicate. Mutation-proven: without the lock two concurrent reviewers trip
  `awcms_identities_tenant_login_key` mid-transaction and the second gets a 500;
  with it, a clean 404. Correctness was never at risk — the failure mode was.

  Rejection notifies nobody: a rejection email would confirm to an anonymous
  submitter that this tenant exists and reviewed them, which is exactly the
  disclosure the submit endpoint refuses to make.

  Reviewed rows are purged by the existing `data_lifecycle` GENERIC engine (90d
  default, 7d floor so the `registration_approved` audit row still points at
  something); the worker grant is `SELECT, DELETE` only — one able to write here
  could manufacture an approved registration.

- 2b92a68: Admin screen for `seo_distribution` at `/admin/seo`, plus the sidebar entry that makes it reachable.

  The module shipped a complete admin API (tenant SEO defaults, redirect rules, redirect policy, 404 governance) but no screen, and declared no `navigation` — so every one of its permissions was routed while the module stayed invisible in the sidebar. One page now carries four panels: SEO defaults, redirect policy, redirect rules (create with a read-only dry run, inline edit, activate/deactivate/archive, soft delete, and an id-addressed restore/purge panel because soft-deleted rules are excluded from the list), and the privacy-minimized 404 log (resolve / dismiss).

  Reads run server-side through the same application-layer functions the JSON routes use, inside one tenant transaction; every write goes out over `fetch` to the guarded endpoints, with a fresh `Idempotency-Key` per click on the four high-risk mutations. Permission gates are UX-only — notably the lifecycle endpoint's dynamic guard is honored: Purge is gated on `seo_distribution.redirect.delete` and activate/deactivate/archive/restore on `seo_distribution.redirect.update`. Bulk import and URL-change capture stay API-only.

- f0d90a6: Build the `awcms` half of ADR-0050: a BFF obtains a human session with a one-time handoff code, never by proxying a password.

  ADR-0049 answered half the question — a BFF that already holds a session token can ask "whose session is this". Where the token came from was still document-only. `awcms_session` is an httpOnly cookie on the `awcms` origin; a browser on the `awcms-astro` origin will never send it, and must not.

  The obvious workaround — a login form in `awcms-astro` proxying `POST /api/v1/auth/login` — was rejected twice over: a password would cross a repo that is not the identity store, and **login here is not one step**. It can answer `401 MFA_REQUIRED`, redirect into a tenant's OIDC provider, or demand a Turnstile token, so proxying means a second implementation of MFA continuation, OIDC callback, and the Turnstile widget in a second repo.

  **Two endpoints, two different principals:**

  - `POST /api/v1/auth/session-handoff/issue` — the already-authenticated human asks for a code. Self-service rather than permission-gated: the identity and assurance come from the presented **session**, never from the body, so a caller can only ever mint a code for themselves. Inventing a permission here would be the latent-authz trap this repo has shipped twice.
  - `POST /api/v1/auth/session-handoff/redeem` — a registered client, server-to-server, with a client secret. The only endpoint in this repo authenticated that way, which is why `_shared/tenant-route.ts` gains a third factory: this is the request that _obtains_ a session, so there is none to present, and a machine credential (read-only by construction) minting a human session would be an escalation path.

  **What binds the security:**

  - **Exact-match `redirect_uri` allow-list.** ADR-0050 names the open redirect here as the way this design fails. Not a prefix — `https://app.example.com` prefix-matches `https://app.example.com.evil.test` — and not an origin match either, since an attacker who can choose the path on a permitted origin is enough. Query strings and fragments are refused rather than stripped.
  - **The code carries no token.** The row stores `identity_id` plus the assurance the login actually _reached_; redemption mints a fresh session. Nothing credential-bearing is stored but the one-way hash of the code, and assurance never rises, so an `aal1` login cannot be laundered into an `aal2` session.
  - **Single-use under concurrency**, claimed with `UPDATE … WHERE redeemed_at IS NULL RETURNING …`. The read-then-write version lets two simultaneous redemptions both succeed.
  - **The spent row is kept**, so a replay is answered from evidence — a deleted row and a code that never existed are indistinguishable, and that difference is what an incident needs.
  - **One answer for every failure** (`401 HANDOFF_REJECTED`), including a malformed body: a 400 for "you forgot a field" and a 401 for "your secret is wrong" already separates well-formed guesses from malformed ones.
  - The ≤60 second TTL is a database CHECK, not only a TypeScript constant.

  **A trap the integration test caught, and reading would not have.** `created_at DEFAULT now()` is the _transaction start_ instant while `expires_at` is derived from the application clock — two different clocks, so the `expires_at <= created_at + 60 seconds` CHECK rejected perfectly ordinary codes once a transaction had been open for a moment. The application now writes both from one clock.

  Ten integration tests, including two concurrent redemptions on separate connections (mutation-proven: dropping the `redeemed_at IS NULL` guard mints two sessions from one code) and cross-tenant isolation. Eighteen pure tests over the redirect-uri and redemption decisions.

  What remains is `awcms-astro`'s: `/internal/login`, server-side BFF session storage, the portal cookie, and CSRF.

- 9c7eeb7: Rate limiting becomes a property of the deployment, and covers the whole
  authentication surface (ADR-0066).

  The limiter counted in an in-process `Map`, so with N replicas the effective
  limit was N × the configured one — anti-brute-force weakening in direct
  proportion to replica count, leaving the deployments that most need protection
  the weakest.

  `checkSharedRateLimit` counts in Redis, which the repo already had. The window
  number is part of the KEY rather than a stored timestamp, which is what makes it
  correct where the `Map` is not: two instances agree without a read-modify-write,
  so there is no race to win. `PEXPIRE` fires only on a window's first hit —
  re-setting it every hit would slide the window and let a steady attacker hold
  the key alive indefinitely. With no Redis configured it falls back to the map,
  since a single-instance deployment has nothing to share.

  **It fails OPEN when Redis is unreachable.** That is the opposite of this repo's
  default posture, so: a rate limiter is availability tooling on the login path,
  and failing closed would turn a Redis outage into "nobody can log in" — an
  attacker-triggerable denial of the whole control plane. The per-identity lockout
  is enforced atomically in PostgreSQL and is unaffected, so this is the
  source-scoped backstop rather than the last line.

  Coverage rises from eight surfaces to eleven: `session-handoff/issue`,
  `session-handoff/redeem` and `sso/{providerKey}/callback` had none. Each had
  other mitigations, so this is completeness rather than a hole — but ASVS V11.2
  wants anti-automation across the whole authentication surface.

  No migrations, no permissions, no OpenAPI change.

- c74d4d1: Per-tenant admin sidebar arrangement: reorder, hide, relabel, move between
  sections, and custom sections.

  The sidebar has been rendered from the module registry since #259. This adds the
  override layer on top of it (`sql/071`, `sql/072`), plus
  `/api/v1/tenant/navigation/sidebar` and an `/admin/sidebar-menu` editor.

  Stored as a DELTA, never a snapshot: a tenant with no rows renders exactly the
  code default, so a newly added module's nav entry appears everywhere without a
  data migration. A snapshot would freeze each tenant's sidebar at the moment they
  first touched it.

  A tenant can override, never inject. Every stored row is resolved by key against
  the code-derived model and one that matches nothing is ignored, so there is no
  path from a request body to a new menu link. Overrides are applied BEFORE
  permission and tenant-disable filtering, so relabelling or moving an entry
  cannot carry it past `requiredPermission`.

  `module_management.navigation.configure` gates the mutations. Existing tenants
  do not gain it automatically — `sql/072` carries the operator backfill note.

- 23ce7bb: Add the `/admin/site-search` operations console and put `site_search` in the admin sidebar.

  The module shipped its index/settings/diagnostics API (ADR-0040) without a screen, so the whole surface was reachable only by `curl` and `site_search` was invisible in the sidebar. The console renders index status and freshness, documents by resource type, the ten most recent index runs, and the failed-item diagnostics, and drives reconcile, rebuild, and the search-configuration form.

  Reads call the same application functions the JSON endpoints use, inside one `withTenantOrThrow` transaction. Writes go to the guarded `/api/v1/site-search/*` endpoints with a fresh `Idempotency-Key` per click, so a deliberate second run really runs instead of replaying the first run's stored response. Every permission gate on the page is UX-only — the endpoints remain the authority.

  `tests/admin-site-search-page-contract.test.ts` pins the page's six permission keys to what the routes enforce and the descriptor declares, so a plausible-but-unseeded key (`settings.configure`, `index.update`) cannot silently hide a panel from everyone including the owner.

- 40315d2: `.claude/skills/` is gated against the code it describes (ADR-0062).

  `bun run skills:check` joins the `check` chain. The exemption it retires was
  justified when written — skills carried awcms-mini adaptation notes that
  legitimately named absent tooling — but ADR-0055 removed that justification:
  once mini/micro became archives, a skill that reads as a porting instruction
  points work at a repo that does not move.

  What the exemption cost, measured when the gate was written: eleven consecutive
  ADRs (0051–0061) landed with **zero** skills referencing any of them; four
  skills for live modules pointed at `src/lib/<module>/…` for files that now live
  at `src/modules/<module>/presentation/…`; several announced admin screens as
  un-ported months after those screens shipped; and six still taught the
  mini-first pathway two days after it was retired.

  Stale skills decay in the dangerous direction. A stale doc makes a reader pause;
  a skill is followed. "This module is not in this repo" starts out true, the
  module gets built, and the sentence ages into a confident falsehood.

  Three rules, none of which read intent — each keys off the module registry:

  1. A live module's skill must cite `src/…` paths that exist. No exception list:
     a skill for shipped code has no reason to name a file that is not there.
  2. Every cited `ADR-NNNN` must resolve to a file in `docs/adr/`.
  3. A skill for code that does not exist must be listed in `ASPIRATIONAL_SKILLS`
     as `target-spec`, `historical` or `cross-cutting`, with its reason. Dead
     entries — where the module has since been built — are reported too.

  All 55 skills were brought into line: 10 wrong paths fixed, the six mini-first
  skills reframed as "build here with an admission ADR", and the edge-cache,
  media-library, blog-content and seo-distribution skills corrected against what
  actually shipped.

  Zero migrations, zero permissions, zero runtime change — no file under `src/`
  changes behaviour.

- 0b97e67: Tambah `checkSsoBreakGlassReady` ke `bun run security:readiness` (critical) —
  menutup sisi kedua jaminan break-glass yang selama ini tak ditegakkan apa pun.

  `saveTenantAuthPolicy` menolak (`409 BREAK_GLASS_REQUIRED`) menyimpan
  `sso_required=true` atau `password_login_enabled=false` tanpa minimal satu
  identity break-glass yang eligible **saat itu**. Tapi eligibility bukan properti
  policy — ia properti `awcms_identities` dan `awcms_tenant_users`. Menonaktifkan
  identity itu, atau mencabut membership tenant-nya, membuat policy yang tersimpan
  menjadi salah **tanpa policy-nya pernah ditulis ulang**; keduanya aksi
  administrasi user biasa yang tak seorang pun mengaitkannya dengan lockout SSO.
  Setelah itu tenant hanya berjarak satu outage IdP dari tidak punya jalan masuk
  sama sekali, dan seluruh check lama tetap hijau.

  Check baru menurunkan ULANG eligibility dari database untuk setiap tenant aktif
  memakai `fetchEligibleBreakGlassIdentityIds` + `evaluateBreakGlassRequirement`
  yang **sama persis** dengan jalur simpan — bukan salinan aturan kedua yang bebas
  melenceng. Satu `withTenant` per tenant (tabel policy FORCE RLS; check berjalan
  di bawah isolasi yang sama dengan aplikasi), tanpa cap/LIMIT — sebuah batas akan
  membuat tenant terkunci di luar batas tak terlaporkan sementara check mencetak
  PASS. Evidence menyebut tiap tenant bermasalah beserta pemicunya:
  `password_login_enabled=false` (login lokal MATI sekarang) atau `sso_required`
  saja (advisory, login password masih jalan), dan tak pernah mencetak
  `login_identifier`.

  Terbukti lewat mutasi, bukan diasumsikan: mengganti hitungan eligible dengan
  `breakGlassIdentityIds.length` — persis bug yang check ini cari — memerahkan 4
  test integrasi; membuang separuh `password_login_enabled` dari pemicu memerahkan
  1. Test kontrak menegakkan pemanggilan di CALL SITE, karena mutasi pertama itu
     tak menyentuh baris import sama sekali.

- ed324d3: Tegakkan ADR-0013 §6 ("no shared-table write") sebagai gate, dan hentikan satu
  pelanggaran nyata yang sudah menyimpang.

  `_shared/module-contract.ts` menyebut aturan itu **empat kali** — di dokumentasi
  `dataLifecycle`, `searchSources`, `commentableResources`, dan
  `reportingProjections` — sebagai alasan tiap seam mengoper metadata deklaratif ke
  engine pusat alih-alih menjangkau skema modul lain. Keempat seam itu menaatinya.
  SQL tulis-tangan di luar seam tak pernah diperiksa siapa pun, dan **enam tabel
  ditulis lebih dari satu modul**.

  Biayanya sudah terlihat dalam bentuk terkecil: `identity_access` punya DUA
  `INSERT INTO awcms_profiles` independen (JIT provisioning #185 dan approval
  self-registration #276) yang sudah menyimpang pada `verification_status` — dua
  akun yang dibuat berselang menit mendapat postur verifikasi berbeda tanpa ada
  yang pernah memutuskannya. Keduanya kini lewat
  `profile_identity`'s `createPersonProfileForIdentity`, dengan argumen
  `emailVerified` yang eksplisit.

  `bun run modules:table-writes:check` (baru, di rantai `check`) menegakkan
  "paling banyak satu penulis per tabel". Kepemilikan **diturunkan, bukan
  dideklarasikan**: aturannya adalah properti kode apa adanya, jadi tabel baru
  ikut tercakup tanpa perlu didaftarkan — gate tak bisa basi ke arah berbahaya.
  Rute `src/pages` diatribusikan lewat `api.routes`, jadi `INSERT` di rute milik
  sebuah modul bukan penulis kedua. Tulis dinamis (`${tableName}` milik engine
  `data_lifecycle`/`reporting`) sengaja di luar cakupan dan dinyatakan di header —
  itu justru mekanisme yang diresepkan §6.

  Satu pengecualian ber-alasan: `tenant_admin/application/platform-bootstrap.ts`,
  wizard sekali-jalan yang membuat tenant/office/profil/identity/tenant-user/role
  dalam satu transaksi sebelum modul mana pun bisa dipanggil lewat permukaan
  normalnya. Bentuk pengecualiannya `excusedOwner` (memaafkan SATU penulis
  tambahan), bukan daftar owner yang boleh — versi pertama memakai daftar owner
  dan diam-diam mengizinkan kembali tulis `identity_access` yang baru saja
  dihapus; test pertama gate ini yang menangkapnya.

- d7f16c7: Add tenant provisioning: `GET`/`POST /api/v1/tenants` and the `/admin/tenants` screen, both PLATFORM-scoped.

  Until this, a second tenant could not be created at all — `POST /api/v1/setup/initialize` claims the `awcms_setup_state` singleton, so it succeeds exactly once and nothing else touches `awcms_tenants`. Every deployment was permanently single-tenant, which also meant ADR-0053's `multi` tenancy mode was unreachable and its platform gate had never met a real second tenant.

  `createTenantWithOwner` is extracted from `bootstrapPlatformTenant` and shared by both callers. That is a security control rather than tidiness: the one thing that must never differ between them is `WHERE scope = 'tenant'` on the owner grant, and an independently written provisioning routine would carry a copy of an `INSERT` that, for most of this repo's life, did not have that filter — handing every customer authority over every other customer's served data, in a diff that reviews cleanly. `grantPlatformScope` is a parameter rather than a branch on "is this the first tenant?", so the answer is stated at the call site instead of inferred.

  Both permissions are platform-scoped. `create` obviously — adding a tenant adds a party to the deployment. `read` too, and that one is easy to miss: the directory lists EVERY tenant, so a tenant-scoped read would let any customer's owner enumerate the platform's customer list, and no RLS policy would object because `awcms_tenants` is deliberately the RLS-free root table. Because both are platform-scoped, a provisioned tenant never receives them — including the tenant created through this very endpoint.

  A duplicate `tenant_code` needs both a pre-check and a savepoint: in PostgreSQL a `23505` aborts the transaction, so catching it and carrying on does not work, and the commit `withTenant` performs on a returned 4xx would fail too. The `SELECT` answers the ordinary case; the savepoint makes the racing case recoverable instead of a 500.

  The owner password never enters the idempotency hash — that hash is stored, and a stored hash of a credential is a credential at rest.

- da21f77: Close the authorization chokepoint: `defineTenantRoute` + `api:tenant-route:check`.

  The auth/tenant opening that 204 route files copy verbatim now lives once in
  `src/modules/_shared/tenant-route.ts`. `workClass` is REQUIRED in the factory
  type with no default — 176 of those 204 files pass none today, so they share
  login's pool budget by omission rather than by decision.

  The four `/api/v1/reports/*` routes are migrated. They had hand-rolled the guard
  chain and called `evaluateAccess` with three arguments of five, which skipped
  `resolveModuleEnabled` and dynamic ABAC entirely: a tenant that disabled
  `reporting` was still served, and a `deny` policy authored through
  `/api/v1/access/policies` was silently inert. Both are now enforced, so those
  endpoints newly return `403 MODULE_DISABLED` when the module is off and honour
  ABAC. They also accept a session cookie as well as a bearer token, because
  `resolveAuthInputs` reads both.

  `bun run api:tenant-route:check` rejects any NEW route that calls `withTenant`
  directly. The 204 pre-existing routes are listed in a `NOT_YET_MIGRATED` ledger
  that can only shrink: a stale entry fails the gate too.

- a7963d8: Add `/admin/theming` — the console for the theme lifecycle the `theming`
  endpoints have been serving since ADR-0034 Fase 3 with no screen at all.

  Draft, validate, preview, publish, rollback and retire were fully implemented,
  ABAC-gated, idempotency-keyed and audited, yet reachable only by hand-writing
  `curl`, and the module declared no `navigation` — so it was also invisible in the
  sidebar. The screen and the navigation entry land together: an entry without a
  page is a permanent 404 in the menu, and a page no descriptor claims can never
  appear in it.

  **The draft editor is generated from the theme descriptor, not hand-written.**
  `ThemeDescriptor` bounds the configurable surface completely, so the form renders
  one control per declared token (typed by `token.kind` — `<select>` for
  `font_family`, a numeric input for `number`, text for colour/dimension), one
  `<select>` per slot restricted to that slot's own variants, one field per
  declared asset slot, plus section order and nav placement. A JSON textarea would
  have been the honest fallback for an open-ended config and is not needed here.
  Colour tokens stay text inputs on purpose: `<input type="color">` normalises
  every value to hex and would silently rewrite a stored `rgb()`/`hsl()` value that
  `validateColorValue` accepts. Because each theme declares its own tokens, the
  theme picker navigates to `?theme=<key>` and the server re-renders that
  descriptor's field set rather than merging a superset.

  **The gates reuse the endpoints' exact permission keys**, which is harder than it
  looks here because the screen's verbs and the seeded actions disagree: the button
  says "Roll back" and the permission is `theming.version.restore`; the button says
  "Retire" and the permission is `theming.version.archive`. Inventing the tidier
  `version.rollback`/`version.retire` that no migration seeds would hide those
  controls from everyone including the owner — the latent-authz bug this repo has
  already shipped twice. `tests/admin-theming-page-contract.test.ts` extracts the
  guard triples from the seven route sources and the `permissionKey(...)` triples
  from the page, and requires the page's set to be a subset of both what the routes
  enforce and what the descriptor declares. Mutation-proven: `version.rollback` and
  `config.publish` each turn two tests red.

  **Draft-save, publish, rollback and retire each mint a fresh `Idempotency-Key`
  per click; validate sends none.** A reused key replays the stored response
  instead of acting, so a deliberate second publish would silently do nothing;
  validate writes nothing and requires no key, and the test pins both halves.

  **Preview shows its result instead of reloading it away.** The raw preview token
  is returned exactly once, so that one action reads the response body through a
  small page-local helper rather than the shared `sendJson`, whose narrow
  `{ ok, errorCode }` return is a deliberate guard for the dozen other call sites.
  The returned URL is accepted only when it is in the documented
  `/theming/preview/` namespace, so an unexpected body can never become an
  arbitrary link. Every mutation on the page still goes through `sendJson`.

  The responsive-preview dashboard (side-by-side breakpoint rendering) remains a
  documented follow-up.

### Patch Changes

- 26db824: Correct a stale claim: `idn-admin-regions` is not screenless, so ADR-0021's criterion 1 has **zero** exceptions rather than one.

  `docs/PROJECT_STATE.md` §4 listed `idn-admin-regions` as "deliberately without a screen, see ADR-0052", the contract test added with `/admin/media` carried a matching carve-out, and PR #345's own body repeated it as fact. All three were wrong: `/admin/idn-regions` landed in #332.

  ADR-0052 moved that module's dataset **lifecycle** to operator jobs — not the whole module — and the two read permissions it kept are exactly what that screen drives. Verified against the code rather than the documents: `grep -L 'navigation:' src/modules/*/module.ts` now returns nothing at all.

  The carve-out also failed in the other direction. With `idn_admin_regions` excused, that module could have **lost** its screen and the test would still have passed — an exception written for a module that did not need one, protecting it from the check it was supposed to be under. The assertion is now a plain `toEqual([])`, mutation-proven by removing `idn-admin-regions`' navigation entry.

- d8a6c34: ADR-0050 — BFF `awcms-astro` memperoleh sesi manusia lewat **kode handoff
  sekali-pakai**, bukan dengan mem-proksi password.

  ADR-0048 sengaja meninggalkan "bagaimana layar internal login". ADR-0049
  menyelesaikan setengahnya (BFF yang sudah memegang token bisa mengintrospeksinya);
  yang belum dijawab adalah dari mana token itu datang.

  Keputusannya: `awcms` tetap satu-satunya tempat kredensial diterima. Pengguna
  login DI `awcms` — password, MFA, OIDC, Turnstile, semuanya alur yang sudah ada —
  lalu dialihkan balik membawa `code` berumur ≤60 detik yang ditukar BFF
  **server-ke-server**. Token sesi tidak pernah sampai ke browser.

  Alternatif "BFF mem-proksi password" ditolak, dan alasan yang menentukan BUKAN
  bahwa password melintasi repo lain: **login di sini bukan satu langkah**. Ia bisa
  berbalas `401 MFA_REQUIRED` + `mfaChallengeToken`, bisa dialihkan ke OIDC provider
  tenant, dan bisa mensyaratkan Turnstile. Mem-proksinya berarti mengimplementasi
  ulang ketiganya di repo kedua — salinan kedua dari alur MFA adalah tempat paling
  mahal untuk membuat kesalahan pertama.

  Dokumen, belum kode. Yang harus dibangun berikutnya dicatat eksplisit di
  §Konsekuensi, termasuk yang paling mudah salah: allow-list `redirect_uri` yang
  ketat (open-redirect di sini berarti menyerahkan kode ke penyerang) dan
  penukaran kode yang atomik di bawah kunci baris.

- 712e1bc: ADR-0058 — disposition for the four declared permissions with no enforcer.

  `profile_identity.profile_management.restore` and `comments.moderation.delete`
  get a surface: both have all of their machinery except the endpoint. The first
  leaves `softDeleteParty` without a counterpart, so `restored_at`/`restored_by`
  can never be written and a soft-deleted profile is effectively permanent. The
  second has a legal `delete` transition from all four non-terminal statuses and
  an admin queue that can filter `deleted`, while the only actor able to produce
  that state is the comment's own author.

  `blog_content.seo.configure` and `blog_content.posts.export` are revoked: the
  first is a second authorisation axis over columns `settings.configure` already
  manages, the second has no export machinery anywhere in the repo.

  Decision only — no code or migration in this change.

- d17e240: ADR-0067 (`Proposed`) — Core Web Vitals collection, put as a decision rather
  than left as an open gap.

  This is the only one of the assessment's seven recommendations deliberately not
  landed. It does not fix a defect; it adds collection of data about real
  visitors, and that collides with a posture `visitor_analytics` has already
  stated — its purge does DELETE/UPDATE-to-null with no archive step, on the
  written grounds that raw visitor detail is deliberately not retained.

  The gap it describes is real: LCP/INP/CLS are measured nowhere, so the entire
  edge-cache investment is proven against origin load and never against user
  experience.

  Three options with their real trade-offs, recommending aggregate-only — buckets
  per tenant, normalised route and day holding counts plus p75, never raw rows —
  if it is taken at all. Not taking it is a legitimate answer, better recorded as
  a decision than left open.

  Awaiting the product owner's call.

- f0d2daf: Menutup celah C12 (standar §9): enam ADR ber-status `Accepted` tanpa satu baris kode (0016 organization_structure, 0017 document_infrastructure, 0018 data_exchange, 0019 integration_hub, 0020 kontrak ERP-extension yang berkas `_shared`-nya sudah dihapus, 0021 reference_data) kini ber-status jujur `Accepted (belum diimplementasikan)` dengan catatan bertanggal, indeks ADR dwibahasa ikut diperbarui, dan gerbang murni baru `tests/adr-implementation-status.test.ts` mengikat status itu ke keberadaan artefak yang dijanjikan DUA ARAH: artefak tidak ada → kualifikasi wajib; artefak mendarat → status wajib kembali `Accepted` polos; entri peta yang mati (ADR hilang/superseded) ikut gagal; dan kualifikasi tidak boleh dipakai di luar peta.
- 74e9c45: Naikkan `astro` 7.1.1 → 7.1.3.

  Ikut memperbarui `stack.astro.declared` di `awcms-family-compatibility.yaml`.
  Manifest itu menyematkan versi stack ke `package.json` sebagai sumber
  kebenaran, jadi setiap bump Astro memerahkan `family:conformance:check`
  (`[FAIL] stack: Astro (declared ^7.1.1 vs actual ^7.1.3)`) sampai deklarasinya
  diperbarui di perubahan yang sama — persis perilaku yang diinginkan ADR-0032:
  pinning-nya bukan free-floating, jadi bump toolchain tak bisa lewat tanpa
  terlihat.

- 6f5998e: Bump the Astro stack: `astro` 7.1.3 → 7.1.6 and `@astrojs/node` 11.0.2 →
  11.0.3, together with the two `stack` entries in
  `awcms-family-compatibility.yaml` that pin them.

  The manifest is what makes this one change rather than three: `family:conformance:check`
  reads `package.json` and fails on any drift from the declared range, so either
  bump alone turns CI red until its `declared` value moves with it. That gate is
  the reason the version a consumer reads has never silently diverged from the
  version this repo actually runs.

- 58b7fd2: `GET /api/v1/blog/posts` mengembalikan apa yang kontraknya janjikan, dan
  mendapat mode `?view=full` untuk build feed.

  Kontrak OpenAPI menyatakan endpoint ini mengembalikan `BlogPost` — lengkap
  dengan `contentJson`, `excerpt`, `metaDescription`, `canonicalUrl`, dan
  `translationGroupId`. Implementasinya mengembalikan ringkasan yang tidak memuat
  satu pun dari itu. Selisih itu tidak pernah gagal di mana pun: klien yang
  mempercayai dokumen membaca field-field tersebut sebagai `undefined`.

  Akibatnya nyata dan sudah terjadi. Sebuah situs `awcms-astro` membangun hijau
  dengan **badan setiap artikel kosong** — dan karena seksi tempat artikel berada
  juga tinggal di dalam `contentJson`, **seluruh seksinya kosong juga**. Tidak ada
  error di build mana pun, tidak ada 4xx, tidak ada baris log.

  Tiga perubahan:

  - **`?view=full`** mengembalikan baris penuh (`BlogPost`) dengan cursor keyset
    yang sama, batas halaman 50 karena barisnya membawa `contentJson`. Ia
    **mensyaratkan** `order=created_at`: traversal penuh hanya sehat di atas
    urutan yang tidak berubah, dan syaratnya dinyatakan alih-alih diam-diam
    disubstitusi — sikap yang sama seperti penolakan `cursor` atas urutan mutable.
    Tanpa mode ini, satu-satunya cara membangun situs adalah menyusuri daftar lalu
    mengambil ulang setiap post satu per satu (N+1 permintaan per build, ke
    endpoint admin, pada setiap publish).
  - **`translationGroupId` kini benar-benar dikembalikan** — oleh `view=full`
    maupun `GET /api/v1/blog/posts/{id}`. Kolomnya sudah ada dan bisa ditulis
    sejak awal, tetapi tidak satu pun endpoint baca mengembalikannya, sehingga
    klien bisa menyetel pasangan terjemahan dan tidak pernah bisa membacanya lagi.
  - **Bentuk ringkasannya dinyatakan sebagai skema tersendiri**
    (`BlogPostSummary`) alih-alih dibiarkan disimpulkan pembaca. Dokumen yang
    menjanjikan lebih dari yang dikirim kode adalah dokumen yang membuat klien
    salah dengan yakin.

  Validasi query dipindahkan ke `parseBlogPostListQuery` (domain, murni) supaya
  setiap penolakan punya tes tanpa basis data — sebelumnya ia inline di route dan
  tidak bisa dijangkau tes mana pun tanpa sesi dan Postgres.

- f309d00: Naikkan `actions/checkout` 7.0.0 → 7.0.1 di keempat workflow (`ci`, `codeql`,
  `changesets`, `release`). Patch release, tanpa perubahan perilaku pada repo ini.
- f9f8b29: Anggaran ukuran aset klien, digerbangi pada `build` (menutup celah C6).

  Diukur 2026-08-05, `dist/client` berbobot 139.048 byte dalam 45 berkas (35 JS = 77.449 B, 10 CSS = 61.599 B; berkas terbesar `css/public-content.css` 16.800 B) — momen termurah untuk memasang anggaran, karena setiap momen berikutnya berangkat dari baseline yang lebih besar. `scripts/client-asset-budget.ts` gagal bila total melewati 180.000 B (baseline + ~29%) atau satu berkas melewati 21.000 B (terbesar + 25%); dua aturan karena dua mode kegagalan berbeda — akresi pelan versus satu island yang mem-bundle dependensi 200 KB. `dist/client` yang tidak ada atau kosong juga GAGAL keras ("jalankan build dulu"), bukan lolos senyap. Target `build` kini merantai `bun run build:asset-budget:check` setelah `astro build`, sehingga gerbang ikut jalan di CI Quality dan release tanpa entri rantai `check` baru. Tidak ada kelas aset yang dikecualikan: seluruh isi `dist/client` hari ini adalah app shell JS+CSS (gambar konten hidup di R2 via `media_library`), jadi pengecualian dini hanya akan jadi titik buta.

- d3c424a: Naikkan `github/codeql-action` 4.37.1 → 4.37.3 untuk `init` DAN `analyze` dalam
  satu perubahan.

  Dependabot memecah bump ini jadi dua PR (#284 `init`, #286 `analyze`) karena
  keduanya dilacak sebagai action terpisah. Dipecah, masing-masing PR menjalankan
  `init` dan `analyze` pada versi yang BERBEDA, dan job `Analyze` gagal dengan
  version mismatch — persis itu yang terjadi: kedua PR merah di `Analyze
(actions)` dan `Analyze (javascript-typescript)` sementara seluruh check lain
  hijau. Keduanya menunjuk SHA yang sama (`e4fba868`), jadi digabung di sini dan
  kedua PR dependabot ditutup.

- 94c9ed5: Bump `github/codeql-action` from 4.37.3 to 4.37.4 (`init` and `analyze`
  together).

  Dependabot raises these as two PRs because they are two action paths, and
  neither can go green alone: `init` and `analyze` must run from the SAME commit,
  so each half-bump fails both Analyze jobs with a version mismatch. Landing them
  in one commit pinned to one SHA is the only shape that passes.

- 11babb3: ADR-0069: selisih COOP/CORP dengan `awcms-astro` dicatat sebagai divergence keluarga keempat di `awcms-family-compatibility.yaml` (ber-`reviewDate` 2027-02-04). Nol perubahan runtime — pencatatan postur.
- e90a316: Stop the admin dashboard reporting a permanent false alarm when a tenant has no sync nodes.

  `shapeSyncHealth`'s `isHealthy` is deliberately `false` for a tenant with zero registered sync nodes — "there is nothing actively syncing" is the right answer for the report. The dashboard rendered that same boolean directly as an amber "Needs attention" badge, so an online-first deployment that never enrols an offline node (ADR-0035 makes sync the resilience mode, not the main path) sat at `0/0` showing a warning with no action behind it. A badge that is always lit is one operators learn to ignore, including on the day it means something.

  The dashboard now distinguishes the two states that boolean conflates: **no nodes registered** renders a muted "Not configured", while **nodes enrolled but none active**, open conflicts, or failed objects still render "Needs attention". The `GET /api/v1/reports/sync-health` contract is unchanged — `isHealthy` still answers exactly as before.

  The decision is a pure `classifySyncHealthDisplay` in `reporting/domain/sync-health.ts` rather than inline `.astro` frontmatter, so it is reachable by unit tests at all (`tsc --noEmit` does not read `.astro`).

- 0227229: Naikkan `docker/login-action` 4.4.0 → 4.5.1 di workflow `release`. Hanya dipakai
  pada jalur publikasi image; tanpa perubahan perilaku pada build/test.
- ef7c51d: Bump `docker/login-action` from 4.5.1 to 4.6.0 in the release workflow (both
  call sites).

  Release-workflow only — it authenticates the GHCR push during
  sign/attest/publish and has no effect on any PR build.

- 720dc19: Sinkronkan dokumentasi, skill agen, dan knowledge graph dengan kode pasca-Gelombang 2.

  `docs/ARCHITECTURE.md` sebelumnya masih menyebut delapan layar admin dan tidak
  menyebut password reset, self-registration, maupun `/admin/security` sama sekali —
  tiga permukaan auth yang sudah mendarat di #273/#276/#274.

  `.claude/skills/awcms-auth-online-hardening/SKILL.md` memuat peringatan bahwa
  seluruh epic hardening auth "FIKTIF, tidak ada kodenya". Audit yang menghasilkan
  peringatan itu (2026-07-18) benar untuk saat itu, tetapi MFA (#184), OIDC/SSO
  (#185), Turnstile (#186), dan admin policy UI (#274) sudah dibangun sejak itu —
  agen yang mempercayai peringatannya akan membangun ulang semuanya. Peringatan
  diganti dengan §Peta ke artefak nyata awcms yang memetakan nama/path/nomor
  migrasi milik awcms-micro ke padanan awcms, dan menandai satu-satunya item yang
  memang sengaja tidak ada (login Google-spesifik).

  `.claude/skills/README.md` menyatakan `work-class` "benar-benar tidak ada",
  padahal `db:work-class:generate`/`:check` sudah ada dan ikut di rantai
  `bun run check`. Hitungan script juga dikoreksi 63 → 67.

  `graphify-out/` di-update inkremental (231 berkas berubah; 8159 node, 21470 edge).
  `.graphify_analysis.json` dikeluarkan dari tracking: langkah terakhir pipeline
  graphify menghapusnya, jadi salinan yang ter-commit hanya bisa basi.

- 8390e71: Buat `edge-cache:surfaces:check` bisa diuji, lalu uji dia.

  Dari 21 gate di rantai `bun run check`, ini satu-satunya yang membawa logika
  substansial (278 baris) **tanpa satu pun test** — dan alasannya struktural,
  bukan kelalaian: berkasnya berakhir dengan `await main()` di scope modul, jadi
  meng-`import`-nya akan MENJALANKAN gate-nya, dan `process.exit(1)`-nya akan
  membawa serta test runner. Gate lain yang tak diuji semuanya pembungkus tipis
  (35–66 baris) di atas kolektor yang diuji terpisah.

  Itu penting justru di sini. Registry ini adalah **allow-list** yang memutuskan
  apa yang boleh disimpan shared cache; kesalahan di dalamnya adalah pengungkapan
  lintas-tenant, bukan halaman lambat. Header berkasnya sendiri menyebut daftar
  probe `MUST_NEVER_MATCH` sebagai "the check that earns this file's existence" —
  dan sampai sekarang tak ada apa pun yang pernah menyaksikan daftar itu menolak
  sesuatu.

  Perubahannya: entrypoint dijaga `import.meta.main`, tiga aturannya diekspor
  sebagai fungsi murni (`validateSurfaces`, `findCacheableForbiddenPaths`,
  `findOwnersWithoutPurges`), dan `process.exit(1)` diganti `process.exitCode`
  sehingga gate tak lagi mematikan proses pemanggilnya. 20 test menanam
  pelanggaran nyata untuk tiap aturan.

  Dibuktikan dengan menghapus **traversal guard** di `matchPublicCacheSurface` —
  persis cacat yang digambarkan header gate ini. Hasilnya: `/blog/../admin` dan
  `/blog/%2e%2e/admin` dilaporkan cocok dengan surface `blog-post`, gate exit 1,
  test merah. URL admin yang cacheable, ditangkap oleh check yang sebelumnya tak
  pernah diamati bekerja.

- 4f20773: fix(blog-content): `/admin/blog`'s Restore control could never work

  `listBlogPostsForAdmin` hard-filtered `deleted_at IS NULL`, so a soft-deleted
  post was never on screen, and the console offered no way to see the bin. The
  Restore control was therefore hung off `status === "archived"` — a different
  axis. An archived post is not soft-deleted, and `POST .../restore` requires
  `canRestorePost` (`deleted_at IS NOT NULL`), so the button was rendered exactly
  where it must answer 404, and never where it would succeed.

  The delete confirmation already promised the opposite ("It is soft-deleted —
  recoverable until it is purged"), a promise the UI could not keep.

  `listBlogPostsForAdmin` gains a `deletedOnly` filter and the screen gains a
  `?view=deleted` bin. Restore now belongs to bin rows; the lifecycle controls
  belong to live rows, because `transitionBlogPostStatus` also matches
  `deleted_at IS NULL`; Purge appears in both, because `canPurgePost` accepts
  archived or soft-deleted.

  No schema change.

- 0e8021f: Segarkan artefak graph graphify yang ter-track, dan berhenti melacak
  `.graphify_labels.json`.

  Regenerasi ini menjangkau 1.435 berkas (dari 1.412) dan menghasilkan graf yang
  lebih padat: 23.752 edge (dari 21.477) dengan ekstraksi 99% EXTRACTED (dari
  98%). Ia dihasilkan sepenuhnya dari cache — 0 token input — jadi tidak ada biaya
  ekstraksi baru yang ditambahkan.

  `.graphify_labels.json` adalah intermediate build: langkah cleanup skill
  menghapusnya di akhir setiap run, sehingga salinan yang ter-track hanya bisa
  berupa sisa run yang terputus — persis alasan `.graphify_analysis.json` sudah
  di-ignore lebih dulu. Isinya (label komunitas) sudah dirender GRAPH_REPORT.md
  §Community Hubs dan diturunkan dari `graph.json` yang memang ter-track.

- a2cc43a: Segarkan graf graphify di atas dokumen dan skill yang sudah disinkronkan.

  Jalur inkremental (`--update`): 105 berkas berubah (50 kode + 55 dokumen), 13
  berkas terhapus. Hasilnya 8.247 node · 24.098 edge · 495 komunitas, ekstraksi 98%
  EXTRACTED, biaya 791.182 token input.

  Guard penyusutan graphify (#479) menyala pada −25 node dan **benar** menyala:
  penurunan itu diverifikasi sah sebelum `force` dipakai — 13 berkas
  `src/modules/news-portal/**` beserta dua test-nya nol di disk **dan** nol di
  `git ls-tree HEAD`, sisa penghapusan modul ADR-0044 yang belum pernah masuk graf.
  Diagnostik integritas pasca-build bersih: nol dangling, nol missing-endpoint, nol
  self-loop, nol edge kolaps.

  Berkas ber-titik di `graphify-out/` (labels, penanda path, sig) tidak ikut
  ter-commit — aturan `graphify-out/.*` yang mendarat di PR sebelumnya bekerja
  persis seperti maksudnya.

- 3493656: Stop the DB-gated integration suite racing bun's 5s per-hook default, and stop
  it misreporting the result.

  `setupIntegrationDatabase()` creates an ephemeral database and applies every
  file in `sql/` as a subprocess, inside `beforeAll` — thirteen files each do
  that, and the cost grows with every migration added. The CI step now passes
  `--timeout 60000` (~30x the ~1-2s a warm setup takes, still far under the job
  timeout) in both `ci.yml` and `release.yml`.

  When it does get killed, the harness now says so. Exit 143 is 128 + SIGTERM: the
  migration did not fail, it was terminated. The old message read "db:migrate
  failed against the ephemeral integration database (exit 143)", which points a
  reader at `sql/` — the one place the problem is not. Observed on PR #259 (run
  30188228406), green on a re-run with no code change.

- 12594f5: Define the `src/lib` boundary and extend the module-boundary gate to `src/pages`
  (ADR-0043).

  `src/lib` had become a second, ungated module system: four namespaces (`seo`,
  `theming`, `comments`, `search`) carried the name of an existing module and held
  that module's code, and `seo_distribution` referred UP into `src/lib/seo` along
  a path the DAG validator cannot see. `src/lib` is now technical infrastructure
  with no domain name; module presentation/delivery code lives in
  `src/modules/<m>/presentation/`. Eight files moved with `git mv`; no behaviour,
  API, migration, event, permission or registry change.

  `modules:dag:check` fails on a `src/lib/<x>/` namespace that collides with a
  module key — exactly or via a registered domain alias (without aliases, two of
  the four real cases would have passed). `src/lib/logging/` is a recorded
  exception, and the test proves it is DETECTED and merely excused.

  `tests/module-boundary.test.ts` now also covers `src/pages` (38k lines,
  previously scanned by nothing), attributing each route to its owner via
  `api.routes`. That surfaced four hidden edges: three are now declared
  (`theming` -> `module_management`, `visitor_analytics` -> `data_lifecycle` and
  -> `module_management`) and one was removed instead — `extractReferrerDomain`
  moved to `_shared`, because a pure string-to-hostname function should not make
  SEO telemetry depend on the analytics module being enabled.

- 0403e54: Perbaiki dua diagram mermaid yang gagal di-render GitHub, dan gerbangi kelas
  cacatnya di `check:docs`.

  Saat parse gagal, GitHub tidak merender sebagian — ia mengganti **seluruh**
  diagram dengan kotak "Unable to render rich display". Dua diagram di repo ini
  gagal parse sementara `bun run check` tetap hijau, karena `checkMermaid` hanya
  memvalidasi pagar blok dan tipe diagram, tak pernah isinya.

  Grammar flowchart mermaid memperlakukan `(` sebagai token pembuka bentuk node,
  jadi kurung di posisi TEKS mematikan diagram:

  - `README.md`/`README.id.md` — label SISI `-->|online (primary)|`, yang dilihat
    langsung di halaman depan GitHub;
  - `docs/awcms/21_module_admission_governance.md` — empat label NODE rhombus
    (`Q2{... (bukan fitur produk berdiri sendiri)?}` dst.). Diagram ini rusak
    diam-diam dan tak pernah dilaporkan.

  Perbaikannya sama untuk keduanya: kutip labelnya. Bentuk silinder `[( )]` di
  README TIDAK diubah — di sana kurung adalah sintaks bentuk, bukan teks.

  Gerbangnya diperluas: untuk blok `flowchart`/`graph`, setiap `(`/`)` yang
  tersisa setelah teks ber-kutip dan pembatas bentuk (`[( )]`, `([ ])`, `(( ))`,
  `[[ ]]`, `{{ }}`) dibuang = temuan, dengan pesan yang menyebut perbaikannya.
  Aturan ini sengaja TIDAK berlaku untuk `sequenceDiagram` dkk., tempat kurung
  dalam teks memang sah.

  Setiap klaim di atas diverifikasi terhadap parser mermaid 11 NYATA — engine yang
  sama dengan yang dipakai GitHub — bukan disimpulkan dari dokumentasi: tanpa
  kutip GAGAL, dengan kutip LOLOS, bentuk ber-kurung LOLOS apa adanya, dan kurung
  di `sequenceDiagram` LOLOS. Sesudah perbaikan, 85 blok mermaid di seluruh
  markdown ter-track di-parse dengan nol rusak, dan gerbangnya menandai tepat lima
  baris cacat itu — nol temuan palsu di 85 blok tersebut.

  Cakupan gerbang dinyatakan terbuka di kode: ini pemeriksa sintaksis satu kelas
  cacat, bukan parser mermaid.

- 66c1122: Perbaiki katalog tag OpenAPI dan kepemilikan fragment — 55 operasi yang selama
  ini hilang dari referensi API kini terdokumentasi, dan dua gerbang baru mencegah
  kelas cacat ini terulang.

  `scripts/api-docs-generate.ts` mengelompokkan operasi menurut tag yang
  **dideklarasikan** di katalog root. Konsekuensinya tidak pernah terlihat: sebuah
  operasi yang membawa tag tak-terdeklarasi tidak muncul di seksi mana pun — ia
  hilang tanpa memerahkan apa pun. Itulah yang terjadi pada empat modul sekaligus.
  `docs/awcms/api-reference.md` tidak memuat **satu pun** operasi REST milik
  `blog_content` (30 path), `visitor_analytics` (12), `tenant_domain` (7), dan
  `data_lifecycle` (6), meski bundel memuat semuanya dan `bun run check` hijau.

  Sisi sebaliknya sama sunyinya: katalog masih mengumumkan tag `News Portal *`
  sebagai milik modul `news_portal` yang sudah dipensiunkan ADR-0044, dan
  `openapi/modules/news-portal.openapi.yaml` masih ada sebagai fragment untuk
  modul yang tidak lagi terdaftar. Yang membuatnya bertahan adalah tidak adanya
  aturan yang menghubungkan fragment ke registry: `api.openApiPath` milik
  `blog_content` dan `media_library` malah menunjuk **bundel** hasil generate,
  sehingga fragment asli mereka tidak diklaim siapa pun.

  Perubahan ini:

  - menambah empat tag yang kurang (`Blog Content`, `Visitor Analytics`,
    `Tenant Domains`, `Data Lifecycle`) dan meng-atribusikan ulang tag
    `News Media`/`News Portal *` ke modul pemiliknya hari ini (`media_library`,
    `blog_content`). **Nama tag dan path publik sengaja tidak diubah** — mengikuti
    alasan ADR-0044 §3/§6 dan preseden ADR-0036: merge memindahkan kepemilikan,
    bukan permukaan publik;
  - melebur `openapi/modules/news-portal.openapi.yaml` ke fragment
    `blog-content`, dan me-repoint `api.openApiPath` `blog_content` +
    `media_library` ke fragment mereka sendiri (ADR-0026: modul menunjuk
    fragmentnya, tak pernah bundel);
  - menambah dua gerbang murni di `bun run api:spec:check`:
    `collectTagCatalogProblems` (setiap operasi ber-tag, setiap tag operasi
    terdeklarasi, **dan** setiap tag terdeklarasi dipakai — separuh kedua itulah
    yang menangkap tag modul pensiunan) dan `collectFragmentOwnershipProblems`
    (satu fragment = satu modul terdaftar, dua arah, dengan
    `foundation.openapi.yaml` sebagai satu-satunya pengecualian ter-review);
  - meluruskan deskripsi `media_library` yang masih menyebut `news_portal` sebagai
    konsumen wajib yang hidup.

  Bundel yang dihasilkan **tidak berubah selain katalog tag** (11 baris tambah, 3
  kurang, nol path dan nol schema) — bukti bahwa pemindahan fragment tidak
  menyentuh kontrak yang diterbitkan. Kedua gerbang dibuktikan MERAH dengan
  mengembalikan cacat aslinya (menghapus tag `Blog Content`: 49 temuan;
  mengembalikan fragment `news-portal`: 1 temuan), lalu hijau lagi setelah
  dipulihkan.

- 75b46ed: Fix `access:permissions:enforcement:check` reporting enforced permissions as unenforced.

  The gate resolved `const NAME = "value"` bindings across the whole repo as one
  flat namespace. `MODULE_KEY` is bound in five files to four different values, so
  the "a name bound to two values is unresolvable" rule silenced it everywhere —
  including in the file that binds it one line above its own guard. The guards in
  `src/pages/api/v1/analytics/settings.ts` were therefore invisible, and
  `visitor_analytics.settings.read`/`.update` were recorded in the exception list
  as permissions nothing enforces, with a stated reason the route disproves.

  Constants now resolve file-first (`resolveConstantsForSource`); the cross-file
  table is consulted only for names a file does not bind itself, which is exactly
  the set that can only have arrived by import. A name a file binds twice to
  different values stays unresolvable. Both exception entries are removed; the
  score moves from 199/205 with 6 exceptions to 201/205 with 4.

- def014c: Naikkan `@playwright/test` 1.61.1 → 1.62.0 (devDependency). Dipakai suite E2E
  smoke yang env-gated; suite tetap hijau di CI.
- cc16c0c: Bump `@playwright/test` from 1.62.0 to 1.62.1 (dev dependency, E2E runner).

  Unlike the Astro stack, Playwright is not pinned in
  `awcms-family-compatibility.yaml`, so this bump touches nothing but the
  lockfile — a consumer of this repo binds against its contracts, not its test
  runner.

- c3af89f: Close GHSA-fxqj-rqcc-2cmp by pinning `postcss` to `^8.5.23` via `overrides`.

  `bun audit` reported one moderate advisory: PostCSS's incomplete fix of
  GHSA-6g55-p6wh-862q lets an attacker-controlled `sourceMappingURL` read
  arbitrary `.map` files when `from` is unset. It reaches this repo transitively
  through `astro › vite › postcss`, which resolved to 8.5.19.

  A dependency override rather than waiting for the upstream bump: the path is
  three levels deep, so nothing this repo declares can move it, and `overrides`
  is the same mechanism `awcms-astro` used to close its `fast-uri` advisory.

  Build-path only — PostCSS does not run at request time — so this is hygiene
  rather than an exposure. `bun audit` is now clean, and `bun install
--frozen-lockfile` still resolves unchanged.

- 4eea13e: Naikkan `prettier` 3.9.5 → 3.9.6 (devDependency). Formatter menggerbangi
  `bun run lint`; patch release ini tidak mengubah format berkas mana pun di repo
  (`lint` tetap hijau tanpa reformat).
- 3dad5ce: Record the `awcms-astro` readiness analysis and correct two stale counts in
  `docs/PROJECT_STATE.md`.

  The analysis inverts a reasonable assumption: every content and session
  contract `awcms-astro` actually calls is complete (five surfaces, all landed),
  so what holds its ADR-0021 containment is not a missing contract. The one real
  gap found is closed in the same wave, and the two that remain — a host-based
  public content route and the business-scope resolver — each need their own ADR.

  Also sharpens the host-resolved route entry from "follow-up" to what the code
  shows: `seo_distribution` emits every canonical and `<loc>` under `/blog/{slug}`
  while the only content route is `/blog/{tenantCode}/{slug}`, so for a
  host-resolved tenant every sitemap and feed URL points at a 404 with no gate
  red.

- 707baa0: Tabel inventori §2 `docs/PROJECT_STATE.md` kini di-generate dan digerbangi.

  Tabel itu basi EMPAT kali dengan CI hijau — tiga di antaranya pada baris yang sama — dan blockquote-nya sendiri sudah menyimpulkan: pola ini berhenti hanya bila tabelnya di-generate. `bun run project-state:inventory:generate` menulis blok di antara marker `<!-- project-state-inventory:mulai/selesai -->`, dan `bun run project-state:inventory:check` di rantai `check` memerahkan CI bila ia basi (dibandingkan per-konten, bukan per-byte, supaya padding prettier bukan drift).

  Baris LAMBAT di-generate: versi, jumlah modul, jumlah/rentang migrasi, ADR tertinggi + statusnya, layar admin + modul tanpa `navigation:`, jumlah/baris `.astro`, jumlah gerbang rantai `check`, `MODULE_CONTRACT_VERSION`. Baris CEPAT (changeset per tipe bump, commit sejak rilis) DIHAPUS angkanya — angka yang bergerak tiap commit di dokumen ter-versioning akan selalu basi, dan menggerbanginya memaksa tiap PR meregenerasi dokumen; sel nilainya kini menunjuk perintah di kolom kanan, yang dipertahankan (dan rentang `git rev-list`-nya ikut ter-generate dari versi `package.json`).

  Gerbangnya mutation-proven di `tests/project-state-inventory.test.ts`: satu digit dimutasi di antara marker → check gagal dan menamai barisnya; marker hilang → gagal keras; dokumen nyata dibuktikan sinkron oleh test itu sendiri.

- 600b8ba: Extend the query budgets to the heaviest admin screens and the sitemap builder (gap C5 of the second-pass assessment — the first budget file covered only the public blog read paths).

  Every `src/pages/admin/*.astro` screen was ranked by the number of read functions it calls inside `withTenantOrThrow`. Two stand above the rest and are now budgeted at their measured actuals: `/admin` — the dashboard's four report aggregations, 15 queries across nine tables — and `/admin/blog` — the editorial list at 2 queries, 3 with the revision panel, plus a paging-depth constancy check. Every other screen (including `/admin/media`) calls one read function issuing one or two queries, so a budget there would restate a single function's shape rather than guard an aggregation.

  The sitemap builder is the other classic N+1 shape: `seo_distribution`'s discovery aggregator crosses module boundaries through injected `seo_facts` providers and resolves media in batches, on a public unauthenticated surface rebuilt on every edge-cache MISS. The index build is budgeted at 4 queries and a child page at 6, both constant across a 40-post fixture.

  Budgets are ceilings set at the exact measured count — no headroom, because headroom is exactly the space a small regression hides in. Fixtures seed more rows than any budget allows (40 posts, 40 rows in each dashboard-aggregated table, 30 revisions), with time anchors taken from the database rather than a JS clock, so per-item work cannot pass unnoticed. Test infrastructure only: no ADR, no new gate in `bun run check`; the suite is DB-gated by the same `integrationEnabled` mechanism as every other integration file and runs in CI's Integration tests job.

- 3e877a7: Query budgets on the hot public read paths.

  An N+1 is invisible to every other kind of test: the rows are right, the
  assertions pass, the response is byte-identical, and only the number of round
  trips differs. It surfaces in production as latency that grows with content,
  months after the code landed.

  `tests/integration/query-budget.ts` extracts the Proxy-apply-trap the SoD suite
  already proved out into a reusable `countQueries`, and the accompanying
  integration test binds the listing, paging and feed paths to a ceiling of three
  queries against a 40-post fixture.

  The fixture size is the point: a bound asserted against one row proves nothing,
  since an N+1 and a constant-query implementation both issue about one query.
  Mutation-proven by injecting a real N+1 into `listPublicBlogPosts` — two budgets
  turn red. A fourth test guards the instrument itself, because a Proxy that
  silently stopped counting would make every budget pass vacuously.

  These are the paths the edge cache fronts, which is why the count matters: a
  cache MISS pays the full cost, and auto-activation only engages once the origin
  is already under pressure.

  No ADR: this adds no standing rule and no gate to `bun run check`.

- c2808b6: Repo-wide assessment against four axes, and the skill corrections it produced.

  [`docs/awcms/repo-assessment-2026-08-04.md`](docs/awcms/repo-assessment-2026-08-04.md)
  measures the repo against AWCMS's own development standards, its relationship
  with `ahliweb/awcms-astro`, international performance standards (ISO/IEC 25010,
  RFC 9111/5861, Core Web Vitals) and international security standards (OWASP Top
  10 2021, OWASP API Security Top 10 2023, OWASP ASVS 4.0, ISO/IEC 27001:2022
  Annex A). Every finding is verified against code, with file and line.

  Three findings change the backlog:

  - **P0 — one route bypasses the authorization chokepoint.**
    `POST /api/v1/blog/posts/{id}/submit-review` never calls
    `authorizeInTransaction`, so ABAC policy evaluation, the platform-scope gate,
    business-scope facts and SoD are all skipped for a permission that
    `PATCH /{id}` evaluates in full. An explicit ABAC `deny` on
    `blog_content.posts.update` is honoured on one route and silently ignored on
    the other. `access:permissions:enforcement:check` cannot see it: it asks
    whether a permission has an enforcer, not whether every enforcement site uses
    the chokepoint.
  - **P1 — nothing tests the contract `awcms-astro` consumes.** The frozen
    OpenAPI snapshot is the pre-#182-migration baseline; all five surfaces that
    repo actually calls landed after it. Changing any response shape is green here
    and breaks the build there.
  - **P1 — the rate limiter is an in-process `Map`**, so with N replicas the
    effective limit is N × configured. Redis is already in the repo.

  Also: zero of the 28 `check` gates measure performance, and `bun audit` reports
  one moderate transitive advisory (postcss via astro › vite).

  `skills:check` gains **rule 4**: every `bun run <target>` a skill names must
  exist in `package.json` or be declared deferred in `scripts/README.md` §Ditunda.
  Deliberately narrow — that section explicitly permits skills to name deferred
  reference targets, so the rule only catches targets that are neither. It found
  two, one of which told readers to run a refresh command that never existed while
  the real `gh` invocations sat on the same page.

  Skills corrected: `awcms-abac-guard` now leads with the chokepoint rule that the
  P0 finding shows was never written down; `awcms-performance` warns that its
  commands do not exist yet; `awcms-security-hardening` carries the three open
  findings; `awcms-github-snapshot` and `awcms-data-lifecycle` lose their ghost
  commands.

  No migrations, no permissions, no runtime change.

- d4677f2: Make `docs/awcms/repo-inventory.md` an actually-generated document (`bun run repo:inventory:generate|:check`).

  It carried a "GENERATED FILE — jangan diedit manual" banner while no generator existed, and it aged in the direction that does the most damage: the body said "belum ada tabel" and "belum ada test file" against 126 tables and 295 test files, gave the migration count as **45** in one paragraph and **89** in another, and listed **20** modules where the registry holds 21. A negative claim is the dangerous kind — "X does not exist yet" gets more wrong with time and never fails on its own.

  The derivable half is now derived and the prose half is not, following `scripts-inventory.ts` exactly: everything between the markers comes from the module registry, `sql/*.sql`, `tests/`, `src/pages/` and `docs/adr/`, and `repo:inventory:check` joins the `check` chain. The check parses the block back into rows rather than comparing bytes, because prettier owns markdown padding and the two would otherwise fight forever.

  RLS state is parsed from the migrations, not read from a database, so the inventory is available where it is most useful (CI, a fresh clone, a review). That parse is cumulative and order-sensitive on purpose: `sql/020` toggles `NO FORCE` on `awcms_offices` for a data repair and turns it back on 40 lines later, so a parser reading the first or last statement alone would report the opposite of the truth. `security-readiness.ts` remains the authority for a live deployment.

  One cross-artefact test ships with it, and it is the part with teeth: the set of tables the generator derives as RLS-free must equal the keys of `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` in `security-readiness.ts` — one side derived from the migrations, the other hand-maintained with a reason per entry. A disagreement means either a new global table shipped without declaring which privileges `awcms_app` must not hold on it, or a tenant-scoped table shipped without RLS. Today both sides are the same eleven.

- 2dc50c9: Menonaktifkan tenant user kini benar-benar mengakhiri aksesnya — seketika,
  bukan "paling lama satu masa berlaku sesi".

  `setTenantUserStatus` menulis `status = 'inactive'` dan komentar dokumennya
  sendiri menyatakan itu "revokes all of a user's access". Rantai guard tidak
  pernah membaca kolom itu: `resolveTenantContext` mencari sesi dan BARIS tenant
  user, bukan statusnya. Jadi pengguna yang baru dinonaktifkan tetap bekerja
  normal sampai sesinya kebetulan kedaluwarsa — dan satu-satunya cara
  menyadarinya adalah mencoba.

  Deaktivasi kini mencabut setiap sesi hidup identitas itu, **di dalam transaksi
  yang sama** dengan penulisan status: deaktivasi yang ter-commit sementara
  pencabutannya gagal akan meninggalkan sesi hidup persis untuk akun yang baru
  saja diputuskan untuk ditutup.

  Kredensial mesin tidak butuh sapuan terpisah — jalur prinsipal mesin (ADR-0049)
  mensyaratkan tenant user AKTIF, jadi keduanya berhenti pada instan yang sama.
  Test membuktikan keduanya bekerja terpisah: menghapus pencabutan sesi
  memerahkan 3 test, sementara test kredensial mesin tetap hijau.

  Diverifikasi terhadap PostgreSQL nyata (6 test), termasuk dua yang menjaga arah
  sebaliknya: sesi pengguna lain tidak tersentuh, dan reaktivasi **tidak**
  menghidupkan kembali sesi yang sudah dicabut — urutan deactivate/reactivate
  justru yang dipakai operator saat mencurigai sebuah sesi.

- 2f9c253: Perluas gerbang rujukan `bun run` ke README modul dan **komentar kode**, lalu
  perbaiki tujuh rujukan hantu yang selama ini hidup di balik `check` hijau.

  `checkKnownScripts` hanya membaca lima berkas markdown akar (`README*.md`,
  `AGENTS.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`). Di luar lima itu, sebuah
  perintah yang tidak pernah ada tetap bisa berdiri sebagai instruksi. Tujuh
  ditemukan:

  - Enam komentar di `src/lib/jobs/` + `src/modules/module-management/` menyuruh
    pembacanya menjalankan target `modules:sync`. Target itu **tidak pernah ada di
    repo ini** — mekanismenya `POST /api/v1/modules/sync`, dan `enableTenantModule`
    bahkan sudah memanggil `syncModuleDescriptors` sendiri supaya operator tak
    perlu mengingat apa pun.
  - `src/modules/blog-content/README.md` mendaftarkan `bun run production:preflight`
    di antara perintah verifikasi nyata. Orkestrator itu belum diport; tiga
    tahapnya yang sudah nyata (`config:validate`, `security:readiness`,
    `db:pool:health`) menggantikannya.

  Komentar kode adalah dokumentasi current-state yang paling dipercaya sekaligus
  yang paling tidak pernah diaudit — ia dibaca persis saat seseorang sedang
  memutuskan tindakan. Karena itu cakupan gerbang kini: lima berkas akar +
  `docs/PROJECT_STATE.md` + `scripts/README.md` + README modul `src/**` + seluruh
  sumber `src/`/`scripts/`. `docs/awcms/` dan `.claude/skills/` tetap di luar —
  isinya target adaptasi awcms-mini yang memang boleh menyebut tooling belum-ada —
  begitu pula `tests/`, yang fixture-nya sengaja memakai nama fiktif untuk menguji
  gerbang ini.

  Kelas cacatnya dibuktikan dua arah sebelum ditutup: mengembalikan komentar
  `modules:sync` yang asli DAN menambahkan satu rujukan hantu ke
  `docs/PROJECT_STATE.md` masing-masing memerahkan gerbang. Gerbangnya juga
  langsung menangkap komentar penjelasnya sendiri pada run pertama — kali kelima
  bentuk itu muncul di repo ini, dan alasan komentar itu kini sengaja tidak menulis
  nama target dalam bentuk `bun run …`.

  Dokumen current-state ikut disegarkan agar tidak berbohong ke arah sebaliknya:
  `docs/ARCHITECTURE.md` masih menulis "20 modul terdaftar" (21) dan **dua kali**
  menyebut `idn-admin-regions` sebagai "belum di-port" padahal modul itu sudah
  mendarat (#312) — klaim negatif yang makin salah seiring waktu tanpa pernah gagal
  sendiri. `docs/PROJECT_STATE.md` disetel ulang ke 21 modul / ADR 0000–0048, dan
  kontrak alur kerjanya tidak lagi mewajibkan mini-first yang sudah **ditangguhkan**
  ADR-0047.

- 8d4e0f2: Turunkan inventaris `scripts/README.md` dari `package.json`, dan tolak klaim
  "belum ada" untuk tooling yang sudah ada.

  README itu punya dua tabel dan keduanya salah. Yang pertama mendaftar **12 dari
  52** skrip sebagai aktif. Yang kedua menyebut lima belas tooling sebagai "belum
  diport" padahal semuanya sudah mendarat — dan sebagian sudah berada di rantai
  `bun run check`: `api:docs:check`, `modules:compose:check`,
  `db:work-class:check`, `modules:composition:inventory:*`, serta seluruh worker
  per-modul (`email:*`, `analytics:*`, `reporting:*`, `workflow:*`,
  `form-drafts:*`, `identity-access:*`).

  Keduanya butuh aturan berbeda, karena mode kegagalannya berbeda:

  - **Kelalaian** ditutup dengan menurunkan tabelnya. Blok bertanda di README kini
    dihasilkan `bun run scripts:inventory:generate` dan diperiksa
    `scripts:inventory:check` — pola generate/check yang sama dengan artefak
    `.generated` lain, karena artefak generated TANPA pasangan itu adalah klaim
    palsu yang justru lebih dipercaya daripada prosa.
  - **Klaim ABSENSI palsu** ditutup dengan aturan tersendiri: sebuah target yang
    tercatat di §Ditunda tapi ADA di `package.json` memerahkan gate. Ini arah yang
    berbahaya — klaim negatif makin salah seiring waktu dan tak pernah gagal
    sendiri, jadi pembacanya menyimpulkan `db:work-class:check` masih perlu
    dibangun lalu membangun duplikatnya.

  Pemindaian klaim absensi hanya membaca BARIS TABEL, bukan prosa: prosa di
  bagian itu menjelaskan aturannya sambil menyebut nama target nyata, dan
  memindainya utuh membuat gate melaporkan dirinya sendiri pada run pertama —
  kali keempat bentuk itu muncul di repo ini.

- ccc1fd9: Skill catalogue: correct two claims that stopped being true

  `.claude/skills/README.md` told readers `repo:inventory:*` is "genuinely absent"
  and that `package.json` has 75 scripts. Both landed since: #374 shipped
  `repo:inventory:generate`/`:check` with the generator for `awcms/repo-inventory.md`,
  and the script count is 82. A catalogue that names a real script as missing sends
  the next reader to build what already exists — the same failure shape ADR-0062
  gates for `SKILL.md`, in the one file that gate does not read.

  `awcms-jualanku-porting` carried two more. Its description said the registry is
  "still 20 modules" (it is 21), and its first binding decision described the
  ADR-0030 scope-hierarchy port as base returning `resolved: false` fail-closed —
  true until ADR-0060 gave it a provider, and misleading after. What is still open
  is narrower and now stated: the merchant scope SHAPE needs its own admission ADR.

  Verified against code, not memory: `Object.keys(scripts).length`, the module
  registry, and the ADR files themselves.

- d02b17f: Confine AWCMS development to `ahliweb/awcms` and `ahliweb/awcms-astro` (ADR-0055), and re-anchor the compatibility manifest.

  ADR-0047 froze `awcms-mini`/`awcms-micro` as references that could still be ported OUT. That half position had a running cost: the manifest still declared `standard: awcms-mini`, and its nine `intentionalDivergences` each carried a `reviewDate` that turns CI red on expiry — scheduling this repo to keep re-justifying its differences from a repo nobody develops. The backlog framed work as moving existing code rather than deciding what to build, and the four most recent foundation features (ADR-0046, -0049, -0053, -0054) were all built here anyway. The written rule had fallen behind the actual one.

  `awcms-mini` and `awcms-micro` are now archives: readable as history, never a scheduled source of ports. Wanted capabilities are built here with their own admission ADR, judged on today's need.

  The manifest stays gated and self-anchored — its 23 contract-version checks against real source constants are untouched, because the mechanism was never the problem. `intentionalDivergences` is emptied and the nine entries are preserved verbatim in `docs/awcms/family-compatibility.md`, where their ADR links are still verified to exist by `check:docs`.

  ADR-0047 §4 (record every foundation feature as a divergence as it lands) is retired: the ADR is the record, and the duplicate was only ever another thing to keep in step. Every other §3 guardrail stands — ADR for standard changes, extra security review for `auth`/`access`/`sync`, full `bun run check`, OpenAPI/AsyncAPI in sync, `FORCE` RLS, ABAC default-deny, applied migrations immutable.

  Docs-only: no runtime code changes.

- a78b774: Build the work-class registry generator + freshness gate, and retire the ghost
  artifact it was supposed to produce.

  `docs/awcms/work-class-registry.generated.json` carried a `.generated` suffix
  with no generator and no check behind it. It listed ~284 awcms-mini routes,
  mostly ghosts, while its own `_disclaimer` claimed to describe "96 real routes"
  in a repo that has 221 — the data was stale and so was the warning meant to stop
  readers trusting it. Both `docs/awcms/README.md` and the capacity runbook cited
  it.

  `bun run db:work-class:generate` / `db:work-class:check` now produce and verify
  it from this repo's own routes and jobs, wired into `bun run check` and
  `ci.yml`. Routes are derived from source (`defineTenantRoute`'s required
  `workClass`, an explicit literal on `withTenant`, or the documented default);
  jobs come from `JOB_WORK_CLASS_REGISTRY`, cross-checked against the scripts that
  actually open a worker connection.

  That cross-check refused to generate on its first run, correctly: four worker
  scripts from the awcms-micro wave (`comments-retention`, `edge-cache-purge`,
  `site-search-reconcile`, `tenant-domain-dns-sync`) had no entry and were outside
  the capacity model, and four entries described scripts that do not exist here.
  Both directions are fixed.

  `tests/generated-artifacts-have-tooling.test.ts` makes this a class of defect
  rather than one incident: any `.generated` file without a generate/check pair
  wired into the check chain now fails CI.

## 6.4.0

### Minor Changes

- 85517b8: Tutup empat temuan analisis graph: wire resolusi asset theming, lengkapi
  deklarasi permission `email`, jujurkan graf dependensi lintas-modul, dan
  tambahkan gate batas modul yang selama ini SUDAH DIASUMSIKAN ADA.

  **Logo tema akhirnya tampil.** `src/lib/theming/theme-media.ts` mengembalikan
  map kosong tanpa syarat. Itu jujur saat ditulis — ADR-0034 Fase 3 mem-port
  `theming` lebih dulu dan `media_library` belum ada — tapi header-nya tetap
  berkata begitu setelah ADR-0036 mendaratkan modulnya, sehingga no-op itu terbaca
  sebagai desain, bukan wiring yang belum selesai. Akibatnya tak pernah tercatat:
  tenant mengunggah logo, id-nya tersimpan dan valid, dan `PublicThemeLayout`
  selamanya merender fallback nama-tema. Kini resolusi lewat `MediaLibraryPort`
  — capability yang sama yang sudah dikonsumsi `blog_content` dan `news_portal`.
  Slot yang tidak resolve tetap DIHILANGKAN, bukan melempar: halaman tema publik
  tidak boleh 500 karena satu id asset basi. `theming` sekarang mendeklarasikan
  `capabilities.consumes` untuk `media_library`.

  **`email` mendeklarasikan 12 permission-nya**, verbatim dari seed `sql/014`.
  Ia satu-satunya dari 21 modul yang belum, sehingga seluruh barisnya permanen
  tampil `orphaned` di `GET /api/v1/modules/email/permissions` — false positive
  menetap yang melatih pembaca mengabaikan laporan drift. Kini 21/21.

  **Enam edge lintas-modul tak-terdeklarasi dijujurkan.** `seo_distribution`,
  `site_search`, dan `comments` meng-import modul yang tidak ada di descriptor-nya;
  semuanya kini dideklarasikan, tanpa satu pun cycle.
  `domain_event_runtime -> reporting` TIDAK bisa dideklarasikan — `reporting`
  sudah mendeklarasikan arah sebaliknya, jadi mendeklarasikannya = cycle — dan
  menjadi satu-satunya pengecualian tercatat, dengan alasan yang bisa dibantah
  reviewer.

  **`tests/module-boundary.test.ts`.** `capability-contract-versions.ts` selama
  ini membenarkan capability tanpa versi dengan kalimat "a source-boundary test
  (`tests/unit/module-boundary.test.ts`) is enough to keep provider and consumer
  in sync". **Berkas itu tidak pernah ada di repo ini** — kalimatnya ikut ter-port
  dari awcms-mini, test-nya tidak. Jaring pengaman yang dinyatakan untuk seluruh
  model capability itu imajiner. Sekarang nyata: tiap import lintas-modul wajib
  dideklarasikan sebagai dependency, sebagai capability consumption, atau
  dikecualikan eksplisit dengan alasan.

### Patch Changes

- 1d49f37: Sinkronkan docs/skill dengan #251/#252, dan catat satu split-brain `navigation`
  yang ditemukan lewat graph.

  Lima skill mengklaim hal yang sudah tidak benar setelah #251:
  `awcms-theming` masih menyebut resolusi URL asset "masih no-op" (sudah ter-wire
  lewat `MediaLibraryPort`); `awcms-module-management` masih menyebut "20 dari 21
  modul" mendeklarasikan `permissions` (kini 21/21, sehingga `orphaned` bukan lagi
  kondisi normal dan setiap kemunculannya adalah sinyal nyata); dan
  `awcms-comments`/`awcms-site-search`/`awcms-seo-distribution` masih mengiklankan
  deps "Core-only" padahal ketiganya kini mendeklarasikan modul yang memang mereka
  import.

  `ARCHITECTURE.md` kini menyebut `tests/module-boundary.test.ts` di sebelah tiga
  gate modul lainnya, dengan alasannya: ketiganya memvalidasi graf yang
  DIDEKLARASIKAN dan tak satu pun membaca satu baris `import`.
  `13_final_master_index_traceability.md` menyatakan "23 modul terdaftar" — angka
  awcms-mini; nyatanya 21.

  **Temuan graph — `navigation` punya dua sumber yang tidak pernah
  direkonsiliasi.** `ModuleDescriptor.navigation` nyata dikonsumsi (disinkronkan
  ke `awcms_module_navigation`, disajikan `navigation-registry.ts`, divalidasi
  `module-composition.ts`) dan lima modul mendeklarasikannya — tetapi sidebar
  admin merender `navSections`, array statis di `AdminLayout.astro`. Jadi
  mendeklarasikan `navigation` menghasilkan baris DB dan entri API, **bukan** link
  menu; sebaliknya `/admin/tenant` tampil di sidebar tanpa descriptor apa pun.
  Dicatat di skill pemiliknya, tidak "diperbaiki" sepihak: sisi API sudah punya
  konsumen, jadi menyatukannya adalah keputusan desain.

  Graph di-refresh ke `deb43028` (7534 node, 21084 edge, 435 community, nol import
  cycle level-berkas).

- deb4302: Refresh knowledge graph ke `85517b8b` (7534 node, 21084 edge, 434 community; nol
  import cycle level-berkas) dan koreksi satu klaim usang di `PROJECT_STATE.md`.

  Dokumen itu masih menyatakan emisi purge cache tepi "belum" terpasang untuk
  `theming` — padahal #246 sudah memasangnya di publish/rollback/retire. Sekaligus
  menjelaskan kenapa `news_portal`/`media_library` sengaja TIDAK: keduanya tidak
  memiliki surface ter-deklarasi, jadi ban untuk key-nya tak akan cocok apa pun
  sementara antrean tetap melapor sukses — dan gate `edge-cache:surfaces:check`
  akan memunculkan kewajibannya sendiri begitu salah satunya mendeklarasikan
  surface.

## 6.3.0

### Minor Changes

- 156a7b6: Emit edge-cache invalidation from `theming`, and enforce the obligation by
  surface ownership.

  `theming` owns the `theming-tokens` surface (`/theming/{tenantCode}/tokens.css`),
  so publish, rollback, and retire each change what a cached object contains.
  All three now call `enqueueModuleContentPurge` inside the same transaction as
  the change (ADR-0042 §9 / ADR-0006).

  **`news_portal` and `media_library` deliberately do not.** Neither owns a
  declared surface, so nothing cached is tagged `m:news_portal` or
  `m:media_library` — a ban for those keys matches no object while the queue
  records `sent=1`. Adding them now would be ceremony that reads as coverage and
  provides none.

  `bun run edge-cache:surfaces:check` now demands a purge call site from **every
  module that owns a declared surface**, resolving `*_MODULE_KEY` constants across
  files. Framing it by ownership rather than by a hand-kept module list means the
  obligation appears on its own the day `news_portal` or `media_library` declares
  a surface, and stays silent until then.

  The asymmetry this closes: declaring a surface is one line and takes effect
  immediately; wiring its invalidation is a separate edit in another file that
  nothing forced. Miss it and the surface caches correctly, serves correctly, and
  never updates — with no error anywhere.

### Patch Changes

- 156a7b6: Stop `Accepted` admission ADRs from reading as shipped modules.

  Five ADRs — 0016 `organization_structure`, 0017 `document_infrastructure`, 0018
  `data_exchange`, 0019 `integration_hub`, 0021 `reference_data` — are `Accepted`
  for modules with no code in this repository. `Accepted` is a decision status, not
  a delivery status, but nothing said so, and the roadmap already named the
  consequence: someone reading `docs/adr/` "will conclude `organization_structure`
  can be called. It cannot."

  Not hypothetical. ADR-0020 asserted `reference_data` is `status: "active"` in the
  registry, citing a merged PR number — true of `awcms-mini`, where the sentence
  came from, and false here. Corrected.

  Each of the five now carries an unmissable not-implemented block naming what is
  absent and pointing at Wave A of the absorption roadmap.

  `tests/adr-admission-implementation-status.test.ts` binds the two facts, which
  otherwise live in different places and move independently: an admitted module
  must be in `listModules()` **or** its ADR must carry the marker. It fails in both
  directions — landing a module while the marker remains is caught too — and it
  asserts separately that no ADR claims an absent module is active in the registry,
  since prose copied between family repos is the likely source of the next
  instance. No database, so it runs on every PR.

- bfd9638: Pin the default tenant per environment, and state the owner-account convention
  for all three phases.

  `PUBLIC_DEFAULT_TENANT_ID`/`_CODE` are now set in staging and production rather
  than left to the end of the resolution chain. Unset still worked — the chain
  terminates at `awcms_setup_state.tenant_id` — but that makes "which tenant does
  an unmatched host resolve to?" an implicit answer living in a table rather than a
  stated one, and it silently becomes the wrong answer the moment a second tenant
  exists. The consumers are real: `seo_distribution` (`/robots.txt`, sitemap, feeds)
  and `site_search`.

  `PUBLIC_TENANT_RESOLUTION_MODE` is deliberately left unset. Production does have
  an `awcms_tenant_domains` row for `awcms.ahlikoding.com`, so `host_default` would
  work — but enabling host lookup widens the reachable surface and is its own
  decision, not part of "set the default tenant".

  Documents the owner convention across development, staging and production: the
  login identifier `admin@ahlikoding.com` is shared, the password never is.
  `awcms_identities` is unique on `(tenant_id, login_identifier)`, so one address in
  three environments is three unrelated accounts with three password hashes and
  three `AUTH_JWT_SECRET`s.

  Also records the permission-seed gap where it will actually be read, with the
  backfill SQL: a seed migration reaches only tenants created after it, so landing a
  module does not grant its permissions to an existing owner — the symptom is a 403
  on a module that is plainly installed. Plus the queries that show whether "full
  access" is genuinely full, since RBAC 197/197 means nothing if an ABAC deny, an
  SoD rule, or a business-scope constraint is in play.

- 2e907a5: Samakan environment development dengan staging/produksi, dan buang variabel env
  hantu dari dokumentasi.

  Development sebelumnya bukan versi kecil produksi melainkan environment yang
  berbeda secara diam-diam: skema berhenti di migrasi 30 (produksi 70), nol
  tenant, tanpa `.env`, dan satu-satunya role ber-LOGIN adalah superuser milik
  container — sehingga `FORCE RLS` inert dan justru bug termahal (kebocoran
  tenant, 403 permission) yang paling mustahil direproduksi di sana. Dev kini
  cocok baris per baris: migrasi 70, 118 tabel, 197 permission, RLS `ENABLE`+`FORCE`
  109/118, runtime sebagai `awcms_app`, owner `owner` 197/197 — dengan perbedaan
  yang disengaja (`AUTH_COOKIE_SECURE`, `TRUSTED_PROXY_ENABLED`, `EDGE_CACHE_MODE`)
  dicatat beserta alasannya.

  Dokumentasi menyebut `AUTH_JWT_SECRET` sebagai variabel wajib di lima berkas.
  **Variabel itu tidak ada di awcms** — tidak dibaca kode mana pun, dan tidak ada
  JWT di jalur sesi (token acak buram ber-hash sha256 di `awcms_sessions`).
  Klaimnya bukan sekadar usang: ia menopang pernyataan keamanan bahwa tiga
  environment terisolasi sebagian karena masing-masing punya JWT secret sendiri.
  Operator yang mengikutinya akan menyetel variabel yang tidak berefek apa pun.
  `APP_TIMEZONE` juga tercantum wajib dan sama-sama tidak ada.

  `tests/env-required-vars-doc.test.ts` mengikat daftar wajib di
  `deployment-profiles.md` ke `RULES` di `scripts/validate-env.ts`, menolak
  kemunculan ulang `AUTH_JWT_SECRET` sebagai variabel hidup, dan memverifikasi
  kedua nama itu memang tak pernah dibaca kode — empat mutasi terbukti merah.

- 4c2459d: Sapu drift docs/skill terhadap kode, dan pasang dua gate supaya kelasnya tidak
  kembali.

  Lima klaim yang **salah**, bukan sekadar usang:

  - `awcms-data-lifecycle` menyebut `form_drafts`/`comments` "DITUNDA (modul belum
    di-port)" — keduanya sudah di-port dan keduanya adopter `delegated`. Skill itu
    juga menyebut 2 adopter padahal ada **10 deskriptor di 7 modul**; agen yang
    mengikutinya akan melewatkan guard legal-hold pada tabel yang mewajibkannya.
  - `awcms-theming` menyebut `media_library` "di-drop — belum ada di base", dan
    menerangkan ketiadaan purge preview dengan "`data_lifecycle` tidak ada di base
    ini; tak ada `awcms_worker`". Ketiganya ada.
  - `awcms-wizard-form` menyebut `form_drafts` belum di-port.
  - `awcms-module-management` melaporkan "17 modul (dari 23)" mendeklarasikan
    `permissions`, dengan daftar yang tujuh di antaranya milik awcms-mini. Angka
    nyata: **20 dari 21**, dan satu-satunya pengecualian adalah `email`.
  - Lima dokumen menyatakan total yang tertinggal (`sql/001`–`067`, "65 migrasi",
    "20 modul") — termasuk paragraf di `repo-inventory.md` yang tugasnya justru
    MENGOREKSI klaim usang. Koreksi yang ikut usang lebih buruk dari aslinya: ia
    terbaca seperti baru saja diverifikasi.

  `src/lib/theming/theme-media.ts` punya kembaran klaim itu **di kode** — header
  seam-nya menerangkan resolusi asset no-op karena `media_library` tidak ada.
  Modulnya ada, lengkap dengan adapter nyata yang sudah dipakai `blog_content` dan
  `news_portal`. Akibat yang terlihat pengguna dan sebelumnya tidak tercatat di
  mana pun: tenant bisa mengunggah logo, id-nya tersimpan, dan tema tetap merender
  fallback nama-tema. Header-nya kini menyatakan itu; wiring adapternya tetap
  pekerjaan tersendiri.

  `domain-event-runtime/infrastructure/consumer-registry.ts` juga: header-nya
  menyatakan consumer `reporting` "intentionally NOT ported (they would import
  modules that are absent)" sementara berkas yang sama meng-import `reporting` di
  baris 8. Sekaligus mencatat cycle level-modul yang tak terlihat gate mana pun —
  `reporting` mendeklarasikan `domain_event_runtime`, dan modul ini meng-import
  `reporting`; `modules:dag:check` memvalidasi deklarasi saja (registry murni,
  tanpa I/O by design), jadi import tak-terdeklarasi tak terlihat, dan
  mendeklarasikannya secara jujur justru membuat gate itu merah karena cycle.

  Dua gate baru, keduanya mutation-proven:
  `tests/module-absence-claims.test.ts` (tidak ada dokumen/skill yang boleh
  menyangkal modul terdaftar) dan `tests/doc-inventory-counts.test.ts` (total modul
  dan rentang `sql/001`–`NNN` harus cocok dengan repo).

- c44d4ee: Stop tracking graphify's dated backup directories.

  Every `graphify` rebuild writes a full copy of the curated graph to
  `graphify-out/<YYYY-MM-DD>/` — roughly 12 MB of duplicate JSON per run. The
  previous refresh happened not to commit one; `.gitignore` now makes that a rule
  rather than something whoever stages the change has to notice.

  The live artifacts beside it (`graph.json`, `graph.html`, `GRAPH_REPORT.md`,
  `manifest.json`) stay tracked — those are the reviewable output.

- 156a7b6: Make the migration layer visible to the knowledge graph, and stop tracking
  `graph.html`.

  `tree_sitter_sql` was missing, so all 70 files in `sql/` contributed **nothing**
  to the graph — the layer that holds every RLS policy, every grant, and every
  tenant-isolation predicate was simply absent. Three defects fixed this week lived
  there, and the graph could not have helped find any of them. With the grammar
  installed the graph gains 179 nodes and 153 edges, including the tables
  themselves (`awcms_tenants`, `awcms_offices`, …) rather than just file names.

  Note for anyone rebuilding: graphify keys its cache on `manifest.json`, not on
  `cache/stat-index.json`. Installing a new grammar does not invalidate anything,
  so `--update` reports every file unchanged and the new grammar never runs. The
  entries have to be dropped from `manifest.json` to force re-extraction.

  `graph.html` is no longer tracked. It silently stops being emitted once the
  corpus passes graphify's viz node limit — the committed copy then rots while
  `graph.json` beside it stays current, which is precisely the failure mode this
  repo keeps getting bitten by. It is also ~8.7 MB per rebuild on top of
  `graph.json`'s ~10 MB, doubling what each refresh adds to history permanently.
  Regenerating is one command, documented in `.gitignore` next to the rule.

## 6.2.0

### Minor Changes

- e60409d: Bring the admin shell to structural parity with awcms-micro's admin pages.

  **Admin shell (`src/layouts/AdminLayout.astro`)** — adopted from awcms-micro's `AdminLayout.astro`:

  - `.admin-shell` column wrapper + sticky topbar. The layout row's hardcoded `min-height: calc(100vh - 57px)` (a measured topbar height) is replaced by `flex: 1`, so added topbar chrome can no longer desync it.
  - **`TenantBadge`** (`src/components/TenantBadge.astro`) names the active tenant in the topbar. Rendered as a plain non-interactive badge, never a `<select disabled>` — awcms scopes an identity to exactly one tenant, so there is nothing to switch to, and a disabled control would advertise a capability with no server-side enforcement behind it. `availableTenants` is kept as the seam for a real, server-computed switcher later.
  - **`ThemeToggle`** (`src/components/ThemeToggle.astro`) cycles system → light → dark, persists to `localStorage["awcms_theme"]`, and follows the OS while in system mode. awcms already shipped `:root[data-theme="dark"]` tokens with nothing to set the attribute — dark mode existed but was unreachable. This closes the dark-mode follow-up noted in PR #215.
  - **`SyncIndicator`** (`src/components/SyncIndicator.astro`) — dot + label driven by the real `fetchSyncIndicatorActive`, a bounded `EXISTS` over `awcms_sync_nodes` rather than the full sync-health aggregation. It shares ONE transaction with the tenant-name lookup, so the whole topbar costs a single round trip per `/admin/*` render.
  - **`LocaleBadge`** (`src/components/LocaleBadge.astro`) fills micro's `LanguageSwitcher` slot. awcms has no gettext catalog, so a `<select>` with one option would be a control that cannot do anything; the badge states the served language without pretending to offer a choice.
  - **Avatar + roles + log-out cluster** in the topbar. The avatar is a plain tile, not a link — micro's points at `/admin/profile`, which awcms does not have.
  - **Two-level sidebar** (section heading → owning module → links: General; Identity → Profile Identity / Identity & Access; System → Tenant Admin / Tenant Domain / Module Management / Email; Operations → Visitor Analytics) replacing one flat list, with the app version pinned to the footer. Grouping is presentation only — every route still runs its own ABAC guard, and a visible link grants nothing.
  - **Breadcrumb** above the page slot.

  **Dashboard (`src/pages/admin/index.astro`) — rebuilt, and not only cosmetically.** It previously rendered `Astro.locals.ssrContext` alone (tenant id, role count, permission count) plus quick links, with no database read at all — a page about your SESSION rather than your TENANT. It now renders the same four reports awcms-micro's dashboard does, every one of which already existed in this repo's `reporting` module and had simply never been surfaced in the UI:

  - Accent-barred KPI tiles: active users, active offices, allow-decisions in the window, and active/total sync nodes with a "Needs attention" badge when sync is unhealthy.
  - Detail cards for Tenant Activity, Access & Audit, and Sync Health, with alert styling on non-zero denies, open conflicts, and failed objects.
  - A Module Usage table (18 rows against a fresh tenant).

  Reads are gated on `reporting.dashboard.read`, so "you may not see this" stays distinguishable from "there is nothing here", and a report failure degrades to a notice rather than 500-ing the first page every admin lands on. The session cards remain below as the fallback view, preserving the `#admin-dashboard-heading` / `#dashboard-tenant-id` hooks asserted by `tests/e2e/admin-offices.e2e.ts`.

  **CSP change — `script-src` is now unconditional.** The theme-init script must run synchronously in `<head>` or the shell flashes the wrong theme, which a deferred Astro-bundled module cannot do. It is therefore the one `is:inline` script in this repo, admitted by SHA-256 (`src/lib/security/theme-init-script.ts`), not by `'unsafe-inline'` — a hash authorises one exact byte sequence. `script-src 'self' '<hash>'` is now always emitted instead of appearing only for Turnstile; the LAN/offline guarantee that no third-party origin appears is unchanged. Verified in a real browser-shaped render, not just by `curl`: the bytes Astro emits hash to exactly the registered value (`tests/theme-init-script.test.ts` fails on drift, since a mismatch is otherwise silent — no error, no log, just a blocked script).

  Deliberately NOT ported from awcms-micro, each because the backing capability does not exist here: `LanguageSwitcher` (no gettext catalog), `SyncIndicator` (would add a per-request reporting query), the profile icon (no `/admin/profile` route), the per-tenant sidebar-arrangement subsystem, and micro's JS drawer — awcms's CSS-only checkbox drawer is kept, since it needs no script at all and swapping it for JS would be a regression dressed as parity.

  Verified against a real PostgreSQL: all 10 admin screens render 200 through the new shell, and the tenant badge resolves its name from the database with a shape-checked fallback (this repo's `withTenant` _returns_ a 503 `Response` on circuit-open rather than throwing, so a bare `rows[0]` would have silently produced `undefined`).

- 952d616: Port the `comments` module from awcms-micro (ADR-0041) — moderation-first
  commenting over published, public resources.

  Registers the 21st base module. Content modules declare which of their resources
  accept comments through the new `ModuleDescriptor.commentableResources`
  descriptor list (`MODULE_CONTRACT_VERSION` 2.2.0 → 2.3.0, additive optional
  field); `comments` discovers them via `listModules()` and depends only on Core,
  so nothing depends on it and the DAG stays acyclic. `blog_content` contributes
  the first descriptor.

  Ships seven tables (`sql/066`, all ENABLE + FORCE RLS), eight permissions
  (`sql/067`, reusing existing `AccessAction` literals — no union widening), ten
  API routes, an SSR moderation queue at `/admin/comments`, three domain events, a
  legal-hold-aware retention sweep (`bun run comments:retention`), and a registry
  gate (`bun run comments:resources:check`).

  Because this is an unauthenticated public write surface: bodies are stored as
  plain text and escaped on render (no stored HTML, so no stored XSS); public
  submit responses are uniform, so the endpoint cannot be used as an oracle for
  blocked terms or unpublished content; author email, IP, and user-agent are only
  ever stored hashed or masked; and notification recipients are encrypted under
  their own key, with an unresolvable sentinel rather than plaintext when no key
  is configured.

  Three defects in the source were fixed rather than carried over: a
  millisecond-rounded keyset cursor that skipped rows, `published_at` being
  cleared on archive, and a worker INSERT grant justified by a retention event
  that was never written.

- 6308a84: Emit edge-cache invalidation from blog content changes (ADR-0042).

  `enqueueEdgeCachePurge` previously had no callers, so a published edit stayed
  visible at the edge until its TTL expired. The four blog write paths — create,
  update, soft-delete, and scheduled publish — now enqueue a purge inside the same
  transaction as the content change, so a rolled-back write leaves no stray purge
  and a committed one cannot lose its invalidation.

  Purges are module-scoped, not resource-scoped: cached responses carry
  tenant/surface/module surrogate keys only, so a resource-scoped ban would match
  no object and leave the page stale while reporting success.

  No-op when `EDGE_CACHE_MODE` is off, so deployments that have not adopted the
  edge cache do not accumulate queue rows.

- 8a8e25c: Port the `form_drafts` module from awcms-micro (Issue #484) — row 1 of Gelombang 1 in `docs/awcms/absorb-awcms-micro-roadmap.md`. Net-new and additive: nothing existing changes behaviour, the module DAG stays acyclic (`dependencies: ["identity_access"]`), and nothing consumes it yet.

  A generic, **domain-agnostic** server-side draft store for multi-step forms. One table holds an opaque JSONB payload plus the coordinates needed to resume it (`module_key`, `wizard_key`, `resource_type`, `resource_id`, `current_step`); what the payload MEANS stays owned by whichever module created it. `type: "system"` — shared platform mechanism, like `logging` and `data_lifecycle`.

  - **Migrations `062` (schema) + `063` (permissions).** `awcms_form_drafts`, `ENABLE` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation`, four indexes covering the resume/expire/purge/dry-run query paths. `awcms_worker` gets exactly SELECT/UPDATE/DELETE — no INSERT, since the purge job never creates a draft. Four permissions (`draft.{read,create,update,delete}`).
  - **Endpoints** under `/api/v1/form-drafts` — list/create, get/patch/delete, and submit. Submit requires an `Idempotency-Key`; create deliberately does not, because a retried create costs one deletable scratch row while a retried submit hands the payload to a domain action twice. Requiring a key everywhere would just train callers to generate throwaway ones.
  - **Payload safety.** 32 KB ceiling, and any key at any nesting depth resembling a secret (`password`/`token`/`secret`/`credential`/`apiKey`/`privateKey`) is **rejected outright, never silently redacted** — a caller who gets a 200 back must not have to wonder whether a field was stripped.
  - **No `submit` permission.** Submit guards on `draft.update`; a separate action would widen the `AccessAction` union and plant a latent-authz trap, since an action nobody seeds into a role denies even the tenant owner while looking correct in review.
  - **Two-phase retention** via `bun run form-drafts:purge`: expire overdue drafts to `status='expired'` (a transition, not a delete), then physically purge `expired`/`abandoned` rows past the cutoff (default 30d). Both bounded and self-auditing.
  - **Legal-hold enforcement lives in this module, not in the engine.** The `data_lifecycle` descriptor is `delegated`: that engine only READS this table for backlog visibility and never mutates it, so a hold enforced only there would stop nothing. The real gate is in `purgeExpiredFormDrafts`, which asks the injected `LegalHoldGuardPort` before its DELETE and skips the batch when held. Phase 1 is deliberately ungated — it deletes nothing.

  Verified: `tests/form-draft-validation.test.ts` (18) plus a new `tests/form-drafts-module.test.ts` (12) whose drift guards were **mutation-proven red** — renaming the lifecycle key, dropping `FORCE ROW LEVEL SECURITY`, and over-granting the worker each fail the suite. One assertion was rewritten after the first mutation run showed it was tautological (both sides read the same constant, so a rename kept it green); the descriptor key is now pinned as a literal, because a rename silently orphans every legal hold already recorded against the old key.

  Not included, and not claimed: awcms-micro's wizard COMPONENT library (`src/components/ui/`) is a separate, still-open Gelombang-0 row, and there is no integration test against a real PostgreSQL for this module yet.

- c2a981c: feat(site-search): port the `site_search` module from awcms-micro (ADR-0040)

  Adds a tenant-scoped, cross-content PostgreSQL full-text search index over
  PUBLISHED public website content, its public host-resolved query/suggest
  surface, and its ABAC-guarded admin index/settings/diagnostics API.

  - **New module `site_search`** (`type: domain`, depends only on
    `tenant_admin`/`identity_access`) owning `awcms_site_search_documents` plus
    tenant config, the index run ledger, failed-item diagnostics, and an opt-in
    minimized query log (`sql/064`, `sql/065`).
  - **New contribution seam** `ModuleDescriptor.searchSources` — content modules
    declare reviewed, pure-data source descriptors in their own `module.ts` and
    the aggregator discovers them through `listModules()`, so nothing depends on
    `site_search`. `MODULE_CONTRACT_VERSION` 2.1.0 → 2.2.0 (additive: a
    `module.ts` that omits `searchSources` stays valid). `blog_content`
    contributes `blog_content.post`.
  - **New public endpoints** `GET /api/v1/site-search/query` and `/suggest`
    (anonymous, host-resolved, rate-limited) plus the public `/search` page, and
    **new admin endpoints** `GET|PUT /api/v1/site-search/settings` and
    `/api/v1/site-search/index/{status,reconcile,rebuild,failures}`.
  - **New scheduled job** `bun run site-search:reconcile` and a new registry gate
    `bun run site-search:sources:check` (added to the `check` chain).
  - **New `AccessAction` member** `reconcile` (deliberately not high-risk; the
    route is still idempotency-keyed and audited).

  Public URLs are built with a server-resolved `:tenantCode` because this base's
  public content routes are path-tenant-scoped (`/blog/{tenantCode}/{slug}`).
  awcms-micro's inline typeahead script on `/search` is not ported: this base's
  CSP forbids inline scripts and its public pages have no bundling step, so the
  page ships the no-JS core search and `/suggest` stays available to a theme's own
  client.

  Existing tenants do not retroactively gain the six new permissions — like every
  prior permission-seed migration, only tenants created after it runs get them via
  setup initialization. Backfill `awcms_role_permissions` when deploying.

- 476e6d1: Wire the Cloudflare DNS adapter so a database row becomes a working subdomain.

  Adds `ensureServingRecord` to the `TenantDomainDnsProvider` port and a
  reconciliation job (`bun run tenant-domain:dns:sync`) that brings the managed
  Cloudflare zone into line with the active `domain_type = 'subdomain'` rows in
  `awcms_tenant_domains`.

  Reconciliation, not a create-time API call: it is idempotent, retries a failed
  record on the next pass, and heals drift introduced by hand in the dashboard —
  none of which a side effect inside the create request can do. Serving records
  are desired-state, so a drifted record is moved with `PUT` rather than joined by
  a second record that would round-robin the tenant between two targets.

  Scope: platform subdomains only. Custom domains live in the tenant's own zone
  and keep the manual/TXT verification flow. Nothing is ever deleted.

  `sql/069` grants the worker `SELECT` (only) on `awcms_tenant_domains`. Unset
  config is a no-op: there is deliberately no default serving target.

- f4ee902: Add an optional Varnish edge-cache tier with origin-pressure auto-activation (ADR-0042).

  Public, tenant-scoped, content-derived GET surfaces can now be answered by a
  cache in front of the application instead of re-running the same database work
  for every anonymous visitor. Off by default and a genuine no-op when off.

  - `src/lib/edge-cache/` — fail-closed cacheability decision, surrogate-key
    vocabulary, rolling-window pressure tracker, surface allow-list, header
    application, durable purge queue, Varnish BAN client.
  - `sql/068` — `awcms_edge_cache_purges` invalidation queue (ENABLE + FORCE RLS),
    with matching `WORKER_ROLE_GRANTS` entries.
  - `infra/varnish/` — default-deny VCL and a compose overlay.
  - `bun run edge-cache:surfaces:check` — new registry gate in `bun run check`.
  - `bun run edge-cache:purge` — scheduled invalidation worker.

  Cacheability is an allow-list: an undeclared route is never cached. The
  auto-activation ramp can only change how long something is cached, never whether
  a private response becomes cacheable.

### Patch Changes

- bc7a883: Document the awcms-mini backbone absorption programme
  (`docs/awcms/absorb-awcms-mini-backbone-roadmap.md`).

  Records an audit finding: five modules are admitted by **Accepted** ADRs in this
  repository but have no code — `organization_structure` (ADR-0016),
  `document_infrastructure` (ADR-0017), `data_exchange` (ADR-0018),
  `integration_hub` (ADR-0019) and `reference_data` (ADR-0021). ADR-0020 (ERP
  readiness contracts) is likewise Accepted with no `_shared` implementation. The
  SaaS control-plane cluster is not admitted here at all and is gated behind a new
  admission ADR.

  Documentation only — no runtime change.

- 4343f9e: Fix edge-cache invalidation, which had never worked.

  The ban expression built by `infra/varnish/default.vcl` used `(^| )key( |$)` to
  anchor a surrogate key to a whole token. Varnish parses a ban expression by
  splitting it on **whitespace** into `<field> <operator> <argument>`, so the
  literal spaces inside that regex produced the wrong token count and every ban
  was rejected with `Wrong number of arguments`.

  Nothing surfaced it. The VCL's BAN handler returns `200` regardless, so
  `sendEdgeCachePurge` recorded success, the queue row was marked done, and the
  object stayed cached until its TTL expired. The subsystem reported healthy
  invalidation while performing none — the precise failure mode ADR-0042 exists to
  prevent. It was found by putting Varnish in front of staging and watching
  `X-Cache` stay `HIT` after a purge.

  Both sides now emit `(^|[[:space:]])key([[:space:]]|$)`: same boundary semantics,
  no literal space. Quoting the regex is not an alternative — the split happens
  before quote handling (verified against Varnish 7.5).

  Also corrects `infra/varnish/docker-compose.varnish.yml`, which named
  `varnishcache/varnish:7.5`. No such Docker Hub repository exists, so adopting the
  overlay failed with `pull access denied`. The image is `varnish:7.5`.

  Guarded by two file-level assertions in `tests/edge-cache.test.ts`, because the
  runtime expression is built in VCL rather than TypeScript and no unit test of the
  origin can observe it.

- 7e338da: Fix the edge-cache purge queue's tenant-isolation policy, which read a GUC the
  application never sets — breaking every blog write when the cache was enabled.

  `sql/068` created `awcms_edge_cache_purges_tenant_isolation` against
  `current_setting('awcms.tenant_id', true)`. `withTenant()` sets
  `app.current_tenant_id`, and so do the other 108 tenant policies in `sql/`.
  `sql/068` was the only outlier.

  The consequence was not a stale cache. `current_setting` returned NULL, so the
  `WITH CHECK` predicate was NULL and every INSERT was rejected with
  `new row violates row-level security policy`. `enqueueModuleContentPurge` is
  awaited **inside** the content transaction (ADR-0042 §9 / ADR-0006) and is not
  guarded, so that rejection aborted the publish: with `EDGE_CACHE_MODE` set to
  `auto` or `on`, blog create, update, delete, and scheduled publish all returned 500. The `USING` side failed in the opposite, quieter direction — the purge
  worker matched zero rows and reported `sent=0`, which reads exactly like an empty
  queue.

  It could not surface earlier. The subsystem defaults to `off`, where the enqueue
  returns before touching the database, so no CI job, integration test, or
  deployment had ever written to this table. It appeared on the first request after
  the feature was switched on.

  `sql/070` replaces the policy. `sql/068` is left untouched — it is applied in a
  running deployment and rewriting it would change its checksum and block
  `db:migrate`.

  Adds `tests/migration-tenant-guc-consistency.test.ts`: a database-free gate that
  scans every migration's executable SQL (comments stripped, so a repair migration
  may name the wrong GUC while explaining itself) and fails on any
  `current_setting` that is not `app.current_tenant_id`. It runs in the `quality`
  job on every PR, which is where this class of typo needs to be caught — at
  authoring time, not on the day a flag is enabled in production.

- 7e338da: Fix the purge transport: Bun cannot send the `BAN` method, so no purge ever
  reached Varnish.

  `sendEdgeCachePurge` issued `fetch(endpoint, { method: "BAN" })`, the
  conventional Varnish idiom. **Bun does not transmit non-standard HTTP methods.**
  Both `fetch` and `node:http` deliver that request as `GET` — confirmed against
  Bun 1.3.14 with `varnishlog -i ReqMethod`, where the same request written
  byte-for-byte over a raw socket logs `BAN` and answers `200 Banned`.

  Every purge therefore fell past the VCL's ban branch to the origin, which 404s an
  unrouted path. On a Bun-only runtime (ADR-0002) no configuration makes the `BAN`
  method work.

  The wire protocol is now `POST /__edge-cache-purge`. The security model is
  unchanged — the method was never a control; the purge ACL, the shared token, and
  the key-charset re-validation at the edge all still apply, to both entry points.
  The VCL continues to accept a real `BAN`, so `curl -X BAN` remains available for
  operator debugging.

  Adds `tests/edge-cache-purge-client.test.ts`, the first tests this client has had.
  They run against a real `Bun.serve` and assert `request.method` **as received**,
  because that is the only formulation that can fail for the reason this failed: an
  injected `fetchImpl` observes the argument, not the wire, and would have asserted
  `method === "BAN"` and passed forever.

- f2b96da: Pin the two deployed environments to their domains: `awcms.ahlikoding.com`
  (production) and `awcms-staging.ahlikoding.com` (staging).

  Adds `docs/awcms/environments.md` (domains, per-environment `APP_ENV`/`APP_URL`,
  staging isolation rules, DNS, edge-cache settings) and references it from
  `.env.example` and `deploy-coolify.md`, which previously used only generic
  placeholders.

  `APP_URL` is called out specifically because it builds the OIDC/SSO callback URL
  — a wrong host breaks login rather than just looking wrong.

  Documentation and example configuration only; no runtime change.

- 78a530b: docs(site-search): correct the CSP rationale on the `/search` page renderer

  PR #229 landed between the site_search port and this change: `script-src` is now
  always emitted, carrying `'self'` plus the SHA-256 of the admin theme-init
  script. The renderer's comment still described the policy as `default-src 'self'`
  and implied inline scripts are categorically impossible.

  The no-`'unsafe-inline'` guarantee is unchanged, and the page's behaviour is
  unchanged — but a reader would now find a sanctioned hashed-inline script in the
  tree and conclude the comment was simply out of date. It names that pattern
  explicitly and states the reason it does not apply here: this route is a plain
  APIRoute with no build step to compute or keep such a hash in sync.

- f6d0353: Record the real state of the deployed environments: staging is live at
  `awcms-staging.ahlikoding.com` (own Coolify app and database, R2/email/sync off),
  production DNS and app already existed, and `awcms-micro-staging` has been
  removed.

  Also documents why `db:migrate` cannot run via `docker exec` on the production
  image — it is runtime-only and does not ship `scripts/` — and gives the one-shot
  container command instead. Staging has no schema until that is run.

  Documentation only.

## 6.1.0

### Minor Changes

- eb5519a: Reposisi governance AWCMS (ADR-0035, menyempurnakan positioning ADR-0034 — `docs/adr/0035-awcms-online-first-erp-saas-superset-repositioning.md`): `awcms` kini diposisikan sebagai template **online-first hybrid** (online jalur utama; offline/LAN mode ketahanan), **siap ERP + SaaS terintegrasi**, dan **superset** keluarga yang **menyerap** klaster website/e-commerce, UI/UX, dan pengerasan auth `awcms-micro` langsung ke `src/modules/`. `awcms-mini` tetap hybrid offline-first (siap SaaS); `awcms-micro` tetap template website full-online ramping. Model tata kelola dipakai-langsung/tanpa-repo-turunan (ADR-0034 §2/§3) tidak berubah.

  Perubahan dokumentasi/governance saja (tanpa perubahan kode runtime): ADR-0035 baru + banner supersede-parsial di ADR-0034; reposisi README/README.id/AGENTS/PROJECT_STATE + paket `docs/awcms/` (01/06/09/10/12/13/15, alur-pengembangan-mini-first, README index, api-contribution-guide); manifest `awcms-family-compatibility.yaml` (`role` + rasional divergence Turnstile diselaraskan ke mode hybrid); dokumen peta baru `docs/awcms/absorb-awcms-micro-roadmap.md` untuk penyerapan bertahap awcms-micro.

- c25e795: Port the redirect-governance scope of `seo_distribution` from awcms-micro (ADR-0039, companion to ADR-0038 — `docs/adr/0039-seo-distribution-redirect-governance.md`), completing the module whose discovery half shipped in ADR-0038. Adds tenant-contained exact-path redirect rules (301/302/307/308), URL-change capture into audited redirect proposals, privacy-minimized 404 telemetry, and the admin API under `/api/v1/seo/redirects/*` + `/api/v1/seo/not-found/*`.

  - **Migrations 060 (schema) + 061 (permissions).** Three tenant-scoped tables (`awcms_seo_redirects`, `awcms_seo_not_found_observations`, `awcms_seo_redirect_settings`), all `ENABLE`+`FORCE ROW LEVEL SECURITY` + `tenant_isolation`; the 404 table has a `dataLifecycle` analytics_telemetry descriptor (`seo_distribution.not_found_observations`, generic purge, 30d default) with a `SELECT, DELETE ... TO awcms_worker` grant. Six new permissions (`redirect.{read,create,update,delete}`, `not_found.{read,update}`).
  - **One invasive `src/middleware.ts` edit** — the non-`/admin` branch resolves a public redirect BEFORE serving and records a best-effort 404 observation AFTER. FAIL-OPEN: the resolver swallows all faults to null (never a 500), the 404 capture never throws; the `/admin` login guard and API body-ceiling are untouched. Wiring lives in the importable `src/lib/seo/redirect-middleware.ts`.
  - **Open-redirect / loop / hijack defenses** — the frozen `classifyRedirectTarget`/`assertSafeRedirectTarget` guard is re-homed as a standalone domain helper (`redirect-target-classification.ts`), NOT re-added to the `seo_facts` port, and enforced on write AND every resolve; normalization rejects CRLF/traversal/Unicode-confusion/protocol-relative; chains are bounded + non-recursive (fail-closed on loop/over-cap); the eligibility gate excludes admin/API/auth/static/system/discovery paths.
  - **Adaptations (documented in ADR-0039):** tenant resolution is host-based-only first cut (path-tenant deferred); the legacy `/blog/{tenantCode}` → `/news` rewrite is INERT (no `/news` route family, policy off by default); `locale` is always null (awcms has no i18n seam). `seo_distribution` bumped 0.1.0 → 0.2.0.

- 0dce625: Media-library ownership inversion (ADR-0036, mengadaptasi awcms-micro ADR-0026 — `docs/adr/0036-media-library-module-admission-ownership-inversion.md`).

  **CAPABILITY RETIREMENT (bukan bump minor kapabilitas):** capability `news_media` **dipensiunkan** dan digantikan `media_library`. Penyedianya berubah (`news_portal` → `media_library` baru) **dan** kontrak port kehilangan satu method (`isFullOnlineR2ModeActiveForTenant` → `isManagedMediaEnforcementActiveForTenant`; `resolveMediaPublicBaseUrl` di-drop). `_shared/capability-contract-versions.ts` + manifest `awcms-family-compatibility.yaml` menambah `media_library: "1.0.0"`; setiap konsumen yang dipin ke `news_media` harus gagal terang-terangan.

  Perubahan NON-aditif — menyentuh modul yang sudah di-ship:

  - **Modul baru `media_library`** (System Foundation, `type: system`, `isCore: false`, deps `[tenant_admin, identity_access]`): registry media `awcms_news_media_objects` (tabel TIDAK di-rename — FK komposit keras dari ad placements), presigned upload/finalize/cancel, MIME sniffing, verifikasi R2, job `news-media:reconcile` (nama command dipertahankan), plus penyalaan enforcement (`POST/GET /api/v1/media/enforcement`, satu arah, readiness-gated + audited).
  - **`news_portal`** tidak lagi PROVIDES `news_media`; kini CONSUMES `media_library` (wajib) + `public_content`; basePath berubah ke `/api/v1/news-portal`; job reconcile & 9 permission media pindah keluar.
  - **`blog_content`** consumes `media_library` (opsional, dulu `news_media`); adaptor no-op media vestigial dihapus; gate media & 12 composition-root handler + worker menyuntik `mediaLibraryPortAdapter`.
  - **Migrasi (ADD-only, urutan load-bearing):** `052` repoint permission `news_portal.media.*` → `media_library.media.*` (INSERT→repoint grant→DELETE), `053` tabel `awcms_media_library_tenant_state` (RLS ENABLE+FORCE + backfill dari `awcms_news_portal_tenant_state`), `054` permission `media_library.enforcement.{read,enable}`.
  - Fragment OpenAPI media dipindah ke `openapi/modules/media-library.openapi.yaml` (+ path enforcement); bundle + api-reference diregenerasi.

  Diverifikasi terhadap PostgreSQL nyata: repoint permission bersih, RLS FORCE + isolasi tenant + fail-closed `awcms_app`, dan backfill lintas-tenant (role migrasi BYPASSRLS). Step 5b/5c/5d micro (`/admin/media`, srcset, PDF) ditunda.

- a777152: Port modul `blog_content` dari awcms-mini: manajemen blog/konten tenant-scoped (posts, pages, kategori/tag, riwayat revisi append-only, pencarian full-text, template/menu/widget/iklan presentasi, pengaturan blog, dan automatic internal tag linking). Menambahkan 6 migrasi baru (`sql/035`-`sql/040`, 15 tabel + seed 39 permission), ~40 route admin di `/api/v1/blog/*`, 7 route publik anonim di `/blog/{tenantCode}/...` (ADR-0009), job terjadwal `bun run blog:publish:scheduled`, serta fragment OpenAPI/AsyncAPI baru untuk modul ini.

  Dua kapabilitas opsional modul ini (`news_media` dari `news_portal`, `social_publishing` dari `social_publishing`) belum punya provider nyata di base ini — setiap titik panggil memakai adapter no-op modul sendiri (mode full-online-R2-only selalu tidak aktif, hook social-publishing selalu no-op `{ jobsCreated: 0 }`), aman dan terdokumentasi, tanpa mengimpor modul yang belum ada. Keluarga rute `/news/**` (butuh modul `tenant_domain` yang belum di-port) sengaja tidak diikutkan di port ini.

- cc52dce: Port modul `data_lifecycle` dari awcms-micro (Issue #745, ADR-0037) sebagai modul **System Foundation** net-baru aditif, PLUS re-wire kopling legal-hold dua konsumen (`visitor_analytics`, `logging`) yang di-drop saat port awalnya.

  - **Seam kontrak (aditif, MINOR):** `ModuleDescriptor.dataLifecycle?: HighVolumeTableDescriptor[]` + keluarga tipe `Lifecycle*` di `_shared/module-contract.ts` (`MODULE_CONTRACT_VERSION` 2.0.0 → 2.1.0, pin manifest keluarga diselaraskan). Registry dikontribusikan tiap modul pemilik, divalidasi `bun run data-lifecycle:registry:check` (masuk rantai `check`) + `security:readiness`.
  - **Modul** (`src/modules/data-lifecycle/`, 16 berkas): legal-hold (rules murni + service + guard-port adapter), lifecycle-registry, dry-run planner (zero-mutation), bounded archive/purge engine di worker runner bersama, archive port provider-neutral + local/offline adapter (JSONL/CSV + SHA-256), cursor/manifest/run stores, cursor-boundary safety margin (1ms, fix presisi timestamptz mikrodetik). `type: system`, deps `[tenant_admin, identity_access, logging]`, 6 permission, job `data-lifecycle:archive-purge`, satu descriptor `generic` (tabel run-history sendiri), aturan SoD maker/checker `legal_hold.create` vs `.release`.
  - **Skema** (migrasi `055` schema, `056` permission): empat tabel tenant-scoped (`awcms_data_lifecycle_legal_holds`/`_cursors`/`_archive_manifests`/`_runs`), semua `ENABLE`+`FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`, CHECK konsistensi + index; GRANT `awcms_worker` least-privilege — **SELECT-only pada legal_holds** (create/release tetap aksi admin/API), SELECT/INSERT/UPDATE pada cursors+manifests, SELECT/INSERT/DELETE pada runs. Non-destruktif (semua `IF NOT EXISTS`).
  - **Endpoint** (`/api/v1/data-lifecycle/*`): registry GET, dry-run POST (tanpa idempotency), runs GET, legal-holds GET+POST (Idempotency-Key + audit critical), legal-holds/{id}/release POST (Idempotency-Key + audit critical). Archive/purge nyata **tidak** diekspos lewat HTTP (job saja). Fragmen OpenAPI per-modul + bundle + api-reference diregenerasi.
  - **`AccessAction` baru:** `release` (HIGH-RISK — melepas hold menghapus safeguard perlindungan data).
  - **Legal hold tidak bisa di-bypass diam-diam:** dienforce pada RECORD hold aktif (bukan metadata `legalHold.applicable`), dicek SEBELUM DELETE dan tanpa syarat. Untuk deskriptor `delegated`, fungsi purge modul pemilik adalah titik enforcement nyata via `LegalHoldGuardPort` (`_shared/ports/legal-hold-guard-port.ts`, seam level-sumber, bukan capability-registry) yang di-wire di composition root.
  - **Re-wire `visitor_analytics`:** descriptor `visitor_analytics.visit_events` + param ke-5 `legalHoldGuard` pada `purgeVisitorAnalyticsData` menggerbangi HANYA DELETE step-1 `awcms_visit_events` (step 2-4 tetap tak-tergerbang); adaptor di-inject di `POST /api/v1/analytics/retention/purge` + `scripts/visitor-analytics-purge.ts`.
  - **Re-wire `logging`:** descriptor `logging.audit_events` + param **WAJIB** `legalHoldGuard` pada `purgeExpiredAuditEvents` menggerbangi DELETE audit-events; adaptor di-inject di `scripts/audit-log-purge.ts`.
  - **Ditunda:** konsumen `form_drafts`/`newsletter`/`comments` (modul belum di-port).

- a777152: Port modul `news_portal` dari awcms-mini: registry media objek R2-only tenant-scoped (`awcms_news_media_objects`) dengan alur presigned upload langsung-ke-R2 (create/finalize/cancel), homepage section composer editorial (`awcms_news_portal_homepage_sections`), ad placement preset R2-only (`awcms_news_portal_ad_placements`), state tenant mode R2-only (`awcms_news_portal_tenant_state`), dan job rekonsiliasi `news-media:reconcile`. Migrasi `sql/041`..`sql/045` (empat tabel baru RLS ENABLE+FORCE). Modul MENYEDIAKAN capability `news_media` — adapter nyata kini menggantikan no-op blog_content di seluruh composition root (route + worker `blog:publish:scheduled`) — dan MENGONSUMSI `public_content` blog_content untuk validasi referensi homepage section. Rute publik `/news/**` (butuh `tenant_domain`), halaman admin `.astro`, dan aktivasi preset (butuh subsistem preset `module_management`) sengaja di-drop dan didokumentasikan. Menambah aksi `verify` ke union `AccessAction`, grant `awcms_worker` untuk job rekonsiliasi, dan skrip `news-media:reconcile`.
- c9baa0c: Port modul `seo_distribution` — **scope discovery** — dari awcms-micro (ADR-0038, mengadaptasi awcms-micro ADR-0028; program penyerapan ADR-0035, Wave 1). Aditif net-baru; DAG tetap asiklik.

  Yang ditambahkan:

  - **Seam capability `seo_facts`** (`_shared/ports/seo-facts-port.ts`, `CAPABILITY_CONTRACT_VERSIONS["seo_facts"]="1.1.0"`): kontrak kontribusi beku (tipe fakta + guard JSON-LD terkontrol + predikat visibility + cache-key). `blog_content` kini `provides: ["public_content","seo_facts"]` lewat adaptor `application/seo-facts-port-adapter.ts` (baris `awcms_blog_posts` → `SeoResourceFacts`; noindex/non-publik/belum-terbit → `sitemap:null`/`feed:null`). `seo_distribution` `consumes` `seo_facts` (opsional) + `media_library` (opsional).
  - **Modul `seo_distribution`** (`type: domain`, v0.1.0, deps Core-only): renderer metadata terpusat (canonical/hreflang/robots/OG/Twitter/JSON-LD terkontrol, host diturunkan server dari `tenant_domain`), serializer sitemap/robots/feed, orkestrator discovery + validator cache (ETag/Last-Modified/304).
  - **Route discovery publik tak-terautentikasi** di root host: `/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json` (route Astro XML/text, bukan OpenAPI; `src/middleware.ts` TIDAK diedit).
  - **Config admin tenant** `GET`/`PUT /api/v1/seo/config` (`config.read`/`config.update`, tenant-scoped, `PUT` idempoten + di-audit) + fragment OpenAPI + tag "SEO & Distribution".
  - **Migrasi 057-059**: `awcms_seo_tenant_settings` (RLS ENABLE+FORCE + `tenant_isolation`), seed permission config, kolom config feed/sitemap.
  - Helper aditif `escapeXmlText` + varian error `text/plain` di `src/lib/html/*`; env var publik didokumentasikan (`PUBLIC_TRUST_PROXY`, `PUBLIC_TENANT_RESOLUTION_MODE`, `PUBLIC_DEFAULT_TENANT_*`).

  Ditunda ke PR lanjutan (tata-kelola redirect): aturan redirect + hook redirect middleware, tabel telemetri 404, descriptor `dataLifecycle`, dan permission `redirect.*`/`not_found.*`.

- 359bd7a: Port modul `tenant_domain` dari awcms-micro (epic #555): pemetaan
  hostname/subdomain → tenant untuk routing publik berbasis host (Wave-0 program
  penyerapan awcms-micro). Menambah tabel `awcms_tenant_domains` (migrasi 046, tenant-scoped
  `ENABLE`+`FORCE ROW LEVEL SECURITY`, unique hostname lintas-tenant, satu primary
  per tenant), seed permission `tenant_domain.domains.*` (migrasi 047), dan fungsi
  lookup host→tenant `awcms_resolve_tenant_domain_lookup` `SECURITY DEFINER`
  (migrasi 048). Fungsi ini di-own oleh role bootstrap khusus `awcms_domain_bootstrap`
  (`NOLOGIN`/`NOSUPERUSER`/`NOBYPASSRLS`, tanpa anggota) dengan policy `FOR SELECT`
  ter-scope (`USING (true)` khusus role itu) sehingga bootstrap host→tenant tetap
  resolve di deployment role-separated tempat owner migrasi **bukan** superuser
  (mis. `awcms_app`/`awcms_worker`/`awcms_setup` dari sql/019–022, dan harness
  integrasi yang men-demote owner-nya) — tanpa memberi `BYPASSRLS` ke role apa pun,
  tanpa melepas `FORCE ROW LEVEL SECURITY`, dan tanpa menyentuh policy
  `tenant_isolation`. `EXECUTE` hanya ke `awcms_app`; kolom sensitif
  (`verification_token_hash`/`verification_record_value`) tetap tak terbaca.

  API manajemen tenant-scoped di `/api/v1/tenant/domains` (list/create/read/
  update/soft-delete + `verify` dan `set-primary` yang ber-`Idempotency-Key` dan
  diaudit), layar admin `/admin/tenant/domains`, resolver host publik ADITIF
  (`lib/tenant/public-host-tenant-resolver.ts` — hidup berdampingan dengan
  routing berbasis path `/blog/{tenantCode}` ADR-0009, tidak meregresi), dan
  adapter Cloudflare DNS OPSIONAL (env-gated, aman tanpa kredensial, belum
  di-wire ke rute mana pun).

  Deferral yang didokumentasikan: rute konten publik ber-resolusi host belum
  di-wire (deferral yang sama seperti `/news/**` news_portal); `src/middleware.ts`
  tidak disentuh (jaminan login/Turnstile/CSP tak berubah). Union `AccessAction`
  identity-access diperluas dengan `set_primary`.

  **Risiko residual (harden sebelum go-live self-service custom domain).** `verify`
  saat ini mengaktifkan domain berdasarkan field in-row tanpa bukti kepemilikan
  outbound (model manual-first; adapter DNS ada tapi belum di-wire). Untuk mencegah
  pengambilalihan domain (dangling-DNS) pada custom domain bersama, aktivasi
  `custom_domain` **wajib digerbangi operator/manual** sampai bukti kepemilikan
  DNS-token (`verification_token_hash` + cek TXT/CNAME lewat adapter) di-wire.
  `verify` sudah default-deny + di-audit; risiko ini didokumentasikan di README modul
  dan skill `awcms-tenant-domain-routing`.

- 8c959ff: Port modul `visitor_analytics` dari awcms-micro (epic #617-#624) sebagai modul standalone `type: "system"` (ADR-0035 Wave 1). Menambah statistik pengunjung manusia **privacy-first** untuk rute admin & publik, online maupun offline/LAN.

  - **Skema** (migrasi 049 permission, 050 schema, 051 session-lookup index): `awcms_visitor_sessions`/`awcms_visit_events`/`awcms_visitor_daily_rollups`, semua `FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`, index tenant_id-first, composite FK `(tenant_id, visitor_session_id)` lintas-tenant, dan GRANT `awcms_worker` least-privilege untuk job terjadwal.
  - **Privasi:** off by default (`VISITOR_ANALYTICS_ENABLED=false`); visitor-key/IP/user-agent disimpan hanya sebagai HMAC-SHA256 bersalt (salt wajib saat enabled — ditegakkan `validate-env`); raw IP & login snapshot opt-in terpisah; query string sensitif di-strip fail-safe.
  - **Koleksi = endpoint ingest PUBLIK** `POST /api/v1/analytics/collect` (anonim, resolve tenant dari `tenantCode` tabel `awcms_tenants` yang RLS-free — TANPA SECURITY DEFINER), **bukan** middleware: `src/middleware.ts` tidak disentuh (jaminan login/Turnstile/CSP tetap).
  - **API terautentikasi ABAC:** `GET /api/v1/analytics/{summary,realtime,sessions,events,pages,devices,locations,security,settings}`, `PATCH .../settings`, dan `POST .../retention/purge` (Idempotency-Key + audit `critical`). Raw-detail digerbangi `visitor_analytics.raw_detail.read`.
  - **Job:** `bun run analytics:rollup` & `bun run analytics:purge` (worker role, offline-safe).
  - **Dashboard** `/admin/analytics` (SSR-render).

  Adaptasi port terdokumentasi: kopling `data_lifecycle`/`LegalHoldGuardPort` DI-DROP (modul belum ada di base — purge tanpa gerbang legal-hold), dan wiring preset `news_portal_full_online_r2` DEFERRED (modul `news_portal` tidak disentuh).

  **Security hardening (DoD + security review atas port ini):**

  - **Rate-limit backstop pada beacon publik.** `POST /api/v1/analytics/collect` (unauth DB write) kini digerbangi rate limit per-IP (`checkRateLimit` yang sama dengan login/setup) SEBELUM tulis DB — mencegah flooding baris/pencemaran agregat oleh pemegang `tenantCode` publik. Kunci berbasis IP saja (tak membocorkan eksistensi tenant); `path` dibatasi panjang sebelum disimpan. Tunable `VISITOR_ANALYTICS_COLLECT_RATE_LIMIT_MAX`/`_WINDOW_SEC` (default 120/60s).
  - **Salt HMAC per-tenant (privacy-by-design).** `visitor_key_hash`/`ip_hash`/`user_agent_hash` kini di-key dengan salt deployment DAN `tenantId` (domain-separator `\0`), sehingga browser/IP/user-agent yang sama menghasilkan hash BERBEDA lintas tenant satu origin — menutup korelasi lintas-tenant di lapisan penyimpanan. Diterapkan mumpung belum ada data. `VISITOR_ANALYTICS_HASH_SALT` kini wajib ≥ 16 karakter saat modul aktif.
  - **raw_detail lewat ABAC, bukan hanya keanggotaan RBAC.** Field de-anonimisasi (`ipHash`/`ipAddress`/`userAgentHash`/`loginIdentifierSnapshot`) di `GET /sessions`, `GET /events`, dan `/admin/analytics` kini diputuskan lewat evaluator ABAC (`evaluateFieldAccessInTransaction`) sehingga kebijakan DSL `deny` atas `raw_detail.read` dihormati (deny-overrides-allow).
  - Log fragmen IP mentah pada header forwarded multi-nilai dihapus (`client-ip.ts` hanya mencatat `valueCount`, bukan nilai).

- bc7c4fa: Overhaul UI/UX seluruh surface pengguna: mobile-first responsif, animasi profesional CSS-murni, dan aksesibilitas (WCAG AA, `prefers-reduced-motion`, skip-link, target sentuh ≥44px). Semua di dalam jaminan CSP single-owner "zero third-party origin di LAN/offline" — tanpa font CDN/library eksternal; animasi = keyframes/transition CSS; styling di-serve same-origin (bundle Astro atau `public/css/*.css`), tidak ada `<style>`/`<script>` inline.

  - **Design system (fondasi)**: perkaya `tokens.css` (skala tipografi/spacing/radius/elevation, tint interaksi, token MOTION durasi+easing), tambah lapisan utility animasi reusable `motion.css` (fade/scale/slide/stagger/hover-lift/skeleton/spinner), dan shell layout admin+publik responsif dengan drawer mobile CSS-only.
  - **Login**: redesign form + auto tenant picker — 1 tenant disembunyikan/prefilled, 2–50 dropdown nama tenant, >50 fallback manual (anti mass-enumeration), fail-closed ke input manual saat pre-setup/DB error. Tanpa endpoint publik baru; kontrak DOM login dipertahankan.
  - **Admin**: 8 layar (`index`/`users`/`roles`/`offices`/`profiles`/`modules`/`abac-policies`/`email-templates`) mobile-first — tabel lebar → pola kartu/stack (`data-label` per sel), stat/quick-link beranimasi, hierarki visual & empty state konsisten. Selektor/hook E2E dipertahankan.
  - **Blog publik** (`/blog/{tenantCode}/...`): tipografi baca nyaman (measure ~65ch), kartu post grid→stack, media/tabel/kode responsif, animasi entrance halus; renderer `content_json` whitelist-based tidak dilonggarkan.

### Patch Changes

- 2a1e73e: Perbaiki logika fallback media type di `scripts/api-spec-check.ts` (CodeQL alert #140, `js/trivial-conditional`). `asRecord()` selalu mengembalikan objek non-null, sehingga operator `??` pada `asRecord(content["application/json"]) ?? Object.values(content)[0]` membuat cabang fallback jadi dead code — response error yang hanya memakai media type non-`application/json` salah dilaporkan tidak beresolusi ke envelope `ApiError`. Nullish-coalescing dipindahkan ke dalam `asRecord` agar fallback ke media type pertama benar-benar berjalan.
- 59757f1: chore: refresh the tracked graphify knowledge-graph output (`graphify-out/`)
  via `/graphify --update` after the project-state doc sync and agent-guide PDF
  removal — 6664 nodes / 19913 edges / 330 communities. Artifact-only; no runtime
  behavior change.
- 4905024: Login card entrance is now transform-only (`@keyframes auth-card-rise`,
  `translateY`) instead of the shared `.fade-in-up` utility that fades from
  `opacity: 0`. Fading the whole card — including its text — from transparent can
  let an axe-core contrast scan read semi-transparent text as a contrast
  violation if it scans mid-animation; a transform-only entrance keeps the text
  fully opaque throughout. A local `prefers-reduced-motion` guard neutralises it
  (motion.css's global reduced-motion block only targets its utility classes).
  CSS/markup only — the DOM contract and login logic are unchanged. Documented as
  the canonical rule in doc 14 §Motion / §Auth screen.
- 4c42029: feat(tooling): port `memory:docs:sync` from awcms-mini — snapshot the
  out-of-repo Claude Code agent memory into a committed `docs/awcms/agent-memory.md`
  so it survives clones/device moves (`sync`/`restore`/`check`). Adapts the doc
  path, header, password-placeholder redaction, and excludes the device-specific
  local-Postgres memory. check:docs exempts the generated mirror; prettier ignores
  it. Dev-tooling only — no runtime behavior change.
- d5ec206: chore: track the graphify knowledge-graph output (`graphify-out/`) so the repo
  graph is viewable from a clone. Regenerable cache and machine/user-specific path
  markers stay gitignored; the artifacts are excluded from prettier.

## 6.0.0

### Major Changes

- 0f39650: refactor(module-composition)!: hapus penuh jalur aplikasi-turunan (ADR-0034 §3, Fase 2)

  Menghapus permukaan yang khusus jalur aplikasi-turunan sesuai keputusan ADR-0034 §3 (awcms = template dipakai-langsung, tidak ada repo derivatif): seam `src/modules/application-registry.ts`, gerbang `bun run extension:check` (`scripts/extension-check.ts`, dari script `check` + ci.yml), konsep migration namespace turunan 900-999, dan tipe komposisi `ApplicationModuleRegistry`/`ModuleMigrationNamespace`.

  `src/modules/module-management/domain/module-composition.ts` kini memvalidasi satu registry base (`validateComposedModuleRegistry(registry)`/`composeModuleRegistry(registry)`/`buildComposedModuleInventory(registry)` menerima `readonly ModuleDescriptor[]`, bukan `{ base, application }`); check turunan-only (`prohibited_base_override`, `invalid_module_type`, `migration_namespace_overlap`) dan `mergeModuleRegistries` dihapus. Check base-load-bearing (DAG, duplicate module key, capability binding, deployment profile, navigation, job descriptor) dipertahankan. `MODULE_CONTRACT_VERSION` naik `1.3.0` → `2.0.0` (MAJOR: tipe diekspor dihapus); manifest keluarga disesuaikan.

  Fixture `tests/fixtures/derived-application-example/` direlokasi jadi test-support non-derived `tests/fixtures/example-domain-modules/` (mengekspor `exampleDomainModules`) — cakupan test #178/#180/#181/#182 dipertahankan setara. Gate `modules:compose:check` + `modules:composition:inventory:check` tetap ada (validasi registry base); `docs/awcms/module-composition-inventory.json` diregenerasi. Tanpa migration.

### Minor Changes

- f7d15bf: Dynamic ABAC policy evaluator (Issue #179, epic #177) — the stored
  `awcms_abac_policies` rows are now CONSUMED at the `authorizeInTransaction`
  chokepoint (default-deny), instead of authorization resting on RBAC + built-in
  guards alone. Ported from awcms-mini (ADR-0033).

  - **Bounded condition DSL (`domain/abac-policy.ts`).** `conditions` is a
    versioned jsonb AST (`sql/031` adds `dsl_version`/`conditions`/`priority` +
    nullable applicability columns): `allOf`/`anyOf`/`not` composition and
    `{attr, op, value|valueAttr}` leaves over a closed, server-side attribute
    allow-list (`subject.*` from the authenticated context — never the request
    body; `resource.*` from the endpoint-populated verified resource; `action`;
    `env.*` server-derived, `env.ipTrusted` fail-closed `false`) and a fixed
    operator set (`eq/ne/in/nin/lt/lte/gt/gte/exists`). No `eval`, no `new
Function`, no dynamic import, no templated SQL. The parser/validator is
    fail-closed and allow-list membership is **own-property only**
    (`hasOwnProperty`) so prototype-chain keys (`__proto__`/`constructor`/…)
    cannot slip past the unknown-attribute check (fail-OPEN closed at both the
    authoring validator and the eval-time backstop).
  - **Pure evaluator (`domain/abac-evaluator.ts`) + precedence.**
    `evaluateAccess` gains an optional 5th param `abac?: { policies, env }` (after
    `businessScopeFacts`); omitted/empty = ABAC no-op, so every pre-existing ≤4-arg
    call site is behavior-identical. Precedence after the built-in guards
    (tenant isolation, self-approval, force-decision, business-scope #180): explicit
    DENY wins (and an invalid/error policy fails closed) BEFORE the RBAC check; the
    RBAC permission is still required (an allow-policy never creates one); applicable
    ALLOW policies act as a constraint (≥1 must be satisfied). The #181 SoD
    high-risk guard remains additive after the decision.
  - **Tenant-keyed cache (`application/policy-cache.ts`)** compiled once per tenant,
    invalidated deterministically after commit by EVERY policy mutation — both the
    new DSL surface AND the pre-existing flat `/api/v1/abac/policies` CRUD (#171),
    which now also invalidates so it can never bypass the evaluator. Per-process
    invalidation is a documented limitation.
  - **Two surfaces, one table — but the evaluator consumes ONLY DSL-managed
    policies.** A new `is_dsl_managed` discriminator (`sql/031`, default `false`)
    separates the two authoring surfaces: the flat #171 CRUD (which can set neither
    applicability nor a condition) leaves rows `is_dsl_managed = false`, and the
    cache loads ONLY `is_active AND is_dsl_managed` rows — so a flat row is NEVER
    evaluated and stays inert (its exact pre-#179 behavior). This closes a
    full-tenant lockout: a flat `deny` used to present as a wildcard, always-true
    DENY that bricked every request (including the operator's own
    `access_control.configure` — no in-band recovery); the migration is now
    deploy-safe (a pre-existing inert flat `deny` is not activated on migrate).
    Only the DSL surface sets `is_dsl_managed = true` (INSERT + UPDATE).
    Defense-in-depth: the DSL validator additionally REJECTS an unscoped +
    unconditional (`{allOf:[]}`) deny. See ADR-0033 §3.
  - **Admin API.** New `GET/POST /api/v1/access/policies`,
    `GET/PUT /api/v1/access/policies/{id}`,
    `POST /api/v1/access/policies/{id}/{enable,disable}` (guarded
    `identity_access.abac_policies.{read,configure}`, audited, only valid DSL is
    stored), `POST /api/v1/access/policies/simulate` (read-only, guarded `.analyze`,
    audited without a decision-log write), and `POST /api/v1/access/evaluate`.
    Permissions seeded in `sql/032`.
  - **Simulation foreign-subject authority gate.** Simulating a DIFFERENT existing
    tenant user resolves that user's real grants — an enumeration oracle — so it
    additionally requires `identity_access.access_control.read` (AWCMS has no
    `user_management` module; reading a user record is guarded by
    `access_control.read`); the probed subject id is recorded in the audit event.
  - **Decision log** records policy code + `dsl_version` + a static reason, never
    raw attribute values. Five illustrative ERP example policies ship in
    `fixtures/abac-example-policies.json` (not seeded into the base).

- 9db1da6: Implement audit log retention — `AUDIT_LOG_RETENTION_DAYS` is no longer a
  silent no-op (Issue #146).

  The variable was documented in `.env.example`, validated as an integer >= 1 by
  `scripts/validate-env.ts`, and described in doc 18 as being "dipakai job purge
  audit log". No such job existed. An operator who set it got unbounded growth of
  `awcms_audit_events` plus false confidence — worse than having no knob at all.
  Login now writes audit events without authentication (PR #157), so the table
  grows from unauthenticated traffic too.

  New `bun run logs:audit:purge` (`scripts/audit-log-purge.ts` +
  `src/modules/logging/application/audit-purge.ts`, ported from awcms-mini):

  - Deletes `awcms_audit_events` rows past the retention cutoff for every active
    tenant, in bounded batches (`DELETE ... LIMIT 5000`, oldest first) so a large
    backlog never holds one transaction open or locks the table unpredictably.
  - **Self-auditing**: each non-empty batch records its own purge as a new audit
    event in the same transaction (counts and cutoff only) — the table can never
    be emptied to "no evidence a purge happened".
  - Retention resolves as `--retention-days=<n>` > `AUDIT_LOG_RETENTION_DAYS` >
    730 days (2 years, the midpoint of doc 04's "1-5 tahun" range).
  - `--dry-run` counts what would be purged without deleting anything, sharing
    the cutoff computation with the real path so the preview cannot drift.
  - Runs through the shared job runner: advisory lock (no two concurrent runs on
    the same backlog), timeout, correlation id threaded into each purge event,
    structured telemetry, and `status: "partial"` when a tenant's backlog was not
    fully drained.
  - Registered as a `logging` module job descriptor; recommended daily, off-peak.

  Scope: `awcms_audit_events` only. `awcms_abac_decision_logs` (~8.6M rows/day at
  100 req/s) is deliberately untouched — it needs its own retention decision, and
  quietly bundling a delete policy for it here would be the wrong way to make it.

  Unlike mini's version, `purgeExpiredAuditEvents` takes no `LegalHoldGuardPort`:
  this base has no `data_lifecycle` module or legal-hold registry, and a guard
  with nothing behind it would always answer "not held" — a fake gate is worse
  than an honest absence. When a legal-hold registry lands, this function is the
  enforcement point and the parameter should be required, not optional.

- 9af1789: Deterministic build-time module composition seam for derived ERP applications
  (Issue #178, epic #177, ADR-0025 — implementing the design in ADR-0014). A
  derived repository can now contribute its own domain modules by editing only
  `src/modules/application-registry.ts` (default `undefined` in the base), without
  ever touching `src/modules/index.ts`. The base's effective `listModules()`
  registry is byte-identical (same order + object identity) to before this change.

  - `src/modules/index.ts` refactored to `baseModules` + `listBaseModules()` +
    `modules = mergeModuleRegistries(baseModules, applicationModuleRegistry)`;
    `listModules()`/`getModuleByKey()` behavior unchanged and the array reference
    stays stable (`descriptor-sync.ts` identity check preserved).
  - `src/modules/module-management/domain/module-composition.ts` — the pure
    validation engine (`composeModuleRegistry`/`validateComposedModuleRegistry`/
    `buildComposedModuleInventory`), reusing the existing DAG validator
    (`_shared/module-dependency-graph.ts`) and job validator
    (`module-management/domain/job-registry.ts`). Rejects: duplicate module key,
    prohibited base override, `type: base/system` from an application module,
    missing/cyclic dependency, capability provider conflict/missing,
    migration-namespace overlap (base reserves `1-899`), deployment-profile
    incompatibility, navigation path conflict, and invalid job descriptor.
  - `_shared/module-contract.ts` extended additively (`MODULE_CONTRACT_VERSION`
    1.1.0 → 1.2.0): `ModuleCapabilityContract`, `ModuleDescriptor.capabilities`,
    `ModuleCompatibilityContract.deploymentProfiles`, `ModuleMigrationNamespace`,
    and `ApplicationModuleRegistry`.
  - New gates wired into `bun run check` AND `.github/workflows/ci.yml`:
    `modules:compose:check`, `modules:composition:inventory:generate`/`:check`
    (deterministic `docs/awcms/module-composition-inventory.json`, no wall-clock),
    and `extension:check` (extension-seam health).

  No SQL migration, no API/event change. Full derived-application compatibility
  manifest validation (SemVer/checksum, ADR-0015) remains scheduled for Issue
  #183; `extension:check` currently validates the composition seam only.

- cad4ccb: Business-scope hierarchy generic authorization layer (Issue #180, epic #177
  Wave 2). Ports the generic business-scope FOUNDATION from awcms-mini (SoD
  enforcement #181 and the organization-structure domain module are deliberately
  excluded, with clean seams).

  - **Schema** (`sql/027` + seed `sql/028`) — two tenant-scoped, RLS
    `ENABLE`+`FORCE` tables: `awcms_business_scope_assignments` (subject→scope
    grant with effective dating, temporary expiry, revocation) and its
    append-only `awcms_business_scope_assignment_events` lifecycle history.
    Subject/role/actor FKs are COMPOSITE `(tenant_id, …)` (with new
    `UNIQUE (tenant_id, id)` on `awcms_tenant_users`/`awcms_roles`) so a
    cross-tenant subject/role cannot be referenced even though PostgreSQL RI
    checks bypass RLS (GHSA-r7cx-c4jh-cvvw / sql/020).
  - **Capability port** — `BusinessScopeHierarchyPort` (`_shared/ports/`, ADR-0011):
    `scope_type`/`scope_id` are GENERIC references; validity/ancestry come from a
    resolver a DERIVED app provides. The base ships a default NO-OP resolver
    (`resolved: false` for every scope type), so a pure-base deployment fails
    closed (assignment create denies `scope_unresolved`; scope-gated high-risk
    actions deny). `identity_access` declares `capabilities.consumes`
    (`business_scope_hierarchy`, optional); the in-repo fixture derived module
    provides a working dummy resolver.
  - **`evaluateAccess` integration** — new optional `businessScopeFacts` parameter
    (fully backward-compatible) with exact/descendant/ancestor/tenant-wide
    coverage. Unknown/unresolved/stale scope → default-DENY for high-risk actions
    (`resolved: false` is never treated as "no restriction"). Revocation/expiry
    takes effect immediately at the next decision (effective dating is the
    authoritative gate, not `status`).
  - **API** — `GET`/`POST /api/v1/identity/business-scope/assignments` and
    `POST …/{id}/revoke` (create/revoke high-risk, `Idempotency-Key` required,
    self-grant denied, audited). New permissions
    `identity_access.business_scope_assignments.{read,create,revoke}`.
  - **Job** — `identity-access:business-scope:expiry` transitions elapsed
    assignments to `expired` (append-only events + aggregate audit per tenant).
  - Docs: ADR-0030, ERD/data-dictionary, threat model (privilege expansion,
    stale cache, hierarchy cycle, scope spoofing), identity-access README, and
    derived-application guide (how a derived app provides the hierarchy resolver).

- 296b7e3: Narrow the `awcms_app` runtime DB role's blanket DML on the global, RLS-free
  tables (Issue #160, `sql/021_awcms_db_role_grants_narrow.sql`). Closes the
  residual documented by `sql/019`: `awcms_app` can no longer `DELETE`
  `awcms_tenants`, `DELETE` `awcms_schema_migrations`, or write `awcms_permissions`
  (now read-only), and loses `DELETE` on `awcms_setup_state`. The
  `INSERT`/`UPDATE`/`SELECT` that real code paths use (setup-wizard fallback,
  tenant-settings screen, module-registry sync) are kept.

  Deployment-affecting: apply the new migration with the migration-owner
  connection string, as usual. The worker/setup role split (mini's migration 045)
  remains deferred.

  Adds a `security:readiness` grant check ("Runtime role table grants match
  least-privilege matrix") that fails when `awcms_app` is over-granted on a global
  table or, critically, when a tenant-scoped table is RLS-forced but ungranted
  (`permission denied` at runtime) — the executing-role-bound `ALTER DEFAULT
PRIVILEGES` gap that the RLS-flag check cannot see.

- 9db1da6: Tambah role runtime least-privilege `awcms_app` (`sql/019_awcms_db_role_separation.sql`) — RLS akhirnya jadi batas keamanan nyata, bukan deklarasi kosong.

  Migration 017 (PR #139) menutup bypass **pemilik tabel** lewat `FORCE ROW LEVEL SECURITY` di 23 tabel, tapi PostgreSQL melewati RLS **tanpa syarat** untuk SUPERUSER/BYPASSRLS — dan `DATABASE_URL` selama ini adalah role migration owner (biasanya superuser). Artinya setiap policy `awcms_*_tenant_isolation` di repo ini masih inert saat runtime: isolasi tenant sepenuhnya bergantung pada klausa `WHERE tenant_id` di aplikasi. Migration 019 memport bagian ke-2 migration 013 (`enforce_rls_least_privilege`) dari awcms-mini:

  - `CREATE ROLE awcms_app NOLOGIN` (idempoten, tanpa password — password itu secret, diaktifkan operator lewat `ALTER ROLE awcms_app LOGIN PASSWORD '<secret>'`), bukan superuser, bukan BYPASSRLS, bukan pemilik tabel, hanya DML.
  - Default GUC fail-closed `app.current_tenant_id = '00000000-0000-0000-0000-000000000000'`: query yang menyentuh tabel RLS di luar `withTenant()` mendapat **nol baris**, bukan error `unrecognized configuration parameter` dan bukan data tenant lain.
  - `GRANT` minimal + `ALTER DEFAULT PRIVILEGES` supaya tabel baru tidak perlu boilerplate GRANT.

  **Aksi operator (deployment-affecting):** setelah `bun run db:migrate`, aktifkan LOGIN + password untuk `awcms_app` lalu arahkan `DATABASE_URL` runtime ke role itu, dan jalankan migrasi berikutnya dengan `DATABASE_URL` ditimpa ke connection string owner. Tanpa langkah ini aplikasi tetap jalan seperti sebelumnya (sebagai owner) — tapi tanpa lapisan RLS. Lihat doc 18 §Model role database.

  Sekaligus memperbaiki artefak fiktif yang menegaskan properti keamanan yang tidak dimiliki sistem (Issue #155): `client.ts` merujuk sebuah migration `045_awcms_db_role_separation` yang tidak pernah ada di repo ini, header `sql/014` mengklaim konvensi `FORCE` "sejak migration 002" (tidak benar sampai 017), `reporting/README.md` menyebut header `X-AWCMS-Mini-Tenant-ID` (sebenarnya `X-AWCMS-Tenant-ID`), `_shared/idempotency.ts` menyebut migration 012 (di sini 009), serta doc 13/18 yang mendaftarkan migration fiktif. `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` kini didokumentasikan jujur sebagai seam pool — **bukan** role `awcms_worker`/`awcms_setup` (itu migration 045 di awcms-mini, belum diport); operator yang mengikuti klaim lama akan mendapat `permission denied` di setiap job.

- 988aaae: Add the domain-event-runtime module: a transactional, versioned domain-event
  outbox and dispatcher ported from awcms-mini. Provider-neutral, generic,
  multi-consumer infrastructure — one published event fans out to many
  registered consumers with explicit per-aggregate/order-key ordering,
  exponential backoff, dead-letter handling, and operator-safe replay.

  - New migration `009_awcms_domain_event_runtime_schema.sql`: adds
    `awcms_domain_events` (append-only outbox), `awcms_domain_event_deliveries`
    (per-(event, consumer) retry/DLQ state), `awcms_domain_event_consumer_effects`
    (generic per-consumer idempotency marker),
    `awcms_domain_event_consumer_state` (pause/resume),
    `awcms_domain_event_replays` (append-only replay audit trail), and
    `awcms_domain_event_activity_daily` (reference read-model rollup). Also
    introduces the generic `awcms_idempotency_keys` store (first high-risk
    mutation to need `Idempotency-Key`). All tenant-scoped tables have RLS
    tenant-isolation policies with FORCE.
  - New REST endpoints under `/api/v1/domain-events` (events, deliveries,
    consumers, plus reason-required audited replay/pause/resume), all guarded
    by default-deny ABAC; replay is `Idempotency-Key`-guarded.
  - New AsyncAPI channel `awcms.domain-event-runtime.sample.recorded` with
    publish/subscribe operations.
  - New worker job `bun run domain-events:dispatch` (built on the shared job
    runner), safe in offline/LAN deployments.
  - Ships one self-contained reference event type and two representative
    consumers (a cross-module audit projector and a self-contained read-model
    activity-rollup projection). Registered in `src/modules/index.ts`.

- 66ee934: Add the email module: a reusable, provider-neutral transactional email
  service ported from awcms-mini (epic #492). Generic infrastructure —
  analogous to `sync_storage`'s object-storage port — for password reset,
  system announcements, and workflow notifications; Mailketing is one adapter,
  not a domain-specific feature.

  - New migration `014_awcms_email_schema.sql`: adds `awcms_email_templates`
    (per-locale `jsonb` bodies, soft-delete/restore), `awcms_email_messages`
    (outbox delivery queue, one row per recipient), `awcms_email_delivery_attempts`,
    and `awcms_email_suppression_list`. All tenant-scoped tables have RLS
    tenant-isolation policies with FORCE and FK indexes. Seeds the
    `email.{template,message,suppression,notification,announcement}.*` ABAC
    permissions.
  - New `EmailProvider` port with a real Mailketing adapter and a safe `log`
    adapter, resolved at one edge; provider calls happen strictly outside any
    DB transaction (ADR-0006), via an outbox + claim/send/finalize dispatcher
    (`bun run email:dispatch`) with retry/backoff, circuit breaker, and
    dispatch-time suppression re-check.
  - New REST endpoints under `/api/v1/email`: template CRUD + restore + preview
    (`/templates`), bulk announcement/notification enqueue + dry-run preview
    (`/announcements`, two-tier ABAC, `Idempotency-Key`-guarded), delivery-queue
    diagnostics + cancel (`/messages`), and suppression-list CRUD
    (`/suppressions`). All guarded by default-deny ABAC and audited.
  - Template management with per-category variable allowlists (fail-closed),
    i18n locale variants, and XSS-safe rendering (allowlist filtering +
    HTML-escaping).
  - New AsyncAPI channels `awcms.email.message.{queued,sent,failed,suppressed,cancelled}`
    (contract-only; the structured logger is the producer).
  - New worker jobs `bun run email:dispatch`, `bun run email:provider:health`,
    and `bun run email:templates:seed-defaults`. Registered in
    `src/modules/index.ts`.

  The password-reset flow, the `reporting` email-health endpoint, and the
  `security:readiness` provider-config gate from awcms-mini are intentionally
  out of scope for this port (their host modules/scripts do not exist in this
  repo yet).

- 87b0e38: Enforce two tenant-isolation controls that were declared but never actually
  applied. Both are ports of code already proven in awcms-mini.

  **Disabling a module now blocks its endpoints.** `authorizeInTransaction` did
  not check tenant module status, so `POST /api/v1/tenant/modules/{key}/disable`
  was cosmetic: the navigation hid the module and the audit event was recorded,
  but any actor still holding the module's permissions could call its API
  directly and keep working. `resolveModuleEnabled` is now checked before
  permissions are even looked up, so a disabled module is refused with
  `403 MODULE_DISABLED` regardless of what the actor was granted, and the denial
  is recorded to the decision log as `matchedPolicy: "module_disabled"`. This
  covers all 70 guarded endpoints at once. `module_management` is `isCore` and
  cannot be disabled, so a tenant can never lock itself out of re-enabling.

  **New migration `017_awcms_enforce_rls_force.sql`** adds `FORCE ROW LEVEL
SECURITY` to the 23 tenant-scoped tables that only `ENABLE`d it (migrations
  002-008, 010-012), including `awcms_identities`, `awcms_sessions`,
  `awcms_access_assignments` and `awcms_profiles`. PostgreSQL bypasses RLS for a
  table's owner unless `FORCE`, and the app connects as the migration owner via
  `DATABASE_URL` — so those tenant-isolation policies were never evaluated, and
  isolation rested entirely on application-level `WHERE tenant_id` clauses with
  RLS as a non-functioning backstop. Every one of the 23 tables already had
  `tenant_id` and a policy, so this only starts enforcing what was declared; all
  access paths already go through `withTenant()`.

  This closes the table-owner bypass only. A SUPERUSER/BYPASSRLS connection still
  bypasses RLS regardless of `FORCE`; closing that needs the least-privilege
  `awcms_app` role, which is deployment-affecting and tracked separately.

- d58cd7b: feat(foundation): family compatibility manifest + CI conformance gate against the AWCMS-Mini standard (Issue #183)

  Adds `awcms-family-compatibility.yaml` (machine-readable, versioned, schema-validated) declaring AWCMS's conformance to the AWCMS-Mini family standard: family/module/capability/API/tenant-context/audit/idempotency/migration contract versions, validated stack versions (Bun/Astro/@astrojs/node/TypeScript/PostgreSQL), and an explicit intentional-divergence allow-list (reason/owner/reviewDate/ADR). New `bun run family:conformance:check` gate (wired into `bun run check` + ci.yml, parity-tested) cross-references every declared version against the real source and fails on drift or an unreviewed/unbacked divergence, emitting a secret-free pass/fail evidence report. Semantic, mutation-provable contract tests pin the reusable controls (tenant-context fail-closed under FORCE RLS, response envelope, redaction, idempotency, migration immutability/checksum, module composition) so any weakening of default-deny/RLS/redaction/audit/idempotency turns conformance RED. No migration (tooling/docs only); ADR-0032; `docs/awcms/family-compatibility.md`.

- 13813bb: Audit trail dan pengerasan jalur login (Issue #145, #147).

  **Audit (#145)** — `POST /api/v1/auth/login` sebelumnya tidak menulis satu baris audit pun, sukses maupun gagal, padahal infra `recordAuditEvent` sudah dipakai 20+ endpoint lain dan `awcms_abac_decision_logs` tidak menutupi login (guard tak pernah jalan di jalur pre-auth). Post-incident, `awcms_audit_events` kosong dan `awcms_sessions` tidak menyimpan IP/UA — lebih buruk, reset `failed_login_count = 0` saat login sukses menghapus jejak brute-force yang mendahuluinya. Login kini menulis `login_succeeded`/`login_failed`, plus recorder out-of-band untuk kasus transaksi rollback (baris audit di dalamnya ikut hilang).

  Atribut audit dibatasi ke `method`/`reason`/`ipHash`/`userAgent` lewat `src/lib/security/client-fingerprint.ts` (port dari awcms-mini): `ipHash` adalah HMAC-SHA256 ber-key — stabil untuk mengelompokkan percobaan per sumber, tapi tidak reversible (sha256 tanpa key atas ruang IPv4 2^32 habis dibrute dalam hitungan detik). IP mentah tidak bisa dipersist (`redactSensitiveAttributes` menjadikannya `[REDACTED]`), dan `loginIdentifier` sengaja tidak diaudit: umumnya email/PII, dan menyimpan string dari penyerang pada percobaan gagal justru menciptakan kebocoran enumerasi.

  **Pengerasan (#147)** — empat lubang yang diwarisi dari awcms-mini:

  1. **Oracle timing** — identifier tak dikenal melewati argon2id (~0 ms) sementara yang dikenal membayar m=64MB (~75 ms), sehingga penyerang bisa memetakan akun mana yang eksis tanpa pernah menyentuh `failed_login_count` (lockout tak pernah menyala). Kini identifier tak dikenal tetap diverifikasi melawan dummy argon2id hash konstan.
  2. **Oracle pesan** — `locked` menjawab `"Account is temporarily locked."`, yang hanya mungkin muncul bila identifier eksis. Kini identik dengan `invalid_credentials`. `tenant_inactive` tetap dibedakan (tenant disebut caller di header; tidak membocorkan identity).
  3. **`X-Forwarded-For` dipercaya tanpa syarat** sebagai kunci rate limit. Pada topologi terekspos-langsung yang justru didokumentasikan repo ini, header itu dikendalikan penyerang: kirim nilai acak per request → bucket baru tiap kali → limit 20/60 detik tak pernah menyala. Kini hanya dipercaya bila `TRUSTED_PROXY_ENABLED=true` (default `false`).
  4. **Ambang env NaN mematikan kontrol secara diam-diam** — `Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? 5)` dengan nilai `5x` menghasilkan `NaN`, `failedLoginCount >= NaN` selalu `false`, lockout mati total tanpa peringatan. Helper `parsePositiveIntEnv` kini menolak non-finite/non-integer/`<= 0`, jatuh ke default, dan menulis `log("warning", ...)`.

  **Env baru (opsional, keduanya aman secara default):** `TRUSTED_PROXY_ENABLED` (default `false`) dan `AUTH_IP_HASH_SECRET` (meng-key HMAC `ipHash`; bila kosong/placeholder dipakai kunci acak per proses — tetap non-reversible, tapi `ipHash` tidak sebanding lintas restart/instance, dan satu warning ditulis).

  **Wajib saat upgrade:** deployment produksi harus menyetel `TRUSTED_PROXY_ENABLED`
  secara eksplisit — `bun scripts/validate-env.ts` kini menolak produksi yang
  membiarkannya kosong. Tidak ada default yang aman untuk dua topologi sekaligus:
  pada profil production repo ini (nginx TLS-termination) `false` membuat setiap
  request terlihat berasal dari IP nginx, sehingga bucket rate limit login runtuh
  jadi satu per tenant dan 20 login gagal per menit cukup untuk mengunci seluruh
  pengguna tenant tersebut; sebaliknya `true` pada app yang terekspos langsung
  membuat rate limit bisa dilucuti dengan merotasi header `X-Forwarded-For`.

- c9cef95: MFA TOTP, recovery codes, and step-up authentication (Issue #184, epic #177).
  Ported and adapted from awcms-mini. Adds encrypted-at-rest TOTP factors
  (AES-256-GCM, `AUTH_MFA_SECRET_ENCRYPTION_KEY`, no default key), single-use
  hashed recovery codes shown once, and a two-step login challenge with no
  account-enumeration oracle (the challenge branch is reached only after a valid
  password). Replay is prevented by a strictly-monotonic `last_used_step` advanced
  with a concurrency-safe compare-and-swap; recovery codes are consumed with the
  same CAS.

  Tenant enforcement policy (`optional` / `required_for_privileged` /
  `required_for_all`) is genuinely enforced at login: a valid-password identity
  that a policy requires MFA for but has no factor is issued an enrollment-scoped
  grant (never a full session) that authorizes only the enroll endpoints, then
  completes to an `aal2` session on enrollment — fail-closed but self-recoverable
  (no admin lockout).

  New: session assurance levels (`aal1`/`aal2`) on `awcms_sessions`, a
  server-controlled step-up gate (`requireStepUp`, `AUTH_MFA_STEPUP_TTL_SEC`) now
  wired to every high-risk MFA action (self-service disable, recovery-code
  regenerate, admin reset, and policy change); session rotation on an aal1→aal2
  rise (anti-fixation); a per-factor cumulative failed-verify lockout
  (`AUTH_MFA_MAX_VERIFY_ATTEMPTS`/`AUTH_MFA_LOCKOUT_MINUTES`) independent of source
  IP and challenge rotation; and an admin reset workflow gated on
  `identity_access.mfa_admin.reset` with a mandatory reason, `critical` audit, and
  no self-reset.

  New endpoints under `/api/v1/auth/mfa/*` (status, enroll start/verify, TOTP
  verify — public login-challenge completion, disable, recovery-codes regenerate,
  step-up, admin reset, policy get/set). Migration `sql/024` adds four
  tenant-scoped RLS-FORCE tables (factors, recovery codes, challenges, tenant
  policy) plus session-assurance columns and seeds the MFA admin permissions;
  recovery-code uniqueness is scoped per tenant. `config:validate` and
  `security:readiness` now require a valid 32-byte encryption key when
  `AUTH_MFA_ENABLED=true`. Existing login hardening is preserved unchanged.
  OIDC/SSO (#185) and Turnstile (#186) are intentionally out of scope.

- 9af1789: Modular OpenAPI contract per module + deterministic bundler and API docs
  (Issue #182, epic #177, ADR-0026).

  The monolithic `openapi/awcms-public-api.openapi.yaml` is split into source
  fragments — a root fragment (`openapi/awcms-public-api.src.yaml`: info/servers/
  tags/security + shared securitySchemes/parameters/responses + the `ApiError`/
  `ApiMeta` shared schemas) and one `openapi/modules/<module>.openapi.yaml` per
  base module (plus a `foundation` fragment for `/api/v1/health` and
  `/api/v1/database/pool`). Each module points at its fragment via
  `ModuleDescriptor.api.openApiPath`. The published bundle
  `openapi/awcms-public-api.openapi.yaml` is now GENERATED by `bun run openapi:bundle`
  (deterministic/idempotent — sorted keys, no timestamps) and stays
  CONTRACT-EQUIVALENT to the pre-migration monolith; no URL, security, request/
  response, or schema changed. The only documented, additive difference is the
  now-declared `Domain Event Runtime` tag (previously used by
  `/api/v1/domain-events/*` operations but never declared).

  New scripts wired into `bun run check` and CI: `openapi:bundle`,
  `api:docs:generate`/`api:docs:check` (generates the readable
  `docs/awcms/api-reference.md` from the bundle + AsyncAPI, with a read-only
  freshness gate), and an extended `api:spec:check` that now also enforces bundle
  freshness (committed bundle == freshly generated from fragments), the standard
  `ApiError` error envelope on every 4xx/5xx response, and that every
  `ALLOWED_PUBLIC_OPERATIONS` entry is actually used — on top of the existing
  route↔contract parity, unique `operationId`, explicit security, and
  path-parameter checks. A derived application can contribute its own module
  fragment through the `buildBundledDocument({ extraFragmentFiles })` composition
  seam (#178) without editing any base fragment; a fragment redefining a base
  path/operation/schema is rejected with `BundleConflictError`.

  No runtime behavior, database schema, or public endpoint changed; the API
  contract version (`info.version`, ADR-0008) is unchanged.

- fb602fb: Add the module-management module: a database-backed, tenant-aware module
  registry ported from awcms-mini. Provides descriptor sync into the DB
  registry, per-tenant module enable/disable with dependency validation,
  non-secret module settings (secret-shaped key/value rejection), read-only
  permission sync/status, an admin navigation registry, a documentation-only
  job/command registry, and passive/explicit module health-readiness signals.

  - New migration `008_awcms_module_management_schema.sql`: extends
    `awcms_modules` and adds `awcms_tenant_modules`, `awcms_module_dependencies`,
    `awcms_module_settings`, `awcms_module_navigation`, `awcms_module_jobs`, and
    `awcms_module_health_checks`, plus the `module_management` permission catalog.
    Tenant-scoped tables have RLS tenant-isolation policies.
  - New REST endpoints under `/api/v1/modules`, `/api/v1/tenant/modules`, and
    `/api/v1/access/modules`, all guarded by default-deny ABAC and audited.
  - Extends `_shared/redaction.ts` with `findSensitiveKeys` and
    `findSecretShapedValues` for module settings validation.

- b11cfca: Add tenant-aware OIDC/SSO with account linking fail-closed and break-glass (Issue #185, epic #177) — ported from awcms-mini (#590/#591) and hardened. Generic, provider-agnostic OIDC (Google/Entra/Keycloak) that mints an awcms opaque session, never uses the ID token as the app session, and keeps authorization on RBAC/ABAC/RLS. ADR-0028, doc `docs/awcms/oidc-sso.md`, migrations `sql/025` + `sql/026`.

  - **Schema (`sql/025`, `sql/026`)** — four tenant-scoped RLS `FORCE` tables: `awcms_auth_providers` (provider config; client secret AES-256-GCM ciphertext OR env-var reference, never plaintext), `awcms_tenant_auth_policies` (password/SSO/JIT/break-glass, one row per tenant), `awcms_external_identities` (linking keyed `(tenant_id, provider_id, issuer, subject)` — immutable `sub`, never email; tenant-bound composite FK), `awcms_oidc_auth_requests` (ephemeral: `state_hash` bearer, `nonce` + PKCE `code_verifier` plaintext single-use, validated `redirect_after`). Permission seed for `sso_providers.{read,create,update,delete}` and `sso_policy.{read,update}`.
  - **SSRF guard (`lib/auth/ssrf-guard.ts`, new)** — the issue's top risk: all discovery/JWKS/token fetches are HTTPS-only, block private/loopback/link-local/ULA/CGNAT/metadata IPv4+IPv6 (including IPv4-mapped/NAT64), validate every resolved DNS address before connecting, follow redirects manually with per-hop re-validation, and enforce a bounded timeout + response-size cap. A reviewed loopback escape hatch (`AUTH_SSO_ALLOW_INSECURE_HOSTS`) exists only for a local fake IdP in tests and is rejected in production. This reverses mini's deliberate no-IP-block decision.
  - **Auth Code + PKCE + state + nonce** — `code_verifier` server-side single-use, `code_challenge` S256; `state` hashed, single-use (`FOR UPDATE` + CAS), tenant-bound; strict redirect-URI matching; sanitized same-origin post-login redirect (no open redirect).
  - **ID-token validation fail-closed** (`domain/oidc-policy.ts` + `lib/auth/jwt-verify.ts`) — algorithm allow-list `{RS256, ES256}` matched to key type (rejects `none` and alg-confusion), WebCrypto-native signature (no `jose` dependency added — Bun-only), issuer + audience + `azp` + expiry + `iat` + nonce.
  - **JWKS/discovery cache** — bounded TTL + negative-TTL + circuit breaker keyed `${tenantId}:${providerKey}`, all OUTSIDE any DB transaction.
  - **Account linking explicit + step-up** — `POST /api/v1/auth/sso/{providerKey}/link` and `/unlink` require a valid session AND `requireStepUp` (#184); identity is taken server-side from the stepped-up session. Never auto-links by email. Auto-link and JIT provisioning are default OFF; JIT provisions at minimum privilege (no roles).
  - **Break-glass** — `saveTenantAuthPolicy` refuses `sso_required=true` / `password_login_enabled=false` without a currently-eligible break-glass owner (`409 BREAK_GLASS_REQUIRED`); login-time `isPasswordLoginDisabledForIdentity` (gated by `isSsoEnabled`, run before the MFA branch) blocks non-break-glass password login; a provider outage never locks break-glass out (separate path).
  - **Routes** — public `GET /sso/{providerKey}/start` + `/callback` (added to the reviewed `ALLOWED_PUBLIC_OPERATIONS`), authenticated `/link` + `/unlink`, admin `GET/POST /auth/sso-providers`, `GET/PATCH/DELETE /auth/sso-providers/{id}`, `GET/PATCH /auth/sso-policy` — all guarded, audited (high severity), client secret never returned.
  - **Config/readiness** — new `AUTH_SSO_*` env vars; `config:validate` requires a 32-byte key when SSO is enabled and forbids the insecure-host escape hatch in production; `security:readiness` adds `checkSsoCredentialEncryptionKeyConfigured` (critical).
  - **Tests** — unit (JWT RS256/ES256 + alg-confusion/`none`, state/nonce/PKCE/redirect allow-list, claim mapping, SSRF IP ranges + oversized/redirect/timeout) and DB integration against a fake in-process OIDC provider (config → link → login → session; cross-tenant state substitution denied; account-link collision; JWKS rotation/cache; SSRF private/metadata issuer refused; break-glass save + IdP-outage; RLS FORCE cross-tenant under the non-superuser `awcms_app` role). Mutation-proven (dropping the issuer check turns a test RED). All test secrets/keys are generated at runtime.

- 15a3721: feat(redis): add optional Bun-native Redis readiness foundation (#197)

  Adds an opt-in, fail-open Redis capability for scalable AWCMS-derived applications without changing PostgreSQL as the authoritative transactional store. The additive foundation includes typed configuration, tenant-aware key namespacing, JSON cache-aside helpers with mandatory TTL, a credential-safe Redis health CLI, unit tests without a live Redis dependency, a hardened standalone Compose deployment, and operational/security guidance for LAN and Coolify deployments.

  Redis remains disabled by default. No session, audit, workflow, durable outbox, authorization boundary, or authoritative ERP/domain state is migrated to Redis, and no third-party runtime dependency is added.

- f69ad2c: Add the reporting module: management reporting views plus a module-contributed
  read-model projection mechanism, ported from awcms-mini.

  - Five generic live read-aggregation views under `/api/v1/reports/*` (tenant
    activity, access/audit summary, sync health, module usage, email queue
    health), each gated by `reporting.dashboard.read`. The access/audit view
    counts this repo's real cross-module audit trail (`awcms_audit_events`)
    rather than the mini base's `profile_audit_logs` proxy.
  - A module-contributed read-model projection extension: modules declare
    `reportingProjections` descriptors in their own `module.ts`, and reporting's
    engine maintains them via incremental cursor-table scans or a registered
    `domain_event_runtime` consumer, with idempotent crash-safe rebuild,
    live-computed freshness/staleness signals, on-demand source reconciliation,
    and scheduled CSV/JSON exports (manifest/checksum/expiry, secure
    tenant-scoped checksum-verified download). Three projections are registered
    (access-audit summary, module-activity summary, and an event-driven
    event-activity demonstration).
  - New migration `015_awcms_reporting_projections_schema.sql`: seven
    tenant-scoped tables (projection state/cursors/metrics, rebuild runs,
    reconciliation runs, scheduled exports, export runs), all with FORCE row
    level security tenant-isolation policies, indexed foreign keys, a partial
    unique index guaranteeing at most one running rebuild per (tenant,
    projection), `timestamptz`, and `bigint` counters. Migration
    `016_awcms_reporting_permissions.sql` seeds the `reporting.dashboard.read`,
    `reporting.projections.{read,rebuild,analyze}`, and
    `reporting.exports.{read,configure,export}` permissions.
  - New REST endpoints under `/api/v1/reports/projections` and
    `/api/v1/reports/exports` (list/detail/rebuild/cancel/reconcile, scheduled
    export create/disable/trigger, run history/download). Every mutation is
    ABAC-guarded, and rebuild/cancel/create/disable/trigger require an
    `Idempotency-Key` and write an audit event.
  - New scheduled worker scripts `reporting:projections:refresh` and
    `reporting:exports:dispatch` (pure PostgreSQL / local filesystem, safe in
    offline/LAN deployments) plus the pure-code
    `reporting:projections:registry:check` gate.
  - The `_shared/module-contract` gains the optional `reportingProjections`
    field and the `ProjectionDescriptor` type family (contract version bumped to
    `1.1.0`), the domain-event-runtime consumer registry gains the reporting
    event-activity projector consumer (the one deliberate
    `domain_event_runtime -> reporting` edge), and the identity-access
    `AccessAction` union gains `rebuild`/`analyze`/`export`.

- 9db1da6: Add `bun run security:readiness` — a go-live gate that catches inert RLS and
  RLS-bypassing DB roles (Issue #142), ported from awcms-mini and adapted to
  this base.

  Nothing in this repo detected RLS regressions. Migrations 002-008 and 010-012
  shipped 23 tenant-scoped tables with `ENABLE ROW LEVEL SECURITY` but no
  `FORCE`, which PostgreSQL ignores for the table owner — the role this app
  connects as. The isolation policies were never evaluated, and every check
  stayed green for the entire time (found by manual audit, fixed by `sql/017`).

  `scripts/security-readiness.ts` runs 13 named checks, each backed by a real
  signal (a DB query, a grep over tracked files, or a call into a real domain
  function — none hardcoded to pass). Any `critical` failure exits non-zero and
  blocks go-live; `warning`/`info` findings print without blocking. The two the
  issue exists for:

  - **RLS enabled AND forced on tenant-scoped tables** (critical) — requires
    `relforcerowsecurity`, not just `relrowsecurity`. Every `awcms_%` table not
    in a documented, per-table-justified RLS-free allowlist must have both, so a
    future migration reintroducing the bug fails without anyone remembering to
    register anything.
  - **App DB connection role does not bypass RLS** (critical) — `FORCE` still
    does nothing against `rolsuper`/`rolbypassrls`, so the app's own connection
    role is inspected.

  Also: no hardcoded secret, `.env` not tracked, argon2id hashing, login
  lockout, ABAC default-deny, audit table reachable, env config valid, sync HMAC
  secret rotated, login rate limiting, and security response headers. Items that
  genuinely cannot be automated from this repo (deployment/network/backup
  concerns, per-table grant matrices) are printed as documented out-of-scope
  entries with a reason rather than dropped.

  Not wired into `bun run check`: the DB-backed checks need a migrated database
  and `ci.yml` has no Postgres service. Run it against the target deployment,
  using the app's own `DATABASE_URL` — a privileged/superuser URL makes the
  result meaningless, which the role check reports outright.

- dd86ab6: Add segregation-of-duties (SoD) conflict detection and enforcement for ERP (Issue #181, epic #177 Wave 2 authorization), ported from awcms-mini (#746) on top of the #180 business-scope hierarchy.

  - **Contract:** additive `SoDRuleDescriptor` family + `ModuleDescriptor.sodRules` (`MODULE_CONTRACT_VERSION` 1.2.0 → 1.3.0). The base ships NO domain SoD rules; a derived application contributes them through the composition seam (the in-repo fixture carries ≥5 illustrative examples).
  - **Registry gate:** `bun run identity-access:sod-registry:check` validates the composed registry (owner match, unique ruleKey, ≥2 keys, valid enums, exception-policy consistency), wired into `bun run check` and CI — SoD registry drift makes CI red.
  - **Domain/application:** a pure conflict matcher (`sod-conflict-evaluation.ts`), assignment-time evaluation re-inserted at the #180 seam, action-time fail-closed enforcement wired into `authorizeInTransaction` for high-risk actions (deny-overrides-allow), an append-only decision log, and a scope-bound/time-bound/revocable/audited exception (override) flow that can never be self-approved.
  - **Schema:** `sql/029` (`awcms_sod_conflict_exceptions` + `awcms_sod_conflict_evaluations`, tenant-scoped RLS `ENABLE`+`FORCE`, composite `(tenant_id, …)` FKs) + `sql/030` permission seed. The scheduled expiry job now also expires elapsed approved exceptions.
  - **API:** six new endpoints under `/api/v1/identity/business-scope/` — `GET conflicts`, `GET`/`POST exceptions`, and `POST exceptions/{id}/approve|reject|revoke` (OpenAPI fragment + regenerated bundle/docs).

- 296b7e3: Sync HMAC: versioned signatures + inactive-by-default node registration (security advisory GHSA-c972-3q5p-g3h4, cross-tenant sync forgery).

  - **Signature v2 binds tenant + node.** New `computeSyncSignatureV2` /
    `verifySyncSignatureV2` sign `"v2:<tenantId>:<nodeCode>:<timestamp>:<body>"`,
    so a signature minted for one tenant no longer verifies when
    `X-AWCMS-Tenant-ID` is swapped to another tenant. Nodes send
    `X-AWCMS-Signature-Version: 2`. Timing-safe compare is preserved for both
    versions.
  - **Backward-compatible with an off-switch.** `verifySyncHeaders` verifies v2
    when the version header is `2`; requests without the header fall back to the
    legacy v1 scheme (`"<timestamp>.<body>"`) — which remains **cross-tenant
    forgeable** — only while the new env `SYNC_HMAC_ALLOW_LEGACY` is not `false`
    (default allow). Setting `SYNC_HMAC_ALLOW_LEGACY=false` rejects v1 entirely.
  - **Nodes auto-register `inactive`.** First-contact sync nodes are quarantined
    `inactive` (code-only change, no migration) and require admin approval via
    `PATCH /api/v1/sync/nodes/{id}` before they can push/pull. Nodes already
    `active` are unaffected. This closes the "new node id" path independently of
    the signature.

  Not a complete close on its own: the advisory is fully closed only when
  `SYNC_HMAC_ALLOW_LEGACY=false` **and** every node has migrated to v2. This is a
  cross-repo change — the v2 material is canonical here, but **awcms-mini** and
  the node spec/skill must be updated to emit v2 before legacy is disabled in any
  deployment. v1 is deprecated-transitional. New env var `SYNC_HMAC_ALLOW_LEGACY`
  (default `true`) must be wired into shared env docs/validation.

- cd772a3: Add the sync-storage module: offline-first synchronization ported from
  awcms-mini. HMAC-authenticated node-to-node event exchange (outbox/inbox),
  optimistic-concurrency conflict tracking, and an object sync upload queue with
  an internal dispatcher.

  - New migrations `010_awcms_sync_storage_outbox_inbox_schema.sql`,
    `011_awcms_sync_storage_conflict_schema.sql`, and
    `012_awcms_object_sync_queue_schema.sql`: add `awcms_sync_nodes`,
    `awcms_sync_outbox`, `awcms_sync_inbox`, `awcms_sync_push_batches`
    (idempotency ledger keyed `(tenant_id, node_id, batch_id)`),
    `awcms_sync_aggregate_versions`, `awcms_sync_conflicts` (immutable), and
    `awcms_object_sync_queue`. All tenant-scoped tables have RLS tenant-isolation
    policies, FK-covering indexes, and the performance/listing indexes. Seeds the
    `sync_storage` permissions (node_management, conflict_resolution,
    object_queue).
  - Node-to-node endpoints (`POST /sync/push`, `POST /sync/pull`,
    `GET /sync/status`, `POST /sync/objects`, `GET /sync/objects/status`)
    authenticate via HMAC (`X-AWCMS-Node-ID`/`Timestamp`/`Signature`,
    `HMAC-SHA256("<timestamp>.<body>")`, timing-safe compare, skew-bounded
    anti-replay), gated by `AWCMS_SYNC_ENABLED`, rejecting inactive nodes with 403. Push is idempotent per batch; conflicts are recorded immutably.
  - Admin surfaces (`GET/PATCH /sync/nodes`, `GET /sync/conflicts` +
    `/{id}/resolve`, `GET /sync/object-queue` + `/{id}/retry`) are
    session-authenticated, ABAC-guarded, and audited.
  - Object storage defaults to the local driver (`STORAGE_DRIVER=local`); R2 is
    optional (`R2_ENABLED`). The internal dispatcher `bun run sync:objects:dispatch`
    drains the object queue per tenant with a claim-lease, backoff, circuit
    breaker, and timeout — provider calls happen strictly outside transactions
    (ADR-0006).
  - Adds `readTextBody` to the shared request-body reader (raw-body read for HMAC
    verification) and the `retry` action to the identity-access `AccessAction`
    union (not high-risk).

- 9db1da6: Tenant-scope the office hierarchy FK (GHSA-r7cx-c4jh-cvvw) and fix three
  correctness gaps in the office directory (Issue #149).

  **Cross-tenant hierarchy (security).** `awcms_offices.parent_office_id` was
  declared `REFERENCES awcms_offices (id)` — a FK on the primary key alone, which
  says nothing about tenancy — and `POST /api/v1/offices` passed the caller's
  `parentOfficeId` straight to the INSERT with no lookup. An admin of tenant A
  could therefore name an office id belonging to tenant B and get `200 OK`,
  grafting their tree onto another tenant's. It doubled as an existence oracle:
  a real id from another tenant returned 200 while a random uuid returned an FK
  violation (500), so the field could be used to probe whether any given office
  id existed platform-wide.

  RLS did not cover this and could not: PostgreSQL runs referential integrity
  checks as the referenced table's owner with row-level security bypassed, so the
  FK's parent lookup saw the other tenant's row even from a session pinned to
  tenant A — verified still exploitable after `FORCE ROW LEVEL SECURITY` landed
  in `sql/017`. `sql/020_awcms_offices_tenant_scoped_fk.sql` makes tenancy part
  of the constraint instead: `UNIQUE (tenant_id, id)` gives the FK a target, and
  the FK becomes `(tenant_id, parent_office_id) REFERENCES (tenant_id, id)`, so
  the referenced office must sit in the same tenant as the referencing one — an
  invariant no privilege level can talk its way around. `createOffice` now also
  resolves the parent through `fetchOfficeById(tx, tenantId, ...)` before its
  first write, turning a bad parent into a `400` instead of an FK violation
  (500), and making the unknown / other-tenant / soft-deleted cases fail
  identically so the oracle closes.

  Existing cross-tenant parent links are detached to NULL by the migration
  (making those offices roots) rather than deleted: the office rows are the
  tenant's own legitimate data, only the edge into the other tenant is not.

  **`GET /api/v1/offices` is now keyset-paginated** — previously it returned
  every office of the tenant with no `LIMIT` at all, unbounded for a retail
  tenant with thousands of outlets. It now returns at most 100 per page plus an
  opaque `nextCursor`, via the shared `_shared/keyset-pagination.ts` helper.
  **Breaking read-order change:** results are now newest-first
  (`created_at DESC`) rather than oldest-first, matching the direction the shared
  cursor encodes and every other paginated list in this base. A malformed
  `cursor` is rejected with `400` rather than silently serving page 1.

  `listOffices` compares its keyset on `date_trunc('milliseconds', created_at)`
  rather than bare `created_at`. This is load-bearing, not cosmetic: cursors
  carry a JS `Date` (milliseconds) while `timestamptz` stores microseconds, and
  the driver floors them on the way out — so a bare comparison excludes every row
  sharing the boundary row's millisecond, including rows never shown, which no
  later cursor can reach either. Measured before the guard: 105 offices, page 1
  returned 100, page 2 returned 4 — one office permanently unreachable.

  **Duplicate `officeCode` now returns `409 OFFICE_CODE_ALREADY_EXISTS`** instead
  of 500. The unique index (`awcms_offices_tenant_code_key`) already existed; the
  `23505` is now translated to a `DuplicateOfficeCodeError` and caught inside
  `withTenant`, so it neither surfaces as an unhandled `PostgresError` nor counts
  against the shared database circuit breaker. Reusing the code of a
  soft-deleted office still works — the index is partial.

  **A soft-deleted parent office is now rejected.** No FK can express this (a
  soft-deleted row is still physically present), so it rests on the application
  check; previously `parentOfficeId` could point at a soft-deleted office and
  leave a dangling hierarchy.

  Covered by `tests/office-directory-postgres.test.ts` against real PostgreSQL
  (gated on `DATABASE_URL`), including a test that asserts the constraint
  directly at the database rather than through the application — the FK has to
  hold when no application code runs at all.

- ab24355: Theming module (ADR-0034 Fase 3) — the FIRST website module implemented directly
  in the awcms base, proving ADR-0034's decision that content/website modules may
  now live in `src/modules/` here ("template dipakai-langsung"). Adapted from
  awcms-micro's `theming` (Issue #269 / awcms-micro ADR-0029). Bumps the base
  registry 10 → 11 modules.

  - **Data-only tenant theming, no uploaded code.** A THEME is trusted, reviewed,
    BUILD-TIME source (a `ThemeDescriptor` composed by `theme-registry.ts` from the
    reviewed in-repo base themes — never a database row or an uploaded artifact).
    Only a tenant's DATA configuration of a theme lives in the database
    (`awcms_theming_config_versions` draft + immutable published versions, and
    `awcms_theming_tenant_state` active pointer; sql/033, all three tables
    `ENABLE`+`FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy).
  - **Security spine — reject, never sanitize (`domain/css-value-validation.ts`).**
    Every design-token value is validated by REJECTION against strict, bounded,
    linear (no-ReDoS) grammars (hex/rgb/hsl colors, dimensions with an allowed-unit
    list, bounded numbers, font families from a per-theme allow-list whose emitted
    stack is descriptor-owned). `url(...)`, `expression()`, `@import`, `javascript:`,
    comment breakouts, `;{}<>`, backslash, and unbalanced tokens can never reach the
    emitted CSS. Token values ship as an EXTERNAL same-origin `text/css` stylesheet
    (`/theming/{tenantCode}/tokens.css`), so `style-src 'self'` is never weakened.
  - **Immutable published versions + audited lifecycle.** draft → validate → preview
    → publish → rollback/retire. Published versions are IMMUTABLE (INSERT-only engine
    - a sql/033 `BEFORE UPDATE/DELETE` trigger); rollback/retire move the active
      pointer while history stays intact. `PUT /api/v1/theming/draft`,
      `POST /api/v1/theming/{validate,preview,publish,rollback,retire}` +
      `GET /api/v1/theming` — ABAC-gated (`theming.config.*`/`theming.version.*`/
      `theming.preview.create`, seeded in sql/034), idempotency-keyed on high-risk
      mutations, and audited. Adds the `archive` action to the `AccessAction`
      union/high-risk set.
  - **Non-indexable, hashed, short-lived previews.** `awcms_theming_preview_sessions`
    stores only the SHA-256 hash of the raw preview token; every read filters
    `expires_at >= now()`; the preview surfaces are `X-Robots-Tag: noindex` +
    `private, no-store` on a URL namespace distinct from the public stylesheet.
  - **Port adaptations.** No derived-repo theme seam (the derived-application pathway
    was removed in ADR-0034 Fase 2 — themes live in the base registry). `media_library`
    is dropped (not in this base): asset-URL resolution is a documented no-op and
    assets are omitted from render, degrading safely. The `data_lifecycle` purge
    descriptor is dropped (no purge engine/worker role here); preview retention rides
    the `expires_at` read filter. Public tenant resolution is `tenantCode`-based
    (ADR-0009), not Host-based. Revokes the `no-content-website-modules` divergence
    in `awcms-family-compatibility.yaml`.

- fb1848d: Add deployment-profile-aware Cloudflare Turnstile bot protection (Issue #186,
  epic #177), ported and hardened from awcms-mini. A new full-online deployment
  gate (`AUTH_ONLINE_SECURITY_ENABLED`/`AUTH_ONLINE_SECURITY_PROFILE`) plus
  `TURNSTILE_ENABLED` activate a server-side Turnstile challenge on
  `POST /api/v1/auth/login` and `POST /api/v1/setup/initialize`. The verifier runs
  after request-shape/rate-limit checks and before password verification, outside
  any DB transaction, and validates success, action (per endpoint), hostname, and
  challenge freshness with a timeout, response-size cap, and secret/token
  redaction (the token is never logged or audited). On the full-online profile it
  fails closed with a single generic error (no account-enumeration oracle); rate
  limit and lockout keep working independently.

  Every LAN/offline deployment (the default) is unchanged: no widget, no iframe,
  no CSP origin, and no outbound verification call — `isTurnstileRequired()`
  returns false there, and `TURNSTILE_ENABLED=true` alone (without the full-online
  profile) is still fully off. When enabled, the middleware CSP opens exactly the
  one `challenges.cloudflare.com` origin in `script-src`/`frame-src`, the login
  page renders the widget, and `config:validate` + `security:readiness` +
  production preflight validate the site key, secret key, and expected hostname
  consistently while distinguishing "disabled intentionally" from "misconfigured".
  The login/setup request contract gains an optional `turnstileToken` field.

  No database migration is added — Turnstile is configuration/env only; the secret
  key lives in the environment and never touches the database, logs, audit,
  responses, or health output. MFA (#184) and OIDC break-glass (#185) login
  branches are preserved intact.

- e92c579: Add the workflow-approval module: a managed, versioned, graph-based approval
  engine ported from awcms-mini's proven `workflow-approval` module. Draft/
  publish/retire definition lifecycle with immutable published/retired versions
  and per-instance version pinning; generic nodes/transitions (sequential
  approval, bounded conditional routing, parallel/join fan-out/fan-in, notify);
  quorum/any/all approval rules; effective-dated delegation/substitution;
  escalation/timeout policies processed by a scheduled worker job; and
  administrative recovery (reassign/cancel/force-decision).

  - New migration `013_awcms_workflow_approval_schema.sql`: adds
    `awcms_workflow_definitions`, `awcms_workflow_instances`,
    `awcms_workflow_tasks`, `awcms_workflow_task_assignments`,
    `awcms_workflow_join_arrivals`, `awcms_workflow_decisions` (append-only),
    and `awcms_workflow_delegations`. All tenant-scoped tables have RLS
    tenant-isolation policies with FORCE, FK indexes, `timestamptz`, and the 14
    workflow permission rows. The upstream `GRANT ... TO <worker-role>`
    least-privilege blocks are intentionally omitted (this base has no separate
    worker/app database roles).
  - Registers 8 domain event types (`awcms.workflow.instance.*`,
    `awcms.workflow.task.escalated`, `awcms.workflow.delegation.*`) in the
    domain-event-runtime registry, with matching AsyncAPI channels/operations,
    published via `appendDomainEvent` inside the same transaction as each state
    change.
  - Public REST surface under `/api/v1/workflows/**` (definitions CRUD +
    lifecycle, approval inbox + decisions, delegations, instance history +
    cancel, administrative recovery) with default-deny ABAC, tenant/RLS,
    `Idempotency-Key` + audit on every high-risk mutation, and OpenAPI paths.
  - New scheduled worker `bun run workflow:escalations:dispatch` (registered in
    the module job registry).
  - Extends `identity_access`'s ABAC evaluator with the self-approval /
    self-administered-force-decision denial the workflow decision endpoints rely
    on (inert for every endpoint that does not supply
    `requestedByTenantUserId`).

  The `notify` graph node's concrete notification adapter (owned by the `email`
  module in awcms-mini) is not wired yet — `notify` nodes silently no-op and
  advance until the `email` module is ported.

- 13813bb: Workflow approval: close concurrency and quorum-bypass holes

  - **Issue #140 — concurrent approvals no longer corrupt a task.**
    `fetchTaskWithInstanceForDecision` now takes `SELECT ... FOR UPDATE OF t` on
    the task row, serialising quorum evaluation per task. Previously two
    approvers deciding at the same instant each evaluated quorum against a READ
    COMMITTED snapshot blind to the other's uncommitted decision:
    `quorumRule: "all"` stranded the task `pending` forever with every assignment
    `decided` (everyone then got a 403 and the escalation worker re-escalated
    indefinitely), while `quorumRule: "any"` advanced the graph twice, producing
    duplicate downstream tasks and doubled `workflow.instance.advanced` events.

  - **Issue #152 — a cancelled instance can no longer be resurrected.** The
    `end`-node status UPDATE in `workflow-graph-engine.ts` now carries
    `AND status = 'pending'` (matching `cancelWorkflowInstance`) and rolls the
    transaction back if it matches nothing, instead of silently overwriting a
    cancellation with `approved`/`rejected`.

  - **GHSA-9qwq-cmr5-6wfc — one person can no longer satisfy a multi-person
    quorum alone.** A user who was both an original assignee and a node's
    escalation target used to accumulate two live assignment rows on one task and
    could vote twice. Migration `018` adds a partial unique index over
    `(workflow_task_id, tenant_user_id) WHERE status IN ('pending','decided')`
    (de-duplicating any existing rows first), both assignment INSERT paths became
    `ON CONFLICT DO NOTHING`, and quorum now counts
    `COUNT(DISTINCT tenant_user_id)` — people — rather than `COUNT(*)` rows.

  Behaviour change: reassigning a task to someone who has already decided it now
  fails with a `WorkflowRecoveryError` instead of granting them a second vote.

### Patch Changes

- 9da3a8c: Admin UI: author and manage ABAC policies (Issue #171). Adds
  `POST /api/v1/abac/policies` (create) and `PATCH /api/v1/abac/policies/{id}`
  (update effect/description and enable/disable toggle), both gated default-deny on
  `identity_access.access_control.configure` (the access-control administration
  permission — that activity seeds only `read`/`assign`/`configure`, and the owner
  holds only seeded permissions) and audit-logged as high-risk access-control
  changes. A duplicate `policyCode` returns 409. The
  `/admin/abac-policies` screen gains a create-policy form plus per-row Edit and
  Enable/Disable controls (UX-only gating; the endpoint ABAC guard is the
  authority).
- 7f54e83: Add admin management screens for profiles, modules, and email templates (Issue #166) — extending the admin UI to more of the requested management surface, each following the offices screen's SSR-read-then-render pattern backed by an existing awcms API.

  - **`admin/profiles.astro`** — the tenant's central profiles/parties via `listParties` (gated `profile_identity.profile_management.read`). Identifiers (masked PII) are deliberately not bulk-listed.
  - **`admin/modules.astro`** — the module catalog via `fetchModuleCatalog` (gated `module_management.modules.read`).
  - **`admin/email-templates.astro`** — tenant email templates via `listEmailTemplates` (gated `email.template.read`), including inactive.

  All three are permission-gated (clean "no access" notice otherwise), degrade to an error notice on a DB circuit-breaker `Response`, and are linked from the `AdminLayout` sidebar. The authenticated E2E (`admin-offices.e2e.ts`) now also navigates through them and asserts their tables render for the seeded owner (the module catalog assertion is data-seed-free — it lists the code-registered core modules).

  Read-only for this slice. NOTE: the other requested domains — user management, RBAC (roles/assignments), and ABAC (policies) — have no read API in awcms yet (the tables exist but no `listTenantUsers`/`listRoles`/`listAbacPolicies` application function or route is ported), so their admin screens depend on porting those backend reads from awcms-mini first, per the mini-first flow.

- 04c331f: Add module enable/disable toggle and email-template create form to the admin UI (Issue #171) — the next slice of admin write actions, each riding an EXISTING awcms endpoint (no new backend), following the create-office form's permission-gated + CSP-safe pattern.

  - **`admin/modules.astro`** — now reads the tenant's per-module ENABLEMENT state (`fetchTenantModuleEntries`, gated `module_management.tenant_modules.read`) instead of the global module catalog, so the rendered enabled/disabled column is exactly the `awcms_tenant_modules.enabled` state the toggle mutates. A per-row enable/disable toggle, shown to users holding the matching `module_management.tenant_modules.{enable,disable}` permission, posts to the existing `POST /api/v1/tenant/modules/{key}/{enable,disable}` (cookie auth). Core modules get no disable button (the endpoint 409s that); a non-core module can still fail to disable if another ENABLED module depends on it — the endpoint enforces that (409) and the UI shows a generic error. The disable endpoint requires a non-empty `reason` (recorded in the audit event), so the toggle prompts for one. The endpoints' ABAC guard + dependency/core validation remain the real authority — the button gate is UX-only.
  - **`admin/email-templates.astro`** — a create form shown to users holding `email.template.create`, posting to the existing `POST /api/v1/email/templates` (cookie auth). `templateKey` is a fixed select of the base categories (`BASE_EMAIL_TEMPLATE_CATEGORIES`); subject/body are captured for the `en` locale and sent as the `{ locale: text }` map the endpoint expects. `validateCreateEmailTemplateInput` (restricted category, localized-text shape, unsafe-HTML rejection) stays the authority.

  Both scripts are bundled EXTERNAL (they import from `admin-form-client`) so the `default-src 'self'` CSP allows them; both surface only a single generic error on failure (never internal detail, Issue #540) and guard double-submit via `lockElement`. Authed E2E added for each (`admin-modules-toggle.e2e.ts` toggles then reverts — self-reversing and retry-safe; `admin-email-templates-create.e2e.ts` is idempotent on the fixed `templateKey`). Both run in the CI `e2e-smoke` job.

  Remaining #171 scope (RBAC assign/unassign + role-permission mutation, ABAC policy authoring, edit/soft-delete/restore) needs newly-ported backend endpoints and is left to a focused follow-up cycle.

- 511fd0e: Add a create-office form to the admin offices screen (Issue #166), permission-gated on `tenant_admin.office_management.create`, posting to the existing `POST /api/v1/offices` via cookie auth; CSP-safe (external bundled script). Authed E2E covers create → row appears.

  - **`admin/offices.astro`** — renders `#office-create-form` above the existing table only when the SSR context holds `tenant_admin.office_management.create`. On submit the bundled `<script>` (imports `lockElement`/`postJson` from `admin-form-client`, forcing Astro to emit it external per the `default-src 'self'` CSP) reads `officeCode`/`officeName`/`officeType`, `POST`s to `/api/v1/offices` (cookie auth — no tenant header), reloads on success, and shows a single generic error otherwise (never internal detail, Issue #540). Double-submit is guarded via `lockElement`.
  - **E2E** — new `tests/e2e/admin-offices-create.e2e.ts`, env-gated like `admin-offices.e2e.ts`: the seeded owner fills the form with a per-run unique code and the new row appears in `#offices-table` after reload.

  The endpoint, validation, ABAC guard, and duplicate/parent handling already existed; this slice is additive UI + coverage.

- 9da3a8c: Admin offices lifecycle: soft-delete + restore (Issue #171). Adds
  `DELETE /api/v1/offices/{id}` (audited soft-delete; optional/bodyless reason)
  and `POST /api/v1/offices/{id}/restore` (audited restore, 409 when a live
  office has retaken the code). The `/admin/offices` screen gains permission-gated
  per-row inline edit (name + status via the existing PATCH), soft-delete, and a
  deleted-offices section with restore controls. Seeds the new
  `tenant_admin.office_management.delete` permission via migration
  `sql/023_awcms_seed_office_management_delete_permission.sql` (so the owner,
  granted only catalogued permissions at bootstrap, can actually delete); restore
  reuses `office_management.update`.
- 511fd0e: Add a create-profile form to the admin profiles screen (Issue #166), permission-gated on profile_identity.profile_management.create, posting to POST /api/v1/profiles via cookie auth; CSP-safe external script. Authed E2E covers create → row appears.
- b3e5145: Add user (tenant-users), RBAC (roles), and ABAC (policies) read APIs + admin management screens (Issue #166, Stage 3b) — porting awcms-mini's access-management reads, adapted to awcms's schema/scope. Completes the requested management surface (auth, user, profile, rbac, abac, module, template) as read-only admin screens.

  - **Read layer** — `src/modules/identity-access/application/access-directory.ts`: `listTenantUsers` (users + assigned role codes, `login_identifier` **masked** via `maskIdentifierValue`), `listRoles` (non-deleted roles + permission count), `listAbacPolicies` (policies; seeded-empty by default — built-in rules apply). All bounded `LIMIT 100`, tenant-filtered, inside `withTenant`.
  - **Endpoints** — `GET /api/v1/users`, `GET /api/v1/roles`, `GET /api/v1/abac/policies`, all gated on the existing `identity_access.access_control.read` permission (no new permission migration needed; mini's `user_management` activity code does not exist in awcms, so `access_control.read` is used as the gate). OpenAPI updated with matching paths + `TenantUserMasked`/`Role`/`AbacPolicy` schemas.
  - **Screens** — `admin/users.astro`, `admin/roles.astro`, `admin/abac-policies.astro`, permission-gated, linked from `AdminLayout`. The authenticated E2E now navigates all three and asserts the users table shows the owner's **masked** login identifier (never the raw address).

  Docs synced: doc 07, `identity-access/README.md`, `ARCHITECTURE.md`. Read-only for this slice; assign/create/edit (RBAC write) is a follow-up.

- 9da3a8c: Admin roles CRUD + role↔permission management (Issue #171). Adds
  `POST /api/v1/roles` (create), `PATCH`/`DELETE /api/v1/roles/{id}` (rename /
  soft-delete), `POST /api/v1/roles/{id}/restore`, and `POST`/`DELETE
/api/v1/roles/{id}/permissions` (grant / revoke), plus write controls on the
  `/admin/roles` screen (create form, per-row rename / soft-delete, restore, and
  a manage-permissions panel). All writes are HIGH-RISK: authorized on the
  existing `identity_access.access_control.configure` permission and audited.
  System roles (e.g. `owner`) cannot be soft-deleted (409). Duplicate role code
  (409) and duplicate permission grant (409) are caught inside the tenant
  transaction.
- 4e2c804: Add awcms's first admin management UI — login + admin shell + offices screen — with full E2E coverage (Issue #166, Stage 2). Ports awcms-mini's admin UI pattern, adapted to awcms's fondasi scope; the auth/session/middleware plumbing (`/admin` guard, `resolveSsrContext`, login/logout endpoints) already existed, so this is additive UI.

  - **Pages**: `login.astro` (posts to `POST /api/v1/auth/login` with `X-AWCMS-Tenant-ID`, redirects to `/admin`), `admin/index.astro` (dashboard rendered purely from `ssrContext`), `admin/offices.astro` (management screen — SSR-reads the tenant's offices via the same `listOffices` the JSON endpoint uses, permission-gated on `tenant_admin.office_management.read`, renders an accessible table + status badges). A stripped `AdminLayout` and the doc-14 design tokens (`src/styles/tokens.css`) + `admin.css` back them.
  - **CSP handled correctly** (Issue #148): the middleware stays the single CSP owner (`default-src 'self'`, covering JSON + HTML + pages). `astro.config.mjs` sets `build.inlineStylesheets: "never"` (external stylesheets) and every page `<script>` imports from `src/lib/ui/admin-form-client.ts` — which forces Astro to bundle it to an external file rather than inline it (an inline script would be CSP-blocked, silently breaking the page). Verified: the login page ships zero inline script/style.
  - **E2E**: `login.e2e.ts` (form render + the CSP "no inline script" property) validated live locally; `admin-offices.e2e.ts` drives the full authenticated loop (login → session → `/admin` → offices table + wrong-password generic-error path). The CI `e2e-smoke` job now provisions `postgres:18.4`, runs `db:migrate`, and seeds a tenant+owner through the real `POST /api/v1/setup/initialize` bootstrap.

  Read-only offices for this first slice; create/edit stays on `POST /api/v1/offices` and lands later.

- 9da3a8c: Add tenant-user activate/deactivate + role assign/unassign to the admin UI (Issue #171) — the next slice of admin write actions, backed by new guarded, audited endpoints in the identity-access module.

  - **`user-admin.ts`** (new application layer) — `setTenantUserStatus` (activate/deactivate; `awcms_tenant_users` has no `deleted_at`, so deactivate = `status='inactive'` / reactivate = `status='active'`), `assignRole` (DB-idempotent via the `(tenant_id, tenant_user_id, role_id)` unique index; a repeat assign raises 23505 → 409), and `unassignRole`. Each writes a high-risk audit event; login identifiers (PII) are never logged — the audit row references the stable `tenant_user_id`.
  - **`PATCH /api/v1/users/{id}`** (new) — set a tenant user's status. Guarded on `identity_access.access_control.configure`.
  - **`POST` / `DELETE /api/v1/access/assignments`** (new) — assign / revoke a role. Guarded on `identity_access.access_control.assign`. 23505 → 409 is caught INSIDE `withTenant`; target-not-found → 404 is raised before any write.
  - **`admin/users.astro`** — now renders per-user activate/deactivate and assign-role (with per-role remove) controls, each UX-gated on the same permission its endpoint enforces (the endpoint guard is the authority). Login identifiers stay masked in the render. The client script is external (CSP-safe) and uses the shared `sendJson` PATCH/DELETE helper.

  GUARD NOTE (no migration): the seed (`sql/005`) provides `identity_access.access_control.{read,assign,configure}` but no `.update`, and the owner role is granted only SEEDED permissions — so guarding on `update` would deny even the owner. Role assignment therefore uses the exactly-named `assign` permission; user activate/deactivate uses `configure` (the broadest identity-access admin permission), since deactivating revokes all of a user's access. A future migration adding a dedicated `access_control.update` (or a `user_management` activity) would let user-status be gated independently of role/permission administration.

- 9da3a8c: Harden the admin access-control write surface against privilege-escalation and
  lockout foot-guns (Issue #171 review follow-up):

  - **System-role permission set is immutable via the API.** `POST`/`DELETE
/api/v1/roles/{id}/permissions` now refuse `is_system` roles (409
    `ROLE_SYSTEM_PROTECTED`) — a delegated `configure` holder can no longer strip
    the seeded `owner` role's grants and lock the tenant out (parity with
    `softDeleteRole`, which already blocked system roles).
  - **System roles cannot be hand-assigned/unassigned.** `POST`/`DELETE
/api/v1/access/assignments` refuse `is_system` roles (409
    `ROLE_SYSTEM_PROTECTED`) — the `assign` permission can no longer be used to
    self-assign `owner` (escalation) or strip it from the sole owner (lockout).
  - **Deactivation lockout guards.** `PATCH /api/v1/users/{id}` refuses to
    deactivate the actor's own account (409 `CANNOT_DEACTIVATE_SELF`) or the last
    active member of a system role (409 `USER_LAST_ADMIN_PROTECTED`), so a tenant
    can never be left with no active administrator and no in-app recovery.

  All guards are checked before any write, audited on the success path only, and
  scoped to the tenant (no cross-tenant existence oracle).

- e407ffe: docs(governance): reposisi README/AGENTS & indeks ADR ke ADR-0034 (keluarga = template dipakai-langsung)

  Menyelaraskan dokumen pintu-depan dengan ADR-0034 (Fase 4a, item d + audit rujukan ADR ERP):

  - README (`.md`/`.id.md`) & AGENTS.md: narasi "repo ekstensi/turunan terpisah" → "template dipakai-langsung, modul domain (termasuk ERP) hidup langsung di `src/modules/`"; menghapus posisi jalur-turunan sebagai jalur aktif dan menandai panduan lama `derived-application-guide.md` DEPRECATED.
  - Header status ADR yang di-supersede ADR-0034: 0015 & 0022 → Superseded; 0013, 0014, 0025 → Accepted dengan catatan "jalur aplikasi-turunan di-supersede oleh ADR-0034" (bagian load-bearing base tetap berlaku).
  - Indeks ADR (`docs/adr/README.md`/`.id.md`): kolom Status kelima ADR itu diperbarui + framing folder direposisi dari ADR-0022 ke ADR-0034; regenerasi i18n-source-hash EN.

  ADR-0020 (kontrak kesiapan ERP) sengaja tidak disentuh — tetap load-bearing dan tidak di-supersede.

- fba69f8: chore(deps): bump `astro` from 7.0.9 to 7.1.1. Runtime framework patch. The
  family-compatibility manifest's `stack.astro.declared` pin is updated to `^7.1.1`
  in the same change so `family:conformance:check` stays green (declared value must
  equal the real `package.json` dependency).
- 320e8c6: chore(deps-dev): bump `@changesets/cli` from 2.31.0 to 2.31.1 (dev-only release
  tooling patch; no runtime behavior change).
- 50a7d76: chore(ci): bump `github/codeql-action` (`init` + `analyze`) from 4.37.0 to
  4.37.1. Both steps are bumped together in the same workflow — CodeQL requires
  every `github/codeql-action/*` step to run the identical version, so a split bump
  (dependabot opened `init` and `analyze` as separate PRs) fails the Analyze job
  with a version-mismatch error. This supersedes the separate `init`-only PR.
- 13813bb: Add a Content-Security-Policy to every response (Issue #148). This base
  previously set none at all.

  `src/lib/security/security-headers.ts` now emits `default-src 'self'`,
  `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, and
  `frame-ancestors 'none'` — the directive set awcms-mini uses, minus its
  `frame-src` and the Turnstile/YouTube origins it allowlists, neither of which
  has any subject in this base. `src/middleware.ts` already applies this
  builder's output to every response, so no route or middleware change was
  needed. `X-Frame-Options: DENY` stays as an independent older-browser layer.

  Set here rather than via Astro's built-in `security.csp` (the mechanism mini
  uses): Astro emits the CSP only from its page render path, and this base has
  no pages — `src/pages/` contains only API endpoints, and its two HTML
  responses (`src/lib/html/error-responses.ts`) are plain `Response`s returned
  from endpoints. A `security.csp` block in `astro.config.mjs` would therefore
  set zero headers here; `astro.config.mjs` now carries a comment recording
  that, and `security-headers.ts` documents what must be reconciled if this
  base ever gains real `.astro` pages (Astro's own header and this one do not
  compose — middleware's `headers.set` would replace Astro's).

  Rules out the "strict CSP breaks the UI" hazard rather than assuming it away:
  this base ships no `.astro` component, no inline script or style, no inline
  event handler, and no external origin, so `'self'` has nothing to break.

  Session cookies were already `httpOnly`, which stops XSS from reading a
  token; this closes the layer above it — XSS riding the session via a
  same-origin `fetch()`, and `<base href>` injection hijacking a relative form
  POST to an attacker origin.

- ad216ec: Add opt-in least-privilege `awcms_worker`/`awcms_setup` database roles (Issue #163) — the second half of the mini-045 role split; the first half (narrowing `awcms_app`) shipped as sql/021.

  `sql/022_awcms_db_worker_setup_roles.sql` creates two purpose-specific runtime roles alongside `awcms_app`:

  - **`awcms_worker`** — the seven unattended cron workers (`logs:audit:purge`, `sync:objects:dispatch`, `email:dispatch`, `domain-events:dispatch`, `workflow:escalations:dispatch`, `reporting:projections:refresh`, `reporting:exports:dispatch`). Granted exactly the per-write-path verbs each script uses across 25 tables — traced from THIS repo's actual SQL, not copied from mini (mini's worker set is visitor-analytics/blog/form-drafts, none of which exist here) — and zero access to the crown-jewel global catalogs (`awcms_permissions`, `awcms_schema_migrations`, `awcms_setup_state`, the module registry).
  - **`awcms_setup`** — the one-time `POST /api/v1/setup/initialize` bootstrap only. Granted exactly what `bootstrapPlatformTenant` writes across 11 tables, with SELECT accompanying INSERT on every `RETURNING id` (Postgres requires SELECT for a column to appear in RETURNING), `awcms_permissions` read-only, and no DELETE anywhere.

  Both are NOLOGIN + passwordless (a deployment activates LOGIN and a secret, exactly like `awcms_app`), non-superuser/non-BYPASSRLS/non-owner (so FORCE RLS applies), and carry the same fail-closed all-zero `app.current_tenant_id` default.

  **Opt-in, NOT breaking.** `getWorkerDatabaseClient`/`getSetupDatabaseClient` still fall back to `DATABASE_URL` (the `awcms_app` connection) when `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` are unset — a deployment that manages one connection string keeps working unchanged; the roles simply sit unused until an operator points a URL at one.

  A new `security:readiness` check ("Worker/setup least-privilege role grants match matrix") verifies each provisioned role holds exactly its matrix and nothing more (non-blocking when the roles are absent, i.e. on the fallback). The grant matrix, the migration's GRANTs, and the readiness check are pinned to one another by contract tests; the full matrix was validated empirically against PostgreSQL 18. Also corrects several stale comments/docs that referenced these roles as belonging to nonexistent migrations (mini's numbering 045/060/069).

  Migration only — no schema/data change, no API/event change.

- a805b2e: Add the browser E2E harness (Playwright + Bun) and a real catch-all 404 page — the first slice of porting awcms-mini's E2E layer, following the mini-first flow.

  - **Harness** (`playwright.config.ts`, `test:e2e`/`test:e2e:install` scripts, `@playwright/test` devDep) ported from awcms-mini and adapted: specs live in `tests/e2e/*.e2e.ts` (the `.e2e.ts` suffix keeps `bun test` from ever picking them up), run via `bun --bun playwright test` (Bun-only, AGENTS.md #14), against an already-running app (Playwright's `webServer` can't provision the Postgres this app boots against). See skill `awcms-browser-test`.
  - **Catch-all 404** (`src/pages/[...path].ts`) wires the previously-dormant public HTML error responses (`src/lib/html/error-responses.ts`): an unknown browser path now gets a clean, generic 404 HTML page that leaks nothing internal (Issue #540), and an unknown `/api/*` path gets the standard JSON error envelope instead of framework-default chrome. Astro ranks rest params lowest, so every real route still wins.
  - **First E2E spec** (`tests/e2e/not-found.e2e.ts`) drives a real Chromium at the 404 page and asserts the clean render + no internal-detail leak. Validated live locally (system Chrome) and wired into a new CI `e2e-smoke` job (`.github/workflows/ci.yml`) — no Postgres needed since the 404 route touches no DB.

  Foundation for the admin/management screens (login, offices, …) whose specs land with the first `.astro` pages.

- 13813bb: Perbaiki dua bug modul email yang diwarisi dari awcms-mini (Issue #143, #153).

  **#143 — lease dispatcher email tidak lagi write-only.** `claimEligibleEntries`
  menulis `next_attempt_at = leaseExpiry` sebagai lease klaim, tapi predikat
  klaimnya hanya menyaring `status IN ('queued', 'retry_wait')` — baris `sending`
  tidak pernah diklaim ulang. Dispatcher yang mati di antara CLAIM dan FINALIZE
  meninggalkan pesan `sending` selamanya: semua finalize bersyarat
  `status = 'sending'` dan `cancelEmailMessage` menolak status `sending`, jadi
  pesan itu tak terkirim, tak bisa dibatalkan, tak bisa di-retry. Predikat klaim
  kini menyertakan `OR (status = 'sending' AND next_attempt_at <= now)`, sama
  persis dengan dispatcher saudaranya `sync-storage/application/object-dispatch.ts`,
  sehingga `EMAIL_DISPATCH_LEASE_MINUTES` benar-benar dibaca. Insert
  `awcms_email_delivery_attempts` diberi `ON CONFLICT ... DO NOTHING` pada
  constraint `UNIQUE (message_id, attempt_no)`: pass yang mengklaim ulang
  menghitung `attempt_no` yang sama, dan `23505` yang tak tertangani akan
  membatalkan seluruh batch dispatch.

  **#153 — N+1 INSERT pada enqueue announcement.** `enqueueAnnouncement` kini
  memakai multi-row INSERT via `unnest` per 500 baris (pola sama dengan batch
  insert `awcms_object_sync_queue` di `src/pages/api/v1/sync/objects/index.ts`),
  bukan satu INSERT per recipient di dalam satu transaksi HTTP. Target
  `tenant`/`role` yang sebelumnya tanpa `LIMIT` kini dibatasi
  `ANNOUNCEMENT_MAX_RECIPIENTS` (5000) dengan urutan deterministik; saat cap
  tercapai, `enqueueAnnouncement` mengembalikan `truncated: true` dan mencatat log
  `warning` `email.announcement.recipients_truncated`. Dispatcher juga men-cache
  template per `template_key` dalam satu pass — satu batch 25 pesan announcement
  dengan `template_key` sama sebelumnya membuat 25 transaksi berisi 25 query
  identik.

  Response endpoint announcement bertambah field `truncated` (additive), begitu
  juga endpoint preview-nya — keduanya beserta OpenAPI-nya diperbarui. Tanpa itu
  pemanggil menerima `200 OK` berisi `recipientCount: 5000` dan tidak punya cara
  tahu bahwa sisa audiensnya tidak pernah di-enqueue; `matchedCount` di preview
  pun akan diam-diam berarti "maksimal 5000", padahal preview justru dipakai
  admin untuk menjawab "berapa yang akan terjangkau?" sebelum mengirim.

  Panggilan provider tetap di luar transaksi (ADR-0006), satu panggilan per pesan
  — cache template tidak menggabungkan pengiriman.

- 13813bb: Fix profile identifier masking and duplicate handling (Issue #144, Issue #150),
  both ported from awcms-mini.

  - `maskIdentifierValue` now masks email-shaped values the way awcms-mini's
    `maskIdentifier` does: the domain and the local part's first character stay
    readable (`budi.santoso@example.com` -> `b***********@example.com`) instead
    of collapsing every address into an identical star run ending in `.com`. The
    masked columns exist so an admin can tell recipients apart in the email
    outbox and suppression lists; the generic tail mask made
    `to_address_masked`/`recipient_masked` useless for that. The email branch is
    detected from the value itself, so the `maskIdentifierValue(value)` signature
    and every existing call site are unchanged.
  - `maskIdentifierValue` no longer leaks the last character of a short value:
    `"7788"` now masks to `****` (was `***8`) and `"12"` to `**` (was `*2`).
    A value of four characters or fewer has no non-leaking tail to show.
  - `POST /api/v1/profiles/{id}/identifiers` now answers `409
IDENTIFIER_ALREADY_EXISTS` when the identifier already exists for the tenant,
    instead of surfacing the unique-index violation as an unhandled `500`.
    `addIdentifierToProfile` translates Postgres `23505` into a new
    `DuplicateIdentifierError`; any other Postgres error is rethrown untouched.
    The route catches it inside `withTenant` so the translated error cannot count
    against the shared database circuit breaker.

- 9db1da6: Add the first `tests/integration/` suite — a real-PostgreSQL harness plus the
  priority tests ported from awcms-mini (Issue #154).

  Until now every one of this repo's `tests/*.test.ts` was a pure-unit test or a
  migration-shape assertion; nothing exercised RLS, FK, unique constraints,
  locking, or a real request path. That is the root reason several DB-layer bugs
  reached the tree undetected (RLS inert on 23 tables, PR #139). awcms-mini has
  101 integration tests; awcms had none.

  New `tests/integration/harness.ts` provisions, from the CI-supplied superuser
  `DATABASE_URL`, a throwaway database owned by a purpose-built non-superuser
  role, runs the REAL migration runner (`bun scripts/db-migrate.ts`) as that
  role, demotes it, and activates migration 019's least-privilege `awcms_app`
  role — reproducing production's exact connection posture (non-superuser,
  NOBYPASSRLS, `FORCE` RLS live). It repoints `DATABASE_URL` at the app role so
  every route handler and `getDatabaseClient()` call runs least-privilege, and
  tears the database down afterwards. Ref-counted so multiple files share one
  database within a `bun test` process.

  New tests (all gated on `DATABASE_URL`, so `bun test` without a database — as
  in `ci.yml` — skips cleanly, and they execute in `release.yml`, which provides
  a `postgres:18.4` service):

  - `db-role-separation.integration.test.ts` — pins PR #139/#141: all 23 tables
    are `ENABLE`+`FORCE`, cross-tenant SELECT/UPDATE/DELETE/INSERT are blocked
    for the owner posture, a live-catalog check catches any future table shipped
    with `ENABLE` but no `FORCE`, and the `awcms_app` grant matrix + fail-closed
    all-zero `app.current_tenant_id` default. `awcms_app` assertions skip cleanly
    and informatively if migration 019 is ever absent.
  - `module-tenant-lifecycle.integration.test.ts` — pins the PR #139 invariant
    that disabling a module actually returns `403 MODULE_DISABLED` from its own
    endpoints (not just flips a flag), plus enable/disable rules, audit, and
    cross-tenant isolation, through the real route handlers.
  - `reporting-projections.integration.test.ts` — pins the incremental
    cursor-table worker's bounded-pass/resume correctness and the event-activity
    watermark comparison, making the source references in
    `event-activity-projection.ts` and `reporting/README.md` true.
  - `object-storage-uploader.integration.test.ts` — the ADR-0006 provider path
    (checksum-mismatch pre-check, provider 5xx, timeout, circuit breaker) over a
    real loopback S3 round trip. Not database-gated — runs everywhere.

  Tests-only: no runtime code, migration, schema, or API surface changes.

- 296b7e3: Fix silent row loss in keyset pagination: the shared cursor now carries
  `created_at` at full microsecond precision instead of flooring it to
  milliseconds (Issue #158).

  `encodeKeysetCursor` used to serialise a row's `created_at` as a JS `Date`
  (`.toISOString()`), which holds only milliseconds — but `timestamptz` holds
  microseconds, and the driver had already floored them on the way out
  (`...:00.029058+00` arrives as `...:00.029Z`). A cursor built from that `Date`
  denoted an instant strictly EARLIER than the row it came from, so
  `(created_at, id) < (cursor)` skipped every row that shared that millisecond
  across a page boundary — rows that no later cursor could reach either. Measured
  against a batch of rows sharing one millisecond, page 2 came back empty.

  The fix carries the value through the cursor as full-precision UTC ISO-8601
  text (`_shared/keyset-pagination.ts`, `KEYSET_CURSOR_CREATED_AT_SQL`), keeping
  `ORDER BY (created_at, id)` on the bare column so the existing
  `(tenant_id, created_at DESC)` indexes still serve the query. `KeysetCursor.createdAt`
  is now a string, not a `Date`; the cursor stays opaque to clients and remains
  backward-compatible with any millisecond cursor already in flight.

  Endpoints corrected: `GET /api/v1/workflows/tasks`, `GET /api/v1/email/messages`,
  `GET /api/v1/sync/object-queue`, and `GET /api/v1/offices` (whose earlier local
  `date_trunc('milliseconds', …)` guard is removed now that the fix is central).
  The `GET /api/v1/email/messages` and `GET /api/v1/sync/object-queue` response
  bodies are unchanged (`{ …, nextCursor }`); only the value of `nextCursor` is
  now correct.

- 8a78ffd: Harden `checkRuntimeRoleGrants` (`bun run security:readiness`) to fail CLOSED
  for undeclared global RLS-free tables (Issue #162 / L2, from the PR #161
  security audit).

  The runtime-role grant check kept two independent structures: an
  `RLS_FREE_TABLES` set (read by `checkRlsEnabled`) and a separate
  forbidden-privilege map (read by `checkRuntimeRoleGrants`). A future global,
  RLS-free table added to the SET to make `checkRlsEnabled` pass but forgotten in
  the MAP was `continue`d as "full DML kept by design" and passed silently — the
  exact "a new global table inherits blanket DML from `ALTER DEFAULT PRIVILEGES`"
  regression this check exists to catch. Non-exploitable today (the 9 tables are
  curated correctly) but a latent trap for the next migration.

  - The two structures are merged into ONE source of truth
    (`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`, keyed by table name; `RLS_FREE_TABLES`
    is now derived from its keys). You can no longer register a table in one
    place without the other — every RLS-free table carries an explicit
    privilege declaration. The five module-registry tables that legitimately
    keep full DML get an explicit empty (`[]`) forbidden list — a visible
    "allow", not an implicit default.
  - The over-granted direction is now fail-closed: any table treated as RLS-free
    but missing an explicit declaration is asserted to hold ZERO writes. A
    forgotten registration that still holds INSERT/UPDATE/DELETE now FAILS
    `critical` with a "register the privileges awcms_app may hold" message
    instead of passing.

  Behaviour on the current, correctly-curated database is unchanged (still PASS).
  No schema, API, or event changes. Verified against a fully-migrated PostgreSQL
  18 database (sql/001..021): the 9-table default policy still passes, and a
  simulated undeclared global table holding blanket DML now fails the check.

- 1877d19: Close three gaps in `redactSecretsInText` where secret-shaped substrings
  passed through free text (error messages, stack traces) unredacted. Each shape
  was already covered by the anchored `SECRET_VALUE_PATTERNS` list in the same
  file, but was missing from the free-text `TEXT_SECRET_PATTERNS` list — so
  object values were masked while the identical secret in an error string was
  not.

  - Connection-string credentials (`scheme://user:password@host`). This is the
    highest-impact of the three: `DATABASE_URL`/`WORKER_DATABASE_URL` are DSNs,
    so the app's own database password reached `sanitizeErrorForLog` unredacted
    and was persisted to `awcms_domain_event_deliveries.last_error_message` /
    `dead_letter_reason`, then served verbatim by
    `GET /api/v1/domain-events/deliveries` — whose read path documented (and
    relied on) the invariant that write-time redaction had already run.
  - PEM private-key blocks truncated before their `-----END-----` marker (a log
    line cut off by a buffer limit). The existing paired pattern cannot match an
    unterminated block, so the raw base64 key body was emitted in full. The new
    fallback is ordered after the paired pattern, which has already consumed
    every well-formed block.
  - AWS access key ids (`AKIA…`) embedded in prose.

  Adds `tests/redaction.test.ts` pinning all three shapes plus the pattern
  ordering; the module previously had no test coverage, which is why the gaps
  went unnoticed.

- 13813bb: Fix a TOCTOU between a reporting projection rebuild and the steady-state
  incremental worker that could double-count a projection's metrics (Issue
  #151).

  `projection-incremental-worker.ts`'s rebuild guard (`isRebuildRunning`) ran
  in a `withTenant` transaction of its own, committed, and only then opened a
  separate transaction per pass. A rebuild triggered in that window reset the
  projection's cursors to NULL and its metrics to 0 _after_ the guard had
  already reported "no rebuild is running", so the incremental pass re-scanned
  the source table from the beginning while the rebuild's own passes did the
  same — both applying the same delta to the same metric row (they serialize
  on that row lock and therefore sum). The file's own header claimed the
  opposite invariant ("idempotent rebuild must never double-count").

  - New `reporting/application/projection-lock.ts`: a per-(tenant, projection)
    `pg_advisory_xact_lock`, taken as the FIRST statement of every transaction
    that writes a projection's cursor/metric rows — `runCursorStreamPass`,
    `triggerOrResumeRebuild`, `runRebuildStreamPass`, and
    `applyEventActivityProjectionIncrement`. Held by the database for the whole
    transaction and released automatically at COMMIT/ROLLBACK.
  - `runCursorStreamPass` now also re-checks `findRunningRebuild` inside that
    same locked transaction, and reports the skip as a pass result
    (`CursorStreamPassResult.skippedRebuildInProgress`) instead of the caller
    pre-checking it in an earlier, separate transaction.

  Relocating the check alone would not have been sufficient: these transactions
  run at READ COMMITTED, where every statement takes a fresh snapshot, so a
  check and an act are not atomic with respect to a concurrently committing
  writer even within one transaction. The lock is also the only mechanism that
  works across processes — the rebuild trigger runs in a web request while the
  incremental worker runs in a separate `reporting:projections:refresh`
  process, which no in-process gate can serialize.

  No migration, no API change, no event change: `pg_advisory_xact_lock` needs
  no schema. `runIncrementalUpdateForTenant`'s observable outcome shape is
  unchanged; a skipped run still reports `skippedRebuildInProgress: true` with
  `rowsProcessed: 0`.

  Also corrects stale references to
  `tests/integration/reporting-projections.integration.test.ts`
  (`projection-incremental-worker.ts`, `event-activity-projection.ts`, and the
  module README) — that file exists in awcms-mini, not here, and this
  repository has no `tests/integration/` suite at all.

- d04c96c: Fix `POST /api/v1/roles` and `POST /api/v1/offices` to return `201 Created` on success instead of `200 OK`, matching the `created()` helper already used by `POST /api/v1/abac/policies` and the REST convention for resource-creation endpoints. Updates the corresponding OpenAPI response codes to `201`.
- 9db1da6: Sapu realitas warisan awcms-mini dari `.claude/skills/` (yang DIIKUTI agen,
  sehingga skill yang salah aktif melahirkan bug) dan tambah gate otomatis yang
  menangkap kelas bug ini sekali jalan.

  - **Rujukan migration `sql/NNN` hantu** — 34 rujukan (penomoran awcms-mini yang
    terbawa saat adaptasi) dibetulkan: yang punya padanan awcms diperbaiki ke
    nomor yang benar (mis. email — migrasi mini 020/021/024 → `sql/014`), yang
    merujuk modul yang belum di-port dinyatakan tegas sebagai artefak awcms-mini
    lewat banner status per-file.
  - **Skill untuk modul yang belum di-port ditandai BACAAN SAJA** — 10 skill
    (`blog-content`, `data-lifecycle`, `document-infrastructure`, `form-drafts`,
    `idn-admin-regions`, `integration-hub`, `news-portal`, `social-publishing`,
    `visitor-analytics`, `tenant-domain-routing`) mendapat prefiks status di
    `description` + banner "BELUM di-port; ada di awcms-mini" di body, mengikuti
    pola `awcms-legacy-migration`. `awcms-profile-identity` ditandai SEBAGIAN
    (fondasi ada, lapis Issue #748 belum di-port).
  - **Rujukan role/script disetel ke realitas terkini** — `awcms_app` +
    `scripts/security-readiness.ts` kini ADA (Issue #141/#142); skill dinaikkan
    dari "belum ada" ke status akurat (mis. `awcms-new-migration` aturan 11/12,
    `awcms-port-from-mini`, `awcms-deploy`, `awcms-workflow-approval`). Role
    `awcms_worker`/`awcms_setup` dinyatakan tetap tidak ada.
  - **Gate baru `checkSqlMigrationReferences`** di `scripts/lib/docs-checks.mjs`
    (dijalankan `bun run check:docs`) menolak setiap rujukan `sql/NNN` di
    dokumentasi (termasuk `.claude/skills/`) yang berkasnya tidak ada di `sql/`.
    Escape hatch berbasis konten (penanda inline `<!-- sql-refs: awcms-mini -->`
    - daftar path), bukan nomor baris.
  - **`NAMING_EXEMPTIONS` diperbaiki dari `file:line` ke `file::identifier`**
    (berbasis konten) supaya kebal terhadap pergeseran baris — desain lama patah
    saat agen paralel menyisipkan baris di dokumen yang sama.

  Tidak ada perubahan pada kode runtime, schema, atau API.

- 911738a: docs: sinkronkan dokumentasi & skill dengan kode/DB (aftermath ADR-0034) + dokumen kontinuasi

  Menyelaraskan docs non-gate dan skill dengan realita repo (11 modul, 34 migrasi, jalur aplikasi-turunan dihapus, port #179–186 landing):

  - **docs/ARCHITECTURE.md**: 10→11 modul (+theming), sql/023→034, §Komposisi ditulis ulang tanpa jalur turunan (`application-registry.ts`/`extension:check`/namespace 900); fakta diperbarui — MFA/OIDC/SSO/Turnstile & ABAC-dinamis/business-scope/SoD dari "belum ada" → "sudah live"; OpenAPI bundler & theming dipindah dari gap.
  - **docs/awcms & docs/adr** (12 file): repo-inventory & doc 13 (angka modul/migrasi), extension-compatibility-policy (banner DEPRECATED), api-contribution-guide & 09_roadmap & release-process (framing/tooling turunan dicabut), collision slot `sql/033` (kini theming) di ADR-0003/0010, path fixture `derived-application-example`→`example-domain-modules`.
  - **.claude/skills** (7 diedit + 1 baru): new-module (buang jalur turunan + ModuleType `derived`), erp-extension-readiness (BACAAN SAJA/HISTORIS), release & production-preflight (buang `extension:check`), codeql-triage (FP #6 historis), observability/integration (reframe "aplikasi turunan"), **skill baru `awcms-theming`**.
  - **docs/PROJECT_STATE.md** (BARU): dokumen kontinuasi/handoff ter-versioning (model tata kelola, inventori, backlog, jebakan) + pointer dari AGENTS.md.

  Tidak ada perubahan kode/sql/kontrak; `bun run check` penuh hijau.

- 8a78ffd: Harden sync HMAC v2 signature material against delimiter ambiguity (audit finding L1, GHSA-c972-3q5p-g3h4).

  The v2 material `v2:<tenantId>:<nodeCode>:<timestamp>:<body>` was cryptographically ambiguous at the tenant/node boundary because `nodeCode` may contain `:` (schema `node_code text`, no format constraint): `(tenantId="A", nodeCode="x:y")` and `(tenantId="A:x", nodeCode="y")` produced byte-identical material and mutually-accepted signatures. This was confirmed NOT cross-tenant exploitable (a request's `tenantId` must be a valid UUID to reach tenant data via `withTenant`), but was a latent weakness in security-signature code.

  `computeSyncSignatureV2`/`verifySyncSignatureV2` now require `tenantId` to be a UUID before the material is built — a UUID is a fixed 36 chars with no `:`, so the tenant field boundary is unambiguous. `computeSyncSignatureV2` throws on a non-UUID tenantId; `verifySyncSignatureV2` fails closed (returns `false`). Only `tenantId` is constrained — `nodeCode` is untouched, and the v2 material format is unchanged, so already-deployed v1/v2 nodes (whose tenant ids are UUIDs) are unaffected. v1 signatures (`computeSyncSignature`/`verifySyncSignature`) are not changed. Timing-safe comparison is preserved.

## 5.1.1

### Patch Changes

- 2008905: Perbaiki `release.yml`'s job `sign-attest-publish`: `actions/attest-build-provenance` dan `actions/attest-sbom` menolak `subject-name` yang menyertakan tag (`ghcr.io/ahliweb/awcms:dryrun-<sha>@sha256:...` → `Invalid image name`) — ditemukan lewat rehearsal pertama (`workflow_dispatch`, run 29477950931) sebelum tag rilis nyata pertama di-push. Tambah output job `build`'s `image-repo` (repo tanpa tag) dan pakai itu untuk `subject-name` kedua step attest, sambil tetap memakai `image-ref` (dengan tag) untuk `cosign sign`.

## 5.1.0

### Minor Changes

- a53e6e2: Implementasikan pipeline release nyata (docs/awcms/release-process.md): `Dockerfile.production` (multi-stage, non-root, health check), `.dockerignore`, `scripts/release-verify.ts` (+ `scripts/lib/release-verify-checks.ts`, tag == package.json version, CHANGELOG punya section, tak ada changeset pending), dan `.github/workflows/release.yml` (validate → build image + SBOM ganda → keyless cosign sign + provenance/SBOM attest → publish GitHub Release, dengan jalur rehearsal via `workflow_dispatch`). Belum pernah dieksekusi terhadap tag nyata — rehearsal pertama masih perlu dijalankan sebelum tag `v5.0.0` sungguhan di-push.

### Patch Changes

- d83805c: Perbaiki `package.json`'s `description` agar konsisten dengan ADR-0022/ADR-0023: AWCMS adalah basis/fondasi untuk ERP, bukan sebuah "Platform ERP" itu sendiri.

## 5.0.0

**Deliberate manual version jump — not a tool-computed SemVer increment.** Bumped directly from `0.2.0` to `5.0.0` per maintainer decision to continue this product's pre-rebuild release numbering (last legacy tag: `v4.6.0`) rather than resetting to `1.0.0`, so version comparisons never look like a downgrade across the rebuild. See [ADR-0024](docs/adr/0024-semver-numbering-continues-legacy-major-line.md) for the full rationale and an explicit compatibility note: despite continuing the number line, **`5.0.0` is not backward-compatible with any `v2.x`–`v4.x` legacy release** — the entire codebase was rewritten from scratch on a new foundation (Bun/Astro/PostgreSQL modular monolith, see [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md)/[ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md)). No git tag or GitHub Release accompanies this changelog entry yet — `.github/workflows/release.yml` (the SBOM/signing/provenance publish pipeline, see [`docs/awcms/release-process.md`](docs/awcms/release-process.md)) has not been implemented yet, so there is no real release for this version to attach to until that pipeline exists.

## 0.2.0

### Minor Changes

- f306b38: Tambah workflow GitHub Actions (CI, CodeQL, Changesets policy) yang mencerminkan `bun run check`, gate `check:docs` (mermaid/tautan/penamaan) beserta logika murninya, script `changesets:policy:check`, template issue/PR, dependabot, dan CODEOWNERS — diadaptasi dari awcms-mini dan dipangkas ke infrastruktur yang benar-benar ada di repo ini (belum ada job E2E/Postgres-integrasi/release image, didokumentasikan sebagai deferred di `docs/awcms/branch-protection.md` dan `scripts/README.md`).
- 5d1cf54: Tambah dukungan dokumentasi dwibahasa (ADR-0023): Bahasa Indonesia sebagai sumber otoritatif (`<nama>.id.md`), Inggris sebagai default yang tampil (`<nama>.md`). Diterapkan pada tiga dokumen pintu depan (`README.md` root, `docs/awcms/README.md`, `docs/adr/README.md`) plus `scripts/check-docs-translation.mjs` (gate staleness berbasis hash, masuk `bun run check` dan CI) yang mendeteksi saat sumber ID berubah tanpa terjemahan EN diregenerasi.

### Patch Changes

- ffdcd99: Bump `actions/upload-artifact` dari v4.6.2 ke v7.0.1 di workflow CI (dependency bump, tidak ada perubahan perilaku pipeline).
