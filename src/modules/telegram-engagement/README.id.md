🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:398af7db4476403dab61fe03609a1c576d9b70535c0b9a0db584f252c8c8c314 -->

# `telegram_engagement`

Percakapan Telegram **pelanggan** melalui bot milik tenant sendiri (Issue #1156, [ADR-0152](../../../docs/adr/0152-customer-telegram-engagement-is-a-separate-admitted-context-telegram-delivery-stays-staff-only.id.md); amplop inbound [ADR-0150](../../../docs/adr/0150-inbound-omnichannel-events-enter-as-verified-redacted-envelopes-with-no-generic-interactions-store.id.md); akun dan rahasia [ADR-0148](../../../docs/adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md), `channel_accounts` #1140).

Ini konteks yang **terpisah** dari [`telegram_delivery`](../telegram-delivery/README.id.md), yang tetap khusus staf dan tidak berubah (ADR-0140): modul ini tidak mengimpor apa pun darinya, tidak berbagi tabel, antrean, rute, token, atau pengaturan dengannya, dan menolak mendaftarkan bot staf. `tests/telegram-engagement-boundary.test.ts` menegakkannya (T-N1).

Status: `experimental`, **mati secara default** di tiga tingkat: deployment (`TELEGRAM_ENGAGEMENT_ENABLED`; setiap rute menjawab `404` dan job tidak mengklaim apa pun), registry modul, dan tenant (tidak ada yang terjadi sampai tenant mendaftarkan bot; toggle modul tenant juga mematikan webhook). Belum ada layar admin sehingga belum ada entri `navigation`; API lengkap dan setiap rute admin default-deny.

## Apa yang dilakukan (E1 dan E2 ADR-0152)

- **Banyak bot per tenant.** Bot adalah akun `channel_accounts` (provider `telegram`, kind `bot`, `external_id` = id numerik bot) yang terikat pada satu tenant dan satu business scope; tokennya adalah `channel_secret` tulis-saja milik akun itu. `POST /bots` mendaftarkannya untuk webhook terverifikasi. Pendaftaran DAN setiap rotasi menolak bot staf (prefiks numerik `TELEGRAM_BOT_TOKEN`), akun yang dicabut, dinonaktifkan atau bukan akun bot-token, dan akun tanpa token tersimpan; `getMe` konektor lalu mengikat TOKEN ke id akun, sehingga bot staf juga tidak bisa masuk lewat token yang ditukar.
- **Satu webhook terverifikasi per bot.** `POST /webhooks/{callbackToken}`. Token `tge1.<tenantId>.<endpointId>.<secret>` menyebut tempat mencari; rute membuka tenant ITU, membuktikan secret terhadap SHA-256 tersimpan, mewajibkan endpoint `active`, akun bot hidup, dan toggle modul tenant, lalu membandingkan `X-Telegram-Bot-Api-Secret-Token` secara constant-time. Baru sesudahnya body dibaca. Setiap kegagalan adalah satu `401` generik, dihitung dan diaudit sekali per menit secara agregat di tenant platform.
- **Ingesti idempoten.** Unik `(tenant, account, update_id)`; kontak, konsen, event, dan tanda terima di-commit dalam satu transaksi pendek, sehingga replay, retry Telegram, duplikat bersamaan, atau crash di antara ingest dan commit hanya berefek satu kali.
- **Aturan pengikatan.** Hanya chat privat; `from.is_bot` dibuang (tidak ada loop bot-ke-bot); chat id wajib sama dengan id pengirim; `/start` yang diteruskan (forward) adalah konten, bukan perintah; pesan yang diedit diabaikan. Akun wajib memegang kapabilitas `inbound` dengan bukti (ADR-0148 I2); bila tidak, update hanya dicatat tanda terimanya.
- **Kontak** hanya ada setelah `/start`: hash berkunci ber-scope akun atas id pengguna Telegram (orang yang sama di dua bot atau dua tenant menjadi dua baris tak berhubungan, TG8), chat id sebagai amplop AES-256-GCM, label tersamar yang diturunkan dari hash. Parameter deep-link `/start` pertama disimpan sebagai provenans, tidak pernah sebagai konsen.
- **Konsen** adalah bukti append-only per tujuan: `/start` hanya memberi `support`; `transactional` dan `marketing` membutuhkan prompt eksplisit (`POST /contacts/{id}/consent-prompts`, teks dan versi pemberitahuan, dua tombol), dan hanya tekanan pada pesan ITU untuk tujuan dan versi ITU yang dihitung. `/stop`, blokir (`my_chat_member` kicked), dan `403` dari provider mencabut semua tujuan seketika dan membatalkan baris antrean.
- **Outbound** (`POST /contacts/{id}/messages`) adalah antrean tahan-lama milik modul ini sendiri (ADR-0152 O1): ditujukan ke kontak, tidak pernah ke chat id; kelayakan dan kapabilitas `dm` diperiksa saat enqueue dan sekali lagi saat dispatch.
- **Event** (AsyncAPI): `awcms.telegram_engagement.interaction.received` (amplop ADR-0150: id, jenis, `provenance: secret_header`, `privacyClass`) dan `awcms.telegram_engagement.consent.changed`. Tidak pernah id Telegram, username, teks pesan, token, atau header. Inbox (#1164) dan awcms-one #460 mengonsumsinya.

## Job: `bun run telegram-engagement:dispatch` (setiap menit)

1. **Konektor**: untuk endpoint `pending`, `getMe` (id bot wajib sama dengan external id akun, yang sudah dipastikan bukan bot staf saat pendaftaran dan rotasi), lalu `setWebhook` dengan URL per bot, secret token turunan, dan `allowed_updates = [message, my_chat_member, callback_query]`; baru kemudian `active`, dan kesehatan akun dilaporkan `ok` (yang memindahkannya ke `connected`). Endpoint yang dicabut mendapat `deleteWebhook`. `401` dari Telegram bersifat terminal dan dilaporkan sebagai kesehatan gagal.
2. **Antrean**: klaim dengan lease dalam transaksi pendek; periksa ulang status kontak, konsen TERAKHIR, endpoint, kapabilitas `dm`, breaker, dan plafon harian per bot (tidak pernah di atas `TELEGRAM_ENGAGEMENT_DAILY_CAP`); kirim di luar transaksi apa pun lewat `ssrfSafeFetch` ke `api.telegram.org` dengan pacing per bot dan per chat; `429` diantrekan ulang setelah `retry_after` tanpa memakai anggaran retry; `403` memblokir kontak; galat jaringan atau timeout setelah permintaan terkirim adalah `uncertain` dan tidak pernah diulang, begitu pula baris yang lease-nya kedaluwarsa di tengah pengiriman; lima kegagalan provider beruntun membuka breaker bot. Teks dihapus di setiap status terminal.

### Role database milik dispatcher (`sql/353`, temuan audit H-2 PR #1260)

Job tersambung lewat `TELEGRAM_ENGAGEMENT_DATABASE_URL` sebagai **`awcms_telegram_engagement_dispatch`**, **tanpa fallback** (tanpanya job menolak berjalan; `config:validate` menolak deployment yang mengaktifkan modul tanpanya). Tidak ada role yang ada yang cocok: `awcms_app` melihat setiap secret kanal milik setiap tenant, sehingga job yang disusupi dan memegang `CHANNEL_SECRETS_ENCRYPTION_KEYS` dapat mendekripsi kredensial WhatsApp, Mailketing, dan sosial; `awcms_worker` tidak boleh pernah melihat token bot (`sql/328`, kalau tidak `whatsapp:dispatch` dapat membacanya). Karena itu pola ADR-0157 bagian 6 diikuti:

- NOLOGIN di migrasi; deployment mengaktifkan LOGIN dengan secret, seperti `awcms_worker`.
- Tidak ada privilege tingkat tabel di mana pun; hanya grant kolom yang disematkan pada lima tabel modul, kolom akun kanal yang dibaca dan ditulis pemeriksaan kapabilitas dan `recordAccountHealth`, outbox (`awcms_domain_events`, deliveries) untuk `consent.changed`, dan `awcms_tenants (id, status)`.
- Kebijakan RESTRICTIVE pada `awcms_channel_secrets` membatasi pandangannya pada `bot_token` milik akun `telegram`/`bot` hidup yang punya endpoint hidup (atau endpoint dicabut yang masih berutang `deleteWebhook`), dan `webhook_signing_secret` yang menjadi seed endpoint hidup. Kredensial bot yang dinonaktifkan atau dicabut hilang dari pandangannya pada pernyataan yang sama.
- TULISANNYA dibatasi per baris oleh enam kebijakan RESTRICTIVE lagi (audit ulang M-B): akun hanya `telegram`/`bot` yang hidup, dipindah ke `connected` atau `degraded`; baris health hanya milik bot hidup; konsen hanya `opt_out` oleh `provider_forbidden`; kontak hanya `started` -> `blocked`; outbox hanya `awcms.telegram_engagement.consent.changed` dari modul ini. Endpoint yang dicabut tidak pernah bisa dipersenjatai ulang (`provider_action` hanya `delete` -> NULL; guard di `sql/352`). Jadi role tidak bisa melebarkan pandangan secret-nya sendiri (mengaktifkan ulang bot yang dinonaktifkan), menyentuh akun modul lain, memalsukan konsen, atau memalsukan event lain.
- `security:readiness` (`checkTelegramEngagementDispatchRole`) menyematkan SETIAP kebijakan yang menyebut role itu secara PERSIS (deparse `pg_get_expr` ternormalisasi untuk USING dan WITH CHECK, restrictive, hanya role itu, perintahnya), lalu menguji perilakunya SEBAGAI role dalam transaksi yang di-rollback: token dan seed bot hidup terlihat; bot dinonaktifkan, bot yang dicabut penuh, kredensial WhatsApp, token sosial, dan token tenant lain tidak; dan setiap tulisan terlarang ditolak. Cek juga gagal pada grant tingkat tabel atau grant kolom yang bergeser. `awcms_worker` dan `sql/328` tidak disentuh.
- Runner TIDAK memberi job login bersama apa pun (audit ulang H-A): `dedicatedRoleTargets` di `scripts/jobs-env-allowlist.ts` menurunkan, dari closure impor, job yang menjangkau klien role khusus, dan `ops/run-job.sh` menahan `DATABASE_URL`, `WORKER_DATABASE_URL`, dan `SETUP_DATABASE_URL` darinya tanpa syarat. Job sendiri menolak mulai bila salah satunya ada di env-nya, dan memeriksa `current_user` tepat role dispatch dan bukan SUPERUSER maupun BYPASSRLS sebelum bekerja. `config:validate` menolak `TELEGRAM_ENGAGEMENT_DATABASE_URL` yang user-nya sama dengan user app atau worker.
- Residual (dinyatakan, tidak dihilangkan): dispatcher yang disusupi dan mengatur setelan tenant dapat membaca dan mendekripsi token bot pelanggan milik setiap tenant, dan hanya itu.

## API (`/api/v1/telegram-engagement`, OpenAPI `openapi/modules/telegram-engagement.openapi.yaml`)

| Rute                                 | Permission           | Catatan                                                                    |
| ------------------------------------ | -------------------- | -------------------------------------------------------------------------- |
| `POST webhooks/{callbackToken}`      | tidak ada (Telegram) | Token + header constant-time sebelum body; satu `401` generik              |
| `GET bots`                           | `bots.read`          | Bot yang boleh dilihat pemanggil; tidak pernah token, secret, atau URL     |
| `POST bots`                          | `bots.configure`     | Daftar; `Idempotency-Key`, step-up bersyarat, diaudit `warning`            |
| `POST bots/{id}/rotate`              | `bots.configure`     | Seed baru; URL dan header lama mati seketika (hard cut, O8)                |
| `POST bots/{id}/revoke`              | `bots.configure`     | Mengakhiri webhook, membatalkan antrean, job memanggil `deleteWebhook`     |
| `GET contacts?accountId=`            | `contacts.read`      | Kontak satu bot, tersamar, keyset                                          |
| `GET contacts/{id}`                  | `contacts.read`      | Kelayakan per tujuan, status 20 pesan terakhir                             |
| `POST contacts/{id}/erase`           | `contacts.delete`    | Mengakhiri kontak: ciphertext, label, dan hash dihapus; bukti disimpan     |
| `POST contacts/{id}/messages`        | `messages.create`    | Antrekan balasan atau pemberitahuan opt-in; tidak ada field chat id/handle |
| `POST contacts/{id}/consent-prompts` | `messages.create`    | Antrekan langkah opt-in eksplisit                                          |

`{id}` pada `bots/*` adalah **id akun channel** bot. Akses per akun milik `channel_accounts` (assignment, bypass administrator, ABAC business-scope lewat chokepoint yang sama); tidak dikenal, milik tenant lain, dan tak terlihat adalah `404` yang sama (T-I1).

## Data (`sql/350`, permission `sql/351`, guard `sql/352`)

Kelima tabel ber-scope tenant dengan RLS `ENABLE` + `FORCE` (`USING` dan `WITH CHECK`) dan foreign key komposit `(tenant_id, id)`.

| Tabel                                 | Retensi (`module.ts`)                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `awcms_telegram_engagement_endpoints` | Disimpan (satu baris hidup per bot; rotasi menambah baris dicabut)             |
| `awcms_telegram_engagement_contacts`  | Disimpan; diakhiri (dihapus di tempat) lewat rute erase                        |
| `awcms_telegram_engagement_consents`  | Disimpan selama horizon pembuktian; append-only (UPDATE dicabut dari app)      |
| `awcms_telegram_engagement_inbound`   | Purge generik, default 7 hari (1 sampai 90); append-only                       |
| `awcms_telegram_engagement_messages`  | Purge generik, default 30 hari (7 sampai 365); teks dihapus di status terminal |

Bukti konsen diurutkan dengan `evidence_seq` (identity yang diambil saat penulis memegang kunci baris kontak), tidak pernah dengan `recorded_at`: `now()` adalah AWAL transaksi, sehingga `/stop` yang transaksinya dimulai sebelum opt-in bersamaan ter-commit akan terurut lebih dulu dan kalah (temuan audit M-1 PR #1260).

Guard: identitas endpoint tak dapat diubah dan endpoint yang dicabut bersifat terminal (secret tidak pernah ditukar; rotasi adalah baris baru) dan akunnya wajib bot telegram yang hidup; kunci kontak hanya berubah pada pernyataan yang mengakhirinya, dan kontak yang diakhiri bersifat terminal; snapshot pesan tak dapat diubah, status terminal bersifat final dan teksnya hanya dapat dihapus. CHECK: `/start` hanya support, opt-in non-support membutuhkan tombol dan versi pemberitahuan, kontak yang diakhiri tidak menyimpan ciphertext atau label, pesan terminal tidak menyimpan teks.

## Konfigurasi

`TELEGRAM_ENGAGEMENT_ENABLED`, `TELEGRAM_ENGAGEMENT_KEYS` (cincin milik modul ini: chat id, teks antrean, hash kontak; wajib berbeda dari setiap cincin lain), `TELEGRAM_ENGAGEMENT_DATABASE_URL` (role milik dispatcher, ber-scope job, tanpa fallback), `TELEGRAM_ENGAGEMENT_DAILY_CAP`, `TELEGRAM_ENGAGEMENT_WEBHOOK_RATE_PER_MINUTE` (verifikasi GAGAL per alamat: permintaan terverifikasi tidak pernah dihitung, sehingga bot sibuk satu tenant tidak dapat men-throttle tenant lain), `TELEGRAM_ENGAGEMENT_ENDPOINT_RATE_PER_MINUTE`; juga membutuhkan `CHANNEL_ACCOUNTS_ENABLED`, `CHANNEL_SECRETS_ENCRYPTION_KEYS`, dan `APP_URL` sebagai origin `https` (URL webhook).

## Throttle webhook dan apa yang tidak pernah dibuangnya

- Per alamat pemanggil: hanya verifikasi GAGAL (dibebankan di depan, dikembalikan bila permintaan terverifikasi), sehingga sedikit alamat bersama milik Telegram tidak pernah di-throttle oleh lalu lintas sah satu tenant (temuan audit M-3).
- Per endpoint bot: setiap permintaan terverifikasi; bot yang melampaui batas mendapat `429` dan Telegram mencoba ulang.
- Per chat: hanya obrolan. Update yang dapat mengubah konsen (`/start`, `/stop`, blokir atau buka blokir, tombol opt-in atau penarikan) tidak pernah dibuang olehnya (temuan audit M-2).
- Setiap penolakan (verifikasi gagal, batas laju, body terlalu besar atau rusak) dihitung dan dikirim sebagai satu baris audit platform teragregasi per menit (temuan audit L-4).
- Batas body bebas-sesi di middleware mengecualikan tepat rute ini (`SESSION_FREE_BODY_ENDPOINTS`); `api:spec:check` kini gagal bila operasi body publik tidak dikecualikan atau pengecualian tidak punya operasi publik (temuan audit H-1).

## Risiko residual

- **Periksa-lalu-kirim (TOCTOU).** Dispatcher memeriksa ulang konsen, status kontak, endpoint, kapabilitas, breaker, dan plafon dalam satu transaksi dan mengirim pada langkah berikutnya, di luar transaksi apa pun (ADR-0006: tidak ada I/O provider sambil memegang kunci). `/stop` yang ter-commit di jendela itu tidak menghentikan pesan yang sudah diserahkan ke Telegram; ia membatalkan semua yang masih antre. Jendelanya satu perjalanan pulang-pergi provider (dibatasi timeout 10 detik).
- **Jangkauan role dispatcher**: lihat di atas.
- **Ketersediaan rate limit (dua celah diketahui).** (1) Bucket kegagalan per alamat dibebankan sebelum verifikasi dan dikembalikan sesudahnya, sehingga lonjakan permintaan sah yang datang bersamaan saat alamat itu dekat batas kegagalannya bisa sesaat mendapat `429` (Telegram mencoba ulang). (2) Tanpa Redis, limiter per proses: beberapa instance masing-masing memberi anggaran penuh, dan restart mengatur ulang. Keduanya tidak melemahkan verifikasi; keduanya kompromi ketersediaan, dan bucket per endpoint tetap mengisolasi banjir satu bot dari bot lain.

## Di luar cakupan (isu lain)

Publikasi ke channel (#1157, di `social_publishing`), inbox lintas-kanal (#1164, mengonsumsi event), aktivitas grup dan koneksi Telegram Business (tidak diterima, ADR-0152 bagian 7), broadcast, layar admin.

## Keputusan terbuka (dicatat, tidak ditebak)

- **Q4 ADR-0150, isi pesan.** Dijawab fail-closed: tidak ada isi yang disimpan atau diterbitkan. Konsumen melihat bahwa pesan masuk (jenis, waktu, kontak), bukan isinya, sampai desain `content_ref` diterima.
- **Bukti tautan T-C2 (ADR-0152 bagian 6, metode (a)).** Kode sekali-pakai first-party yang menautkan kontak ke orang CRM membutuhkan `contact_link_evidence`, milik #1144 yang belum dibangun. Tidak diimplementasikan di sini; username, nama tampilan, atau forward tidak pernah diperlakukan sebagai bukti.
- **Role DB dispatcher.** Diputuskan orchestrator setelah audit: role sendiri (lihat di atas). Penjadwalannya tetap langkah deployment: role dikirim NOLOGIN.
- **Satu pembacaan database sebelum pemeriksaan header.** ADR-0152 meminta pemeriksaan header "sebelum membaca body atau pekerjaan database apa pun", sekaligus menyimpan secret lewat referensi (bagian 3). Keduanya tidak bisa sama-sama berlaku; rute membaca satu baris berdasarkan primary key (endpoint yang disebut token) dan mendekripsi seed-nya sebelum perbandingan header, dan tidak membaca body sebelumnya. Throttle per alamat membatasi biaya token palsu.
- **Default tingkat tenant.** Module Management memperlakukan ketiadaan baris tenant sebagai aktif. "Mati secara default untuk tenant" karena itu berarti "tidak ada yang terjadi sampai tenant mendaftarkan bot"; toggle tenant tetap dapat mematikannya.
- **Jendela retensi dan plafon harian** (ADR-0152 O3, O10) adalah default usulan untuk dikonfirmasi maintainer dan controller.
- **Fakta bertanda "to verify" di ADR-0152** (charset secret token, angka pacing, nama `allowed_updates`) mengikuti dokumentasi publik Bot API sebagaimana tertulis di ADR dan tidak diverifikasi ulang terhadap bot hidup.
