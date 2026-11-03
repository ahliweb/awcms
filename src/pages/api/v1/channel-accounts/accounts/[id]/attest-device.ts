import { fail } from "../../../../../../modules/_shared/api-response";
import { isStarsenderAdapterEnabled } from "../../../../../../modules/_shared/unofficial-provider-flags";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  accountNotFound,
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  loadAuthorizedAccount,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { attestDevice } from "../../../../../../modules/channel-accounts/application/risk-acknowledgement-directory";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";

type Prepared = { id: string; idempotencyKey: string };

/**
 * `POST /api/v1/channel-accounts/accounts/{id}/attest-device` (Issue #1142) —
 * the ONE place a person, not a connector, moves an account to `connected`, and
 * only for a device of an UNOFFICIAL provider (StarSender), because StarSender
 * documents no side-effect-free status call a connector could verify with. The
 * caller attests that the device is paired; the health record says
 * `OPERATOR_ATTESTED`, never "verified". It needs the caller's OWN active
 * acknowledgement of the current approved risk text, a stored credential, and a
 * `pending` or `degraded` account, and it still grants no capability: every send
 * re-checks the account, the acknowledgement and the capability evidence.
 * `accounts.create` plus operator assignment on the account; `Idempotency-Key`
 * required; audited at `warning`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    return idempotencyKey instanceof Response
      ? idempotencyKey
      : { id, idempotencyKey };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.connect,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    // After authorization (an unauthorised caller learns nothing about the
    // switch). The adapter is OFF by default: a device is not connected for a
    // provider the deployment cannot send through.
    if (!isStarsenderAdapterEnabled()) {
      return fail(
        503,
        "PROVIDER_ADAPTER_DISABLED",
        "This provider's adapter is not enabled for this deployment."
      );
    }

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
      "channel_accounts_device_attest",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id },
      async () => {
        const result = await attestDevice(tx, tenantId, actor, prepared.id);

        if (result.outcome === "not_found") return accountNotFound();

        if (result.outcome === "refused") {
          return fail(
            422,
            result.code,
            "This account cannot be attested as connected."
          );
        }

        if (result.outcome === "attested") {
          await auditChannelAccounts(context, {
            action: "channel_accounts.device.attest",
            resourceType: "channel_account",
            resourceId: prepared.id,
            severity: "warning",
            message:
              "Unofficial-provider device attested as connected by an operator (not verified by the provider).",
            attributes: { basis: "operator_attested" }
          });
        }

        return {
          status: 200,
          body: {
            accountId: prepared.id,
            status: "connected",
            basis: "operator_attested",
            changed: result.outcome === "attested"
          }
        };
      }
    );
  }
});
