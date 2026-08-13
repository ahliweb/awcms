import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
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
 * `POST /api/v1/access/machine-credentials` (ADR-0049) — issues a credential
 * bound to a service account, returning the plaintext token exactly once.
 *
 * ## Two classes, and a DIFFERENT permission for the second (ADR-0092)
 *
 * A request that names no `allowedWriteActions` is the read-only credential
 * ADR-0049 shipped, gated on `machine_credentials.create` exactly as before. A
 * request that names some is the write class, and it is gated on
 * `machine_credentials_write.create` instead.
 *
 * Reusing one permission for both was the obvious shape and the wrong one: it
 * would hand write-minting authority, on merge day, to everybody who already
 * holds `create` — a grant widening itself with no grant being edited. The
 * program this endpoint belongs to (#423) is built on the rule that no change
 * may leave the tree with authorization looser than it found it, and this is
 * the cheapest place that rule could have been broken.
 *
 * The split is resolved from the parsed body via `defineTenantRoute`'s callback
 * form of `authorize`, so the guard is decided BEFORE the transaction opens and
 * the body cannot pick a weaker check than the thing it asks for.
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
  authorize: ({ prepared }) => ({
    moduleKey: "identity_access",
    activityCode:
      prepared.allowedWriteActions.length > 0
        ? "machine_credentials_write"
        : "machine_credentials",
    action: "create"
  }),
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

    const writeClass = result.credential.allowedWriteActions.length > 0;

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "machine_credential.issued",
      resourceType: "machine_credential",
      resourceId: result.credential.id,
      // A credential that can CHANGE data is not the same event as one that can
      // read, and a reader filtering an audit trail by severity should not have
      // to know this endpoint has two classes to find the ones that matter.
      severity: writeClass ? "critical" : "warning",
      message: writeClass
        ? `Machine credential "${result.credential.name}" issued — WRITE class.`
        : `Machine credential "${result.credential.name}" issued.`,
      // The token is NOT here, and `allowedPermissionKeys` is: the audit trail
      // must answer "what could this thing read" without ever being able to
      // answer "what was its token". ADR-0092 adds the other two halves of the
      // same question — what it could CHANGE, and from where.
      attributes: {
        tenantUserId: result.credential.tenantUserId,
        allowedPermissionKeys: result.credential.allowedPermissionKeys,
        allowedWriteActions: result.credential.allowedWriteActions,
        allowedIpCidrs: result.credential.allowedIpCidrs,
        expiresAt: result.credential.expiresAt.toISOString()
      }
    });

    // `jsonResponse` rather than `created()`: this is the ONE response in the
    // system whose body carries a live credential, and it must never be stored
    // by anything between here and the operator. POST is not normally cached,
    // but "not normally" is not a control.
    return jsonResponse(
      {
        success: true,
        data: {
          credential: result.credential,
          // Shown once. No endpoint can return it again, by design.
          token: result.token
        },
        meta: {}
      },
      { status: 201, headers: { "cache-control": "private, no-store" } }
    );
  }
});
