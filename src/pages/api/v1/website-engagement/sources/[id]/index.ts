import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  deleteSource,
  fetchSource,
  updateSource
} from "../../../../../../modules/website-engagement/application/source-directory";
import {
  asUuid,
  auditWebsiteEngagement,
  badId,
  notFound,
  personOnlyRefusal,
  readValidatedBody,
  withEffectiveChallenge
} from "../../../../../../modules/website-engagement/application/route-support";
import {
  validateUpdateSource,
  type UpdateSourceInput
} from "../../../../../../modules/website-engagement/domain/source-validation";
import { WEBSITE_ENGAGEMENT_GUARDS } from "../../../../../../modules/website-engagement/domain/website-engagement-constants";

/** `GET /api/v1/website-engagement/sources/{id}` — one source. An id in another tenant answers exactly like an id that does not exist. */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: WEBSITE_ENGAGEMENT_GUARDS.readSources,
  handler: async (context) => {
    const id = asUuid(context.params.id);

    if (!id) return badId();

    const source = await fetchSource(context.tx, context.tenantId, id);

    return source ? ok(withEffectiveChallenge(source)) : notFound("Source");
  }
});

/**
 * `PATCH /api/v1/website-engagement/sources/{id}` — rename, pause or resume,
 * change the consent copy version, the challenge mode, the accepted kinds or
 * the host list. Revocation is its own endpoint and a revoked source cannot be
 * changed (`409 SOURCE_REVOKED`).
 */
export const PATCH = defineTenantRoute<UpdateSourceInput>({
  workClass: "interactive",
  prepare: ({ request }) => readValidatedBody(request, validateUpdateSource),
  authorize: WEBSITE_ENGAGEMENT_GUARDS.manageSources,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth, prepared } = context;
    const result = await updateSource(
      tx,
      tenantId,
      auth.context.tenantUserId,
      id,
      prepared
    );

    if (result.outcome === "not_found") return notFound("Source");

    if (result.outcome === "revoked") {
      return fail(409, "SOURCE_REVOKED", "A revoked source cannot be changed.");
    }

    if (result.outcome === "domain_not_found") {
      return fail(
        422,
        "DOMAIN_NOT_FOUND",
        "A listed domain is not a live domain of this tenant."
      );
    }

    await auditWebsiteEngagement(context, {
      action: "website_engagement.source.update",
      resourceType: "website_engagement_source",
      resourceId: id,
      severity: "warning",
      message: "Website source changed.",
      // Which fields changed, never their values.
      attributes: { fields: Object.keys(prepared).sort() }
    });

    return ok(withEffectiveChallenge(result.source));
  }
});

/** `DELETE /api/v1/website-engagement/sources/{id}` — soft delete. The source stops accepting at once; its submissions stay until retention removes them. */
export const DELETE = defineTenantRoute({
  workClass: "interactive",
  authorize: WEBSITE_ENGAGEMENT_GUARDS.manageSources,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const result = await deleteSource(
      context.tx,
      context.tenantId,
      context.auth.context.tenantUserId,
      id
    );

    if (result.outcome === "not_found") return notFound("Source");

    await auditWebsiteEngagement(context, {
      action: "website_engagement.source.delete",
      resourceType: "website_engagement_source",
      resourceId: id,
      severity: "warning",
      message: "Website source deleted."
    });

    return ok({ id, deleted: true });
  }
});
