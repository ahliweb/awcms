import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import { resolveAuthInputs } from "../../../../../../../modules/identity-access/application/access-guard";
import { isMfaFeatureEnabled } from "../../../../../../../lib/auth/mfa-config";
import {
  enrollmentBindingHash,
  resolveEnrollAuth,
  startTotpEnrollment
} from "../../../../../../../modules/identity-access/application/mfa";
import {
  reauthenticateForEnrollment,
  reauthenticateGrantForEnrollment,
  type EnrollmentReauthResult
} from "../../../../../../../modules/identity-access/application/mfa-enrollment-reauth";
import { recordAuditEvent } from "../../../../../../../modules/logging/application/audit-log";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../../lib/security/request-body-limit";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../../../../lib/security/rate-limit";
import {
  hashClientIp,
  summarizeUserAgent
} from "../../../../../../../lib/security/client-fingerprint";

const ENROLLMENT_TOKEN_HEADER = "x-awcms-mfa-enrollment-token";

const MAX_PASSWORD_LENGTH = 1024;

/**
 * `currentPassword` is a guessable secret, so a session-authenticated start is a
 * credential-guessing surface even behind a session: the case that matters is a
 * borrowed session hunting for the password it did not come with. Keyed on the
 * SOURCE, not the account, so nobody can hold one person's enrolment hostage.
 */
const RATE_LIMIT = { maxAttempts: 10, windowMs: 900_000 };

const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

function tooManyAttempts(retryAfterSec: number): Response {
  return fail(
    429,
    "RATE_LIMITED",
    "Too many attempts from this source. Try again later.",
    {},
    undefined,
    { ...NO_STORE_HEADERS, "retry-after": String(retryAfterSec) }
  );
}

function reauthFailure(
  result: Exclude<EnrollmentReauthResult, { outcome: "ok" }>
): Response {
  switch (result.outcome) {
    case "unauthenticated":
      return fail(
        401,
        "AUTH_REQUIRED",
        "Session is invalid or expired.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    case "password_required":
      return fail(
        400,
        "PASSWORD_REQUIRED",
        "currentPassword is required to start two-factor setup from a signed-in session.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    case "invalid_credentials":
      return fail(
        400,
        "INVALID_CREDENTIALS",
        "The current password is incorrect.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    case "locked":
      return fail(
        429,
        "RATE_LIMITED",
        "Too many failed attempts. Try again later.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    case "reauthentication_required":
      return fail(
        403,
        "REAUTHENTICATION_REQUIRED",
        "Re-authentication is not possible from this session. Sign in again through your identity provider, or ask an administrator if you work in more than one tenant.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
  }
}

/**
 * `POST /api/v1/auth/mfa/totp/enroll/start` (Issue #184) — generates a fresh
 * TOTP secret and stores it as a `pending` factor. Authorized by EITHER a live
 * session OR an enrollment grant (`X-AWCMS-MFA-Enrollment-Token`) issued by
 * `POST /auth/login` when a tenant policy required MFA for an identity without a
 * factor. The plaintext secret / QR URI is only ever returned here. Gated on
 * `AUTH_MFA_ENABLED`.
 *
 * ## Session-authorized start needs RE-AUTHENTICATION (#1004)
 *
 * A session alone no longer starts enrolment: the caller must present
 * `currentPassword` (or, for an SSO session, the session must have been minted
 * by the IdP within the freshness window). Otherwise a stolen session could
 * enrol the thief's authenticator on an unenrolled account and pass every
 * conditional step-up as its owner (ADR-0141 addendum).
 *
 * An enrolment GRANT keeps the exemption only when it was minted by a login that
 * just verified the password (`origin = login`: the password sign-in, or the
 * tenantless sign-in redeemed at `/auth/session/tenant`). A grant minted by
 * `POST /auth/session/switch` was reached with a bearer session alone, so it
 * re-authenticates exactly like a session (#1004 re-audit H-A). See
 * `mfa-enrollment-reauth.ts` for what this does and does not defend against.
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  locals,
  clientAddress
}) => {
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

  const clientIp = resolveClientIp(request, clientAddress);
  let currentPassword: string | null = null;

  if (token || enrollmentToken) {
    // Per HOLDER first (L2): a bucket keyed on the bearer's own hash - the
    // session token, or the enrolment grant when there is no session. The
    // per-source bucket is spent only once the credential is known to be real,
    // below, so junk tokens cannot burn a shared address's allowance.
    const sessionLimit = await checkSharedRateLimit(
      `auth-mfa-enroll-session:${
        token
          ? hashSessionToken(token)
          : enrollmentBindingHash(`grant-token:${enrollmentToken}`)
      }`,
      RATE_LIMIT
    );

    if (!sessionLimit.allowed) {
      return tooManyAttempts(sessionLimit.retryAfterSec);
    }

    // Read before the transaction opens: the body waits on the CLIENT, and a
    // reserved pool connection must not be held for as long as a caller takes.
    const body = await readJsonBody<{ currentPassword?: unknown }>(request);

    if (body.tooLarge) return bodyTooLargeResponse(body.limitBytes);

    const candidate = body.value?.currentPassword;

    if (candidate !== undefined && candidate !== null) {
      if (
        typeof candidate !== "string" ||
        candidate.length > MAX_PASSWORD_LENGTH
      ) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "currentPassword must be a string.",
          {},
          undefined,
          NO_STORE_HEADERS
        );
      }

      currentPassword = candidate.length > 0 ? candidate : null;
    }
  }

  const sql = getDatabaseClient();
  const now = new Date();
  const sessionTokenHash = token ? hashSessionToken(token) : null;
  const source = {
    ipHash: hashClientIp(clientIp),
    userAgent: summarizeUserAgent(request)
  };

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

    if (auth.requiresReauthentication) {
      // The source bucket, spent only now that the credential is valid (L2).
      const sourceLimit = await checkSharedRateLimit(
        `auth-mfa-enroll:${clientIp}`,
        RATE_LIMIT
      );

      if (!sourceLimit.allowed)
        return tooManyAttempts(sourceLimit.retryAfterSec);

      // A session re-authenticates itself; a grant minted by a tenant SWITCH
      // has no session behind it and re-authenticates by password alone.
      const reauth =
        !auth.viaEnrollment && sessionTokenHash
          ? await reauthenticateForEnrollment(
              tx,
              tenantId,
              sessionTokenHash,
              currentPassword,
              now
            )
          : await reauthenticateGrantForEnrollment(
              tx,
              tenantId,
              auth.identityId,
              currentPassword,
              now
            );

      if (reauth.outcome !== "ok") {
        // Audited from INSIDE the transaction, which commits. A session that
        // tries to start enrolment without the credential behind it is the
        // signal this control exists to produce.
        if (reauth.outcome !== "unauthenticated") {
          await recordAuditEvent(tx, {
            tenantId,
            moduleKey: "identity_access",
            action: "mfa_enroll_reauth_failed",
            resourceType: "identity",
            resourceId: auth.identityId,
            severity: "warning",
            message: `TOTP enrolment start refused: ${reauth.outcome}.`,
            attributes: { outcome: reauth.outcome, ...source },
            correlationId: locals.correlationId
          });
        }

        return reauthFailure(reauth);
      }
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
      now,
      auth.bindingHash
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
