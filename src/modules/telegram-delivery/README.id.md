🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:9944a124e5355791726c289aa4abca59e8444a3f420aa4c60c8cb57528a81620 -->

# `telegram_delivery`

Adapter Telegram opsional, mati secara default, untuk **notifikasi operasional dan staf saja** (Issue #965, [ADR-0140](../../../docs/adr/0140-telegram-delivery-adapter-ops-staff-alerts-only.id.md); kapabilitas pengiriman [ADR-0133](../../../docs/adr/0133-generic-delivery-capability-whatsapp-promotion.id.md) bagian 7; enkripsi field [ADR-0137](../../../docs/adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.id.md)).

Modul ini **mengantarkan** pemberitahuan teks polos singkat yang diputuskan modul lain untuk dikirim kepada **anggota staf tenant** yang mengikat chat Telegram pribadinya sendiri: pengingat booking untuk staf, ping persetujuan tertunda, notifikasi operasional. Ia tidak berpendapat tentang apa yang layak dikirim dan hanya membawa satu template netral, `system.ops_alert`. Ia khusus Telegram dengan sengaja: `TelegramDeliveryPort` **bukan** fasad multi-kanal dan tidak pernah menjadi fallback kanal lain ke arah mana pun ([ADR-0139](../../../docs/adr/0139-cross-channel-notification-orchestration-not-admitted.id.md)).

## Apa yang boleh dan tidak boleh dikirim

Hanya ada satu purpose, `staff_ops`. Ini ditegakkan oleh apa yang dapat diungkapkan registri, bukan oleh kedisiplinan pemanggil:

- Template menyatakan `purpose: "staff_ops"`; tidak ada nilai lain yang dapat direpresentasikan.
- **Variabel bertipe dan tidak ada yang dapat membawa teks bebas**: `reference` (kode buram, tanpa titik, tanpa garis miring), `count`, `token` (nama mesin seperti `email:dispatch`) dan `link` (path di bawah `/admin/`; origin ditambahkan dari `APP_URL`, sehingga pesan hanya dapat menunjuk situs ini). Nilai yang tidak memenuhi kind-nya **dibuang**, seperti variabel yang tidak ada di daftar.
- **Daftar tolak gagal saat registrasi**, bukan saat kirim: variabel yang bernama atau dieja sebagai nama orang, telepon, e-mail, alamat, pengenal, nominal, atau teks bebas (`customerName`, `netSalary`, `note`, `phone_number`, ...) tidak dapat didaftarkan. Kalimat tetap tidak boleh memuat URL, domain, atau sebutan `@`.
- **Modul pembawa payroll tidak dapat mendaftarkan template.** Kepemilikan dideklarasikan (`ModuleDescriptor.handlesPayrollData`; `hr_commission` menyetelnya), prefiks kunci harus sama dengan modul pendaftarnya (`ownerModuleKey`), kata payroll dan nama variabel Indonesia/Inggris (gaji, upah, wages, payee, commission, bentuk jamak ...) ditolak, dan nilai `reference` yang hanya angka 8+ digit dibuang. `bun run telegram:templates:check` (di `bun run check`) menggagalkan modul bertanda yang menyebut port sama sekali dan mengikuti impor beralias serta namespace. **Ini heuristik, bukan bukti**: gerbang statis buta pada string yang dibangun saat runtime atau modul payroll yang tidak mendeklarasikan diri, itulah sebabnya pendaftaran menegakkan aturan yang sama dan port hanya menerima kunci template dan variabel ber-daftar-izin. Tidak ada `send(text)`.

Ditolak tanpa pengecualian dan tanpa flag override: payroll, data pribadi, pesan ke pelanggan, kelas `security` (OTP, step-up), marketing, dan fallback kanal lain.

## Mati secara default, di tiga tingkat

1. **Deployment**: `TELEGRAM_ENABLED=true` ditambah token bot, username bot, secret webhook, dan kedua cincin kunci (`config:validate` gagal tanpa itu). Tidak diset: `enqueue` menjawab `refused: DISABLED`, dispatcher tidak mengklaim apa pun, webhook menjawab 404.
2. **Tenant**: modul aktif di Module Management **dan** saklar `settings.configure` yang diaudit (`PUT /api/v1/telegram/settings`, berisiko tinggi). Mematikannya mengakhiri setiap binding dalam transaksi yang sama dan menghapus id chat yang tersimpan. Dispatcher membaca ulang keduanya setiap pass, sehingga mematikan modul di Module Management juga mencabut.
3. **Orang**: tak seorang pun menerima apa pun sebelum ada binding chat yang **terkonfirmasi**.

## Port

`_shared/ports/telegram-delivery-port.ts`, adapter `telegramDeliveryPortAdapter` di `application/telegram-enqueue.ts`:

- `enqueue(tx, { templateKey, recipientPrincipalId, variables, idempotencyKey, expiresAt, correlationId })` adalah **satu INSERT di transaksi pemanggil**. `recipientPrincipalId` adalah **tenant user** (`awcms_tenant_users.id`): subjek ADR-0094, dan satuan yang grant perannya menentukan apakah seseorang masih staf. Tenant dibaca dari konteks RLS transaksi itu sendiri, sehingga port tidak punya argumen `tenantId`.
- Penolakan **dikembalikan**, tidak pernah dilempar: `DISABLED`, `TEMPLATE_UNKNOWN`, `NO_BINDING`, `RATE_LIMITED`, `EXPIRY_REQUIRED`. `expiresAt` wajib, di masa depan dan paling lama tujuh hari. **`NO_BINDING` tidak memicu apa pun lagi**: tidak ada e-mail, tidak ada WhatsApp; apa yang dilakukan konsumen adalah keputusannya sendiri.
- Urutan pemeriksaan: flag deployment, template, kedaluwarsa, **replay idempoten**, gerbang tenant, binding, batas laju. Replay menjawab `duplicate` meskipun binding sudah dicabut, sehingga pesan yang sudah ada tidak pernah dibantah oleh keadaan yang berubah kemudian.
- `getStatusByCorrelation` / `cancelByCorrelation` membaca dan membatalkan berdasarkan id catatan milik pemanggil. Port **tidak melakukan pemeriksaan akses dan tidak menulis baris audit**: konsumen mengotorisasi dan mengaudit aksinya sendiri.

## Handshake binding chat (ADR-0140 bagian 3)

1. **Permintaan.** Staf memanggil `POST /api/v1/telegram/links` **untuk dirinya sendiri** (`links.create`). Kodenya 32 byte acak, base64url (43 karakter), dikembalikan **sekali** di dalam `https://t.me/<bot>?start=<code>`; hanya SHA-256-nya yang disimpan. 10 menit, sekali pakai, permintaan baru membatalkan yang lama, lima permintaan per jam.
2. **Handshake.** Orang itu membuka tautan; bot menerima `/start <code>`. Webhook menerimanya **hanya dari chat pribadi** (`chat.type = "private"` dan `chat.id == from.id`, dari manusia), mengonsumsi kode dengan satu `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING` atomik (dua pemakaian paralel menghasilkan satu binding) dan membuat binding `pending_confirmation`. Tenant dan principal berasal **dari baris kode, tidak pernah dari payload**. Kode yang tidak dikenal, kedaluwarsa, sudah dipakai, atau cacat mendapat balasan yang **sama**.
3. **Konfirmasi, di sesi terautentikasi milik staf itu sendiri.** `/admin/telegram` menampilkan nama tampilan Telegram yang ditangkap (teks yang di-escape) dan username yang disamarkan lalu bertanya "apakah ini Anda?". Hanya `POST /api/v1/telegram/bindings/me/confirm` yang membuat binding `active`. Kode yang diteruskan, di-phishing, atau diintip dengan demikian paling jauh mengikat chat penyerang ke `pending_confirmation`, yang tidak menerima apa pun; korban melihatnya dan menekan "bukan saya" (`.../reject`, diaudit pada level warning).
4. **Satu binding aktif per `(tenant, principal)`** (mengonfirmasi chat baru menggantikan yang lama, diaudit sebagai re-bind), dan **sebuah chat hidup pada paling banyak satu principal per tenant** (indeks unik parsial pada hash berkunci, ditambah pemeriksaan hash kandidat setiap kunci cincin karena chat yang sama punya hash berbeda di bawah tiap kunci).

Grup, supergrup, dan kanal ditolak: parser hanya bertindak atas chat pribadi, dan webhook didaftarkan dengan `allowed_updates=["message"]`, sehingga grup yang sekadar memuat bot tidak terlihat.

## Pencabutan: satu jalur, selalu menghapus

Setiap cara sebuah binding berhenti hidup melewati `endBindings`: orangnya (admin atau `/stop`), administrator (`bindings.revoke`, berisiko tinggi, audit `warning`), principal dinonaktifkan atau kehilangan semua peran (diperiksa **saat kirim** oleh `awcms_telegram_principal_active`), saklar modul atau tenant dimatikan, Telegram menjawab `403` atau "chat not found" (binding menjadi `suspended`, tidak pernah di-retry), konfirmasi yang ditolak atau kedaluwarsa, dan re-bind. Satu pernyataan mengubah status, **menjadikan ciphertext NULL** dan menghapus nama yang ditangkap; pernyataan kedua membatalkan baris antrean yang masih menunggu untuk binding itu. Skema punya CHECK bahwa binding yang tidak hidup tidak menyimpan ciphertext. Hash berkunci tetap sebagai tombstone, sehingga chat yang sama tidak dapat ditautkan ulang tanpa handshake baru oleh pemiliknya. Baris yang sudah `sending` dibatasi timeout provider, persis seperti opt-out WhatsApp.

## Penyimpanan (ADR-0140 bagian 6)

- `chat_ciphertext`: helper bersama ADR-0137 (`src/lib/security/field-encryption.ts`; modul ini tidak punya salinan kedua), AAD `telegram_chat:v1 | tenant | binding`, cincin `TELEGRAM_CHAT_ENCRYPTION_KEYS`. **Gagal tertutup**: tanpa cincin yang dapat dipakai tidak ada binding yang dibuat dan dispatcher tidak mengklaim apa pun; tidak ada fallback plaintext.
- `chat_hash` + `hash_key_id`: HMAC-SHA256 berkunci atas tenant dan id chat di bawah cincinnya sendiri `TELEGRAM_CHAT_HASH_KEYS`. `chat_masked` (`***123`) adalah satu-satunya bentuk yang dibawa daftar, log, baris audit, atau respons.
- **Baris antrean membawa `binding_id`, tidak pernah id chat.** Tidak ada jalur reveal.

## Webhook (ADR-0140 bagian 7)

`POST /api/v1/telegram/webhook`, tanpa tenant di path (satu bot per deployment). Berurutan: `404` bila mati; header `X-Telegram-Bot-Api-Secret-Token` dibandingkan secara **constant-time** dengan `TELEGRAM_WEBHOOK_SECRET` (header hilang atau salah, atau secret server tidak diset, adalah `401` dengan envelope generik **sebelum** pembacaan body atau pekerjaan database apa pun); batas laju per alamat dan batas ukuran body; lalu dua perintah, `/start <code>` dan `/stop`. Selebihnya `200` tanpa balasan: tanpa echo, tanpa teks bantuan, tanpa "perintah tidak dikenal", tanpa perintah yang membaca atau menulis data bisnis. Replay tidak memerlukan penyimpanan update-id karena kedua perintah idempoten secara konstruksi. Penolakan diaudit secara agregat (lihat Catatan keamanan). Webhook didaftarkan oleh **skrip operator**, `bun run telegram:webhook:register --url https://<host>/api/v1/telegram/webhook` (`--dry-run`, `--delete`), tidak pernah saat boot.

Dua pencarian lintas-tenant sempit yang dibutuhkan webhook tanpa sesi (kode ke tenant; hash chat berkunci ke binding) adalah fungsi `SECURITY DEFINER` di `sql/217`, dengan pemilik `NOLOGIN` khusus, `EXECUTE` hanya untuk `awcms_app`, SQL tetap, dan `search_path` terkunci (pola `sql/048`).

## Aturan provider (ADR-0140 bagian 5)

- **Token tidak pernah muncul di keluaran apa pun.** Token ada di path URL permintaan, sehingga URL hanya dibangun di dalam `infrastructure/telegram-http-client.ts` (host tetap `api.telegram.org`, lewat `ssrfSafeFetch`, di bawah `withTimeout`) dan tidak pernah dikembalikan. Semua yang keluar dari adapter (error, alasan penolakan, deskripsi Telegram, sebuah `catch`) melewati `redactProviderText`, yang membuang token terkonfigurasi **dan** apa pun yang berbentuk token, ditambah rangkaian angka panjang (id chat). `tests/telegram-delivery.test.ts` memasukkan error berisi token melalui setiap jalur.
- **Hanya teks polos**: tanpa `parse_mode`, `disable_web_page_preview` dan `link_preview_options.is_disabled`, `protect_content`.
- **Aturan laju**: minimal 1000 ms per chat (baris untuk chat yang dikirimi kurang dari satu detik lalu ditunda ke pass berikutnya, tidak di-sleep); plafon global default 20 per detik, batas keras 25, ditegakkan pacer di dalam adapter yang merupakan **satu instans untuk seluruh tenant dalam satu run dispatch** (`telegram-provider-resolver.ts`), karena satu bot punya satu anggaran; `429` menjadwalkan ulang ke `retry_after` Telegram (dibatasi), tidak menghabiskan anggaran retry, tidak menulis baris attempt, dan sisa batch dilepas ke saat yang sama. Timeout dan `5xx` menunggu `2^n` menit (maksimum 15).
- `403` dan "chat not found" men-suspend binding; penolakan `400` bersifat terminal; token buruk (`401`/`404`) dapat di-retry dan memicu breaker. Hanya **adapter** yang memberi makan circuit breaker.
- **Tanpa I/O jaringan dalam transaksi** (ADR-0006): klaim dalam transaksi singkat, kirim di luar, finalisasi per baris, masing-masing di bawah lease per baris yang diperbarui dan diverifikasi.

## Retensi: `delegated`

`bun run telegram:queue:purge` (berjalan **terlepas dari** `TELEGRAM_ENABLED`, untuk setiap tenant): mengedarluwarsakan pesan non-terminal yang melewati `expires_at` (independen dari dispatcher), mengakhiri binding pending yang melewati jendelanya, lalu menghapus hanya pesan **terminal** (14 hari setelah berhenti bergerak), attempt yang sudah habis, binding yang dicabut (90 hari, setelah tidak ada yang merujuknya) dan kode tautan (1 hari setelah kedaluwarsa). Jendela adalah setelan di dalam batas deskriptor. Legal hold melewati penghapusan. Binding hidup dan pesan yang menunggu tidak pernah dihapus job mana pun. Setiap tabel punya deskriptor `dataLifecycle` dan jawaban `subjectData` ADR-0094; penghapusan seseorang menimpa ciphertext dan hash dengan sentinel penghapusan (skema mengizinkannya), setelah itu binding tidak dapat didekripsi.

## Permukaan admin

`/admin/telegram` (navigasi digerbangi `telegram_delivery.links.create`; layar terbuka bagi pemegang salah satu dari enam permission dan tiap panel digerbangi permission-nya sendiri): status, "chat Telegram saya" (tautkan, konfirmasi, tolak, putuskan), chat tertaut beserta pencabutan, saklar tenant, antrean dan attempt, dan template. Permission di-seed oleh `sql/218`.

## Catatan keamanan dan batas yang diketahui

- **Acknowledgement tidak diantrekan (penyimpangan tercatat dari ADR-0140 bagian 4).** Balasan untuk `/start` dan `/stop` adalah respons HTTP webhook (bentuk webhook-reply Bot API). Bagian 4 menyebut keduanya lewat antrean, tetapi baris antrean membawa binding dan tenant, balasan untuk kode tak dikenal tidak punya keduanya, dan `/stop` baru saja menghapus satu-satunya salinan id chat. Webhook karena itu tidak melakukan panggilan keluar dan tidak memegang token; biayanya balasan bersifat best effort dan tidak diatur lajunya oleh dispatcher. Lihat catatan implementasi pada ADR.
- **Request webhook yang ditolak diaudit secara agregat** pada tenant platform (paling banyak satu baris `warning` per menit, di-flush oleh penolakan berikutnya), karena request yang ditolak tidak punya tenant dan tidak mengerjakan apa pun. Nama alasan menghindari kata seperti "secret" karena redaktor audit mengosongkan kunci semacam itu.
- **Pemeriksaan principal menuliskan ulang `activeRoleGrants` dalam SQL** (`sql/217`) karena `awcms_worker` tidak boleh membaca tabel identitas; kedua definisi harus berubah bersama dan tes integrasi mengunci perilakunya (grant langsung, grant grup, tanpa grant, dinonaktifkan).
- **Id kunci tidak boleh dihapus dari cincin selama masih ada baris hidup yang membawanya**: ciphertext chat menyebut id kuncinya, dan baris hash tidak memegang plaintext untuk di-hash ulang.
- **Binding yang dipulihkan dari backup lama hidup kembali beserta ciphertext-nya.** Setelah restore, matikan lalu nyalakan saklar tenant (semua binding berakhir) dan minta staf menautkan ulang.
- **Tidak ada event domain yang diterbitkan.** Baris antrean, baris binding, dan log audit adalah buku besarnya.
- **Bentuk klaim.** Klaim dispatcher dan kedaluwarsa di purge memakai `WITH due AS MATERIALIZED (... LIMIT n FOR UPDATE SKIP LOCKED) UPDATE ... FROM due`, perbaikan Issue #1007 yang juga dibawa dispatcher email, push, dan WhatsApp; `queue-claim-limit.integration.test.ts` mencakup antrean ini juga.
- **Konsumen belum tersambung.** `booking.staff_reminder` dan `workflow_approval.approval_pending` (ADR-0140 bagian 1) didaftarkan modul pemiliknya di issue masing-masing; modul ini hanya mengirim `system.ops_alert`.
