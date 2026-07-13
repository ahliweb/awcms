# Bagian 16 — Backend Data Access dan Integrasi Database

> **Status dokumen (2026-07-14):** Repo `awcms` masih pada tahap fondasi ulang ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — **belum ada kode modul ERP, repository, atau migration yang diimplementasikan**. Dokumen ini mengadaptasi pola data access base [awcms-mini](https://github.com/ahliweb/awcms-mini) (repository per modul, RLS via `SET LOCAL`, transactional outbox, idempotency store) menjadi **arsitektur target** yang mengikat untuk platform ERP AWCMS. Contoh Issue/PR konkret di sumber (mis. Issue #494, #599) adalah riwayat implementasi awcms-mini dan dipertahankan sebagai referensi pola, bukan klaim bahwa hal yang sama sudah terjadi di repo ini. Contoh tabel/entitas domain diganti ke ERP (jurnal, purchase order, stock adjustment, payroll) menggantikan contoh retail/POS di sumber.

## Tujuan

Dokumen ini menetapkan **integrasi backend ↔ database** AWCMS: driver & lapisan query konkret, connection pooling & backpressure, mekanisme RLS context (`SET LOCAL`), transaction wrapper & locking, transactional outbox, migration runner, dan idempotency store — sebagai baseline yang mengikat sebelum modul ERP pertama mulai dibangun.

Terkait: dokumen coding standard (mengikuti pola `10_template_kode_coding_standard.md`, akan ditulis di `docs/awcms/`), dokumen ERD/data dictionary (mengikuti pola `04_erd_data_dictionary.md`, akan ditulis), `15_frontend_architecture_integration.md` (sisi frontend).

## Keputusan teknis

| Aspek            | Keputusan                                                               |
| ----------------- | -------------------------------------------------------------------------- |
| Backend platform | **Bun runtime**; semua script backend dijalankan dengan `bun`           |
| Driver           | `postgres` (postgres.js) atau `Bun.sql` — parameterized, mendukung pool |
| Pola akses       | Repository per modul (`infrastructure/repository.ts`)                   |
| RLS context      | `SET LOCAL app.current_tenant_id` di dalam transaction                  |
| Transaction      | Wrapper eksplisit; `FOR UPDATE` untuk stok/saldo; timeout                |
| Event/provider   | **Transactional outbox** (event, pesan CRM/notifikasi, sync)             |
| Soft delete      | Repository default filter `deleted_at IS NULL`; restore/purge berizin   |
| Migration        | Runner berurutan + checksum (`awcms_schema_migrations`)                  |
| Pool             | Work-class + antrean + circuit breaker; PgBouncer opsional               |

## Lapisan akses data

```mermaid
flowchart LR
  Svc[Service] --> Repo[Repository]
  Repo --> Pool[Pool gate - work class]
  Pool --> Conn[(Koneksi PostgreSQL)]
  Repo --> Map[Mapper - safe DTO]
  Svc --> Tx[Transaction wrapper]
  Tx --> Rls[SET LOCAL tenant]
  Tx --> Outbox[Transactional outbox]
```

Aturan: service memanggil repository; repository hanya query terparametrisasi + mapper; tidak ada business logic di repository. Proses backend wajib berjalan di runtime Bun; Node.js bukan platform server utama.

## Kebijakan Bun-only dan pengecualian Node.js

Backend AWCMS menggunakan **Bun-only**:

- Jalankan backend, migration, test, build, preflight, dan script operasional melalui `bun` atau `bun run`.
- Gunakan `bun.lock` sebagai lockfile dan `packageManager: "bun@..."` sebagai deklarasi package manager.
- Dilarang menambah `node`, `npm`, `npx`, `pnpm`, `yarn`, adapter server Node.js, atau dependency yang memaksa proses backend berjalan di Node.js.
- Library yang kompatibel dengan Bun boleh dipakai, walaupun berasal dari ekosistem npm, selama tidak membutuhkan runtime Node.js sebagai platform server.
- **HTTP server** = `Bun.serve` native; **database driver** = `Bun.sql` atau `postgres` (postgres.js), bukan `pg`. Import `node:*` (mis. `node:crypto`) adalah API bawaan Bun dan **diizinkan**. Detail lengkap direncanakan di dokumen coding standard §Standar platform backend (saat ditulis); SSR Astro di atas Bun: doc 15 §Astro SSR di atas runtime Bun.

Pengecualian Node.js hanya boleh bila semua kondisi berikut terpenuhi:

1. Bun belum mendukung capability yang diperlukan, atau library Bun-compatible belum tersedia.
2. Maintainer memberi izin eksplisit sebelum dependency/tooling ditambahkan.
3. Dokumen terkait mencatat alasan, alternatif Bun yang sudah dicoba, scope file/package, batas waktu atau kondisi pencabutan pengecualian, dan rencana migrasi kembali ke Bun.
4. Audit standar pengembangan diperbarui dengan entry pengecualian.
5. CI/preflight menandai pengecualian tersebut agar tidak menjadi pola default.

Tanpa lima syarat tersebut, perubahan yang menambahkan Node.js runtime/tooling dianggap tidak memenuhi Definition of Done.

## RLS context (kritis untuk multi-tenant/multi-entitas)

Setiap transaksi tenant-scoped **wajib** menetapkan tenant di awal, lalu semua query mengikuti policy RLS (dokumen ERD, saat ditulis).

```sql
BEGIN;
SET LOCAL app.current_tenant_id = $1;   -- $1 = tenant aktif dari auth
-- ... query dijalankan dengan RLS aktif ...
COMMIT;
```

Catatan penting:

- Gunakan **`SET LOCAL`** (bukan `SET` sesi) agar aman dengan **PgBouncer transaction pooling** — konteks tidak bocor antar transaksi/koneksi.
- Nilai berasal dari auth middleware, **bukan** header publik mentah. Untuk rute publik tanpa sesi (lihat doc 15 §Rute publik tenant-scoped), nilai tetap harus lewat lookup terverifikasi (`tenantCode → tenant_id` dari `awcms_tenants`) — bukan menerima `tenant_id` mentah dari path/query sebagai kebenaran, prinsip yang sama persis.
- RLS adalah pertahanan lapis kedua; query tetap memfilter `tenant_id` secara eksplisit.

```ts
async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return transaction(async (tx) => {
    await tx.unsafe(
      `SET LOCAL app.current_tenant_id = '${assertUuid(tenantId)}'`
    );
    return fn(tx);
  });
}
```

## Transaction wrapper dan locking

1. Transaction untuk semua mutation multi-table.
2. Set RLS context di awal transaction.
3. `SELECT ... FOR UPDATE` untuk baris stok/saldo akun/bin balance yang berubah.
4. **Urutkan lock berdasarkan `product_id`/`account_id`** untuk mengurangi deadlock.
5. **Jangan** memanggil provider eksternal di dalam transaction (WA/email/R2/AI/payment gateway).
6. Statement timeout untuk mencegah transaksi menggantung.
7. Deadlock retry aman karena idempotency.

### Posting jurnal keuangan (integrasi end-to-end)

```mermaid
sequenceDiagram
  participant API as Handler
  participant Svc as Posting service
  participant DB as PostgreSQL
  participant OB as Outbox
  API->>Svc: post journalEntryId + Idempotency-Key
  Svc->>DB: BEGIN dan SET LOCAL tenant
  Svc->>DB: cek idempotency key
  Svc->>DB: SELECT saldo akun FOR UPDATE urut account_id
  Svc->>DB: validasi saldo & balance debit=kredit
  Svc->>DB: INSERT journal_entry + lines
  Svc->>DB: INSERT ledger_movements (append-only) + update saldo akun
  Svc->>DB: INSERT audit_event
  Svc->>OB: INSERT outbox: finance.journal_entry.posted (+sync, +notifikasi)
  Svc->>DB: simpan idempotency response
  Svc->>DB: COMMIT
  Note over Svc,OB: Setelah commit, dispatcher kirim outbox (provider di luar tx)
```

## Transactional outbox

Event domain, pesan notifikasi, dan sync **ditulis dalam transaction yang sama** dengan perubahan data, lalu dikirim oleh worker terpisah. Ini menjamin konsistensi tanpa memanggil provider di dalam transaction.

```mermaid
flowchart LR
  Tx[Transaction bisnis] --> OB[(awcms_*_outbox)]
  OB --> Disp[Dispatcher worker]
  Disp -->|event| Bus[Konsumer internal]
  Disp -->|notifikasi| Prov[Provider WA/Email]
  Disp -->|sync| Node[Sync push]
  Disp -->|gagal| Retry[Backoff + retry]
```

Tabel terkait (rencana penamaan, mengikuti pola prefiks `awcms_`): `awcms_sync_outbox`, `awcms_message_outbox`, `awcms_object_sync_queue`, `awcms_email_messages`. Status: `pending → sent/failed`, dengan `next_retry_at`.

### Dispatcher claim-lease (email, sync object queue)

Pola konkret di balik "worker terpisah" pada diagram di atas — mengikuti pola yang terbukti di awcms-mini untuk `email/application/email-dispatch.ts` (`bun run email:dispatch`) dan `sync-storage/application/object-dispatch.ts` (`bun run sync:objects:dispatch`), yang akan diadaptasi untuk kebutuhan ERP (mis. dispatcher notifikasi approval PO, dispatcher slip gaji):

1. **CLAIM** — satu transaksi pendek memindahkan baris yang eligible
   (`queued`/`retry_wait` untuk email; `pending` untuk object queue) ke
   status transient `sending`, dengan `UPDATE ... WHERE ... FOR UPDATE
SKIP LOCKED` sehingga pemanggilan bersamaan (dua cron tick tumpang
   tindih) aman tanpa duplikasi. `next_attempt_at`/`next_retry_at` dipakai
   ulang sebagai lease expiry selama status `sending` — tidak ada kolom
   lease terpisah.
2. **SEND** — provider (mis. penyedia email/R2/payment gateway) dipanggil
   **di luar** transaksi apa pun untuk setiap baris yang di-claim.
3. **FINALIZE** — satu transaksi pendek per baris memindahkan `sending`
   ke status akhir: `sent` (sukses), `retry_wait` dengan backoff
   eksponensial (gagal, masih ada sisa retry), atau `failed` (retry habis
   atau kegagalan non-retryable). Setiap percobaan — sukses maupun gagal —
   dicatat di tabel riwayat percobaan (mis. `awcms_email_delivery_attempts`
   atau analognya per domain).

Circuit breaker per-provider (`src/lib/database/circuit-breaker.ts`)
direncanakan membungkus fase SEND: setelah sejumlah kegagalan beruntun, breaker
`open` menghentikan panggilan provider berikutnya untuk sementara waktu
(mencegah retry-loop menghantam provider yang sedang outage) — dispatcher
notifikasi bahkan berhenti meng-claim baris sama sekali selagi breaker
`open`, sementara dispatcher lain yang tak butuh provider tersebut tetap
bisa meng-claim baris yang tidak terdampak selagi breaker terbuka.

### Generic multi-consumer outbox — `domain_event_runtime`

Pola di atas (`sync_storage`/`email`/dispatcher lain) masing-masing
adalah antrean single-purpose dengan satu consumer implisit (dispatcher-nya
sendiri, memanggil satu provider eksternal). `domain_event_runtime`
(mengikuti pola epic `platform-evolution` di awcms-mini) adalah pelengkap
generik, provider-neutral, MULTI-consumer yang direncanakan: satu event
bisa fan-out ke banyak consumer terdaftar sekaligus, dengan ordering
eksplisit per aggregate/order-key (bukan total order global antar
aggregate yang tidak berkaitan) — relevan untuk ERP karena satu event
domain (mis. `procurement.purchase_order.approved`) sering perlu
di-consume oleh lebih dari satu modul sekaligus (finance untuk accrual,
inventory untuk expected receipt, notifikasi untuk vendor). Lihat
`src/modules/domain-event-runtime/README.md` (saat ditulis) untuk desain
lengkap. Produsen memanggil `appendDomainEvent(tx, tenantId, ...)` di
DALAM transaksi bisnisnya sendiri (sama seperti pola outbox di atas);
static consumer registry (`infrastructure/consumer-registry.ts`)
memutuskan fan-out saat publish, bukan saat dispatch.

**Beda penting dari CLAIM/SEND/FINALIZE 3-fase di atas**: reference
consumer modul ini yang same-process, DB-only, TANPA panggilan
eksternal — sehingga claim-check + eksekusi handler + finalize-sukses
berjalan dalam SATU transaksi (bukan tiga fase terpisah), yang justru
membuat crash/restart recovery benar secara konstruksi (transaksi yang
crash mid-handler otomatis rollback seluruhnya, tanpa status "claimed"
transien yang bisa macet) — pola lease 3-fase tetap dibutuhkan untuk
consumer out-of-transaction/broker-backed di masa depan
(`infrastructure/broker-adapter-port.ts`, belum diimplementasikan).

## Connection pooling dan backpressure

Work class membatasi konkurensi per jenis beban agar transaksi operasional tetap prioritas.

| Work class             | Contoh                                         | Prioritas |
| ------------------------ | ------------------------------------------------- | ----------- |
| `critical_transaction` | Posting jurnal, approval PO, transfer receive   | Tertinggi |
| `interactive`          | CRUD admin, search                              | Tinggi    |
| `reporting`            | Laporan keuangan, dashboard                     | Sedang    |
| `background_sync`      | Sync push/pull, outbox, payroll batch           | Rendah    |
| `maintenance`          | Migration, backup                               | Terjadwal |

```mermaid
flowchart LR
  Req[Request] --> Gate{Pool gate per work class}
  Gate -->|slot ada| Conn[(Koneksi)]
  Gate -->|penuh| Queue[Antrean + timeout]
  Queue -->|timeout| Busy[503 DATABASE_BUSY]
  Conn --> CB{Circuit breaker}
  CB -->|open| Busy
```

- Health endpoint `GET /database/pool/health` melaporkan saturasi (dokumen kontrak API, saat ditulis).
- Saturasi memicu event `database.pool.saturated` dan `503 DATABASE_BUSY`.
- PgBouncer opsional (transaction mode): hindari prepared statement bermasalah; gunakan `SET LOCAL`.

## Migration runner

Ikuti standar penamaan `NNN_awcms_<area>_<desc>.sql` (mengikuti pola awcms-mini) — skill penegak direncanakan: **`awcms-new-migration`**.

```mermaid
flowchart TD
  A[Baca file sql/ terurut] --> B{Sudah di awcms_schema_migrations?}
  B -- Ya --> C[Skip]
  B -- Tidak --> D[Jalankan dalam transaction]
  D --> E{Sukses?}
  E -- Ya --> F[Catat name + checksum + executed_at]
  E -- Tidak --> G[Rollback + stop + exit non-zero]
  C --> H[Lanjut file berikutnya]
  F --> H
```

- Checksum mendeteksi file yang berubah setelah applied (peringatkan/tolak).
- Tidak double-run; error menghentikan proses.

## Idempotency store

- Tabel `awcms_idempotency_keys` menyimpan `key`, request hash, status, response/resource.
- Alur direncanakan mengikuti skill `awcms-idempotency` (dokumen coding standard, saat ditulis). Retention 7–30 hari (dokumen ERD, saat ditulis).
- Race concurrent-request dengan `Idempotency-Key` yang SAMA (dua request paralel lolos cek awal bareng di bawah READ COMMITTED) ditangani di satu titik: `saveIdempotencyRecord` (`src/modules/_shared/idempotency.ts`) memakai `INSERT ... ON CONFLICT (tenant_id, request_scope, idempotency_key) DO NOTHING RETURNING id`. Kalau kalah race, ia `SELECT` ulang row pemenang (dijamin sudah committed) dan membandingkan `request_hash`-nya — hash sama (payload identik) → melempar `IdempotencyRaceLostError` membawa response pemenang untuk di-replay; hash beda (genuine conflict) → tanpa payload replay. `withTenant` (`src/lib/database/tenant-context.ts`) menangkapnya di satu titik: rollback transaksi loser (mutation-nya tidak pernah persist), skip circuit breaker (bukan infra failure), log `idempotency.race_lost` (key di-hash SHA-256, bukan raw), lalu **replay response pemenang** kalau hash sama — menegakkan aturan "hash sama → replay" bahkan saat kalah race — atau `409 IDEMPOTENCY_CONFLICT` bersih kalau hash beda, bukan raw constraint error. Berlaku otomatis untuk semua endpoint idempotent tanpa perlu ubah routenya masing-masing.
- Prinsip generalisasi yang harus dipertahankan sejak awal (dipelajari dari pengalaman awcms-mini): `withTenant` skip `circuitBreaker.recordFailure()` untuk **semua** `Bun.SQL.PostgresError` SQLSTATE kelas `23` (integrity constraint violation — FK/unique/check violation), bukan cuma kasus idempotency race. `INSERT`/`UPDATE` apa pun yang gagal karena FK/unique constraint (mis. `tenantId` caller-supplied yang tak valid) tidak boleh ikut menghitung sebagai kegagalan infra dan membuka circuit breaker aplikasi-lebar dari beberapa request ber-input invalid saja. Pengecualian yang sama berlaku untuk SQLSTATE kelas `22` (data exception, mis. `22P02` string bukan-UUID yang dibandingkan ke kolom `uuid`) — kelas bug struktural yang sama, harus ditutup sejak desain awal, bukan menyusul setelah insiden produksi.

## Repository dan mapper

1. Query terparametrisasi; **tidak** ada string interpolation input user.
2. Query tenant-scoped memfilter `tenant_id` eksplisit.
3. Mapper mengubah row → DTO aman (masking, buang kolom sensitif seperti gaji/rekening) sebelum ke service/API.
4. Pagination **keyset** (`WHERE (tenant_id, created_at, id) < ...`) untuk data besar, bukan offset besar.
5. Hindari N+1: gunakan join/batch.
6. Untuk tabel soft-deletable, repository list/detail default menambahkan `deleted_at IS NULL`; `includeDeleted`/`onlyDeleted` hanya setelah ABAC.

## Contoh multi-tabel: module registry (pola dari awcms-mini, direncanakan diadaptasi)

Registry modul (`src/modules/module-management/`) akan memakai dua kelas akses data yang kontras, ilustrasi konkret dari aturan RLS di atas:

- **Registry global, RLS-free** — `awcms_modules`/`_dependencies`/`_navigation`/`_jobs`/`_health_checks`. Metadata code-derived, sama untuk semua tenant (sinkron dari `listModules()` lewat `syncModuleDescriptors`, sama alasan `awcms_permissions` RLS-free) — jalan di koneksi app biasa, **tidak** butuh `withTenant`/`SET LOCAL app.current_tenant_id`.
- **State tenant-writable, RLS FORCE** — `awcms_tenant_modules` (enable/disable modul ERP per tenant/entitas) dan `awcms_module_settings` (pengaturan non-secret per tenant). Setiap akses **wajib** lewat `withTenant`, sama seperti tabel tenant-scoped lainnya.
- **"Sync first" sebelum tulis tenant-scoped**: `enableTenantModule`/`disableTenantModule`/`updateModuleSettings`/`runModuleHealthCheck` semua memanggil `syncModuleDescriptors(tx)` di awal — dua tabel di atas punya FK ke `awcms_modules.module_key`, jadi baris registry harus ada dulu sebelum insert baris tenant-scoped. Pola ini generik: kapan pun tabel tenant-scoped punya FK ke tabel registry code-derived (mis. modul finance/inventory/procurement/manufacturing/hr-payroll saat didaftarkan), pastikan registry di-sync dalam transaction yang sama sebelum menulis, jangan mengasumsikan operator sudah menjalankan sync manual lebih dulu.

## Soft delete data access

Soft delete adalah update status data, bukan `DELETE` SQL pada jalur operasional.

```sql
UPDATE awcms_products
SET deleted_at = now(),
    deleted_by = $actor_tenant_user_id,
    delete_reason = $reason,
    updated_at = now(),
    sync_version = sync_version + 1
WHERE tenant_id = $tenant_id
  AND id = $product_id
  AND deleted_at IS NULL;
```

Aturan:

- Jalankan di transaction dengan `SET LOCAL app.current_tenant_id`.
- Validasi ABAC action `delete`, lalu audit `*.soft_deleted`.
- Restore mengosongkan kolom delete, mengisi `restored_at/restored_by`, memvalidasi partial unique index, lalu audit `*.restored`.
- Purge/anonymize memakai workflow terpisah untuk retention/legal (mis. retensi dokumen pajak/keuangan sesuai regulasi) dan tidak boleh memutus FK transaksi, audit, atau tax records.
- Untuk sync, tulis tombstone ke outbox dalam transaction yang sama.

## Tipe data & konvensi

| Domain                | Tipe PostgreSQL                             |
| ------------------------ | ---------------------------------------------- |
| ID                     | `uuid` (default `gen_random_uuid()`)        |
| Waktu                  | `timestamptz`                               |
| Uang/quantity          | `numeric`                                   |
| Payload fleksibel      | `jsonb`                                     |
| Enum-like              | `text` + `CHECK`                            |
| Soft delete timestamp  | `timestamptz` (`deleted_at`, `restored_at`) |

Nama tabel/kolom `snake_case`, prefiks `awcms_` (dokumen ERD/coding standard, saat ditulis).

## Acceptance criteria

- Semua akses tenant-scoped memakai `withTenant`/`SET LOCAL` + filter `tenant_id`; RLS aktif.
- Posting jurnal/PO/payroll atomic, mengunci saldo/stok, dan menulis outbox dalam satu transaction.
- Provider eksternal tidak dipanggil di dalam transaction.
- Pool work-class + backpressure aktif; health endpoint melaporkan saturasi; `503` saat penuh.
- Migration berjalan berurutan, tidak double-run, checksum tercatat, error menghentikan proses.
- Idempotency store mencegah duplikasi mutation high-risk.
- Repository terparametrisasi; mapper mengeluarkan DTO aman; pagination keyset untuk data besar.
- Soft delete default filter aktif; restore/purge memakai ABAC, audit, dan tombstone outbox bila sync aktif.
