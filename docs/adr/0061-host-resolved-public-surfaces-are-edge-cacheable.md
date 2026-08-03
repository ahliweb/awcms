# ADR-0061 — Permukaan publik host-resolved boleh di-cache di tepi: rute mempublikasikan tenant-nya

- **Status:** Accepted
- **Tanggal:** 2026-08-03
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (cache tepi Varnish, allow-list surface, §8 kunci surrogate), [ADR-0009](0009-public-tenant-scoped-routes.md) (rute publik path-based `/blog/{tenantCode}`), [ADR-0010](0010-public-host-tenant-routing.md) (resolusi tenant dari host), [ADR-0038](0038-seo-distribution-module-admission-discovery-scope.md) (rute discovery di root host), [ADR-0059](0059-host-resolved-public-content-routes.md) (keluarga konten `/news/**`)

## Konteks

### 1. Sumber tenant nomor satu tidak pernah punya penulis

ADR-0042 §8 menetapkan dua sumber tenant untuk menandai objek ter-cache, berurut
prioritas. `src/lib/edge-cache/tenant-key.ts` menuliskannya apa adanya:

> 1. **Published by the route** (`locals.edgeCacheTenantId`). Preferred, and the
>    only source for host-resolved surfaces.
> 2. **Path-scoped `{tenantCode}`** (ADR-0009 `/blog/{code}/…`).

`src/env.d.ts` mendeklarasikan field-nya, `src/middleware.ts` membacanya dan
meneruskannya ke `annotateEdgeCache`, dan `resolveEdgeCacheTenantId`
mendahulukannya di atas segalanya. Seluruh jalur itu ada dan benar.

Yang tidak ada: **satu pun penulisnya.** `grep -rn "edgeCacheTenantId" src/`
mengembalikan lima baris — deklarasi tipe, pembacaan di middleware, dua docblock,
dan satu komentar. Nol assignment. Cabang prioritas-pertama itu tak pernah bisa
dieksekusi sejak ADR-0042 mendarat, sehingga sumber (2) — kode tenant di path —
adalah satu-satunya sumber yang benar-benar hidup.

### 2. Akibatnya: cache tepi hanya mempercepat permukaan warisan

Karena sumber (1) mati, setiap permukaan yang me-resolve tenant dari **request**
alih-alih dari **path** tidak bisa di-cache — bukan karena diputuskan begitu,
melainkan karena tak punya cara menyatakan tenant-nya. Yang terkena:

- **Enam rute discovery root** (`/robots.txt`, `/sitemap.xml`,
  `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json`, ADR-0038) —
  kandidat cache terbaik di repo ini: badan identik untuk setiap pembaca anonim,
  dibangun ulang dari roll-up konten pada **setiap** permintaan.
- **Keluarga konten `/news/**`** (ADR-0059) — indeks, detail post, kategori, tag.

Registry `PUBLIC_CACHE_SURFACES` mendeklarasikan lima surface, dan kelimanya
path-scoped: `/blog/{tenantCode}/**` dan `/theming/{code}/tokens.css`. Jadi
posisi hari ini persis terbalik dari arah yang ADR-0059 tetapkan: **cache tepi
mempercepat bentuk warisan dan tidak menyentuh bentuk maju sama sekali.** Tenant
yang memakai domain sendiri — kasus yang `tenant_domain` ada untuk melayani —
mendapat nol akselerasi.

Header `surface-registry.ts` sudah mencatat penangguhan discovery dengan alasan
yang benar, dan alasan itu tetap benar: mendeklarasikan surface yang cocok lalu
ditolak `tenant_unresolved` pada setiap permintaan menghasilkan entri registry
yang **terbaca sebagai "di-cache" sambil tidak men-cache apa pun**. Deklarasi
mati lebih buruk daripada absen yang jujur. Yang hilang bukan keputusannya,
melainkan penulisnya.

### 3. Kapan mempublikasikan adalah pertanyaan disclosure, bukan pertanyaan gaya

Ini bagian yang tidak terbaca dari kode dan menjadi alasan ADR ini ada.

