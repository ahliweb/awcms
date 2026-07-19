import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import { resolveAuthInputs } from "../../../../../../../modules/identity-access/application/access-guard";
import { isMfaFeatureEnabled } from "../../../../../../../lib/auth/mfa-config";
import {
  resolveEnrollAuth,
  startTotpEnrollment
} from "../../../../../../../modules/identity-access/application/mfa";

const ENROLLMENT_TOKEN_HEADER = "x-awcms-mfa-enrollment-token";

/**
 * `POST /api/v1/auth/mfa/totp/enroll/start` (Issue #184) — generates a fresh
 * TOTP secret and stores it as a `pending` factor. Authorized by EITHER a live
 * session OR an enrollment grant (`X-AWCMS-MFA-Enrollment-Token`) issued by
 * `POST /auth/login` when a tenant policy required MFA for an identity without a
 * factor. The plaintext secret / QR URI is only ever returned here. Gated on
 * `AUTH_MFA_ENABLED`.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isMfaFeatureEnabled()) {
    return fail(
      403,
      "MFA_DISABLED",
      "Multi-factor authentication enrollment is not enabled for this deployment."
    );
  }

  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const enrollmentToken = request.headers.get(ENROLLMENT_TOKEN_HEADER);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token && !enrollmentToken)
    return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const sql = getDatabaseClient();
  const now = new Date();
  const sessionTokenHash = token ? hashSessionToken(token) : null;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await resolveEnrollAuth(
      tx,
      tenantId,
      sessionTokenHash,
      enrollmentToken,
      now
    );

    if (!auth) {
      return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
    }

    const identityRows = (await tx`
      SELECT login_identifier FROM awcms_identities WHERE id = ${auth.identityId}
    `) as { login_identifier: string }[];
    const loginIdentifier = identityRows[0]?.login_identifier ?? "user";

    const result = await startTotpEnrollment(
      tx,
      tenantId,
      auth.identityId,
      loginIdentifier,
      process.env,
      now
    );

    if (!result.ok) {
      const status = result.code === "MFA_ALREADY_ACTIVE" ? 409 : 500;

      return fail(
        status,
        result.code,
        result.code === "MFA_ALREADY_ACTIVE"
          ? "Multi-factor authentication is already active for this account."
          : "Multi-factor authentication is misconfigured on this server."
      );
    }

    return ok({ secret: result.secretBase32, otpauthUri: result.otpauthUri });
  });
};
