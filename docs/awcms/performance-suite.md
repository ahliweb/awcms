# Performance Suite — Representative Load, Soak, and Query-Plan Regression Budgets

> **Status dokumen:** standar target, bukan status implementasi. Repo `awcms` belum punya `src/lib/performance/`, `scripts/performance-suite.ts`, atau modul ERP apa pun untuk diukur — dokumen ini mengadaptasi arsitektur performance suite yang sudah terbukti di basis `awcms-mini` menjadi desain wajib yang harus diimplementasikan begitu modul-modul domain ERP (finance, inventory, procurement, manufacturing, HR/payroll) mulai dibangun. Mekanisme (fixture deterministik, skenario load/soak/saturasi-dan-recovery, budget regresi query-plan versioned, safety interlock) dipertahankan sebagai standar wajib; contoh workload/tabel disesuaikan ke domain ERP.

Bergantung pada model kapasitas koneksi berbasis deployment (`database-capacity-runbook.md`, menyusul) dan direncanakan menggunakan ulang safety interlock serta bentuk scenario-runner yang sama dengan DR/chaos drill (`resilience-dr-verification.md`, menyusul) alih-alih menciptakan ulang keduanya. Companion untuk disiplin audit/tuning "ukur sebelum optimasi".

## Kenapa ini dibutuhkan

Tanpa suite ini, "performance" di repo ERP manapun cenderung berarti `EXPLAIN ANALYZE` ad hoc saat sesi tuning, plus paling banter satu micro-benchmark yang membuktikan pencatatan metrics sendiri tidak menambah overhead material. Tidak ada yang membuktikan apa pun tentang skala multi-tenant representatif, stabilitas memori jangka panjang, query plan RLS pada volume nyata, atau bagaimana workload interaktif (mis. input transaksi kasir/PO) dan workload pelaporan (laporan keuangan, rekonsiliasi stok) berebut connection pool yang sama di bawah beban. Suite ini menutup celah tersebut: fixture sintetik deterministik, skenario load/soak/mixed-workload/saturation-and-recovery, dan budget regresi query-plan versioned — semuanya bisa dijalankan lokal, di CI (subset aman), atau terjadwal (lane penuh).

## Arsitektur (rencana)

```text
src/lib/performance/
  prng.ts                    PRNG seeded deterministik (mulberry32) — akar dari
                              seluruh jaminan reproduktibilitas di bawah
  scale-profiles.ts          profil skala safe/standard/large: jumlah tenant,
                              jumlah baris per tabel, multiplier noisy-neighbor,
                              durasi soak yang didokumentasikan
  fixture-generator.ts       generator baris murni (tanpa I/O) — seed + profil
                              yang sama selalu menghasilkan fixture plan yang sama
  fixture-seeder.ts          I/O: bulk-insert baris hasil generate lewat
                              withTenant (RLS-enforced, tidak pernah privileged
                              bypass) memakai pola unnest(...) + sql.array(...)
  metrics-aggregate.ts       murni: p50/p95/p99 latency, throughput, error rate
                              dari raw call sample
  process-metrics.ts         I/O tipis: sampling CPU/memori proses, plus
                              passthrough read-only ke snapshot work-class gate
                              NYATA (getWorkClassSaturation) dan
                              pg_stat_activity/pg_locks untuk sinyal koneksi/lock
  redaction.ts               murni: redaksi kredensial DSN, pseudonymization
                              UUID deterministik per-run
  query-plan-budgets.ts      murni: registry budget regresi versioned +
                              evaluator EXPLAIN (FORMAT JSON)
  query-plan-runner.ts       I/O: menjalankan EXPLAIN di bawah RLS, selalu
                              rolled back
  workload.ts                I/O: satu operasi nyata withTenant-gated per work
                              class (interactive/critical_transaction/reporting/
                              background_sync/maintenance)
  scenario-context.ts        shared mutable state (sql client, fixture plan,
                              scale profile) — diset sekali oleh orchestrator
  scenarios/*.ts              implementasi ScenarioDefinition, MENGGUNAKAN ULANG
                              tipe scenario-runner resilience yang sama
                              (runScenario, computeDrOverall) — bukan runner
                              paralel/duplikat
  report.ts                  builder laporan machine-readable + human, dengan
                              redaksi diterapkan sebelum apa pun ditulis ke disk

scripts/
  performance-suite.ts            bun run performance:suite
  performance-query-plan-check.ts bun run performance:query-plan:check
```

