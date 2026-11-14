import { fail, ok } from "../../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../../modules/_shared/tenant-route";
import {
  assignAccount,
  listAssignments
} from "../../../../../../../modules/channel-accounts/application/account-directory";
import {
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  loadAuthorizedAccount,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateAssignment,
  type AssignmentInput
} from "../../../../../../../modules/channel-accounts/domain/channel-accounts-validation";

/** `GET /api/v1/channel-accounts/accounts/{id}/assignments` (Issue #1140) — who may operate this account. */
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

    return ok(await listAssignments(context.tx, context.tenantId, id));
  }
});

type Prepared = {
  id: string;
  idempotencyKey: string;
  input: AssignmentInput;
};

/**
 * `POST /api/v1/channel-accounts/accounts/{id}/assignments` (Issue #1140) —
 * make a person of this tenant an `owner`, `operator` or `viewer` of the account
 * (an upsert per person). On an `assigned` account (the default) only its
 * assignees and the holders of `assignments.assign` can see and operate it; the
 * last owner cannot be demoted (`409 LAST_OWNER`). Additive to the permission checks, never a substitute: an assignee still needs
 * the permission for each action. Audited at `warning`: it widens who can use a
 * sender identity.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateAssignment);

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
      "channel_accounts_assignment_set",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, input: prepared.input },
      async () => {
        const result = await assignAccount(
          tx,
          tenantId,
          actor,
          prepared.id,
          prepared.input
        );

        if (result.outcome === "refused") {
          return result.code === "LAST_OWNER"
            ? fail(
                409,
                "LAST_OWNER",
                "The last owner of an assigned account cannot be demoted; make another person an owner first."
              )
            : fail(422, result.code, "The person is not in this tenant.");
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.assignment.set",
          resourceType: "channel_account",
          resourceId: prepared.id,
          severity: "warning",
          message: "Channel account assignment set.",
          attributes: {
            assignmentId: result.assignment.id,
            kind: prepared.input.kind
          }
        });

        return { status: 200, body: result.assignment };
      }
    );
  }
});
