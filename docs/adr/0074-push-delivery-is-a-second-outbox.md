# ADR-0074 — Push notification adalah outbox KEDUA, bukan consumer domain-event

- **Status:** Accepted
- **Tanggal:** 2026-08-10
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #465 (epic #463), [ADR-0006](0006-offline-first-sync-outbox.md) (larangan panggilan jaringan di dalam transaksi), [ADR-0029](0029-deployment-profile-aware-turnstile-bot-protection.md) (kontrak "LAN/offline = nol origin pihak ketiga"), [ADR-0037](0037-data-lifecycle-module-admission.md) (kerangka retensi), [ADR-0072](0072-decision-log-retention-and-projection-authority.md) (preseden `GRANT DELETE` untuk purge worker)

## Konteks

Analisis tumpukan notifikasi (Bun + FCM HTTP v1 + FCM Web + SSE + PostgreSQL Outbox) terhadap repo ini menemukan bahwa empat dari lima komponennya cocok, dan bahwa jalur yang paling **terlihat** benar untuk memasangnya justru yang salah.

`awcms_domain_events` sudah ada, sudah punya dispatcher, sudah punya DLQ, dan sudah punya replay. Menggantungkan pengiriman push padanya adalah langkah pertama yang wajar bagi siapa pun. Ia tidak bisa, dan alasannya tertulis di dalam berkasnya sendiri:

- `domain-event-runtime/application/dispatch-domain-events.ts` menyatakan di header-nya bahwa CLAIM + handler + FINALIZE berjalan dalam **satu** transaksi, **sengaja**, karena consumer bawaannya same-process tanpa I/O eksternal. Handler dipanggil di dalam transaksi itu.
- Provider push adalah panggilan HTTP ke Google atau ke endpoint vendor browser. **ADR-0006 melarang panggilan jaringan di dalam transaksi DB.**
- `domain-event-runtime/infrastructure/broker-adapter-port.ts` sudah menuliskan konsekuensinya di muka: consumer out-of-transaction "would need the lease-based shape back". Port itu sendiri **kode mati** — `getDomainEventBrokerAdapter()` punya nol pemanggil di seluruh `src/`, `scripts/`, dan `tests/`.

Yang membuat ini layak sebuah ADR dan bukan sekadar komentar: **tidak ada gerbang yang akan menangkapnya.** Tidak ada cek yang melarang `fetch` di dalam `sql.begin`; ADR-0006 ditegakkan oleh review. Sebuah consumer FCM yang didaftarkan dengan cara paling wajar akan menahan satu koneksi pool selama round-trip ke Google sambil memegang row lock, mengubah tiap kegagalan jaringan menjadi rollback event sehingga event yang **sudah terkirim** dikirim ulang, dan melakukannya di jalur yang `getProviderCircuitBreaker` tidak lindungi — dengan seluruh 37 gerbang hijau.

## Keputusan

**Push delivery mendapat outbox-nya sendiri**, modul `push_delivery`, dengan pola lease yang sudah terbukti tiga kali di repo ini (`email-dispatch.ts`, `object-dispatch.ts`, `purge-queue.ts`): klaim `FOR UPDATE SKIP LOCKED`, lease memakai ulang `next_attempt_at` tanpa kolom baru, kirim **di luar** transaksi, finalize per baris.

Tiga tabel (`sql/093`): langganan perangkat, antrean, dan buku percobaan kirim. Tidak ada tabel `push_recipients` — satu baris antrean **adalah** satu unit pengiriman, bentuk yang sama dipakai `awcms_email_messages`.

### Yang ikut diputuskan, dan kenapa

**1. Endpoint dan token diperlakukan sebagai kredensial, bukan alamat.** Endpoint Web Push dan token registrasi FCM keduanya bearer-ish: pemegangnya bisa mendorong notifikasi ke perangkat itu sampai dirotasi. Keduanya mendapat disiplin tiga kolom yang sama dengan alamat email (`endpoint` / `endpoint_hash` / `endpoint_masked`), dan kolom mentahnya disebut di **satu** berkas saja.

