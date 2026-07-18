import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// SSR di atas Bun via adapter @astrojs/node (standalone) — pengecualian
// Bun-only yang tersanksi (ADR-0002; docs/awcms/10_template_kode_coding_standard.md
// §Standar platform backend) karena Astro belum punya adapter Bun first-party.
// Runtime tetap Bun: hasil build dijalankan `bun ./dist/server/entry.mjs`.
//
// TIDAK ADA blok `security.csp` di sini — SENGAJA (Issue #148, dipertahankan
// #166). CSP di-set SATU sumber saja: `src/lib/security/security-headers.ts`,
// dipasang `src/middleware.ts` ke SETIAP response (JSON API, HTML 404, dan
// halaman admin). Mengaktifkan `security.csp` Astro akan membuat DUA sumber
// CSP yang saling menimpa (baca header security-headers.ts) — jadi tidak
// dilakukan.
//
// Konsekuensi untuk halaman `.astro` (login/admin, #166): CSP itu
// `default-src 'self'` TANPA `'unsafe-inline'`, jadi `<script>`/`<style>`
// inline akan diblokir. Karena itu:
//   - `build.inlineStylesheets: "never"` memaksa SEMUA CSS (termasuk
//     `<style>` ber-scope Astro dan `import "*.css"`) di-emit sebagai
//     `<link>` eksternal dari origin sendiri → lolos `default-src 'self'`.
//   - Setiap `<script>` di halaman ditulis sebagai module script yang
//     di-bundle Astro (BUKAN `is:inline`) → file eksternal dari origin
//     sendiri → lolos `default-src 'self'`.
// Dengan dua aturan itu halaman tidak pernah mengandung script/style inline,
// jadi CSP ketat middleware tetap satu-satunya sumber dan tidak ada yang
// bocor. Jalankan E2E terhadap build produksi (`bun run build && start`) —
// dev server Astro menyuntik HMR inline yang memang diblokir CSP ini.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  site: "http://localhost:4321",
  build: {
    inlineStylesheets: "never"
  }
});
