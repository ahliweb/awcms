# Arsitektur cache tepi (Varnish)

> Keputusan: [ADR-0042](../adr/0042-varnish-edge-cache-auto-activation.md).
> Kode: [`src/lib/edge-cache/`](../../src/lib/edge-cache/),
> [`infra/varnish/`](../../infra/varnish/), migrasi `sql/068`.

## Untuk apa ini ada

Setiap pembaca anonim yang membuka halaman publik yang sama memicu kerja database
yang sama. Feed, sitemap, indeks blog, halaman post, token tema — semuanya fungsi
murni dari konten terbit + konfigurasi tenant, identik untuk semua pengunjung,
tetapi dihitung ulang per permintaan.

Varnish menjawab permintaan berulang itu **tanpa membangunkan aplikasi sama
sekali**. Itu bedanya dengan dua mekanisme yang sudah ada dan **tidak**
menyelesaikan masalah ini:

| Mekanisme                     | Menghemat                      | Beban DB               |
| ----------------------------- | ------------------------------ | ---------------------- |
| ETag/Last-Modified (ADR-0038) | bandwidth (304)                | **tetap penuh**        |
| `src/lib/redis/`              | query berulang di dalam proses | berkurang, hop app ada |
| Varnish (ADR-0042)            | seluruh permintaan             | **nol saat HIT**       |

## Mengaktifkan: dua sisi, urutannya penting

Menyalakan salah satu sisi saja tidak berbahaya, tetapi juga tidak berguna.

1. **Sisi aplikasi dulu** — set `EDGE_CACHE_MODE=auto`,
   `EDGE_CACHE_PURGE_ENDPOINT`, `EDGE_CACHE_PURGE_TOKEN` (lihat `.env.example`).
   Ini aman karena belum ada yang men-cache; verifikasi header
   `Surrogate-Control` muncul pada respons publik.
2. **Jadwalkan `bun run edge-cache:purge`** (tiap 10–30 detik). Tanpa ini, suntingan
   editor baru terlihat setelah TTL habis.
3. **Baru pasang Varnish di depan** —
   `docker compose -f docker-compose.yml -f infra/varnish/docker-compose.varnish.yml up -d`.

`EDGE_CACHE_PURGE_TOKEN` container **wajib sama persis** dengan milik aplikasi.
Beda = setiap purge ditolak 403 secara senyap dan situs menyajikan konten basi
sambil terlihat sehat. `bun run security:readiness` melaporkan endpoint-tanpa-token
sebagai temuan **critical** justru karena kegagalan ini tidak berisik.

> **Verifikasi dengan `X-Cache`, jangan percaya exit code.** Seluruh jalur ini
> punya kebiasaan gagal sambil melaporkan sukses. Tiga bug nyata terbukti begitu
> saat lapisan ini pertama kali benar-benar dijalankan di staging
> (2026-07-25/26) — lihat §Pelajaran. Uji penerimaan yang benar: hangatkan objek
> sampai `X-Cache: HIT`, kirim purge, pastikan permintaan berikutnya `MISS`,
> lalu `HIT` lagi. Ekspresi ban yang ditolak, method yang tidak terkirim, dan
> policy RLS yang salah GUC semuanya lolos dari cek yang lebih longgar.

## Mode

| Mode   | Perilaku                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------- |
| `off`  | Default. Subsistem inert — tanpa header, tanpa query, tanpa perubahan perilaku.                                     |
| `auto` | TTL 0 saat origin santai; naik bertahap saat laju permintaan / latensi melewati ambang, penuh pada dua kali ambang. |
| `on`   | Selalu iklankan TTL surface yang dideklarasikan. Tekanan tidak dikonsultasi sama sekali.                            |

Mode **tidak pernah** mengubah _apa_ yang boleh di-cache — hanya _berapa lama_.

## Menambah surface cacheable

Satu entri di `PUBLIC_CACHE_SURFACES`
([`surface-registry.ts`](../../src/lib/edge-cache/surface-registry.ts)):

```ts
{
  key: "blog-post",
  moduleKey: "blog_content",
  pattern: /^\/blog\/[^/]+\/[^/]+$/,   // ter-anchor, [^/]+ bukan .*
  ttlSeconds: 300,
  requiresTenant: true,
  allowedQueryParams: [],
  rationale: "…kenapa aman di-cache bersama…"
}
```

`bun run edge-cache:surfaces:check` menolak pola tak-ter-anchor, wildcard rakus,
key duplikat, rationale kosong, allow-list query yang membengkak, dan — yang
paling penting — **memprobe 16 path yang tidak boleh pernah cacheable**. Gate ini
sudah menangkap satu bug nyata: `/blog/{code}/search` adalah tiga segmen sehingga
cocok dengan pola `blog-post`, padahal dokumentasi menyatakan search dikecualikan.

