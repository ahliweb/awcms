---
"awcms": patch
---

fix(cache-tepi): tiga surface untuk rute yang tak ada lagi dicabut — dan gerbangnya berhenti menerima izin-cache yang inert

[ADR-0061](../docs/adr/0061-host-resolved-public-surfaces-are-edge-cacheable.md) §A
menambahkan tiga entri `PUBLIC_CACHE_SURFACES` untuk keluarga host-resolved
`/news/**`. [ADR-0071](../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
kemudian **menghapus keluarga rutenya dari repo ini**, dan ketiga entri itu
bertahan beberapa hari lebih lama dari rute yang mereka layani.

Diverifikasi ke kode, bukan disimpulkan — keduanya sekaligus:
`extractTenantCodeFromPath("/news/hello-world")` → `null` (`TENANT_CODE_PATH`
hanya mengenal `blog|theming`), dan `publishEdgeCacheTenant` **nol pemanggil**
untuk path itu (satu-satunya pemanggilnya `seo-distribution/presentation/discovery-route.ts:145`).
Jadi ketiganya **inert**: `requiresTenant: true` membuat tenant yang tak
ter-resolve gagal-tertutup, dan tak ada rute yang menyajikannya.

**Inert bukan alasan membiarkannya.** Sebuah entri di registry ini adalah
pernyataan berdiri bahwa cache **BERSAMA** boleh menyimpan sebuah path — lengkap
dengan `rationale` yang berargumen mengapa itu aman — untuk rute yang tak bisa
dibaca siapa pun. Pembaca berikutnya membacanya sebagai bukti keluarga itu
hidup, dan `edge-cache:surfaces:check` yang melapor `OK — 11 declared surfaces`
terbaca sebagai cakupan **11** hal, bukan 8.

Yang berubah:

- Ketiga entri (`news-index`/`news-taxonomy`/`news-post`) dicabut → **8
  surface**. Komentar header `surface-registry.ts` yang masih mengklaim "Their
  routes publish `locals.edgeCacheTenantId`" untuk keduanya dibetulkan: hari ini
  hanya rute discovery root yang mempublikasikannya.
- **Gerbang baru `findSurfacesWithoutServingRoutes`**: tiap surface wajib punya
  entri `api.routes` di modul pemiliknya yang bisa menyajikannya. `api.routes`
  adalah otoritas yang tepat karena registry sudah memperlakukannya sebagai
  klaim modul atas ruang URL — `modules:routes:check` yang mengikatnya ke
  filesystem. Cakupan diperiksa **dua arah**: rute boleh lebih luas dari surface
  (`/blog` vs prefiks `/blog/`) atau lebih sempit (`/sitemap.xml` vs prefiks
  `/sitemap` dari `^\/sitemap(-\d+)?\.xml$`).
- `tests/edge-cache.test.ts`: kelima pin `/news/**` pindah dari "resolve ke
  surface X" menjadi "**tidak** cacheable". Sengaja dipertahankan sebagai probe
  alih-alih dihapus — `/news/**` masih kosakata hidup di `awcms-astro`, jadi
  bentuk path itu akan terus muncul di hadapan pembaca, dan mendeklarasikan
  ulang surface untuk rute yang repo ini tak sajikan harus **memerahkan** daftar
  itu, bukan lewat tanpa terlihat.

**Ekstraksi prefiksnya menangani alternasi satu tingkat, dan itu bukan
hiasan.** `seo-feed` adalah `^\/(feed\.xml|atom\.xml|feed\.json)$`, yang prefiks
polosnya `/` — prefiks yang cocok dengan **setiap** rute yang pernah
dideklarasikan, sehingga aturan ini akan vakum persis untuk keluarga yang paling
membutuhkannya. Alternasi diekspansi hanya bila **seluruh** cabangnya literal
DAN grupnya mengakhiri pola; kalau tidak, prefiks berhenti di situ (menjatuhkan
teks setelah grup diam-diam akan melebarkan apa yang dianggap "tercakup"). Test
mengunci keduanya, plus satu asersi bahwa **setiap** cabang harus bisa disajikan
— modul yang hanya mendeklarasikan `/feed.xml` tetap MERAH.

**Mutation-proven:** mengembalikan satu entri `news-index` → gerbang MERAH
menyebut surface, prefiks, dan `api.routes` yang dideklarasikan pemiliknya.
Sebelum perubahan ini, kesebelas entri lolos: 8 lolos, tepat 3 gagal.

Ikut dibetulkan: `tests/news-routes-edge-cache-contract.test.ts` **dihapus
bersama rutenya**, tetapi masih dikutip tiga dokumen current-state
(`edge-cache-architecture.md`, skill `awcms-edge-cache`, dan docblock test
saudaranya). Aturan disclosure yang dijaganya — publikasikan tenant hanya pada
jalur yang MENYAJIKAN, karena 404 boleh di-cache — **tidak ikut dicabut**; ia
berlaku untuk tiap surface host-resolved berikutnya, dan kini dirujuk ke
penjaganya yang masih ada. Kutipan di ADR-0061 sengaja **tidak** disentuh: ADR
adalah catatan keputusan pada satu titik waktu.
