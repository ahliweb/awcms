🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](database-pooling.md)

<!-- i18n-source-hash: sha256:2cf6fbb313d4ee61c06fcfeed478572e28e1b6b01f926e0e49288947471e587b -->

# Database Connection Pooling and Backpressure

> **Status dokumen (AWCMS).** Tiga lapisan pooling/backpressure di bawah
> (`Bun.SQL` pool, work-class concurrency gate, circuit breaker) diwarisi
> dari base teknis `awcms-mini` (Issue 10.2 di repo asal) sebagai mekanisme
> generik yang sudah terverifikasi di sana. Di AWCMS, mekanismenya berlaku
> sejak fondasi, tetapi **contoh endpoint/klasifikasi work-class ERP di
> bawah (posting jurnal, payroll run, dsb.) adalah target rencana** — belum
> ada endpoint domain ERP yang benar-benar memanggil `withTenant` dengan
> klasifikasi tersebut, karena modulnya belum diimplementasikan.

Dokumen ini mencatat standar implementasi pooling/backpressure untuk AWCMS
(diwarisi dari base `awcms-mini`, doc governance/ADR terkait untuk
RLS/RBAC-ABAC dan threat model).

## Ringkasan

```mermaid
flowchart LR
  Req[Request] --> Gate{Pool gate per work class}
  Gate -->|slot ada| Conn[(Koneksi)]
  Gate -->|penuh| Queue[Antrean + timeout]
  Queue -->|timeout| Busy[503 DATABASE_BUSY]
  Conn --> CB{Circuit breaker}
  CB -->|open| Busy
```

Tiga lapisan independen bekerja bersama:

1. **`Bun.SQL` pool config** (`src/lib/database/client.ts`) — pool koneksi
   fisik ke PostgreSQL.
2. **Work-class concurrency gate** (`src/lib/database/work-class.ts`) —
   semaphore aplikasi murni di depan pool, membatasi konkurensi per jenis
   beban.
3. **Circuit breaker** (`src/lib/database/circuit-breaker.ts`) — fail-fast
   saat transaksi database berturut-turut gagal.

Keduanya (gate + breaker) diintegrasikan lewat satu titik: `withTenant`
(`src/lib/database/tenant-context.ts`) — setiap endpoint yang sudah ada
memanggil `withTenant`, sehingga perlindungan ini otomatis berlaku tanpa
mengubah setiap route.

## 1. Bun.SQL pool config

`getDatabaseClient()` mengonfigurasi `Bun.SQL` dengan:

| Opsi                           | Sumber                          | Default |
| ------------------------------ | ------------------------------- | ------- |
| `max`                          | `DATABASE_POOL_MAX`             | `20`    |
| `prepare`                      | `DATABASE_PGBOUNCER !== "true"` | `true`  |
| `connection.statement_timeout` | `DATABASE_STATEMENT_TIMEOUT_MS` | `15000` |

Catatan implementasi: `onconnect` pada `Bun.SQL.Options` (lihat
`node_modules/bun-types/sql.d.ts`) bertipe `(err: Error | null) => void` — ia
hanya melaporkan sukses/gagalnya percobaan koneksi, **bukan** memberi akses ke
client untuk menjalankan SQL (contoh JSDoc `onconnect: (client) => ...` di
file tipe yang sama tidak konsisten dengan signature aktualnya). Cara yang
type-correct dan didokumentasikan untuk menerapkan GUC sesi seperti
`statement_timeout` pada setiap koneksi pooled adalah opsi `connection`
("Postgres client runtime configuration options", lihat
postgresql.org/docs/current/runtime-config-client.html). `onconnect` tetap
dipakai, hanya untuk mencatat kegagalan koneksi ke logger terstruktur.

## 2. Work-class concurrency gate

`src/lib/database/work-class.ts` adalah semaphore in-memory per proses (bukan
lintas-instance). Lima work class dan batas konkurensinya:

