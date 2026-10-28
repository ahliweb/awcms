import { fail } from "../../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../../modules/_shared/tenant-route";
import { setAccountCapability } from "../../../../../../../modules/channel-accounts/application/capability-directory";
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
} from "../../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  isCapability,
  validateSetCapability,
  type SetCapabilityInput
} from "../../../../../../../modules/channel-accounts/domain/channel-accounts-validation";
import type { ChannelCapability } from "../../../../../../../modules/channel-accounts/domain/provider-matrix";

type Prepared = {
  id: string;
  capability: ChannelCapability;
  idempotencyKey: string;
  input: SetCapabilityInput;
};

/**
 * `PUT /api/v1/channel-accounts/accounts/{id}/capabilities/{capability}`
 * (Issue #1140, ADR-0148 I2) — record or withdraw one capability with its
 * evidence (a scope-list hash, an app-review reference, a contract reference or
 * a written authorisation). Refused at write time when the provider matrix can
 * never allow the cell (`not_offered`, `unverified`, `barred`), and a
 * `restricted` cell needs a contract or written-authorisation evidence kind.
 * Granting does NOT make the capability usable by itself: every use is
 * re-evaluated against the matrix, the evidence, the account status and its
 * connection's grant. High-risk: audited at `warning`.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    if (!isCapability(params.capability)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "capability is not a known capability."
      );
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateSetCapability);

    return input instanceof Response
      ? input
      : { id, capability: params.capability, idempotencyKey, input };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.grantCapability,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const loaded = await loadAuthorizedAccount(
      context,
      prepared.id,
      CHANNEL_ACCOUNTS_GUARDS.grantCapability,
      "owner"
    );

    if ("denied" in loaded) return loaded.denied;

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_capability_set",
      prepared.idempotencyKey,
      actor,
      {
        id: prepared.id,
        capability: prepared.capability,
        input: prepared.input
      },
      async () => {
        const result = await setAccountCapability(
          tx,
          tenantId,
          actor,
          prepared.id,
          prepared.capability,
          prepared.input
        );

        if (result.outcome === "not_found") return accountNotFound();
        if (result.outcome === "refused") {
          return fail(
            422,
            result.code,
            "This capability cannot be recorded for this account."
          );
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.capability.set",
          resourceType: "channel_account",
          resourceId: prepared.id,
          severity: "warning",
          message: "Channel account capability recorded.",
          attributes: {
            capability: prepared.capability,
            state: prepared.input.state,
            evidenceKind: prepared.input.evidenceKind
          }
        });

        return { status: 200, body: result.capability };
      }
    );
  }
});
