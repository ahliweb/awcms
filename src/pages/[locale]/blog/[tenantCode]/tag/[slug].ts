/**
 * `GET /{locale}/blog/{tenantCode}/tag/{slug}` — the canonical, locale-prefixed
 * spelling of a public tag archive (ADR-0098, as amended).
 *
 * Registration only: the handler IS
 * `src/pages/blog/[tenantCode]/tag/[slug].ts`'s, wrapped so an unsupported
 * locale segment 404s.
 */
import { GET as bareGet } from "../../../../blog/[tenantCode]/tag/[slug]";
import { localisedPublicRoute } from "../../../../../lib/i18n/localised-route";

export const GET = localisedPublicRoute(bareGet);
