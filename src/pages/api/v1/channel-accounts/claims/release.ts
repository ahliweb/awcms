import { fail } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { requireStepUp } from "../../../../../modules/identity-access/application/mfa-session-assurance";
import {
  commonRefusal,
  readIdempotencyKey,
  readValidatedBody,
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
 * `{ provider, accountKind, externalId, reasonCode, ticketRef?, reason }`. It ends the account of ANOTHER tenant that
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
 * The permission requires an ENROLLED MFA factor (`requiresMfaEnrolment`) and the
 * route a fresh step-up, unconditionally (audit L3); `Idempotency-Key` is
 * required; the reason (10 to 500 characters, no email or phone) is mandatory.
 * Audited twice: `critical` in the platform tenant's trail (with the operator
 * and the free-text reason) and `warning` in the holder tenant's own trail
 * (without the operator, ADR-0091, and with only the closed reason code and the
 * ticket reference, audit M2).
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
    // UNCONDITIONAL step-up (audit L3). This is safe here, unlike on a route a
    // person without a factor may reach: the permission declares
    // `requiresMfaEnrolment`, so the chokepoint already refused every operator
    // with no active factor (`MFA_ENROLMENT_REQUIRED`) before this line.
    const stepUp = await requireStepUp(
      tx,
      tenantId,
      context.tokenHash,
      context.now
    );

    if (!stepUp.ok) return stepUp.denied;

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
            "A child account of the holder still holds a claim of its own; release that one by its own id first."
          );
        }

        return {
          status: 200,
          body: {
            released: true,
            releasedChildren: result.releasedChildren,
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