Rute yang tenant-nya di-resolve sendiri (bukan dari path `{tenantCode}`) harus
mempublikasikan `Astro.locals.edgeCacheTenantId`, atau responsnya tidak akan
di-cache — tidak pernah salah-tag.

## Invalidasi

```
t:<tenantId>                          seluruh tenant
t:<tenantId>:m:<moduleKey>            satu modul
t:<tenantId>:s:<surface>              satu surface
t:<tenantId>:r:<type>:<id>            satu resource
```

Modul konten memanggil `enqueueEdgeCachePurge(tx, tenantId, scopes, reason)`
**di transaksi konten yang sama** (pola outbox ADR-0006). Pengirimannya dikerjakan
worker dengan lease + retry.

Protokol kabel: **`POST /__edge-cache-purge`** dengan header
`X-Edge-Purge-Token` + `X-Edge-Purge-Key`. VCL juga tetap menerima method `BAN`
asli, jadi `curl -X BAN` tetap jalan untuk operator; aplikasi **tidak bisa**
memakainya karena Bun tidak mengirim method HTTP non-standar (lihat §Pelajaran).

Key dibatasi `[A-Za-z0-9:._-]` saat dibangun **dan** divalidasi ulang di VCL:
key masuk ke regex, jadi `.*` akan mengubah satu invalidasi menjadi
"buang seluruh cache ke origin".

## Pelajaran — tiga bug yang hanya muncul saat dijalankan

Lapisan ini lolos review, lolos `bun run check`, dan tetap salah di tiga tempat.
Semuanya baru terlihat ketika Varnish benar-benar dipasang di depan staging, dan
ketiganya **melaporkan sukses** sambil tidak bekerja. Pola yang sama akan
terulang pada lapisan berikutnya bila tidak diingat.

1. **Spasi literal di ekspresi ban.** `(^| )key( |$)` — Varnish memecah ekspresi
   ban pada whitespace, jadi jumlah token salah dan setiap ban ditolak
   `Wrong number of arguments`. Handler tetap membalas 200. Perbaikan:
   `(^|[[:space:]])key([[:space:]]|$)`.
2. **Method `BAN` tidak pernah terkirim.** Bun mengirimkan method non-standar
   sebagai `GET` (`fetch` maupun `node:http`, diverifikasi 1.3.14 lewat
   `varnishlog -i ReqMethod`). Setiap purge jatuh ke origin dan 404.
3. **Policy RLS antrean purge memakai GUC yang tak pernah di-set.** `sql/068`
   menulis `awcms.tenant_id`; `withTenant()` menyetel `app.current_tenant_id`.
   Ini **bukan** bug cache — `WITH CHECK` jadi NULL, INSERT ditolak, dan karena
   enqueue di-`await` di dalam transaksi konten tanpa guard, **publish blog ikut
   gagal 500** begitu cache dinyalakan. Diperbaiki `sql/070`.

Benang merahnya: `sendEdgeCachePurge` sama sekali **tidak punya test**, dan mock
`fetchImpl` memang tidak bisa menangkap kelas bug (2) — ia memeriksa argumen,
bukan kabel. Sekarang dijaga `tests/edge-cache-purge-client.test.ts`
(`Bun.serve` nyata, menegakkan `request.method` seperti DITERIMA),
`tests/migration-tenant-guc-consistency.test.ts`, dan dua assertion tingkat-berkas
atas `default.vcl`.

## Batas jangkauan purge

