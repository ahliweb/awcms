import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  readInboxStatusSnapshot,
  resolveInboxStatusVisibility
} from "../../../../modules/omnichannel-inbox/application/inbox-status-progress";
import { disabledResponse } from "../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../modules/omnichannel-inbox/domain/inbox-constants";

/**
 * `GET /api/v1/omnichannel-inbox/progress` (Issue #1171, ADR-0154) — the REST
 * snapshot of the inbox's live work counts: open, pending, awaiting a reply,
 * unassigned and SLA-breached conversations, the 20 most recently changed ones
 * (id, status, when) and the cursor a stream resumes from.
 *
 * It is the page's state with no stream at all, the polling fallback, and what
 * a client re-fetches on `snapshot-required` (ADR-0154 section 1.3, R11). The
 * stream (`./progress/stream`) carries the same projection under the same
 * permission and the same visibility rule, so a frame never shows anything this
 * read would not (R6).
 *
 * Requires `omnichannel_inbox.status.read`. A caller confined to business
 * scopes sees only the conversations of the scopes they cover, exactly as in
 * the list; a switched-off inbox is `404`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  prepare: () => disabledResponse() ?? true,
  authorize: OMNICHANNEL_INBOX_GUARDS.readStatus,
  handler: async (context) => {
    const topicContext = {
      tx: context.tx,
      tenantId: context.tenantId,
      auth: context.auth,
      tokenHash: context.tokenHash,
      request: context.request,
      clientAddress: context.clientAddress,
      now: context.now
    };
    const visibility = await resolveInboxStatusVisibility(topicContext);

    if (visibility === null)
      return fail(404, "NOT_FOUND", "Resource not found.");

    return ok(await readInboxStatusSnapshot(topicContext, visibility, 20));
  }
});