## Safety interlock — digunakan ulang, bukan diciptakan ulang

Kedua script direncanakan mengimpor `authorizeDrDrill` dari `src/lib/resilience/target-guard.ts` TANPA MODIFIKASI — guard target produksi non-overridable yang sama yang dipakai `scripts/dr-drill.ts`:

- `APP_ENV=production` ditolak tanpa syarat, tidak ada flag override.
- Host `DATABASE_URL` wajib entri allowlist lokal/isolated yang dikenal (default-deny untuk apa pun yang tidak dikenal).
- `--confirm-non-production=<nilai APP_ENV>` adalah typo-catcher wajib.

Lihat `resilience-dr-verification.md` (menyusul) untuk flowchart safety-interlock lengkap — berlaku identik di sini.

## Data sintetik — deterministik, dapat dikonfigurasi, distribusi terdokumentasi

`scale-profiles.ts` mendefinisikan tiga profil versioned:

| Profil    | Tenants | Multiplier noisy-neighbor | Durasi soak | Dipakai oleh                                |
| ---------- | ------: | ---------------------------: | ------------: | -------------------------------------------- |
| `safe`     |       5 |                           6x |   0 (dilewati) | `quality` job CI, default kedua script       |
| `standard` |      20 |                          10x |           60s | investigasi manual                           |
| `large`    |      50 |                          15x |          600s | lane `--full` terjadwal/manual               |

Setiap profil menyediakan seed tabel representatif per tenant — direncanakan mencakup: audit event, ABAC decision log, outbox/delivery sync, antrian sync objek eksternal, idempotency key, dan tabel bisnis tenant-scoped representatif per domain ERP (mis. `awcms_finance_journal_entries` untuk finance, `awcms_inventory_stock_movements` untuk inventory — driving table budget query-plan full-text/laporan). Tenant TERAKHIR di setiap profil adalah tenant noisy-neighbor yang ditunjuk, jumlah barisnya dikalikan — tidak pernah kebetulan skala, selalu posisi deterministik yang sama untuk seed tertentu.

Seluruh randomness mengalir lewat generator seeded `mulberry32` di `prng.ts` — `Math.random()`/`crypto.randomUUID()` tidak pernah muncul di generator manapun, jadi `buildFixturePlan(profile, seed)` byte-identical lintas run/mesin untuk input yang sama. Setiap field string diambil dari kosakata tetap yang kecil — data sintetik murni, tidak pernah menyerupai identitas pelanggan nyata, kredensial, NPWP/NIK, nominal transaksi riil, atau PII lain.

TIMESTAMP baris sama-sama seed-deterministik, bukan hanya jumlah baris/id: setiap generator baris menghitung `createdAt` relatif terhadap sebuah fungsi anchor murni dari seed saja, tidak pernah `Date.now()`/`new Date()` — memastikan `(scaleProfile, seed)` yang sama menghasilkan timestamp baris absolut yang sama terlepas hari nyata suite dijalankan, menjaga komparabilitas rilis-ke-rilis.

Fixture seeding menulis lewat `withTenant` (`fixture-seeder.ts`), chokepoint SAMA yang dilalui setiap mutasi produksi — RLS benar-benar ditegakkan selama seeding, bukan dilewati koneksi privileged, jadi database yang baru diseed adalah bukti nyata bahwa "test negatif RLS lintas-tenant tetap aktif di environment data besar", bukan asumsi.

## Skenario workload — operasi work-class-gated nyata, bukan simulasi

`workload.ts` memetakan model workload ke lima work class repo ini (`src/lib/database/work-class.ts`), masing-masing lewat `withTenant` nyata:

