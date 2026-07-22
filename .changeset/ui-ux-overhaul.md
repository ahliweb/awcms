---
"awcms": minor
---

Overhaul UI/UX seluruh surface pengguna: mobile-first responsif, animasi profesional CSS-murni, dan aksesibilitas (WCAG AA, `prefers-reduced-motion`, skip-link, target sentuh ≥44px). Semua di dalam jaminan CSP single-owner "zero third-party origin di LAN/offline" — tanpa font CDN/library eksternal; animasi = keyframes/transition CSS; styling di-serve same-origin (bundle Astro atau `public/css/*.css`), tidak ada `<style>`/`<script>` inline.

- **Design system (fondasi)**: perkaya `tokens.css` (skala tipografi/spacing/radius/elevation, tint interaksi, token MOTION durasi+easing), tambah lapisan utility animasi reusable `motion.css` (fade/scale/slide/stagger/hover-lift/skeleton/spinner), dan shell layout admin+publik responsif dengan drawer mobile CSS-only.
- **Login**: redesign form + auto tenant picker — 1 tenant disembunyikan/prefilled, 2–50 dropdown nama tenant, >50 fallback manual (anti mass-enumeration), fail-closed ke input manual saat pre-setup/DB error. Tanpa endpoint publik baru; kontrak DOM login dipertahankan.
- **Admin**: 8 layar (`index`/`users`/`roles`/`offices`/`profiles`/`modules`/`abac-policies`/`email-templates`) mobile-first — tabel lebar → pola kartu/stack (`data-label` per sel), stat/quick-link beranimasi, hierarki visual & empty state konsisten. Selektor/hook E2E dipertahankan.
- **Blog publik** (`/blog/{tenantCode}/...`): tipografi baca nyaman (measure ~65ch), kartu post grid→stack, media/tabel/kode responsif, animasi entrance halus; renderer `content_json` whitelist-based tidak dilonggarkan.
