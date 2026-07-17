import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// SSR di atas Bun via adapter @astrojs/node (standalone) — pengecualian
// Bun-only yang tersanksi (ADR-0002; docs/awcms/10_template_kode_coding_standard.md
// §Standar platform backend) karena Astro belum punya adapter Bun first-party.
// Runtime tetap Bun: hasil build dijalankan `bun ./dist/server/entry.mjs`.
//
// TIDAK ADA blok `security.csp` di sini — SENGAJA (Issue #148). Astro hanya
// memancarkan header CSP dari jalur render HALAMAN
// (`astro/dist/runtime/server/render/page.js`), sedangkan base ini tidak
// punya halaman sama sekali: `src/pages/` hanya berisi API endpoint. Blok
// `security.csp` di sini akan inert (nol header). CSP base ini di-set di
// `src/lib/security/security-headers.ts`, yang dipasang `src/middleware.ts`
// ke SETIAP response. Baca header file itu sebelum menambah halaman `.astro`
// pertama ke repo ini — dua sumber CSP tidak otomatis komposabel.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  site: "http://localhost:4321"
});