| Work class             | Model workload                     | Operasi nyata (contoh ERP)                                                                                       |
| ------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `interactive`          | read/write API interaktif           | Pembacaan audit-event/list transaksi scoped RLS keyset-style (bentuk sama seperti `GET /api/v1/finance/journals`) |
| `critical_transaction` | transaksi idempoten kritikal        | Store idempotency nyata — mis. posting jurnal/payroll run yang tidak boleh terduplikasi                          |
| `reporting`             | pembacaan pelaporan/analitik        | Agregat laporan keuangan/stok scoped RLS (mis. neraca saldo, ringkasan stok per gudang)                          |
| `background_sync`       | workload sync/event/job              | Probe klaim outbox `FOR UPDATE SKIP LOCKED` (bentuk sama seperti dispatcher sync integrasi eksternal)            |
| `maintenance`           | degradasi terkendali / retensi       | Purge retensi nyata (audit/log), retention window diset agar cocok nol baris terhadap data fixture               |

Skenario (`src/lib/performance/scenarios/*.ts`), masing-masing `ScenarioDefinition` yang menggunakan ulang `runScenario`/`computeDrOverall` milik resilience scenario-runner:

| Skenario                         | Tier | Yang dibuktikan                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interactive-load`                 | safe | p50/p95/p99/throughput/error-rate di bawah pembacaan interaktif konkuren                                                                                                                                                                                                                                       |
| `critical-transaction-integrity`   | safe | N racer konkuren untuk KUNCI idempotency yang SAMA (mis. posting jurnal duplikat) -> tepat 1 baris persisten (atomisitas di bawah beban)                                                                                                                                                                       |
| `reporting-under-load`             | safe | Pembacaan pelaporan konkuren tidak pernah merusak korektnas critical-transaction konkuren                                                                                                                                                                                                                       |
| `background-sync-claim-load`      | safe | Throughput/error-rate klaim `FOR UPDATE SKIP LOCKED` di bawah konkurensi                                                                                                                                                                                                                                        |
| `saturation-and-recovery`          | safe | **Bukti inti**: sengaja over-subscribe gate work-class "maintenance" nyata (kapasitas 5), menegaskan jumlah tepat penolakan langsung `503 DATABASE_BUSY` + `Retry-After: 2`, mengonfirmasi gate kembali kosong (`active=0/queued=0`), dan panggilan susulan berhasil (recovery terbukti)                       |
| `soak-stability`                   | full | Panggilan interaktif berulang selama `soakDurationMs` profil skala; menegaskan pertumbuhan RSS tetap di bawah plafon longgar (tidak ada pertumbuhan tak terbatas) — self-skip pada profil `safe` (`soakDurationMs = 0`)                                                                                        |

`saturation-and-recovery` adalah jawaban konkret untuk kriteria "perilaku saturasi cocok dengan model kapasitas dan recovery terbukti" — tidak mensimulasikan backpressure, benar-benar menjalankan antrean FIFO bounded nyata sampai kapasitas terdokumentasinya dan menegaskan perilaku 503+`Retry-After` yang sudah ada.

## Budget regresi query-plan

`query-plan-budgets.ts` adalah artefak governance versioned — direncanakan mencakup shape query produksi nyata per kategori yang relevan untuk ERP (paginasi scoped RLS, full-text search/pencarian dokumen, klaim outbox, batch purge retensi, agregat pelaporan keuangan/inventori), masing-masing dengan:

- `forbiddenNodeTypes`/`requiredNodeTypesAny` — asersi SHAPE plan (mis. "tidak boleh mengandung Seq Scan", "wajib mengandung Index/Bitmap scan").
- `maxTotalCost`/`maxExecutionTimeMs` — budget numerik versioned.
- `approval: { approvedBy, approvedAt, reason }` — proses eksplisit untuk menyetujui perubahan threshold yang disengaja. Tidak ada env var atau flag yang melonggarkan budget — SATU-SATUNYA cara mengubahnya adalah diff source yang direview, pola governance yang sama dengan registry work-class.

`query-plan-runner.ts` menjalankan `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)` untuk SQL nyata tiap budget terhadap koneksi RLS-enforced NYATA (`app.current_tenant_id` diset via `SET LOCAL`, persis seperti `withTenant`), di dalam transaksi yang SELALU di-rollback — bahkan dua query berbentuk write (klaim outbox `UPDATE`, `SELECT` internal purge retensi) tidak pernah memutasi data fixture yang sudah diseed secara permanen.

### Bukti adversarial (kenapa gate ini bisa dipercaya)

Checker yang hanya pernah diuji terhadap input yang sudah baik tidak membuktikan apa pun soal kemampuannya menangkap regresi nyata. Suite ini wajib mengirimkan DUA bukti adversarial independen:

1. **Bukti pure-function** — `EXPLAIN` JSON hand-built yang mengandung `Seq Scan`, menegaskan `evaluateQueryPlan` menggagalkannya.
2. **Bukti Postgres nyata** — query fixture regresi (deliberately BUKAN bagian dari registry `QUERY_PLAN_BUDGETS` nyata) dijalankan pada tabel yang sama dengan strategi index/bitmap-scan planner dipaksa mati (`SET LOCAL enable_indexscan = off`, dst.) untuk satu `EXPLAIN` itu — mereproduksi persis seperti apa insiden index yang hilang/nonaktif/dikalahkan terlihat di output `EXPLAIN` nyata, menegaskan gate benar-benar melaporkan hasil `Seq Scan` gagal terhadap planner PostgreSQL NYATA, bukan sekadar fixture hand-built.

   (Catatan desain dari basis: menambahkan predikat `ILIKE` tak berindeks di atas filter `tenant_id` berindeks TIDAK cukup — PostgreSQL tetap memilih Index Scan efisien pada prefix `tenant_id` karena RLS selalu menyuntikkan filter `tenant_id = current_setting(...)` dan setiap tabel RLS-scoped punya index berawalan `(tenant_id, ...)`. Memaksa GUC planner adalah cara yang jujur untuk mereproduksi "index hilang/nonaktif", bukan workaround untuk test yang flaky.)

## Artefak laporan machine-readable + human

Kedua script direncanakan menerima `--json-output=<path>` (machine-readable) dan `performance-suite.ts` tambahan menerima `--report-path=<path>` (Markdown human ringkas). Setiap laporan melalui `redaction.ts`'s `redactReport` sebelum ditulis — tiga pass berurutan: redaksi `DATABASE_URL` di sumber, backstop defensif atas SELURUH pohon laporan untuk substring berbentuk DSN di mana pun, dan backstop defensif kedua untuk substring berbentuk UUID di mana pun (diganti pseudonym stabil per-run `id#1`, `id#2`, ..., tidak pernah tenant/user id nyata).