| Work class             | Contoh (target ERP)                                | Prioritas | Max |
| ---------------------- | -------------------------------------------------- | --------- | --: |
| `critical_transaction` | Posting jurnal/ledger, payroll run, stock movement | Tertinggi |  10 |
| `interactive`          | CRUD admin, search master data                     | Tinggi    |   8 |
| `reporting`            | Laporan keuangan/inventori, dashboard              | Sedang    |   4 |
| `background_sync`      | Sync push/pull, outbox, integrasi eksternal        | Rendah    |   4 |
| `maintenance`          | Migration, backup                                  | Terjadwal |   1 |
| `realtime_stream`      | Pembacaan per tick stream progres SSE (#1171)      | Rendah    |   3 |

Angka ini kecil dan tetap (tidak env-tunable) secara sengaja — jumlahnya jauh
di bawah `DATABASE_POOL_MAX` (default 20) sehingga masih ada headroom di pool
`Bun.SQL` itu sendiri, dan urutannya mengikuti prioritas: `critical_transaction`
mendapat alokasi terbesar karena prioritas tertinggi; `maintenance`
diserialkan (`max: 1`) karena bukan concern HTTP interaktif.

Ketika sebuah class penuh, pemanggil berikutnya masuk antrean FIFO sampai
slot bebas atau `timeoutMs` habis. Timeout menolak dengan
`WorkClassTimeoutError` (bukan string-matching pesan error), sehingga
pemanggil bisa memetakannya ke `503 DATABASE_BUSY` secara type-safe.

**Antrean dibatasi** (diwarisi dari base, `awcms-mini` Issue #743): antrean
per work class TIDAK unbounded — begitu antrean mencapai `max konkurensi x
DATABASE_WORK_CLASS_QUEUE_MULTIPLIER` (default `4`, di-clamp `[1, 20]`),
pemanggil berikutnya ditolak SEKETIKA dengan `WorkClassQueueFullError` (beda
dari `WorkClassTimeoutError` — tidak pernah menunggu sama sekali), dipetakan
ke `503 DATABASE_BUSY` + header `Retry-After`. Ini menutup risiko "cascading
timeout chain" (antrean tumbuh tak terbatas, setiap pemanggil menunggu
`timeoutMs` penuh sebelum akhirnya gagal) — lihat
[`database-capacity-runbook.md`](database-capacity-runbook.md) §Graceful
saturation behavior.

`critical_transaction` dan `maintenance` sudah ada di tipe/konfigurasi untuk
kebutuhan modul ERP (mis. endpoint posting jurnal/payroll) tetapi **belum
dipakai oleh endpoint manapun** karena belum ada modul ERP yang
diimplementasikan — begitu modul finance/HR-payroll pertama ada, endpoint
posting-nya diharapkan mengklasifikasikan diri ke `critical_transaction`.

## 3. Circuit breaker

`src/lib/database/circuit-breaker.ts` adalah breaker 3-state standar
(`closed → open → half_open → closed`), murni fungsi dari `now: Date` yang
di-inject oleh pemanggil (tidak ada `Date.now()` tersembunyi), sehingga
sepenuhnya unit-testable tanpa menunggu waktu nyata.

- **Closed → Open**: setelah `failureThreshold` (5) kegagalan berturut-turut.
- **Open → Half-open**: setelah `openDurationMs` (30 detik) berlalu sejak
  breaker terbuka, tepat satu percobaan diizinkan lewat.
- **Half-open → Closed**: percobaan sukses.
- **Half-open → Open**: percobaan gagal; jendela `openDurationMs` dimulai
  ulang dari waktu kegagalan tersebut.

Satu instance breaker dipakai bersama di seluruh aplikasi (module-level
singleton `getDatabaseCircuitBreaker()`), bukan per-request — sehingga
kegagalan yang terakumulasi lintas request/tenant memicu satu keputusan
fail-fast untuk semua trafik.

## 4. Integrasi ke `withTenant`

```ts
withTenant(sql, tenantId, fn, {
  workClass: "background_sync", // default: "interactive"
  queueTimeoutMs: 2000 // default: 2000
});
```

Alur:

1. Cek `circuitBreaker.canAttempt(now)` — jika `false`, langsung
   `503 DATABASE_BUSY` + `Retry-After: 30` (skip antrean sepenuhnya,
   fail-fast).
2. `acquireWorkClassSlot(workClass, queueTimeoutMs)`:
   - Antrean sudah penuh (lihat §2 di atas) → tolak seketika
     dengan `WorkClassQueueFullError`; catat `database.pool.rejected`
     lewat logger terstruktur (`src/lib/logging/logger.ts`),
     lalu `503 DATABASE_BUSY` + `Retry-After: 2`.
   - Menunggu lalu timeout → `WorkClassTimeoutError`; catat
     `database.pool.saturated`, lalu `503 DATABASE_BUSY` +
     `Retry-After: 2`.
3. Jalankan transaction seperti biasa (`SET LOCAL app.current_tenant_id`,
   lalu `fn(tx)`).
4. `finally`: lepas slot work-class.
5. Sukses → `circuitBreaker.recordSuccess()`; transaction/`fn` melempar
   exception → `circuitBreaker.recordFailure()` lalu exception dilempar
   ulang (bukan `fail()` yang mengembalikan Response — response error
   ABAC/validasi dari `fn` yang tidak melempar tetap dihitung sebagai
   "sukses" pada level breaker, karena breaker mengukur kegagalan
   transaksi/koneksi database, bukan logika bisnis).

   Dua pengecualian di catch block yang **tidak** memanggil
   `recordFailure()` meski melempar exception, karena keduanya adalah
   outcome logika bisnis/concurrency yang wajar, bukan kegagalan
   infra database (diwarisi dari base):
   - `IdempotencyRaceLostError` — race benign pada
     `saveIdempotencyRecord`.
   - `Bun.SQL.PostgresError` dengan SQLSTATE kelas `23` (integrity
     constraint violation — `23503` foreign_key_violation, `23505`
     unique_violation, `23514` check_violation, dst.). Sebuah
     `INSERT`/`UPDATE` yang gagal karena FK/unique constraint (mis.
     caller mengirim `tenantId` yang tidak ada) tidak dihitung sebagai
     kegagalan infra — mencegah beberapa request dengan input invalid
     membuka breaker aplikasi-lebar.
   - `Bun.SQL.PostgresError` dengan SQLSTATE kelas `54` (program limit
     exceeded — `54000`, mis. ukuran baris indeks melebihi batas btree akibat
     nilai caller-supplied yang terlalu panjang) — properti input, bukan
     kesehatan database. `Idempotency-Key` dibatasi di middleware (1 sampai 255
     karakter ASCII yang terlihat, terdokumentasi di kontrak sebagai komponen
     bersama `components.parameters.IdempotencyKey`, ADR-0129); pengecualian ini adalah pertahanan berlapis
     untuk nilai tanpa batas lainnya.
   - `Bun.SQL.PostgresError` dengan SQLSTATE kelas `22` (data exception —
     `22P02` invalid_text_representation, `22003` numeric_value_out_of_range,
     dst.) — generalisasi dari kelas `23` di atas, sama-sama "input caller
     yang salah bentuk", bukan kegagalan infra (mis. string bukan-UUID yang
     dibandingkan ke kolom `uuid`). Setiap identifier caller-supplied wajib
     divalidasi `assertUuid()` sebelum menyentuh SQL; pengecualian ini
     menutup celah struktural, bukan menunggu endpoint tertentu
     mereproduksinya.

     Error class lain (koneksi terputus, timeout, syntax error, izin
     ditolak, dst.) tetap dihitung sebagai kegagalan seperti biasa.

