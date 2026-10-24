🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](omnichannel-ui-ux-screen-contracts.md)

<!-- i18n-source-hash: sha256:cef0f1951df84621646a8ae386290716c9bc0e68803e335314c5cab2ebad2e0c -->

# AWCMS — Kontrak UI/UX upstream Omnichannel v1.0

**Status: spesifikasi rencana, 24 Oktober 2026**, issue [#1174](https://github.com/ahliweb/awcms/issues/1174). Melengkapi [matriks parity admin](admin-ui-parity-matrix.id.md) dan [desain CRM penuh di AWCMS-One](https://github.com/ahliweb/awcms-one/issues/472). Status implementasi mengikuti main, bukan mockup.

## 1. Fondasi dan batas otoritas

AWCMS saat ini memiliki admin Astro, email/Mailketing **v1**, newsletter dan suppression, WhatsApp Meta/Fonnte/log, Web Push, Telegram notifikasi staf dan Control Center OMES. Port social publishing yang noop tidak berarti provider sosial terhubung. Customer master dan segmen/kampanye commerce tetap milik AWCMS-One; upstream tidak membuat customer master atau antrean kedua. Gunakan komponen admin.css dan token existing, bukan sistem UI lain.

Bun stabil terverifikasi **1.4.4** (22 Okt), kini dipin di repositori ([#1172](https://github.com/ahliweb/awcms/issues/1172)). Mailketing API target **v2.0.2** (23 Okt), adapter kode masih v1 → [#1159](https://github.com/ahliweb/awcms/issues/1159). Pembaruan dependency harus terpantau/teruji [#1173](https://github.com/ahliweb/awcms/issues/1173); tidak otomatis menganggap semua terbaru.

## 2. Inventaris layar AWCMS

| ID    | Layar                                           | Status                    | Rujukan                  |
| ----- | ----------------------------------------------- | ------------------------- | ------------------------ |
| UP-01 | Email templates, antrean dan announcement       | SUDAH ADA                 | modul email              |
| UP-02 | Suppression email                               | SUDAH ADA                 | /admin/email-suppression |
| UP-03 | Newsletter dan opt-in                           | SUDAH ADA                 | modul newsletter         |
| UP-04 | WhatsApp generik                                | SUDAH ADA                 | /admin/whatsapp          |
| UP-05 | Web Push                                        | Backend SUDAH ADA         | push_delivery            |
| UP-06 | Telegram staf                                   | Backend SUDAH ADA         | telegram_delivery        |
| UP-07 | OMES Control Center                             | SUDAH ADA, berizin        | /admin/omes/*            |
| UP-08 | Channel Hub multi-akun/izin                     | RENCANA                   | #1139/#1140/#1154        |
| UP-09 | StarSender banyak device, Meta banyak nomor     | RENCANA                   | #1141–#1143              |
| UP-10 | Mailketing API v2 multi-akun/sender/kredit/list | RENCANA                   | #1158–#1162              |
| UP-11 | Telegram pelanggan/bot/channel                  | RENCANA                   | #1155–#1157              |
| UP-12 | Facebook/IG/TikTok/YouTube/LinkedIn/Threads     | RENCANA/RISET             | #1145–#1152              |
| UP-13 | Lead/prospect/pipeline                          | RENCANA                   | #1163/#1166              |
| UP-14 | Unified inbox/assignment/SLA                    | RENCANA                   | #1144/#1164              |
| UP-15 | Follow-up rules/task/calendar                   | RENCANA                   | #1165                    |
| UP-16 | SSE/WS progress gateway                         | BELUM ADA, ADR lebih dulu | #1168/#1171              |

## 3. Kontrak alur per layar

**UP-01–03 Email dan newsletter yang sudah ada:** tabel template berisi key/kategori/lokal/versi/editor, preview dan tes sintetis tanpa penerima nyata; announcement hanya pada audience yang diizinkan; suppression menunjukkan penerima masked, alasan, sumber, effective date dan konfirmasi. Newsletter mempertahankan double opt-in serta unsubscribe. Marketing consent lintas-kanal tidak boleh disimpulkan dari subscription newsletter.

**UP-04 WhatsApp yang sudah ada:** antrean/status, upaya terakhir, kelas tujuan security/transactional/marketing, consent, suppression, retry/expired serta provider accepted terpisah dari verified delivered. OTP disanitasi. Pengirim saat ini masih konfigurasi deployment; selector multi-tenant baru tampil sesudah #1141 benar-benar dibangun. Cutover legacy commerce ke queue upstream harus menjaga data dan tidak mengirim ganda.

**UP-08 Channel Hub:** daftar provider/alias/tenant/brand/capability/secret reference/token expiry/quota/last verified; wizard pilih provider→OAuth/API token server-side→verifikasi scope→tes capability→izin operator/brand→consent/risk review→default→save. Disconnect memperlihatkan dampak pesan antrean. Token mentah dan hubungan lintas-tenant tidak ditampilkan. Error token dicabut, webhook palsu dan izin tidak cukup dinyatakan eksplisit.

**UP-09 Multi-nomor WhatsApp:** StarSender device alias/nomor tersamarkan, identitas device, koneksi, penerimaan risiko, quota; Meta WABA/phone ID serta kemampuan template. Default per tenant/brand, tanpa default global. LPP ENTER boleh menetapkan StarSender default setelah persetujuan risiko dan Meta alternatif manual, bukan menjadikan StarSender layanan Meta resmi. Antrean menyimpan sender yang dipilih. Status UNVERIFIED/BLOCKED/EXPIRED/DISCONNECTED/WEBHOOK_UNTRUSTED/READY/UNKNOWN_DELIVERY; tidak ada rotasi anti-ban atau fallback diam-diam.

**UP-10 Mailketing v2.0.2:** saat adapter v1 aktif, tampilkan banner “Migrasi v2 diperlukan”. Akun/sender/domain terverifikasi, kredit dengan timestamp, referensi token backend, mapping list/segmen, riwayat kirim dan suppression. Endpoint yang boleh diasumsikan hanya **POST /api/v2/send; GET /credits, /senders, /lists; POST /subscribers**. Tidak mengarang API create/delete campaign/list atau unsubscribe remote. **message_id v2.0.2 selalu dibuat provider**; queue ID internal berbeda. HTTP accepted bukan delivered. 401/402/403/422/429/5xx punya status tindakan; webhook tanpa bukti autentikasi tidak dapat mengubah consent. Cutover v1→v2 bertahap dan dapat di-rollback.

**UP-11 Telegram:** bot/channel masked ID, admin rights, scope chat, status webhook dan akun. Telegram staf terpisah dari CRM pelanggan. Customer hanya bisa dikontak bila Bot API dan interaksi/consent memenuhi syarat. Tampilkan error bila bot dicopot sebagai admin channel.

**UP-12 Social:** capability matrix per Facebook Pages/Messenger, Instagram Professional, TikTok, YouTube, LinkedIn Pages, Threads dan platform fase berikutnya. DM yang tidak didukung **tidak** menjadi tombol aktif. Kalender posting membutuhkan media berlisensi, caption, alt text, preview, akun target, approval, schedule dan provider post ID. Jalur noop tidak berarti publish sukses.

**UP-13–15 Leads, Inbox dan Follow-up:** list lead dengan stage berversi, owner, akun sumber, due dan PII masked; detail tab Timeline/Consent/Tasks/Interactions; transisi tahap valid dan optimistik revision. Inbox dua pane, tab Mine/Team/Overdue, internal notes tidak keluar ke kontak, reply hanya jika provider mengizinkan; tabrakan dua operator/AI harus mencegah double send. Worklist serta rule builder WHEN→IF→THEN, preview, kalender kerja, rate cap, approval dan stop saat reply/convert/unsubscribe. Hubungan customer commerce melalui kontrak publik, bukan baca tabel internal.

**UP-16 Realtime Bun:** belum aktif sebelum ADR #1168. SSE Bun satu arah untuk progres kampanye/inbox, WebSocket native Bun hanya kebutuhan dua arah. Origin/tiket singkat/otorisasi tenant, rate dan backpressure, reconnect/snapshot, payload teredaksi dan multi-instance; status tidak boleh mengganti DB atau bukti provider. Browser ditutup membutuhkan Web Push.

## 4. Design system dan status UI

Setiap rute memakai header tenant/izin, freshness, tabel berpaginasi, filter/reset, empty/loading/error/permission/stale/unknown. Desktop dua panel bila relevan; mobile satu panel dan detail drawer. Keyboard, focus restore, WCAG AA, status label + ikon serta tabel alternatif grafik. 403, 409, 429, 5xx diberi alasan aman. Bulk toolbar hanya jika memang terdapat endpoint bulk yang diotorisasi. Jangan tampilkan secret, data antar-tenant atau klaim provider yang tidak didukung.

## 5. Syarat uji dan rilis

Dua tenant dengan email/nomor sama tidak boleh memilih sender atau thread lain. Mailketing v2 diuji dengan message_id buatan server, kredit, sender dan error semantik; StarSender/Meta berbeda kemampuan; provider accepted bukan delivered. Periksa role dicabut, consent, webhook palsu, crash queue, tampilan 360px dan keyboard, terjemahan dan redaksi data. Worker memakai Bun versi repo; pin Bun 1.4.4 sudah masuk via #1172, audit berkala #1173, SSE/WS #1168. Jalankan bun test, bun run check, uji DB/FORCE RLS, OpenAPI/AsyncAPI dan dokumentasi EN/ID. PR dokumen ini **tidak** mengimplementasikan route/API baru.
