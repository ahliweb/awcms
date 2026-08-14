/// <reference types="astro/client" />

import type { SsrContext } from "./lib/auth/ssr-session";
import type { Locale } from "./lib/i18n/locales";

declare global {
  namespace App {
    interface Locals {
      /** Populated by `src/middleware.ts` for `/admin/*` once a valid cookie session resolves. */
      ssrContext?: SsrContext;
      /**
       * The locale this response is rendered in (ADR-0095). Set by
       * `src/middleware.ts` for EVERY request, so it is never undefined in a
       * route that the middleware ran for — and non-optional here precisely so
       * a new route cannot forget to consider it.
       *
       * Public surfaces do not read this yet: a public page whose body varies by
       * locale needs the edge-cache key to carry the locale first, which
       * ADR-0095 §"Keputusan 5" defers rather than assumes.
       */
      locale: Locale;
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
