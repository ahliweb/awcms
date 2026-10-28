import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createAccount,
  listAccounts
} from "../../../../../modules/channel-accounts/application/account-directory";
import {
  auditChannelAccounts,
  canSeeAllAccounts,
  commonRefusal,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateCreateAccount,
  validateListAccountsQuery,
  type CreateAccountInput,
  type ListAccountsQuery
} from "../../../../../modules/channel-accounts/domain/channel-accounts-validation";

const SCOPE = "channel_accounts_account_create";

/**
 * `GET /api/v1/channel-accounts/accounts` (Issue #1140) — the tenant's connected
 * accounts, newest first, keyset-paginated. An account with assignees is listed
 * only to its assignees and to holders of `assignments.manage`; a response never
 * contains a credential or its reference, only `hasCredential`.
 */
export const GET = defineTenantRoute<ListAccountsQuery>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const query = validateListAccountsQuery(url.searchParams);

    return query.valid
      ? query.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, query.errors);
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.read,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const result = await listAccounts(
      context.tx,
      context.tenantId,
      {
        tenantUserId: context.auth.context.tenantUserId,
        bypass: canSeeAllAccounts(context)
      },
      context.prepared
    );

    if (!result.ok) {
      return fail(400, "VALIDATION_ERROR", "cursor is invalid.");
    }

    return ok({ items: result.items, nextCursor: result.nextCursor });
  }
});

type Prepared = { idempotencyKey: string; input: CreateAccountInput };

/**
 * `POST /api/v1/channel-accounts/accounts` (Issue #1140) — register an external
 * account. `(provider, accountKind, authMode)` must be a combination the provider
 * matrix admits. A live external account belongs to ONE tenant: a duplicate is
 * `409 ACCOUNT_ALREADY_REGISTERED` whether this tenant or another holds it (one
 * answer, so the conflict is not an oracle). The account starts `pending`; it
 * becomes `connected` only when a connector verifies it. No credential is
 * accepted here: that is `PUT /accounts/{id}/credential`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateCreateAccount);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.connect,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        const result = await createAccount(tx, tenantId, actor, prepared.input);

        if (result.outcome === "refused") {
          return fail(
            result.code === "ACCOUNT_ALREADY_REGISTERED" ? 409 : 422,
            result.code,
            result.code === "ACCOUNT_ALREADY_REGISTERED"
              ? "This external account is already registered."
              : "The account cannot be registered as requested."
          );
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.account.create",
          resourceType: "channel_account",
          resourceId: result.account.id,
          severity: "info",
          message: "Channel account registered.",
          attributes: {
            provider: result.account.provider,
            accountKind: result.account.accountKind,
            authMode: result.account.authMode,
            scoped: result.account.businessScope !== null
          }
        });

        return { status: 201, body: result.account };
      }
    );
  }
});
