import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { listBindings } from "../../../../../modules/telegram-delivery/application/telegram-bindings";
import {
  TELEGRAM_BINDING_STATUSES,
  type TelegramBindingStatus
} from "../../../../../modules/telegram-delivery/domain/telegram-constants";

/**
 * `GET /api/v1/telegram/bindings` (Issue #965) — the tenant's chat bindings, newest
 * first: which staff member, which state, when, why it ended, and a MASKED chat
 * reference. Never the ciphertext, the hash or the full chat id, and there is no
 * reveal path (ADR-0140 section 6).
 */
export const GET = defineTenantRoute<{
  status?: TelegramBindingStatus;
  limit: number;
}>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const statusParam = (url.searchParams.get("status") ?? "").trim();

    if (
      statusParam !== "" &&
      !(TELEGRAM_BINDING_STATUSES as readonly string[]).includes(statusParam)
    ) {
      return fail(
        422,
        "VALIDATION_ERROR",
        `status must be one of: ${TELEGRAM_BINDING_STATUSES.join(", ")}.`
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
      ...(statusParam === ""
        ? {}
        : { status: statusParam as TelegramBindingStatus }),
      limit
    };
  },
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "bindings",
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    const page = await listBindings(tx, tenantId, {
      ...(prepared.status ? { status: prepared.status } : {}),
      limit: prepared.limit
    });

    return ok({ bindings: page.bindings, hasMore: page.hasMore });
  }
});
