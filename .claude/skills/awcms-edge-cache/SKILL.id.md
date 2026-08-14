---
name: awcms-edge-cache
description: Lapisan cache tepi Varnish SUDAH ADA di repo ini (ADR-0042; `src/lib/edge-cache/`, `infra/varnish/`, migrasi `sql/068`, gate `bun run edge-cache:surfaces:check`, worker `bun run edge-cache:purge`). Ini INFRASTRUKTUR di `src/lib/`, BUKAN modul — tak ada entri `src/modules/`, tak ada permission, tak ada layar admin. Default MATI (`EDGE_CACHE_MODE` unset) dan benar-benar no-op saat mati. Gunakan saat menambah surface publik yang boleh di-cache, menyetel TTL/ambang auto-aktivasi, menyambungkan emisi purge dari event konten, atau men-debug konten basi / cache MISS. PERINGATAN: cache bersama di depan aplikasi multi-tenant adalah mesin kebocoran lintas-tenant secara default — baca §Tulang punggung sebelum menyentuh `cacheability.ts` atau VCL.
---

🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](SKILL.md)

<!-- i18n-source-hash: sha256:201153701bd8554e19dfc941b96f14dc235a5e536acfe1eab00138c55f801123 -->

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

- **Purge untuk modul TANPA surface ter-deklarasi tidak cocok dengan apa pun.**
  Objek ter-cache hanya bertanda key modul PEMILIK surface — hari ini
  `blog_content`, `theming`, dan `seo_distribution` (ADR-0061 §B; `news_portal`
  DILEBUR ke `blog_content` — ADR-0044/#300). Meng-enqueue `m:media_library`
  menghasilkan ban yang tidak cocok dengan objek mana pun sementara antrean
  melaporkan `sent=1`. Jangan tambahkan "untuk jaga-jaga".
  Gate `edge-cache:surfaces:check` menuntut emisi purge dari setiap modul yang
  MEMILIKI surface, jadi kewajibannya muncul otomatis pada hari surface-nya
  dideklarasikan — dan tidak sedetik lebih awal.

- **Surface bisa punya DUA penulis, dan `moduleKey` hanya menampung satu**
  (ADR-0061 §B). Badan `/sitemap.xml` dan `/feed.xml` dimiliki
  `seo_distribution` tetapi DIISI setiap penyedia `seo_facts`, jadi menerbitkan
  post mengubahnya tanpa menyentuh satu baris pun milik pemiliknya.
  `enqueueModuleContentPurge` karena itu juga mem-purge modul yang
  mendeklarasikan `consumes` terhadap modul yang berubah DAN memiliki surface —
  dibaca dari REGISTRY (`resolveDerivedSurfaceModuleKeys`), jadi `blog_content`
  tak pernah menyebut `seo_distribution`. Saat menambah surface agregat baru,
  tanyakan "siapa lagi yang menulis badan ini?" sebelum memilih `moduleKey`.

- **Waktu mempublikasikan tenant adalah pertanyaan DISCLOSURE** (ADR-0061 §3).
  404 boleh di-cache, jadi rute host-resolved yang mempublikasikan
  `locals.edgeCacheTenantId` SEBELUM cabang "resource tidak ada" membuat 404
  resource-hilang ber-`Surrogate-Control` sementara 404 host-tak-dikenal
  ber-`private, no-store` — menjawab "apakah hostname ini tenant hidup?" dari
  SATU permintaan. Publikasikan HANYA pada jalur yang menyajikan; dijaga
  `tests/discovery-routes-edge-cache-contract.test.ts`. (Pasangan `/news/**`-nya
  dihapus bersama rutenya oleh ADR-0071 — aturannya tidak.)

- **Bun TIDAK mengirim method HTTP non-standar.** `fetch`/`node:http` dengan
  `method: "BAN"` tiba di Varnish sebagai **`GET`** (diverifikasi Bun 1.3.14 lewat
  `varnishlog -i ReqMethod`; byte yang sama lewat raw socket tercatat `BAN` dan
  dijawab `200 Banned`). Akibatnya setiap purge lolos dari cabang ban di VCL,
  jatuh ke origin, dan 404. Repo ini Bun-only (ADR-0002) — tidak ada konfigurasi
  yang membuat method `BAN` bekerja. Protokol kabel sekarang
  **`POST /__edge-cache-purge`**; VCL tetap menerima `BAN` asli untuk
  `curl -X BAN` manual. Method tidak pernah jadi kontrol keamanan — ACL, token,
  dan validasi charset key yang menjaganya, dan ketiganya berlaku di kedua pintu.
- **Mock `fetchImpl` TIDAK bisa menangkap kelas bug ini.** Ia memeriksa argumen,
  bukan kabel, jadi ia akan menyatakan `method === "BAN"` dan lulus selamanya.
  `tests/edge-cache-purge-client.test.ts` menegakkan `request.method` seperti
  **DITERIMA** oleh `Bun.serve` sungguhan. Tulis test transport dengan server
  nyata.
- **GUC RLS salah nama = jalur tulis MATI, bukan sekadar cache basi.** `sql/068`
  memakai `awcms.tenant_id` padahal `withTenant()` menyetel
  `app.current_tenant_id` (108 policy lain memakai yang benar). `WITH CHECK`
  jadi NULL → INSERT ditolak → dan karena `enqueueModuleContentPurge` di-`await`
  DI DALAM transaksi konten tanpa guard, publish blog ikut gagal 500. Diperbaiki
  `sql/070`; dijaga `tests/migration-tenant-guc-consistency.test.ts` (gate teks,
  tanpa DB, jalan di job `quality`).

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

## Tier di ATAS Varnish (Cloudflare)

Topologi ter-deploy menaruh Cloudflare (proxied) di depan:
`Cloudflare -> Traefik -> Varnish -> app`. `EDGE_CACHE_PURGE_ENDPOINT` hanya
menjangkau **Varnish** — purge/ban tidak menyentuh cache Cloudflare, padahal
yang menjawab pembaca adalah Cloudflare (`cf-cache-status: HIT` bahkan saat
aplikasi menandai skip). Ini celah C14 di
[`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md) §9.
Konsekuensinya: saat men-debug konten basi, ukur `cf-cache-status`/`age` dari
sisi Cloudflare, bukan hanya `X-Cache` Varnish; dan kebasian di tier itu hanya
berbatas `s-maxage`, bukan purge. Materi debug lengkap: skill `awcms-deploy`
butir "cf-cache-status".

## Perintah

```bash
bun run edge-cache:surfaces:check   # gate registry (bagian dari `bun run check`), murni tanpa DB
bun run edge-cache:purge            # kirim BAN dari antrean; no-op saat mode off / tanpa endpoint
bun run security:readiness          # checkEdgeCacheConfigured: endpoint-tanpa-token = CRITICAL
```

## Belum ada (jangan klaim ada)

- ~~Emisi purge dari event konten.~~ **SUDAH** — `blog_content`
  (create/update/soft-delete/scheduled publish), `theming`
  (publish/rollback/retire), `seo_distribution` (`PUT /api/v1/seo/config`).
- ~~Surface discovery ber-resolusi-host~~ **SUDAH** (ADR-0061 §B):
  `seo-robots` (600s), `seo-sitemap` (300s, indeks + anak `-{n}`), `seo-feed`
  (300s, RSS/Atom/JSON, `?locale=`). Keluarga `/news/**` juga (ADR-0061 §A:
  `news-index`/`news-taxonomy`/`news-post`). **11 surface** ter-deklarasi.
- **Daftar publik komentar** (`GET /api/v1/comments`) — kandidat sah, ditunda.
- **Purge lewat UI admin atau endpoint HTTP.** Hanya antrean + worker.

## Skill terkait

`awcms-new-migration` (grant worker + RLS FORCE), `awcms-new-endpoint`,
`awcms-seo-distribution` (validator ETag — mekanisme berbeda, lihat tabel di
docs), `awcms-blog-content`, `awcms-theming` dan `awcms-seo-distribution` (ketiga pemilik surface yang di-cache).
