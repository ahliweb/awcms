import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  listBots,
  registerBot
} from "../../../../../modules/telegram-engagement/application/bot-directory";
import {
  auditTelegramEngagement,
  disabledResponse,
  keysUnavailable,
  notFound,
  personOnlyRefusal,
  readIdempotencyKey,
  readValidatedBody,
  requireConditionalStepUp,
  runIdempotent
} from "../../../../../modules/telegram-engagement/application/route-support";
import { TELEGRAM_ENGAGEMENT_GUARDS } from "../../../../../modules/telegram-engagement/domain/telegram-engagement-constants";
import {
  validateRegisterBot,
  type RegisterBotInput
} from "../../../../../modules/telegram-engagement/domain/telegram-engagement-validation";
import { canUseBotAccount } from "../../../../../modules/telegram-engagement/infrastructure/channel-accounts-access";

/**
 * `GET /api/v1/telegram-engagement/bots` — the tenant's registered customer
 * bots the caller may see (channel-account assignments and business scope
 * apply). Never a token, a secret or a callback URL.
 */
export const GET = defineTenantRoute<null>({
  workClass: "interactive",
  prepare: () => disabledResponse() ?? null,
  authorize: TELEGRAM_ENGAGEMENT_GUARDS.readBots,
  handler: async (context) => {
    const bots = await listBots(context.tx, context.tenantId);
    const visible = [];

    // Sequential on one connection (never Promise.all on `tx`).
    for (const bot of bots) {
      if (
        await canUseBotAccount(
          context,
          TELEGRAM_ENGAGEMENT_GUARDS.readBots,
          bot.accountId,
          "viewer"
        )
      ) {
        visible.push(bot);
      }
    }

    return ok({ items: visible });
  }
});

/**
 * `POST /api/v1/telegram-engagement/bots` — register an existing telegram bot
 * channel account (its token already stored write-only through
 * `PUT /api/v1/channel-accounts/accounts/{id}/credential`) for a verified
 * webhook. The connector job does the provider half (getMe, setWebhook).
 * High-risk: `Idempotency-Key`, conditional step-up, audited at warning.
 */
export const POST = defineTenantRoute<{ key: string; body: RegisterBotInput }>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const key = readIdempotencyKey(request);

    if (key instanceof Response) return key;

    const body = await readValidatedBody(request, validateRegisterBot);

    return body instanceof Response ? body : { key, body };
  },
  authorize: TELEGRAM_ENGAGEMENT_GUARDS.configureBots,
  handler: async (context) => {
    const refused =
      personOnlyRefusal(context.auth) ??
      keysUnavailable() ??
      (await requireConditionalStepUp(context));

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    if (
      !(await canUseBotAccount(
        context,
        TELEGRAM_ENGAGEMENT_GUARDS.configureBots,
        prepared.body.accountId,
        "operator"
      ))
    ) {
      return notFound("Account");
    }

    return runIdempotent(
      tx,
      tenantId,
      "telegram_engagement_bot_register",
      prepared.key,
      actor,
      prepared.body,
      async () => {
        const result = await registerBot(tx, tenantId, actor, prepared.body);

        if (result.outcome === "not_found") return notFound("Account");

        if (result.outcome === "refused") {
          const messages: Record<typeof result.code, string> = {
            ACCOUNT_NOT_USABLE:
              "The account is not a usable telegram bot account (revoked, disabled or not a bot token account).",
            CREDENTIAL_MISSING:
              "Store the bot token through the channel account credential route first.",
            STAFF_BOT_REFUSED:
              "The deployment's staff alert bot cannot be registered as a customer bot.",
            ALREADY_REGISTERED:
              "This bot already has a webhook endpoint; rotate or revoke it instead."
          };

          return fail(
            result.code === "ALREADY_REGISTERED" ? 409 : 422,
            result.code,
            messages[result.code]
          );
        }

        await auditTelegramEngagement(context, {
          action: "telegram_engagement.bot.register",
          resourceType: "telegram_engagement_bot",
          resourceId: result.bot.accountId,
          severity: "warning",
          message: "Customer Telegram bot registered for a verified webhook.",
          attributes: { endpointId: result.bot.endpointId }
        });

        return { status: 201, body: { ...result.bot } };
      }
    );
  }
});
