import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { resolveNewsMediaR2Config } from "../../../../modules/media-library/domain/media-r2-config";
import { deriveMediaPublicOrigin } from "../../../../modules/media-library/domain/media-public-origin";
import { MEDIA_PERMISSION_ACTIVITY_CODE } from "../../../../modules/media-library/domain/media-permissions";

/**
 * `GET /api/v1/media/public-origin` — the origin media `publicUrl`s are served
 * from.
 *
 * ## Who needs it and why it cannot be inferred
 *
 * `awcms-astro` builds a static site from this repo's content and ships a
 * strict CSP. Its `img-src` must name the media host at BUILD time, before a
 * single object is fetched — an image resolved perfectly still renders as
 * nothing when `img-src 'self'` blocks the host it lives on.
 *
 * `GET /api/v1/media/objects?ids=` already returns absolute `publicUrl`s, so
 * the origin could in principle be read off the first response. That does not
 * help: the policy has to be written before the fetch, and a site with no
 * images in a given build would then emit no `img-src` at all and break the
 * next one. The only alternative left is copying
 * `NEWS_MEDIA_R2_PUBLIC_BASE_URL` into the consumer by hand, which is two
 * copies of one value that agree until one is edited — and the failure it
 * produces (images silently blocked) does not name its cause anywhere.
 *
 * ## Gated on `media.read`, which is deliberate and sufficient
 *
 * The value is not a secret: every `publicUrl` this deployment has ever handed
 * out already contains it, and the bucket is public by construction. The guard
 * is here because everything in `/api/v1` is tenant-scoped and default-deny,
 * not because the origin is sensitive — and `media.read` is the permission a
 * build client already holds to resolve objects, so this adds no new authority
 * to any credential. Machine credentials are read-only (ADR-0049), so a build
 * token can call this and nothing else here.
 *
 * ## An unconfigured deployment answers 200, not 404
 *
 * LAN and offline profiles serve no public media. Failing the request there
 * would fail a build on a perfectly valid deployment, so the response reports
 * `configured: false` and the consumer omits the `img-src` entry rather than
 * adding a broken one — a state it can tell apart from an error.
 *
 * Read-only, no database access beyond the guard's own transaction.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "media_library",
    activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
    action: "read"
  },
  handler: async () => {
    // Deployment config, not tenant data: every tenant on this deployment is
    // served from the same bucket, so there is nothing here to scope per
    // tenant. The guard still runs — being non-tenant-specific is not a reason
    // to be unauthenticated.
    const config = resolveNewsMediaR2Config();

    return ok(deriveMediaPublicOrigin(config.publicBaseUrl));
  }
});
