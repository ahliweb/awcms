import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  endContact,
  fetchContact
} from "../../../../../../modules/telegram-engagement/application/contact-directory";
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
 * `POST /api/v1/telegram-engagement/contacts/{id}/erase` — the controller ends a
 * contact (a data-subject request, per tenant and per account, ADR-0094; or a
 * controller decision). Every purpose is withdrawn and queued messages are
 * cancelled; the chat ciphertext, the masked label and the keyed hash are
 * erased in ONE statement, so the row can no longer be found from the person's
 * Telegram id and a returning person starts an unrelated contact. Consent
 * evidence is kept for its proof window (ADR-0152 section 6.4). Terminal.
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
  authorize: TELEGRAM_ENGAGEMENT_GUARDS.deleteContacts,
  handler: async (context) => {
    const refused =
      personOnlyRefusal(context.auth) ??
      (await requireConditionalStepUp(context));

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth } = context;
    const contact = await fetchContact(tx, tenantId, id);

    if (
      !contact ||
      !(await canUseBotAccount(
        context,
        TELEGRAM_ENGAGEMENT_GUARDS.deleteContacts,
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
      "telegram_engagement_contact_erase",
      context.prepared,
      actor,
      { id },
      async () => {
        const result = await endContact(
          tx,
          tenantId,
          id,
          actor,
          context.locals.correlationId ?? null
        );

        if (result.outcome === "not_found") return notFound("Contact");

        if (result.outcome === "already_ended") {
          return {
            status: 200,
            body: { id, state: "ended", alreadyEnded: true }
          };
        }

        await auditTelegramEngagement(context, {
          action: "telegram_engagement.contact.erase",
          resourceType: "telegram_engagement_contact",
          resourceId: id,
          severity: "warning",
          message:
            "Customer Telegram contact ended: chat id, label and key erased, every purpose withdrawn.",
          attributes: {
            withdrawnPurposes: result.withdrawn,
            cancelledMessages: result.cancelled
          }
        });

        return {
          status: 200,
          body: {
            id,
            state: "ended",
            alreadyEnded: false,
            withdrawnPurposes: result.withdrawn,
            cancelledMessages: result.cancelled
          }
        };
      }
    );
  }
});
