---
name: awcms-edge-cache
description: Lapisan cache tepi Varnish SUDAH ADA di repo ini (ADR-0042; `src/lib/edge-cache/`, `infra/varnish/`, migrasi `sql/068`, gate `bun run edge-cache:surfaces:check`, worker `bun run edge-cache:purge`). Ini INFRASTRUKTUR di `src/lib/`, BUKAN modul — tak ada entri `src/modules/`, tak ada permission, tak ada layar admin. Default MATI (`EDGE_CACHE_MODE` unset) dan benar-benar no-op saat mati. Gunakan saat menambah surface publik yang boleh di-cache, menyetel TTL/ambang auto-aktivasi, menyambungkan emisi purge dari event konten, atau men-debug konten basi / cache MISS. PERINGATAN: cache bersama di depan aplikasi multi-tenant adalah mesin kebocoran lintas-tenant secara default — baca §Tulang punggung sebelum menyentuh `cacheability.ts` atau VCL.
---

# AWCMS — Edge cache (Varnish)

Ikuti [`docs/awcms/edge-cache-architecture.md`](../../../docs/awcms/edge-cache-architecture.md)
dan [ADR-0042](../../../docs/adr/0042-varnish-edge-cache-auto-activation.md).

## Hal pertama yang harus dipahami

VCL **bawaan** Varnish men-cache respons `200` tanpa direktif cache selama
`default_ttl` (120 detik). Di depan aplikasi multi-tenant itu berarti: satu
halaman `/admin` ter-cache = data tenant lain disajikan ke pengunjung berikutnya.

"Aplikasi tidak bilang apa-apa" **bukan** berarti "jangan di-cache". Karena itu
setiap respons meninggalkan origin dengan label eksplisit — `Surrogate-Control`
(cache) atau `Cache-Control: private, no-store` (jangan) — dan tidak ada keadaan
ketiga yang senyap.

## Tulang punggung (jangan diregresi)

1. **Allow-list, bukan deny-list.** `decideCacheability` menolak secara default.
   Rute baru tidak cacheable sampai seseorang mendeklarasikan surface-nya. Kalau
   kamu tergoda menulis "cache semua kecuali `/admin`", berhenti — itu persis
   mode kegagalan yang membuat cache bersama berbahaya.
2. **Tekanan hanya mengubah BERAPA LAMA.** `pressure.ts` tidak pernah menjadi
   input `decideCacheability`. Jangan "sederhanakan" dengan menggabungkan
   keduanya: pemisahan itulah yang membuat lonjakan beban tak bisa mengubah
   respons privat jadi publik.
3. **Tiga lapis default-deny.** (a) aplikasi menandai semua respons, (b) VCL hanya
   men-cache yang punya `Surrogate-Control`, (c) `default_ttl=0`. Menghapus salah
   satu karena "redundan" menghilangkan justru redundansi yang disengaja.
4. **Cookie identitas dicocokkan lewat PREFIX `awcms_`,** bukan daftar nama, agar
   cookie identitas baru tidak diam-diam membuka lubang. Ada test yang membaca
   `ssr-session.ts` dan menegakkan nama cookie asli masih cocok prefix itu.
5. **Key surrogate masuk ke REGEX.** Dibatasi `[A-Za-z0-9:._-]` saat dibangun DAN
   divalidasi ulang di VCL. Key `.*` = satu permintaan membuang seluruh cache ke
   origin. Pencocokan di-anchor `(^|[[:space:]])key([[:space:]]|$)` agar ban
   `t:abc` tidak ikut membuang `t:abcdef` milik tenant lain. **JANGAN** kembalikan
   ke spasi literal `(^| )` — lihat jebakan di bawah.
6. **Tenant tak ter-resolve = tidak di-cache.** Objek tanpa key tenant tak bisa
   dijangkau purge mana pun, jadi akan basi selamanya.

## Jebakan yang sudah ditemukan (jangan diulang)

