---
"awcms": patch
---

docs(seo,modul): redirect legacy `/blog/{tenantCode}` → `/news` berhenti disebut INERT; tiga komentar kode yang membantah kodenya sendiri diperbaiki

Ditemukan saat verifikasi adversarial atas ADR-0070, di luar cakupannya, jadi dikerjakan terpisah.

**Yang paling mahal: sebuah saklar dinyatakan tidak berefek, padahal berefek.** Enam tempat menyatakan auto-redirect legacy "INERT in awcms — no `/news` route family". Itu benar saat [ADR-0039](../docs/adr/0039-seo-distribution-redirect-governance.md) menulisnya. [ADR-0059](../docs/adr/0059-host-resolved-public-content-routes.md) kemudian mendaratkan keluarga `/news/**` — `/news`, `/news/{slug}`, `/news/category/{slug}`, `/news/tag/{slug}` — dan **setiap tujuan yang bisa dihasilkan pemetaan ini sekarang resolve**. Rantainya utuh dan hidup: `src/middleware.ts` → `resolvePublicRedirectForRequest` → `resolvePublicRedirect` → `resolveLegacyBlogRedirect`.

Kenapa ini bukan sekadar kalimat basi: `legacy_blog_redirect_enabled` tetap `DEFAULT false`, jadi tidak ada yang berubah bagi operator yang membiarkannya. Tetapi seorang operator yang membaca komentar itu akan menyalakannya **dengan keyakinan bahwa itu no-op** — dan yang ia dapat adalah 301 permanen atas lalu lintas `/blog/{tenantCode}` yang hidup. 301 di-cache browser dan perantara; ia tidak dibatalkan dengan mengembalikan kolomnya ke `false`. Menyalakannya adalah migrasi URL konten, bukan preferensi, dan itu yang sekarang dikatakan keenam tempat itu.

`sql/060` sengaja TIDAK disunting: migrasi terapan itu immutable dan di-checksum `scripts/db-migrate.ts`, jadi menyunting komentarnya akan memerahkan setiap environment yang sudah menerapkannya. Koreksinya hidup di README modul, yang menyebutkan hal itu eksplisit supaya pembaca berikutnya tidak "memperbaiki" migrasinya.

**Nol perubahan perilaku.** Tidak ada default yang berubah dan tidak ada gerbang yang bergeser — yang berubah adalah apa yang repo ini katakan tentang perilaku yang sudah berlaku sejak ADR-0059.

Tiga komentar lain yang membantah kodenya sendiri:

- **`idn-admin-regions/module.ts`** membuka dengan "No `navigation`" tepat di atas blok `navigation` yang ia deklarasikan. Komentarnya benar untuk jeda antara ADR-0052 (mencabut permukaan HTTP-nya) dan ADR-0053 (mengembalikannya di balik gerbang platform-scoped, dan layarnya mendarat bersamanya, PR #332).
- **`module-management/domain/sidebar-menu.ts`** menyatakan modul itu tidak punya navigasi di repo ini "karena layar operatornya ada di awcms-astro, ADR-0047" — dua kesalahan dalam satu kalimat: pembagian itu ADR-0048, bukan ADR-0047, dan keputusannya sudah dicabut (ADR-0051 mengonsolidasikan layar admin SISTEM ke sini; ADR-0047 sendiri di-supersede ADR-0055).
- **`tenant-domain` dan `visitor-analytics`** masih menyebut "PORT DEFERRAL" pada deskriptor modulnya. ADR-0055 §1 menutup jalur port, dan yang ditunda `tenant_domain` — keluarga rute konten host-resolved — justru sudah mendarat di `blog_content` sebagai `/news/**` (ADR-0059).
