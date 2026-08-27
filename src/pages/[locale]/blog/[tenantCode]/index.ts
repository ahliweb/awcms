/**
 * `GET /{locale}/blog/{tenantCode}` — the canonical, locale-prefixed spelling
 * of the public blog index (ADR-0098, as amended).
 *
 * Registration only: the handler IS `src/pages/blog/[tenantCode]/index.ts`'s,
 * wrapped so an unsupported locale segment 404s. See
 * `src/lib/i18n/localised-route.ts` for why the middleware rewrite this
 * replaces could not work.
 */
import { GET as bareGet } from "../../../blog/[tenantCode]/index";
import { localisedPublicRoute } from "../../../../lib/i18n/localised-route";

export const GET = localisedPublicRoute(bareGet);
