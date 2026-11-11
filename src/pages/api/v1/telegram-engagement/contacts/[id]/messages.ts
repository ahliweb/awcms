import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { fetchContact } from "../../../../../../modules/telegram-engagement/application/contact-directory";
import { enqueueMessage } from "../../../../../../modules/telegram-engagement/application/outbound-enqueue";
import {
  asUuid,
  auditTelegramEngagement,
  badId,
  disabledResponse,
  ENQUEUE_REFUSAL_MESSAGES,
  keysUnavailable,
  notFound,
  personOnlyRefusal,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/telegram-engagement/application/route-support";
import { resolveTelegramEngagementRing } from "../../../../../../modules/telegram-engagement/domain/telegram-engagement-config";
import { TELEGRAM_ENGAGEMENT_GUARDS } from "../../../../../../modules/telegram-engagement/domain/telegram-engagement-constants";
import {
  validateSendMessage,
  type SendMessageInput
} from "../../../../../../modules/telegram-engagement/domain/telegram-engagement-validation";
import { canUseBotAccount } from "../../../../../../modules/telegram-engagement/infrastructure/channel-accounts-access";

/**
 * `POST /api/v1/telegram-engagement/contacts/{id}/messages` — queue a reply or
 * an opted-in notice to ONE contact who started the bot. There is no way to
 * name a chat id, a handle or a phone number (T-N2): the body is `purpose` and
 * `text` only, and eligibility is checked here and again at dispatch.
 * `Idempotency-Key` required; audited (ids and the purpose, never the text).
 */
export const POST = defineTenantRoute<{ key: string; body: SendMessageInput }>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const key = readIdempotencyKey(request);

    if (key instanceof Response) return key;

    const body = await readValidatedBody(request, validateSendMessage);

    return body instanceof Response ? body : { key, body };
  },
  authorize: TELEGRAM_ENGAGEMENT_GUARDS.createMessages,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth) ?? keysUnavailable();

    if (refused) return refused;

    const ring = resolveTelegramEngagementRing();

    if (!ring.ok) return keysUnavailable()!;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth, prepared } = context;
    const contact = await fetchContact(tx, tenantId, id);

    if (
      !contact ||
      !(await canUseBotAccount(
        context,
        TELEGRAM_ENGAGEMENT_GUARDS.createMessages,
        contact.account_id,
        "operator"
      ))
    ) {
      return notFound("Contact");
    }

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "telegram_engagement_message_send",
      prepared.key,
      actor,
      { id, ...prepared.body },
      async () => {
        const result = await enqueueMessage(
          tx,
          tenantId,
          actor,
          id,
          { kind: "text", ...prepared.body },
          ring
        );

        if (result.outcome === "not_found") return notFound("Contact");

        if (result.outcome === "refused") {
          return fail(422, result.code, ENQUEUE_REFUSAL_MESSAGES[result.code]);
        }

        await auditTelegramEngagement(context, {
          action: "telegram_engagement.message.queue",
          resourceType: "telegram_engagement_message",
          resourceId: result.messageId,
          severity: "info",
          message: "Customer Telegram message queued.",
          attributes: { contactId: id, purpose: prepared.body.purpose }
        });

        return {
          status: 202,
          body: { id: result.messageId, contactId: id, status: "queued" }
        };
      }
    );
  }
});