Section `environment` laporan JSON mendokumentasikan konfigurasi hardware/container/database secara eksplisit (platform, arch, jumlah CPU, total memori, versi Bun, profil skala, jumlah tenant, total baris terencana) plus disclaimer eksplisit: **angka hanya bisa dibandingkan rilis-ke-rilis pada environment yang SAMA, tidak pernah jaminan kapasitas produksi universal**.

Contoh (redacted):

```json
{
  "environment": {
    "generatedAt": "2026-07-14T00:00:00.000Z",
    "appEnv": "test",
    "databaseUrlRedacted": "postgres://<redacted>@localhost:5432/awcms",
    "scaleProfileId": "safe",
    "tenantCount": 5,
    "noisyNeighborMultiplier": 6,
    "totalSeededRowsPlanned": 37500,
    "hardware": {
      "platform": "linux",
      "arch": "x64",
      "cpuCount": 8,
      "totalMemoryMb": 16384,
      "bunVersion": "1.3.14"
    },
    "disclaimer": "Numbers reflect THIS container/hardware/database configuration..."
  },
  "tier": "safe",
  "overall": "pass",
  "scenarios": [
    /* ScenarioResult[] — name, tier, status, detail, durationMs, metrics */
  ],
  "queryPlanChecks": [],
  "seedSummary": {
    "tenantCount": 5,
    "rowCounts": { "...": "..." },
    "durationMs": 989
  }
}
```

## Safe subset vs. lane penuh

