import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { fetchSubmission } from "../../../../../../modules/website-engagement/application/submission-directory";
import {
  asUuid,
  badId,
  notFound
} from "../../../../../../modules/website-engagement/application/route-support";
import { WEBSITE_ENGAGEMENT_GUARDS } from "../../../../../../modules/website-engagement/domain/website-engagement-constants";

/** `GET /api/v1/website-engagement/submissions/{id}` — one submission, masked. An id in another tenant answers exactly like one that does not exist. */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: WEBSITE_ENGAGEMENT_GUARDS.readSubmissions,
  handler: async (context) => {
    const id = asUuid(context.params.id);

    if (!id) return badId();

    const submission = await fetchSubmission(context.tx, context.tenantId, id);

    return submission ? ok(submission) : notFound("Submission");
  }
});
