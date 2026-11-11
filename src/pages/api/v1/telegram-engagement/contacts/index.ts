import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { listContacts } from "../../../../../modules/telegram-engagement/application/contact-directory";
import {
  disabledResponse,
  notFound
} from "../../../../../modules/telegram-engagement/application/route-support";
import { TELEGRAM_ENGAGEMENT_GUARDS } from "../../../../../modules/telegram-engagement/domain/telegram-engagement-constants";
import {
  validateListContactsQuery,
  type ListContactsQuery
} from "../../../../../modules/telegram-engagement/domain/telegram-engagement-validation";
import { canUseBotAccount } from "../../../../../modules/telegram-engagement/infrastructure/channel-accounts-access";

/**
 * `GET /api/v1/telegram-engagement/contacts?accountId=` — the contacts of ONE
 * bot the caller may see (channel-account assignments and business scope
 * apply; another tenant's or an invisible bot is the same `404`), newest first,
 * keyset-paginated. A masked label and states only: never a Telegram id, chat
 * id, username or message.
 */
export const GET = defineTenantRoute<ListContactsQuery>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const query = validateListContactsQuery(url.searchParams);

    return query.valid
      ? query.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, query.errors);
  },
  authorize: TELEGRAM_ENGAGEMENT_GUARDS.readContacts,
  handler: async (context) => {
    if (
      !(await canUseBotAccount(
        context,
        TELEGRAM_ENGAGEMENT_GUARDS.readContacts,
        context.prepared.accountId,
        "viewer"
      ))
    ) {
      return notFound("Bot");
    }

    const page = await listContacts(
      context.tx,
      context.tenantId,
      context.prepared
    );

    return ok(page);
  }
});
