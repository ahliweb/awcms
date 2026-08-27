/**
 * `GET /{locale}/blog/{tenantCode}/category/{slug}` — the canonical,
 * locale-prefixed spelling of a public category archive (ADR-0098, as amended).
 *
 * Registration only: the handler IS
 * `src/pages/blog/[tenantCode]/category/[slug].ts`'s, wrapped so an unsupported
 * locale segment 404s.
 */
import { GET as bareGet } from "../../../../blog/[tenantCode]/category/[slug]";
import { localisedPublicRoute } from "../../../../../lib/i18n/localised-route";

export const GET = localisedPublicRoute(bareGet);
