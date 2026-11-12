🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](database-capacity-runbook.md)

<!-- i18n-source-hash: sha256:a41400d885b89e9064517f26fc8964988d09e712b8ee04f43fc0149832a98e7a -->

# Runbook Kapasitas Database — Anggaran Pool/Work-Class Sadar-Deployment

> **Status dokumen (AWCMS).** Mekanisme di bawah diwarisi dari base teknis
> `awcms-mini` (Issue #743 di repo asal, epic `platform-evolution`) dan
> berlaku generik terlepas dari modul ERP mana yang aktif.
> **`src/lib/database/capacity-config.ts` (library-nya) aktif di runtime**:
> dipakai oleh field `capacity` milik `GET /api/v1/database/pool/health`, dan
> `recordGauge` mencatat metrik `db_pool_capacity_*`.
> **`bun run database:capacity:check` (CLI berdiri sendiri) sudah ada** sejak
> Issue #1286 (`scripts/database-capacity-check.ts`): offline secara default,
> dengan pembacaan `max_connections` server yang opsional lewat `--live`.
> **Skrip `production:preflight` masih belum ada** di `package.json` (lihat
> [`production-preflight-runbook.md`](production-preflight-runbook.md)), jadi
> pemeriksaan ini adalah **langkah manual** sebelum rencana scale-out atau
> restart apa pun dan belum terpasang sebagai stage preflight. Yang juga
> **belum ada** adalah baseline terukur dari beban nyata (ADR-0161); angka
> contoh di dokumen ini tetap ilustratif sampai ada.

Pendamping [`database-pooling.md`](database-pooling.md) (konfigurasi pool
per-proses, gerbang konkurensi work-class, circuit breaker) dan
[`production-preflight-runbook.md`](production-preflight-runbook.md)
(prosedur operasional di sekitar `bun run production:preflight`, yang
memuat stage `database:capacity` milik runbook ini).

## Kenapa ini ada

Tiga lapis milik `database-pooling.md` (pool `Bun.SQL`, gerbang
work-class, circuit breaker) menakar dan melindungi pemakaian koneksi SATU
proses saja. Tak satu pun dari mereka tahu berapa banyak instance LAIN
dari proses yang sama sedang berjalan di tempat lain. Ukuran pool yang
sempurna amannya saat sendirian tetap bisa menyebabkan badai koneksi
begitu dikalikan ke seluruh armada yang diskalakan horizontal:

```text
10 instance aplikasi x pool_max 20 = 200 koneksi aplikasi
kapasitas PgBouncer/PostgreSQL yang disetujui = 80
hasil = badai koneksi saat scale-out atau restart
```

`src/lib/database/capacity-config.ts` menutup celah ini: model bertipe dan
dapat dikonfigurasi lewat env atas jumlah instance expected/min/max serta
anggaran pool setiap kelas proses pengguna database, sebuah kalkulator
murni, dan sebuah validator yang gagal pada kombinasi yang tidak aman atau
tidak konsisten secara internal. Library ini nyata dan sudah berjalan
read-only setiap kali `GET /api/v1/database/pool/health` dipanggil (lewat
field `capacity`-nya). `bun run database:capacity:check` menjalankan validator
yang sama sesuai permintaan, hanya dari konfigurasi, sehingga aritmetikanya
terjadi sebelum scale-out, bukan saat sedang berlangsung.

## Inventaris kelas proses

| Kelas    | Apa itu                                                     | Role           | String koneksi        |
| -------- | ----------------------------------------------------------- | -------------- | --------------------- |
| `app`    | Setiap instance web/SSR (`bun run start`/`preview`/`dev`)   | `awcms_app`    | `DATABASE_URL`        |
| `worker` | Skrip latar tanpa pengawasan (`getWorkerDatabaseClient()`)  | `awcms_worker` | `WORKER_DATABASE_URL` |
| `setup`  | Hanya `POST /api/v1/setup/initialize` (wizard sekali pakai) | `awcms_setup`  | `SETUP_DATABASE_URL`  |

**Default `DATABASE_CAPACITY_WORKER_INSTANCES_MAX` (1) lebih sempit
daripada kelihatannya.** Ia hanya memperhitungkan satu instance dari NAMA
job yang SAMA berjalan pada satu waktu — kasus yang sudah dimitigasi oleh
advisory lock Postgres milik `job-runner.ts` (lihat §Job dan gerbang
konkurensi di bawah). Ia TIDAK menganggarkan dua skrip worker BERBEDA yang
dijadwalkan berjalan bersamaan di host yang sama (mis. job batch payroll
dan purge audit-log sama-sama menyala di menit cron yang sama) —
masing-masing adalah proses terpisah yang membuka pool role `worker`-nya
sendiri pada saat yang sama, jadi tumpang tindih nyata dari N skrip
berbeda butuh `DATABASE_CAPACITY_WORKER_INSTANCES_MAX >= N`, bukan `1`,
sekalipun advisory lock menjamin tidak ada SATU nama job pun yang pernah
menimpa dirinya sendiri. Tata letak cron dengan banyak job berbarengan
wajib menakar ini secara eksplisit.

Dikecualikan, beserta alasannya (bukan bagian dari jumlah instance x
pool_max, lihat komentar header `capacity-config.ts` untuk penalaran
lengkapnya):

- **Perkakas CLI migrasi/backup/restore** (`bun run db:migrate`,
  `deploy/backup/*.sh`) — koneksi ad hoc, ber-privilege, diserialkan
  operator. Mereka mengambil dari
  `DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS` sebagai gantinya.
- **Proses test/CI** — database test/CI terisolasi dengan
  `max_connections` independennya sendiri, tidak pernah berbagi anggaran
  dengan deployment nyata.

## Rumusnya

```text
sum(instance_count[class] x pool_max[class]) + reserved_headroom
  <= kapasitas PgBouncer/PostgreSQL yang disetujui
```

dievaluasi pada jumlah instance **max** yang dikonfigurasi tiap kelas
(plafon horizontal yang telah disetujui operator, bukan sekadar keadaan
tunak hari ini) — "sebelum deployment horizontal" berarti "kalau kamu
menskalakan sampai max yang kamu konfigurasi, apakah ia masih muat."

### PostgreSQL langsung (default, `DATABASE_PGBOUNCER=false`)

Setiap koneksi pool `app`/`worker`/`setup` adalah koneksi backend
PostgreSQL nyata — rumusnya diperiksa langsung terhadap
`DATABASE_CAPACITY_APPROVED_CONNECTIONS`.

### Transaction pooling PgBouncer (`DATABASE_PGBOUNCER=true`)

Dua pemeriksaan terpisah, karena PgBouncer memultipleks banyak koneksi
sisi-klien ke koneksi sisi-server yang jauh lebih sedikit:

1. **Sisi-app**: `sum(instance_count x pool_max)` wajib muat di dalam
   `DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN` (`max_client_conn` milik
   `pgbouncer.ini`).
2. **Sisi-server**: `DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE x pool +
DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS` wajib muat di dalam
   `DATABASE_CAPACITY_APPROVED_CONNECTIONS` — koneksi backend MILIK
   PgBouncer SENDIRI ke PostgreSQL, terlepas dari berapa banyak klien
   sisi-app yang dimultipleks ke atasnya. `default_pool_size` berlaku **per
   pasangan (database, user)**, dan aplikasi ini bisa memakai tiga role
   (`awcms_app`, `awcms_worker`, `awcms_setup`), jadi "pool" adalah jumlah
   pasangan yang berbeda. Angkanya diturunkan dari nama user dan database di
   `DATABASE_URL`, `WORKER_DATABASE_URL` dan `SETUP_DATABASE_URL` (kelas yang
   bisa berjalan) dan dapat dipaksa lewat
   `DATABASE_CAPACITY_PGBOUNCER_POOL_COUNT`. `reserve_pool_size`, bila Anda
   mengisinya di `pgbouncer.ini`, menambah batas per pool dan tidak
   dimodelkan; sisakan ruang untuknya di anggaran yang disetujui. Bila ada
   lebih dari satu proses PgBouncer di depan satu PostgreSQL, kalikan dengan
   jumlahnya.

Jaga `DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN`/
`DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE` tetap selaras dengan
`pgbouncer.ini` nyata milik operator (lihat
[`../../deploy/pgbouncer/pgbouncer.ini.example`](../../deploy/pgbouncer/pgbouncer.ini.example))
— pemeriksaannya hanya bermakna bila keduanya mencerminkan konfigurasi
yang benar-benar ter-deploy; tidak ada yang membaca `pgbouncer.ini` itu
sendiri (ia proses terpisah yang tidak diintrospeksi aplikasi ini).

## Rujukan konfigurasi

Tabel env var lengkap: dokumen rujukan konfigurasi (mengikuti pola doc 18
base `awcms-mini`) §Kapasitas deployment-aware. Setiap variabel OPSIONAL
dengan default konservatif yang mereproduksi topologi offline/LAN
satu-instance — validator `capacity-config.ts` yang mendasarinya lolos
tanpa satu pun di-set (diverifikasi hari ini dengan memanggil validator
secara langsung; lewat `bun run database:capacity:check` begitu CLI
wrapper itu ada).

## Contoh terkerjakan — menakar untuk scale-out 4 instance

Deployment: 4 instance `app` di belakang load balancer, 1 host worker
khusus (mis. menjalankan job batch payroll/reporting), tanpa PgBouncer,
sebuah PostgreSQL terkelola dengan anggaran disetujui 100 koneksi.

```bash
DATABASE_CAPACITY_APP_INSTANCES_EXPECTED=4
DATABASE_CAPACITY_APP_INSTANCES_MAX=6        # ruang lega untuk rolling restart
DATABASE_POOL_MAX=15                          # turunkan max per-instance agar muat anggaran
DATABASE_CAPACITY_WORKER_INSTANCES_MAX=1
DATABASE_CAPACITY_APPROVED_CONNECTIONS=100
DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS=5
```

Kasus terburuk: `app` 6 x 15 = 90, `worker` 1 x 15 = 15 (worker jatuh
balik ke `DATABASE_POOL_MAX` kecuali `DATABASE_POOL_MAX_WORKER` di-set
terpisah), `setup` 1 x 15 = 15 (fallback yang sama) = 120, ditambah 5
cadangan = 125 > 100 — **konfigurasi ini akan GAGAL** pada pemeriksaan
`bun run database:capacity:check` apa adanya. Perbaiki dengan juga men-set
`DATABASE_POOL_MAX_WORKER=5`/`DATABASE_POOL_MAX_SETUP=5` (worker/setup
jarang butuh koneksi sebanyak kelas `app` yang melayani request):
`90 + 1x5 + 1x5 + 5 = 105` — masih lebih. Turunkan `DATABASE_POOL_MAX` ke
12: `6x12 + 5 + 5 + 5 = 87 <= 100` — lolos. Loop iteratif "jalankan
pemeriksaannya, baca temuannya, sesuaikan satu angka" adalah alur kerja yang
dimaksudkan; pemeriksaan itu ada justru supaya aritmetika ini terjadi sebelum
scale-out, bukan saat sedang berlangsung.

## Contoh terkerjakan — armada yang sama dengan dan tanpa PgBouncer

10 instance `app`, 1 `worker`, `DATABASE_POOL_MAX=20`, role worker khusus
(`WORKER_DATABASE_URL`), dan PostgreSQL dengan `max_connections=100`:

| Profil                                                   | Aritmetika                                                                         | Hasil                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------- |
| Langsung                                                 | `10 x 20 + 1 x 20 + 1 x 20 (setup) = 240`, tersedia `100 - 5 = 95`                 | **GAGAL** (240 > 95)       |
| PgBouncer, `max_client_conn=400`, `default_pool_size=20` | klien `240 <= 400`; backend `20 x 2 pool + 5 cadangan = 45 <= 100`                 | **OK**                     |
| PgBouncer, `max_client_conn=200`                         | klien `240 > 200`                                                                  | **GAGAL** (klien melebihi) |
| PgBouncer, `default_pool_size=50`                        | backend `50 x 2 + 5 = 105 > 100` (pembacaan per-pool, `50 + 5`, keliru meloloskan) | **GAGAL**                  |

Keempat baris diuji unit (`tests/database-capacity-check.test.ts`).

## Menjalankan pemeriksaannya

```bash
# offline, dari env yang sama dengan yang dibaca aplikasi
DATABASE_CAPACITY_APP_INSTANCES_MAX=10 DATABASE_CAPACITY_APP_INSTANCES_EXPECTED=10 \
  bun run database:capacity:check

# sekaligus menjepit anggaran pada apa yang diterima server hidup (read-only:
# dua setting dan satu hitungan sesi). Arahkan langsung ke PostgreSQL.
DATABASE_CAPACITY_LIVE_URL=<url-postgres-langsung> bun run database:capacity:check --live

bun run database:capacity:check --json   # terbaca mesin
```

Perintah ini mencetak aritmetika per kelas untuk skenario `expected` dan `max`,
anggaran pembandingnya, dan satu baris per temuan. Kode keluar: `0` lolos
(`[WARNING]` tidak pernah memblokir), `1` anggaran gagal atau tidak konsisten,
`2` salah penggunaan atau server `--live` tidak terbaca (tidak pernah lolos
diam-diam). Ia tidak mengubah konfigurasi dan tidak mencetak connection string.
Jalankan dengan nilai produksi `DATABASE_POOL_MAX*`, `DATABASE_PGBOUNCER` dan
`DATABASE_CAPACITY_*` sebelum rencana scale-out atau restart apa pun, dan lagi
setiap kali jumlah instance atau ukuran pool berubah. Belum ada skrip
`production:preflight`, jadi tidak ada yang menjalankannya untuk Anda.

## Perilaku saturasi yang anggun

Antrean FIFO work-class juga berbatas
(`DATABASE_WORK_CLASS_QUEUE_MULTIPLIER`, default 4x max konkurensi kelas
itu sendiri — lihat `work-class.ts`). Begitu antrean sebuah kelas berada
di batas itu, pemanggil BARU ditolak seketika (`WorkClassQueueFullError`,
HTTP `503 DATABASE_BUSY` + `Retry-After: 2`) alih-alih ikut antrean yang
terus membesar lalu akhirnya timeout — "503 terkendali alih-alih timeout
beruntun." Pemanggil yang MEMANG mengantre lalu kemudian timeout kini juga
mendapat `Retry-After: 2`; request yang ditolak karena circuit breaker
terbuka mendapat `Retry-After: 30` (kira-kira `openDurationMs` milik
breaker itu sendiri). Tak satu pun dari kedua angka itu dihitung dari
state langsung (lihat komentar dokumentasi `tenant-context.ts` untuk
alasannya) — keduanya konstanta tetap yang konservatif.

## Sinyal operasional

`GET /api/v1/database/pool/health` memuat field `capacity` (max pool
terkonfigurasi per kelas untuk proses ini, anggaran yang disetujui, dan
cadangan ruang lega) berdampingan dengan snapshot saturasi work-class yang
sudah ada sebelumnya (tiap entri juga melaporkan `maxQueueDepth`). Metrik
(`src/lib/observability/metrics-port.ts`), seluruhnya hanya label
berkardinalitas-rendah/terdefinisi-di-kode, tanpa id tenant, tanpa DSN:

| Metrik                                         | Tipe      | Label                     | Makna                                                           |
| ---------------------------------------------- | --------- | ------------------------- | --------------------------------------------------------------- |
| `db_pool_work_class_rejected_total`            | counter   | `workClass`               | Penolakan seketika (antrean sudah penuh)                        |
| `db_pool_work_class_wait_ms`                   | histogram | `workClass`, `outcome`    | Berapa lama pemanggil yang mengantre menunggu (durasi saturasi) |
| `db_pool_capacity_configured_connections`      | gauge     | `processClass`            | Max pool terkonfigurasi proses ini                              |
| `db_pool_capacity_estimated_total_connections` | gauge     | `scenario` (expected/max) | Estimasi se-armada dari konfigurasi proses ini sendiri          |
| `db_pool_capacity_approved_budget`             | gauge     | (tidak ada)               | Anggaran koneksi disetujui yang dikonfigurasi                   |

## Respons insiden — saturasi / badai koneksi

1. **Gejala**: ledakan respons `503 DATABASE_BUSY`, atau
   `GET /api/v1/database/pool/health` melaporkan `status: "degraded"`/
   `"unhealthy"`.
2. **Periksa state circuit-breaker lebih dulu** (`circuitBreakerState` di
   respons pool health). `open` berarti database-nya sendiri yang sedang
   gagal (masalah outage/konektivitas nyata) — ini BUKAN masalah
   penakaran kapasitas; ikuti diagnosis outage database yang biasa
   (konektivitas, kesehatan server DB, stage preflight `db:connectivity`),
   bukan langkah-langkah di bawah. Perilaku fail-fast milik circuit
   breaker sendiri (dok `database-pooling.md` §3) sudah menjalankan
   tugasnya: mencegah retry tanpa batas terhadap dependensi yang gagal.
3. **Bila breaker `closed`/`half_open` tapi sebuah work class menunjukkan
   `active >= max` dengan `queued > 0`** (atau
   `db_pool_work_class_rejected_total` menanjak): ini MEMANG peristiwa
   kapasitas/backpressure, bukan outage.
   - Pastikan apakah ini scale-out/restart yang DIHARAPKAN (sebuah
     instance `app` baru naik, atau beberapa restart sekaligus) — bila
     ya, ini persis perilaku antrean-berbatas/503-terkendali yang bekerja
     sesuai desain; ia semestinya pulih sendiri dalam `queueTimeoutMs`
     (default 2s) begitu ledakannya lewat. Klien yang menghormati
     `Retry-After` pulih otomatis.
   - Bila saturasi bertahan melewati beberapa jendela queue-timeout,
     periksa ulang kapasitas terhadap jumlah instance nyata SAAT INI
     (bukan sekadar `expected`/`max` yang dikonfigurasi) — jalankan
     `bun run database:capacity:check` dengan jumlah instance saat ini.
     Satu instance ekstra yang tak direncanakan (deployment lama yang
     macet dan belum dikuras, re-run worker yang lepas kendali — mis.
     batch payroll ganda) mendorong pemakaian nyata melampaui yang
     dianggarkan.
   - JANGAN merespons dengan menaikkan `DATABASE_POOL_MAX` secara manual
     pada instance produksi yang hidup tanpa menjalankan ulang
     pemeriksaan kapasitas lebih dulu — pool per-instance yang lebih
     besar tanpa kenaikan anggaran disetujui yang sepadan adalah persis
     risiko badai koneksi yang ditutup oleh ini.
4. **Catat insidennya** dengan cara yang sama seperti peristiwa produksi
   lain — stempel waktu, kelas mana yang jenuh, jumlah instance saat itu,
   resolusinya (pulih sendiri vs. perubahan manual pool/jumlah instance).

## Job dan gerbang konkurensi — dikoreksi 22 Agustus 2026

Bagian ini dulu berjudul "Keterbatasan yang diketahui" dan menyatakan job latar
**tidak** digerbangi saat runtime lewat `work-class.ts`, bahwa "panggilan DB
nyata sebuah job saat ini tidak memanggil `acquireWorkClassSlot`", dan bahwa
memasang ulang mereka adalah tindak lanjut yang masuk akal. **Itu benar saat
ditulis dan sudah salah ketika ada yang membacanya.** Job membuka transaksi
tenant lewat `withTenantOrThrow`, yang mengambil slot work-class persis seperti
sebuah request — jadi mereka sudah melewati gerbang itu sejak lama, dan
satu-satunya pertanyaan adalah bucket mana.

Temuan D11 putaran 17 Agustus 2026 adalah harga dari kekaburan itu: **tujuh
skrip tidak meneruskan `workClass` sama sekali**, sehingga transaksinya memakai
default `"interactive"` yang didokumentasikan `withTenant` dan purge malam
mengantre di bucket yang diukur untuk pengguna hidup. Driftnya juga berjalan
arah sebaliknya — `site-search-reconcile.ts` meneruskan `maintenance` padahal
registry menyatakan `background_sync`.

**Posisinya sekarang.** Setiap skrip job yang membuka transaksinya sendiri
meneruskan kelas yang dinyatakan `src/lib/database/work-class-registry.ts`
untuknya, dan `bun run db:work-class:generate` MENOLAK jalan bila tidak — di
kedua arah, opsi yang hilang maupun yang bertentangan. Penolakan itu membaca
satu berkas, yaitu skripnya: job yang transaksinya berada di modul bawah `src/`
tidak punya panggilan sendiri untuk diperiksa dan tidak tercakup olehnya.

Konkurensi tingkat-job tetap dibatasi mekanisme kedua yang independen: advisory
lock Postgres milik `src/lib/jobs/job-runner.ts` memastikan paling banyak SATU
instance dari sebuah NAMA job berjalan se-cluster pada satu waktu, dan itulah
risiko badai koneksi yang dominan untuk job terjadwal (re-run yang tumpang
tindih dari job yang SAMA, mis. purge lambat yang masih jalan saat tik cron
berikutnya menyala). Work class mengatur antrean terbatas mana yang ditunggu
transaksi sebuah job; advisory lock mengatur ada berapa job itu. Keduanya tidak
saling menggantikan.

## Gerbang drift CI — registry work-class (SUDAH DIBANGUN, Issue #263)

`docs/awcms/work-class-registry.generated.json` di-generate oleh
`bun run db:work-class:generate` dan diverifikasi oleh `bun run db:work-class:check`,
yang merupakan bagian dari `bun run check` dan dari job `quality` di `ci.yml`.
Pemeriksaannya men-generate ulang di memori lalu men-diff terhadap berkas yang
ter-commit, sehingga rute baru, rute yang diklasifikasi ulang, skrip worker baru,
atau alasan job yang berubah tidak bisa merge tanpa diff yang bisa direview pada
berkas itu.

**Dua paruh, dua sumber kebenaran.** Rute di-GENERATE, karena setiap rute sudah
mendeklarasikan kelasnya inline — lewat `defineTenantRoute({ workClass })`
(Issue #255, di mana melewatkannya adalah compile error), lewat literal eksplisit
pada `withTenant(...)`/`withTenantOrThrow(...)`, atau dengan bersandar pada
default `"interactive"` yang terdokumentasi. Job DIDEKLARASIKAN di
`src/lib/database/work-class-registry.ts`, karena kelas sebuah skrip worker
adalah properti SKRIP-nya, bukan properti satu transaksi mana pun di dalamnya,
jadi tidak ada yang bisa dijadikan sumber generate; generator menemukan mereka
lewat kebenaran lapangan (`getWorkerDatabaseClient(` /
`getSetupDatabaseClient(` di `scripts/*.ts`) dan **menolak berjalan** — bukan
sekadar menolak memeriksa — ketika peta yang dideklarasikan dan skrip di disk
tidak sepakat.

Penolakan itu menyala pada jalan pertamanya dan memang benar demikian: empat
skrip worker dari gelombang penyerapan awcms-micro (`comments-retention`,
`edge-cache-purge`, `site-search-reconcile`, `tenant-domain-dns-sync`) sama
sekali berada di luar model kapasitas, dan empat entri menggambarkan skrip yang
tidak ada di repo ini (`social-publish-dispatch`,
`organization-structure-metrics-snapshot`, `integration-hub-outbound-dispatch`,
`data-exchange-worker`), terbawa dari awcms-mini bersama modul-modulnya yang
diterima-ADR-tapi-belum-diimplementasi.

**Yang dikatakan snapshot hari ini: 216 rute, 18 job.** Dari rute-rute itu, **176
masih bersandar pada default `"interactive"` milik `withTenant`** — mereka
berbagi anggaran pool milik login karena kelalaian, bukan karena keputusan. 28
mengoper literal eksplisit dan 4 lewat `defineTenantRoute`. Mengecilkan angka 176
itu adalah migrasi yang dilacak di Issue #255; berkas ini adalah cara kamu
menyaksikannya terjadi.

> **Sebelum Issue #263 bagian ini menggambarkan sebuah target, dan berkasnya
> menggambarkan awcms-mini.** Ia mendaftar ~284 rute repo itu sementara
> `_disclaimer`-nya sendiri mengklaim "96 rute nyata" untuk repo yang punya 221
> — datanya basi, dan begitu pula peringatan yang mestinya menghentikanmu
> memercayai data itu. Angka kapasitas apa pun yang diambil dari berkas itu
> sebelum tanggal ini wajib diturunkan ulang.

</content>
