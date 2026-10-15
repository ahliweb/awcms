import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { refuseNonInteractive } from "../../../../modules/telegram-delivery/application/telegram-interactive-guard";
import { createLinkCode } from "../../../../modules/telegram-delivery/application/telegram-link-codes";
import {
  isTenantGateOpen,
  readTelegramTenantGate
} from "../../../../modules/telegram-delivery/application/telegram-settings";
import {
  isTelegramEnabled,
  resolveTelegramBotUsername,
  resolveTelegramEncryptionRing,
  resolveTelegramHashRing
} from "../../../../modules/telegram-delivery/domain/telegram-config";
import { buildDeepLink } from "../../../../modules/telegram-delivery/domain/telegram-link-code";

/**
 * `POST /api/v1/telegram/links` (Issue #965, ADR-0140 section 3 step 1) — a staff
 * member requests a one-time link code for THEMSELVES. There is no body and no
 * way to name another person: the bound chat receives that person's operational
 * alerts, so the subject is always the caller.
 *
 * The code is returned ONCE, inside a `https://t.me/<bot>?start=<code>` link, and
 * the response is `no-store`. Only its SHA-256 is kept. A newer request
 * invalidates the previous code, and a per-person hourly limit applies.
 *
 * Deliberately NOT idempotency-keyed: requesting a new code invalidates the last
 * by design, so a retry mints a replacement rather than duplicating anything.
 * Refused (409) while Telegram is off at any of its three levels, and (503) when
 * the deployment cannot create a binding safely (no key ring: fail closed).
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "links",
    action: "create"
  },
  handler: async ({ tx, tenantId, auth, locals }) => {
    const refused = refuseNonInteractive(auth.context);

    if (refused) {
      return refused;
    }

    if (!isTelegramEnabled()) {
      return fail(
        409,
        "TELEGRAM_DISABLED",
        "Telegram delivery is switched off on this deployment."
      );
    }

    if (!isTenantGateOpen(await readTelegramTenantGate(tx, tenantId))) {
      return fail(
        409,
        "TELEGRAM_DISABLED",
        "Telegram delivery is switched off for this tenant."
      );
    }

    const botUsername = resolveTelegramBotUsername();

    if (
      !botUsername ||
      !resolveTelegramEncryptionRing().ok ||
      !resolveTelegramHashRing().ok
    ) {
      return fail(
        503,
        "TELEGRAM_MISCONFIGURED",
        "Telegram delivery is not fully configured on this deployment, so no chat can be linked."
      );
    }

    const result = await createLinkCode(
      tx,
      tenantId,
      auth.context.tenantUserId,
      { correlationId: locals.correlationId }
    );

    if (result.outcome === "rate_limited") {
      return fail(
        429,
        "RATE_LIMITED",
        "Too many link codes were requested. Try again later.",
        {},
        undefined,
        { "retry-after": "3600" }
      );
    }

    return ok(
      {
        link: buildDeepLink(botUsername, result.code),
        expiresAt: result.expiresAt.toISOString()
      },
      {},
      { "cache-control": "no-store" }
    );
  }
});