Ini juga sebabnya token perangkat tidak akan pernah bisa menumpang domain event walau ada yang ingin: `domain-event-runtime/domain/envelope.ts` menolak payload yang key-nya memuat substring `token`. Event membawa _siapa_ dan _apa_; resolusi ke endpoint terjadi di modul ini.

**2. `subscriptionGone` adalah cabang hasil tersendiri, bukan `retryable: false`.** Push service yang menjawab `404`/`410`, atau FCM yang menjawab `UNREGISTERED`, bukan kegagalan kirim dan bukan gangguan provider — itu langganan yang melaporkan dirinya mati. Melipatnya ke dalam "gagal, jangan ulangi" akan meninggalkan endpoint nisan di tabel yang memungut satu kegagalan permanen per pesan, selamanya. Dispatcher menonaktifkan langganannya.

**3. Retensi memakai `delegated`, bukan `generic`.** `HighVolumeTableDescriptor` membawa `cursorColumn` dan **tidak** membawa predikat status, jadi executor generik menghapus murni berdasarkan umur. Diarahkan ke sebuah **antrean**, itu menghapus baris yang masih menunggu dikirim: pesan yang tertahan di belakang gangguan provider lebih lama dari jendela retensi akan lenyap diam-diam, dan lenyapnya akan terlihat persis seperti housekeeping yang berhasil. Setiap DELETE di `push-queue-purge.ts` karena itu menyebut status terminal secara eksplisit, dan cursor-nya `updated_at` — saat baris berhenti bergerak — bukan `created_at`, yang akan membuat pesan yang lama di-retry tampak lebih tua dari sebenarnya.

Ketiga tabel membawa deskriptor sejak hari pertama. Tidak ada pilihan lain: `TABLES_PREDATING_THE_RULE` sudah tertutup untuk tabel baru dan `BOUNDED_BY_DESIGN` kosong. Issue #468 mencatat bahwa enam tabel outbox yang **sudah ada** belum punya — modul ini tidak boleh ikut bergabung ke daftar itu.

**4. `targetPath` hanya boleh path same-origin, divalidasi sebelum baris ditulis.** Notifikasi push dirender browser di luar halaman, dan klik-nya menavigasi ke mana pun payload berkata. Baris antrean yang bisa membawa URL absolut adalah open-redirect tersimpan dengan notifikasi sistem sebagai kendaraannya — datang membawa nama dan ikon origin ini sendiri, yang jauh lebih baik sebagai primitif phishing daripada tautan di dalam halaman. Validasinya positif (allow-list + round-trip `new URL`), bukan deny-list, karena deny-list lengkap hanya sampai kuirk parser URL berikutnya.

**5. Kredensial per-DEPLOYMENT, tidak pernah per-tenant.** Service account FCM milik satu proyek Firebase; pasangan kunci VAPID mengidentifikasi satu application server. Memodelkannya sebagai konfigurasi tenant berarti admin tenant A bisa memasukkan kunci yang membuat deployment ini berbicara sebagai orang lain.

Apa pun yang berbentuk JSON wajib tiba **base64**: `scripts/validate-env.ts` mem-parse `.env` baris demi baris dengan parser sendiri, jadi nilai multi-baris terpotong diam-diam — dan JSON service-account FCM multi-baris dalam bentuk aslinya.

## Yang DITOLAK

**FCM Web (SDK `firebase/messaging` di browser).** Diukur, bukan ditaksir: `firebase/app` + `firebase/messaging` = **45.041 B** setelah `bun build --minify` versus plafon **21.000 B** per berkas, dan total klien akan menjadi 185.049 B versus plafon 180.000 B. Sisa ruang hari ini hanya 39.992 B. Gerbang itu ada di rantai `build`, yang ikut berjalan di dalam pembangunan image produksi — merahnya memblokir rilis.