Endpoint yang direklasifikasi dari default `"interactive"` (target rencana,
belum ada implementasinya di AWCMS):

- `background_sync`: endpoint sync push/pull/status, object dispatch,
  conflict resolution (pola sama seperti base `awcms-mini`).
- `reporting`: endpoint laporan keuangan/inventori dan audit log.

Semua endpoint lain diharapkan tetap default `"interactive"`.

Catatan tipe: signature `withTenant<T>` generik, tetapi pada praktiknya
setiap call site nyata memakai `T = Response` (setiap endpoint yang ada
langsung mengembalikan hasil `withTenant` dari handler-nya). Karena itu
`fail(...)` di dalam `withTenant` di-cast ke `T` — aman secara praktik
meskipun signature generik tidak menegakkannya secara statis.

## 5. Health endpoint

`GET /api/v1/database/pool/health` (tanpa auth, mengikuti presedan
`/api/v1/health` yang juga publik) melaporkan:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "databaseReachable": true,
    "circuitBreakerState": "closed",
    "workClasses": [
      {
        "workClass": "critical_transaction",
        "active": 0,
        "max": 10,
        "queued": 0,
        "maxQueueDepth": 40
      },
      {
        "workClass": "interactive",
        "active": 0,
        "max": 8,
        "queued": 0,
        "maxQueueDepth": 32
      },
      {
        "workClass": "reporting",
        "active": 0,
        "max": 4,
        "queued": 0,
        "maxQueueDepth": 16
      },
      {
        "workClass": "background_sync",
        "active": 0,
        "max": 4,
        "queued": 0,
        "maxQueueDepth": 16
      },
      {
        "workClass": "maintenance",
        "active": 0,
        "max": 1,
        "queued": 0,
        "maxQueueDepth": 4
      }
    ],
    "capacity": {
      "processClass": "app",
      "poolMax": 20,
      "approvedConnections": 100,
      "reservedAdminHeadroom": 5
    },
    "generatedAt": "2026-07-14T00:00:00.000Z"
  },
  "meta": {}
}
```

`status` dihitung: `unhealthy` jika DB tidak terjangkau atau breaker `open`;
`degraded` jika breaker `half_open` atau ada work class yang penuh
(`active >= max`) dengan antrean tidak kosong; selain itu `healthy`. Endpoint
ini hanya melaporkan agregat (jumlah/boolean), **tidak pernah** data tenant
atau isi query — cek DB dilakukan lewat satu `SELECT 1` langsung memakai
`getDatabaseClient()` (bukan `withTenant`, karena endpoint ini bukan
tenant-scoped), dibungkus try/catch agar outage DB tidak membuat health
check-nya sendiri crash.

`maxQueueDepth` dan blok `capacity` hanya melaporkan angka KONFIGURASI
proses ini sendiri (bukan agregat lintas-instance — satu proses tidak
mengetahui instance lain) — untuk validasi lintas-instance sebelum
scale-out, lihat
[`database-capacity-runbook.md`](database-capacity-runbook.md) (`bun run database:capacity:check`
menjalankan validasi itu sesuai permintaan).

## 6. Domain event `database.pool.saturated`

Didokumentasikan di berkas AsyncAPI kategori "DB Connectivity". **Belum ada
dispatcher pub/sub nyata** untuk domain event apa pun di repo ini —
produsen konkret event ini adalah baris log terstruktur
`database.pool.saturated` yang ditulis oleh `withTenant` lewat
`src/lib/logging/logger.ts`, sama seperti seluruh event AsyncAPI lain yang
baru berupa kontrak terdokumentasi pada tahap fondasi ini.

## 7. PgBouncer (transaction mode) — contoh konfigurasi

Contoh konfigurasi PgBouncer tersimpan satu tempat (canonical) di
[`../../deploy/pgbouncer/pgbouncer.ini.example`](../../deploy/pgbouncer/pgbouncer.ini.example)
— bagian ini hanya kutipan singkat, jangan duplikasi isi lengkapnya di sini
agar tidak ada dua salinan yang bisa berbeda seiring waktu:

```ini
; pgbouncer.ini.example (kutipan — lihat berkas lengkap di link di atas)
[databases]
awcms = host=127.0.0.1 port=5432 dbname=awcms

