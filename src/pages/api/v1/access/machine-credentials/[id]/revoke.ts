import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { revokeMachineCredential } from "../../../../../../modules/identity-access/application/machine-credential-directory";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/v1/access/machine-credentials/{id}/revoke` (ADR-0049 §5) — kills a
 * credential. Effective on its very next request, because authentication reads
 * the same row: this is the property an opaque hashed token buys that a signed
 * JWT cannot, and the reason revocation is a separate permission from issuance
 * (during an incident you want people who can stop a leak without being able to
 * create one).
 *
 * Re-revoking is a `409`, not a silent success: an operator who is told "done"
 * twice cannot tell whether the second call did anything, and during an
 * incident that ambiguity is the expensive kind.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "identity_access",
    activityCode: "machine_credentials",
    action: "revoke"
  },
  handler: async ({ tx, tenantId, params, auth, now }) => {
    const credentialId = params.id ?? "";

    if (!UUID_PATTERN.test(credentialId)) {
      return fail(404, "NOT_FOUND", "No such machine credential.");
    }

    const result = await revokeMachineCredential(
      tx,
      tenantId,
      credentialId,
      auth.context.tenantUserId,
      now
    );

    if (result.outcome === "not_found") {
      return fail(404, "NOT_FOUND", "No such machine credential.");
    }

    if (result.outcome === "already_revoked") {
      return fail(
        409,
        "ALREADY_REVOKED",
        "This machine credential is already revoked."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "machine_credential.revoked",
      resourceType: "machine_credential",
      resourceId: result.credential.id,
      severity: "warning",
      message: `Machine credential "${result.credential.name}" revoked.`,
      attributes: { tenantUserId: result.credential.tenantUserId }
    });

    return ok({ credential: result.credential });
  }
});