Jalur CDN juga tertutup: CSP repo ini punya enam direktif tanpa `connect-src` sama sekali, dan `tests/security-headers-csp.test.ts` mengunci daftarnya dengan `toEqual` serta meng-assert nol origin pihak ketiga saat Turnstile mati — realisasi kontrak ADR-0029 "LAN/offline = nol origin pihak ketiga".

Dan ia **redundan**. `PushManager.subscribe()` adalah API browser, bukan `fetch` dari JS halaman, jadi Web Push standar dengan VAPID memberi hasil yang sama dengan nol byte SDK, nol origin `script-src` baru, nol origin `connect-src` baru, dan nol `worker-src` baru (ia fallback ke `default-src 'self'`). FCM HTTP v1 tetap dipakai untuk aplikasi native — itu murni server → Google dan tidak menyentuh CSP.

Ditulis di sini supaya orang berikutnya yang mengusulkannya membaca angkanya lebih dulu.

**Memperluas `awcms_domain_events` agar bisa memanggil consumer di luar transaksi.** Itu mengubah model eksekusi yang delapan consumer lain sudah andalkan, demi satu consumer yang butuh bentuk berbeda. Outbox kedua memisahkan risikonya sepenuhnya: kegagalan push tidak bisa menyentuh pengiriman domain event, dan sebaliknya.

**Mendaftarkan `broker-adapter-port.ts`.** Ia nol pemanggil dan tidak bisa bekerja untuk kasus ini menurut docblock-nya sendiri. Mendaftarkan adapter di sana akan terlihat seperti integrasi sambil tidak melakukan apa pun.

## Konsekuensi

Modul mendarat **inert**: tanpa `PUSH_ENABLED=true`, `dispatchPushQueue` tidak mengklaim satu baris pun — aturan feature-flag yang sudah dipakai `email`, dan yang memastikan deployment yang tak pernah menyalakan push bisa menjadwalkan job-nya selamanya tanpa menumpuk baris terlantar.

Adapter nyata (FCM HTTP v1 dan Web Push/VAPID), permukaan HTTP, service worker, dan konsol `/admin/push-notifications` mendarat lewat #466 dalam empat PR terpisah. Modul mulai `experimental` dan menjadi `active` hanya setelah konsolnya ada — ADR-0021 kriteria 1 menolak modul `active` tanpa layar admin, tanpa pengecualian, dan status jujur dipilih di atas carve-out selama tiga PR itu.

Kesenjangan yang dicatat di sini saat ADR ditulis — `enqueuePushToRecipients` tanpa pemanggil produksi — **ditutup** oleh `POST /api/v1/push/test`, probe kirim ke perangkat pemanggil sendiri. Ia dipilih sebagai pemanggil pertama karena push gagal di tiga tempat yang tak bisa dilihat apa pun di sistem ini: pasangan kunci VAPID yang tak cocok dengan yang dipakai browser saat berlangganan, service worker yang terdaftar di scope salah, dan izin OS yang ditahan diam-diam. Ketiganya menghasilkan antrean yang terkuras bersih dan perangkat yang tak menampilkan apa-apa.

**Angka klien, disebut ulang supaya perbandingan §Yang DITOLAK tetap jujur.** "Nol byte SDK" tetap benar dan itu memang klaimnya, tetapi sisi klien tidak gratis: service worker (5.515 B, disalin apa adanya dari `public/` — sebuah berkas di sana tidak pernah diminifikasi, dan tak bisa dibundel karena registrasi dikunci pada URL skrip) plus skrip pendaftaran halaman (4.659 B, terbundel dan terminifikasi) = **10.174 B**. SDK FCM Web yang ditolak berharga **91.333 B** untuk pekerjaan yang sama, menembus plafon per-berkas 21.000 B pada kedua berkasnya, dan menuntut tiga origin pihak ketiga. Selisihnya 9×, dan janji CSP ADR-0029 tetap utuh: `worker-src` jatuh ke `default-src 'self'`, service worker-nya same-origin, dan tak ada satu pun direktif yang berubah.