[pgbouncer]
pool_mode = transaction
default_pool_size = 20 ; selaras dengan DATABASE_POOL_MAX aplikasi ini
```

PgBouncer bersifat **opsional** — topologi LAN-first default (satu server
app + PostgreSQL, lihat `docker-compose.yml` root dan
[`deployment-profiles.md`](deployment-profiles.md)) tidak membutuhkannya;
service `pgbouncer` di compose digerbangi lewat Docker Compose `profiles`
sehingga hanya aktif bila diminta eksplisit.

Contoh Compose dengan image ber-pin (hanya PgBouncer, tanpa PostgreSQL) ada di
[`../../deploy/pgbouncer/docker-compose.yml`](../../deploy/pgbouncer/docker-compose.yml).
Aplikasi bergabung ke jaringannya dan `DATABASE_URL` (serta
`WORKER_DATABASE_URL` / `SETUP_DATABASE_URL` bila dipakai) menunjuk ke
PgBouncer.

### Apa yang diubah `DATABASE_PGBOUNCER=true`, dan kenapa aman bagi RLS

Diverifikasi pada 12 November 2026 terhadap PgBouncer 1.25 dengan `pool_mode =
transaction`, PostgreSQL 18.6 dan Bun 1.4.4, lewat `getDatabaseClient()` dan
`withTenantOrThrow` produksi (`bun run database:pgbouncer:verify` mengulanginya):

| Perihal                                                   | Perilaku                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prepared statement                                        | `prepare: false` diset otomatis. Bun lalu mengirim statement tak bernama yang bisa dirutekan PgBouncer per transaction; query berparameter (`` sql`... ${value}` ``) berjalan. Prepared statement bernama tidak dipakai, jadi `max_prepared_statements` PgBouncer tetap `0`.                                                                                                                                                                                                                                                                                                                                                    |
| `SET LOCAL app.current_tenant_id` (GUC tenant untuk RLS)  | Aman. `withTenant` menjalankan `sql.begin(...)`, sehingga `BEGIN`, `SET LOCAL`, semua query dan `COMMIT` tetap di SATU koneksi backend (PgBouncer menahan satu server selama transaction) dan `SET LOCAL` kembali saat `COMMIT`/`ROLLBACK`. 200 transaction berselang-seling untuk dua tenant di 5 koneksi backend melihat 0 baris asing dan 0 nilai GUC asing; di luar transaction GUC adalah default fail-closed role dan tidak ada baris yang terlihat.                                                                                                                                                                      |
| `statement_timeout`                                       | **Berubah.** Tanpa PgBouncer ia adalah parameter startup koneksi. PgBouncer menolaknya (`unsupported startup parameter: statement_timeout`) dan pool tidak pernah terbuka, sehingga di bawah `DATABASE_PGBOUNCER=true` ia tidak dikirim saat connect dan `withTenant` menjalankan `SET LOCAL statement_timeout` di setiap transaction (nilai `DATABASE_STATEMENT_TIMEOUT_MS`, default 15 detik). Query di luar `withTenant` tidak punya timeout dari app; set default role: `ALTER ROLE awcms_app SET statement_timeout = '15s'`. Jangan memakai `ignore_startup_parameters = statement_timeout`: timeout-nya hilang diam-diam. |
| State sesi                                                | Tidak tersedia di transaction mode. Kode aplikasi tidak boleh memakai `SET` biasa, advisory lock tingkat sesi, langganan `LISTEN`/`NOTIFY`, atau cursor `WITH HOLD` pada profil ini. `withTenant` dan lock job runner yang berscope transaction kompatibel.                                                                                                                                                                                                                                                                                                                                                                     |
| Deployment langsung (`DATABASE_PGBOUNCER` kosong/`false`) | Tidak berubah: prepared statement aktif, `statement_timeout` dikirim saat connect, tanpa statement tambahan per transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Belum diverifikasi: suite integrasi penuh berbasis Postgres
(`bun test tests/integration/`) lewat PgBouncer. Harness-nya membuka koneksi
khusus sendiri ke database sementara, sehingga tidak bisa diarahkan ke
PgBouncer tanpa mengubah harness; bukti isolasi RLS di atas memakai jalur
klien produksi. Job CI yang menjalankan `database:pgbouncer:verify` terhadap
service container PgBouncer mungkin dikerjakan sebagai tindak lanjut.

## 8. Kapasitas deployment-aware

Bagian 1-7 di atas melindungi SATU proses. Kapasitas PostgreSQL/PgBouncer yang
disetujui berlaku untuk SELURUH armada instance. `src/lib/database/
capacity-config.ts` memuat modelnya (instance count per process class, pool
budget, kapasitas PgBouncer, budget koneksi disetujui, headroom admin) yang
dipakai field `capacity` milik `GET /api/v1/database/pool/health` dan
`recordGauge` (`db_pool_capacity_*`), dan `bun run database:capacity:check`
menjalankannya sesuai permintaan: instance x ukuran pool per proses ditambah
headroom cadangan terhadap `max_connections`, atau terhadap batas PgBouncer
bila `DATABASE_PGBOUNCER=true`. Ia gagal (exit 1) bila anggaran terlampaui pada
jumlah instance maksimum yang dikonfigurasi. Jalankan sebelum menambah
instance; belum ada skrip `production:preflight`, jadi ini langkah manual.
Detail lengkap: [`database-capacity-runbook.md`](database-capacity-runbook.md)
(rumus, contoh perhitungan, SOP incident saturasi/connection-storm).

## Gap yang belum ditutup

- Circuit breaker sulit dipicu secara live tanpa cara memaksa kegagalan
  koneksi database yang representatif; verifikasi utamanya adalah unit test
  (`tests/database-pooling.test.ts`), bukan skenario live.
- Saturasi work-class di level HTTP sulit diamati secara deterministik
  karena request cenderung selesai lebih cepat daripada observasi manual.
- Job worker dulu terdaftar di sini sebagai "belum runtime-gated lewat
  concurrency gate `work-class.ts`". Itu **salah, dan sudah salah sejak
  beberapa waktu**: mereka membuka transaksinya lewat `withTenantOrThrow`,
  yang mengambil slot work-class persis seperti sebuah request. Yang
  benar-benar hilang — tujuh skrip tidak meneruskan kelas apa pun, sehingga
  transaksinya mengantre sebagai `interactive` — adalah temuan D11, kini
  tertutup dan digerbangi. Lihat `database-capacity-runbook.md` §Job dan
  gerbang konkurensi.
- Belum ada endpoint domain ERP nyata yang memanfaatkan klasifikasi
work-class di atas — validasi ulang klasifikasi begitu modul finance/
inventory/payroll pertama diimplementasikan.
</content>
