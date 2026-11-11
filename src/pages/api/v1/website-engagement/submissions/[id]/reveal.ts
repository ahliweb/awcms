import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { FieldEncryptionError } from "../../../../../../lib/security/field-encryption";
import { log } from "../../../../../../lib/logging/logger";
import {
  fetchSubmission,
  revealSubmission
} from "../../../../../../modules/website-engagement/application/submission-directory";
import {
  asUuid,
  auditWebsiteEngagement,
  badId,
  notFound,
  ringUnavailable
} from "../../../../../../modules/website-engagement/application/route-support";
import { resolveWebsiteEngagementRings } from "../../../../../../modules/website-engagement/domain/engagement-config";
import { WEBSITE_ENGAGEMENT_GUARDS } from "../../../../../../modules/website-engagement/domain/website-engagement-constants";

/**
 * `POST /api/v1/website-engagement/submissions/{id}/reveal` — the ONE place a
 * visitor's name, address, phone number and message are decrypted (ADR-0155
 * section 5; the sanctioned read a CRM consumer uses, under its own
 * `submissions.reveal` permission). Every reveal is audited at warning with the
 * submission id and NEVER the values. A machine credential may reveal (that is
 * the consumer), a withdrawn submission may not (the data subject asked for it
 * to stop being used), and an interaction has nothing to reveal.
 *
 * POST, not GET: the response carries personal data and must not be cached,
 * logged as a URL, or prefetched.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: WEBSITE_ENGAGEMENT_GUARDS.revealSubmissions,
  handler: async (context) => {
    const unavailable = ringUnavailable();

    if (unavailable) return unavailable;

    const keys = resolveWebsiteEngagementRings();

    if (!keys.ok) return ringUnavailable()!;

    const ring = keys.rings.encryption;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const submission = await fetchSubmission(context.tx, context.tenantId, id);

    if (!submission) return notFound("Submission");

    if (submission.status === "withdrawn") {
      return fail(
        409,
        "SUBMISSION_WITHDRAWN",
        "This submission was withdrawn and its details are not available."
      );
    }

    let contact;

    try {
      contact = await revealSubmission(context.tx, context.tenantId, id, ring);
    } catch (error) {
      if (error instanceof FieldEncryptionError) {
        log("error", "website_engagement.reveal_decrypt_failed", {
          submissionId: id,
          code: error.code
        });
        return fail(
          500,
          "DECRYPTION_FAILED",
          "The submission details could not be read."
        );
      }

      throw error;
    }

    if (!contact) {
      return fail(
        409,
        "NOTHING_TO_REVEAL",
        "This submission carries no contact details."
      );
    }

    await auditWebsiteEngagement(context, {
      action: "website_engagement.submission.reveal",
      resourceType: "website_engagement_submission",
      resourceId: id,
      severity: "warning",
      message: "Website submission contact details revealed.",
      attributes: { sourceId: submission.sourceId, kind: submission.kind }
    });

    return ok(
      { id, contact },
      {},
      { "cache-control": "no-store", pragma: "no-cache" }
    );
  }
});
