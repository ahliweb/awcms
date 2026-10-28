import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  deleteAccount,
  toPublicAccount,
  updateAccount
} from "../../../../../../modules/channel-accounts/application/account-directory";
import {
  accountNotFound,
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  loadAuthorizedAccount,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { defaultSecretStore } from "../../../../../../modules/channel-accounts/application/secret-store";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateUpdateAccount,
  type UpdateAccountInput
} from "../../../../../../modules/channel-accounts/domain/channel-accounts-validation";

/**
 * `GET /api/v1/channel-accounts/accounts/{id}` (Issue #1140) — one account. An
 * unknown id, another tenant's id and an account the caller is not assigned to
 * all answer the same 404 (no enumeration, no IDOR oracle).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CHANNEL_ACCOUNTS_GUARDS.read,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const loaded = await loadAuthorizedAccount(
      context,
      id,
      CHANNEL_ACCOUNTS_GUARDS.read
    );

    if ("denied" in loaded) return loaded.denied;

    return ok(toPublicAccount(loaded.account));
  }
});

type PatchPrepared = {
  id: string;
  idempotencyKey: string;
  input: UpdateAccountInput;
};

/**
 * `PATCH /api/v1/channel-accounts/accounts/{id}` (Issue #1140) — rename an
 * account, or `disabled` / re-enable it (`pending`: a re-enabled account stays
 * `pending` until a connector verifies it again, so enabling never skips the
 * check that it still works). `connected` and `degraded` cannot be set by a
 * person; `revoked` and `deleted` have their own endpoints.
 */
export const PATCH = defineTenantRoute<PatchPrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateUpdateAccount);

    return input instanceof Response ? input : { id, idempotencyKey, input };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.connect,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const loaded = await loadAuthorizedAccount(
      context,
      prepared.id,
      CHANNEL_ACCOUNTS_GUARDS.connect,
      "operator"
    );

    if ("denied" in loaded) return loaded.denied;

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_account_update",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, input: prepared.input },
      async () => {
        const result = await updateAccount(
          tx,
          tenantId,
          actor,
          prepared.id,
          prepared.input
        );

        if (result.outcome === "not_found") return accountNotFound();
        if (result.outcome === "refused") {
          return fail(
            409,
            result.code,
            "The account is not in a state that allows this change."
          );
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.account.update",
          resourceType: "channel_account",
          resourceId: prepared.id,
          severity: prepared.input.status === "disabled" ? "warning" : "info",
          message: "Channel account updated.",
          attributes: {
            renamed: prepared.input.displayName !== null,
            status: result.account.status
          }
        });

        return { status: 200, body: result.account };
      }
    );
  }
});

type DeletePrepared = { id: string; idempotencyKey: string };

/**
 * `DELETE /api/v1/channel-accounts/accounts/{id}` (Issue #1140) — soft delete.
 * Refused while the account is `connected` or `degraded` (disconnect it first)
 * and while it still has child accounts. Erases the account's stored credential
 * and releases its external id for re-registration. High-risk: audited at
 * `warning`. Terminal: a deleted account is not restored (the database refuses).
 */
export const DELETE = defineTenantRoute<DeletePrepared>({
  workClass: "interactive",
  prepare: ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    return idempotencyKey instanceof Response
      ? idempotencyKey
      : { id, idempotencyKey };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.disconnect,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const loaded = await loadAuthorizedAccount(
      context,
      prepared.id,
      CHANNEL_ACCOUNTS_GUARDS.disconnect,
      "owner"
    );

    if ("denied" in loaded) return loaded.denied;

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_account_delete",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id },
      async () => {
        const result = await deleteAccount(
          tx,
          defaultSecretStore,
          tenantId,
          actor,
          prepared.id
        );

        if (result.outcome === "not_found") return accountNotFound();
        if (result.outcome === "refused") {
          return fail(
            409,
            result.code,
            "The account cannot be deleted in its current state."
          );
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.account.delete",
          resourceType: "channel_account",
          resourceId: prepared.id,
          severity: "warning",
          message: "Channel account deleted; stored credential erased."
        });

        return { status: 200, body: { id: prepared.id, deleted: true } };
      }
    );
  }
});
