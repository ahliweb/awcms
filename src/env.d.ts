/// <reference types="astro/client" />

import type { SsrContext } from "./lib/auth/ssr-session";

declare global {
  namespace App {
    interface Locals {
      /** Populated by `src/middleware.ts` for `/admin/*` once a valid cookie session resolves. */
      ssrContext?: SsrContext;
      /** Populated by `src/middleware.ts` for every request — echoes `X-Correlation-ID` or a fresh UUID. */
      correlationId: string;
      /**
       * Published by a public route that has already resolved its tenant, so the
       * edge-cache layer can tag the response with a tenant surrogate key
       * without repeating the lookup (ADR-0042 §8). Routes that leave this unset
       * on a host-resolved surface are simply not cached — never mis-tagged.
       */
      edgeCacheTenantId?: string | null;
    }
  }
}
