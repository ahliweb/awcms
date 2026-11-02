import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { revokeSource } from "../../../../../../modules/website-engagement/application/source-directory";
import {
  asUuid,
  auditWebsiteEngagement,
  badId,
  notFound,
  personOnlyRefusal,
  withEffectiveChallenge
} from "../../../../../../modules/website-engagement/application/route-support";
import { WEBSITE_ENGAGEMENT_GUARDS } from "../../../../../../modules/website-engagement/domain/website-engagement-constants";

/**
 * `POST /api/v1/website-engagement/sources/{id}/revoke` — stop accepting
 * submissions for this source, permanently. One-way, and idempotent BY STATE:
 * revoking a revoked source answers the same and audits nothing the second
 * time. A revoked source cannot be reactivated (the database refuses it);
 * create or rotate instead.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: WEBSITE_ENGAGEMENT_GUARDS.manageSources,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const result = await revokeSource(
      context.tx,
      context.tenantId,
      context.auth.context.tenantUserId,
      id
    );

    if (result.outcome === "not_found") return notFound("Source");

    if (result.changed) {
      await auditWebsiteEngagement(context, {
        action: "website_engagement.source.revoke",
        resourceType: "website_engagement_source",
        resourceId: id,
        severity: "warning",
        message: "Website source revoked."
      });
    }

    return ok(withEffectiveChallenge(result.source));
  }
});