Keluarga host-resolved sengaja meruntuhkan empat hasil berbeda — host tak
dikenal, modul dimatikan, keluarga rute dimatikan, dan **resource tidak ada** —
menjadi SATU 404 generik, lalu memadankan biayanya
(`padUnresolvedHostRouteLatency`, `padUnresolvedSeoTenantLatency`) supaya
keempatnya tak bisa dibedakan di domain waktu juga. Pertanyaan yang dijaga:
_"apakah hostname ini memetakan ke tenant yang hidup?"_

**404 adalah status yang boleh di-cache** (`CACHEABLE_STATUSES` memuat 404 —
sengaja, karena 404 yang di-cache dan bisa di-purge itu berharga). Maka anotasi
cache adalah **kanal observasi kedua atas pertanyaan yang sama**. Bila rute
mempublikasikan tenant-nya segera setelah gerbang lulus:

| Permintaan                 | Status | Anotasi                            |
| -------------------------- | ------ | ---------------------------------- |
| host tak dikenal           | 404    | `Cache-Control: private, no-store` |
| host dikenal, slug tak ada | 404    | `Surrogate-Control: max-age=300`   |

Seorang prober memperoleh jawaban penuh dari **satu permintaan**, tanpa analisis
timing sama sekali — lewat kanal yang justru dibangun untuk menutupnya. Dan
kesalahannya berupa satu baris yang diletakkan beberapa baris terlalu tinggi:
tetap meng-compile, tetap menyajikan HTML yang benar, lolos setiap test
fungsional.

Aturannya karena itu: **publikasikan hanya pada jalur yang benar-benar menyajikan
resource.** Untuk `/news/{slug}`, `/news/category/{slug}`, `/news/tag/{slug}` itu
berarti SETELAH cabang "tidak ada post/term". Untuk `/news` tidak ada cabang
resource-hilang — hasilnya 200 atau 404 generik, sudah berbeda menurut status —
sehingga "sudah ter-gerbang" dan "sedang menyajikan" adalah instan yang sama.

Asimetrinya disengaja: rute yang **lupa** mempublikasikan kehilangan cache dan
tidak lebih (`requiresTenant` → `tenant_unresolved`); rute yang mempublikasikan
**terlalu awal** membocorkan. Lupa itu biaya performa, terlalu cepat itu
disclosure.

### 4. Prasyarat `/news/**`: kunci cache WAJIB memuat `Host`

`docs/awcms/edge-cache-architecture.md` menahan keluarga ini dengan syarat yang
tepat: `/news/hello-world` adalah path yang **identik untuk setiap tenant**, jadi
mendeklarasikannya sebelum VCL terbukti mem-hash `Host` adalah cara paling
langsung memasang kebocoran lintas-tenant di cache bersama.

Diverifikasi ke berkas, bukan diasumsikan — dan syaratnya ternyata **dua**, bukan
satu:

1. `infra/varnish/default.vcl` `vcl_hash` memanggil `hash_data(req.http.host)`
   secara eksplisit, dengan komentar yang menyebut alasan multi-tenant-nya.
2. Sub itu **tidak** `return (lookup)`. Di Varnish, sub kustom yang `return`
   mengakhiri rantai sehingga `vcl_hash` milik `builtin.vcl` — yang mem-hash
   `req.url` — tak pernah jalan, dan **seluruh path pada satu host runtuh ke satu
   entri cache**. Menambahkan `return (lookup)` terlihat seperti melengkapi
   subroutine, bukan seperti mematikan hashing URL.

Keduanya kini ditegakkan test tingkat-berkas, karena keduanya bisa hilang dalam
diff VCL yang terbaca wajar dan gejalanya bukan error melainkan penyajian konten
tenant lain.

## Keputusan

Permukaan publik host-resolved menjadi boleh di-cache di tepi, lewat rute yang
**mempublikasikan tenant yang sudah mereka resolusi**, dengan aturan waktu §3
sebagai kontrak yang dijaga test — bukan sebagai konvensi.