- **Spasi literal di ekspresi ban membuat invalidasi TIDAK PERNAH bekerja.**
  Varnish memecah ekspresi ban pada whitespace menjadi
  `<field> <operator> <argument>`. Bentuk pertama yang dikirim, `(^| )key( |$)`,
  punya spasi di dalam regex → jumlah token salah → ban ditolak
  `Wrong number of arguments`. Yang membuatnya berbahaya: handler BAN tetap
  membalas **200**, jadi `sendEdgeCachePurge` mencatat sukses, baris antrean
  ditandai selesai, dan konten tetap basi sampai TTL habis. Tidak ada test,
  log, atau metrik yang merah. Ditemukan hanya dengan memasang Varnish di depan
  staging dan melihat `X-Cache` tetap `HIT` sesudah purge. Bentuk benar:
  `(^|[[:space:]])key([[:space:]]|$)`. **Mengutip regex tidak menolong** —
  pemecahan token terjadi sebelum penanganan kutip (diverifikasi di Varnish 7.5).
  Dijaga `tests/edge-cache.test.ts` yang membaca `infra/varnish/default.vcl`
  langsung; unit test murni tidak bisa menangkap ini karena ekspresi dibangun
  di VCL, bukan di TypeScript.
- **`varnishcache/varnish` bukan repository Docker Hub.** Compose overlay awal
  menamainya dan gagal `pull access denied` bagi siapa pun yang mencoba
  memakainya. Image yang benar: `varnish:7.5` (Docker Official Image).
- **`/blog/{code}/search` adalah TIGA segmen** sehingga cocok dengan pola
  `blog-post` — padahal dokumentasi menyatakan surface query-driven dikecualikan.
  Ditangkap oleh probe gate, bukan oleh review. Sub-rute reserved baru di bawah
  `/blog/{code}/` wajib ditambahkan ke `RESERVED_SEGMENTS`.
- **`/blog/../admin` juga tiga segmen.** `new URL()` menormalkan dot-segment
  sebelum middleware melihatnya, tetapi itu properti pipeline saat ini, bukan
  invarian fungsi. Guard traversal ada di `matchPublicCacheSurface`.
- **Query string tak terbatas = entri cache tak terbatas.** Edge mengunci pada URL
  penuh. Tanpa `allowedQueryParams`, `?x=1..N` menggusur objek panas dengan
  permintaan murah. Jaga allow-list tetap kecil (gate menolak >4).
- **Latch auto-aktivasi di-set oleh `sample()`, bukan `record()`.** Jalur serving
  memanggilnya tiap permintaan, jadi produksi baik-baik saja; di test, burst tanpa
  `sample()` di tengahnya tidak akan meng-engage latch.
- **Grant worker `sql/068` wajib punya entri identik di `WORKER_ROLE_GRANTS`**
  (`scripts/security-readiness.ts`). Ada test yang membaca teks migrasi dan
  membandingkannya.
- **Jangan tambah grant yang tak dipakai.** DELETE diberikan karena worker
  benar-benar mem-prune baris `done`. Baris `failed` sengaja TIDAK di-prune — itu
  satu-satunya jejak bahwa invalidasi tak pernah mendarat.

## Perintah

```bash
bun run edge-cache:surfaces:check   # gate registry (bagian dari `bun run check`), murni tanpa DB
bun run edge-cache:purge            # kirim BAN dari antrean; no-op saat mode off / tanpa endpoint
bun run security:readiness          # checkEdgeCacheConfigured: endpoint-tanpa-token = CRITICAL
```

## Belum ada (jangan klaim ada)

- **Emisi purge dari event konten.** `enqueueEdgeCachePurge` siap dipanggil,
  **belum ada pemanggilnya**. Invalidasi saat ini bergantung TTL.
- **Surface discovery ber-resolusi-host** (`/robots.txt`, `/sitemap.xml`,
  `/feed.xml`, `/atom.xml`, `/feed.json`) — `serveDiscovery` tak menerima
  `locals`, jadi rute tak bisa mempublikasikan tenant-nya.
- **Purge lewat UI admin atau endpoint HTTP.** Hanya antrean + worker.

## Skill terkait

`awcms-new-migration` (grant worker + RLS FORCE), `awcms-new-endpoint`,
`awcms-seo-distribution` (validator ETag — mekanisme berbeda, lihat tabel di
docs), `awcms-blog-content` dan `awcms-theming` (pemilik surface yang di-cache).