Antrean purge menjangkau **Varnish, dan hanya Varnish** —
`EDGE_CACHE_PURGE_ENDPOINT` menunjuk listener Varnish, dan BAN yang dikirim
worker berhenti di sana. Pada topologi ter-deploy nyata, tier yang menyajikan
pembaca justru **Cloudflare**: kedua host proxied
(`Cloudflare (proxied) → Traefik :443 → varnish:80 → app`, lihat
[`environments.md`](environments.md)), dibuktikan probe staging 4 Agustus 2026
(`cf-cache-status: HIT` plus header `age:`). Konsekuensinya, purge yang
melaporkan `done` dan `MISS` di Varnish **tidak** berarti pembaca melihat konten
segar. Kebasian yang pembaca lihat berbatas `s-maxage` yang diiklankan, di-clamp
`EDGE_CACHE_MAX_TTL_SECONDS` (**≤300 detik** pada konfigurasi staging) — jadi
batasnya waktu, bukan invalidasi. Uji penerimaan yang hanya membaca `X-Cache`
Varnish mengukur tier yang bukan penjawab; baca `cf-cache-status`/`age` juga.
Celah ini tercatat sebagai **C14** di
[`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md) §9.

## Yang belum tersambung (jangan klaim ada)

- ~~Emisi purge dari event konten.~~ **SUDAH** untuk kedua modul yang memiliki
  surface ter-deklarasi: `blog_content` (create, update, soft-delete, scheduled
  publish) dan `theming` (publish, rollback, retire — pemilik
  `theming-tokens`). Keduanya memanggil `enqueueModuleContentPurge` di transaksi
  yang sama.

  `media_library` **sengaja tidak** memanggilnya (dan `news_portal`, sebelum
  [ADR-0044](../adr/0044-merge-news-portal-into-blog-content.md) meleburnya ke
  `blog_content`, juga tidak). Ia tidak memiliki surface ter-deklarasi, jadi
  tidak ada objek ter-cache yang bertanda `m:media_library` — ban untuk key itu **tidak
  cocok dengan apa pun** sementara antrean melaporkan sukses. Menambahkannya
  sekarang berarti menambah upacara yang terlihat seperti cakupan padahal nol.
  Kewajibannya muncul sendiri begitu modulnya mendeklarasikan surface:
  `bun run edge-cache:surfaces:check` menuntut emisi purge dari **setiap modul
  yang memiliki surface**, dan gagal bila salah satu tidak punya.

- ~~**Surface discovery ber-resolusi-host**~~ **SUDAH** (ADR-0061 §B). Tiga entri
  — `seo-robots` (600s), `seo-sitemap` (300s, indeks + anak `-{n}`), `seo-feed`
  (300s, RSS/Atom/JSON, `?locale=` satu-satunya query). `serveDiscovery` menerima
  `locals` opsional dan mempublikasikan tenant SETELAH `build(ctx)` memberi
  payload; keenam rutenya meneruskan `locals`.

  **Yang ditemukan saat menyambungkannya, dan ini berlaku untuk setiap surface
  agregat berikutnya: badan discovery punya DUA penulis.** Konfigurasinya milik
  `seo_distribution` (`PUT /api/v1/seo/config` kini mem-purge), tetapi ISI-nya
  diagregasi dari setiap penyedia `seo_facts` — jadi menerbitkan sebuah post
  mengubah `/sitemap.xml` tanpa menyentuh satu baris pun milik
  `seo_distribution`. Karena purge modul menandai `t:<tenant>:m:<moduleKey>`,
  purge `blog_content` tak menjangkaunya, dan hasilnya akan berupa asimetri yang
  tak dilaporkan apa pun: `/blog/{code}/feed.xml` ter-purge saat publish,
  `/feed.xml` basi sampai TTL. `enqueueModuleContentPurge` kini juga mem-purge
  modul yang mendeklarasikan `consumes` terhadap modul yang berubah DAN memiliki
  surface — dibaca dari registry (jadi `blog_content` tak pernah menyebut
  `seo_distribution`), dan dibatasi ke pemilik surface (ban untuk key yang tak
  menandai apa pun = upacara yang terlihat seperti cakupan).

- ~~**Keluarga konten host-resolved `/news/**`**~~ **SUDAH** (ADR-0061 §A).
  Tiga entri — `news-index`/`news-taxonomy`/`news-post` — mencerminkan TTL dan
  alasan pasangan `blog-*`-nya, dimiliki `blog_content` yang purge modulnya sudah
  terpasang.

  Dua hal yang perlu dibawa saat menyentuhnya lagi:

  - **Prasyarat host-hash itu DUA properti, bukan satu.** `vcl_hash` memang
    memanggil `hash_data(req.http.host)` — tetapi sub itu juga harus TIDAK
    `return (lookup)`, karena sub kustom yang `return` mengakhiri rantai sehingga
    `vcl_hash` milik `builtin.vcl` (yang mem-hash `req.url`) tak pernah jalan dan
    seluruh path pada satu host runtuh ke satu entri. Keduanya kini ditegakkan
    `tests/edge-cache.test.ts`.
  - **Waktu publikasi tenant adalah pertanyaan disclosure.** 404 boleh di-cache,
    jadi mempublikasikan tenant sebelum cabang "post/term tidak ada" membuat 404
    resource-hilang ber-`Surrogate-Control` sementara 404 host-tak-dikenal
    ber-`private, no-store` — menjawab "apakah hostname ini tenant hidup?" dari
    SATU permintaan, lewat kanal yang `padUnresolvedHostRouteLatency` dibangun
    untuk menutup. Aturannya: publikasikan hanya pada jalur yang menyajikan,
    dijaga `tests/news-routes-edge-cache-contract.test.ts` (mutation-proven).

- **Daftar publik komentar** (`GET /api/v1/comments`) — kandidat sah, ditunda.
- **Purge dari UI admin.** Hanya lewat antrean dan worker.
