import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { rotateBot } from "../../../../../../modules/telegram-engagement/application/bot-directory";
import {
  asUuid,
  auditTelegramEngagement,
  badId,
  disabledResponse,
  keysUnavailable,
  notFound,
  personOnlyRefusal,
  readIdempotencyKey,
  readValidatedBody,
  requireConditionalStepUp,
  runIdempotent
} from "../../../../../../modules/telegram-engagement/application/route-support";
import { TELEGRAM_ENGAGEMENT_GUARDS } from "../../../../../../modules/telegram-engagement/domain/telegram-engagement-constants";
import { validateEmptyBody } from "../../../../../../modules/telegram-engagement/domain/telegram-engagement-validation";
import { canUseBotAccount } from "../../../../../../modules/telegram-engagement/infrastructure/channel-accounts-access";

/**
 * `POST /api/v1/telegram-engagement/bots/{id}/rotate` — `{id}` is the bot's
 * channel account id. Replaces the webhook seed: the live endpoint is revoked
 * (its callback URL and secret-token header stop working in this transaction,
 * a hard cut, ADR-0152 O8) and a new `pending` one is created; the connector
 * job registers it with Telegram. Use after a BotFather token rotation (store
 * the new token through the channel-accounts credential route first) or a
 * suspected leak. High-risk: `Idempotency-Key`, step-up, audited at warning.
 */
export const POST = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const key = readIdempotencyKey(request);

    if (key instanceof Response) return key;

    const body = await readValidatedBody(request, validateEmptyBody);

    return body instanceof Response ? body : key;
  },
  authorize: TELEGRAM_ENGAGEMENT_GUARDS.configureBots,
  handler: async (context) => {
    const refused =
      personOnlyRefusal(context.auth) ??
      keysUnavailable() ??
      (await requireConditionalStepUp(context));

    if (refused) return refused;

    const accountId = asUuid(context.params.id);

    if (!accountId) return badId();

    if (
      !(await canUseBotAccount(
        context,
        TELEGRAM_ENGAGEMENT_GUARDS.configureBots,
        accountId,
        "operator"
      ))
    ) {
      return notFound("Bot");
    }

    const { tx, tenantId, auth } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "telegram_engagement_bot_rotate",
      context.prepared,
      actor,
      { accountId },
      async () => {
        const result = await rotateBot(tx, tenantId, actor, accountId);

        if (result.outcome === "not_found") return notFound("Bot");

        if (result.outcome === "refused") {
          return fail(
            422,
            result.code,
            "This bot cannot be rotated: " +
              (result.code === "STAFF_BOT_REFUSED"
                ? "it is the deployment's staff alert bot."
                : result.code === "CREDENTIAL_MISSING"
                  ? "store the bot token through the channel account credential route first."
                  : "its channel account is revoked, disabled or not a bot token account.")
          );
        }

        await auditTelegramEngagement(context, {
          action: "telegram_engagement.bot.rotate",
          resourceType: "telegram_engagement_bot",
          resourceId: accountId,
          severity: "warning",
          message:
            "Customer Telegram bot webhook secret rotated; the previous callback and header stopped working.",
          attributes: { endpointId: result.bot.endpointId }
        });

        return { status: 200, body: { ...result.bot } };
      }
    );
  }
});
