---
"awcms": minor
---

feat(rute): keluarga `/news/**` dipensiunkan dengan 301 ke `/blog/{tenantCode}/**` (ADR-0071 §4); keputusan RUM ADR-0067 diambil

**Ini perubahan URL publik.** Empat rute `/news/**` yang ADR-0059 daratkan tidak lagi dilayani repo ini, dan setiap permintaan ke sana kini **301 permanen** ke `/blog/{tenantCode}/**`. Tidak ada tenant yang perlu mengubah konfigurasi, dan tidak ada tenant yang bisa memilih untuk tetap dilayani — keluarga rutenya hilang untuk semua orang, sesuai [ADR-0071](../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md) yang membelah kosakata URL keluarga: `/blog/**` milik repo ini, `/news/**` milik `ahliweb/awcms-astro`.

`publicRouteMode` masih `domain_default` sebagai bawaan modul, artinya `/news/**` **menyala** untuk setiap tenant yang tidak mematikannya. Menghapusnya tanpa penerus akan mematikan URL yang sitemap dan feed repo ini sudah iklankan; 301 adalah penerusnya.

- **Redirect-nya adalah kebalikan dari yang sudah ada.** `domain/legacy-blog-redirect.ts` — yang memetakan `/blog/{tenantCode}` → `/news` — diganti `domain/retired-news-redirect.ts` yang memetakan arah sebaliknya, dan strategi 1 di `redirect-resolution-service.ts` dibalik bersamanya. Arah yang salah tidak melempar, tidak menggagalkan typecheck, dan hanya terlihat sebagai loop pada tenant yang kebetulan punya kedua bentuk hidup — jadi test pertamanya soal **arah**, dan ia menamai apa yang dijaganya.
- **Tidak ber-policy, dan tidak digerbangi `seo_distribution` aktif.** Yang digantikannya adalah rewrite OPSIONAL yang tenant nyalakan; ini migrasi URL yang tak seorang pun pilih. Menggerbanginya pada modul yang bisa dimatikan tenant berarti tenant yang mematikannya justru yang URL terbitnya mati.
- **Satu syarat bertahan, dan ia menjaga invarian ADR-0071 §3.** Tenant dengan `legacyTenantRouteEnabled: false` **tidak** mendapat redirect: ia sudah mematikan seluruh permukaan konten publiknya, jadi 301 ke `/blog/{tenantCode}` adalah 301 ke 404 yang pasti. "Jangan pernah mengiklankan URL yang tidak kita layani" berlaku untuk tujuan redirect, bukan hanya entri sitemap.
- **`legacy_blog_redirect_enabled` (`sql/060`) pensiun tetapi tidak dihapus.** Migrasi terapan immutable dan di-checksum `scripts/db-migrate.ts`, dan permukaan API-nya sudah terbit. Tidak ada lagi yang membacanya — ia kini benar-benar inert, dan untuk alasan yang **diputuskan** alih-alih kebetulan.
- **Batas segmen bukan hipotetis.** Repo ini punya nama kapabilitas `newsletter`; `startsWith("/news")` telanjang akan mem-301 `/newsletter` menjadi `/blog/{tenantCode}letter`. Ada testnya.

Yang ikut dicabut bersama keluarga rutenya: `publicRouteMode`, `withHostResolvedBlogTenant`, `padUnresolvedHostRouteLatency`, `HOST_RESOLVED_PUBLIC_BASE_PATH`, dan `"/news"` dari `blog_content.api.routes`. Tabel base path SEO menciut dari tiga baris ke dua — tenant menyajikan `/blog/{tenantCode}` atau tidak menyajikan apa pun; baris `null` yang membawa invariannya tidak berubah.

**Penanda §4 ADR-0071 dibalik ke SUDAH DILAKSANAKAN**, dan `tests/url-vocabulary-split.test.ts` memang **memerah di antara** penghapusan rute dan pembalikan penanda itu — gerbang yang ditulis untuk jendela ini terbukti menutupnya, bukan sekadar mengklaimnya.

Yang hanya terasa saat mengembangkan:

- **ADR-0067 berhenti `Proposed`.** Bagian RUM yang sengaja ditinggalkan pada 4 Agustus mendapat keputusannya: **Opsi B** — agregasi di titik masuk, nol baris mentah, Opsi C tetap ditolak. Statusnya `Accepted (belum diimplementasikan)` dan itu **digerbangi**: ADR ini kini punya entri di peta `tests/adr-implementation-status.test.ts`, yang menuntut kualifikasi selama artefaknya belum ada dan menuntut pencabutannya pada PR yang mendaratkannya. Artefak yang dipetakan **agregatnya**, bukan endpoint-nya — memetakan endpoint akan membiarkan implementasi baris-mentah memuaskan gerbangnya.
- **`POST /api/v1/analytics/vitals` adalah permukaan tulis publik tanpa autentikasi**, kelas yang paling sedikit dimiliki repo ini. Adendum ADR-0067 menuliskan apa yang wajib dibawa PR implementasinya: rate limit ADR-0066 + batas badan sebelum satu baris ditulis, normalisasi rute ke POLA dari daftar rute nyata (bukan string klien), validasi rentang nilai metrik, dan `VISITOR_ANALYTICS_ENABLED` tetap saklarnya.
- **Dua baris celah §9 berhenti berbohong.** C13 menyatakan approval rilis tertahan dan "GitHub Release terbaru masih `v6.4.0`" — `v7.0.0` dan `v7.0.1` sudah terbit. C7 menyatakan bagian RUM menunggu pemilik produk — tidak lagi. Nol celah `TERBUKA` tersisa di dokumen yang dilabeli LIVING dan disuruh dibaca sebelum go-live.
