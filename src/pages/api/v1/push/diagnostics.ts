import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  listRecentPushAttempts,
  listRecentPushMessages,
  summarizePushQueue,
  PUSH_MESSAGE_STATUSES,
  type PushMessageStatus
} from "../../../../modules/push-delivery/application/push-diagnostics";
import { listPushSubscriptions } from "../../../../modules/push-delivery/application/subscription-directory";
import {
  isPushEnabled,
  isKnownPushProvider
} from "../../../../modules/push-delivery/domain/push-config";

/**
 * `GET /api/v1/push/diagnostics` (Issue #466) — the whole tenant's push outbox
 * in one response: queue counts, the most recent messages and delivery
 * attempts, and every registered device with a MASKED endpoint.
 *
 * ## Why one endpoint instead of four
 *
 * Everything here answers one question — "is push working, and if not, where is
 * it stuck?" — and the answer is only readable when the four parts are from the
 * same instant. Split across four calls, an operator refreshing during a drain
 * sees a queue count from before and a message list from after, and the
 * combination describes a state that never existed. `defineTenantRoute` opens
 * ONE transaction, so these four reads share a snapshot; four endpoints could
 * not.
 *
 * The cost of that choice is that the response is bounded rather than
 * paginated. That is the right trade for a console: the historical tail is
 * removed by retention (`bun run push:queue:purge`), not browsed.
 *
 * ## `configured` is deployment truth, not tenant state
 *
 * `PUSH_ENABLED` and `PUSH_PROVIDER` are per-deployment (see
 * `domain/push-config.ts`), and a queue that is filling while the dispatcher is
 * a no-op looks exactly like a queue that is stuck. Reporting the flag here is
 * what lets the screen say "nothing is sending because push is off" instead of
 * showing a growing number with no explanation. Neither value is a secret: one
 * is a boolean, the other is the name of an adapter.
 */
export const GET = defineTenantRoute<{
  status?: PushMessageStatus;
  limit: number;
}>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const statusParam = (url.searchParams.get("status") ?? "").trim();

    if (
      statusParam !== "" &&
      !(PUSH_MESSAGE_STATUSES as readonly string[]).includes(statusParam)
    ) {
      return fail(
        422,
        "VALIDATION_FAILED",
        `status must be one of: ${PUSH_MESSAGE_STATUSES.join(", ")}.`
      );
    }

    const limitParam = (url.searchParams.get("limit") ?? "").trim();
    const limit = limitParam === "" ? 50 : Number(limitParam);

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      // Rejected rather than clamped: a caller asking for 1000 rows and
      // silently receiving 200 will read the short list as "that is all there
      // is", which is the failure a diagnostics surface can least afford.
      return fail(
        422,
        "VALIDATION_FAILED",
        "limit must be an integer between 1 and 200."
      );
    }

    return {
      ...(statusParam === ""
        ? {}
        : { status: statusParam as PushMessageStatus }),
      limit
    };
  },
  authorize: {
    moduleKey: "push_delivery",
    activityCode: "diagnostics",
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    // Sequential: `tx` is ONE reserved connection, so concurrent queries on it
    // leak the connection rather than run faster.
    const summary = await summarizePushQueue(tx, tenantId);
    const messages = await listRecentPushMessages(tx, tenantId, {
      ...(prepared.status ? { status: prepared.status } : {}),
      limit: prepared.limit
    });
    const attempts = await listRecentPushAttempts(tx, tenantId, {
      limit: prepared.limit
    });
    const subscriptions = await listPushSubscriptions(tx, tenantId);

    return ok({
      summary,
      messages,
      attempts,
      subscriptions,
      configured: {
        enabled: isPushEnabled(),
        provider: isKnownPushProvider(process.env.PUSH_PROVIDER)
          ? process.env.PUSH_PROVIDER
          : null
      }
    });
  }
});
