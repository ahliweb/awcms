---
"awcms": patch
---

Redesign pengalaman baca halaman blog publik (`/blog/{tenantCode}/...`): tipografi baca yang nyaman (measure ~65ch, skala heading, spacing antar blok), layout mobile-first responsif (kartu post grid→stack, gambar/galeri/video/tabel/kode responsif dengan scroll-container sendiri), dan animasi entrance halus (fade-in-up + stagger kartu, hover kartu) berbasis CSS murni.

Styling di-serve via satu stylesheet same-origin `public/css/public-content.css` yang di-link `renderPublicPageShell` — bukan `<style>` inline (yang akan diblokir CSP `default-src 'self'` tanpa `'unsafe-inline'`), sehingga jaminan "zero third-party CSP origin di LAN/offline" tetap utuh. Tema light/dark mengikuti `prefers-color-scheme` (tanpa JS). Semua animasi di-guard `prefers-reduced-motion`. `renderPublicPageShell` menambah opsi presentasional `variant` (`"list"`/`"article"`) dan membungkus body dalam `<main class="pc-page">` plus skip-link; renderer `content_json` whitelist-based tidak diubah (sanitasi tetap sama).
