import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { refuseNonInteractive } from "../../../../../../modules/telegram-delivery/application/telegram-interactive-guard";
import { getOwnBinding } from "../../../../../../modules/telegram-delivery/application/telegram-bindings";
import {
  isTenantGateOpen,
  readTelegramTenantGate
} from "../../../../../../modules/telegram-delivery/application/telegram-settings";
import { isTelegramEnabled } from "../../../../../../modules/telegram-delivery/domain/telegram-config";

/**
 * `GET /api/v1/telegram/bindings/me` (Issue #965, ADR-0140 section 3 step 3) — the
 * caller's OWN live binding, or `null`. While it is `pending_confirmation` the
 * response carries the Telegram display name and masked username the handshake
 * captured, which is what lets the staff member answer "is this you?" in their
 * own authenticated session. Those are cleared on confirm, reject and expiry.
 *
 * `available` says whether linking is possible at all right now (the deployment
 * flag and the tenant gate), so the screen can say why a button is missing.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "links",
    action: "create"
  },
  handler: async ({ tx, tenantId, auth }) => {
    const refused = refuseNonInteractive(auth.context);

    if (refused) {
      return refused;
    }

    const binding = await getOwnBinding(
      tx,
      tenantId,
      auth.context.tenantUserId
    );
    const available =
      isTelegramEnabled() &&
      isTenantGateOpen(await readTelegramTenantGate(tx, tenantId));

    return ok({ binding, available }, {}, { "cache-control": "no-store" });
  }
});
