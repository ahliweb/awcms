import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  fetchProviderEventAccount,
  reviewProviderEvent,
  type ReviewDecision
} from "../../../../../../modules/email/application/provider-event-directory";
import {
  asUuid,
  EMAIL_WEBHOOK_GUARDS,
  personOnlyRefusal,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../../modules/email/application/webhook-route-support";
import { resolveSoftBounceThreshold } from "../../../../../../modules/email/domain/suppression-policy";
import { loadEmailSenderAccess } from "../../../../../../modules/email/infrastructure/channel-account-loaders";

const SCOPE = "email_provider_event_review";

type Prepared = { idempotencyKey: string; payload: unknown };

/**
 * `POST /api/v1/email/provider-events/{id}/review` (Issue #1161, ADR-0151
 * section 5 `strict`) — the operator's decision on ONE quarantined bounce or
 * unsubscribe: `{"decision": "confirm"}` adds the recipient to the suppression
 * list (reason `bounced` / `unsubscribed`, source `provider_report`, which
 * never blocks security mail), `{"decision": "dismiss"}` records that nothing
 * was done. A soft or unclassified bounce may be confirmed only once the
 * recipient has bounced `EMAIL_WEBHOOK_SOFT_BOUNCE_THRESHOLD` times in 30 days
 * (`409 BELOW_SOFT_BOUNCE_THRESHOLD`). A review is final (`409 ALREADY_REVIEWED`;
 * opens, clicks and delivered are never reviewable).
 *
 * The only path by which a provider report changes anything. HIGH-RISK:
 * `email.provider_events.approve`, a signed-in person, visibility of the
 * event's Mailketing account under the `channel_accounts` rules, an
 * `Idempotency-Key`, and an audit row at `warning` carrying ids and codes only
 * (never an address, masked or not).
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const read = await readJsonBody(request);

    if (read.tooLarge) return bodyTooLargeResponse(read.limitBytes);

    if (read.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    return { idempotencyKey, payload: read.value };
  },
  authorize: EMAIL_WEBHOOK_GUARDS.approve,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);
    const notFound = fail(404, "NOT_FOUND", "Provider event not found.");

    if (!id) return notFound;

    const record = (context.prepared.payload ?? {}) as Record<string, unknown>;
    const decision = record.decision;

    if (decision !== "confirm" && decision !== "dismiss") {
      return fail(400, "VALIDATION_ERROR", "Review request is invalid.", {}, [
        {
          field: "decision",
          message: 'decision must be "confirm" or "dismiss".'
        }
      ]);
    }

    const { tx, tenantId, auth } = context;
    const access = await loadEmailSenderAccess();

    if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

    const accountId = await fetchProviderEventAccount(tx, tenantId, id);

    if (
      accountId === null ||
      !(await access.canUseAccount(
        context,
        EMAIL_WEBHOOK_GUARDS.approve,
        accountId,
        "operator"
      ))
    ) {
      return notFound;
    }

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      context.prepared.idempotencyKey,
      actor,
      { id, decision },
      async () => {
        const result = await reviewProviderEvent(
          tx,
          tenantId,
          actor,
          id,
          decision as ReviewDecision,
          resolveSoftBounceThreshold()
        );

        if (result.outcome === "not_found") return notFound;

        if (result.outcome === "not_reviewable") {
          return fail(
            409,
            "ALREADY_REVIEWED",
            "This provider event is not awaiting review.",
            {},
            { reviewStatus: result.reviewStatus }
          );
        }

        if (result.outcome === "below_threshold") {
          return fail(
            409,
            "BELOW_SOFT_BOUNCE_THRESHOLD",
            "A soft or unclassified bounce can be confirmed only after repeated bounces.",
            {},
            { softBounces: result.softBounces, threshold: result.threshold }
          );
        }

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: actor,
          moduleKey: "email",
          action:
            decision === "confirm"
              ? "email_provider_event.confirmed"
              : "email_provider_event.dismissed",
          resourceType: "email_provider_event",
          resourceId: id,
          severity: "warning",
          message:
            decision === "confirm"
              ? `Provider-reported ${result.event.eventType} confirmed into the suppression list (unauthenticated report).`
              : `Provider-reported ${result.event.eventType} dismissed.`,
          attributes: {
            eventType: result.event.eventType,
            bounceClass: result.event.bounceClass,
            espAccountId: result.event.espAccountId,
            emailMessageId: result.event.emailMessageId,
            suppressionId: result.suppression?.id ?? null,
            suppressionCreated: result.suppression?.created ?? false
          },
          correlationId: context.locals.correlationId
        });

        return {
          status: 200,
          body: { event: result.event, suppression: result.suppression }
        };
      }
    );
  }
});
