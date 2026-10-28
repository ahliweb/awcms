import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { getMfaStatus } from "../../../../../../modules/identity-access/application/mfa";
import { requireStepUp } from "../../../../../../modules/identity-access/application/mfa-session-assurance";
import { writeAccountCredential } from "../../../../../../modules/channel-accounts/application/account-directory";
import {
  accountNotFound,
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  loadAuthorizedAccount,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent,
  secretStoreUnavailable
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { defaultSecretStore } from "../../../../../../modules/channel-accounts/application/secret-store";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateWriteCredential,
  type WriteCredentialInput
} from "../../../../../../modules/channel-accounts/domain/channel-accounts-validation";

type Prepared = {
  id: string;
  idempotencyKey: string;
  input: WriteCredentialInput;
};

/**
 * `PUT /api/v1/channel-accounts/accounts/{id}/credential` (Issue #1140,
 * ADR-0148 section 5) — WRITE-ONLY. Stores or replaces the account's API token,
 * device key or bot token as envelope-encrypted ciphertext. There is no GET and
 * no "show token": the response is `{ replaced, cipherVersion }`, never the value
 * and never the reference, and neither the audit row, the stored idempotency
 * response nor any log line carries it.
 *
 * HIGH-RISK, in four layers: the permission `credentials.manage` is separately
 * grantable and declares `requiresMfaEnrolment` (a holder with no MFA factor is
 * refused at the chokepoint); a person who HAS a factor must also present a
 * fresh step-up (conditional, ADR-0141 section 4, so nobody is locked out);
 * `Idempotency-Key` is required; and the audit row is `warning`.
 *
 * The request hash that guards the idempotency key is a keyed HMAC, so the
 * credential in the body is not recoverable from the idempotency table.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const input = await readValidatedBody(request, validateWriteCredential);

    return input instanceof Response ? input : { id, idempotencyKey, input };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.manageCredentials,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const unavailable = secretStoreUnavailable();

    if (unavailable) return unavailable;

    const { tx, tenantId, auth, prepared, tokenHash, now } = context;
    const actor = auth.context.tenantUserId;
    const loaded = await loadAuthorizedAccount(
      context,
      prepared.id,
      CHANNEL_ACCOUNTS_GUARDS.manageCredentials,
      "owner"
    );

    if ("denied" in loaded) return loaded.denied;

    // Conditional step-up: only a person who has a factor is asked for a fresh
    // proof. `requiresMfaEnrolment` has already refused anyone who has none.
    const mfa = await getMfaStatus(tx, tenantId, auth.context.identityId);

    if (mfa.enabled) {
      const stepUp = await requireStepUp(tx, tenantId, tokenHash, now);

      if (!stepUp.ok) return stepUp.denied;
    }

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_credential_write",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, input: prepared.input },
      async () => {
        const result = await writeAccountCredential(
          tx,
          defaultSecretStore,
          tenantId,
          actor,
          prepared.id,
          prepared.input.secret
        );

        if (result.outcome === "not_found") return accountNotFound();
        if (result.outcome === "refused") {
          return fail(
            409,
            result.code,
            "A credential cannot be written for this account in its current state."
          );
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.credential.write",
          resourceType: "channel_account",
          resourceId: prepared.id,
          severity: "warning",
          message: "Channel account credential written (value not recorded).",
          attributes: {
            replaced: result.replaced,
            cipherVersion: result.version
          }
        });

        return {
          status: 200,
          body: { replaced: result.replaced, cipherVersion: result.version }
        };
      }
    );
  }
});