### §A — Keluarga `/news/**` (PR ini)

1. `src/lib/edge-cache/publish-tenant.ts` — `publishEdgeCacheTenant(locals, tenantId)`,
   satu titik publikasi bernama dan bisa di-grep, dengan alasan waktunya melekat
   di situ. Toleran terhadap `locals`/id yang tak ada (aturan tetap ADR-0042: tak
   ada gangguan di lapisan cache yang boleh mengubah halaman publik jadi 500).
2. Keempat rute `/news/**` memanggilnya — ketiga rute ber-resource **setelah**
   cabang resource-hilang masing-masing.
3. Tiga entri registry: `news-index` (120s, `?page`), `news-taxonomy` (120s,
   `?page`), `news-post` (300s, tanpa query) — cermin TTL dan alasan
   `blog-index`/`blog-taxonomy`/`blog-post`. Pemiliknya `blog_content`, yang
   **sudah** memancarkan purge modul (create/update/soft-delete/scheduled
   publish), jadi `findOwnersWithoutPurges` terpenuhi tanpa kabel baru dan post
   yang di-unpublish menghilang dari `/news/**` lewat purge yang sama yang sudah
   membersihkan `/blog/**`.
4. Probe never-cacheable untuk bentuk bermusuhan keluarga baru. Bentuk yang
   memuaskan `news-post` secara harfiah adalah `/news/..`, **bukan**
   `/news/../admin` — pola host-resolved satu segmen lebih pendek daripada
   pasangan path-scoped-nya, jadi probe `/blog` tidak menurunkannya.

### §B — Rute discovery root (menyusul)

Alirkan `locals` melalui `serveDiscovery` dan enam pemanggilnya, publikasikan
dari konteks yang sudah ter-resolusi di dalamnya, tambahkan entri registry, dan
beri `seo_distribution` call site purge yang `findOwnersWithoutPurges` akan
menuntutnya begitu ia memiliki surface — kandidat call site-nya
`PUT /api/v1/seo/config` dan mutasi redirect, karena keduanyalah yang mengubah
badan `robots.txt`/sitemap. Dikerjakan terpisah supaya §A tidak menunggu
perubahan tanda tangan lintas tujuh berkas.

## Konsekuensi

**Yang didapat.** Tenant ber-domain sendiri akhirnya mendapat akselerasi tepi
untuk halaman kontennya, dengan invalidasi yang sudah terpasang. Cabang
prioritas-pertama ADR-0042 §8 punya penulis, sehingga §B tinggal memakainya
kembali alih-alih merancang ulang.

**Yang dibayar.** Satu aturan yang tak bisa dijamin tipe maupun test fungsional,
dan hanya bisa dijaga sebagai kontrak atas teks sumber
(`tests/news-routes-edge-cache-contract.test.ts`) — termasuk asersi bahwa berkas
rute `/news/**` **kelima** yang mendarat nanti ikut tercakup, karena daftar di
test itu ditulis tangan dan rute baru akan mewarisi nol jaminannya. Test itu
mutation-proven: menaikkan publikasi ke atas tiap gerbang membuatnya merah.

**Yang sengaja TIDAK dilakukan.** Tak ada fallback "tebak dari header `Host`" di
middleware — larangan ADR-0042 §8 tetap berlaku dan justru inilah alasannya:
pemetaan host→tenant bergantung konfigurasi (ADR-0010 punya beberapa mode,
termasuk yang mematikan routing host), dan tebakan yang salah tidak gagal dengan
berisik melainkan menandai konten satu tenant dengan kunci tenant lain.
`/news/search` dan `/news/feed.xml` tetap tak ada (ADR-0059 §D) — root host sudah
melayani keduanya host-resolved — sehingga tidak ada surface untuk mereka.

**Nol migrasi, nol permission, nol perubahan OpenAPI.** Perubahannya seluruhnya
di lapisan presentasi + registry cache; `EDGE_CACHE_MODE` yang tak diset (default
setiap deployment hari ini) tetap membuat seluruhnya no-op.
