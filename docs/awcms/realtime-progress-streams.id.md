🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](realtime-progress-streams.md)

<!-- i18n-source-hash: sha256:2ca5fa75c8ccad572576c7c9ecf6333159006f549a59574cc30a079bf6d818cd -->

# Stream progres real-time — operasional

Issue [#1171](https://github.com/ahliweb/awcms/issues/1171), diputuskan oleh
[ADR-0154](../adr/0154-realtime-progress-is-sse-first-on-the-existing-bun-process-reading-durable-state-websocket-not-admitted.id.md).

## Yang ada

- **Transport:** Server-Sent Events dari proses Bun yang sudah ada
  (`bun ./dist/standalone-entry.mjs`). Tanpa listener kedua, tanpa port kedua,
  tanpa WebSocket, tanpa Socket.IO, tanpa proses Node.
- **Satu topik yang diadmisi:** `whatsapp.sender.progress` — progres pengiriman
  satu pengirim WhatsApp milik tenant, diproyeksikan dari
  `awcms_whatsapp_messages`.
  - Stream: `GET /api/v1/whatsapp/senders/{id}/progress/stream`
  - Snapshot dan fallback polling: `GET /api/v1/whatsapp/senders/{id}/progress`
  - Permission: `whatsapp_delivery.progress.read` (di-seed `sql/360`)
  - Layar: panel progres di `/admin/channel-accounts/{id}` untuk pengirim
    WhatsApp.
- **Belum dibangun:** topik inbox (inbox, Issue #1164, belum ada), topik
  kampanye (tidak ada entitas kampanye), status pesan lintas kanal. Masing-masing
  ditambahkan ke `src/modules/_shared/realtime-topics.ts` dalam perubahan yang
  membangun baris sumbernya.

Stream adalah **proyeksi baris yang sudah di-commit**. Ia tidak pernah mengirim,
mengantrekan, atau mengubah status. Ia bukan tanda terima pengiriman dan bukan
push yang tahan lama: tab yang ditutup atau berjalan di latar belakang tidak
menerima apa pun (pakai Web Push untuk itu, ADR-0074).

## Perilaku yang dapat diandalkan operator

| Sifat                          | Nilai / aturan                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-otorisasi                   | Setiap 5 dtk (tick). Peran, penugasan, atau business scope yang dicabut saat stream berjalan, atau sesi yang kedaluwarsa, mengakhiri stream dengan `authorization-revoked` pada tick berikutnya, dan menulis baris audit `realtime_stream.revoked` (severity `warning`).                                                         |
| Origin                         | `Origin` yang ada dan bukan origin request itu sendiri atau origin `APP_URL` ditolak dengan `403 ORIGIN_REFUSED` sebelum pekerjaan apa pun. Berlaku juga untuk `push/stream`.                                                                                                                                                    |
| Tak terlihat = tidak ditemukan | Id pengirim yang tidak dikenal, salah bentuk, lintas tenant, atau tersembunyi dijawab `404` dan tidak membuka stream.                                                                                                                                                                                                            |
| Cursor dan resume              | Setiap event data membawa `id: <cursor>` (posisi keyset `(updated_at, id)` yang dihitung PostgreSQL). `EventSource` mengirimnya kembali sebagai `Last-Event-ID`. Cursor yang salah bentuk, asing, atau sudah dipurge, atau lebih dari 50 perubahan sekaligus, menghasilkan `snapshot-required` dan klien membaca ulang snapshot. |
| Umur                           | 10 menit, lalu `stream-expired`; browser menyambung ulang dengan cursornya tanpa kehilangan apa pun.                                                                                                                                                                                                                             |
| Heartbeat                      | Komentar `: hb` setelah 15 dtk tanpa frame.                                                                                                                                                                                                                                                                                      |
| Database menolak               | Stream berakhir dengan `stream-error`; klien mundur dengan jitter. Tidak ada loop retry per koneksi.                                                                                                                                                                                                                             |
| Batas                          | Per aktor, per tenant, dan per instance; di atas batas jawabannya `429 STREAM_CAPACITY_REACHED` dengan `Retry-After: 30`, tidak pernah stream yang diantrekan.                                                                                                                                                                   |
| Konsumen lambat                | Klien yang byte belum-terkirimnya tetap di atas ambang selama masa tenggang dikirimi `slow-consumer` dan koneksinya diputus. Selama tertinggal, tidak ada frame ditulis dan tidak ada pembacaan dilakukan.                                                                                                                       |

### Batas daftar perubahan

`updated_at = now()` adalah waktu mulai transaksi penulis. Transaksi yang mulai
sebelum sebuah tick dan commit sesudahnya tidak dilaporkan di daftar perubahan
stream itu. **Penghitung dihitung ulang dari tabel di setiap tick dan selalu
benar**; daftar perubahan adalah petunjuk, dan snapshot adalah otoritas untuk
satu pesan.

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
  `sql/360` hanya memperluas katalog global; jalankan
  `bun run identity-access:permissions:backfill`.

## Menambah topik

1. Implementasikan `ProgressTopic` (`src/modules/_shared/progress-sse-route.ts`)
   di modul pemilik baris, dengan aturan visibilitas yang sama seperti pembacaan
   REST-nya.
2. Tambahkan topik ke `src/modules/_shared/realtime-topics.ts`, permission-nya ke
   descriptor modul, dan migrasi seed.
3. Tambahkan route snapshot dan route stream yang dibangun dengan
   `defineProgressSseRoute`, keduanya di OpenAPI.
4. `tests/realtime-topics-registry.test.ts` memeriksa wiring-nya; tulis tes
   integrasi DB yang diwajibkan ADR (dua tenant, dua scope, pencabutan, cursor,
   batas).

WebSocket tetap di luar sampai sebuah ADR mengadmisi use case dua arah sesuai
ADR-0154 bagian 4.
