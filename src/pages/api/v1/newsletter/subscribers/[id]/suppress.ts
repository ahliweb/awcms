import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import { log } from "../../../../../../lib/logging/logger";
import { suppressSubscriber } from "../../../../../../modules/newsletter/application/subscriber-directory";
import {
  NEWSLETTER_ACTIVITY_CODE,
  NEWSLETTER_MODULE_KEY
} from "../../../../../../modules/newsletter/domain/newsletter-permissions";

/**
 * `POST /api/v1/newsletter/subscribers/{id}/suppress` (Issue #598, ADR-0103).
 *
 * The only authenticated write in this module, and the only one that needs to
 * be: everything else a subscriber's state can do, the subscriber does.
 *
 * ## Why suppression is not unsubscription
 *
 * `unsubscribed` is the SUBSCRIBER's decision and they may reverse it by signing
 * up again. `suppressed` is the OPERATOR's or the provider's — a hard bounce, an
 * abuse report, a legal instruction — and re-subscribing must not clear it. That
 * is why they are two states rather than one `inactive`, and why this endpoint
 * exists rather than an admin-side call to the public unsubscribe.
 *
 * ## The reason is required
 *
 * A suppression is the one state a subscriber cannot leave, so it is the one
 * somebody will later ask about. It goes on the audit row, which outlives the
 * subscriber it describes — and that audit row records the MASKED address, so
 * the trail does not become a second copy of the list.
 *
 * No `Idempotency-Key`: suppressing an already-suppressed row is a no-op that
 * writes the same state, and requiring a key for a naturally idempotent
 * transition would be ceremony.
 */
const MAX_REASON_LENGTH = 500;

type Prepared = { reason: string };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    const raw = (bodyRead.value as { reason?: unknown } | null)?.reason;
    const reason = typeof raw === "string" ? raw.trim() : "";

    if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `reason is required and must be at most ${MAX_REASON_LENGTH} characters.`
      );
    }

    return { reason };
  },
  authorize: {
    moduleKey: NEWSLETTER_MODULE_KEY,
    activityCode: NEWSLETTER_ACTIVITY_CODE,
    action: "configure"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const subscriberId = params.id;

    if (!subscriberId) {
      return fail(400, "VALIDATION_ERROR", "Subscriber id is required.");
    }

    const suppressed = await suppressSubscriber(
      tx,
      tenantId,
      auth.context.tenantUserId,
      subscriberId,
      prepared.reason,
      locals.correlationId
    );

    if (!suppressed) {
      return fail(404, "RESOURCE_NOT_FOUND", "Subscriber not found.");
    }

    log("info", "newsletter.subscriber.suppressed", {
      correlationId: locals.correlationId,
      tenantId,
      moduleKey: NEWSLETTER_MODULE_KEY,
      subscriberId
    });

    return ok({ id: subscriberId, status: "suppressed" });
  }
});
