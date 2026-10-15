import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { resolveAuthInputs } from "../../../../modules/identity-access/application/access-guard";
import {
  fetchGrantedPermissionKeys,
  resolveTenantContext
} from "../../../../modules/identity-access/application/auth-context";
import { recordDecisionLog } from "../../../../modules/identity-access/application/decision-log";
import { loadActivePolicies } from "../../../../modules/identity-access/application/policy-cache";
import {
  evaluateAccess,
  permissionKey,
  type AccessRequest
} from "../../../../modules/identity-access/domain/access-control";
import { MFA_ENROLMENT_REQUIRED_POLICY } from "../../../../modules/identity-access/domain/mfa-enrolment-refusal";
import { checkMfaEnrolmentRequirement } from "../../../../modules/identity-access/application/mfa-enrolment-gate";

type EvaluateBody = Partial<AccessRequest>;

/**
 * `POST /api/v1/access/evaluate` (Issue #179) — reflect what `evaluateAccess`
 * would decide for the CALLER'S OWN access on a hypothetical request, against
 * the tenant's CURRENT active ABAC policies. Requires a valid session but no
 * specific permission (it reveals only the caller's own access). The decision
 * is recorded to the decision log, exactly as the real guard would.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody<EvaluateBody>(request);
  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;

  if (
    !body ||
    typeof body.moduleKey !== "string" ||
    typeof body.activityCode !== "string" ||
    typeof body.action !== "string"
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "moduleKey, activityCode, and action are required."
    );
  }

  const accessRequest: AccessRequest = {
    moduleKey: body.moduleKey,
    activityCode: body.activityCode,
    action: body.action as AccessRequest["action"],
    resourceType: body.resourceType,
    resourceId: body.resourceId,
    resourceAttributes: body.resourceAttributes
  };

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const context = await resolveTenantContext(tx, tenantId, tokenHash, now);

    if (!context) {
      return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
    }

    const grantedPermissionKeys = await fetchGrantedPermissionKeys(
      tx,
      tenantId,
      context.tenantUserId
    );

    // Issue #179 — reflect the tenant's active ABAC policies so this endpoint
    // returns the SAME decision the real guard would. `ipTrusted` defaults to
    // false (fail-closed), consistent with `authorizeInTransaction`.
    const policies = await loadActivePolicies(tx, tenantId);
    const decision = evaluateAccess(
      context,
      accessRequest,
      grantedPermissionKeys,
      undefined,
      { policies, env: { now, ipTrusted: false } }
    );

    // ADR-0141 — "what the real guard would decide" includes the enrolment
    // requirement, applied to the CALLER'S OWN enrolment (this endpoint never
    // evaluates anyone else). Without it a flagged permission reads `allowed:
    // true` here while the endpoint behind it refuses, which is a preview that
    // lies in the direction that wastes an administrator's afternoon. Session
    // only: `resolveTenantContext` finds no machine credential.
    const mfaRefusal = decision.allowed
      ? await checkMfaEnrolmentRequirement(
          tx,
          tenantId,
          context,
          permissionKey(
            accessRequest.moduleKey,
            accessRequest.activityCode,
            accessRequest.action
          ),
          { viaMachineCredential: false }
        )
      : null;

    const reported = mfaRefusal
      ? {
          allowed: false,
          reason: mfaRefusal.message,
          matchedPolicy: MFA_ENROLMENT_REQUIRED_POLICY,
          matchedPolicyVersion: undefined
        }
      : decision;

    await recordDecisionLog(
      tx,
      tenantId,
      context.tenantUserId,
      accessRequest,
      reported
    );

    return ok({
      allowed: reported.allowed,
      reason: reported.reason,
      matchedPolicy: reported.matchedPolicy,
      matchedPolicyVersion: reported.matchedPolicyVersion
    });
  });
};
