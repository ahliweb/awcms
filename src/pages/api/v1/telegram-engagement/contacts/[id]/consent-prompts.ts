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
  validateConsentPrompt,
  type ConsentPromptInput
} from "../../../../../../modules/telegram-engagement/domain/telegram-engagement-validation";
import { canUseBotAccount } from "../../../../../../modules/telegram-engagement/infrastructure/channel-accounts-access";

/**
 * `POST /api/v1/telegram-engagement/contacts/{id}/consent-prompts` — queue the
 * EXPLICIT opt-in step for `marketing` or `transactional` (ADR-0152 TG7): the
 * notice text the controller approved, its version, and two buttons. The
 * prompt is itself a `support` message inside the conversation the person
 * opened; the person's press on THIS message (checked against the queue row,
 * purpose and version) is the evidence. `/start` never grants these purposes.
 */
export const POST = defineTenantRoute<{
  key: string;
  body: ConsentPromptInput;
}>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const key = readIdempotencyKey(request);

    if (key instanceof Response) return key;

    const body = await readValidatedBody(request, validateConsentPrompt);

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
      "telegram_engagement_consent_prompt",
      prepared.key,
      actor,
      { id, ...prepared.body },
      async () => {
        const result = await enqueueMessage(
          tx,
          tenantId,
          actor,
          id,
          {
            kind: "consent_prompt",
            promptPurpose: prepared.body.purpose,
            noticeVersion: prepared.body.noticeVersion,
            noticeText: prepared.body.noticeText
          },
          ring
        );

        if (result.outcome === "not_found") return notFound("Contact");

        if (result.outcome === "refused") {
          return fail(422, result.code, ENQUEUE_REFUSAL_MESSAGES[result.code]);
        }

        await auditTelegramEngagement(context, {
          action: "telegram_engagement.consent_prompt.queue",
          resourceType: "telegram_engagement_message",
          resourceId: result.messageId,
          severity: "info",
          message: "Customer Telegram opt-in prompt queued.",
          attributes: {
            contactId: id,
            promptPurpose: prepared.body.purpose,
            noticeVersion: prepared.body.noticeVersion
          }
        });

        return {
          status: 202,
          body: { id: result.messageId, contactId: id, status: "queued" }
        };
      }
    );
  }
});
