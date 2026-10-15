import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  readIdempotencyKey,
  refuseMachineCredential,
  runTelegramIdempotent,
  TELEGRAM_SETTINGS_IDEMPOTENCY_SCOPE
} from "../../../../modules/telegram-delivery/application/telegram-idempotency";
import {
  getTelegramSettings,
  readTelegramTenantGate,
  setTelegramEnabled
} from "../../../../modules/telegram-delivery/application/telegram-settings";
import { isTelegramEnabled } from "../../../../modules/telegram-delivery/domain/telegram-config";

/**
 * `GET /api/v1/telegram/settings` (Issue #965, ADR-0140 section 2) — the tenant's
 * switch and the two gates around it, so the screen can say WHY nothing is being
 * sent: the deployment flag (level 1), Module Management and the tenant setting
 * (level 2). Read with `messages.read`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "messages",
    action: "read"
  },
  handler: async ({ tx, tenantId }) => {
    const settings = await getTelegramSettings(tx, tenantId);
    const gate = await readTelegramTenantGate(tx, tenantId);

    return ok({
      enabled: settings.enabled,
      updatedAt: settings.updatedAt,
      moduleEnabled: gate.moduleEnabled,
      deploymentEnabled: isTelegramEnabled()
    });
  }
});

/**
 * `PUT /api/v1/telegram/settings` (Issue #965, ADR-0140 section 2) — turn Telegram
 * on or off for this tenant. High-risk (`configure`) and audited at `warning`.
 * Turning it OFF ends every binding in the same transaction (the stored chat ids
 * are erased and the queue cancelled), so a tenant that switches the channel off
 * is not left holding encrypted chat ids for it.
 *
 * `Idempotency-Key` REQUIRED (Issue #1008, L12): it SETS a value, so repeating it
 * changes nothing and writes no second audit row, but the ANSWER of a retry
 * (`changed`, `revokedBindings`) differed from the first; with a key the retry
 * replays the stored response. A machine credential is refused (the key is filed
 * per acting person, ADR-0145). The body is validated AFTER authorization so an
 * unauthorised token learns nothing about the schema, and strictly: an unknown
 * key is a 400.
 */
export const PUT = defineTenantRoute<{ payload: unknown }>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const read = await readJsonBody(request);

    if (read.tooLarge) {
      return bodyTooLargeResponse(read.limitBytes);
    }

    if (read.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    return { payload: read.value };
  },
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "settings",
    action: "configure"
  },
  handler: async ({ tx, tenantId, auth, prepared, locals, request }) => {
    const refused = refuseMachineCredential(auth.context);

    if (refused) {
      return refused;
    }

    const payload = prepared.payload;

    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      Object.keys(payload).some((key) => key !== "enabled") ||
      typeof (payload as { enabled?: unknown }).enabled !== "boolean"
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Request body must be an object with a boolean `enabled` and nothing else."
      );
    }

    const enabled = (payload as { enabled: boolean }).enabled;
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    return runTelegramIdempotent(
      tx,
      tenantId,
      TELEGRAM_SETTINGS_IDEMPOTENCY_SCOPE,
      idempotencyKey,
      auth.context.tenantUserId,
      { enabled },
      async () => {
        const result = await setTelegramEnabled(
          tx,
          tenantId,
          enabled,
          auth.context.tenantUserId,
          { correlationId: locals.correlationId }
        );

        return {
          body: {
            enabled: result.enabled,
            changed: result.changed,
            revokedBindings: result.revokedBindings,
            cancelledMessages: result.cancelledMessages
          }
        };
      }
    );
  }
});
