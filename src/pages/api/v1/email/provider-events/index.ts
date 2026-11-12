import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  decodeProviderEventCursor,
  listProviderEvents,
  projectMessageProviderStatus,
  type ProviderEventReviewStatus
} from "../../../../../modules/email/application/provider-event-directory";
import {
  asUuid,
  EMAIL_WEBHOOK_GUARDS
} from "../../../../../modules/email/application/webhook-route-support";
import { resolveSoftBounceThreshold } from "../../../../../modules/email/domain/suppression-policy";
import { loadEmailSenderAccess } from "../../../../../modules/email/infrastructure/channel-account-loaders";

const REVIEW_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "confirmed",
  "dismissed",
  "informational"
]);

/**
 * `GET /api/v1/email/provider-events` (Issue #1161, ADR-0151 section 5) — the
 * quarantine of provider-reported, UNAUTHENTICATED Mailketing events, newest
 * first, keyset-paged (`cursor`), optionally by `reviewStatus` and by
 * `emailMessageId`. With `emailMessageId` the response also carries that
 * message's provider-reported projection (`accepted` < `delivered` <
 * `bounced`, forward-only), never written onto the message.
 *
 * Recipients are masked; a click shows the link's HOST only. Every entry and
 * the projection say `authenticity: "unauthenticated"`. Only events of
 * accounts the caller may see under the `channel_accounts` rules.
 * Requires `email.webhook.read`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: EMAIL_WEBHOOK_GUARDS.read,
  handler: async (context) => {
    const { tx, tenantId, request } = context;
    const url = new URL(request.url);
    const rawStatus = url.searchParams.get("reviewStatus");
    const rawMessage = url.searchParams.get("emailMessageId");
    const rawCursor = url.searchParams.get("cursor");

    if (rawStatus !== null && !REVIEW_STATUSES.has(rawStatus)) {
      return fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, [
        {
          field: "reviewStatus",
          message:
            "reviewStatus must be one of pending, confirmed, dismissed, informational."
        }
      ]);
    }

    const emailMessageId = rawMessage === null ? null : asUuid(rawMessage);

    if (rawMessage !== null && !emailMessageId) {
      return fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, [
        { field: "emailMessageId", message: "emailMessageId must be a UUID." }
      ]);
    }

    const cursor = decodeProviderEventCursor(rawCursor);

    if (rawCursor !== null && !cursor) {
      return fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, [
        { field: "cursor", message: "cursor is not valid." }
      ]);
    }

    const access = await loadEmailSenderAccess();

    if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

    const page = await listProviderEvents(tx, tenantId, {
      reviewStatus: rawStatus as ProviderEventReviewStatus | null,
      emailMessageId,
      cursor
    });
    const seen = new Map<string, boolean>();
    const events = [];

    for (const event of page.events) {
      let visible = seen.get(event.espAccountId);

      if (visible === undefined) {
        visible = await access.canUseAccount(
          context,
          EMAIL_WEBHOOK_GUARDS.read,
          event.espAccountId,
          "viewer"
        );
        seen.set(event.espAccountId, visible);
      }

      if (visible) events.push(event);
    }

    // The projection is shown only when the message has events and every one
    // of them is one the caller may see (one message belongs to one account),
    // so it never reveals the status of a message of an account the caller
    // cannot see.
    const projection =
      emailMessageId !== null &&
      events.length > 0 &&
      events.length === page.events.length &&
      page.nextCursor === null
        ? await projectMessageProviderStatus(tx, tenantId, emailMessageId)
        : null;

    return ok({
      events,
      nextCursor: page.nextCursor,
      projection,
      softBounceThreshold: resolveSoftBounceThreshold()
    });
  }
});
