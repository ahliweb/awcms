import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { withdrawSubmission } from "../../../../../../modules/website-engagement/application/submission-directory";
import {
  asUuid,
  auditWebsiteEngagement,
  badId,
  notFound,
  personOnlyRefusal,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/website-engagement/application/route-support";
import {
  validateWithdraw,
  type WithdrawInput
} from "../../../../../../modules/website-engagement/domain/source-validation";
import { WEBSITE_ENGAGEMENT_GUARDS } from "../../../../../../modules/website-engagement/domain/website-engagement-constants";

const SCOPE = "website_engagement_submission_withdraw";

type Prepared = { idempotencyKey: string; input: WithdrawInput };

/**
 * `POST /api/v1/website-engagement/submissions/{id}/withdraw` — the controller's
 * opt-out / withdrawal (ADR-0155 section 5): mark the submission withdrawn and
 * announce it with `awcms.website_engagement.submission.withdrawn`, which
 * downstream consumers must honour. One-way, audited at warning, and idempotent:
 * `Idempotency-Key` replays the stored answer, and withdrawing an already
 * withdrawn submission changes and publishes nothing. A raw public withdrawal
 * request is a recorded limitation of this slice.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateWithdraw);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: WEBSITE_ENGAGEMENT_GUARDS.withdrawSubmissions,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await withdrawSubmission(
          tx,
          tenantId,
          actor,
          id,
          prepared.input.reason,
          context.locals.correlationId
        );

        if (result.outcome === "not_found") return notFound("Submission");

        if (result.outcome === "withdrawn") {
          await auditWebsiteEngagement(context, {
            action: "website_engagement.submission.withdraw",
            resourceType: "website_engagement_submission",
            resourceId: id,
            severity: "warning",
            message: "Website submission withdrawn.",
            attributes: { reason: prepared.input.reason }
          });
        }

        return {
          status: 200,
          body: { ...result.submission }
        };
      }
    );
  }
});
