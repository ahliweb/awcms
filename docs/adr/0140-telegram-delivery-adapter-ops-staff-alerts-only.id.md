🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0140-telegram-delivery-adapter-ops-staff-alerts-only.md)

<!-- i18n-source-hash: sha256:383ca3bf52390cbc62fd3c410529da1f2a1f9431f645dafc668ee704806e42aa -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0140 — Adapter pengiriman Telegram yang opsional dan mati secara default diterima hanya untuk peringatan operasional dan staf

- **Status:** Diterima
- **Tanggal:** 2026-10-12
- **Pengambil keputusan:** ahliweb (pemilik produk)
- **Menyelesaikan:** klausul "Telegram ditunda, belum diputuskan" pada [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.id.md) §7 dan keputusan pemilik hilir O10 (diterima sebagai adapter opsional yang mati secara default pada 10 Okt 2026, kelas pesan dibiarkan terbuka)
- **Memperluas:** [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.id.md) §3 (satu antrean per kanal), §5 (aturan provider), §7 (batasan tercatat yang menjadi titik tolak ADR ini); [ADR-0074](0074-push-delivery-is-a-second-outbox.id.md) (kredensial per deployment); [ADR-0137](0137-payout-account-encryption-at-rest-and-keyed-hashing.id.md) §2 (helper enkripsi field bersama dan key ring); [ADR-0139](0139-cross-channel-notification-orchestration-not-admitted.id.md) (tanpa fasad, tanpa fallback)
- **Terkait:** Issue #964 (ADR ini); issue implementasi #965; epik hilir `ahliweb/awcms-one` #280 item 32; [ADR-0006](0006-offline-first-sync-outbox.id.md), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.id.md), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md), [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.id.md)

**Hanya dokumen.** ADR ini tidak menambah atau mencadangkan kode modul, migrasi, path OpenAPI, maupun kanal AsyncAPI. Implementasinya adalah issue #965, yang lingkup dan kriteria penerimaannya diturunkan dari ADR ini.

## Konteks

ADR-0133 §7 mencatat, tanpa memutuskan, apa yang harus dihormati adapter Telegram: mati secara default, otorisasi chat yang eksplisit, tidak pernah menjadi fallback untuk payroll atau data pribadi, dan jawaban atas pertanyaan kebocoran kredensial dan chat grup. Pemilik lalu menerima Telegram (O10) tetapi membiarkan **kelas pesan** terbuka. Pemilik produk kini telah memutuskannya: **hanya peringatan operasional dan staf**.

Fakta yang membentuk keputusan:

