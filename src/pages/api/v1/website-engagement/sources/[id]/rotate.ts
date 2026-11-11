import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { rotateSource } from "../../../../../../modules/website-engagement/application/source-directory";
import {
  asUuid,
  auditWebsiteEngagement,
  badId,
  notFound,
  personOnlyRefusal,
  readIdempotencyKey,
  ringUnavailable,
  runIdempotent,
  withEffectiveChallenge
} from "../../../../../../modules/website-engagement/application/route-support";
import { resolveWebsiteEngagementRings } from "../../../../../../modules/website-engagement/domain/engagement-config";
import { WEBSITE_ENGAGEMENT_GUARDS } from "../../../../../../modules/website-engagement/domain/website-engagement-constants";

const SCOPE = "website_engagement_source_rotate";

/**
 * `POST /api/v1/website-engagement/sources/{id}/rotate` — replace the source's
 * token. The previous token stops working IMMEDIATELY (no grace window). The new
 * token is in this response once (`revealed: true`); a replay of the same
 * `Idempotency-Key` answers the stored body without it, so a lost token is
 * recovered by rotating again with a new key, never by reading it back.
 */
export const POST = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ request }) => readIdempotencyKey(request),
  authorize: WEBSITE_ENGAGEMENT_GUARDS.manageSources,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth) ?? ringUnavailable();

    if (refused) return refused;

    const keys = resolveWebsiteEngagementRings();

    if (!keys.ok) return ringUnavailable()!;

    const ring = keys.rings.hash;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      context.prepared,
      actor,
      { id },
      async () => {
        const result = await rotateSource(tx, tenantId, actor, id, ring);

        if (result.outcome === "not_found") return notFound("Source");

        if (result.outcome === "revoked") {
          return fail(
            409,
            "SOURCE_REVOKED",
            "A revoked source cannot be rotated."
          );
        }

        await auditWebsiteEngagement(context, {
          action: "website_engagement.source.rotate",
          resourceType: "website_engagement_source",
          resourceId: id,
          severity: "warning",
          message: "Website source token rotated and shown once."
        });

        return {
          status: 200,
          body: { ...withEffectiveChallenge(result.source) },
          reveal: { token: result.token }
        };
      }
    );
  }
});
