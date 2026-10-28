import { fail } from "../../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../../modules/_shared/tenant-route";
import { unassignAccount } from "../../../../../../../modules/channel-accounts/application/account-directory";
import {
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  loadAuthorizedAccount,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../../modules/channel-accounts/domain/channel-accounts-constants";

type Prepared = { id: string; assignmentId: string; idempotencyKey: string };

/**
 * `DELETE /api/v1/channel-accounts/accounts/{id}/assignments/{assignmentId}`
 * (Issue #1140) — remove one assignee. Removing the LAST assignee returns the
 * account to tenant-wide visibility, which is intended and is why this is audited
 * at `warning` like the grant. An unknown assignment is `404`.
 */
export const DELETE = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request, params }) => {
    const id = asUuid(params.id);
    const assignmentId = asUuid(params.assignmentId);

    if (!id) return badId();
    if (!assignmentId) return badId("assignmentId");

    const idempotencyKey = readIdempotencyKey(request);

    return idempotencyKey instanceof Response
      ? idempotencyKey
      : { id, assignmentId, idempotencyKey };
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
      "channel_accounts_assignment_remove",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, assignmentId: prepared.assignmentId },
      async () => {
        const removed = await unassignAccount(
          tx,
          tenantId,
          prepared.id,
          prepared.assignmentId
        );

        if (!removed) {
          return fail(404, "RESOURCE_NOT_FOUND", "Assignment not found.");
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.assignment.remove",
          resourceType: "channel_account",
          resourceId: prepared.id,
          severity: "warning",
          message: "Channel account assignment removed.",
          attributes: { assignmentId: prepared.assignmentId }
        });

        return {
          status: 200,
          body: { assignmentId: prepared.assignmentId, removed: true }
        };
      }
    );
  }
});
