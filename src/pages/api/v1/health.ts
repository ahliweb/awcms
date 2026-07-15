import type { APIRoute } from "astro";

import { ok } from "../../../modules/_shared/api-response";
import { listModules } from "../../../modules";

// SSR dinamis — endpoint ini harus berjalan per-request di atas server
// (@astrojs/node), bukan file statis hasil build. Lihat astro.config.mjs.
export const GET: APIRoute = async () =>
  ok({
    status: "ok",
    service: "awcms",
    runtime: "bun",
    moduleCount: listModules().length,
    generatedAt: new Date().toISOString()
  });
