---
name: awcms-performance
description: Audit dan tingkatkan performa aplikasi & database AWCMS. Gunakan saat diminta "optimasi performa/query", ada endpoint lambat, N+1, masalah indexing/pagination, tuning connection pool, atau perencanaan materialized view/caching. Menegakkan pola akses data doc 16, pooling/backpressure, dan pagination keyset.
---

# AWCMS — Performance & Database Tuning

Sumber kebenaran: **`docs/awcms/16_backend_data_access_integration.md`** (lapisan akses data, pooling/backpressure, transaction), **`docs/awcms/database-pooling.md`**, dan **`docs/awcms/07_sprint_testing_production_readiness.md`** (target performa). Skill ini **peningkatan**: ukur → temukan bottleneck → perbaiki → ukur ulang.

## Aturan emas

**Ukur sebelum optimasi.** Jangan menebak — jalankan `EXPLAIN (ANALYZE, BUFFERS)` pada query yang dicurigai, dan benchmark endpoint (p50/p95/p99) sebelum & sesudah. Optimasi tanpa data = spekulasi.

## Database

- [ ] **Index RLS-aware** — query tenant-scoped selalu difilter `tenant_id`; index komposit **harus** berprefiks `(tenant_id, …)` agar cocok dengan predikat RLS + filter. Cek index hilang via `EXPLAIN` (Seq Scan pada tabel besar = merah).
- [ ] **Hindari N+1** — jangan query dalam loop; batch pakai `= ANY(tx.array(ids, "uuid"))` (lihat memory Bun SQL array binding) atau `JOIN`. Cari pola `for (…) await tx\`SELECT …\``.
- [ ] **Pagination keyset, bukan OFFSET** — `WHERE (created_at, id) < (:cursor)` + `LIMIT`, bukan `OFFSET n` besar (doc 14 §Pagination). OFFSET besar memindai lalu membuang baris. Helper bersama sudah ada (Issue #435): `encodeKeysetCursor`/`decodeKeysetCursor` (`src/modules/_shared/keyset-pagination.ts`, cursor opaque base64 `createdAt|id`, cursor rusak → `400 VALIDATION_ERROR` bukan diam-diam dianggap "tanpa cursor") — **reuse**, jangan implementasi ulang per endpoint.
- [ ] **Join setelah LIMIT bisa membuat planner salah pilih plan** — kalau query sudah punya index yang tepat tapi `EXPLAIN` tetap menunjukkan Seq Scan, cek apakah `LIMIT` diterapkan **setelah** `JOIN` (planner mengestimasi baris hasil join, bisa meleset jauh dan menganggap Index Scan lebih mahal dari kenyataan). Perbaikan: pindahkan `LIMIT`+`ORDER BY` ke **subquery sebelum join** (pola `fetchObjectQueueEntries`, `src/modules/sync-storage/application/sync-directory.ts`, Issue #435) — planner tidak lagi punya pilihan selain memenuhi `LIMIT` langsung dari index.
- [ ] **Kolom eksplisit** — hindari `SELECT *`; ambil hanya kolom yang dipakai (kurangi I/O + payload).
- [ ] **`count(*)::int`** untuk agregat kecil; ingat bigint Postgres kembali sebagai string dari Bun.SQL → `Number(...)` eksplisit, jangan `as number`.
- [ ] **jsonb** — index GIN hanya bila di-query berdasarkan isi; jangan simpan payload besar yang tak pernah difilter.
- [ ] **Materialized view / read model** — untuk laporan agregasi berat yang tak butuh real-time; refresh terjadwal. Report base saat ini agregasi baca langsung (doc: reporting) — pertimbangkan MV bila data tumbuh.
- [ ] **Statement timeout** — `DATABASE_STATEMENT_TIMEOUT_MS` mencegah query liar mengunci koneksi.

## Aplikasi & koneksi

- [ ] **Work-class pool + backpressure** — endpoint diklasifikasi (`critical_transaction`/`interactive`/`reporting`/`background_sync`/`maintenance`, doc 16). Laporan berat & sync **tidak** boleh di kelas `interactive`; saturasi → `503 DATABASE_BUSY`, bukan menjenuhkan seluruh pool.
- [ ] **Transaksi seringkas mungkin** — kerja CPU-bound (argon2 hashing) & panggilan provider eksternal **di luar** transaksi DB (ADR-0006); jangan menahan koneksi/lock saat menunggu I/O eksternal.
- [ ] **PgBouncer** — bila `DATABASE_PGBOUNCER=true`, prepared statement dinonaktifkan (mode transaction). Pastikan `DATABASE_POOL_MAX` selaras dengan limit pool server.
- [ ] **SSR reuse** — halaman admin fetch via fungsi application-layer di dalam satu `withTenant`, bukan round-trip HTTP ke API sendiri (pola `*-directory.ts`/`*-report.ts`).
- [ ] **Locking** — `FOR UPDATE` hanya pada baris yang benar-benar dimutasi bersama (mis. stok); hindari lock rentang lebar.

## Verifikasi

- `EXPLAIN ANALYZE` sebelum/sesudah menunjukkan perbaikan nyata (Seq→Index Scan, plan cost turun).
- Benchmark p95 endpoint membaik; tak ada regresi fungsional (`bun run check` hijau).
- Uji beban ringan: query saturasi kelas pool → `503`, mengering ke 0 (bukti backpressure, seperti verifikasi Issue 10.2).
- Tak ada N+1 baru; tak ada `OFFSET` besar; index cocok dengan predikat.

## Performance suite representatif (Issue #744)

Untuk audit performa yang butuh bukti lebih dari sekadar `EXPLAIN` manual —
fixture multi-tenant sintetik berskala, skenario load/soak/saturasi-dan-
recovery, dan budget regresi query-plan versioned — gunakan suite yang
sudah ada di `src/lib/performance/`, jangan bangun tooling ad hoc baru:

```bash
# Safe subset (detik) — dijalankan di CI job `quality` (.github/workflows/ci.yml),
# BUKAN bagian dari komposit `bun run check` (sama seperti resilience:dr-drill):
bun run performance:suite -- --confirm-non-production=<APP_ENV>
bun run performance:query-plan:check -- --confirm-non-production=<APP_ENV>

# Full lane (skala besar + soak, terjadwal/manual — --full):
bun run performance:suite -- --confirm-non-production=<APP_ENV> --full
```

Menambah budget baru? Registrasikan di
`src/lib/performance/query-plan-budgets.ts` (SQL pasangannya di
`query-plan-runner.ts`) dengan `approval.reason` yang jelas — mengubah
threshold yang sudah ada wajib diff yang direview, bukan flag runtime.
Lihat [`performance-suite.md`](../../../docs/awcms/performance-suite.md)
untuk arsitektur lengkap, safe subset vs full lane, dan format artefak.

## Skill terkait

`awcms-new-migration` (tambah index via migration berurutan), `awcms-integration` (I/O eksternal & outbox), `awcms-testing` (benchmark/load test), `awcms-production-preflight` (`db:pool:health`).
