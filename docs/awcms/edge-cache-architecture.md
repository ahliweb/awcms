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
Beda = setiap BAN ditolak 403 secara senyap dan situs menyajikan konten basi
sambil terlihat sehat. `bun run security:readiness` melaporkan endpoint-tanpa-token
sebagai temuan **critical** justru karena kegagalan ini tidak berisik.

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
**di transaksi konten yang sama** (pola outbox ADR-0006). Pengiriman BAN
dikerjakan worker dengan lease + retry.

Key dibatasi `[A-Za-z0-9:._-]` saat dibangun **dan** divalidasi ulang di VCL:
key masuk ke regex, jadi `.*` akan mengubah satu invalidasi menjadi
"buang seluruh cache ke origin".

## Yang belum tersambung (jangan klaim ada)

- ~~Emisi purge dari event konten.~~ **SUDAH** untuk `blog_content`: keempat
  jalur tulis (create, update, soft-delete, scheduled publish) memanggil
  `enqueueModuleContentPurge` di transaksi yang sama. Modul konten lain
  (`news_portal`, `theming`, `media_library`) **belum** — suntingan di sana masih
  menunggu TTL.
- **Surface discovery ber-resolusi-host** (`/robots.txt`, `/sitemap.xml`,
  `/feed.xml`, `/atom.xml`, `/feed.json`). Kandidat terbaik, tetapi
  `serveDiscovery(request, …)` tidak menerima `locals` sehingga rute tak bisa
  mempublikasikan tenant-nya. Menyambungkannya: alirkan `locals` melalui
  `serveDiscovery` + enam pemanggilnya, set `edgeCacheTenantId`, tambahkan tiga
  entri registry.
- **Daftar publik komentar** (`GET /api/v1/comments`) — kandidat sah, ditunda.
- **Purge dari UI admin.** Hanya lewat antrean dan worker.
