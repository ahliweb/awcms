🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0151-mailketing-v2-and-multi-account-email-reuse-the-single-email-queue-and-never-trust-an-unauthenticated-callback.md)

<!-- i18n-source-hash: sha256:db2f44d4396c52823d5fb3eb6c06179c89a688cb34498b56d1dc73f168bff7e4 -->

# ADR-0151 — Mailketing v2 dan email multi-akun memakai ulang satu antrean `email`, dan callback provider tanpa autentikasi tidak pernah mengubah state pelanggan

- **Status:** Diusulkan
- **Tinjauan:** menjadi Diterima setelah maintainer meninjaunya. Issue #1159 sampai #1162 tetap terblokir sampai saat itu. Hanya dokumen: tidak ada di sini yang menjadi bukti bahwa adapter v2, routing multi-akun, atau webhook berfungsi.
- **Tanggal:** 2026-10-27
- **Pengambil keputusan:** ahliweb (menunggu tinjauan maintainer)
- **Menyelesaikan:** Issue #1158 (manajemen email Mailketing multi-akun, migrasi v2, dan kepemilikan CRM). Ini adalah ADR email yang oleh [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) §9 diserahkan kepada issue ini.
- **Memperluas, tidak menggantikan:** [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) (I1 sampai I13, matriks §3, kredensial §5). Ia mematuhi ketiga belas invarian. Ia memperlakukan koneksi Mailketing sebagai `channel_account` dan menerapkan amendemen §5 atas ADR-0074/0133 hanya untuk akun email **milik tenant**. [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.id.md) (satu antrean per kanal, kelas tujuan, persetujuan terlepas dari segmen), [ADR-0139](0139-cross-channel-notification-orchestration-not-admitted.id.md) (tanpa fasad, tanpa fallback), [ADR-0103](0103-newsletter-is-its-own-module.id.md) (`newsletter` memiliki persetujuan), [ADR-0006](0006-offline-first-sync-outbox.id.md) (I/O provider di luar transaksi), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md), ADR-0150 (Diusulkan di branch #1144) (gerbang verifikasi inbound dan aturan "tanpa provenance terautentikasi, tanpa perubahan state").
- **Terkait:** Issue #1139, #1140 (registri akun), #1154, #1159, #1160, #1161, #1162, #1167, #1168, #1172; hilir `ahliweb/awcms-one` #458, #459, #461 beserta segmen dan kampanye `commerce`-nya (#114, #360, #362); draf keterlacakan UI (PR #1175, UP-01..16); paket kesiapan [`docs/awcms/omnichannel-foundation.id.md`](../awcms/omnichannel-foundation.id.md) §2, §3, §5.

**Hanya dokumen dan tata kelola.** Tidak ada modul, tabel, migrasi, rute, path OpenAPI, kanal AsyncAPI, dependensi, atau panggilan provider yang ditambahkan. Penerimaan berarti **desain diadmisi**; setiap issue #1159 sampai #1162 tetap melewati Definition of Ready-nya sendiri dan tinjauan keamanan untuk kredensial dan webhook.

## Konteks

Terverifikasi di `main` pada 27 Oktober 2026 (keadaan yang **sudah diimplementasi**):

- `src/modules/email/infrastructure/mailketing-provider.ts` mengimplementasi **Mailketing v1**: `POST {baseUrl}/api/v1/send`, `application/x-www-form-urlencoded`, `api_token` **di body request**, respons `{status, response, message_id?}`; `status:"failed"` pada HTTP 2xx adalah penolakan bisnis yang tidak dapat di-retry; jaringan, timeout, dan 5xx dapat di-retry; circuit breaker per provider (`email-mailketing`) hanya menghitung kegagalan tingkat layanan. Panggilan memakai `fetch` dengan base URL dari konfigurasi.
- `resolveEmailProvider` memilih **satu** provider untuk seluruh deployment dari `EMAIL_PROVIDER`, `EMAIL_MAILKETING_API_TOKEN`, dan `EMAIL_MAILKETING_API_BASE_URL`. `EMAIL_MAILKETING_ACCOUNT_ID` adalah label untuk operator yang tidak pernah dikirim ke provider. Pengirim berasal dari pengaturan deployment (`EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`). `awcms_email_messages` tidak punya kolom pengirim atau akun dan tidak punya kelas tujuan (hanya `category`).
- Modul `email` sudah menjadi outbox tahan lama: `email-dispatch` ber-lease, retry, template dengan allow-list variabel per kategori, `awcms_email_delivery_attempts`, dan daftar suppression (`awcms_email_suppression_list`, layar admin #544) yang **diperiksa ulang dispatcher tepat sebelum kirim**. `provider_message_id` disimpan per pesan. Trade-off yang diterima adalah satu kemungkinan pengiriman ganda bila crash terjadi di antara "provider menerima" dan finalisasi.
- `newsletter` (ADR-0103) memiliki persetujuan langganan, konfirmasi, dan unsubscribe. `commerce` (awcms-one) hilir memiliki pelanggan, segmen, kampanye, dan fan-out WhatsApp/email.
- **Tidak ada webhook email inbound** di repositori ini.

Yang didokumentasikan provider (dokumentasi resmi, **per 24 Oktober 2026**, yang diverifikasi ulang oleh issue implementasi):

- **API v2.0.2 (2026-10-23)**, base `https://api.mailketing.co.id/api/v2`: `POST /send` (JSON), `GET /credits`, `GET /senders`, `GET /lists`, `POST /subscribers`. Autentikasi lewat header, `Authorization: Bearer` atau `X-Api-Token`. Respons `{success, data.message_id}`. **Tidak ada CRUD kampanye generik, pembuatan atau penghapusan list, atau endpoint unsubscribe atau hapus subscriber yang terdokumentasi.**
- **Koreksi breaking v2.0.2:** `message_id` **selalu dibuat provider** dan tidak dapat diberikan saat kirim. Changelog menjadi otoritas bila prosa field request yang dirender tertinggal; fixture kontrak sandbox mengonfirmasi.
- `success:false` pada HTTP 200 adalah kegagalan; `success:true` berarti **antre**, bukan terkirim. Status terdokumentasi yang relevan: 401, 402 (tanpa kredit), 403 (pengirim belum terverifikasi), 422 (tidak valid), 429 (dengan `Retry-After`), 5xx. Kebijakan laju membatasi **30 request gagal per menit per IP** (sejak v2.0.1); ia membatasi kegagalan, bukan keberhasilan.
- Event webhook: `emailopen`, `emailclick`, `bounce`, `newsubscriber`, `unsubscribe`; `delivered` **hanya Business API**. **Tidak ada tanda tangan atau verifikasi HMAC pada dokumentasi publik yang ditinjau.**
- Persyaratan pemilik produk: Mailketing **v2** adalah transport produksi target; v1 tidak boleh tetap menjadi transport produksi aktif.

Yang belum terbukti dan tidak boleh diasumsikan ADR ini: kunci idempotensi sisi provider, API unsubscribe atau hapus jarak jauh, webhook terautentikasi, daftar IP sumber, atau endpoint polling status pesan.

## Keputusan

### 1. Satu keluarga adapter, dua versi: migrasi dengan pembalikan bertahap, bukan penulisan ulang di tempat

Dua adapter berversi berada di belakang port `EmailProvider` yang ada (`createMailketingV1Provider` adalah kode hari ini, tidak berubah; `createMailketingV2Provider` baru). Versi adalah properti **koneksi** (dan, untuk pengirim deployment lama, satu variabel env baru `EMAIL_MAILKETING_API_VERSION`, default `v1` sampai pembalikan). Port, antrean, dispatcher, template, suppression, dan buku attempts tidak berubah bentuk. Akun `null` mempertahankan perilaku hari ini byte demi byte (ADR-0148 I13).

Tahap rollout (masing-masing gerbang terpisah, dan tidak ada yang membalik produksi tanpa konfirmasi vendor sungguhan dan jalur rollback):

| Tahap | Keadaan                                                                                                     | Gerbang masuk                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0     | Hari ini: v1, se-deployment                                                                                 | tidak ada                                                            |
| 1     | Adapter v2 ada, flag mati; fixture kontrak sandbox lulus                                                    | #1159 merge                                                          |
| 2     | v2 dipakai di staging terhadap vendor sungguhan (pengirim sekali pakai), health baca-saja di produksi       | Kriteria Q3 terpenuhi, pemilik menandatangani                        |
| 3     | **v2 menjadi default** untuk koneksi baru dan pengirim lama; v1 tetap dapat dipilih                         | Bukti tahap 2 tercatat                                               |
| 4     | v1 hanya sebagai rollback eksplisit, teraudit, berbatas waktu (panjang jendela: Q2); lalu issue penghapusan | Tahap 3 stabil; issue pelacak untuk menghapus v1 dibuka pada tahap 3 |

Spesifik v2 yang wajib dipatuhi adapter: kredensial di **header saja** (tidak pernah query, tidak pernah body, tidak pernah di-log); body JSON; `success:false` pada 200 adalah kegagalan; `success:true` adalah "diterima/antre" (dipetakan ke `sent` dengan catatan bahwa `delivered` tidak diketahui, seperti WhatsApp di ADR-0148 §4); `data.message_id` pada respons disimpan sebagai `provider_message_id` **setelah penerimaan** dan **bukan** kunci idempotensi. Id antrean internal yang imutabel tetap berbeda darinya. Crash setelah provider menerima tetapi sebelum finalisasi bersifat **tidak pasti** (kemungkinan duplikat saat re-claim), persis trade-off terdokumentasi yang ada; tidak ada klaim dedupe sisi provider.

Klasifikasi error (dipetakan ke aturan `retryable` dan breaker yang ada):

| Respons                               | Arti                           | Hasil pesan                                                                               | Efek pada akun / koneksi                                                                           |
| ------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 200 `success:true`                    | Diantrekan provider            | `sent` (diterima), simpan `provider_message_id`                                           | breaker sukses                                                                                     |
| 200 `success:false`                   | Ditolak provider               | `failed`, tidak dapat di-retry                                                            | tidak ada (provider hidup)                                                                         |
| 401                                   | Token tidak valid atau dicabut | `failed`, tidak dapat di-retry                                                            | koneksi `degraded` (auth); **berhenti meng-claim**; tindakan operator                              |
| 402                                   | Tanpa kredit                   | ditahan, tidak dibakar: kembali ke `retry_wait` dengan lease panjang, tanpa belanja retry | koneksi `degraded` (kredit); dispatch koneksi itu berhenti sampai `GET /credits` menunjukkan saldo |
| 403                                   | Pengirim belum terverifikasi   | `failed`, tidak dapat di-retry                                                            | akun pengirim `unverified`; tidak ada pergantian otomatis ke pengirim lain (I5)                    |
| 422                                   | Pesan tidak valid              | `failed`, tidak dapat di-retry                                                            | tidak ada                                                                                          |
| 429                                   | Dibatasi laju                  | dapat di-retry, hormati `Retry-After`                                                     | dihitung ke breaker                                                                                |
| 5xx / timeout / jaringan / bukan JSON | Masalah layanan                | dapat di-retry, terbatas                                                                  | dihitung ke breaker                                                                                |

Karena batas vendor menghitung **request gagal per IP**, dan tenant dalam satu deployment berbagi IP keluar, satu token tidak valid milik satu tenant dapat mengunci semua tenant. Adapter karena itu memiliki **anggaran kegagalan per koneksi** (4xx berturut-turut menghentikan claim koneksi itu sebelum ambang IP) dan membatasi lalu lintas keluar secara lokal, selain circuit breaker per koneksi (hari ini kunci breaker global; kunci per koneksi menjadi bagian #1159/#1160).

### 2. Akun: setiap koneksi Mailketing adalah `channel_account` di registri #1140

Menurut ADR-0148: **koneksi Mailketing** adalah `channel_provider_connection` bermode auth `api_token` (bukan OAuth); setiap **identitas pengirim terverifikasi** adalah `channel_account` anak (jenis `email_sender`) dari koneksi itu; token API adalah `channel_secret` (terenkripsi envelope, dirujuk lewat id buram, tidak pernah dikembalikan). Tenant boleh memiliki banyak koneksi, dan tiap koneksi mengekspos banyak alamat atau domain pengirim (dibaca dari `GET /senders`). Business scope (brand) dipetakan ke akun pengirim; pemetaan bersifat **prospektif** (kebijakan dengan versi konfigurasi) dan **di-snapshot imutabel** pada setiap pesan yang diantrekan.

- Antrean `email` tetap **satu-satunya** antrean. `awcms_email_messages` mendapat `sender_account_id` nullable dan imutabel (kunci pengirim, seperti ADR-0148 §4). `null` adalah pengirim deployment dan perilaku hari ini. Tidak ada antrean per akun, brand, atau tenant.
- Dispatcher menyelesaikan koneksi, secret, dan pengirim dari catatan **tenant terautentikasi** saat claim, tidak pernah dari input request; secret didekripsi hanya di dalam panggilan kirim untuk tenant baris yang di-claim (mitigasi ADR-0148 §5).
- Token koneksi milik tenant tidak pernah token deployment dan token deployment tidak pernah dipakai untuk akun milik tenant. Email sistem milik deployment (reset password, pemberitahuan keamanan) tetap memakai pengirim deployment (Q7).
- **Tidak ada rotasi pengirim otomatis** untuk menghindari skor reputasi, batas, atau blokir (I4, I5). Pengirim yang dinonaktifkan, belum terverifikasi, dicabut, atau milik tenant lain membuat enqueue menolak dengan `SENDER_UNAVAILABLE` dan baris yang di-claim terminal `failed`.
- Domain hanya dapat dipakai bila provider melaporkan pengirim terverifikasi; status SPF, DKIM, dan DMARC dibaca lewat pemeriksaan DNS baca-saja dan ditampilkan sebagai **bukti penasihat** beserta tanggal pemeriksaan terakhir (Q9). Rekaman yang gagal tidak pernah diam-diam mengganti pengirim.

Registri vs tabel terpisah. Dipilih: registri (#1140). Tabel `email_provider_connection` terpisah akan menduplikasi penanganan secret, health, assignment, dan bukti kapabilitas yang sudah dirancang untuk C1 dan menjadi implementasi kedua bagian paling sensitif. Biayanya adalah ketergantungan keras: #1160 tidak dapat mulai sebelum #1140 punya model dan tinjauan keamanannya.

### 3. Peta kepemilikan (siapa otoritatif atas apa)

| Urusan                                                                | Otoritas                                                             | Yang dipegang Mailketing                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Antrean outbound, dispatch, attempts, template                        | `email` hulu                                                         | tidak ada yang otoritatif; ia menerima sebuah request                     |
| Suppression (bounce, complaint, unsubscribe, manual)                  | `email` hulu                                                         | state internalnya sendiri, **tidak pernah** dibaca balik sebagai otoritas |
| Persetujuan langganan, konfirmasi, unsubscribe                        | `newsletter` hulu (ADR-0103); `commerce` untuk pelanggannya di hilir | tidak ada                                                                 |
| Pelanggan, segmen, kampanye pemasaran                                 | `commerce` hilir (awcms-one #461)                                    | tidak ada                                                                 |
| Akun, secret, pemetaan pengirim, bukti kapabilitas                    | `channel_accounts` hulu (#1140)                                      | id pengirim dan id list eksternal sebagai referensi                       |
| Analitik transport (kredit, diterima, event yang dilaporkan provider) | ditampilkan sebagai **dilaporkan provider**, bukan kebenaran dasar   | angka mentahnya                                                           |

List Mailketing (`GET /lists`, `POST /subscribers`) adalah **referensi eksternal**, bukan otoritas. Rekomendasi: pekerjaan multi-akun **tidak** mendorong subscriber ke list Mailketing sama sekali (Q5): kampanye kami fan-out lewat antrean sendiri, satu penerima per pesan, seperti hari ini, sehingga list jarak jauh hanya menambah salinan kedua data pribadi dan permukaan persetujuan kedua tanpa kapabilitas yang kami butuhkan. `GET /lists` boleh ditampilkan baca-saja. List jarak jauh tidak pernah diimpor sebagai bukti izin.

### 4. Kelas tujuan, persetujuan, dan prioritas suppression

`awcms_email_messages` mendapat `purpose` imutabel (`transactional` / `security` / `marketing`; Q8 menentukan di mana klasifikasi dibuat). Aturan, dievaluasi **saat enqueue dan sekali lagi tepat sebelum dispatch** (ADR-0133 §4; dispatcher sudah memeriksa ulang suppression):

1. **Suppression keras** (hard bounce, spam complaint, blokir manual) menghentikan semua tujuan kecuali bila hukum mensyaratkan pemberitahuan keamanan dan alamatnya dapat dikirimi; tidak ada jalur override dari kampanye.
2. **Unsubscribe atau penarikan persetujuan** hanya menghentikan `marketing`. Ia tidak pernah memblokir email `security` atau `transactional`, dan opt-out pemasaran tidak pernah men-suppress reset password.
3. **`marketing`** mensyaratkan referensi bukti persetujuan yang tercatat dan masih berlaku dari `newsletter` (atau persetujuan pelanggan hilir untuk kampanye `commerce`) ditambah mekanisme unsubscribe dalam pesan. Keanggotaan segmen, list jarak jauh, atau berkas impor tidak pernah menjadi persetujuan (I8).
4. Suppression dan penarikan menang atas semua yang sudah diantrekan.
5. **Propagasi penarikan:** Mailketing tidak mendokumentasikan endpoint hapus atau unsubscribe, sehingga suppression hulu adalah otoritas dan tidak ada yang "dipanggil" jarak jauh. Bila penerima pernah didorong ke list jarak jauh (tidak direncanakan, Q5), penghapusan adalah **alur kerja operator**: butir daftar periksa dengan tugas teraudit dan laporan rekonsiliasi penerima yang masih ada di jarak jauh. Kami tidak pernah memalsukan panggilan HTTP yang tidak ada.

### 5. Webhook: tanpa provenance terautentikasi, tanpa perubahan state

Dokumentasi publik yang ditinjau tidak menunjukkan tanda tangan atau HMAC. ADR-0148 §3 sudah menandai inbound email `restricted`, dan ADR-0150 I9/N5 melarang memperlakukan kerahasiaan URL sebagai autentikasi untuk konten yang mengubah state pelanggan. Keputusan untuk #1161, dalam dua mode dengan default aman:

- **Mode `strict` (default sampai Q1 dijawab).** Endpoint hanya ada di balik flag dan menerima event, tetapi **tidak ada event yang mengubah suppression, persetujuan, status pesan, subscriber, atau pelanggan**. Setiap event divalidasi (batas ukuran, bentuk JSON, token callback buram per koneksi yang disimpan ter-hash, dedupe replay pada `(account, event type, provider_message_id, recipient hash, timestamp)`), diatribusikan ke tenant, koneksi, dan **`provider_message_id` kami sendiri** (event untuk id yang tidak kami terbitkan dibuang), dan ditulis ke **buku karantina** yang ditampilkan kepada operator sebagai "dilaporkan provider, tidak terautentikasi". Operator boleh mengonfirmasi bounce atau unsubscribe ke daftar suppression (keputusan manusia yang teraudit).
- **Mode `restrictive-only` (butuh persetujuan maintainer, Q1).** Tambahan: event yang cocok dengan pesan yang kami terbitkan boleh **menambah** suppression untuk `bounce` atau `unsubscribe` (arah restriktif yang aman-gagal: ia dapat menghentikan email, tidak pernah menciptakan persetujuan atau mengirim lebih banyak). Risiko pemalsuan adalah suppression iseng atas satu penerima (rendah), dimitigasi oleh pengikatan message-id, token buram, dan suppression yang teraudit dan dapat dibalik.
- Pada kedua mode: `emailopen` dan `emailclick` hanya **penghitung**, berlabel tidak terautentikasi, tidak pernah bukti dibaca (proxy gambar dan pemindai keamanan membuka dan mengklik) dan tidak pernah dipakai untuk penilaian atau state pelanggan; `newsubscriber` diabaikan (tidak boleh membuat subscriber atau persetujuan); tautan terlacak mentah pada event click disimpan sebagai host plus hash dan dirender sebagai teks, tidak pernah tautan yang dapat diklik dan tidak pernah diambil; `delivered` tidak diharapkan pada tier API ini dan tidak pernah disimpulkan.
- **Kontrol kompensasi yang bergantung pada vendor** diminta di Q6 (header bertanda tangan atau header secret yang dapat dikonfigurasi, daftar IP sumber terpublikasi, id event). Bila vendor menambahkan mekanisme yang dapat diverifikasi, mode `authenticated` diadmisi lewat amendemen ADR satu baris dan gerbang verifikasi ADR-0150; sampai saat itu sel matriks tetap `restricted`.
- Endpoint berjalan di bawah Bun yang dipin, tidak melakukan pekerjaan database sebelum pemeriksaan token dan ukuran, membatasi laju per koneksi, dan mengagregasi audit penolakan seperti ADR-0140 §9 (ADR-0150 §4).

### 6. Keamanan, privasi, dan operasi

- **I/O provider** hanya dari antrean Bun tahan lama (`ssrfSafeFetch` ke host provider yang **tetap, dikonfigurasi deployment**, tidak pernah disuplai tenant; timeout terbatas; breaker per koneksi). SSE atau WebSocket boleh menampilkan state antrean teredaksi kepada pengguna berwenang dan tidak pernah menjadi pengakuan pengiriman atau jalur kirim (#1168).
- **Secret:** autentikasi header saja; dimasker di mana-mana; tes canary bahwa token yang diketahui tidak pernah mencapai log, respons, event, payload job, atau UI.
- **Health dan biaya:** job health membaca `GET /credits` dan `GET /senders` (baca-saja) ke health per koneksi (saldo, status pengirim, sinkronisasi terakhir). Perkiraan kredit adalah rata-rata bergerak penasihat atas pengiriman terkini terhadap saldo (Q11 menentukan lingkupnya). Batas kirim per koneksi dan per tenant, anggaran harian, dan **jeda** otomatis (bukan rotasi) pemasaran bila laju complaint atau bounce melewati ambang.
- **UU PDP No. 27/2022:** data yang keluar ke Mailketing adalah alamat penerima, pengirim, subjek, dan isi tiap pesan (data pribadi dan mungkin konten pribadi); Mailketing adalah prosesor yang lokasi dan ketentuannya wajib dicatat **pengendali** (pengungkapan lintas negara, Pasal 56), dengan perjanjian pemrosesan (Q10); minimisasi (tanpa atribut tambahan, tanpa sinkronisasi list, Q5); kelas tujuan (§4); log hanya membawa alamat termasker (`email-log-redaction` yang ada); penghapusan atas permintaan subjek data menghapus penerima dari tabel kami, dan salinan jarak jauh dibatasi retensi provider sendiri, diungkapkan kepada pengendali.
- **RLS `FORCE`** dengan `USING` dan `WITH CHECK` serta kunci komposit `tenant_id` pada setiap tabel baru; ABAC default-deny; izin baru di-seed migrasi dalam perubahan yang sama dengan rutenya (nama difinalkan #1160/#1162, misalnya `email.connections.read|manage|credentials.manage` (berisiko tinggi, step-up), `email.senders.use`, `email.webhook.review`).

### 7. Kontrak, dokumen, dan mekanisme rollout (untuk #1159 sampai #1162)

- OpenAPI: rute admin koneksi dan pengirim, health (kredit, status pengirim, sinkronisasi terakhir), callback webhook, tinjauan karantina; AsyncAPI: `email.message.*` mendapat `sender_account_id` (aditif), event health koneksi, event karantina. DTO membawa id dan kode, tidak pernah token. Semua dalam pull request yang sama dengan kodenya, dengan cermin Inggris dan Indonesia.
- Dokumen dan cermin skill diperbarui bersama kode: `src/modules/email/README(.id).md`, `.claude/skills/awcms-email/SKILL.md`, paket omnichannel, referensi env `docs/awcms/` (`EMAIL_MAILKETING_API_VERSION`, flag), dan kontrak UI admin (baris UP untuk badge v2, pengirim terverifikasi, kredit, status antrean, sinkronisasi terakhir, peringatan migrasi).
- Migrasi: hanya berkas baru maju-saja; tidak ada migrasi terapan yang ditulis ulang; kunci pengirim dan kolom tujuan nullable atau berdefault agar baris yang ada dan deployment tanpa akun berperilaku seperti hari ini.
- Gerbang: `bun run check` penuh, tes RLS dua tenant, canary token, fixture kontrak v1 dan v2 (termasuk setiap status di §1), tes replay untuk webhook, dan tinjauan keamanan untuk #1160 dan #1161.
- **Template turunan dan hilir:** `awcms-one` mengonsumsi port sadar-pengirim setelah merge hulu dan sinkronisasi subtree (`apps/cms`) sebagai **merge commit saja, tidak pernah squash atau rebase**; profil template diverifikasi sebelum sinkronisasi diterima. Router mode `legacy`/`upstream` (ADR-0047 awcms-one) tidak berubah.

### 8. Yang sudah diimplementasi versus yang direncanakan

| Kapabilitas                                                       | Hari ini (`main`)             | Direncanakan oleh                  |
| ----------------------------------------------------------------- | ----------------------------- | ---------------------------------- |
| Kirim v1, antrean, retry, breaker, suppression                    | terimplementasi               | n/a                                |
| Satu token dan pengirim deployment (env)                          | terimplementasi               | dipertahankan sebagai jalur `null` |
| Adapter v2, health (`/credits`, `/senders`)                       | belum diimplementasi          | #1159                              |
| Banyak koneksi dan pengirim terverifikasi per tenant              | belum diimplementasi          | #1160 (setelah #1140)              |
| Intake webhook (karantina) dan status tepercaya                   | belum diimplementasi          | #1161                              |
| UI admin email untuk akun, kredit, health                         | belum diimplementasi          | #1162 (setelah #1160)              |
| Adapter pengirim, list, dan kampanye commerce                     | belum diimplementasi          | awcms-one #461                     |
| CRUD kampanye jarak jauh, buat/hapus list, unsubscribe jarak jauh | **tidak ditawarkan provider** | tidak akan dibangun                |

### 9. Invarian untuk issue hilir (#1159 sampai #1162)

M1. Kredensial v2 hanya lewat header; perilaku token-di-body v1 tidak berubah dan terkurung di adapter v1. Tidak ada token di query string, log, baris audit, event, respons, atau UI.
M2. `provider_message_id` disimpan setelah penerimaan dan tidak pernah dipakai sebagai kunci idempotensi; id antrean internal tetap berbeda; crash-setelah-diterima didokumentasikan sebagai tidak pasti.
M3. `success:true` adalah "antre", bukan "terkirim"; `success:false` pada HTTP 200 adalah kegagalan; setiap status §1 punya fixture dan hasil terklasifikasi.
M4. Satu antrean `email` tetap; pengirim adalah kunci nullable imutabel pada baris; `null` sama dengan perilaku hari ini; tidak ada antrean per akun.
M5. Secret dan pengirim diselesaikan dari catatan tenant terautentikasi saat dispatch; tidak ada token, host, atau id pengirim yang disuplai request; pengirim tenant lain atau nonaktif ditolak, tidak pernah dialihkan.
M6. Tidak ada failover pengirim, akun, atau kanal otomatis, dan tidak ada rotasi pengirim untuk menghindari batas, blokir, atau sinyal reputasi.
M7. Persetujuan dan suppression diperiksa saat enqueue dan sekali lagi tepat sebelum dispatch; kelas tujuan mengikuti §4; list jarak jauh tidak pernah bukti persetujuan; penarikan yang butuh tindakan jarak jauh adalah alur kerja operator.
M8. Callback tak-terautentikasi tidak mengubah state pelanggan; pada mode `strict` ia tidak mengubah apa pun selain buku karantina. Event open, click, dan new-subscriber tidak pernah membuat persetujuan atau skor.
M9. Anggaran kegagalan per koneksi dan batas laju lokal; kredensial buruk satu tenant tidak dapat menghabiskan jatah kegagalan IP bersama.
M10. Semuanya berjalan di bawah runtime Bun yang dipin; SSE atau WebSocket hanya membawa state UI teredaksi.
M11. Setiap tabel baru: RLS `FORCE`, deskriptor `subjectData` dan `data_lifecycle` di migrasi pembuatnya, migrasi maju-saja.
M12. Tidak ada klaim di kode, UI, atau dokumen tentang kapabilitas kampanye jarak jauh, manajemen list, atau webhook terautentikasi yang tidak didokumentasikan provider; UI menyatakan "dilaporkan provider" untuk angka turunan webhook.

## Opsi yang dipertimbangkan

### Strategi adapter

| Kriteria                 | **C. Adapter v1 + v2 berversi, pembalikan bertahap (dipilih)**                  | A. Tetap v1 saja                                             | B. Ganti v1 dengan v2 di tempat                                            |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Keamanan                 | Token v2 header saja; token body v1 terkurung dan berbatas waktu                | Token tetap di body request; v1 menuju akhir masa pakai      | Keadaan akhir terbaik, tetapi tanpa rollback teruji bila vendor bermasalah |
| Performa                 | Setara; breaker per koneksi ditambah                                            | Setara                                                       | Setara                                                                     |
| Maintainability          | Dua adapter untuk jendela terbatas, lalu satu                                   | Terendah sekarang, tertinggi nanti (vendor mempensiunkan v1) | Satu adapter, tetapi satu perubahan berisiko                               |
| Skalabilitas             | Versi per koneksi memungkinkan migrasi tenant bertahap                          | Memblokir fitur v2 multi-akun (`/senders`, `/credits`)       | Sama dengan C setelah pembalikan                                           |
| Kompatibilitas           | Deployment yang ada tidak tersentuh sampai pembalikan; syarat pemilik terpenuhi | Melanggar syarat pemilik "v2, bukan v1"                      | Merusak deployment yang tidak dapat menerima perubahan sekaligus           |
| Kompleksitas operasi     | Satu flag dan jendela rollback terdokumentasi                                   | Tidak ada                                                    | Rollback hanya saat insiden                                                |
| Implikasi jangka panjang | Issue penghapusan v1 yang terlacak menutup jendela                              | Utang yang menjadi gangguan                                  | Tidak ada, bila berhasil                                                   |

### Model akun

| Kriteria                 | **Registri (#1140) dengan akun pengirim anak (dipilih)**            | Tabel `email_provider_connection` terpisah                | Daftar token di env                        |
| ------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| Keamanan                 | Satu penyimpanan secret teraudit, bukti kapabilitas, dan pencabutan | Implementasi kedua penanganan secret                      | Token di environment; tanpa isolasi tenant |
| Maintainability          | Memakai ulang health, assignment, ABAC, dan UI                      | Kode paralel yang menyimpang                              | Redeploy untuk mengganti token             |
| Skalabilitas             | Baris, bukan deployment                                             | Baris, perkakas terduplikasi                              | Tidak skala per tenant                     |
| Kompatibilitas           | Akun `null` adalah perilaku hari ini                                | Sama                                                      | Sama                                       |
| Kompleksitas operasi     | Bergantung pada urutan pengiriman #1140                             | Independen dari #1140, tetapi tambahan untuk dioperasikan | Terendah, salah                            |
| Implikasi jangka panjang | Email, WhatsApp, dan Telegram berbagi satu model akun               | Kemungkinan digabung ke registri kelak dengan biaya       | Jalan buntu                                |

### Penanganan webhook

| Kriteria                 | **Karantina mode `strict`, `restrictive-only` setelah persetujuan (dipilih)** | Tunda sepenuhnya (tanpa endpoint)             | Percaya URL rahasia dan terapkan semua event                                                        |
| ------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Keamanan                 | Tanpa perubahan state tanpa autentikasi; event palsu tidak dapat merugikan    | Teraman                                       | Bounce atau unsubscribe palsu men-suppress penerima; `newsubscriber` palsu dapat membuat subscriber |
| Performa                 | Pemeriksaan murah dahulu; buku kecil                                          | Tidak ada                                     | Tulis pada setiap event                                                                             |
| Maintainability          | Satu intake yang dapat dipakai ulang plus tampilan karantina                  | Tidak ada yang dipelihara                     | Logika rapuh di sekitar masukan tak tepercaya                                                       |
| Skalabilitas             | Dibatasi pembatas laju per koneksi                                            | n/a                                           | Rentan banjir                                                                                       |
| Kompatibilitas           | Memenuhi "fail closed untuk event tak tepercaya"                              | Memenuhi; operator buta terhadap bounce       | Melanggar aturan pemilik                                                                            |
| Kompleksitas operasi     | Operator meninjau daftar karantina                                            | Operator bergantung pada dasbor provider      | Kesalahan tersembunyi                                                                               |
| Implikasi jangka panjang | Naik ke `authenticated` bila vendor menambah tanda tangan                     | Jalur naik sama, tanpa pembelajaran sementara | Data buruk sulit dibatalkan                                                                         |

### Pembacaan kepatuhan

- **UU PDP No. 27/2022:** persetujuan per tujuan dan kanal (I8, §4); minimisasi (tanpa sinkronisasi list, log termasker); pengungkapan prosesor dan transfer lintas negara adalah catatan pengendali (Q10); notifikasi pelanggaran butuh telemetri audit dan dekripsi dalam paket.
- **ISO/IEC 27001:2022 dan 27002:2022:** secret (5.17, 8.24), akses (5.15, 8.2), hubungan pemasok (5.19 sampai 5.23: Mailketing adalah pemasok yang batas terdokumentasinya menjadi masukan), logging (8.15), secure coding (8.28), penghapusan informasi (8.10), PII (5.34).
- **ISO/IEC 27005:** risiko terbesar adalah konsentrasi kredensial di dispatcher (diterima di ADR-0148 §5), penguncian kegagalan se-IP (M9), callback palsu (§5), dan pengiriman ke penerima yang menarik persetujuan (§4, diperiksa dua kali). Dihapus: antrean kedua, token se-deployment untuk akun tenant, rotasi untuk menghindari batas.

## Konsekuensi

- **Positif:** satu keputusan untuk empat issue implementasi; tanpa antrean kedua; migrasi v2 bertahap dan dapat dibalik; webhook tidak dapat dipakai mengubah state pelanggan; kepemilikan persetujuan, suppression, dan kampanye tidak ambigu; kapabilitas provider yang tidak didukung tidak dijanjikan.
- **Negatif / trade-off:** dua adapter selama satu jendela; ketergantungan keras #1160 pada #1140; pada mode `strict` operator mengonfirmasi bounce secara manual sampai vendor menyediakan autentikasi atau maintainer menyetujui `restrictive-only`; open dan click tetap angka berkepercayaan rendah.
- **Netral:** tidak ada yang berubah bagi deployment mana pun sampai flag v2 atau akun dikonfigurasi; jalur env lama tetap.
- **Persetujuan manusia yang masih dibutuhkan (tidak dilakukan di sini):** pengendali atau DPO untuk perjanjian pemrosesan Mailketing dan teks persetujuan; pemilik untuk pembalikan v2 dan komunikasi dengan vendor; tinjauan keamanan #1160 dan #1161 sebelum merge.

## Pertanyaan terbuka untuk maintainer

- **Q1.** Mode webhook: kirim `strict` saja (default yang direkomendasikan), atau setujui `restrictive-only` (menambah suppression pada bounce atau unsubscribe yang terikat message-id)? Aturan pemilik "tidak boleh mengubah state pelanggan pada event tak-terautentikasi" dibaca harfiah di `strict`.
- **Q2.** Panjang jendela rollback v1 yang teraudit setelah pembalikan v2 (rekomendasi: 60 hari, lalu issue penghapusan), dan apakah v1 boleh diaktifkan kembali setelahnya.
- **Q3.** Kriteria dan persetujuan untuk pembalikan tahap 3 (rekomendasi: fixture kontrak hijau, uji staging terhadap vendor sungguhan dengan pengirim sekali pakai, satu tenant produksi di v2 selama 14 hari tanpa 4xx yang tak terjelaskan).
- **Q4.** Konfirmasi model registri (#1140) dibanding tabel koneksi terpisah, beserta ketergantungan yang menyertainya.
- **Q5.** Apakah kita memakai `GET /lists` dan `POST /subscribers` sama sekali? Rekomendasi: `GET /lists` baca-saja bila berguna, tidak pernah `POST /subscribers`.
- **Q6.** Bolehkah pemilik meminta kepada Mailketing header webhook bertanda tangan atau secret yang dapat dikonfigurasi, daftar IP sumber terpublikasi, id event, kunci idempotensi, dan API hapus atau unsubscribe? Jawaban mereka mengubah Q1 dan Q5.
- **Q7.** Haruskah email keamanan tenant (reset password) memakai pengirim tenant atau tetap pada pengirim deployment? Rekomendasi: tetap pada pengirim deployment agar pemulihan akun tidak pernah bergantung pada kredit atau verifikasi tenant.
- **Q8.** Siapa yang mengklasifikasi `purpose`: modul pemanggil saat enqueue (direkomendasikan, ditegakkan allow-list per kategori template) atau pengaturan per template?
- **Q9.** Siapa pemilik pemeriksaan SPF, DKIM, dan DMARC: bukti DNS baca-saja penasihat dari hulu (direkomendasikan) atau hanya verifikasi sisi provider?
- **Q10.** Apakah perjanjian atau addendum pemrosesan dengan Mailketing sudah ada, dan di mana ia memproses data? (tindakan pengendali)
- **Q11.** Lingkup perkiraan kredit: rata-rata bergerak penasihat sederhana (direkomendasikan) atau anggaran yang ditegakkan dan memblokir pengiriman?
- **Q12.** Pilihan antara `Authorization: Bearer` dan `X-Api-Token` untuk header v2. Rekomendasi: `Authorization: Bearer`, dikonfirmasi sandbox.

## Alternatif yang ditolak

- **Antrean email kedua atau mesin kampanye sisi Mailketing.** Outbox `email` sudah menyediakan lease, retry, template, suppression, dan attempts; provider tidak mendokumentasikan CRUD kampanye.
- **Token se-deployment untuk akun milik tenant, atau token tenant di JSON pengaturan.** Melanggar ADR-0148 I3 dan §5.
- **Rotasi pengirim atau failover otomatis untuk menghindari batas atau reputasi.** Melanggar I4 dan I5.
- **Memperlakukan list jarak jauh atau `message_id` sebagai bukti persetujuan atau idempotensi.** Provider tidak mendokumentasikan keduanya.
- **Memercayai URL rahasia untuk perubahan state webhook.** Ditolak ADR-0150 I9/N5.
- **Layanan Node atau Socket.IO untuk dispatch atau webhook.** Melanggar aturan Bun-only (I10).

## Rencana implementasi (issue terpisah, setelah diterima)

1. **#1159** adapter v2 dengan flag fallback v1, health (`/credits`, `/senders`), fixture kontrak, breaker per koneksi.
2. **#1160** (setelah #1140) koneksi, pengirim terverifikasi, pemetaan brand, `sender_account_id` dan `purpose`, secret, ABAC dan RLS; tinjauan keamanan.
3. **#1161** intake webhook mode `strict`, buku karantina dan konfirmasi operator; `restrictive-only` dan `authenticated` hanya setelah Q1 dan Q6.
4. **#1162** UI admin (badge v2, pengirim terverifikasi, kredit, status antrean, sinkronisasi terakhir, peringatan migrasi).
5. **awcms-one #461** setelah sinkronisasi subtree merge-commit.