- Bot API Telegram mengenali penerima lewat `chat_id` numerik. Bot hanya dapat mengirim ke pengguna setelah pengguna itu memulai percakapan dengannya, dan menerima setiap pesan dari grup mana pun tempat ia ditambahkan. Tidak ada pemetaan nomor telepon ke chat, sehingga berbeda dari WhatsApp, alamatnya tidak dapat diperoleh dari data yang sudah dimiliki sistem; ia harus **diberikan oleh penerima**, yang menjadi masalah pengikatan di bawah.
- Token bot adalah rahasia bearer yang juga muncul **di path URL permintaan** (`https://api.telegram.org/bot<token>/<method>`), sehingga pencatatan URL biasa membocorkannya.
- Telegram adalah layanan pesan konsumen. Pesan tidak terenkripsi ujung-ke-ujung secara default (chat bot adalah cloud chat), disimpan oleh provider, dan dapat diteruskan, di-screenshot, serta disinkronkan ke perangkat mana pun tempat orangnya masuk.
- `whatsapp_delivery` (#963) sudah ter-merge dan menjadi bentuk rujukan: tabel antrean kanal dengan dispatcher berbasis lease, hash penerima HMAC berkunci dengan key ring, kredensial per deployment, port yang mengembalikan penolakan alih-alih melempar, retensi `delegated`. Pelajaran auditnya (F1–F11, tercatat di README-nya) berlaku juga di sini: hash harus berkunci, lease disesuaikan dengan batch, jangan mempercayai dispatcher untuk kedaluwarsa, redaksi teks provider.
- ADR-0139 tidak menerima orkestrasi. Karena itu Telegram tidak boleh menjadi fasad, pusat preferensi, atau fallback kanal lain.

## Keputusan

### 1. Kelas pesan: hanya peringatan operasional dan staf

Adapter membawa tepat **satu kelas tujuan, `staff_ops`**: pemberitahuan operasional yang ditujukan kepada **anggota staf tenant** tentang pekerjaan yang menjadi tanggung jawabnya. Template awal yang diterima (masing-masing didaftarkan modul pemiliknya, berawalan modul, dengan allow-list variabel seperti ADR-0133 §4):

| Diterima                                                                    | Contoh                                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Pengingat booking untuk staf (`booking.staff_reminder`)                     | "3 kedatangan besok untuk resource R-12. Buka admin untuk melihat."           |
| Ping persetujuan tertunda (`workflow.approval_pending`)                     | "Ada persetujuan menunggu Anda. Buka: <tautan same-origin>."                  |
| Peringatan operasional (`system.ops_alert`, mis. job gagal, health menurun) | "Job `email:dispatch` gagal 3 kali berturut-turut. Buka admin untuk melihat." |

Ditolak, selalu, tanpa pengecualian dan tanpa flag override:

| Ditolak                                                                                                | Alasan                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Payroll**: notifikasi slip gaji, status payroll run, apa pun dari `hr_payroll`                       | ADR-0133 §4/§7 dan ADR-0132: notifikasi payroll hanya lewat kanal yang dipilih tenant untuknya, tidak pernah di sini |
| **Data pribadi**: nama, telepon, e-mail, alamat, identitas nasional, bank, kesehatan, lokasi seseorang | Telegram bukan tempat yang pantas untuk PII; lihat Opsi                                                              |
| Pesan **menghadap pelanggan** apa pun (status pesanan, konfirmasi booking ke tamu, struk)              | Himpunan penerima hanya staf yang terikat; pelanggan tidak dapat mengikat chat, dan itu disengaja                    |
| Kelas **`security`**: OTP, kode login atau step-up, peringatan perubahan akun                          | Rahasia di cloud chat yang bertahan di provider dan di setiap perangkat yang tersinkron                              |
| **`marketing`** dan kampanye apa pun                                                                   | Tidak ada model persetujuan yang diterima untuk kanal ini                                                            |
| **Fallback kanal lain**                                                                                | ADR-0133 §7 dan ADR-0139; lihat §8                                                                                   |

**Bagaimana penolakan ditegakkan, bukan sekadar dinyatakan:**

1. Registry hanya menerima template yang mendeklarasikan `purpose: "staff_ops"`; tidak ada tujuan lain di modul ini, sehingga tidak ada yang dapat salah dipilih.
2. **Allow-list variabel per template** dengan **deny list jenis variabel** yang menggagalkan pendaftaran (bukan saat kirim): variabel yang bernama atau bertipe nama orang, telepon, e-mail, alamat, identitas, nominal, atau teks bebas dari sebuah record. Template boleh membawa **referensi buram** (kode reservasi, jumlah, nama job), **tautan same-origin** ke halaman admin terautentikasi, dan kalimat tetap. Renderer membuang variabel di luar daftar (seperti `email` dan ADR-0133 §4).
3. **Gerbang registry di CI** (gerbang `bun run` pada PR implementasi, seperti `domain-events:consumers:check`) gagal bila kunci template terdaftar di bawah modul pemilik payroll, atau bila template mendeklarasikan variabel pada deny list. Gerbang statis buta terhadap string yang dibangun saat runtime, itulah sebabnya aturan 4 ada.
4. Port hanya menerima **kunci template dan variabel ber-allow-list**, tidak pernah isi teks bebas. Tidak ada `send(text)`.

### 2. Mati secara default, di tiga tingkat

1. **Deployment:** `TELEGRAM_ENABLED=true` dan token bot di environment. Bila tidak diset, `enqueue` menjawab `refused: DISABLED`, dispatcher tidak mengklaim apa pun, rute webhook menjawab 404, dan entri admin modul disembunyikan. `config:validate` menolak `TELEGRAM_ENABLED=true` tanpa token, rahasia webhook, dan key ring (§5, §6).
2. **Tenant:** modul diaktifkan per tenant lewat Module Management (mati secara default); tenant yang mengaktifkannya juga punya pengaturan tenant yang harus dinyalakan administrator dengan aksi berisiko tinggi `settings.configure`, diaudit.
3. **Orang:** tidak ada yang menerima apa pun sebelum mengikat chat (§3). Tenant yang mengaktifkan modul tidak mengirim ke siapa pun sampai staf memilih ikut.

Telegram juga **tidak pernah alamat yang diberikan pemanggil**: konsumen menyebut principal, bukan chat (§8).

### 3. Otorisasi chat yang eksplisit: chat diikat oleh tindakan yang diaudit dan dapat dicabut

Chat yang sekadar memuat bot, atau yang mengirim pesan kepadanya, tidak dapat dikirimi pesan. Sebuah chat menjadi dapat dialamatkan hanya lewat **jabat tangan pengikatan**, alur kode-tautan sekali pakai dengan konfirmasi dua sisi:

1. **Permintaan.** Staf yang terautentikasi meminta kode tautan untuk **dirinya sendiri** (`telegram_delivery.links.create`; tidak ada "ikat atas nama orang lain", karena chat yang terikat menerima peringatan operasional orang itu). Kodenya 32 byte acak, base64url (43 karakter, dalam batas payload deep-link 64 karakter), ditampilkan sekali sebagai tautan `https://t.me/<bot>?start=<code>`. Disimpan hanya sebagai SHA-256-nya (rahasia berentropi tinggi tidak butuh hash berkunci atau lambat), dengan `tenant_id`, `principal_id`, `expires_at` (10 menit), `consumed_at`. Meminta kode baru membatalkan yang sebelumnya. Berlaku batas laju permintaan per principal. Diaudit.
2. **Jabat tangan.** Orang itu membuka tautan di Telegram dan bot menerima `/start <code>`. Webhook (§7) menerimanya **hanya dari chat privat** (`chat.type = "private"` dan `chat.id == from.id`), mengonsumsi kode **secara atomik** (`UPDATE … SET consumed_at = now() WHERE consumed_at IS NULL AND expires_at > now() RETURNING …`, sehingga dua pemakaian paralel menghasilkan satu pengikatan), dan membuat pengikatan berstatus **`pending_confirmation`**. Tenant dan principal berasal **dari baris kode**, tidak pernah dari payload. Kode yang tidak dikenal, kedaluwarsa, atau sudah dipakai dijawab dengan satu pesan netral tetap (tanpa pembedaan, sehingga bukan oracle untuk kode yang valid).
3. **Konfirmasi di sisi terautentikasi.** Sesi admin staf kemudian menampilkan **nama tampilan dan username tersamar Telegram** yang ditangkap jabat tangan dan bertanya "Apakah ini Anda?". Hanya setelah konfirmasi pengikatan menjadi **`active`**. Ini menutup serangan ketika kode diteruskan, di-phishing, atau diintip dan chat penyerang terikat ke peringatan korban: penyerang tidak dapat melewati prompt yang hanya muncul di sesi terautentikasi korban sendiri. Pengikatan yang tidak dikonfirmasi kedaluwarsa dalam 10 menit dan data tampilan yang ditangkap dihapus saat konfirmasi, penolakan, atau kedaluwarsa.
4. **Satu pengikatan aktif per `(tenant, principal)`** (mengikat ulang menggantikan, diaudit), dan sebuah chat boleh aktif pada **paling banyak satu principal per tenant** (unik pada hash chat berkunci), sehingga satu chat tidak dapat menyamar sebagai dua orang.

**Grup, supergrup, dan channel ditolak di v1.** Pengikatan grup menjadikan setiap anggota grup penerima peringatan satu orang dan memindahkan kendali keanggotaan ke Telegram. Webhook hanya berlangganan pembaruan `message` privat; pesan dari atau `/start` di chat non-privat diabaikan tanpa balasan. Bot ditambahkan ke grup, atau pembaruan `my_chat_member`, **tidak dilanggani** (`allowed_updates` adalah `["message"]`), sehingga grup yang sekadar memuat bot tidak terlihat. ADR berikutnya boleh menerima chat grup dengan analisis otorisasi dan kebocorannya sendiri; ADR ini tidak.

**Pencabutan** (semua diaudit, semua berefek segera pada antrean):

- Orangnya mencabut dari admin (pengikatannya sendiri) atau dari chat dengan `/stop`.
- Administrator mencabut pengikatan siapa pun dengan `telegram_delivery.bindings.revoke`.
- **Otomatis:** principal dinonaktifkan atau kehilangan semua peran di tenant (dispatcher memeriksa ulang principal saat kirim, bukan hanya saat enqueue); modul atau pengaturan tenant dimatikan; Telegram menjawab 403 (bot diblokir atau pengguna dihapus) atau "chat not found" (pengikatan menjadi `suspended`, tidak pernah dicoba ulang).
- Pada setiap pencabutan: pesan `queued` dan `retry_wait` untuk pengikatan itu dibatalkan, **ciphertext chat id dihapus** (di-null; hash dipertahankan sebagai nisan agar chat yang sama tidak dapat ditautkan ulang tanpa jabat tangan baru oleh pemiliknya dan agar `/start` lama yang diputar ulang tidak berefek), dan baris yang sudah `sending` dibatasi oleh timeout provider, persis seperti opt-out WhatsApp.

### 4. Permukaan masuk: jabat tangan dan `/stop`, tidak ada yang lain

Webhook menangani **dua** perintah, keduanya hanya chat privat: `/start <code>` (§3) dan `/stop` (pencabutan, yaitu opt-out yang wajib ditawarkan kanal pesan; tanpanya satu-satunya jalan keluar adalah layar admin, dan "blokir bot" bukan tindakan yang diaudit). Segala hal lain (teks lain, perintah lain, media, suntingan, callback query, inline query) **diabaikan tanpa balasan**: tanpa gema, teks bantuan, atau "perintah tidak dikenal", sehingga bot bukan oracle chat maupun jalur amplifikasi, dan **tidak ada perintah yang membaca atau menulis data bisnis**. Dua pengakuan yang memang dikirim bot ("tertaut, konfirmasi di admin", "dihentikan") lewat **antrean tunggal yang sama** sebagai pemberitahuan sistem; webhook tidak pernah memanggil provider sendiri. Bila perintah baca atau tulis suatu saat diinginkan, ia butuh ADR sendiri: ia akan mengubah kanal notifikasi menjadi antarmuka jarak jauh terautentikasi.

### 5. Aturan provider (mengikat implementasi, selain ADR-0133 §5)

1. **Token dari environment saja**, satu bot per deployment, **tidak pernah per tenant** (token dari tenant membuat admin satu tenant dapat berbicara sebagai pihak lain: ADR-0074 §5). Tidak pernah di database, log, baris audit, event, atau pesan error.
2. **Token ada di path URL**, sehingga adapter harus membangun URL secara internal dan **menyamarkannya dari setiap error, catatan circuit breaker, baris log `ssrfSafeFetch`, dan string detail provider** (satu tes memberi error yang pesannya memuat token dan memastikan token tidak ada di sink mana pun). Adapter memanggil `ssrfSafeFetch` di bawah `withTimeout` total, hanya ke `api.telegram.org` (host tetap, tidak dapat dikonfigurasi).
3. **Tanpa I/O jaringan di dalam transaksi DB** (ADR-0006): enqueue adalah satu INSERT di transaksi pemanggil; dispatcher mengklaim di transaksi singkat, mengirim di luarnya, menuntaskan per baris.
4. **Aturan laju Bot API Telegram.** Batas terdokumentasi kira-kira satu pesan per detik per chat, kira-kira 20 pesan per menit ke satu grup (tidak dipakai di sini), dan kira-kira 30 pesan per detik lintas bot untuk pengiriman massal. Dispatcher menegakkan **jarak sekurang-kurangnya satu detik per chat** (baris untuk chat yang dikirimi dalam satu detik terakhir ditinggalkan untuk pass berikutnya) dan **plafon global di bawah 30 per detik** (ukuran batch dan interval pass disesuaikan agar satu pass tidak dapat melampauinya). `429` membawa `parameters.retry_after`: baris dijadwalkan ulang ke `now + retry_after` (dibatasi plafon), **dihitung retryable tanpa menaikkan backoff**, dan membuka circuit breaker adapter agar setiap baris mundur alih-alih menghantam.
5. **Pemetaan error:** timeout, `429`, `5xx` retryable; `403` dan "chat not found" terminal dan **menangguhkan pengikatan** (§3); penolakan `400` terhadap pesan terminal. Percobaan dibatasi dengan backoff eksponensial dan jitter; hanya adapter yang memberi makan breaker, sehingga penolakan per pesan tidak pernah membukanya.
6. **Teks polos saja.** Adapter **tidak mengirim `parse_mode`** (sehingga variabel tidak dapat menyuntikkan markup Markdown atau HTML ke pesan staf), `disable_web_page_preview=true`, dan `protect_content=true` (upaya terbaik terhadap penerusan). Pesan dibatasi di bawah 4096 karakter Telegram, dan tautan same-origin satu-satunya URL yang boleh.
7. **Idempotensi, lease, dan kedaluwarsa** seperti ADR-0133 §5.5 dan pelajaran audit whatsapp_delivery: kunci idempotensi pemanggil unik per `(tenant_id, idempotency_key)`; lease disesuaikan dengan seluruh batch, diperbarui dan diverifikasi sebelum tiap baris, finalisasi mencocokkan nilai lease persis; `expires_at` pada setiap pesan (ping persetujuan yang tiba sehari kemudian adalah gangguan), ditegakkan oleh **job purge secara independen dari dispatcher**; teks provider disamarkan sebelum disimpan.
8. **At-least-once** ke provider diakui; `message_id` Telegram dicatat.

### 6. Penyimpanan: chat id terenkripsi, dicari lewat hash berkunci

`chat_id` dibutuhkan untuk mengirim, sehingga hash satu arah tidak dapat menyimpannya (WhatsApp menyimpan kolom mentah karena alasan yang sama, ADR-0133 §5.6). Berbeda dari nomor telepon, ia adalah pengenal persisten buram yang tidak pernah ditampilkan produk atau diminta diketik siapa pun, sehingga ia dapat **dienkripsi saat disimpan tanpa biaya kegunaan**:

- `chat_ciphertext`: helper enkripsi field bersama ADR-0137 §2 (`v2:<keyId>:<iv>:<tag>:<ciphertext>`, AES-256-GCM, key id di dalam nilai), dengan AAD `telegram_chat:v1|<tenant_id>|<binding_id>`, **key ring khusus** `TELEGRAM_CHAT_ENCRYPTION_KEYS` (`secret: true`, tanpa default, wajib bila Telegram diaktifkan; terpisah dari kunci payout dan kunci lain mana pun). **Gagal tertutup**: tanpa ring yang dapat dipakai tidak ada pengikatan dibuat dan dispatcher tidak mengirim apa pun; tidak ada fallback plaintext.
- `chat_hash` dan `hash_key_id`: HMAC-SHA256 **berkunci** atas `tenant_id 0x00 "telegram:chat" 0x00 chat_id` di bawah ring `TELEGRAM_CHAT_HASH_KEYS` (bentuk ADR-0137 §3; hash tanpa kunci yang hanya diberi garam tenant atas ruang numerik kecil dapat dibalik, pelajaran audit whatsapp_delivery). Dipakai untuk aturan chat-aktif-unik, pencarian webhook untuk `/stop`, dan nisan.
- `chat_masked`: tiga digit terakhir, satu-satunya bentuk yang dibawa daftar, baris log, baris audit, atau event.
- **Baris antrean membawa `binding_id`, tidak pernah chat id.** Dispatcher mendekripsi di memori saat kirim; chat id tidak pernah sampai ke baris attempt, audit, event, log, atau respons. **Tidak ada jalur reveal** dan tidak ada yang diterima.
- Ini bergantung pada helper ADR-0137, yang dibuat oleh issue implementasinya. #965 tidak boleh dimulai sebelum helper itu ada, dan tidak boleh menulis salinan kedua.

### 7. Webhook, bukan polling, dengan rahasia terverifikasi

**Webhook.** Job deployment berupa proses cron berumur pendek (bentuk dispatcher sekali jalan), sehingga konsumen long-polling akan menjadi proses baru yang selalu hidup dengan masalah singleton dan restart. Webhook didaftarkan oleh **skrip operator** (`setWebhook` adalah tindakan operator yang disengaja, tidak pernah dilakukan saat runtime atau boot), dengan `allowed_updates=["message"]` dan `secret_token`.

- Satu rute, `POST /api/v1/telegram/webhook`, **tanpa tenant di path** (satu bot per deployment); tenant berasal dari baris kode atau pengikatan yang ditemukan lewat hash chat, tidak pernah dari payload.
- **Verifikasi:** header `X-Telegram-Bot-Api-Secret-Token` dibandingkan **timing-safe** dengan `TELEGRAM_WEBHOOK_SECRET` (`secret: true`, tanpa default). Header hilang atau salah adalah `401` tanpa detail dan tidak melakukan kerja apa pun (tanpa baca database, tanpa parse JSON di luar batas ukuran). Rute punya batas ukuran body (gerbang `api:body-limit`) dan batas laju per-IP kasar.
- **Replay:** kedua perintah idempoten secara konstruksi (kode dikonsumsi atomik; `/stop` pada pengikatan yang sudah dicabut tidak berefek), sehingga tidak butuh penyimpanan update-id. Ini dinyatakan agar peninjau tidak menambahkannya secara refleks.
- Saat modul mati, rute menjawab `404`. Rute ini publik dan tanpa sesi, itulah sebabnya ia mengerjakan begitu sedikit.

### 8. Tanpa fallback, tanpa fasad, satu antrean

- **Satu antrean Telegram per deployment**, tabel kanal `awcms_telegram_messages` dengan dispatcher lease sendiri (tabel kanal keempat, setelah `email`, `push`, dan `whatsapp`; biaya yang diterima di ADR-0133 §3 berlaku sekali lagi dan tidak ada domain yang menambah lagi). Bukan `awcms_domain_events`, bukan tabel e-mail, bukan milik WhatsApp.
- Port-nya **`TelegramDeliveryPort`, khusus kanal**: `enqueue(tx, { templateKey, recipientPrincipalId, variables, idempotencyKey, expiresAt, correlationId })`. Bukan `MessageDeliveryPort(channel, …)`. Konsumen yang menginginkan Telegram memanggil port ini, secara eksplisit, untuk sebuah **principal**; ia tidak pernah dapat memberi chat id, nomor telepon, atau isi teks bebas.
- Principal tanpa pengikatan aktif menghasilkan **`refused: NO_BINDING`**, dikembalikan ke pemanggil. Modul **tidak** kemudian mencoba e-mail, WhatsApp, atau apa pun; apa yang dilakukan konsumen adalah keputusan eksplisitnya sendiri, di modulnya sendiri (konsekuensi ADR-0139).
- Kegagalan terminal Telegram tidak memicu apa pun di kanal lain, dan kegagalan di kanal lain tidak pernah mengantre ke Telegram. Pemicu pembukaan kembali ADR-0139 berlaku tanpa perubahan; Telegram sebagai kanal hidup yang hanya membawa lalu lintas operator **tidak** dihitung terhadapnya (ADR-0139 §3 pemicu 1).
- Penolakan yang dikembalikan: `DISABLED`, `TEMPLATE_UNKNOWN`, `NO_BINDING`, `RATE_LIMITED`, `EXPIRY_REQUIRED`; port tidak melakukan pemeriksaan akses dan tidak menulis baris audit (konsumen mengotorisasi dan mengaudit aksinya sendiri), seperti ADR-0133 §8.

### 9. Retensi, data subjek, dan audit

- **Retensi** (`data_lifecycle`, `delegated`, status terminal dan `updated_at` sebagai kursor, tidak pernah usia saja, seperti ADR-0133 §3): baris pesan berumur pendek, **14 hari** setelah mencapai status terminal secara default (pemberitahuan operasional tidak bernilai sebagai catatan); baris non-terminal yang kedaluwarsa dikedaluwarsakan oleh purge sendiri; pengikatan yang dicabut dipurge setelah 90 hari (ciphertext sudah dihapus saat pencabutan); kode tautan satu hari setelah kedaluwarsa. Setiap tabel modul punya deskriptor sejak hari pertama.
- **Data subjek (ADR-0094):** pengikatan adalah data tentang seseorang. Deskriptornya mendeklarasikan `export` (hanya tersamar) dan `anonymize` saat penghapusan principal; berbeda dari butir terbuka WhatsApp, jalur penghapusan menjadi bagian penerimaan #965, karena pencabutan sudah menghapus pengenalnya.
- **Audit (disamarkan, ADR-0133 / `awcms-audit-log`):** kode diminta, pengikatan dibuat, dikonfirmasi atau ditolak, dicabut (dengan **penyebab**: diri sendiri, `/stop`, admin, principal dinonaktifkan, diblokir provider), diikat ulang, pengaturan modul atau tenant berubah, dan penolakan webhook pada tingkat agregat. Pesan individual **tidak** diaudit (volume; baris antrean adalah buku besarnya). Chat id, kode, token, dan isi pesan tidak pernah muncul di baris audit; chat hanya muncul sebagai maskernya. Administrator yang mencabut pengikatan orang lain diaudit pada `warning`.
- **Event:** event tingkat pengikatan (bila ada) membawa binding id dan principal id, tidak pernah chat id (aturan same-origin, tanpa-rahasia-di-event). Perlu tidaknya diputuskan di #965 dan, bila ya, ditambahkan ke AsyncAPI di sana.
- **Akses:** setiap rute dan permukaan admin lewat `authorizeInTransaction` (ADR-0063) dengan default-deny; izin di-seed di migrasi modul, tidak ada yang diberikan ke peran selain swalayan pemilik sendiri (`links.create`, pencabutan pengikatan sendiri); `settings.configure` dan pencabutan oleh administrator berisiko tinggi dan tidak di-seed ke peran. Setiap tabel tenant-scoped dengan RLS `FORCE`; pencarian webhook berjalan di bawah tenant yang diselesaikan dari baris kode atau pengikatan.

### 10. Opsi yang dipertimbangkan

Keputusan pemilik (A) dibandingkan dengan cakupan lebih luas yang sempat di meja. Kriteria: kelebihan dan kekurangan, keamanan, privasi, kompleksitas operasional, kemudahan pemeliharaan.

| Opsi                                                                                        | Kelebihan                                                                                                          | Kekurangan                                                                                                                                                                             | Keamanan                                                                                                                                         | Privasi                                                                                                                                             | Kompleksitas operasional                                                                          | Pemeliharaan                                                                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **A. Hanya peringatan ops dan staf (dipilih)**                                              | Cepat, gratis, tanpa biaya per pesan; staf sudah hidup di aplikasi chat; himpunan penerima kecil, dikenal, terikat | Hanya staf; tanpa jangkauan pelanggan; nilai bergantung staf mau ikut                                                                                                                  | Token bocor atau pesan salah-alamat hanya membuka kebisingan operasional; tidak ada rahasia dan PII masuk ke cloud chat                          | Tidak ada data pribadi pihak ketiga keluar dari sistem; satu-satunya data pribadi adalah chat id staf itu sendiri, terenkripsi dan dapat dihapus    | Satu bot, satu webhook, satu antrean; jabat tangan pengikatan satu-satunya alur baru              | Himpunan template sempit dan dapat dienumerasi; penolakan adalah aturan registry yang dicek di CI, mudah tetap benar      |
| B. A ditambah pemberitahuan transaksional ke pelanggan (konfirmasi booking, status pesanan) | Menjangkau pelanggan di aplikasi populer; lebih sedikit pemberitahuan terlewat                                     | Pelanggan harus mengikat chat (jabat tangan publik, volume tinggi, rawan disalahgunakan); chat id pelanggan menjadi data pribadi massal; tumpang tindih dengan WhatsApp                | Permukaan pengikatan publik mengundang phishing kode dan penyalahgunaan spam-bot; token bocor memungkinkan penyerang mengirim ke semua pelanggan | Pengenal pelanggan dan rincian booking berada di cloud chat yang tidak dapat ditarik tenant; butuh model persetujuan dan penghapusan per pelanggan  | Beban dukungan pelanggan (bot diblokir, chat salah, bahasa), tekanan batas laju jauh lebih tinggi | Menyeret model persetujuan dan supresi ADR-0133 §4 untuk kedua kalinya, dan condong ke orkestrasi (ADR-0139)              |
| C. A ditambah notifikasi HR/payroll ("slip gaji tersedia")                                  | Staf membaca notifikasi slip gaji di tempat yang sudah mereka lihat                                                | Notifikasi menyebut hubungan kerja dan periode gaji seseorang; notifikasi yang diteruskan atau di-screenshot adalah pengungkapan payroll; bertentangan dengan ADR-0133 §7 dan paket hr | Payroll adalah target bernilai tertinggi; chat terikat yang salah (ponsel dicuri, akun dialihkan) membuka informasi gaji                         | Metadata hubungan kerja dan gaji (dan tautan ke payroll) di cloud chat yang disimpan provider: dampak perlindungan data yang belum diterima pemilik | Butuh verifikasi penerima khusus payroll dan tinjauan keamanan tersendiri                         | Mengikat kanal ke modul paling sensitif dan aturan SoD serta step-up-nya; "tambahkan nominal saja" tinggal satu suntingan |
| D. Paritas penuh dengan WhatsApp termasuk `security`/OTP dan peran fallback                 | Satu set fitur seragam; rute kedua untuk OTP                                                                       | OTP di cloud chat yang bertahan di provider dan setiap perangkat tersinkron; fallback persis yang ditolak ADR-0133 §7 dan ADR-0139                                                     | Rahasia disimpan di pihak ketiga; chat terikat yang dicuri adalah jalan pintas login; fallback adalah aliran data lintas-kanal otomatis          | Tertinggi: setiap kelas termasuk rahasia dan data pribadi                                                                                           | Butuh mesin persetujuan, supresi, dan fallback; pembangunan terbesar                              | Menggandakan matriks persetujuan dan tujuan dan menciptakan orkestrasi yang ditolak ADR-0139                              |
| E. Tidak membangun Telegram                                                                 | Biaya nol, permukaan baru nol                                                                                      | Bertentangan dengan penerimaan O10 pemilik; peringatan staf tetap di e-mail atau admin, dengan celah nyata untuk pemberitahuan operasional yang mendesak                               | Tidak ada tambahan                                                                                                                               | Tidak ada tambahan                                                                                                                                  | Tidak ada                                                                                         | Tidak ada; tetapi permintaan kembali sebagai bot lokal-konsumen, duplikasi per-domain yang ditolak ADR-0133               |

**A menang pada setiap kriteria yang paling dibobot repositori ini (keamanan, privasi, kesederhanaan operasional, menjaga ADR-0133 dan ADR-0139) dan hanya kalah pada jangkauan, yang dipilih pemilik untuk dilepas.** B, C, dan D ditolak sebagai opsi yang lebih luas; E ditolak karena pemilik sudah menerima adapter dan alternatifnya yang lebih buruk dan tersebar.

Sub-keputusan, beserta alternatif yang ditolak:

- **Pengikatan dengan kode sekali pakai plus konfirmasi (dipilih)** dibanding _admin mengetik chat id_ (rawan salah, dan mengikat seseorang tanpa tindakannya), dibanding _bot membalas `/start` apa pun lalu admin memetakan_ (orang asing mana pun dapat mendaftar dan admin tidak tahu siapa), dan dibanding _kode saja, tanpa konfirmasi_ (kode yang diteruskan mengikat penyerang; §3.3).
- **Hanya chat privat** dibanding _chat grup_ (keanggotaan dikendalikan di luar sistem dan setiap anggota membaca setiap peringatan).
- **Webhook** dibanding _long polling_ (proses baru yang selalu hidup; job repositori sekali jalan), dengan menerima rute publik kecil yang hanya melakukan verifikasi waktu-konstan dan dua aksi idempoten.
- **Chat id terenkripsi plus hash berkunci** dibanding _kolom mentah seperti WhatsApp_ (id tidak pernah ditampilkan, jadi enkripsi bebas biaya kegunaan dan salinan database tidak lagi mengenumerasi chat staf) dan dibanding _hash saja_ (tidak dapat mengirim).
- **Teks polos** dibanding `MarkdownV2`/HTML (variabel tidak dapat menyuntikkan markup ke pemberitahuan staf).

## Konsekuensi

- Staf dapat memilih ikut Telegram untuk peringatan operasional. Tidak ada lalu lintas pelanggan, payroll, PII, OTP, atau marketing yang dapat memakainya, lewat aturan registry dan gerbang CI, bukan disiplin pemanggil.
- Repo akan memperoleh **tabel kanal keempat** (email, push, WhatsApp, Telegram) saat #965 mendarat; biaya dan aturan "tidak ada kelima, tidak ada antrean per-domain" adalah milik ADR-0133 §3.
- Adapter bergantung pada helper enkripsi field ADR-0137; #965 diurutkan setelahnya, dan key ring-nya adalah dua variabel `secret: true` tambahan.
- ADR-0133 §7 diperbarui oleh paragraf rujukan bertanggal; `docs/awcms/hr-payroll.md` §15 dan `docs/PROJECT_STATE.md` §4 tidak lagi menyatakan Telegram butuh ADR sendiri.
- **Belum dibangun.** Tidak ada dalam ADR ini yang membuat migrasi, izin, path OpenAPI, atau kanal AsyncAPI. #965 mencadangkan rentang `sql/NNN`, seed izin, berkas OpenAPI dan (bila ada) AsyncAPI, dan menjalankan tinjauan keamanan modul sensitif (webhook, rahasia, token bearer di URL) sebelum merge.
- **Pertanyaan terbuka** untuk #965 (tidak ada yang mengubah keputusan ini): angka default dispatch per-chat dan global dalam §5.4; perlu tidaknya event pengikatan; nilai retensi 14 dan 90 hari sebagai pengaturan; tata letak layar admin.

## Alternatif yang ditolak

- **Cakupan pesan yang lebih luas (B, C, D di §10).** Ditolak di sana.
- **Antrean Telegram kedua per domain, atau `MessageDeliveryPort(channel, …)` bersama.** Ditolak oleh ADR-0133 §3 dan §7 serta ADR-0139.
- **Memakai Telegram sebagai fallback saat WhatsApp atau e-mail gagal**, untuk kelas apa pun. Ditolak: ADR-0133 §7, ADR-0139.
- **Token bot dari tenant.** Ditolak karena alasan di ADR-0074 §5.
- **Pengiriman ke chat grup.** Ditolak di v1 (§3).
- **Perintah bisnis masuk lewat bot** ("setujui", "tampilkan jadwal saya"). Ditolak (§4): kanal notifikasi tidak menjadi antarmuka jarak jauh terautentikasi tanpa ADR sendiri.
- **Menyimpan chat id mentah, atau hanya di-hash.** Ditolak (§6).
