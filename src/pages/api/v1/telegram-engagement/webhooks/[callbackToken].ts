import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../../lib/database/client";
import { handleTelegramEngagementWebhook } from "../../../../../modules/telegram-engagement/application/webhook-handler";

/**
 * `POST /api/v1/telegram-engagement/webhooks/{callbackToken}` (Issue #1156,
 * ADR-0152 section 4) — one route per customer bot, called by Telegram. The
 * bot, the tenant and the business scope come from the opaque callback token,
 * NEVER from the update body; the `X-Telegram-Bot-Api-Secret-Token` header is
 * verified in constant time before the body is read; every failure is one
 * generic `401`. The whole decision order is in `webhook-handler.ts`.
 */
export const POST: APIRoute = ({ request, params, clientAddress }) =>
  handleTelegramEngagementWebhook(
    request,
    params.callbackToken,
    clientAddress,
    {
      getSql: getDatabaseClient
    }
  );
