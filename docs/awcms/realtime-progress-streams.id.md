🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](realtime-progress-streams.md)

<!-- i18n-source-hash: sha256:17956dbdd158ad7e01cecb62082b7100b1f3bb99c9cf4a04637582897f536380 -->

# Stream progres real-time — operasional

Issue [#1171](https://github.com/ahliweb/awcms/issues/1171), diputuskan oleh
[ADR-0154](../adr/0154-realtime-progress-is-sse-first-on-the-existing-bun-process-reading-durable-state-websocket-not-admitted.id.md).

## Yang ada

- **Transport:** Server-Sent Events dari proses Bun yang sudah ada
  (`bun ./dist/standalone-entry.mjs`). Tanpa listener kedua, tanpa port kedua,
  tanpa WebSocket, tanpa Socket.IO, tanpa proses Node.
- **Dua topik yang diadmisi.** `whatsapp.sender.progress` yang pertama; `inbox.status.progress` ada di bawahnya.
- **Topik `whatsapp.sender.progress`:** — progres pengiriman
  satu pengirim WhatsApp milik tenant, diproyeksikan dari
  `awcms_whatsapp_messages`.
  - Stream: `GET /api/v1/whatsapp/senders/{id}/progress/stream`
  - Snapshot dan fallback polling: `GET /api/v1/whatsapp/senders/{id}/progress`
  - Permission: `whatsapp_delivery.progress.read` (di-seed `sql/360`)
  - Layar: panel progres di `/admin/channel-accounts/{id}` untuk pengirim
    WhatsApp.
- **Topik `inbox.status.progress`:** hitungan kerja langsung inbox omnichannel
  (terbuka, tertunda, menunggu balasan, belum ditugaskan, SLA terlampaui),
  diproyeksikan dari `awcms_inbox_conversations`. Ia adalah **petunjuk**: per
  percakapan yang berubah hanya id, status, dan waktunya; halaman mengambil ulang
  daftar lewat pembacaan REST yang terotorisasi. Tidak ada referensi sumber,
  penerima tugas, tag, isi, atau identitas pelanggan yang dialirkan. Hanya kerja
  AKTIF yang dihitung (terbuka atau tertunda), sehingga biaya satu tick mengikuti
  kerja yang sedang berjalan, bukan isi jendela retensi.
  - Stream: `GET /api/v1/omnichannel-inbox/progress/stream`
  - Snapshot dan fallback polling: `GET /api/v1/omnichannel-inbox/progress`
  - Permission: `omnichannel_inbox.status.read` (di-seed `sql/413`, yang juga
    menambah indeks keyset dan kerja-aktif pada `awcms_inbox_conversations`)
  - Visibilitasnya sama dengan daftar percakapan: pemanggil yang terbatas scope
    hanya melihat business scope yang ia liputi dan tidak pernah percakapan
    seluruh-tenant. ID percakapan dalam frame dibatasi lagi pada yang juga bisa
    ia daftar (`omnichannel_inbox.conversations.read`); pemegang `status.read`
    tanpa itu hanya mendapat hitungan. Keputusan per-scope pada satu tick tidak
    menulis baris decision-log (satu baris per tick, bukan 1 + N). Mati (`OMNICHANNEL_INBOX_ENABLED` tidak diset) menjawab `404`.
    Tidak ada parameter path; resource-nya selalu tampilan pemanggil atas inbox
    tenantnya sendiri.
  - Belum ada layar admin yang memakainya: layar inbox dirender di server dan
    belum melakukan polling.
- **Belum dibangun:** topik kampanye (tidak ada entitas kampanye) dan status
  per-pesan lintas kanal. Masing-masing ditambahkan ke
  `src/modules/_shared/realtime-topics.ts` dalam perubahan yang membangun baris
  sumbernya. WebSocket dan fan-out lintas-instance tetap di luar ADR-0154 (ADR
  berikutnya yang mengadmisinya; sambungan ulang sudah melanjutkan lewat cursor
  di instance mana pun).

Stream adalah **proyeksi baris yang sudah di-commit**. Ia tidak pernah mengirim,
mengantrekan, atau mengubah status. Ia bukan tanda terima pengiriman dan bukan
push yang tahan lama: tab yang ditutup atau berjalan di latar belakang tidak
menerima apa pun (pakai Web Push untuk itu, ADR-0074).

## Perilaku yang dapat diandalkan operator

| Sifat                          | Nilai / aturan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-otorisasi                   | Setiap 5 dtk (tick). Permission yang dicabut saat stream berjalan, atau sesi yang kedaluwarsa, mengakhiri stream dengan `authorization-revoked` pada tick berikutnya, dan menulis baris audit `realtime_stream.revoked` (severity `warning`). Pada topik yang visibilitasnya berupa himpunan baris (`inbox.status.progress`), perubahan business scope tidak mengakhiri stream dan berlaku pada tick berikutnya: berganti ke scope lain mempersempit frame ke scope itu, tetapi mencabut scope TERAKHIR mengakhiri pembatasan, sehingga peran tenant-wide lalu melihat seluruh tenant (aturan daftar percakapan). Untuk memutus akses, cabut permission atau peran, yang mengakhiri stream. |
| Origin                         | `Origin` yang ada dan bukan origin request itu sendiri atau origin `APP_URL` ditolak dengan `403 ORIGIN_REFUSED` sebelum pekerjaan apa pun. Berlaku juga untuk `push/stream`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Tak terlihat = tidak ditemukan | Id pengirim yang tidak dikenal, salah bentuk, lintas tenant, atau tersembunyi dijawab `404` dan tidak membuka stream.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Cursor dan resume              | Setiap event data membawa `id: <cursor>` (posisi keyset `(updated_at, id)` yang dihitung PostgreSQL). `EventSource` mengirimnya kembali sebagai `Last-Event-ID`. Cursor yang salah bentuk, asing, atau sudah dipurge, atau lebih dari 50 perubahan sekaligus, menghasilkan `snapshot-required` dan klien membaca ulang snapshot.                                                                                                                                                                                                                                                                                                                                                            |
| Umur                           | 10 menit, lalu `stream-expired`; browser menyambung ulang dengan cursornya tanpa kehilangan apa pun.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Heartbeat                      | Komentar `: hb` setelah 15 dtk tanpa frame.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Database menolak               | Stream berakhir dengan `stream-error`; klien mundur dengan jitter. Tidak ada loop retry per koneksi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Batas                          | Per aktor, per tenant, dan per instance; di atas batas jawabannya `429 STREAM_CAPACITY_REACHED` dengan `Retry-After: 30`, tidak pernah stream yang diantrekan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Konsumen lambat                | Klien yang byte belum-terkirimnya tetap di atas ambang selama masa tenggang dikirimi `slow-consumer` dan koneksinya diputus. Selama tertinggal, tidak ada frame ditulis dan tidak ada pembacaan dilakukan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Batas daftar perubahan

`updated_at = now()` adalah waktu mulai transaksi penulis. Transaksi yang mulai
sebelum sebuah tick dan commit sesudahnya tidak dilaporkan di daftar perubahan
stream itu. **Penghitung dihitung ulang dari tabel di setiap tick dan selalu
benar**; daftar perubahan adalah petunjuk, dan snapshot adalah otoritas untuk
satu pesan.

### Baris yang dilihat pemanggil terkurung (audit keamanan M-1)

Melihat sebuah pengirim bukan berarti melihat setiap baris lewatnya. Pengirim
seluruh tenant membawa pesan setiap brand; pemanggil yang terkurung business
scope hanya melihat lewatnya pesan yang business scope-nya sendiri ia pegang
(diputuskan setiap tick lewat chokepoint, termasuk scope turunan). Jumlah,
daftar perubahan, daftar terbaru, dan cursor frame pertama semuanya difilter;
pesan tanpa scope tidak terlihat oleh pemanggil terkurung, dan `Last-Event-ID`
yang menunjuk baris yang tak boleh ia lihat mendapat `snapshot-required`.
Pemanggil tak terkurung melihat semua baris.

### Konteks request (audit L-2)

Selain `Origin` asing, request dengan `Sec-Fetch-Site: cross-site` atau
`Sec-Fetch-Mode: navigate` ditolak dengan `403 ORIGIN_REFUSED` sebelum pekerjaan
apa pun, di kedua route stream (termasuk `push/stream`). Header yang tidak ada
diizinkan.

### Batas biaya (audit M-2)

- Slot koneksi diambil tepat setelah keputusan otorisasi dan sebelum query topik
  apa pun: `429` hanya membayar satu rantai guard.
- Tick berjalan di work class sendiri, `realtime_stream` (3 bersamaan, antrean
  dibatasi `DATABASE_WORK_CLASS_QUEUE_MULTIPLIER`), sehingga stream terbuka tidak
  pernah mengambil slot request interaktif. Antrean penuh mengakhiri stream
  dengan `stream-error` dan klien mundur dengan jitter.
- Jumlah mencakup pesan yang **dibuat dalam 7 hari terakhir** (`countWindowDays`
  di snapshot), dilayani `awcms_whatsapp_messages_sender_window_idx`. Setiap
  pembacaan satu statement;
  `tests/integration/whatsapp-sender-progress-query-budget.integration.test.ts`
  menjaga anggarannya dan memeriksa statement nyata tidak pernah memindai tabel.

## Deploy

`sql/360` membangun dua indeks di `awcms_whatsapp_messages` **tanpa
`CONCURRENTLY`**: runner migrasi membungkus tiap berkas dalam transaksi, tempat
`CREATE INDEX CONCURRENTLY` mustahil (batasan yang sama dicatat `sql/143`).
`CREATE INDEX` biasa memegang lock SHARE, sehingga enqueue dan finalisasi
dispatcher **menunggu** sampai kedua build selesai. Untuk antrean besar,
jalankan migrasi di jendela sepi, atau hentikan `whatsapp:dispatch` selama
berlangsung. Kedua indeks parsial (`sender_account_id IS NOT NULL`); deployment
yang tidak pernah merutekan lewat pengirim bernama membangunnya atas nol baris.

`sql/413` membangun dua indeks di `awcms_inbox_conversations`, juga **tanpa
`CONCURRENTLY`** dan dengan kunci SHARE yang sama. Tabel itu berisi satu baris
per percakapan pelanggan dalam jendela retensi (ribuan, bukan jutaan), sehingga
tunggunya singkat; deployment dengan inbox mati membangunnya di atas nol baris.

## Konfigurasi

Semua opsional. Tidak di-set atau tidak valid kembali ke default;
`bun run config:validate` menolak nilai yang salah bentuk.

| Variabel                                    | Default  | Arti                                                             |
| ------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_ACTOR`    | `4`      | Stream terbuka yang boleh dipegang satu orang di satu instance.  |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_TENANT`   | `100`    | Stream terbuka yang boleh dipegang satu tenant di satu instance. |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_INSTANCE` | `500`    | Stream terbuka di satu instance, semua tenant.                   |
| `REALTIME_SSE_SLOW_CONSUMER_BYTES`          | `262144` | Byte belum-terkirim di atas mana klien dianggap tertinggal.      |
| `REALTIME_SSE_SLOW_CONSUMER_GRACE_MS`       | `15000`  | Berapa lama klien boleh tertinggal sebelum dikeluarkan.          |

**Setiap batas berlaku per instance.** Dengan N replika, sebuah tenant dapat
memegang hingga N kali batas tenant. Batas ini membatasi memori dan beban
database per proses; ia bukan pernyataan tentang seluruh deployment.

Setiap stream terbuka memakan satu rantai guard dan tiga pembacaan berindeks
setiap 5 dtk. Pada default per instance (500) itu sekitar 100 transaksi pendek
per detik di work class `interactive`; atur `DATABASE_POOL_MAX` dan batas
instance bersama-sama (`docs/awcms/database-capacity-runbook.md`).

## Reverse proxy

- Buffering respons **mati** untuk `/api/v1/**/stream` (route sudah mengirim
  `X-Accel-Buffering: no` dan `Cache-Control: no-transform`).
- Idle / read timeout **di atas 15 dtk** (heartbeat). 60 dtk atau lebih nyaman.
  Diukur pada Bun 1.4.4: server `node:http` yang dipakai standalone entry tidak
  menutup stream yang diam selama 25 dtk, jadi heartbeat untuk proxy, bukan
  untuk Bun.
- HTTP/1.1 dan HTTP/2 sama-sama jalan; tidak ada upgrade.
- Jangan di-cache: responsnya `private, no-store`.

## Pengukuran konsumen lambat

`writeResponse` milik `@astrojs/node` menguras stream route secara agresif dan
mengabaikan backpressure socket, sehingga `desiredSize` stream web tidak pernah
bergerak. Diukur pada Bun 1.4.4 dengan klien yang berhenti membaca: kernel
menyerap sekitar 1 MB, lalu `ServerResponse.writableLength` tumbuh tanpa batas.
Karena itu standalone entry menjalankan setiap request di dalam scope
`AsyncLocalStorage` yang membawa probe atas respons
(`src/lib/server/response-pressure.ts`) dan stream membacanya. Di `astro dev`
tidak ada probe: buffer **tidak terukur**, dan hanya ukuran frame, tick, serta
umur koneksi yang membatasinya.

## Metrik

Hanya agregat tenant; `topic` adalah konstanta yang didefinisikan kode dan
tidak pernah id resource.

| Metrik                             | Tipe      | Label            |
| ---------------------------------- | --------- | ---------------- |
| `realtime_stream_open`             | gauge     | —                |
| `realtime_stream_opened_total`     | counter   | `topic`          |
| `realtime_stream_refused_total`    | counter   | `topic`,`reason` |
| `realtime_stream_closed_total`     | counter   | `topic`,`reason` |
| `realtime_stream_frames_total`     | counter   | `topic`,`kind`   |
| `realtime_stream_tick_duration_ms` | histogram | `topic`          |
| `realtime_stream_frame_lag_ms`     | histogram | `topic`          |

Alasan penolakan: `origin`, `auth_denied`, `not_found`, `capped_actor`,
`capped_tenant`, `capped_instance`, `unavailable`. Alasan penutupan: `revoked`,
`expired`, `slow_consumer`, `error`, `client`.

## Runbook

- **Banyak penolakan `capped_*`:** periksa apakah satu orang membuka banyak tab
  (`capped_actor`) atau sebuah tenant memang sibuk (`capped_tenant`). Naikkan
  batas hanya bersama ukuran pool. Halaman tetap bekerja lewat snapshot.
- **Banyak penutupan `slow_consumer`:** biasanya proxy yang mem-buffer respons.
  Pastikan buffering mati untuk path stream.
- **Banyak penutupan `error`:** database menolak (`DATABASE_BUSY` / circuit
  breaker). Perlakukan sebagai masalah kapasitas database, bukan masalah stream.
- **Permission dicabut tetapi pengguna masih melihat progres:** stream berakhir
  dalam satu tick (5 dtk). Halaman yang tetap terbuka menampilkan "Akses
  berakhir". Bila tidak, periksa `awcms_audit_events` untuk
  `realtime_stream.revoked`.
- **Tenant lama tidak mendapat permission:** seperti setiap seed permission,
  `sql/360` dan `sql/413` hanya memperluas katalog global; jalankan
  `bun run identity-access:permissions:backfill`.

## Menambah topik

1. Implementasikan `ProgressTopic` (`src/modules/_shared/progress-sse-route.ts`)
   di modul pemilik baris, dengan aturan visibilitas yang sama seperti pembacaan
   REST-nya — pada BARIS, bukan hanya pada resource. Memo atau cache otorisasi
   apa pun yang ia (atau helper-nya) simpan wajib berkunci `context.request`,
   yang merupakan objek baru setiap tick; berkunci cara lain, pencabutan tidak
   pernah berlaku.
2. Tambahkan topik ke `src/modules/_shared/realtime-topics.ts`, permission-nya ke
   descriptor modul, dan migrasi seed.
3. Tambahkan route snapshot dan route stream yang dibangun dengan
   `defineProgressSseRoute`, keduanya di OpenAPI.
4. `tests/realtime-topics-registry.test.ts` memeriksa wiring-nya; tulis tes
   integrasi DB yang diwajibkan ADR (dua tenant, dua scope, pencabutan, cursor,
   batas).

WebSocket tetap di luar sampai sebuah ADR mengadmisi use case dua arah sesuai
ADR-0154 bagian 4.
