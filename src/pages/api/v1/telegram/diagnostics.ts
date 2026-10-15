import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  isTelegramMessageStatus,
  listRecentTelegramAttempts,
  listRecentTelegramMessages,
  summarizeTelegramQueue,
  TELEGRAM_MESSAGE_STATUSES
} from "../../../../modules/telegram-delivery/application/telegram-diagnostics";
import type { TelegramMessageStatus } from "../../../../modules/telegram-delivery/domain/telegram-constants";
import { describeTelegramDeployment } from "../../../../modules/telegram-delivery/domain/telegram-deployment";

/**
 * `GET /api/v1/telegram/diagnostics` (Issue #965) — the tenant's Telegram queue in
 * one response: counts per status, the most recent messages and delivery
 * attempts. No chat id, ciphertext, hash, body or variable is ever selected. One
 * transaction, so the parts share a snapshot.
 *
 * `configured` is deployment truth, as booleans only: a queue that is filling
 * while the dispatcher is a no-op looks exactly like a queue that is stuck, and
 * reporting which setting is missing is what lets the screen say so. No value
 * (token, secret, key) is returned, only whether it is present and well-formed.
 */
export const GET = defineTenantRoute<{
  status?: TelegramMessageStatus;
  limit: number;
}>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const statusParam = (url.searchParams.get("status") ?? "").trim();

    if (statusParam !== "" && !isTelegramMessageStatus(statusParam)) {
      return fail(
        422,
        "VALIDATION_ERROR",
        `status must be one of: ${TELEGRAM_MESSAGE_STATUSES.join(", ")}.`
      );
    }

    const limitParam = (url.searchParams.get("limit") ?? "").trim();
    const limit = limitParam === "" ? 50 : Number(limitParam);

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return fail(
        422,
        "VALIDATION_ERROR",
        "limit must be an integer between 1 and 200."
      );
    }

    return {
      ...(statusParam === "" ? {} : { status: statusParam }),
      limit
    };
  },
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "messages",
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    // Sequential: `tx` is ONE reserved connection.
    const summary = await summarizeTelegramQueue(tx, tenantId);
    const list = await listRecentTelegramMessages(tx, tenantId, {
      ...(prepared.status ? { status: prepared.status } : {}),
      limit: prepared.limit
    });
    const attempts = await listRecentTelegramAttempts(tx, tenantId, {
      limit: prepared.limit
    });

    return ok({
      summary,
      messages: list.messages,
      hasMoreMessages: list.hasMore,
      attempts,
      configured: describeTelegramDeployment()
    });
  }
});
