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

## Yang belum tersambung (jangan klaim ada)

- ~~Emisi purge dari event konten.~~ **SUDAH** untuk kedua modul yang memiliki
  surface ter-deklarasi: `blog_content` (create, update, soft-delete, scheduled
  publish) dan `theming` (publish, rollback, retire — pemilik
  `theming-tokens`). Keduanya memanggil `enqueueModuleContentPurge` di transaksi
  yang sama.

  `news_portal` dan `media_library` **sengaja tidak** memanggilnya. Keduanya
  tidak memiliki surface ter-deklarasi, jadi tidak ada objek ter-cache yang
  bertanda `m:news_portal` atau `m:media_library` — ban untuk key itu **tidak
  cocok dengan apa pun** sementara antrean melaporkan sukses. Menambahkannya
  sekarang berarti menambah upacara yang terlihat seperti cakupan padahal nol.
  Kewajibannya muncul sendiri begitu modulnya mendeklarasikan surface:
  `bun run edge-cache:surfaces:check` menuntut emisi purge dari **setiap modul
  yang memiliki surface**, dan gagal bila salah satu tidak punya.

- **Surface discovery ber-resolusi-host** (`/robots.txt`, `/sitemap.xml`,
  `/feed.xml`, `/atom.xml`, `/feed.json`). Kandidat terbaik, tetapi
  `serveDiscovery(request, …)` tidak menerima `locals` sehingga rute tak bisa
  mempublikasikan tenant-nya. Menyambungkannya: alirkan `locals` melalui
  `serveDiscovery` + enam pemanggilnya, set `edgeCacheTenantId`, tambahkan tiga
  entri registry.
- **Daftar publik komentar** (`GET /api/v1/comments`) — kandidat sah, ditunda.
- **Purge dari UI admin.** Hanya lewat antrean dan worker.
