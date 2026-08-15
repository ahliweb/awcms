🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:10130e05f761ad177fb5c17e9a9b5a52d138692c2b904cacf56ce20b73065aaa -->

# Domain Event Runtime

**Outbox** dan **dispatcher** event domain yang transaksional dan berversi.
Infrastruktur yang netral-provider, generik, dan multi-konsumen: satu event
yang diterbitkan dapat menyebar ke **banyak** konsumen terdaftar, dengan
pengurutan per-agregat/order-key yang eksplisit (tidak pernah urutan total
global), backoff eksponensial, penanganan dead-letter, dan replay yang aman
bagi operator.

Diport dari modul `domain-event-runtime` yang telah terbukti di awcms-mini dan
disesuaikan dengan konvensi awalan `awcms_` repo ini serta modul fondasi yang
tersedia.

## Apa yang disediakannya

- **Produser outbox** — `appendDomainEvent(tx, tenantId, input)` milik
  `application/append-domain-event.ts`: sebuah produser memanggil ini **di dalam
  transaksi bisnisnya sendiri** (patuh ADR-0006 — hanya tulis DB polos, tanpa
  I/O eksternal), sehingga baris event dan baris pengirimannya per-konsumen
  di-commit secara atomik bersama perubahan state sumbernya. Transaksi sumber
  yang di-rollback tidak menghasilkan event yang bisa dikirim, secara
  konstruksi.
- **Registry tipe event berversi** — `domain/event-type-registry.ts`:
  `appendDomainEvent` menolak mempersistenkan event yang
  `(eventType, eventVersion)`-nya tidak terdaftar di sini, sehingga menghentikan
  penyimpangan senyap dari kontrak AsyncAPI yang diterbitkan.
- **Registry konsumen statis** — `infrastructure/consumer-registry.ts`: sebuah
  array polos berisi `DomainEventConsumerDefinition`, sehingga fan-out penuh
  untuk tipe event apa pun bisa diketahui dari kode sumber saja. Fan-out
  ditentukan pada waktu **publish**.
- **Dispatcher** — `application/dispatch-domain-events.ts`
  (`bun run domain-events:dispatch`, dibangun di atas runner worker bersama
  `src/lib/jobs/job-runner.ts`): mengklaim, mengeksekusi, dan menuntaskan
  pengiriman yang jatuh tempo per konsumen terdaftar, per tenant, dengan
  pengurutan head-of-line per `order_key`, backoff eksponensial, dan transisi
  dead-letter.
- **Konsumen idempoten** — `applyConsumerEffectOnce` milik
  `application/consumer-effect.ts` menjamin efek samping sebuah konsumen
  berjalan paling banyak sekali per `(consumer, event)` bahkan di bawah
  pengiriman ulang yang sah (at-least-once, tidak pernah exactly-once).
- **Replay yang aman bagi operator** — `application/delivery-replay.ts`:
  digerbangi izin, wajib beralasan, dijaga `Idempotency-Key`, diaudit, dan
  menolak melakukan replay terhadap skema konsumen yang tidak kompatibel.
- **Pause/resume** — `application/consumer-state-directory.ts`: flag pause per
  `(tenant, consumer)`, diperiksa dispatcher sebelum mengklaim.
- **Port adapter broker opsional** — `infrastructure/broker-adapter-port.ts`:
  sebuah sambungan untuk pengiriman luar-proses di masa depan. Tidak ada broker
  eksternal yang dibutuhkan atau terdaftar secara bawaan; dispatch
  PostgreSQL/dalam-proses adalah satu-satunya jalur yang diimplementasikan,
  sehingga deployment offline/LAN tidak terpengaruh.

## Event dan konsumen referensi

Modul fondasi ini mengirimkan tepat **satu** tipe event referensi yang
mandiri, `awcms.domain-event-runtime.sample.recorded`, dan **dua** konsumen
representatif, untuk melatih seluruh mekanismenya dari ujung ke ujung:

1. `logging.sample_event_audit_projector` — konsumen lintas-modul dalam proses
   yang sama yang memproyeksikan event ke jejak audit modul `logging` lewat
   `recordAuditEvent`.
2. `domain_event_runtime.activity_rollup_projector` — proyeksi read-model
   mandiri yang memelihara tabel rollup per-tenant/hari/tipe-event
   `awcms_domain_event_activity_daily`.