- **Safe (CI, setiap PR — direncanakan sebagai bagian `quality` job):** `bun run performance:suite -- --confirm-non-production=test` (skala `safe` default, 5 skenario) dan `bun run performance:query-plan:check -- --confirm-non-production=test`. Keduanya berjalan sebagai role least-privilege `awcms_app` sehingga RLS benar-benar ditegakkan, bukan dilewati. Bersama-sama selesai dalam beberapa detik terhadap skala fixture `safe`.
- **Penuh (`--full`, terjadwal/manual saja — TIDAK PERNAH di-wire ke `bun run check` atau setiap-PR CI):**
  ```bash
  APP_ENV=staging DATABASE_URL=<staging-or-isolated-url> \
  bun run performance:suite -- --confirm-non-production=staging --full \
    --json-output=/tmp/performance-report.json \
    --report-path=/tmp/performance-report.md
  ```
  Memakai profil skala `large` sebagai default (override dengan `--scale=`), menambahkan skenario `soak-stability`. Kadensi disarankan: berdampingan dengan rehearsal rilis atau sebelum perubahan infrastruktur/kapasitas besar.

## Membandingkan dua rilis/commit

Jalankan lane safe atau penuh dengan `--seed` YANG SAMA pada dua commit berbeda (atau terhadap perubahan infrastruktur before/after), diff section `scenarios[].metrics` dan `queryPlanChecks[]` dari dua laporan `--json-output`, dan konfirmasi `environment` cocok cukup dekat untuk dibandingkan (profil skala sama, hardware serupa). Regresi metrik atau query-plan di antara dua run adalah sinyal untuk diinvestigasi — bukan gate CI keras pada delta latensi (sengaja: angka wall-clock absolut hanya pernah bisa dibandingkan pada hardware yang cocok).

## Menjalankan lokal

```bash
# Safe subset (cepat, beberapa detik):
APP_ENV=test DATABASE_URL=postgres://...@localhost:.../db \
bun run performance:suite -- --confirm-non-production=test
APP_ENV=test DATABASE_URL=postgres://...@localhost:.../db \
bun run performance:query-plan:check -- --confirm-non-production=test

# Lane penuh (skala besar + soak, menit):
APP_ENV=test DATABASE_URL=postgres://...@localhost:.../db \
bun run performance:suite -- --confirm-non-production=test --full
```

`DATABASE_URL` harus menunjuk ke role least-privilege `awcms_app` (atau koneksi mana pun di mana RLS benar-benar ditegakkan) — koneksi superuser tetap berjalan tanpa error, tapi bukti penegakan RLS yang menjadi tujuan suite ini hanya bermakna di bawah role least-privilege nyata, persis seperti setiap integration test RLS-sensitive lain di repo ini.

## Keterbatasan yang diketahui

- Angka latensi absolut sangat bergantung pada konfigurasi container/hardware/database tempat pengukuran dilakukan (lihat field `disclaimer` laporan sendiri) — tidak pernah disajikan sebagai jaminan produksi universal.
- Skenario `soak-stability` hanya berjalan di lane `full` (`soakDurationMs > 0`); lane `safe` tidak bisa membuktikan stabilitas memori jangka panjang by design (harus tetap cepat).
- Konkurensi job background (berbeda dari budget koneksi) belum digerbangi lewat `work-class.ts` untuk seluruh worker script nyata — workload `background_sync`/`maintenance` suite ini menguji gate WORK-CLASS secara langsung (mekanisme yang dibuktikan suite ini), bukan serialisasi advisory-lock job-runner sendiri, yang sudah punya bukti khusus sendiri (skenario resilience `worker-interruption`).

## Dokumen terkait

- `database-capacity-runbook.md` (menyusul) — model connection-budget fleet-wide yang diuji separuh process-local-nya oleh skenario `saturation-and-recovery` suite ini.
- `resilience-dr-verification.md` (menyusul) — pola target-guard/scenario-runner yang digunakan ulang langsung suite ini.
- `database-pooling.md` (menyusul) — plafon konkurensi work-class/rumus queue-depth yang didorong ke kapasitas oleh skenario suite ini.
- [`observability-metrics.md`](observability-metrics.md) — arsitektur metrics port yang dibaca langsung skenario `saturation-and-recovery`, tanpa mekanisme akuntansi kedua.
- Disiplin audit/tuning "ukur -> temukan bottleneck -> perbaiki -> ukur ulang" yang dilengkapi suite ini.
