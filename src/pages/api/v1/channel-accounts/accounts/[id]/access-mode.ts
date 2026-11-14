import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { setAccountAccessMode } from "../../../../../../modules/channel-accounts/application/account-directory";
import {
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  loadAuthorizedAccount,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateAccessMode,
  type AccessModeInput
} from "../../../../../../modules/channel-accounts/domain/channel-accounts-validation";

type Prepared = {
  id: string;
  idempotencyKey: string;
  input: AccessModeInput;
};

/**
 * `PUT /api/v1/channel-accounts/accounts/{id}/access-mode` (Issue #1215 M-c) —
 * choose who may see and operate the account: `assigned` (the default: its
 * assignees and the holders of `assignments.assign`) or `tenant_wide` (the
 * permission alone decides). Switching to `assigned` needs an owner to exist
 * (`422 OWNER_REQUIRED`). Opening an account to the whole tenant is a deliberate
 * act of the tenant administrator, so it needs `assignments.assign` and is
 * audited at `warning`. Idempotent: the same mode again changes nothing.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateAccessMode);

    return input instanceof Response ? input : { id, idempotencyKey, input };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.manageAssignments,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const loaded = await loadAuthorizedAccount(
      context,
      prepared.id,
      CHANNEL_ACCOUNTS_GUARDS.manageAssignments
    );

    if ("denied" in loaded) return loaded.denied;

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_access_mode_set",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, input: prepared.input },
      async () => {
        const result = await setAccountAccessMode(
          tx,
          tenantId,
          actor,
          prepared.id,
          prepared.input
        );

        if (result.outcome === "refused") {
          return result.code === "NOT_FOUND"
            ? fail(404, "RESOURCE_NOT_FOUND", "Account not found.")
            : fail(
                422,
                "OWNER_REQUIRED",
                "Make a person an owner of the account before restricting it to its assignees."
              );
        }

        if (result.changed) {
          await auditChannelAccounts(context, {
            action: "channel_accounts.account.access_mode_set",
            resourceType: "channel_account",
            resourceId: prepared.id,
            severity: "warning",
            message: "Channel account access mode set.",
            attributes: { accessMode: result.accessMode }
          });
        }

        return {
          status: 200,
          body: { accountId: prepared.id, accessMode: result.accessMode }
        };
      }
    );
  }
});
