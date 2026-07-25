# ADR-0042 — Lapisan cache tepi Varnish dengan aktivasi otomatis berbasis tekanan origin

- **Status:** Accepted
- **Tanggal:** 2026-07-25
- **Pengambil keputusan:** @ahliweb
- **Terkait:** ADR-0003 (RLS multi-tenant), ADR-0006 (outbox — pola enqueue-in-commit dipakai ulang di sini), ADR-0009 (rute publik path-scoped `/blog/{tenantCode}`), ADR-0010 (routing host→tenant), ADR-0035 (positioning online-first), ADR-0038 (validator cache discovery SEO), ADR-0039 (redirect/404)

## Konteks

`awcms` kini online-first (ADR-0035) dan menargetkan SaaS multi-tenant dengan
subdomain tak terbatas. Konsekuensinya: **setiap pembaca anonim yang membuka
halaman publik yang sama memicu kerja database yang sama**. Feed, sitemap, indeks
blog, halaman post, dan token tema adalah fungsi murni dari konten terbit +
konfigurasi tenant — jawabannya identik untuk semua pengunjung, tetapi hari ini
dihitung ulang per permintaan.

Yang sudah ada **bukan** solusi untuk ini:

- **Validator HTTP `seo_distribution` (ADR-0038 §7).** ETag/Last-Modified
  menghemat _bandwidth_ saat klien mengirim permintaan bersyarat. Origin tetap
  menjalankan seluruh query untuk menghitung signature-nya. Beban database tidak
  berkurang.
- **`src/lib/redis/`.** Cache nilai di dalam aplikasi. Berguna, tetapi permintaan
  tetap sampai ke proses aplikasi, tetap melewati middleware, tetap merender.

Yang hilang adalah lapisan yang **menjawab tanpa menyentuh aplikasi sama sekali**.

Kendala yang membentuk keputusan ini: cache bersama di depan aplikasi multi-tenant
adalah **mesin kebocoran lintas-tenant** secara default. VCL bawaan Varnish
men-cache respons `200` tanpa direktif cache selama `default_ttl` (120 detik).
Satu halaman `/admin` yang ter-cache = data tenant lain disajikan ke pengunjung
berikutnya. Tidak ada satu pun mekanisme Varnish yang mencegah itu secara bawaan.

## Keputusan

### 1. Varnish sebagai tier opsional, **default mati, no-op saat mati**

Cache tepi adalah lapisan infrastruktur opsional (`src/lib/edge-cache/`, bukan
modul: tak ada tabel tenant-facing, tak ada permission, tak ada layar admin).
Tanpa `EDGE_CACHE_MODE`, `annotateEdgeCache` keluar setelah satu pemeriksaan
boolean — tanpa alokasi, tanpa query, tanpa penulisan header. Menambah subsistem
ke jalur panas setiap permintaan publik hanya sah bila "mati" benar-benar gratis.

### 2. Kelayakan-cache adalah **allow-list fail-closed**, terpisah dari beban

`decideCacheability` (murni) menolak secara default. Sebuah respons hanya
cacheable bila lolos SELURUH pemeriksaan: surface terdaftar → metode GET/HEAD →
tanpa header `Authorization` → tanpa cookie ber-prefix `awcms_` → status aman →
tanpa `Set-Cookie` → tanpa `Cache-Control: private/no-store/no-cache` → bukan
`Vary: *` → tenant ter-resolve → query param termasuk allow-list.

Rute baru **tidak cacheable sampai seseorang mendeklarasikannya**. Lupa = aman.

Cookie identitas dicocokkan lewat **prefix** `awcms_`, bukan daftar nama, supaya
cookie identitas baru besok tidak diam-diam membuka lubang. Ada test yang membaca
`ssr-session.ts` dan menegakkan bahwa nama cookie sesungguhnya masih cocok
prefix itu.

### 3. Tekanan origin hanya mengubah **berapa lama**, tidak pernah **apa**

Mode `auto` mengukur laju permintaan + latensi origin dalam jendela bergulir. Saat
origin santai, TTL yang diiklankan **0** — pengunjung dapat data hidup, cache
dingin. Saat ambang terlampaui, TTL naik bertahap hingga TTL penuh pada dua kali
ambang, dengan histeresis agar tidak berosilasi.

Ini yang dimaksud "diaktifkan otomatis apabila diperlukan": cache tidak menambah
kebasian saat tidak dibutuhkan, dan menyerap pengulangan tepat ketika database
mulai tertekan.

**Tekanan bukan input `decideCacheability`.** Secara struktural mustahil sebuah
lonjakan beban mengubah respons privat menjadi publik. Pemisahan ini disengaja.

### 4. Pertahanan berlapis untuk perilaku cache-by-default Varnish

Tiga mekanisme independen harus gagal sebelum respons tak-bertanda ter-cache:

