/// <reference types="astro/client" />

import type { SsrContext } from "./lib/auth/ssr-session";

declare global {
  namespace App {
    interface Locals {
      /** Populated by `src/middleware.ts` for `/admin/*` once a valid cookie session resolves. */
      ssrContext?: SsrContext;
      /** Populated by `src/middleware.ts` for every request — echoes `X-Correlation-ID` or a fresh UUID. */
      correlationId: string;
    }
  }
}
