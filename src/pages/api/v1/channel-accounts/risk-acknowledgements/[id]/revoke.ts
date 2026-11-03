import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { revokeRiskAcknowledgement } from "../../../../../../modules/channel-accounts/application/risk-acknowledgement-directory";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";

type Prepared = { id: string; idempotencyKey: string };

/**
 * `POST /api/v1/channel-accounts/risk-acknowledgements/{id}/revoke` (Issue
 * #1142) — withdraws an acknowledgement. It is a stamp, not a deletion: the
 * record of who accepted what, and when it was withdrawn, stays. When it removes
 * the tenant's LAST active acknowledgement of the provider, the tenant's
 * `connected` accounts of that provider become `degraded` in the same
 * transaction, and the next send decision denies them regardless. High-risk
 * (`risk_acknowledgements.revoke`): audited at `warning`, `Idempotency-Key`
 * required. An unknown id and another tenant's id are one `404`.
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
  authorize: CHANNEL_ACCOUNTS_GUARDS.revokeRiskAcknowledgement,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_risk_acknowledgement_revoke",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id },
      async () => {
        const result = await revokeRiskAcknowledgement(
          tx,
          tenantId,
          actor,
          prepared.id
        );

        if (result.outcome === "not_found") {
          return fail(404, "RESOURCE_NOT_FOUND", "Acknowledgement not found.");
        }

        if (result.outcome === "already_revoked") {
          return {
            status: 200,
            body: {
              acknowledgement: result.acknowledgement,
              degradedAccounts: 0
            }
          };
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.risk_acknowledgement.revoke",
          resourceType: "channel_risk_acknowledgement",
          resourceId: prepared.id,
          severity: "warning",
          message: "Provider risk acknowledgement revoked.",
          attributes: {
            provider: result.acknowledgement.provider,
            textVersion: result.acknowledgement.textVersion,
            degradedAccounts: result.degradedAccounts
          }
        });

        return {
          status: 200,
          body: {
            acknowledgement: result.acknowledgement,
            degradedAccounts: result.degradedAccounts
          }
        };
      }
    );
  }
});