> Catatan port: registry awcms-mini turut membawa konsumen gelombang berikutnya
> yang memproyeksikan ke modul `reporting` dan `integration_hub` miliknya.
> Modul-modul itu tidak ada di repo ini, jadi konsumen tersebut sengaja tidak
> diport (mereka akan mengimpor modul yang tidak ada). Kedua konsumen di atas
> sepenuhnya mandiri.

## Permukaan HTTP (`/api/v1/domain-events`)

| Metode & path                   | Izin                | Catatan                                                 |
| ------------------------------- | ------------------- | ------------------------------------------------------- |
| `GET /events`                   | `events.read`       | Daftar terbatas, hanya proyeksi payload yang diredaksi. |
| `GET /events/{id}`              | `events.read`       | Hanya proyeksi payload yang diredaksi.                  |
| `GET /deliveries`               | `deliveries.read`   | `status=dead_letter` adalah tampilan DLQ.               |
| `GET /deliveries/{id}`          | `deliveries.read`   | Inspeksi DLQ satu-rekaman dengan event yang di-join.    |
| `POST /deliveries/{id}/replay`  | `deliveries.replay` | Wajib beralasan, `Idempotency-Key`, diaudit.            |
| `GET /consumers`                | `consumers.read`    | Registry + status pause + jumlah backlog.               |
| `POST /consumers/{name}/pause`  | `consumers.manage`  | Wajib beralasan, diaudit (idempoten secara alami).      |
| `POST /consumers/{name}/resume` | `consumers.manage`  | Diaudit (idempoten secara alami).                       |

Seluruh endpoint ber-cakupan tenant, dijaga ABAC default-deny
(`authorizeInTransaction`), dan berjalan di dalam `withTenant` sehingga RLS
menegakkan isolasi tenant di lapisan basis data.

## Admin UI (`/admin/domain-events`)

`src/pages/admin/domain-events.astro` (ADR-0051) — konsol operator untuk tabel
di atas: registry konsumen dengan status pause dan jumlah backlog
(pause/resume), daftar pengiriman yang disaring menurut status/konsumen/tipe
event dengan replay pada baris yang ter-dead-letter, serta outbox itu sendiri
dengan inspektur payload. Kelima izin digerakkan dari satu halaman ini. Bacaan
melewati fungsi aplikasi milik modul ini sendiri di dalam satu
`withTenantOrThrow`; setiap mutasi mem-POST ke endpoint di atas.

Pemisahan idempotensi pada tabel itu direproduksi persis oleh layarnya, dan
`tests/admin-domain-events-page-contract.test.ts` memakukannya: `replay`
mengirim `Idempotency-Key` karena tiap panggilan melakukan pekerjaan baru,
sedangkan `pause` dan `resume` tidak mengirimnya karena keduanya idempoten
secara alami. Mengirim kunci ke `pause` akan menyiratkan kontrak replay yang
tidak dimiliki endpoint itu; menghilangkannya pada `replay` akan menghasilkan
tombol yang selalu gagal.

## Model data (migrasi `009`)

Tabel ber-cakupan tenant, terisolasi tenant oleh RLS:

- `awcms_domain_events` — outbox yang hanya-tambah.
- `awcms_domain_event_deliveries` — state retry/DLQ per-(event, konsumen).
- `awcms_domain_event_consumer_effects` — penanda idempotensi generik
  per-konsumen.
- `awcms_domain_event_consumer_state` — flag pause per-(tenant, konsumen).
- `awcms_domain_event_replays` — jejak audit replay yang hanya-tambah.
- `awcms_domain_event_activity_daily` — rollup read-model referensi.

Migrasi yang sama juga memperkenalkan penyimpanan generik
`awcms_idempotency_keys`, karena endpoint replay modul ini adalah mutasi
berisiko-tinggi pertama di repo ini yang membutuhkan pembungkus
`Idempotency-Key` standar.

## Operasi dispatcher

`bun run domain-events:dispatch` — klaim/eksekusi/tuntaskan pengiriman yang
jatuh tempo untuk setiap tenant aktif dan konsumen terdaftar. Jadwal yang
disarankan: setiap 30–60 detik lewat cron/systemd timer. Operasi murni
PostgreSQL/dalam-proses (tanpa egress jaringan eksternal); aman pada deployment
offline/LAN. Mendukung `--dry-run` (pratinjau backlog hanya-baca) dan
`--json-output=<path>`.
