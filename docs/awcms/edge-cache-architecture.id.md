🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](edge-cache-architecture.md)

<!-- i18n-source-hash: sha256:2136684a7fd4f1b567fff2e7bea7252a6e6351a8fc6f7ca61e62682b58b1c55d -->

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

### Surface publik tanpa bergantung beban (`EDGE_CACHE_PUBLIC_SURFACES`)

`auto` membiarkan halaman publik tidak ter-cache di bawah ambang aktivasi,
sehingga lonjakan pertama menanggung biaya origin penuh.
`EDGE_CACHE_PUBLIC_SURFACES=always` (issue #1284,
ADR-0161)
menghapus ketergantungan itu untuk surface yang sudah dideklarasikan di
`surface-registry.ts`:

| Setelan              | Efek                                                                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pressure` (default) | Perilaku saat ini: mode yang menentukan TTL.                                                                                                                                                                                                       |
| `always`             | Surface terdeklarasi mengiklankan TTL-nya (dibatasi `EDGE_CACHE_MAX_TTL_SECONDS`) di `Surrogate-Control` **dan** `Cache-Control: public, max-age=0, s-maxage=<ttl>, must-revalidate`, yang dibaca tier CDN (Varnish membuang `Surrogate-Control`). |

Tidak berefek saat `EDGE_CACHE_MODE=off`; nilai tak dikenal berarti `pressure`.
`Cache-Control` milik route tetap tidak pernah ditimpa.

**Tabel keputusan.** "Always" berlaku untuk setiap entri allow-list dan tidak
untuk yang lain; allow-list itu sendiri tidak berubah.

| Surface (key registri)                                                                                                                                                                                                       | Selalu aman?                     | Alasan                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `blog-index`, `blog-post`, `blog-taxonomy`, `blog-page`, `blog-discovery`, `seo-robots`, `seo-sitemap`, `seo-feed`, `theming-tokens`                                                                                         | Ya, dengan pemeriksaan yang sama | Anonim, berkunci tenant, fungsi dari konten terbit; semua pengecualian per-request tetap jalan |
| Apa pun di luar registri, `/admin/**`, `/api/v1/**`, `/search`, URL token pratinjau, `/login`, catch-all                                                                                                                     | Tidak pernah (bukan allow-list)  | Tidak berubah dari ADR-0042                                                                    |
| Permintaan ber-`Authorization` atau cookie `awcms_*`; respons ber-`Set-Cookie`, `private`/`no-store`/`no-cache`, `Vary: *`/`Cookie`/`Accept-Language`; bukan GET/HEAD; parameter query tak terdaftar; tenant tak ter-resolve | Tidak pernah                     | Pemeriksaan per-request di `cacheability.ts` berjalan sebelum TTL pada semua setelan           |

Kunci cache, `Vary`, dan aturan locale-di-path (ADR-0098) tidak disentuh.

**Batas kebasian.** Selama purge belum menjangkau CDN (bagian berikut, C14),
salinan CDN paling lama berumur `s-maxage`. Dengan default
`EDGE_CACHE_MAX_TTL_SECONDS=300` itu adalah **≤300 detik** yang sudah diterima;
`validate-env` memberi peringatan (`edge_cache_cdn_ttl_exceeds_accepted_bound`)
bila `always` digabung dengan batas lebih besar. Menaikkan batas butuh keputusan
purge CDN (#1282) lebih dulu.

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

> **Sejak Issue #1282** tier CDN juga bisa dibersihkan, di balik flag
> `EDGE_CACHE_CDN_PURGE` yang mati secara default (bagian berikutnya).
> Semua isi bagian ini menggambarkan deployment **dengan flag mati**, yaitu
> default.

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

## Purge CDN (`EDGE_CACHE_CDN_PURGE`, mati secara default)

Issue #1282 meninjau ulang C14 dengan keputusan pemilik 12 November 2026:
diimplementasikan, **di balik flag yang mati secara default**. Tidak ada yang di
bawah ini terjadi sebelum pemilik mengisi credential dan menyalakan flag; sampai
saat itu bagian di atas adalah seluruh kebenarannya dan batas ≤300 detik adalah
penerimaannya.

**Alur.** Baris antrean tidak berubah (satu surrogate key). Dengan flag nyala,
worker (`bun run edge-cache:purge`) mengirim BAN Varnish lebih dulu, lalu
membersihkan **key yang sama sebagai tag CDN** (`POST <api base>/zones/<zona>/purge_cache`,
body `{"tags":[...]}`, `Authorization: Bearer <token>`). Baris menjadi `done`
hanya bila keduanya berhasil. Aplikasi juga mengirim
`Cache-Tag: <key, dipisah koma>` di samping `Surrogate-Key`, hanya saat flag
nyala (CDN membuangnya; Varnish meneruskannya, tidak seperti `Surrogate-Key`).

**Keputusan desain** (dari dokumentasi purge publik Cloudflare: purge per URL,
hostname, tag, prefix, dan semuanya tersedia di semua paket; maksimal 100
operasi per request; token bucket per akun untuk purge tag/hostname/prefix:
5 request/menit Free, 5/detik Pro, 10/detik Business, 50/detik Enterprise):

| Keputusan          | Pilihan                                                                                                                                                                                                   | Alasan                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit purge         | **Tag** (surrogate key yang ada), bukan URL                                                                                                                                                               | Antrean menyimpan key; aplikasi tak bisa menyebut URL di balik sebuah modul. Tag ada di semua paket dan mematikan semua objek ber-key itu. |
| Batching           | Tag unik per batch yang diklaim, **100 per request**                                                                                                                                                      | Batas terdokumentasi; ledakan ribuan baris menjadi puluhan request terhadap bucket 5/menit (Free) sampai 50/detik.                         |
| Rate limit         | HTTP 429 menghentikan panggilan CDN sisa run; baris **dilepas** (kembali `pending`, percobaan tidak dihitung). Batas ini per akun, jadi run terjadwal berikutnya melanjutkan                              | Mengulang di dalam run hanya memperdalam batas; batas bukan salah baris, jadi tak boleh menggiringnya ke dead-letter.                      |
| Backoff dan retry  | Sementara (5xx, timeout, jaringan, `success` bukan true): 3 percobaan inline, 250 ms lalu 1 dtk; lalu run berhenti memanggil CDN (`unavailable`) dan baris kembali `pending` dengan percobaan dihitung    | Gangguan tak boleh menguras antrean ke dead-letter dalam satu run; run berikutnya memakai jatah 5 percobaan antrean yang sudah ada.        |
| Dead-letter        | 4xx lain (permintaan salah) memarkir baris di `failed` beserta alasannya; retry habis sama setelah 5 percobaan. `failed` adalah dead-letter yang sudah ada (retensi 180 hari, ADR-0076)                   | Tidak ada yang dibuang; operator melihat penyebabnya.                                                                                      |
| Credential ditolak | HTTP 401/403: baris **dilepas**, run berhenti, exit code 1                                                                                                                                                | Token buruk atau kedaluwarsa adalah konfigurasi, bukan vonis atas baris; memperbaikinya tidak menghilangkan apa pun.                       |
| Credential kurang  | Flag nyala dan salah satu dari tiga setelan kurang atau tak terpakai: worker **menolak jalan** (exit 1) sebelum menyentuh antrean; `security:readiness` melaporkan CRITICAL                               | Gagal-tertutup: tak pernah BAN di Varnish lalu diam-diam meninggalkan CDN, tak pernah membuang baris.                                      |
| Metrik             | Baris ringkasan dan `job_run_item_count{jobName="edge-cache:purge",itemName=cdnPurged\|cdnFailed\|cdnReleased\|cdnMaxLagSeconds}`; lag = waktu selesai dikurangi waktu enqueue baris terlambat di run ini | Tanpa nama metrik baru, tanpa label tenant (aturan privasi #698). Proses job hanya mengekspor bila deployment mendaftarkan port metrik.    |

**Setelan** (hanya environment; tidak pernah di-commit atau dicatat di log):
`EDGE_CACHE_CDN_PURGE` (`on` mengaktifkan; selain itu mati),
`EDGE_CACHE_CDN_ZONE_ID`, `EDGE_CACHE_CDN_API_TOKEN` (job-scoped ke
`edge-cache:purge`), opsional `EDGE_CACHE_CDN_API_BASE` (https, atau http hanya
di loopback). Beri token hanya izin purge cache untuk satu zona itu. Tag tidak
peka huruf besar-kecil di CDN; key dari id huruf kecil tidak terpengaruh.

**Yang tidak dilakukannya.** Tidak mengonfigurasi akun atau zona CDN, tidak
melebarkan allow-list, dan tidak membuat purge seketika: CDN menerima permintaan
lalu menyebarkannya, jadi verifikasi dengan `cf-cache-status`/`age` setelah
publish. Mengaktifkannya juga menghilangkan alasan menjaga
`EDGE_CACHE_MAX_TTL_SECONDS` ≤ 300 demi kebasian (ADR-0161), tetapi keputusan itu
terpisah.

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

- ~~**Keluarga konten host-resolved `/news/**`**~~ — **DICABUT**
  ([ADR-0071](../adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)).
  ADR-0061 §A menambahkan tiga entri (`news-index`/`news-taxonomy`/`news-post`);
  ADR-0071 kemudian menghapus keluarga rutenya dari repo ini, dan ketiga entri
  itu **bertahan beberapa hari lebih lama dari rutenya**.

  Mereka **inert**, bukan berbahaya — tak ada yang menyajikan path itu, dan
  `requiresTenant` membuat tenant yang tak ter-resolve gagal-tertutup. Tetapi
  entri inert lebih buruk daripada tak ada entri: ia pernyataan berdiri bahwa
  cache BERSAMA boleh menyimpan sebuah path, lengkap dengan `rationale` yang
  berargumen bahwa itu aman, untuk rute yang tak bisa dibaca siapa pun — dan
  `edge-cache:surfaces:check` yang melapor OK atas 11 surface terbaca sebagai
  cakupan 11 hal, bukan 8.

  Sejak itu **`edge-cache:surfaces:check` menolak surface yang modul pemiliknya
  tak mendeklarasikan rute penyaji** (`findSurfacesWithoutServingRoutes`, dibaca
  dari `api.routes` di registry — otoritas yang sama yang `modules:routes:check`
  ikat ke filesystem). Kesebelas entri kemarin: 8 lolos, tepat 3 gagal.

  Dua hal yang tetap berlaku untuk surface host-resolved BERIKUTNYA — hari ini
  keenam rute discovery root adalah satu-satunya keluarga semacam itu:

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
    dijaga `tests/discovery-routes-edge-cache-contract.test.ts` (mutation-proven).
    Pasangannya untuk `/news/**` ikut dihapus bersama rutenya (ADR-0071); aturan
    disclosure-nya TIDAK ikut dicabut — ia berlaku untuk tiap surface
    host-resolved berikutnya.

- **Daftar publik komentar** (`GET /api/v1/comments`) — kandidat sah, ditunda.
- **Purge dari UI admin.** Hanya lewat antrean dan worker.
