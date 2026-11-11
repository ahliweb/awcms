import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { revokeBot } from "../../../../../../modules/telegram-engagement/application/bot-directory";
import {
  asUuid,
  auditTelegramEngagement,
  badId,
  disabledResponse,
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
 * `POST /api/v1/telegram-engagement/bots/{id}/revoke` — `{id}` is the bot's
 * channel account id. Ends the bot's webhook at once (the callback and header
 * stop working in this transaction), cancels every queued message of the bot,
 * and asks the connector job to `deleteWebhook`. Terminal for the endpoint; a
 * new registration creates a new one. The channel account itself is untouched
 * (disconnect it through `channel_accounts` to end the credential too).
 * High-risk: `Idempotency-Key`, step-up, audited at warning.
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
    // Revocation does not need the module ring: it only stamps and deletes,
    // so it works even when the keys are unavailable (fail-safe direction).
    const refused =
      personOnlyRefusal(context.auth) ??
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
      "telegram_engagement_bot_revoke",
      context.prepared,
      actor,
      { accountId },
      async () => {
        const result = await revokeBot(tx, tenantId, actor, accountId);

        if (result.outcome === "not_found") return notFound("Bot");

        await auditTelegramEngagement(context, {
          action: "telegram_engagement.bot.revoke",
          resourceType: "telegram_engagement_bot",
          resourceId: accountId,
          severity: "warning",
          message: "Customer Telegram bot webhook revoked.",
          attributes: { cancelledMessages: result.cancelledMessages }
        });

        return {
          status: 200,
          body: {
            accountId,
            revoked: true,
            cancelledMessages: result.cancelledMessages
          }
        };
      }
    );
  }
});
