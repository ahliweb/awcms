import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  contactDetail,
  fetchContact
} from "../../../../../../modules/telegram-engagement/application/contact-directory";
import {
  asUuid,
  badId,
  disabledResponse,
  notFound
} from "../../../../../../modules/telegram-engagement/application/route-support";
import { TELEGRAM_ENGAGEMENT_GUARDS } from "../../../../../../modules/telegram-engagement/domain/telegram-engagement-constants";
import { canUseBotAccount } from "../../../../../../modules/telegram-engagement/infrastructure/channel-accounts-access";

/**
 * `GET /api/v1/telegram-engagement/contacts/{id}` — one contact with its
 * per-purpose eligibility and the status of its 20 latest outbound messages.
 * Unknown, another tenant's and a contact of a bot the caller may not see are
 * ONE answer (`404`, T-I1).
 */
export const GET = defineTenantRoute<null>({
  workClass: "interactive",
  prepare: () => disabledResponse() ?? null,
  authorize: TELEGRAM_ENGAGEMENT_GUARDS.readContacts,
  handler: async (context) => {
    const id = asUuid(context.params.id);

    if (!id) return badId();

    const contact = await fetchContact(context.tx, context.tenantId, id);

    if (
      !contact ||
      !(await canUseBotAccount(
        context,
        TELEGRAM_ENGAGEMENT_GUARDS.readContacts,
        contact.account_id,
        "viewer"
      ))
    ) {
      return notFound("Contact");
    }

    return ok(await contactDetail(context.tx, context.tenantId, contact));
  }
});
