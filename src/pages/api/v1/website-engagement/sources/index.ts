import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail } from "../../../../../modules/_shared/api-response";
import {
  createSource,
  listSources
} from "../../../../../modules/website-engagement/application/source-directory";
import {
  auditWebsiteEngagement,
  personOnlyRefusal,
  readIdempotencyKey,
  readValidatedBody,
  ringUnavailable,
  runIdempotent,
  withEffectiveChallenge
} from "../../../../../modules/website-engagement/application/route-support";
import { resolveWebsiteEngagementRing } from "../../../../../modules/website-engagement/domain/engagement-config";
import {
  validateCreateSource,
  type CreateSourceInput
} from "../../../../../modules/website-engagement/domain/source-validation";
import { WEBSITE_ENGAGEMENT_GUARDS } from "../../../../../modules/website-engagement/domain/website-engagement-constants";

const SCOPE = "website_engagement_source_create";

/**
 * `GET /api/v1/website-engagement/sources` — the tenant's website sources, with
 * their hosts and the challenge each ACTUALLY gets on this deployment. Never a
 * token or its hash: only the six-character prefix.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: WEBSITE_ENGAGEMENT_GUARDS.readSources,
  handler: async (context) => {
    const sources = await listSources(context.tx, context.tenantId);

    return ok({ items: sources.map(withEffectiveChallenge) });
  }
});

type Prepared = { idempotencyKey: string; input: CreateSourceInput };

/**
 * `POST /api/v1/website-engagement/sources` — create a source. The response
 * carries the token ONCE (`token`, `revealed: true`); a replay of the same
 * `Idempotency-Key` answers the stored body without it. Code unique per tenant
 * (`409 SOURCE_CODE_TAKEN`); a host that is not a live domain of this tenant is
 * `422 DOMAIN_NOT_FOUND` (another tenant's domain answers the same).
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateCreateSource);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: WEBSITE_ENGAGEMENT_GUARDS.manageSources,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth) ?? ringUnavailable();

    if (refused) return refused;

    const ring = resolveWebsiteEngagementRing();

    if (!ring.ok) return ringUnavailable()!;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        const result = await createSource(
          tx,
          tenantId,
          actor,
          prepared.input,
          ring
        );

        if (result.outcome === "code_taken") {
          return fail(
            409,
            "SOURCE_CODE_TAKEN",
            "This source code is already in use."
          );
        }

        if (result.outcome === "domain_not_found") {
          return fail(
            422,
            "DOMAIN_NOT_FOUND",
            "A listed domain is not a live domain of this tenant."
          );
        }

        await auditWebsiteEngagement(context, {
          action: "website_engagement.source.create",
          resourceType: "website_engagement_source",
          resourceId: result.source.id,
          severity: "warning",
          message: "Website source created and its token shown once.",
          attributes: {
            code: result.source.code,
            domainCount: result.source.domains.length,
            challengeMode: result.source.challengeMode
          }
        });

        return {
          status: 201,
          body: { ...withEffectiveChallenge(result.source) },
          reveal: { token: result.token }
        };
      }
    );
  }
});
