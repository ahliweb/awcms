---
name: awcms-performance
description: Audit dan tingkatkan performa aplikasi & database AWCMS. Gunakan saat diminta "optimasi performa/query", ada endpoint lambat, N+1, masalah indexing/pagination, tuning connection pool, atau perencanaan materialized view/caching. Menegakkan pola akses data doc 16, pooling/backpressure, dan pagination keyset.
---

> **PERINGATAN — sebagian perintah di halaman ini BELUM ADA, dan §Performance
> suite di bawah MEMBANTAH peringatan ini.**
> `performance:suite`, `performance:query-plan:check`, `database:capacity:check`
> terdaftar di [`scripts/README.md`](../../../scripts/README.md) §Ditunda sebagai
> target acuan, bukan skrip nyata. Menjalankannya akan gagal.
>
> **Dan direktori `src/lib/performance/` tidak ada.** §Performance suite di
> bagian bawah halaman ini menyuruh pembacanya "gunakan suite yang sudah ada di
> `src/lib/performance/`, jangan bangun tooling ad hoc baru" — itu **salah**, dan
> ia bertahan karena `bun run skills:check` membebaskan seluruh skill ini lewat
> satu entri `ASPIRATIONAL_SKILLS` yang alasannya menyebut _perintah_ sementara
> pembebasannya juga mencakup _path_. Perlakukan seluruh §Performance suite
> sebagai **spesifikasi target**, bukan runbook. (Asesmen 4 Agustus 2026 §9.6.)
>
> **Yang NYATA hari ini — pakai ini:**
>
> | Alat                                                 | Cakupan                                                                                                                                  |
> | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
> | `bun run db:fk-index:check`                          | 182 kolom FK, semua terjangkau index, 1 pengecualian ([ADR-0064](../../../docs/adr/0064-foreign-key-columns-must-be-index-reachable.md)) |
> | `bun run db:work-class:check`                        | pemisahan kelas kerja pool                                                                                                               |
> | `tests/integration/query-budget.integration.test.ts` | plafon **3 query** untuk listing/paging/feed publik blog, fixture 40 post                                                                |
> | `bun run db:pool:health`, `bun run redis:health`     | kesehatan pool/cache saat runtime                                                                                                        |
>
> **Batas yang wajib diketahui sebelum menyebut "CI hijau" sebagai jaminan
> performa:** dari **33** gerbang rantai `check`, **satu** memeriksa performa.
> Anggaran query bukan gerbang rantai melainkan **test integrasi DB-gated** —
> pada mesin tanpa PostgreSQL ia di-`skip` dan `bun run check` tetap hijau. Dan
> cakupannya hanya jalur baca publik blog: **31 layar admin dan pembangun sitemap
> belum beranggaran**.
>
> **Tiga celah performa terbuka (asesmen §9):**
>
> 1. **Purge menjangkau Varnish, BUKAN tier yang menyajikan pembaca.** Jalur
>    nyatanya tiga lapis — `Cloudflare (proxied) -> Traefik -> varnish -> app`
>    ([`environments.md`](../../../docs/awcms/environments.md) §Cache tepi) —
>    sementara `EDGE_CACHE_PURGE_ENDPOINT` menunjuk container Varnish saja. Nol
>    pemanggilan API zona Cloudflare di `src/`. Diprobe: `/robots.txt` staging
>    balas `cf-cache-status: HIT`, `age: 182`, di saat aplikasi menandai
>    `x-edge-cache-skip: surface_not_declared`. Kebasiannya **berbatas**
>    `s-maxage` (`EDGE_CACHE_MAX_TTL_SECONDS=300`) jadi ini jeda, bukan
>    kebocoran — tetapi tabel uji penerimaan di `environments.md` mengukur
>    `X-Cache` dari Varnish, tier yang bukan penjawabnya, sehingga jeda itu tak
>    akan muncul di pengujian mana pun.
>
>    > **Dan JANGAN menambah kompresi di aplikasi/VCL.** Putaran kedua asesmen
>    > sempat merekomendasikannya atas dasar "nol kompresi di jalur penyajian" —
>    > benar untuk apa yang repo miliki, **salah** untuk apa yang diterima
>    > pembaca: staging dan produksi mengembalikan `content-encoding: gzip` dari
>    > Cloudflare. Rekomendasi itu **DICABUT**; menambahkannya sekarang
>    > menciptakan dua tempat yang memutuskan hal yang sama. Yang tersisa: sebuah
>    > deployment template ini di luar CDN pengompresi tidak dapat kompresi, dan
>    > tak ada gerbang yang mengatakannya.
>
> 2. **Tidak ada anggaran ukuran aset klien.** 139 KB hari ini — inilah saat
>    termurah menggerbanginya.
> 3. **Core Web Vitals belum diukur.**
>    [ADR-0067](../../../docs/adr/0067-core-web-vitals-collection.md) `Proposed`
>    menawarkan tiga opsi yang **semuanya RUM** (mengumpulkan data pengunjung),
>    dan karena itu menunggu keputusan pemilik produk. Yang belum ditimbang:
>    **pengukuran lab** — Playwright sudah terpasang di repo ini, mengumpulkan
>    nol data pengunjung, dan menjawab pertanyaan yang berbeda ("apakah perubahan
>    ini membuat halaman lebih lambat"). Jangan menunggu keputusan RUM untuk
>    mengerjakannya.

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

## Transport & penyajian

- [ ] **Kompresi respons** — lihat celah 1 di banner. Saat menutupnya: **satu
      tempat saja**. Aplikasi (pola `awcms-astro`) ATAU `beresp.do_gzip` di VCL —
      dua tempat yang memutuskan hal yang sama adalah cara membuat `Content-Encoding`
      ganda dan cache yang menyimpan objek yang salah untuk klien yang salah.
- [ ] **`Vary: Accept-Encoding`** sudah dipancarkan `src/lib/edge-cache/response-headers.ts`
      pada respons yang bisa di-cache. Setelah kompresi menyala, header itu
      menjadi benar; sebelum itu ia hanya melipatgandakan ruang kunci cache.
- [ ] **Validator kondisional** (ETag/`Last-Modified` → 304) sudah ada di rute
      discovery — pertahankan saat menambah surface publik baru.
- [ ] **Cache tepi** default MATI dan no-op saat mati; jangan menyalakannya
      sebagai "optimasi" tanpa membaca `awcms-edge-cache` §Tulang punggung dulu —
      cache bersama di depan aplikasi multi-tenant adalah mesin kebocoran.

## Performance suite representatif (Issue #744) — SPESIFIKASI TARGET, BUKAN RUNBOOK

> **`src/lib/performance/` tidak ada di repo ini** dan ketiga perintah di bawah
> akan gagal. Bagian ini dipertahankan sebagai **bentuk** yang harus diambil
> sebuah suite performa bila dibangun — bukan sebagai instruksi. Lihat banner.

Untuk audit performa yang butuh bukti lebih dari sekadar `EXPLAIN` manual —
fixture multi-tenant sintetik berskala, skenario load/soak/saturasi-dan-
recovery, dan budget regresi query-plan versioned — bentuk yang dituju:

```bash
# Safe subset (detik) — dijalankan di CI job `quality` (.github/workflows/ci.yml),
# BUKAN bagian dari komposit `bun run check` (sama seperti resilience:dr-drill):
bun run performance:suite -- --confirm-non-production=<APP_ENV>
bun run performance:query-plan:check -- --confirm-non-production=<APP_ENV>

# Full lane (skala besar + soak, terjadwal/manual — --full):
bun run performance:suite -- --confirm-non-production=<APP_ENV> --full
```

Menambah budget baru (bila suite itu dibangun)? Registrasikan di
`src/lib/performance/query-plan-budgets.ts` (SQL pasangannya di
`query-plan-runner.ts`) dengan `approval.reason` yang jelas — mengubah
threshold yang sudah ada wajib diff yang direview, bukan flag runtime.
Lihat [`performance-suite.md`](../../../docs/awcms/performance-suite.md)
untuk arsitektur lengkap, safe subset vs full lane, dan format artefak.

**Yang bisa dikerjakan HARI INI tanpa membangun suite itu:** perluas
`countQueries` (`tests/integration/query-budget.ts`) ke layar admin terberat dan
ke pembangun sitemap. Polanya sudah terbukti dua kali (test SoD #181, lalu
#385), dan plafon di atas fixture yang lebih besar dari plafonnya adalah yang
membuktikan sesuatu — plafon di atas satu baris tidak, karena N+1 dan
implementasi konstan sama-sama mengeluarkan sekitar satu query.

## Skill terkait

`awcms-new-migration` (tambah index via migration berurutan), `awcms-integration` (I/O eksternal & outbox), `awcms-testing` (benchmark/load test), `awcms-production-preflight` (`db:pool:health`), `awcms-edge-cache` (surface & purge), `awcms-security-hardening` (postur bersama).

Status performa yang **hidup** — target Core Web Vitals, apa yang sudah benar,
dan tiga belas celah ber-pemeriksa — ada di
[`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md) §8–§9.
Mutakhirkan dokumen itu saat sebuah celah ditutup; halaman ini adalah caranya,
dokumen itu adalah keadaannya.
