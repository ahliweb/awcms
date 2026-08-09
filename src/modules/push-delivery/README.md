# `push_delivery`

Outbox transaksional untuk notifikasi push perangkat (epic #463, ADR-0074).

Modul ini **mengirimkan** notifikasi yang orang lain putuskan untuk dikirim. Ia tidak punya pendapat tentang apa yang layak dinotifikasikan — sama seperti `email`, yang juga infrastruktur generik dan bukan fitur "kirim struk".

## Kenapa outbox KEDUA

`awcms_domain_events` sudah punya dispatcher, DLQ, dan replay, jadi menggantungkan push padanya adalah langkah pertama yang wajar. Ia tidak bisa:

- `domain-event-runtime/application/dispatch-domain-events.ts` menyatakan di header-nya bahwa CLAIM + handler + FINALIZE berjalan dalam **satu** transaksi, **sengaja**, dan handler dipanggil di dalamnya;
- provider push adalah panggilan HTTP eksternal, dan **ADR-0006 melarangnya di dalam transaksi DB**;
- `broker-adapter-port.ts` sudah menuliskan konsekuensinya di muka — consumer out-of-transaction "would need the lease-based shape back" — dan port itu sendiri nol pemanggil.

Yang membuat ini perlu ditulis, bukan sekadar diketahui: **tidak ada gerbang yang akan menangkap kesalahannya.** Consumer FCM yang didaftarkan dengan cara paling wajar akan menahan koneksi pool selama round-trip ke Google sambil memegang row lock, dan mengubah tiap kegagalan jaringan menjadi rollback event — sehingga event yang **sudah** terkirim dikirim ulang — dengan seluruh 37 gerbang hijau.

## Bentuknya

Tiga fase, disalin dari `email/application/email-dispatch.ts`:

1. **CLAIM** — satu transaksi pendek membalik baris `queued`/`retry_wait` yang jatuh tempo menjadi `sending` (`FOR UPDATE SKIP LOCKED`), memakai ulang `next_attempt_at` sebagai batas-waktu klaim. Tidak ada kolom lease baru. Lease-nya **dibaca**, bukan hanya ditulis: baris `sending` yang lease-nya kedaluwarsa diklaim ulang oleh pass berikutnya, dan itulah yang mencegah worker yang mati di tengah jalan meninggalkan baris di limbo permanen.
2. **SEND** — memanggil `PushProvider` **di luar** transaksi apa pun.
3. **FINALIZE** — satu transaksi pendek per baris: `sent`, atau `retry_wait` dengan backoff, atau `failed` terminal. Tiap percobaan tercatat.

Trade-off yang diterima sama dengan kedua saudaranya: crash di jendela sempit setelah provider menerima tetapi sebelum FINALIZE bisa menghasilkan satu notifikasi ganda. Untuk push itu satu banner berulang — jelas lebih baik daripada notifikasi yang tersangkut selamanya.

## Yang dilakukan dispatcher ini dan tidak dilakukan milik email

Ia bisa **menonaktifkan targetnya**. Push service yang menjawab `404`/`410`, atau FCM yang menjawab `UNREGISTERED`, bukan kegagalan kirim dan bukan gangguan provider — itu langganan yang melaporkan dirinya mati. `subscriptionGone` karena itu cabang hasil tersendiri, bukan `retryable: false`: melipatnya ke sana akan meninggalkan endpoint nisan yang memungut satu kegagalan permanen per pesan, selamanya.

## Endpoint adalah kredensial

Endpoint Web Push dan token registrasi FCM keduanya bearer-ish. Keduanya memakai disiplin tiga kolom yang sama dengan alamat email (`endpoint` / `endpoint_hash` / `endpoint_masked`), dan kolom mentahnya disebut di **satu** berkas: `application/subscription-directory.ts`. Aturan itu bisa dipegang justru karena hanya satu berkas yang menyebutnya.

## Perilaku saat mati

Tanpa `PUSH_ENABLED=true`, `dispatchPushQueue` **tidak mengklaim satu baris pun** dan tidak pernah menyentuh provider. Itu aturan feature-flag yang sudah dipakai `email`, dan yang membuat `bun run push:dispatch` aman dijadwalkan di profil deployment mana pun termasuk offline/LAN.

`bun run push:queue:purge` sebaliknya berjalan **tanpa memedulikan** flag itu: deployment yang mematikan push tetap punya baris dari masa ia menyala, dan justru itu baris yang tak akan pernah dibersihkan apa pun.

## Retensi: `delegated`, bukan `generic`

`HighVolumeTableDescriptor` membawa `cursorColumn` dan **tidak** membawa predikat status, jadi executor generik menghapus murni berdasarkan umur. Diarahkan ke sebuah antrean, itu menghapus baris yang **masih menunggu dikirim** — dan lenyapnya terlihat persis seperti housekeeping yang berhasil. Setiap DELETE di `application/push-queue-purge.ts` menyebut status terminal secara eksplisit, dan cursor-nya `updated_at` (saat baris berhenti bergerak), bukan `created_at`.

Ketiganya dihapus dalam urutan FK — attempts, messages, subscriptions — karena masing-masing anak dari berikutnya.

## Adapter FCM HTTP v1

`PUSH_PROVIDER=fcm` — server → Google, untuk klien **native** Android/iOS. Ia tidak pernah menyentuh browser, jadi nol byte di anggaran aset klien dan nol origin CSP baru; itulah sebabnya ADR-0074 menahan FCM HTTP v1 sambil menolak SDK FCM Web.

**Tanpa dependensi.** Assertion service-account (RFC 7523) ditandatangani RS256 lewat `crypto.subtle`, meniru preseden `src/lib/auth/jwt-verify.ts` yang menolak menambah `jose` untuk verifikasi JWT. Access token di-cache per-proses, dikunci `client_email`, dan tidak pernah ditulis ke Redis/Postgres — ia kredensial bearer hidup, dan menyimpannya at-rest demi menghemat satu panggilan HTTP per jam adalah pertukaran yang salah arah.

**Kredensial wajib base64** (`PUSH_FCM_CREDENTIALS_BASE64`): `config:validate` mem-parse `.env` baris demi baris, dan `private_key` sebuah service account adalah blok PEM multi-baris — ditempel mentah, ia terpotong diam-diam di baris pertama dan kegagalannya muncul saat kirim pertama, bukan saat boot. Parser-nya **pure** dan dipakai `config:validate` maupun adapter, jadi validator tak bisa berbeda pendapat dengan benda yang ia validasi.

**Tiga hal yang halus dan sengaja:**

- **Token mati TIDAK memicu circuit breaker.** Antrean normal membawa ribuan token basi; kalau itu dihitung sebagai kegagalan provider, satu batch registrasi lama akan menghentikan pengiriman ke setiap perangkat sehat — dan gejalanya ("push berhenti") menunjuk ke FCM. Hanya sinyal tentang LAYANAN yang memicunya: kegagalan transport, 429, dan 5xx.
- **Kode error dibaca sebelum status.** FCM meng-overload status dua arah, dan 401 adalah kasus paling tajam: ia sekaligus "access token kadaluwarsa" (tanpa kode) dan `THIRD_PARTY_AUTH_ERROR` (kredensial APNs/web yang harus diperbaiki operator). Versi pertama fungsi ini memeriksa status lebih dulu, dan test menangkapnya.
- **401 disegarkan tepat SEKALI.** Token yang kadaluwarsa di tengah batch berharga satu panggilan tambahan, bukan seluruh sisa batch; token baru yang tetap ditolak adalah masalah kredensial dan berhenti di situ.

`healthCheck` membuktikan **kredensialnya**, bukan jalur kirim — mengirim notifikasi nyata butuh token perangkat nyata, dan mengarang satu akan dijawab `UNREGISTERED`, yaitu FCM sehat yang melapor gagal.

## Adapter Web Push (VAPID)

`PUSH_PROVIDER=web_push` — RFC 8030 + 8291 + 8292, untuk **browser**. Inilah yang ADR-0074 pilih sebagai ganti SDK FCM Web, dan alasannya terukur: SDK itu 45.041 B melawan plafon 21.000 B per berkas, **dan** menuntut tiga origin pihak ketiga di CSP yang sama sekali tidak punya. `PushManager.subscribe()` adalah API browser, bukan `fetch` dari skrip halaman, jadi jalur ini berharga **nol byte klien dan nol origin CSP**. Semua yang ada di sini berjalan di sisi server.

**Enkripsinya diverifikasi terhadap vektor RFC, bukan round-trip.** Ini bagian paling berisiko di seluruh program push, dan alasannya perlu disebut: push service **tidak memvalidasi payload**. Ia meneruskan ciphertext ke browser, dan browser yang tak bisa mendekripsinya membuang notifikasi itu **diam-diam**. Key schedule yang salah karena itu menghasilkan sistem yang menerima setiap pesan, mencatat setiap kirim sebagai sukses, dan tidak mengantarkan apa pun — tanpa satu error pun di mana pun.

Test round-trip tak bisa menangkap itu: ia membuktikan encryptor dan decryptor sepakat, bukan bahwa keduanya cocok dengan spesifikasi. Jadi `tests/push-web-push-adapter.test.ts` mereproduksi contoh kerja RFC 8291 sendiri — **setiap nilai antara yang diterbitkan** (`ecdh_secret`, `PRK_key`, `IKM`, `PRK`, `CEK`, `NONCE`) **dan body akhirnya, byte per byte**. Angka-angka itu datang dari pihak ketiga; mereproduksinya adalah bukti interoperabilitas.

HKDF ditulis di atas HMAC `crypto.subtle` alih-alih memakai `deriveBits({name:"HKDF"})`, justru supaya nilai-nilai antara itu **bisa diamati** — `deriveBits` melakukan extract-then-expand sebagai satu operasi buram.

**Detail yang halus:** pasangan kunci ECDH server **ephemeral per pesan** (desain RFC, bukan optimasi yang belum dikerjakan — satu pasangan yang dipakai ulang membuat setiap notifikasi ke satu pelanggan berbagi key schedule); `aud` VAPID adalah **origin** endpoint, bukan endpoint-nya (menandatangani endpoint penuh adalah kesalahan klasik yang gejalanya 401 dan terbaca seperti masalah kunci); tanda tangan ES256 adalah **r||s mentah** 64 byte, bukan DER.

Token VAPID di-cache per **origin**, jadi satu batch 500 pelanggan Firefox berharga satu tanda tangan, bukan 500.

`bun run push:vapid:generate` mencetak satu pasangan kunci dalam bentuk persis yang `.env` inginkan — beserta peringatan bahwa **merotasinya tidak me-re-key langganan yang ada**, melainkan membuat semuanya permanen tak-terkirimi sampai penggunanya berlangganan ulang.

## Permukaan HTTP

Dua kelas endpoint, dan pembelahannya adalah keputusan otorisasi — bukan penataan berkas.

**Perangkat SENDIRI itu self-service** (`defineSelfServiceTenantRoute`, ADR-0049 §7). `GET|POST /api/v1/push/subscriptions` dan `DELETE …/{id}` tidak memeriksa permission apa pun, karena subjeknya adalah pemanggil: jawaban atas "boleh saya berlangganan di browser ini?" adalah "Anda sedang memegang sesinya". Rute-rute itu **tidak pernah menerima `tenantUserId`** — ia datang dari sesi yang di-resolve dan dari tidak ada tempat lain, jadi tak ada id untuk dibandingkan dengan apa pun.

Menciptakan `push_delivery.subscriptions.create` justru akan menjadi jebakan latent-authz yang sudah pernah kena di repo ini: aksi yang tak di-seed role mana pun menolak **semua orang termasuk owner**, sementara kode pemanggilnya terbaca seolah tergerbangi dengan benar. Notifikasi push adalah untuk pengguna biasa; tembok permission di depannya adalah tembok di depan fiturnya.

**Yang menyentuh baris orang lain, atau membuat deployment mengirim trafik nyata, lewat chokepoint.** Tiga permission, dan itu seluruhnya: `diagnostics.read`, `messages.cancel`, `diagnostics.check`.

Kepemilikan pada pencabutan ditegakkan **di dalam `WHERE`**, bukan lewat baca-lalu-bandingkan: tak ada jendela di antara keduanya, dan tak ada keputusan yang harus diambil tentang baris yang sudah terbaca tapi tak boleh disentuh — persis cara sebuah oracle keberadaan lahir tanpa sengaja. "Tidak ada", "milik orang lain", dan "sudah dicabut" menjawab **404** yang sama.

Pencabutan oleh pengguna juga **menghancurkan endpoint tersimpan**, tidak seperti `disablePushSubscription` yang menyimpannya sebagai bukti. Bedanya: yang satu mencatat apa kata push service tentang endpoint yang sudah mati; yang ini mencatat apa kata ORANGNYA tentang endpoint yang mungkin masih hidup sempurna. Baris tetap ada (operator masih perlu tahu perangkat itu dicabut dan kapan), kredensialnya tidak.

`endpoint = EXCLUDED.endpoint` di upsert adalah pasangan wajibnya, dan tanpa pemikiran itu ia terlihat seperti baris mubazir: target konflik adalah HASH dari kolom itu sendiri, jadi di setiap kasus biasa nilainya identik. Ia ada untuk satu kasus — perangkat yang berlangganan ulang setelah dicabut akan kembali `active` sambil masih menunjuk nisan: terlihat sehat di konsol, tak terkirimi pada kenyataannya.

### Probe kirim

`POST /api/v1/push/test` mengirim ke perangkat **pemanggil sendiri**, dengan judul dan isi **tetap**, dan tidak menerima parameter penerima. Itu batas keamanan, bukan penyederhanaan: endpoint uji yang menerima penerima adalah permukaan notifikasi-sembarang — teks bermerek sistem, dipilih pengirim, dengan target klik, mendarat di lock screen kolega mana pun. Isi notifikasi adalah teks paling dipercaya yang bisa ditaruh aplikasi ini di depan seseorang.

Alasan probe-nya perlu ada sama sekali: push gagal di tempat yang tak bisa dilihat apa pun di sistem ini — pasangan kunci VAPID yang tak cocok dengan yang dipakai browser saat berlangganan, service worker yang terdaftar di scope salah, sistem operasi yang diam-diam menahan izin. Ketiganya menghasilkan antrean yang terkuras bersih dan perangkat yang tak menampilkan apa-apa.

## Yang BELUM ada

- **Service worker dan layar admin.** Endpoint-nya sudah ada; konsol yang menggerakkannya belum, dan karena itu modul ini tetap `experimental` — ADR-0021 kriteria 1 menolak modul `active` tanpa layar admin, tanpa pengecualian. Tiga permission-nya sementara tercatat di ledger `NOT_YET_SCREENED`.
- **FCM Web (SDK browser).** Ditolak, dengan angkanya, di ADR-0074 §Yang DITOLAK.
