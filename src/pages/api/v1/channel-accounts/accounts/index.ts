import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  checkRegistrationShape,
  createAccount,
  listAccounts
} from "../../../../../modules/channel-accounts/application/account-directory";
import { fetchConnection } from "../../../../../modules/channel-accounts/application/connection-directory";
import {
  auditChannelAccounts,
  authorizeConnectionBinding,
  authorizeParentBinding,
  authorizeRequestedScope,
  canSeeAllAccounts,
  commonRefusal,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent,
  scopeCoveredFor
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
        bypass: await canSeeAllAccounts(context),
        // Per-row business-scope decision through the chokepoint (review M2):
        // the list shows exactly what `GET /accounts/{id}` would.
        scopeAllowed: (scope) =>
          scopeCoveredFor(context, CHANNEL_ACCOUNTS_GUARDS.read, scope)
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
 * One spelling of a registration refusal. A connection that exists but is of
 * another provider answers exactly like one that does not exist (audit L2):
 * otherwise the pair of codes tells a caller which ids name a real connection.
 */
function refusalResponse(
  refusedCode: Extract<
    Awaited<ReturnType<typeof createAccount>>,
    { outcome: "refused" }
  >["code"],
  input: CreateAccountInput
): Response {
  const code =
    refusedCode === "CONNECTION_MISMATCH" && input.authMode === "oauth2"
      ? "CONNECTION_NOT_FOUND"
      : refusedCode;

  return fail(
    code === "ACCOUNT_ALREADY_REGISTERED" ? 409 : 422,
    code,
    code === "ACCOUNT_ALREADY_REGISTERED"
      ? "This external account is already registered."
      : "The account cannot be registered as requested."
  );
}

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

    // The scope the client names is a request, not a fact (review M3). Checked
    // before the idempotent section: a refusal is never stored for replay.
    const scopeRefusal = await authorizeRequestedScope(
      context,
      CHANNEL_ACCOUNTS_GUARDS.connect,
      context.prepared.input.businessScope
    );

    if (scopeRefusal) return scopeRefusal;

    // What can be refused without looking at the connection is refused FIRST
    // (audit L2): the answer for a malformed request must not depend on whether
    // the connection id names a real connection.
    const shape = checkRegistrationShape(context.prepared.input);

    if (!shape.ok) return refusalResponse(shape.code, context.prepared.input);

    // Binding to a connection lends the account that connection's token: an act
    // on the connection, authorised against ITS scope (audit H1), and the
    // account's scope must be contained in the connection's (#1215).
    if (context.prepared.input.connectionId) {
      const bindingRefusal = await authorizeConnectionBinding(
        context,
        CHANNEL_ACCOUNTS_GUARDS.connect,
        await fetchConnection(
          context.tx,
          context.tenantId,
          context.prepared.input.connectionId
        ),
        context.prepared.input.businessScope
      );

      if (bindingRefusal) return bindingRefusal;
    }

    // Registering under a parent account lends the child the parent's token
    // (and credit): authorised against the PARENT, with scope containment
    // (Issue #1160 audit M2), one neutral answer for every refusal.
    if (context.prepared.input.parentAccountId) {
      const parentRefusal = await authorizeParentBinding(
        context,
        CHANNEL_ACCOUNTS_GUARDS.connect,
        context.prepared.input.parentAccountId,
        context.prepared.input.businessScope
      );

      if (parentRefusal) return parentRefusal;
    }

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
          return refusalResponse(result.code, prepared.input);
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
            scoped: result.account.businessScope !== null,
            // The internal id of the connection the account borrows a token
            // from (a UUID, never an external identifier): who bound what.
            connectionId: result.account.connectionId
          }
        });

        return { status: 201, body: result.account };
      }
    );
  }
});
