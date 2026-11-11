import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  parseSenderId,
  readSenderProgressSnapshot,
  resolveVisibleSender
} from "../../../../../../modules/whatsapp-delivery/application/whatsapp-sender-progress";

/**
 * `GET /api/v1/whatsapp/senders/{id}/progress` (Issue #1171, ADR-0154) — the
 * REST snapshot of one sender's delivery progress: counts per status, the most
 * recently changed messages (id, status, when) and the cursor to stream from.
 *
 * It is the page's state with no stream at all, the polling fallback, and what
 * a client re-fetches on `snapshot-required` (ADR-0154 section 1.3, R11). The
 * stream (`./progress/stream`) carries the same projection under the same
 * permission and the same visibility rule, so a frame never shows anything this
 * read would not (R6).
 *
 * Requires `whatsapp_delivery.progress.read`, and the sender must be an account
 * the caller may see by the rules of `channel_accounts` (assignment, business
 * scope). An unknown id, another tenant's account and a hidden account are one
 * answer: `404`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "progress",
    action: "read"
  },
  handler: async (context) => {
    const accountId = parseSenderId(context.params.id);
    const notFound = () => fail(404, "NOT_FOUND", "Resource not found.");

    if (accountId === null) return notFound();

    const topicContext = {
      tx: context.tx,
      tenantId: context.tenantId,
      auth: context.auth,
      tokenHash: context.tokenHash,
      request: context.request,
      clientAddress: context.clientAddress,
      now: context.now
    };
    const resource = await resolveVisibleSender(topicContext, accountId);

    if (resource === null) return notFound();

    return ok(await readSenderProgressSnapshot(topicContext, resource, 20));
  }
});
