import { fail } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  commonRefusal,
  readIdempotencyKey,
  readValidatedBody,
  requireConditionalStepUp,
  runIdempotent
} from "../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { releaseContestedClaim } from "../../../../../modules/channel-accounts/application/claim-release";
import { defaultSecretStore } from "../../../../../modules/channel-accounts/application/secret-store";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateReleaseClaim,
  type ReleaseClaimBodyInput
} from "../../../../../modules/channel-accounts/domain/channel-accounts-validation";

type Prepared = { idempotencyKey: string; input: ReleaseClaimBodyInput };

/**
 * `POST /api/v1/channel-accounts/claims/release` (Issue #1215, ADR-0170 option
 * C) — the PLATFORM dispute path for an external-account claim. Body:
 * `{ provider, externalId, reason }`. It ends the account of ANOTHER tenant that
 * holds the claim for that exact pair (soft delete, credential ciphertext and
 * webhook secrets erased, fixed reason `CLAIM_RELEASED_BY_PLATFORM`), so the
 * real owner can register and verify it. It does not decide who is right: the
 * operator is expected to have verified the claimant out of band.
 *
 * Authority is the PLATFORM-scoped permission
 * `channel_accounts.account_claims.revoke` (ADR-0053): the chokepoint refuses it
 * unless the acting tenant IS the platform tenant, and it is in no catalogue
 * seeded to a tenant role, so a tenant owner is refused like anyone without the
 * grant (one uniform 403 from the chokepoint). A machine credential is refused.
 * A person who has an MFA factor must present a fresh step-up; `Idempotency-Key`
 * is required; the reason (10 to 500 characters) is mandatory. Audited twice:
 * `critical` in the platform tenant's trail (with the operator) and `warning`
 * in the holder tenant's own trail (without the operator, ADR-0091).
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateReleaseClaim);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.releaseClaim,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared, locals } = context;
    const actor = auth.context.tenantUserId;
    const stepUp = await requireConditionalStepUp(context);

    if (stepUp) return stepUp;

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_claim_release",
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        const result = await releaseContestedClaim(
          tx,
          defaultSecretStore,
          {
            platformTenantId: tenantId,
            tenantUserId: actor,
            ...(locals.correlationId
              ? { correlationId: locals.correlationId as string }
              : {})
          },
          prepared.input
        );

        if (result.outcome === "not_found") {
          return fail(
            404,
            "RESOURCE_NOT_FOUND",
            "No live claim is held for that provider and external id."
          );
        }

        if (result.outcome === "refused") {
          return fail(
            409,
            result.code,
            "The holder account has live child accounts; release those first."
          );
        }

        return {
          status: 200,
          body: {
            released: true,
            holderTenantId: result.holderTenantId,
            accountId: result.accountId,
            accountKind: result.accountKind,
            credentialErased: result.credentialErased
          }
        };
      }
    );
  }
});
