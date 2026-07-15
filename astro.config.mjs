import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// SSR di atas Bun via adapter @astrojs/node (standalone) — pengecualian
// Bun-only yang tersanksi (ADR-0002; docs/awcms/10_template_kode_coding_standard.md
// §Standar platform backend) karena Astro belum punya adapter Bun first-party.
// Runtime tetap Bun: hasil build dijalankan `bun ./dist/server/entry.mjs`.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  site: "http://localhost:4321"
});
