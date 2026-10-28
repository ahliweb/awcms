import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { commonRefusal } from "../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  CHANNEL_CAPABILITIES,
  PROVIDER_MATRIX,
  PROVIDER_MATRIX_VERSION
} from "../../../../modules/channel-accounts/domain/provider-matrix";

/**
 * `GET /api/v1/channel-accounts/providers` (Issue #1140, ADR-0148 section 3) —
 * the provider capability matrix v1 as the code enforces it: which providers a
 * tenant can register, which account kinds and authentication modes each admits,
 * and the verdict of each capability cell. Static, tenant-independent reference
 * data (no tenant row is read); it needs `accounts.read` only so the matrix is
 * not an unauthenticated reconnaissance aid for the deployment.
 *
 * A `candidate` cell is NOT a promise that the capability works for an account:
 * the account still needs a granted capability with evidence
 * (`GET /accounts/{id}/capabilities`).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CHANNEL_ACCOUNTS_GUARDS.read,
  handler: ({ auth }) => {
    const refused = commonRefusal(auth);

    if (refused) return refused;

    return ok({
      matrixVersion: PROVIDER_MATRIX_VERSION,
      capabilities: [...CHANNEL_CAPABILITIES],
      providers: Object.entries(PROVIDER_MATRIX).map(([provider, row]) => ({
        provider,
        label: row.docLabel.replaceAll("**", ""),
        registrable: row.registrable,
        authModes: [...row.authModes],
        accountKinds: Object.entries(row.kinds).map(([kind, rule]) => ({
          kind,
          container: rule.container === true,
          parentKind: rule.parentKind ?? null
        })),
        capabilityCells: { ...row.cells }
      }))
    });
  }
});