1. Aplikasi menandai **setiap** respons — `/admin` dan `/api` termasuk — dengan
   `Surrogate-Control` (cache) atau `Cache-Control: private, no-store` (jangan).
   Tidak ada keadaan ketiga yang senyap.
2. VCL **default-deny**: `vcl_backend_response` hanya men-cache yang membawa
   `Surrogate-Control`.
3. `varnishd -p default_ttl=0`.

### 5. Invalidasi lewat surrogate key + antrean tahan-lama (`sql/068`)

Respons ditandai `Surrogate-Key` (`t:<tenant>`, `t:<tenant>:m:<module>`,
`t:<tenant>:s:<surface>`, `t:<tenant>:r:<type>:<id>`). Invalidasi = `ban()` regex
atas header itu.

Karena key masuk ke **regex**, key dibatasi ke `[A-Za-z0-9:._-]` saat dibangun DAN
divalidasi ulang di VCL: sebuah key `.*` akan mengubah satu invalidasi menjadi
"buang seluruh cache ke origin" — denial-of-service satu permintaan. Pencocokan
juga di-anchor `(^| )key( |$)` agar ban `t:abc` tidak ikut membuang `t:abcdef`
milik tenant lain.

Enqueue terjadi di **transaksi konten yang sama** (pola outbox ADR-0006), bukan
panggilan HTTP di dalam transaksi. Pengiriman dilakukan `bun run edge-cache:purge`
dengan lease + retry, sehingga Varnish yang sedang restart tidak berarti konten
basi selamanya.

### 6. Batas ruang kunci cache

Edge mengunci pada URL penuh termasuk query string, jadi query tak terbatas =
entri cache tak terbatas: siapa pun bisa menggusur objek panas dengan permintaan
murah berulang. Setiap surface mendeklarasikan `allowedQueryParams`; parameter di
luar itu membuat permintaan tidak cacheable.

## Konsekuensi

- **Gate baru** `bun run edge-cache:surfaces:check` (murni, tanpa DB) di rantai
  `bun run check`. Ia memeriksa key unik & aman, pola ter-anchor tanpa wildcard
  rakus, TTL berbatas, dan **memprobe 16 path yang tidak boleh pernah cacheable**
  (termasuk `/admin`, `/api/v1/*`, dan bentuk traversal). Terbukti merah saat
  di-drift.
- **Migrasi `sql/068`** — `awcms_edge_cache_purges`, ENABLE + FORCE RLS, grant
  worker `SELECT, UPDATE, DELETE` (DELETE dipakai nyata untuk prune; bukan grant
  spekulatif) dan entri identik di `WORKER_ROLE_GRANTS`.
- **`security:readiness`** menambah `checkEdgeCacheConfigured`. Satu-satunya
  temuan `critical`-nya adalah endpoint purge tanpa token — kombinasi yang membuat
  setiap invalidasi gagal 403 secara senyap.
- **Middleware** kini menyalurkan semua cabang melalui satu titik keluar. Perilaku
  `/admin`, Turnstile, CSP, redirect SEO, dan penangkapan 404 tidak berubah.
- **Belum tercakup, dan disebut eksplisit** (bukan kelalaian): surface discovery
  ber-resolusi-host (`/robots.txt`, `/sitemap.xml`, `/feed.xml`, `/atom.xml`,
  `/feed.json`) — kandidat cache terbaik di repo, tetapi tenant-nya ditetapkan di
  dalam `withSeoPublicTenant` sementara `serveDiscovery(request, …)` tidak
  menerima `locals`, sehingga rute tak bisa mempublikasikan `edgeCacheTenantId`.
  Mendeklarasikannya tetap akan menghasilkan surface yang cocok, gagal resolve,
  lalu ditolak setiap permintaan — entri registry yang terbaca "ter-cache" padahal
  tidak. Deklarasi mati lebih buruk daripada kelalaian yang jujur.
- **Belum tercakup:** emisi purge dari event konten (publish post/tema) belum
  disambungkan; `enqueueEdgeCachePurge` siap dipanggil, pemanggilnya belum ada.
  Sampai itu ada, invalidasi bergantung pada TTL. TTL surface sengaja pendek
  (120–600 detik) justru karena itu.

## Alternatif yang ditolak

- **Nginx `proxy_cache`.** Tanpa invalidasi bertag; `proxy_cache_purge` ada di
  varian komersial. Invalidasi per-tag adalah syarat, bukan tambahan.
- **Hanya CDN.** Menyerahkan isolasi tenant ke konfigurasi pihak ketiga dan tidak
  membantu deployment LAN/on-prem yang tetap didukung ADR-0035.
- **Memperluas `src/lib/redis/`.** Tidak menghilangkan hop aplikasi; tujuannya
  justru menjawab tanpa membangunkan aplikasi.
- **Deny-list ("cache semua kecuali `/admin`").** Persis mode kegagalan yang
  membuat cache bersama berbahaya: rute privat baru ter-cache secara default.
