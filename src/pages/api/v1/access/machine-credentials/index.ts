import { created, fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  issueMachineCredential,
  listMachineCredentials
} from "../../../../../modules/identity-access/application/machine-credential-directory";
import {
  validateIssueMachineCredentialInput,
  type IssueMachineCredentialInput
} from "../../../../../modules/identity-access/domain/machine-credential";

/**
 * `GET /api/v1/access/machine-credentials` — every credential this tenant has
 * ever issued, newest first, with derived `active`/`expired`/`revoked` status
 * and `lastUsedAt`. Never any secret material: an operator hunting a leak needs
 * to know WHICH credential is still alive and whether anything still uses it,
 * and none of that requires the token.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "identity_access",
    activityCode: "machine_credentials",
    action: "read"
  },
  handler: async ({ tx, tenantId, now }) => {
    return ok({ items: await listMachineCredentials(tx, tenantId, now) });
  }
});

/**
 * `POST /api/v1/access/machine-credentials` (ADR-0049) — issues a READ-ONLY
 * credential bound to a service account, returning the plaintext token exactly
 * once.
 *
 * ## Deliberately NOT idempotency-keyed
 *
 * Every other high-risk mutation here takes an `Idempotency-Key` and replays
 * the stored response. Replaying THIS one would mean persisting the plaintext
 * token in `awcms_idempotency_keys` so it could be handed out again — a secret
 * stored in a table designed for request bookkeeping, readable by anything that
 * can read that table, for the sake of a retry. A duplicate submit instead
 * mints a second credential, which is visible in the list above and revocable
 * in one call. That is the cheaper failure.
 */
export const POST = defineTenantRoute<IssueMachineCredentialInput>({
  workClass: "interactive",
  prepare: async ({ request, now }) => {
    const body = await readJsonBody(request);

    if (body.tooLarge) return bodyTooLargeResponse(body.limitBytes);

    const validation = validateIssueMachineCredentialInput(body.value, now);

    if (!validation.valid) {
      return fail(
        422,
        "VALIDATION_FAILED",
        "Machine credential request is invalid.",
        {},
        validation.errors
      );
    }

    return validation.value;
  },
  authorize: {
    moduleKey: "identity_access",
    activityCode: "machine_credentials",
    action: "create"
  },
  handler: async ({ tx, tenantId, auth, prepared, now }) => {
    const result = await issueMachineCredential(
      tx,
      tenantId,
      auth.context.tenantUserId,
      prepared,
      now
    );

    if (result.outcome === "tenant_user_not_found") {
      return fail(
        404,
        "TENANT_USER_NOT_FOUND",
        "No such tenant user in this tenant."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "machine_credential.issued",
      resourceType: "machine_credential",
      resourceId: result.credential.id,
      severity: "warning",
      message: `Machine credential "${result.credential.name}" issued.`,
      // The token is NOT here, and `allowedPermissionKeys` is: the audit trail
      // must answer "what could this thing read" without ever being able to
      // answer "what was its token".
      attributes: {
        tenantUserId: result.credential.tenantUserId,
        allowedPermissionKeys: result.credential.allowedPermissionKeys,
        expiresAt: result.credential.expiresAt.toISOString()
      }
    });

    return created({
      credential: result.credential,
      // Shown once. There is no endpoint that can return it again, by design.
      token: result.token
    });
  }
});
