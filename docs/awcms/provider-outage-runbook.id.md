🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](provider-outage-runbook.md)

<!-- i18n-source-hash: sha256:1c1afb6d873a5aa40f88befe400565f6521026350343782bec786d9813f33fdd -->

# Runbook gangguan provider, umur antrean, dan hasil yang tidak pasti

> **Status (Issue #1412):** audit atas apa yang sudah ada, beberapa pengukuran yang terbukti belum ada dan kini ditambahkan, serta prosedur operator. Dokumen ini bertumpu pada telemetri yang sudah ada ([`observability-metrics.md`](observability-metrics.md), `src/lib/observability/metrics-port.ts`, `src/lib/database/circuit-breaker.ts`) dan **tidak membuat jalur metrik kedua, gateway bersama, antrean provider ganda, maupun layanan monitoring eksternal yang wajib**. Kosakata hasil yang dipakai (`succeeded`, `accepted`, `not_sent`, `confirmed_failed`, `unknown`) adalah kontrak Issue #1410 (`src/lib/integration/provider-outcome.ts`, `provider-outcome-contract.md`); selama kontrak itu belum mendarat di sebuah deployment, bacalah sebagai klasifikasi di bawah. Batas provider tetap milik port/outbox domain (ADR-0169).

## 1. Tabel bukti: sudah ada, ditambahkan, dan belum ada

### 1.1 Sinyal bersama

| Sinyal                                                                                                                       | Keadaan                           | Bukti                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jumlah panggilan dan latensi provider, per keluarga provider                                                                 | Sudah ada                         | `provider_call_total{provider,outcome}`, `provider_call_duration_ms{provider}` di `METRIC_DEFINITIONS`; dipancarkan `decorateWithMetrics` di `circuit-breaker.ts`    |
| State sirkuit per keluarga provider (0 closed, 1 half-open, 2 open)                                                          | Sudah ada                         | `provider_circuit_state{provider}`; label keluarga dibatasi `deriveProviderFamilyLabel`                                                                              |
| Status run job, durasi, jumlah item per run                                                                                  | Sudah ada                         | `job_run_total`, `job_run_duration_ms`, `job_run_item_count` dari `src/lib/jobs/job-runner.ts`; **hanya** job yang memakai `runJob` (lihat 1.2)                      |
| Backlog outbox domain event, umur pending tertua, hasil dispatch                                                             | Sudah ada, **dikoreksi** (1.3)    | `domain_event_delivery_backlog`, `domain_event_delivery_oldest_pending_seconds`, `domain_event_dispatch_total`                                                       |
| Kedalaman pending, umur terlama yang lewat jatuh tempo, lease kedaluwarsa untuk email, whatsapp, telegram, push, object sync | **Ditambahkan**                   | `queue_pending_count`, `queue_oldest_due_age_seconds`, `queue_expired_lease_count`; `src/lib/observability/queue-health.ts`                                          |
| Counter hasil tidak pasti untuk email, social publishing, telegram engagement                                                | **Ditambahkan**                   | `queue_uncertain_outcome_total{queue}`; dicatat skrip dispatch dari hitungan yang memang sudah dikembalikan dispatcher                                               |
| Baris log job per dispatcher: `<job> queue — pending=N oldestDueAgeSeconds=N expiredLeases=N`                                | **Ditambahkan**                   | `formatQueueHealthLine`; bentuknya dikunci `tests/queue-health-metrics.test.ts`                                                                                      |
| Counter HTTP 429 / 5xx provider                                                                                              | **Belum ada** (ditunda)           | `provider_call_total` hanya punya dua outcome dan `circuit-breaker.ts` tidak diubah di sini; klasifikasi outcome milik #1410 / #1426 (bagian 8)                      |
| Sirkuit berkedip (flapping)                                                                                                  | Dapat diturunkan, tanpa kode baru | `changes(provider_circuit_state[15m])` atas gauge yang ada (bagian 5)                                                                                                |
| Endpoint kesehatan dependensi terotorisasi (`GET /api/v1/logs/observability/dependency-health`)                              | **Belum ada**                     | Tertulis "direncanakan" di `observability-metrics.md`; rutenya tidak ada. `getProviderCircuitBreakerFamilyStates` tidak punya pemanggil di luar `circuit-breaker.ts` |
| Kesehatan DB agregat publik                                                                                                  | Sudah ada                         | `GET /api/v1/database/pool/health`, `GET /api/v1/health` (hanya breaker database, tanpa keluarga provider)                                                           |
| Adapter metrik terdaftar atau endpoint scrape                                                                                | **Belum ada, sengaja**            | Tidak ada jalur kode yang memanggil `setMetricsPort` di luar dokumentasi; bawaannya port no-op. Deployment memilih sendiri (`observability-metrics.md`)              |

### 1.2 Per domain pengiriman

"Percobaan" adalah penghitung ulang per pesan atau ledger per percobaan; "umur" adalah gauge umur baris menunggu tertua; "dead letter" adalah status terminal yang butuh manusia.

| Domain (job)                                         | Percobaan                                                      | Umur dan kedalaman antrean                                                | Lease kedaluwarsa                                                           | Hasil tidak pasti                                                                                                                     | Dead letter / terminal                     | Tuas operator                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Email (`email:dispatch`)                             | `retry_count`, `awcms_email_delivery_attempts`                 | **Ditambahkan** (`email`)                                                 | **Ditambahkan**; klaim ulang menandai baris tidak pasti                     | **Ditambahkan** counter + log `email.dispatch.uncertain_redelivery`; **tidak dipersistenkan** sebagai kolom (catatan di `last_error`) | `failed`, `suppressed`                     | `POST /api/v1/email/messages/{id}/cancel`                                          |
| WhatsApp (`whatsapp:dispatch`)                       | `retry_count`, `awcms_whatsapp_delivery_attempts`              | **Ditambahkan** (`whatsapp`)                                              | **Ditambahkan**                                                             | Hanya klaim ulang setelah lease habis; tanpa counter (tidak dikembalikan dispatcher)                                                  | `failed`, `expired`                        | `GET /api/v1/whatsapp/diagnostics`; rute senders/suppressions                      |
| Telegram staf (`telegram:dispatch`)                  | `retry_count`, `awcms_telegram_delivery_attempts`              | **Ditambahkan** (`telegram`)                                              | **Ditambahkan**                                                             | Tanpa counter (tidak dikembalikan)                                                                                                    | `failed`, `expired`                        | `GET /api/v1/telegram/diagnostics`                                                 |
| Push (`push:dispatch`)                               | `retry_count`, `awcms_push_delivery_attempts`                  | **Ditambahkan** (`push`)                                                  | **Ditambahkan**                                                             | Tanpa counter (tidak dikembalikan)                                                                                                    | `failed`                                   | `GET /api/v1/push/diagnostics`; `POST /api/v1/push/messages/{id}/cancel`           |
| Object sync (`sync:objects:dispatch`)                | `retry_count`                                                  | **Ditambahkan** (`object_sync`)                                           | **Ditambahkan**                                                             | Tidak dimodelkan                                                                                                                      | `failed`                                   | `POST /api/v1/sync/object-queue/{id}/retry` (`sync_storage.object_queue.retry`)    |
| Social publishing (`social-publishing:dispatch`)     | `attempt_count`, `hold_count`, `awcms_social_publish_attempts` | Tidak diprobe (role DB khusus, bagian 8)                                  | Tidak diprobe; lease `publishing` yang habis menjadi `needs_reconciliation` | **Ditambahkan** counter (`unknown`); status `needs_reconciliation` dipersistenkan                                                     | `failed`, `needs_reconciliation`           | `POST /api/v1/social-publishing/jobs/{id}/retry` dengan `confirmPossiblyPublished` |
| Telegram engagement (`telegram-engagement:dispatch`) | `next_attempt_at`, `lease_until`                               | Tidak diprobe (role DB khusus, bagian 8)                                  | Dipulihkan dispatcher sendiri sebagai `uncertain`                           | **Ditambahkan** counter; status `uncertain` dipersistenkan dan tidak pernah dicoba ulang                                              | `failed`, `uncertain`                      | Diagnostik modul                                                                   |
| Domain event (`domain-events:dispatch`)              | penghitung percobaan per delivery                              | Gauge backlog dan pending tertua yang ada (**dikoreksi** menjadi agregat) | n/a (klaim, handler, finalisasi atomik)                                     | n/a                                                                                                                                   | `dead_letter` (gauge `status=dead_letter`) | `POST /api/v1/domain-events/deliveries/{id}/replay`, pause dan resume consumer     |

Dispatcher selain domain event dan beberapa job `runJob` **tidak** memakai `runJob`, sehingga tidak memancarkan seri `job_run_*`: baris log job (`<job> complete — ...` dan `<job> queue — ...` yang baru) adalah keluarannya.

### 1.3 Cacat yang ditemukan dan diperbaiki audit

`recordDomainEventBacklogGauges` dipanggil sekali per tenant dan **menetapkan** gauge setiap kali, sehingga nilai yang tersisa di proses adalah tenant yang berjalan terakhir: tenant dengan lag sejam di tengah loop terhapus oleh tenant sehat di akhir. Backlog kini dilipat lintas tenant sekali per run (hitungan dijumlahkan, umur tertua diambil maksimum) dan dicatat sekali (`foldDomainEventBacklogRows`, `flushDomainEventBacklogGauges`). Agregasi yang sama dipakai gauge antrean baru. Gauge yang tidak punya baris pada run ini (consumer yang backlog-nya baru habis) tidak direset ke 0 oleh modul ini; bacalah seri yang tidak ada setelah run yang sukses sebagai "tidak ada baris", bukan "basi".

## 2. Visibilitas: apa yang dapat dan tidak dapat dikatakan satu proses

- **Circuit breaker bersifat per proses.** Setiap proses web atau worker punya registry sendiri. `provider_circuit_state` dari satu proses adalah pendapat proses itu; ia **bukan** oracle kesehatan provider global, dan breaker `open` di worker tidak menjelaskan apa pun tentang proses web. Nilai sebuah provider dari beberapa sinyal independen: state breaker lintas proses, rasio gagal `provider_call_total`, dan umur antrean. Dua worker dapat berbeda pendapat selama satu jendela breaker.
- **Gauge baru adalah snapshot per run, per proses** dari tenant yang dikunjungi run itu, diagregasi lintas tenant (jumlah untuk kedalaman dan lease, maksimum untuk umur). Bukan total armada. Jalankan setiap dispatcher dari **satu** entri cron di bawah `flock` (seperti `ops/awcms-jobs.crontab`); dengan beberapa host, ambil maksimum `queue_oldest_due_age_seconds` dan maksimum `queue_expired_lease_count` lintas host, jangan pernah menjumlahkan umur.
- **Dispatcher adalah proses berumur pendek.** Tidak ada kode di repositori ini yang mendaftarkan adapter metrik, dan job cron selesai dalam hitungan detik, sehingga gauge dan counter hanya ada di deployment yang mendaftarkan adapter dan mengirim snapshot sebelum keluar (misalnya textfile exporter). Tanpa itu, **baris log job** adalah sinyalnya dan itu cukup: bagian 5 membuat alert di atasnya.
- **Probe yang gagal tidak mencatat apa pun.** Bila probe antrean gagal (izin, timeout), dispatcher mencatat `queue_health.probe_failed` (nama antrean dan error tersanitasi, tanpa tenant id) dan tidak mencetak baris `queue`. Baris yang hilang setelah sebuah run adalah kondisi alert tersendiri, bukan "aman".

## 3. Deteksi

| Sinyal                                                                                    | Arti                                                                                                           | Tindakan pertama                                                                                                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `oldestDueAgeSeconds` naik pada run berturut-turut sementara `expiredLeases=0`            | Baris jatuh tempo tetapi tidak terkirim: gangguan provider (breaker terbuka atau backoff), kredit, konfigurasi | Bagian 4; periksa `provider_circuit_state`, diagnostik modul, dan `<job> complete` (`deferred`, `breakerOpen`, `misconfigured`)  |
| `expiredLeases > 0` yang tidak kembali ke 0 pada run berikutnya                           | Worker mati atau menggantung saat mengirim dan tidak ada yang mengklaim ulang: dispatcher tidak berjalan       | Periksa entri cron dan lock-nya; pass berikutnya mengklaim ulang sebagai **pengiriman ulang tidak pasti** (kemungkinan duplikat) |
| `queue_uncertain_outcome_total` naik, atau ada baris `needs_reconciliation` / `uncertain` | Provider mungkin sudah menerima pesan                                                                          | Klasifikasi bagian 4, lalu rekonsiliasi. Tidak pernah retry buta                                                                 |
| Tidak ada baris `<job> queue` di log job setelah run                                      | Probe gagal atau job tidak selesai                                                                             | Baca baris `queue_health.probe_failed` dan status keluar job                                                                     |
| `domain_event_delivery_backlog{status=dead_letter}` > 0                                   | Consumer event menghabiskan percobaannya                                                                       | Periksa `GET /api/v1/domain-events/deliveries`, perbaiki penyebab, replay                                                        |

## 4. Klasifikasi, tahan, rekonsiliasi

Klasifikasikan setiap pesan terdampak ke tepat satu hasil sebelum menyentuhnya:

| Hasil                    | Tampilannya                                                                                                               | Boleh dikirim ulang?                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `succeeded` / `accepted` | `sent` / `published`, id eksternal tercatat                                                                               | Tidak pernah                                                                  |
| `not_sent`               | `queued` / `retry_wait`, atau `deferred` (breaker terbuka, hold kredit): tidak ada kontak dengan provider                 | Ya, dispatcher melakukannya sendiri begitu provider pulih                     |
| `confirmed_failed`       | `failed` terminal dengan penolakan provider (tidak dapat dicoba ulang) atau percobaan habis                               | Hanya dengan mengulang aksi asal; kegagalan terkonfirmasi tidak diantre ulang |
| `unknown`                | lease habis diklaim ulang (catatan tidak pasti email), `needs_reconciliation` (social), `uncertain` (telegram engagement) | **Hanya setelah rekonsiliasi**: periksa sisi provider lebih dulu              |

**Tahan.** Selama provider turun, jangan menaikkan konkurensi dispatcher dan jangan mengantre ulang: backoff dan breaker adalah pengendalinya. Untuk menghentikan pesan tertentu, batalkan (`email` dan `push` punya rute cancel). Untuk menghentikan satu consumer domain event, `POST /api/v1/domain-events/consumers/{name}/pause` (diaudit, `Idempotency-Key`); lanjutkan setelah pulih.

**Rekonsiliasi.** Untuk hasil `unknown`, lihat catatan provider sendiri (folder terkirim, laporan pengiriman, akun sosial) berdasarkan correlation id pesan, bukan penerimanya. Bila provider memilikinya, tandai pesan sebagai terkirim lewat alur modul sendiri (job sosial: jangan retry); bila tidak, retry di bagian berikutnya aman.

## 5. Alert, beserta uji gangguan

Berbasis log (jalan hanya dengan log job; ambang adalah placeholder yang diisi dari baseline di bagian 6, bukan angka produksi karangan):

```bash
# Alert bila baris antrean email terbaru menunjukkan baris jatuh tempo lebih tua dari T detik.
# T adalah placeholder; turunkan dari baseline terukur (bagian 6).
T=900
tail -n 200 "$AWCMS_JOB_LOG/email-dispatch.log" | grep -E 'email:dispatch queue — ' | tail -n 1 \
  | awk -F'oldestDueAgeSeconds=' '{split($2,a," "); if (a[1]+0 > '"$T"') exit 1}'
```

Dengan adapter terdaftar, PromQL setara (sesuaikan ambangnya):

```promql
queue_oldest_due_age_seconds{queue="email"} > 900
queue_expired_lease_count > 0
increase(queue_uncertain_outcome_total[1h]) > 0
changes(provider_circuit_state{provider=~".+"}[15m]) >= 4   # flapping
```

Uji gangguan yang membuktikan setiap alert menyala (jalankan di environment kedua non-produksi ADR-0083, tidak pernah di produksi):

| Gangguan                      | Cara menyuntik                                                                  | Sinyal yang diharapkan                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Provider turun (antrean basi) | Matikan provider atau arahkan ke alamat tak terjangkau; antre pesan             | `oldestDueAgeSeconds` tumbuh tiap run; breaker `open` setelah ambang gagal                                      |
| Worker mati (lease macet)     | `kill -9` dispatcher saat sedang mengirim                                       | `expiredLeases >= 1` pada run berikutnya, lalu pengiriman ulang tidak pasti dan `queue_uncertain_outcome_total` |
| Titik buta probe              | Cabut `SELECT` pada tabel antrean dari role worker                              | `queue_health.probe_failed` di log dan **tidak ada** baris `queue` (bukan nol)                                  |
| Drill antrean basi            | Hentikan entri cron satu dispatcher lebih lama dari ambang alert; nyalakan lagi | Alert menyala; setelah dinyalakan umur turun ke 0 dan alert padam                                               |

Cakupan otomatis: `tests/queue-health-metrics.test.ts` (batas label, agregasi lintas tenant, perilaku probe gagal, bentuk baris log) dan `tests/integration/queue-health.integration.test.ts` (PostgreSQL sungguhan, role worker, jatuh tempo versus masa depan, baris terminal, isolasi tenant).

## 6. SLI dan SLO: usulan yang butuh baseline terukur

Ini **usulan**. Tidak ada hasil produksi yang diklaim. Tetapkan target hanya setelah mengumpulkan baseline (sedikitnya 14 hari baris `queue` atau gauge per antrean, pada operasi normal dan melewati sedikitnya satu insiden provider), lalu tinjau bersama pemilik.

| SLI usulan                             | Pengukuran                                                             | Target                       |
| -------------------------------------- | ---------------------------------------------------------------------- | ---------------------------- |
| Kesegaran pengiriman per antrean       | porsi run dengan `oldestDueAgeSeconds` di bawah atau sama dengan batas | **ditetapkan dari baseline** |
| Bebas lease macet                      | porsi run dengan `expiredLeases = 0`                                   | **ditetapkan dari baseline** |
| Laju hasil tidak pasti                 | `queue_uncertain_outcome_total` per 1000 pengiriman                    | **ditetapkan dari baseline** |
| Waktu kuras dead letter (domain event) | waktu dari `dead_letter` pertama sampai replay atau penyelesaian       | **ditetapkan dari baseline** |

## 7. Replay manual berotorisasi

Replay adalah aksi manusia yang diaudit, hanya untuk hasil `not_sent` yang tidak akan diambil dispatcher, atau `unknown` setelah rekonsiliasi. Setiap rute di bawah dijaga ABAC default-deny di tenant-nya sendiri, menulis event audit, dan (bila disebut) mensyaratkan `Idempotency-Key`:

| Domain       | Rute                                                | Izin                                                    | Catatan                                                                                                             |
| ------------ | --------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Domain event | `POST /api/v1/domain-events/deliveries/{id}/replay` | `domain_event_runtime.deliveries.replay`                | `Idempotency-Key`; alasan wajib; kompatibilitas skema diperiksa                                                     |
| Social       | `POST /api/v1/social-publishing/jobs/{id}/retry`    | `social_publishing.jobs.retry`                          | `Idempotency-Key`; `confirmPossiblyPublished: true` wajib untuk `needs_reconciliation`; tambahan percobaan terbatas |
| Object sync  | `POST /api/v1/sync/object-queue/{id}/retry`         | `sync_storage.object_queue.retry`                       | hanya entri `failed`                                                                                                |
| Email, push  | `POST .../messages/{id}/cancel`                     | `email.message.cancel`, `push_delivery.messages.cancel` | menghentikan, bukan replay; tidak ada rute antre ulang                                                              |

Jangan pernah me-replay dengan menyunting baris lewat SQL: transisi status, audit, dan trigger database adalah kontrolnya.

## 8. Rollback, insiden, eskalasi

- **Rollback.** Bila deploy menyebabkan sinyal, rollback image lebih dulu; antrean durabel dan dispatcher melanjutkan dari barisnya. Jangan mengosongkan antrean untuk "membersihkan" alert.
- **Pemilik dan eskalasi.** On-call platform memegang deteksi dan penahanan; pemilik domain modul yang gagal memegang rekonsiliasi; pemilik keamanan dilibatkan bila penyebabnya paparan kredensial. Kontak ada di roster on-call deployment sendiri, bukan di repositori ini.
- **Tindak lanjut insiden.** Catat: waktu terdeteksi pertama, antrean terdampak, jumlah hasil per kelas (bagian 4), duplikat yang ditemukan, replay yang dilakukan (dengan id audit), dan penyesuaian baseline yang dibenarkannya.
- **Batas dan tindak lanjut yang diketahui.**
  - Penghitungan 429/5xx provider dan label outcome pada `provider_call_total` membutuhkan klasifikasi outcome bersama (#1410 / #1426); `circuit-breaker.ts` sengaja tidak disentuh di sini.
  - Email tidak mempersistenkan kolom "tidak pasti"; hitungannya counter dan catatan di `last_error`.
  - Social publishing dan Telegram engagement berjalan sebagai role database khusus dengan grant terbatas kolom, sehingga umur antrean mereka **tidak** diprobe di sini (memberi role itu baca baru adalah perubahan permukaan keamanan yang butuh tinjauan sendiri); counter tidak-pasti mereka dicatat.
  - Endpoint kesehatan dependensi terotorisasi tetap direncanakan.

## 9. Anggaran biaya dan redaksi

- **Biaya query.** Satu agregat per (tenant, antrean) per run dispatcher: lima antrean, jadi lima baca kecil berurutan-indeks per tenant per run, hanya atas baris non-terminal (`(tenant_id, status, next_attempt_at)`), di work class `background_sync`, di dalam dispatcher yang memang sudah mengiterasi tenant. Tidak pernah berjalan di jalur request. Dengan irama cron yang ada (1 sampai 2 menit) beban tambahannya segelintir baca kecil per tenant per irama; bila deployment punya ribuan tenant, naikkan iramanya atau sampling, dan verifikasi dengan `bun run db:work-class:check` dan anggaran query.
- **Biaya seri.** Empat metrik baru, masing-masing dengan satu label `queue` dari himpunan terdefinisi di kode (paling banyak 8 nilai): sekitar 20 seri total. Tenant id, penerima, template, teks respons provider, dan object key tidak pernah menjadi label (`filterLabels` membuang kunci yang tidak dideklarasikan di `METRIC_DEFINITIONS`).
- **Redaksi.** Baris log hanya memuat hitungan dan nama antrean. Baris kegagalan probe memuat error tersanitasi (`safeErrorDetail`), tidak pernah tenant id, penerima, atau badan respons provider. Correlation id (bukan tenant atau user id) adalah kunci penghubung antara sinyal dan catatan audit serta percobaan.
- **Akses aman-tenant.** Probe berjalan per tenant di bawah row-level security sebagai role worker; rute diagnostik admin di atas ter-scope tenant dan dijaga izin. Tidak ada permukaan baca lintas-tenant yang ditambahkan.
