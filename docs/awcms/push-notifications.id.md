🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](push-notifications.md)

<!-- i18n-source-hash: sha256:03a21db2148e3b3ec92f558dddf4c29b5d38881a9f4751d20e6853f2921428af -->

<!-- i18n-source-hash: sha256:0 -->

# Notifikasi Push — Rahasia Auth Saat Disimpan dan Runbook Rollout

Cakupan: modul `push_delivery` (ADR-0074), khususnya cara `auth_secret` RFC 8291
per-langganan disimpan (Issue #1089, tindak lanjut #1082). Modulnya dijelaskan di
`src/modules/push-delivery/README.id.md`.

Matriks uji operator, status UAT perangkat nyata, dan daftar go/no-go:
[`push-notifications-test-matrix.id.md`](push-notifications-test-matrix.id.md) (Issue #1107).

## Apa yang berubah

`awcms_push_subscriptions.auth_secret` dulu plaintext, terbaca oleh `awcms_app`
dan `awcms_worker`. Sekarang berupa **ciphertext** di `auth_secret_ciphertext`
(`sql/314`): AES-256-GCM lewat helper ADR-0137 bersama, dengan cincin kunci
sendiri `PUSH_AUTH_SECRET_ENCRYPTION_KEYS` (format `keyId:base64,...` dan aturan
rotasi sama dengan `TELEGRAM_CHAT_ENCRYPTION_KEYS`: kunci pertama menulis, semua
kunci membaca).

AAD-nya `(purpose, tenant_id, endpoint_hash)`. Ini meniru
`awcms_telegram_bindings.chat_ciphertext` (yang mengikat `id` baris) dengan satu
perbedaan sengaja: pendaftaran adalah upsert dengan kunci
`(tenant_id, endpoint_hash)`, sehingga `id` baris yang bertahan baru diketahui
setelah statement berjalan, sedangkan hash diketahui sebelumnya dan tidak pernah
berubah. Ciphertext yang disalin ke langganan atau tenant lain gagal autentikasi.

## Keputusan dan trade-off

| Keputusan                                                        | Pilihan                                                                                                                                                                                              | Alasan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cincin kunci tidak ada saat pendaftaran                          | **Gagal-tertutup**: `503 PUSH_MISCONFIGURED`, tidak ada yang disimpan; `GET` melaporkan `webPush.enabled=false`                                                                                      | Fallback plaintext akan terus menulis baris yang harus dikejar backfill sehingga rollout tidak pernah konvergen, dan diam-diam mempertahankan paparan yang justru dihapus perubahan ini. Perangkat yang gagal daftar bisa mencoba lagi setelah kunci diset; rahasia yang bocor tidak bisa ditarik. Baris `fcm` tidak membawa rahasia dan tidak butuh cincin.                                                                                                                                     |
| Dispatcher, baris punya ciphertext                               | Dekripsi; **tidak pernah** fallback ke plaintext                                                                                                                                                     | Fallback membiarkan plaintext basi menutupi ciphertext yang gagal (dirusak/dipindah).                                                                                                                                                                                                                                                                                                                                                                                                            |
| Dispatcher, baris tanpa ciphertext                               | Pakai plaintext lama                                                                                                                                                                                 | Hanya selama masa transisi; berakhir dengan backfill dan drop kolom.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Dispatcher, ciphertext tetapi tanpa cincin / kunci sudah dibuang | Kegagalan **dapat diulang** dengan pesan tetap                                                                                                                                                       | Konfigurasi yang bisa diperbaiki operator; pesan tidak hilang.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Dispatcher, ciphertext gagal autentikasi                         | Kegagalan **tidak dapat diulang**                                                                                                                                                                    | Data dirusak atau dipindah; mengulang tidak membantu.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Baris memegang kedua kolom                                       | Ditolak CHECK ("tepat satu")                                                                                                                                                                         | Ciphertext basi tidak boleh menutupi plaintext yang lebih baru.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Kolom plaintext                                                  | **Dipertahankan** pada perubahan ini (fase 1)                                                                                                                                                        | Migrasi tidak bisa mengenkripsi; menjatuhkannya sebelum backfill menghancurkan rahasia semua langganan yang ada.                                                                                                                                                                                                                                                                                                                                                                                 |
| Grant worker                                                     | `INSERT` dicabut; `UPDATE` dipersempit ke `status, disabled_reason, last_success_at, updated_at, auth_secret, auth_secret_ciphertext` (dipin di `WORKER_COLUMN_GRANTS`); `SELECT` dan `DELETE` tetap | Worker dulu bisa menulis ulang `endpoint`/`p256dh_key`, atau DELETE baris lalu INSERT ulang dengan endpoint penyerang dan ciphertext korban yang disalin (`id`/`endpoint_hash` sama). Worker **masih bisa** menghapus langganan (purge membutuhkannya; hanya menghentikan notifikasi) dan menulis dua kolom rahasia (backfill membutuhkannya; sampah di sana membuat pengiriman gagal, tidak bisa mengalihkannya). Worker **tidak bisa** INSERT, atau mengubah endpoint, hash-nya, maupun kunci. |
| Identitas baris saat pengiriman                                  | Dispatcher menolak (tidak dapat diulang, pesan tetap) baris yang `endpoint`-nya tidak ber-hash ke `endpoint_hash`                                                                                    | Pertahanan berlapis: hash adalah AAD ciphertext, dan baris palsu tidak boleh dikirim dengan rahasia yang sudah didekripsi. Diperiksa di luar transaksi DB, sehingga penolakan tidak dihitung sebagai kegagalan database oleh circuit breaker.                                                                                                                                                                                                                                                    |

## Runbook operator: urutan rollout

Urutan penting. Langkah 4 sebelum 1 atau 2 menghentikan pendaftaran (by design);
menjatuhkan kolom sebelum langkah 5 menghilangkan rahasia.

1. **Buat dan simpan cincin kunci** (secret store, bukan repo):
   `PUSH_AUTH_SECRET_ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)`. Harus
   berbeda dari setiap cincin lain. Berikan ke **aplikasi**, `push:dispatch`, dan
   `push:auth-secret:backfill` (sudah ada di `ops/awcms-jobs.env-allowlist`).
   `bun run config:validate` memeriksanya saat `PUSH_PROVIDER=web_push`.
2. **Deploy rilis** (menjalankan `sql/314`: menambah kolom, melonggarkan CHECK,
   mempersempit UPDATE worker). Sejak itu: perangkat baru/terdaftar ulang berupa
   ciphertext; baris lama tetap terkirim dari plaintext.
3. **Jalankan backfill sekali** (sebagai `awcms_worker`):
   `bun run push:auth-secret:backfill`. Idempoten dan dapat dilanjutkan: jalankan
   ulang setelah crash atau exit non-nol (exit 2 = ada tenant yang menyentuh batas
   batch; exit 1 = tanpa cincin kunci). Konversi dilakukan dalam batch keyset
   terbatas, satu transaksi per batch.
4. **Verifikasi**: `bun run security:readiness` pada pemeriksaan "Push
   subscription auth secrets are encrypted at rest" harus PASS (melaporkan jumlah
   baris plaintext selama masih ada; severity warning karena di tengah rollout hal
   itu wajar).
5. **Nanti (PR terpisah, setelah setiap deployment lolos langkah 4)**: migrasi
   menjatuhkan `auth_secret`, mengetatkan CHECK agar mewajibkan ciphertext, dan
   entri `awcms_push_subscriptions.auth_secret` dihapus dari
   `WORKER_CREDENTIAL_COLUMN_EXCEPTIONS`.

### Rotasi

Runbook operator (Issue #1098; prosedur yang sama berlaku untuk cincin Telegram,
lihat di bawah):

1. Tambahkan kunci baru di depan (`k2:<baru>,k1:<lama>`) pada
   `PUSH_AUTH_SECRET_ENCRYPTION_KEYS` lalu deploy. Kunci pertama menulis, semua
   kunci membaca, sehingga tidak ada yang rusak selama baris masih membawa `k1`.
2. Jalankan `bun run push:auth-secret:rekey` (mode `--rekey` pada skrip backfill).
   Ia mengenkripsi ulang setiap baris yang id kunci ciphertext-nya bukan kunci
   aktif. Idempoten, dapat dilanjutkan, berbatch (keyset), berjalan sebagai
   `awcms_worker`, dan tidak pernah mencetak materi kunci atau ciphertext. Kode
   keluar: `1` tidak ada cincin valid, `2` ada tenant yang belum selesai (jalankan
   lagi), `3` sebagian baris tidak dapat didekripsi dengan cincin (dihitung dan
   dibiarkan; artinya kunci tempat baris itu ditulis sudah hilang dari cincin:
   kembalikan kuncinya, jalankan ulang).
3. Periksa `bun run security:readiness`, pemeriksaan "Push auth-secret
   ciphertexts are under the active key". Ia mencetak jumlah baris per id kunci
   (hanya hitungan) dan memberi peringatan selama masih ada baris di bawah kunci
   selain yang aktif.
4. Hanya bila pemeriksaan itu lulus, buang `k1` dari cincin lalu deploy. Membuang id
   kunci yang masih dipakai membuat baris itu tidak terkirim (kegagalan dapat
   diulang, "cincin tidak punya kunci"). Setelah kunci BOCOR, jalankan langkah 1-4
   segera; kunci lama dipensiunkan begitu langkah 3 hijau.

**Re-key hanya membungkus ulang; ia tidak membatalkan kebocoran.** Siapa pun yang
memegang kunci lama dan salinan data (database, backup, replika) tetap dapat
membaca secret yang disalinnya. Setelah kebocoran, anggap langganan push
terpapar: paksa daftar ulang (nonaktifkan barisnya agar tiap perangkat mendaftar
lagi dengan secret baru) dan hapus backup sesuai kebijakan. Chat id Telegram adalah
PII yang terungkap.

**Jalan terakhir untuk baris yang tidak dapat didekripsi** (kode keluar `3`, kuncinya
hilang permanen): pemeriksaan readiness tidak bisa hijau selama baris itu ada.
Nonaktifkan langganan push (`disablePushSubscription`, atau hapus lewat sweep
retensi) agar perangkat mendaftar ulang; untuk Telegram, akhiri binding dengan
`endBindings` agar pengguna menautkan ulang. Jangan menyunting ciphertext manual.

Perangkat yang mendaftar ulang juga otomatis dienkripsi ulang dengan kunci aktif.

#### Cincin chat Telegram

`TELEGRAM_CHAT_ENCRYPTION_KEYS` (`awcms_telegram_bindings.chat_ciphertext`) punya
celah dan prosedur yang sama dengan `bun run telegram:chat:rekey` dan pemeriksaan
readiness "Telegram chat ciphertexts are under the active key". Satu perbedaan:
job ini berjalan sebagai `awcms_app` (`DATABASE_URL`), bukan worker, karena
trigger penjaga binding (`sql/216`) menolak semua role lain menulis ciphertext chat
yang hidup, sehingga worker yang memegang cincin kunci tidak dapat mengarahkan
binding ke chat lain. Trigger tidak dapat membedakan re-key dari penukaran, jadi
sengaja dibiarkan. Binding yang dicabut atau terhapus tidak membawa ciphertext dan
tidak disentuh; cincin hash `TELEGRAM_CHAT_HASH_KEYS` adalah cincin terpisah dan
tidak terpengaruh.

### Rollback

Mengembalikan **aplikasi** ke rilis tanpa perubahan ini saat baris sudah
ciphertext merusak pengiriman untuk baris tersebut (kode lama hanya membaca
`auth_secret`) dan membuat upsert pendaftaran lama gagal pada CHECK "tepat satu".
Pilih maju, atau kosongkan ciphertext hanya untuk baris yang bisa dikumpulkan
ulang. Migrasinya aditif; tidak ada migrasi turun.

### Batasan yang diketahui

- ~~Rotasi belum punya mode re-key / hitungan baris per kunci~~ **Selesai (Issue #1098):** `bun run push:auth-secret:rekey`, `bun run telegram:chat:rekey`, dan pemeriksaan readiness per id kunci. Lihat Rotasi.
- ~~Pendaftaran mengambil alih perangkat dari pengguna lain di tenant yang sama~~ **Diselesaikan sebagai transfer yang eksplisit dan diaudit (Issue #1098), lihat di bawah.** Risiko sisa diterima: pengguna tenant yang tahu endpoint persis pengguna lain (URL kapabilitas, di-mask di mana-mana) tetap dapat memindahkan perangkat itu ke dirinya; secret tidak terungkap.

### Pendaftaran ulang endpoint oleh pengguna lain (Issue #1098)

Pendaftaran dikunci pada `(tenant_id, endpoint_hash)`. Bila endpoint yang sama
didaftarkan pengguna tenant yang berbeda dari pemegang baris (**apa pun
statusnya**: aktif, nonaktif, atau dicabut), baris itu **pindah ke pengguna baru**. Pertimbangan, sudah diputuskan:

| Opsi                                      | Pro                                                                                              | Kontra                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Tolak bila pemilik berbeda (ditolak)      | Menutup pengambilalihan sepenuhnya                                                               | Endpoint milik **profil browser**: di browser bersama, pengguna kedua tidak akan pernah menerima notifikasi, tanpa tahu sebabnya. |
| Transfer diam-diam (sebelumnya)           | Berfungsi di browser bersama                                                                     | Pemilik lama berhenti menerima notifikasi dan tidak ada yang memberi tahu.                                                        |
| **Transfer eksplisit dan diaudit (kini)** | Berfungsi di browser bersama; perpindahan terlihat, dapat diatribusikan, dan dapat dibalik admin | Pengguna tenant yang memegang endpoint mentah tetap dapat mengambil perangkat; deteksi, bukan pencegahan.                         |

Yang dilakukan transfer, dalam **transaksi yang sama** dengan pendaftaran:

- `tenant_user_id` baris menjadi pengguna baru; notifikasi pengguna lama yang masih
  antre (`queued`, `retry_wait`) untuk perangkat itu dibatalkan dengan
  `last_error = 'subscription_transferred'`, dan fan-out berikutnya untuk pengguna
  lama melewati perangkat itu. Mencabut atau menonaktifkan perangkat membatalkan
  pesan tertunda dengan cara yang sama. Pertahanan berlapis: setiap pesan membawa
  `recipient_tenant_user_id` (`sql/315`, diisi saat enqueue), dan dispatcher menolak
  (tidak dapat diulang, pesan tetap) pesan yang penerimanya bukan lagi pemilik
  langganan. Jadi tidak ada yang ditujukan kepada pengguna lama sampai ke pemilik
  baru, termasuk pesan yang sudah di-claim (`sending`) saat transfer commit dan
  pesan dari perangkat yang dicabut lalu didaftarkan ulang orang lain. Sisa jendela
  hanyalah transfer yang commit antara pemeriksaan pemilik dan panggilan provider;
  itu terkirim dengan secret lama yang sudah basi dan tidak dapat didekripsi di
  perangkat;
- satu event audit `push_delivery` / `subscription.transfer` (`push_subscription`,
  severity `warning`) mencatat id langganan serta `tenant_user_id` lama dan baru.
  **Hanya id**: tidak pernah endpoint, kunci, atau secret. Bila penulisan audit
  gagal, pendaftaran gagal dan di-rollback (gagal tertutup);
- "pemilik lama" dibaca dengan baris **terkunci** (`SELECT ... FOR UPDATE` setelah
  `INSERT ... ON CONFLICT DO NOTHING`), sehingga dua pendaftaran bersamaan tidak
  dapat sama-sama mengira dirinya yang pertama. Mendaftar ulang perangkat sendiri,
  atau perangkat baru tidak mencatat transfer.

### Logging

Rahasia plaintext maupun ciphertext tidak muncul di baris log, baris audit, event,
atau respons API; pesan kegagalan dispatcher adalah string tetap.

## Payload Web Push deklaratif dan rollout (Issue #1106)

`web_push` kini dapat memancarkan bentuk **Declarative Web Push** WebKit
alih-alih bentuk legacy. Hanya plaintext terenkripsi yang berubah; VAPID,
`aes128gcm` (RFC 8291), langganan, pengikatan penerima, dan antrean tidak
berubah (vektor uji RFC 8291 tetap sama).

| Format        | JSON plaintext                                                                             |
| ------------- | ------------------------------------------------------------------------------------------ |
| `legacy`      | `{ title, body, targetPath?, data? }` (bawaan)                                             |
| `declarative` | `{ web_push: 8030, notification: { title, body?, navigate, silent: false, tag?, data? } }` |

- **Saklar:** `PUSH_PAYLOAD_FORMAT=legacy|declarative`, bawaan `legacy`; nilai
  tak dikenal berperilaku seperti `legacy` dan `config:validate` menolaknya.
  `declarative` juga mewajibkan `APP_URL` berskema `https:` tanpa kredensial
  (ditegakkan `config:validate`), karena `navigate` adalah **URL https absolut
  pada origin publik terkonfigurasi**.
- **`navigate` diturunkan, tidak dipercaya:** produsen menggabungkan
  `targetPath` same-origin yang sudah tervalidasi di antrean ke origin `APP_URL`
  (bukan header Host permintaan). Off-origin, protocol-relative (`//`, `/\`),
  `javascript:`/`data:` dan skema lain gagal-tertutup ke `<origin>/admin`.
  Service worker memeriksa ulang origin saat notifikasi tiba dan saat klik.
- **Ukuran/isi:** judul wajib tidak kosong (jika tidak, pesan dikirim sebagai
  legacy), judul dibatasi 120 dan isi 240 karakter, seluruh payload 2.048 byte
  (jika lebih, legacy). Payload legacy mendapat batas judul/isi yang sama dan selalu diperkecil agar muat satu record (`data`, lalu `targetPath`, dibuang sebagai langkah terakhir); `tag` dibatasi 64. Tidak ada tambahan selain `title`/`body`; ikon/gambar
  tidak diambil dari payload.
- **Jangan ada PII atau rahasia di `targetPath`:** ia ikut dalam URL
  notifikasi (termasuk query string), dibatasi 512 karakter, dan browser yang
  merender push deklaratif secara native melewati pemeriksaan klik service
  worker, sehingga validasi di produsen adalah satu-satunya penjaga bagi mereka.
- **Service worker (pembaca ganda):** `public/push-sw.js` membaca kedua bentuk
  apa pun saklarnya dan menampilkan tepat **satu** notifikasi per event `push`
  (`tag` dari `tag` atau `data.category` menggabungkan). Browser yang merender
  bentuk deklaratif secara native tidak membangunkan worker, sehingga tidak ada
  banner kedua. Payload rusak, kosong, atau bukan JSON menampilkan fallback
  generik. Scope, path registrasi, dan kebijakan cache tidak berubah.

### Rollout (dua tahap)

1. **Rilis dengan `PUSH_PAYLOAD_FORMAT` tidak diset.** Produsen tetap mengirim
   legacy; worker baru tersebar lewat pembaruan service worker biasa
   (`/push-sw.js` disajikan `max-age=0`, sehingga browser memvalidasi ulang pada
   pemeriksaan pembaruan berikutnya, paling lama sekitar 24 jam, atau pada
   navigasi berikutnya).
2. **Setelah minimal satu siklus pembaruan service worker penuh (24 jam, batas atas pemeriksaan pembaruan browser) sejak deploy**, set `PUSH_PAYLOAD_FORMAT=declarative`
   pada aplikasi dan `push:dispatch` (ada di `ops/awcms-jobs.env-allowlist`) lalu
   restart. Verifikasi dengan `bun run config:validate`, lalu kirim uji dari
   `/admin/push-notifications` ke perangkat Chromium dan PWA iOS/iPadOS 18.4+
   terpasang. Penerimaan HTTP oleh provider bukan tampilan di perangkat:
   pastikan banner muncul di perangkat.

Worker lama yang belum punya pembaca ganda akan membaca pesan deklaratif sebagai
payload tanpa judul dan menampilkan fallback generik; karena itu tahap 2
menunggu penyebaran dan legacy tetap bawaan.

### Rollback

Set `PUSH_PAYLOAD_FORMAT=legacy` (atau hapus) lalu restart aplikasi dan
`push:dispatch`. Tidak ada langganan, baris antrean, atau migrasi yang
terlibat, tidak perlu subscribe ulang, dan pesan yang sedang berjalan dalam
bentuk apa pun tetap terbaca oleh worker pembaca ganda. **Jangan** menurunkan
berkas worker ke rilis yang tidak bisa membaca bentuk deklaratif selama
produsen masih memancarkannya.

## Admin yang dapat dipasang di iPhone/iPad (Issue #1105)

Web Push di iOS/iPadOS 16.4+ hanya dikirim ke aplikasi web yang **ditambahkan ke
Layar Utama dan dibuka dari ikonnya**. Tab Safari tidak memiliki `PushManager`,
sehingga tidak pernah dapat menerima push latar belakang. Perubahan ini membuat
admin dapat dipasang dan memandu pengguna ke sana; ia **tidak menambah pengirim,
service worker, atau origin push baru** -- pengiriman tetap jalur Bun/VAPID
ADR-0074.

### Yang dikirim

- **Satu manifest tingkat origin**, `GET /manifest.webmanifest`
  (`src/pages/manifest.webmanifest.ts`, kontrak di
  `src/lib/pwa/web-app-manifest.ts`): `id`, `start_url`, dan `scope` semuanya
  `/admin/`, `display: standalone`. Nama, nama pendek, dan warna berasal dari
  konfigurasi deployment (`PWA_APP_NAME`, `PWA_APP_SHORT_NAME`,
  `PWA_THEME_COLOR`, `PWA_BACKGROUND_COLOR`; bawaan `AWCMS Admin`/`AWCMS`/
  `#2563eb`/`#ffffff`), **tidak pernah** dari `Host` permintaan atau baris
  tenant. Cache `public, max-age=3600, must-revalidate` -- manifest boleh
  menyegarkan diri dan bukan `immutable`.
- **Ikon self-hosted** di `public/icons/` (192, 512, maskable 512, dan
  `apple-touch-icon` 180), dibangkitkan secara deterministik oleh
  `bun run pwa:icons:generate`. Ikon ini penanda netral sementara; ganti keempat
  PNG (nama dan ukuran sama) untuk karya seni deployment.
- **Tautan head hanya dari layout admin bersama**
  (`src/layouts/AdminLayout.astro`): `rel=manifest`, `rel=apple-touch-icon`,
  `theme-color`, `apple-mobile-web-app-*`. CSP tidak berubah (`manifest-src` dan
  `img-src` jatuh ke `'self'`); `public/push-sw.js`, path, dan scope-nya tidak
  disentuh.
- **Panduan di `/admin/push-notifications`**: deteksi kapabilitas
  (`serviceWorker` + `PushManager` + `Notification`) dan deteksi mode mandiri
  (`display-mode: standalone` / `navigator.standalone`); user agent hanya
  dipakai memilih antara "pasang dulu" dan "peramban ini tidak bisa". Status:
  `ready` (tombol ditawarkan; izin diminta **hanya saat diklik**), `denied`
  (penjelasan, tombol ditarik -- peramban tidak akan meminta lagi sehingga tidak
  ada loop ulang), `ios-install` (Tambah ke Layar Utama, buka dari ikon, lalu
  aktifkan), `ios-update` (terpasang tetapi OS di bawah 16.4), `unsupported`.
  Teks tersedia dalam bahasa Inggris dan Indonesia; panel adalah wilayah
  `aria-live`.

### Identitas dan tenancy

Identitas terpasang adalah `<origin>/admin/`. Dua deployment tidak pernah
bertabrakan (origin berbeda). Dalam satu deployment seluruh tenant berbagi satu
origin admin dan karenanya satu aplikasi terpasang; tenant ditentukan sesi yang
masuk. Manifest per tenant **di luar cakupan** dan menjadi ekstensi masa depan
lewat `tenant_domain` (resolusi dari domain primer terverifikasi, `id` per
origin). Mengganti origin (domain, protokol, atau port baru) membuat aplikasi
terpasang dan langganan push **yang berbeda**: ikon Layar Utama lama harus
dihapus, yang baru ditambahkan, dan notifikasi diaktifkan ulang.

### Pasang, copot, reset izin (panduan operator/pengguna)

- Pasang (iOS/iPadOS 16.4+): Safari -> Bagikan -> Tambah ke Layar Utama ->
  Tambah; buka dari ikon; masuk; `/admin/push-notifications` -> Aktifkan di
  perangkat ini.
- Copot: tekan lama ikon -> Hapus App. Bila bisa, pakai "Matikan di perangkat
  ini" lebih dulu; baris server yang basi dinonaktifkan otomatis saat layanan
  push melaporkan langganan sudah hilang.
- Reset izin: Pengaturan iOS -> Notifikasi -> aplikasi tersebut (atau Pengaturan
  -> Apps -> Safari -> Lanjutan -> Data Situs Web untuk tab peramban). Setelah
  ditolak, halaman tidak dapat meminta lagi.
- Persetujuan/privasi: izin diminta hanya setelah ketukan yang disengaja; teks
  notifikasi tidak memuat data pribadi sensitif (aturan payload ADR-0074);
  langganan adalah data pribadi menurut UU PDP 27/2022 dan ditangani siklus hidup
  langganan yang ada. Tidak ada klaim kepatuhan tanpa bukti.
- Online-first / offline-LAN: push memerlukan keterjangkauan internet ke layanan
  push. Deployment offline/LAN menampilkan push sebagai tidak tersedia dan tidak
  menjanjikan apa pun; OS dapat menunda atau membuang notifikasi.

### Keterbatasan yang harus diverifikasi di perangkat

`scope` adalah `/admin/` sesuai keputusan, sementara halaman login (`/login`)
berada di luarnya. Membuka aplikasi terpasang saat belum masuk mengalihkan ke
`/login`; iOS dapat menampilkan navigasi itu dengan bilah peramban dalam-aplikasi.
Konfirmasi saat UAT apakah ini dapat diterima atau scope perlu diperlebar
(keputusan terpisah).

### Status UAT: TERTUNDA (manusia)

Kemampuan dipasang di iOS/iPadOS 16.4+ nyata, Chrome Android/desktop, dan macOS
**belum** diuji. Catat perangkat, versi OS, tangkapan layar, dan langkah repro di
sini sebelum deploy, dan pisahkan **penerimaan langganan** (baris server dibuat)
dari **tampilan di perangkat** (notifikasi benar-benar muncul). Jangan deploy
tanpa bukti itu.
