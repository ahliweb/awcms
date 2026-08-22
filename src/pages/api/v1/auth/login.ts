import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import type { LoginDenyReason } from "../../../../modules/identity-access/domain/login-policy";
import { evaluateLoginAttempt } from "../../../../modules/identity-access/domain/login-policy";
import {
  resolveLoginDenyResponse,
  resolveLoginPolicyConfig,
  verifyPasswordOrDummy
} from "../../../../modules/identity-access/application/login-policy";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import { getDatabaseClient } from "../../../../lib/database/client";
import {
  withTenant,
  withTenantOrThrow
} from "../../../../lib/database/tenant-context";
import {
  generateSessionToken,
  hashSessionToken
} from "../../../../lib/auth/session-token";
import {
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME
} from "../../../../lib/auth/ssr-session";
import {
  hashClientIp,
  persistableClientIpHash,
  summarizeUserAgent
} from "../../../../lib/security/client-fingerprint";
import { resolveClientIp } from "../../../../lib/security/rate-limit";
import { checkAuthRateLimit } from "../../../../lib/security/auth-rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  enforceTurnstileIfRequired,
  LOGIN_TURNSTILE_ACTION
} from "../../../../lib/security/turnstile";
import {
  isMfaFeatureEnabled,
  resolveChallengeTtlSec
} from "../../../../lib/auth/mfa-config";
import {
  createEnrollmentGrant,
  createMfaChallenge,
  findActiveMfaFactor
} from "../../../../modules/identity-access/application/mfa";
import { getTenantMfaPolicy } from "../../../../modules/identity-access/application/tenant-mfa-policy";
import {
  isPrivilegedFromPermissionKeys,
  resolveMfaRequirement
} from "../../../../modules/identity-access/domain/mfa-policy";
import { fetchGrantedPermissionKeys } from "../../../../modules/identity-access/application/auth-context";
import { isSsoEnabled } from "../../../../lib/auth/sso-config";
import { isPasswordLoginDisabledForIdentity } from "../../../../modules/identity-access/application/tenant-auth-policy";
import {
  clearPrincipalLockout,
  findPrincipalByEmail,
  issuePrincipalSelectionToken,
  loadPrincipalSecret,
  promotePrincipalCredential,
  recordPrincipalLoginFailure
} from "../../../../modules/identity-access/application/principal-store";
import {
  generatePrincipalSelectionToken,
  hashPrincipalSelectionToken
} from "../../../../lib/auth/principal-selection-token";
import { log } from "../../../../lib/logging/logger";
import { currentCredentialEpoch } from "../../../../modules/identity-access/application/session-credential-epoch";

/**
 * ADR-0088 — the selection token's whole life, in seconds.
 *
 * Deliberately not configurable. Every other TTL here is an operator dial
 * because deployments genuinely differ; this one is a security parameter with
 * no legitimate reason to be longer, and an env var would exist only to be
 * raised. It has to outlast a human choosing from a list and nothing else.
 */
const SELECTION_TOKEN_TTL_SEC = 120;

/**
 * The per-tenant rate-limit bucket for attempts that name NO tenant.
 *
 * A literal, not a tenant id: `checkAuthRateLimit` keys its second bucket by
 * tenant, and there is no tenant here. Every tenantless attempt therefore
 * shares one bucket — see the note at the call site for why sharing is the
 * conservative direction.
 */
const TENANTLESS_RATE_LIMIT_KEY = "tenantless";

type LoginBody = {
  loginIdentifier?: unknown;
  password?: unknown;
  turnstileToken?: unknown;
};

/**
 * Issue #145 — source attribution shared by the `login_succeeded` and
 * `login_failed` audit rows below.
 *
 * `loginIdentifier` is deliberately NOT part of this: it is typically an email
 * address (PII, and one that `redactSensitiveAttributes` would *not* catch
 * under that key name), and persisting the attacker-supplied string on a
 * failed attempt is exactly the user-enumeration leak this issue asks to
 * avoid. `password` is likewise never referenced here — the only inputs that
 * reach an audit attribute are the source fingerprint and the policy's own
 * deny reason.
 */
type LoginAuditContext = {
  ipHash: string;
  userAgent?: string;
};

function buildLoginAuditContext(
  request: Request,
  clientIp: string
): LoginAuditContext {
  return {
    ipHash: hashClientIp(clientIp),
    userAgent: summarizeUserAgent(request)
  };
}

/**
 * Every `evaluateLoginAttempt` deny reason, plus `"internal_error"` for the
 * one failure the policy layer cannot describe: the login transaction threw
 * and was rolled back (see `recordLoginFailureOutOfBand`).
 */
type LoginAuditFailureReason = LoginDenyReason | "internal_error";

/**
 * Records one `login_failed` audit row.
 *
 * `reason` is the `evaluateLoginAttempt` deny reason verbatim, which is
 * already collapsed at the policy layer: an unknown `loginIdentifier`, a wrong
 * password, an inactive identity, and an inactive tenant-user all return the
 * single reason `"invalid_credentials"` (see `domain/login-policy.ts`) — so
 * the reason alone never distinguishes "this account does not exist" from
 * "this account exists and the password was wrong".
 *
 * `resourceId` IS set when the identity resolved, and that is intentional:
 * `awcms_audit_events` is tenant-scoped and RLS-protected, readable only by
 * operators who can already read `awcms_identities` directly, so it discloses
 * nothing they don't already hold — while omitting it would strip the trail of
 * the one field that answers "which account is being attacked?", defeating the
 * purpose of auditing failures at all. The enumeration guarantee is about what
 * an *unauthenticated caller* can infer, and the audit row is never part of a
 * response.
 */
async function recordLoginFailure(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    tenantExists: boolean;
    identityId?: string;
    reason: LoginAuditFailureReason;
    audit: LoginAuditContext;
    correlationId?: string;
  }
): Promise<void> {
  // `awcms_audit_events.tenant_id` is `NOT NULL REFERENCES awcms_tenants (id)`,
  // so there is no tenant-scoped audit row to write for a tenant that does not
  // exist — attempting it violates the FK, aborts the transaction, and turns
  // this endpoint's intended 403 into a 500. A well-formed but unknown tenant
  // header is reachable by any unauthenticated caller, so that would be a
  // trivial way to force 500s.
  //
  // The attempt is not lost: it goes to the structured log instead, which is
  // not tenant-scoped. Nothing tenant-scoped can be recorded here by
  // definition — there is no tenant.
  if (!input.tenantExists) {
    log("warning", "identity_access.login_failed.unknown_tenant", {
      moduleKey: "identity_access",
      reason: input.reason,
      correlationId: input.correlationId,
      ...input.audit
    });
    return;
  }

  await recordAuditEvent(tx, {
    tenantId: input.tenantId,
    moduleKey: "identity_access",
    action: "login_failed",
    resourceType: "identity",
    resourceId: input.identityId,
    severity: "warning",
    message: `Password sign-in failed: ${input.reason}.`,
    attributes: {
      method: "password",
      reason: input.reason,
      ...input.audit
    },
    correlationId: input.correlationId
  });
}

/**
 * Issue #145 — records `login_failed` in a FRESH transaction, for the case
 * where the login transaction itself threw and was rolled back, taking any
 * audit row written inside it along with it.
 *
 * Reached only on an exception, never on an ordinary authentication denial
 * (those `return` and commit with `recordLoginFailure` above), so this never
 * doubles the connection cost of a brute-force attempt against this public,
 * unauthenticated endpoint — which is exactly why the normal deny path is not
 * routed through here as well.
 *
 * Strictly best-effort: whatever unwound the login transaction was very
 * plausibly the database itself, in which case this write cannot succeed
 * either. Its own failure is swallowed and logged so it can never mask the
 * original error, which is rethrown by the caller. The raw exception is never
 * handed to `log()` — an exception message is unkeyed free text that key-based
 * redaction cannot clean.
 */
async function recordLoginFailureOutOfBand(
  sql: Bun.SQL,
  input: {
    tenantId: string;
    audit: LoginAuditContext;
    correlationId?: string;
  }
): Promise<void> {
  try {
    // `withTenantOrThrow`: this whole helper is best-effort and already
    // wrapped in the `catch` below. With `withTenant` a pool refusal would be
    // returned as a `503` and then discarded by the bare `await`, so the
    // failure audit would go unwritten with nothing logged about it.
    await withTenantOrThrow(sql, input.tenantId, async (tx) => {
      // Re-checked here rather than threaded in: this runs after the login
      // transaction unwound, so nothing it computed can be trusted to still
      // hold. Without it an unknown-tenant header would trip the audit table's
      // tenant FK and this recovery write would fail for the wrong reason.
      const rows =
        await tx`SELECT 1 FROM awcms_tenants WHERE id = ${input.tenantId}`;

      await recordLoginFailure(tx, {
        tenantId: input.tenantId,
        tenantExists: rows.length > 0,
        reason: "internal_error",
        audit: input.audit,
        correlationId: input.correlationId
      });
    });
  } catch {
    log("warning", "auth.login.audit_write_failed", {
      moduleKey: "identity_access",
      tenantId: input.tenantId,
      correlationId: input.correlationId
    });
  }
}

/**
 * Login with NO tenant header — ADR-0088. Verifies the human against the GLOBAL
 * credential and answers `409 MEMBERSHIP_SELECTION_REQUIRED` with a
 * selection token, never a session.
 *
 * ## Why it does not open a tenant transaction
 *
 * There is no tenant to open one for; that is the entire premise. Everything it
 * touches is `awcms_principals`, which is GLOBAL and RLS-free by design
 * (ADR-0085), so a plain transaction is both sufficient and honest — the same
 * shape `POST /api/v1/setup/initialize` uses for the other pre-tenant flow in
 * this repo.
 *
 * ## Why nothing here writes an audit row
 *
 * `awcms_audit_events` is tenant-scoped under FORCE RLS. An attempt that names
 * no tenant has nowhere to be audited, and inventing a tenant to file it under
 * would be a lie in the one table that must not contain any. Attempts are
 * therefore recorded in the STRUCTURED LOG, and the tenant-visible audit
 * happens where a tenant is finally named — `POST /auth/session/tenant` writes
 * `session_tenant_selected` into the tenant that was entered.
 *
 * The consequence is stated rather than hidden: a brute-force run against the
 * tenantless endpoint is visible to operators reading logs, not to a tenant
 * reading its own audit trail. What protects the account is the same GLOBAL
 * lockout counter (ADR-0086) the tenant-scoped path uses — the counter is
 * shared, so attempts here and there add up.
 */
async function handleTenantlessLogin(
  request: Request,
  clientAddress: string,
  locals: App.Locals
): Promise<Response> {
  const policy = resolveLoginPolicyConfig();
  const clientIp = resolveClientIp(request, clientAddress);

  // The per-tenant bucket has no tenant to key on, so every tenantless attempt
  // shares ONE bucket. That is deliberately stricter than the per-tenant path:
  // this endpoint answers for every human in the installation at once, so a
  // shared ceiling is the conservative choice, and the per-source bucket
  // `checkAuthRateLimit` checks first is unaffected either way.
  const rateLimit = await checkAuthRateLimit({
    clientIp,
    tenantId: TENANTLESS_RATE_LIMIT_KEY,
    scope: "login-tenantless",
    config: {
      maxAttempts: policy.rateLimitMaxAttempts,
      windowMs: policy.rateLimitWindowSec * 1000
    }
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many login attempts from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const bodyRead = await readJsonBody<LoginBody>(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const body = bodyRead.value;

  if (
    !body ||
    typeof body.loginIdentifier !== "string" ||
    typeof body.password !== "string"
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "loginIdentifier and password are required."
    );
  }

  const turnstileResult = await enforceTurnstileIfRequired(
    body.turnstileToken,
    clientIp,
    { action: LOGIN_TURNSTILE_ACTION }
  );

  if (!turnstileResult.ok) {
    return fail(
      400,
      turnstileResult.code,
      turnstileResult.code === "TURNSTILE_REQUIRED"
        ? "Turnstile verification token is required."
        : "Turnstile verification failed."
    );
  }

  const sql = getDatabaseClient();
  const now = new Date();

  /** ONE response for every failure — unknown, wrong, locked, unpromoted. */
  const denied = () => fail(401, "INVALID_CREDENTIALS", "Invalid credentials.");

  return sql.begin(async (tx) => {
    const principal = await findPrincipalByEmail(
      tx,
      body.loginIdentifier as string
    );

    // A human whose credential was never promoted (`sql/112` left it NULL until
    // the first successful login) cannot be verified here, because there is no
    // tenant identity to fall back on. Refused as "invalid credentials" rather
    // than explained: "this account has never signed in" is an enumeration
    // oracle. Recovery needs nothing new — one login WITH a tenant header
    // promotes the credential, and this path works from then on.
    const secret = principal?.hasCredential
      ? await loadPrincipalSecret(tx, principal.id)
      : null;

    // Always spend the argon2id cost, even with no principal, so an unknown
    // address is not distinguishable by response time.
    const passwordMatches = await verifyPasswordOrDummy(
      body.password as string,
      secret?.passwordHash ?? undefined
    );

    const lockedOut =
      principal?.lockedUntil !== null &&
      principal?.lockedUntil !== undefined &&
      new Date(principal.lockedUntil).getTime() > now.getTime();

    if (!principal || lockedOut || !passwordMatches) {
      if (principal && !lockedOut && !passwordMatches) {
        await recordPrincipalLoginFailure(
          tx,
          principal.id,
          policy.maxFailedAttempts,
          new Date(now.getTime() + policy.lockoutMinutes * 60_000)
        );
      }

      log("info", "auth.login.tenantless_failed", {
        moduleKey: "identity_access",
        correlationId: locals.correlationId,
        reason: !principal
          ? "unknown_principal"
          : lockedOut
            ? "locked"
            : "invalid_password"
      });

      return denied();
    }

    await clearPrincipalLockout(tx, principal.id);

    const selectionToken = generatePrincipalSelectionToken();
    const expiresAt = new Date(now.getTime() + SELECTION_TOKEN_TTL_SEC * 1000);

    await issuePrincipalSelectionToken(
      tx,
      principal.id,
      hashPrincipalSelectionToken(selectionToken),
      expiresAt
    );

    log("info", "auth.login.tenant_selection_required", {
      moduleKey: "identity_access",
      correlationId: locals.correlationId
    });

    // 409, not 401: the credential was ACCEPTED. A 401 would tell an honest
    // client to re-prompt for a password it already got right, and would be
    // indistinguishable from the failure above for anyone reading logs.
    //
    // No membership list travels with it. Reading one would need a
    // cross-tenant scan of `awcms_identities`, which FORCE RLS returns zero
    // rows for, and the global projection that would make it possible is the
    // cross-tenant membership directory ADR-0087 refused. The caller names the
    // tenant it wants.
    return fail(
      409,
      "MEMBERSHIP_SELECTION_REQUIRED",
      "Credentials accepted. Select the tenant to sign in to.",
      {},
      {
        principalToken: selectionToken,
        expiresAt: expiresAt.toISOString()
      }
    );
  }) as Promise<Response>;
}

export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  locals
}) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");

  // ADR-0088 — no tenant header is no longer a malformed request. Since the
  // credential became global (ADR-0085/0086) a password can be verified without
  // knowing which tenant the person means, so this branch verifies the human
  // and hands back a SELECTION token instead of a session. It lives in its own
  // handler because almost nothing below applies: there is no tenant to scope a
  // transaction to, no identity row to fall back on, and no MFA policy to
  // consult until a tenant is named.
  if (!tenantId) {
    return handleTenantlessLogin(request, clientAddress, locals);
  }

  const policy = resolveLoginPolicyConfig();
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = await checkAuthRateLimit({
    clientIp,
    tenantId,
    scope: "login",
    config: {
      maxAttempts: policy.rateLimitMaxAttempts,
      windowMs: policy.rateLimitWindowSec * 1000
    }
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many login attempts from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const bodyRead = await readJsonBody<LoginBody>(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const body = bodyRead.value;

  if (
    !body ||
    typeof body.loginIdentifier !== "string" ||
    typeof body.password !== "string"
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "loginIdentifier and password are required."
    );
  }

  // Issue #186 — Cloudflare Turnstile bot challenge. A no-op on every
  // local/offline/LAN deployment (isTurnstileRequired() is false there, so no
  // outbound call is made), and run here — AFTER the request-shape and
  // rate-limit checks above, BEFORE the expensive argon2id/password work and
  // any DB transaction below, and ahead of the SSO/MFA branches inside
  // `withTenant` — exactly as the issue requires. Fails closed on the
  // full-online profile: a missing/invalid/mismatched/timed-out token is denied
  // with ONE generic response (no account-enumeration oracle: this runs before
  // any identity lookup, so it cannot distinguish accounts). Rate limit and
  // lockout above/below keep working independently of this.
  const turnstileResult = await enforceTurnstileIfRequired(
    body.turnstileToken,
    clientIp,
    { action: LOGIN_TURNSTILE_ACTION }
  );

  if (!turnstileResult.ok) {
    return fail(
      400,
      turnstileResult.code,
      turnstileResult.code === "TURNSTILE_REQUIRED"
        ? "Turnstile verification token is required."
        : "Turnstile verification failed."
    );
  }

  const loginIdentifier = body.loginIdentifier;
  const password = body.password;
  const sql = getDatabaseClient();
  const now = new Date();
  const auditContext = buildLoginAuditContext(request, clientIp);

  return withTenant(sql, tenantId, async (tx) => {
    const tenantRows =
      await tx`SELECT status FROM awcms_tenants WHERE id = ${tenantId}`;
    const tenantStatus = (tenantRows[0]?.status as string | undefined) ?? null;

    const identityRows = await tx`
      SELECT id, status, password_hash
      FROM awcms_identities
      WHERE tenant_id = ${tenantId} AND login_identifier = ${loginIdentifier}
    `;
    const identityRow = identityRows[0] as
      | {
          id: string;
          status: "active" | "inactive" | "locked";
          password_hash: string;
        }
      | undefined;

    // ADR-0086 — the LOCKOUT and the CREDENTIAL live on the principal now, and
    // the principal is keyed on the normalized address with no tenant column.
    // That is the whole fix for #430: rotating `x-awcms-tenant-id` selects a
    // different identity row but the SAME principal, so the counter an attacker
    // is trying to escape does not move.
    //
    // Resolved for every attempt, including one whose identifier matches
    // nothing, so the lookup itself is not a timing oracle for "is this address
    // known to the platform".
    const principal = await findPrincipalByEmail(tx, loginIdentifier);

    // The credential to verify against: the principal's once promoted, the
    // identity's until then. `sql/112` deliberately backfilled principals with
    // a NULL hash, so this is the migration's second half arriving one login at
    // a time rather than in a window.
    const credentialHash = principal?.hasCredential
      ? ((await loadPrincipalSecret(tx, principal.id))?.passwordHash ??
        undefined)
      : identityRow?.password_hash;

    // Issue #147 — runs an argon2id verify against a dummy hash when the
    // identifier resolved to nothing, so an unknown identifier costs the same
    // as a known one (see `verifyPasswordOrDummy`).
    const passwordMatches = await verifyPasswordOrDummy(
      password,
      credentialHash
    );

    let tenantUserStatus: "active" | "inactive" | null = null;
    let tenantUserId: string | null = null;

    if (identityRow) {
      const tenantUserRows = await tx`
        SELECT id, status FROM awcms_tenant_users
        WHERE tenant_id = ${tenantId} AND identity_id = ${identityRow.id}
      `;
      const tenantUserRow = tenantUserRows[0] as
        { id: string; status: "active" | "inactive" } | undefined;
      tenantUserStatus = tenantUserRow?.status ?? null;
      tenantUserId = tenantUserRow?.id ?? null;
    }

    const result = evaluateLoginAttempt({
      now,
      tenantStatus,
      identity: identityRow
        ? {
            status: identityRow.status,
            // ADR-0086 — GLOBAL counter. `identityRow.failed_login_count` and
            // `.locked_until` are history since `sql/113` and are deliberately
            // NOT read here; a fallback to them would restore the per-tenant
            // behaviour #430 is about the moment a principal link is missing.
            failedLoginCount: principal?.failedLoginCount ?? 0,
            lockedUntil: principal?.lockedUntil ?? null
          }
        : null,
      tenantUserStatus,
      passwordMatches,
      maxFailedAttempts: policy.maxFailedAttempts,
      lockoutMinutes: policy.lockoutMinutes
    });

    if (result.outcome === "deny") {
      if (identityRow && result.countFailedAttempt) {
        // The increment and the conditional lock are computed IN-DB — never a
        // JS read-modify-write (Issue #483).
        //
        // This used to `SELECT` the counter above, add one in
        // `evaluateLoginAttempt`, and write the absolute value back. Under READ
        // COMMITTED — which is what `sql.begin` gives — two concurrent failures
        // both read N and both wrote N+1, so K attempts fired in PARALLEL cost
        // ONE increment. No second tenant, no second IP, no second identity
        // needed: just don't send them one at a time.
        //
        // Same shape as `mfa.ts`'s verify-failure counter, which has been right
        // about this since it landed. The two differ in one place on purpose:
        // MFA resets its counter to zero when it locks, this one keeps
        // counting, because a successful login is what clears it here.
        // ADR-0086 — counted on the PRINCIPAL. Still computed in-DB rather than
        // read-modify-write (the Issue #483 defect, inherited as a fix rather
        // than repeated as a mistake): under READ COMMITTED two concurrent
        // failures that both read N and both write N+1 cost ONE increment.
        //
        // An identity with no principal link counts nothing, and that is the
        // fail-SAFE direction here: the alternative is silently falling back to
        // the per-tenant counter, which is the behaviour #430 exists to remove.
        // `sql/112` links every identity it can see and refuses to run if it
        // cannot, so an unlinked row is a repair job, not a login policy.
        if (principal) {
          await recordPrincipalLoginFailure(
            tx,
            principal.id,
            policy.maxFailedAttempts,
            result.lockoutCandidateAt ?? null
          );
        }
      }

      // Written inside the same transaction as the `failed_login_count` UPDATE
      // above, and therefore committed with it: every deny path below `return`s
      // a response rather than throwing, so this transaction always reaches
      // COMMIT (the lockout counter's durability across the exact same boundary
      // is what the account-lockout feature has always depended on). The
      // out-of-band recorder in the `catch` at the bottom of this handler covers
      // the remaining case — an exception unwinding this transaction before it
      // commits.
      await recordLoginFailure(tx, {
        tenantId,
        tenantExists: tenantRows.length > 0,
        identityId: identityRow?.id,
        reason: result.reason,
        audit: auditContext,
        correlationId: locals.correlationId
      });

      const denyResponse = resolveLoginDenyResponse(result.reason);

      return fail(denyResponse.status, denyResponse.code, denyResponse.message);
    }

    // Issue #185 — tenant SSO break-glass gate. Reached ONLY after a valid
    // password (the deny block above `return`ed otherwise), so it is never an
    // account-enumeration oracle. When the tenant policy has
    // `password_login_enabled=false`, only a configured break-glass identity may
    // still complete a local password login; every other identity is refused
    // here — BEFORE the MFA branches below, so a non-break-glass identity with
    // an MFA factor cannot complete a challenge into a session and bypass the
    // policy. Gated behind `isSsoEnabled()` so a deployment that never enables
    // SSO runs no extra query and behaves exactly as before (and turning the
    // feature flag off can never leave everyone locked out — password login is
    // re-enabled in that case, availability-first). Break-glass identities fall
    // through to the MFA branches, so any tenant MFA-enforcement policy still
    // applies to them (that is how "break-glass wajib MFA" is satisfied).
    if (
      isSsoEnabled() &&
      (await isPasswordLoginDisabledForIdentity(tx, tenantId, identityRow!.id))
    ) {
      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "identity_access",
        action: "login_blocked_password_disabled",
        resourceType: "identity",
        resourceId: identityRow!.id,
        severity: "warning",
        message:
          "Password sign-in blocked: tenant policy disables password login for this identity (not a break-glass owner).",
        attributes: { method: "password", ...auditContext },
        correlationId: locals.correlationId
      });

      return fail(
        403,
        "PASSWORD_LOGIN_DISABLED",
        "Password sign-in is disabled for this account by tenant policy. Use single sign-on."
      );
    }

    // Issue #184 — MFA challenge gate. Reached only AFTER a valid password (the
    // deny block above `return`ed otherwise), so it adds no account-enumeration
    // oracle: an attacker without the password never reaches here, and a
    // valid-password identity WITHOUT an active factor falls through to the
    // ordinary aal1 session below exactly as before. Driven by DB state (an
    // active factor row), NOT by `AUTH_MFA_ENABLED` — fail-closed, so turning
    // the enrollment feature off can never let an already-enrolled identity
    // skip its second factor. A password-valid login with an active factor
    // receives a challenge, never a session.
    const activeFactor = await findActiveMfaFactor(
      tx,
      tenantId,
      identityRow!.id
    );

    if (activeFactor) {
      if (principal) await clearPrincipalLockout(tx, principal.id);

      const challenge = await createMfaChallenge(
        tx,
        tenantId,
        identityRow!.id,
        resolveChallengeTtlSec(),
        now
      );

      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "identity_access",
        action: "mfa_challenge_issued",
        resourceType: "identity",
        resourceId: identityRow!.id,
        severity: "info",
        message: "Password verified; MFA challenge issued.",
        attributes: { method: "password", ...auditContext },
        correlationId: locals.correlationId
      });

      return fail(
        401,
        "MFA_REQUIRED",
        "Multi-factor authentication is required to complete sign-in.",
        {},
        {
          mfaChallengeToken: challenge.token,
          expiresAt: challenge.expiresAt.toISOString()
        }
      );
    }

    // Issue #184 (F1) — tenant MFA-required enforcement for an identity that
    // passed the password check but has NO active factor. Reached only after a
    // valid password (same enumeration-safe position as the challenge branch
    // above — unknown/locked/wrong-password already collapsed to one response),
    // so it is not an enumeration oracle. Fail-closed but NOT lockout-prone:
    // instead of a full aal1 session, issue an enrollment-scoped grant that
    // authorizes ONLY the enroll endpoints; a required user can always still
    // self-enroll (no admin lockout). Gated on `isMfaFeatureEnabled()` — if the
    // enrollment surface is disabled, MFA cannot be created, so requiring it
    // would be an unrecoverable lockout; the policy is inert until enrollment
    // is enabled.
    if (isMfaFeatureEnabled() && tenantUserId) {
      const mfaPolicy = await getTenantMfaPolicy(tx, tenantId);

      if (mfaPolicy.enforcementLevel !== "optional") {
        const isPrivileged =
          mfaPolicy.enforcementLevel === "required_for_all"
            ? true
            : isPrivilegedFromPermissionKeys(
                await fetchGrantedPermissionKeys(tx, tenantId, tenantUserId)
              );

        if (
          resolveMfaRequirement({
            level: mfaPolicy.enforcementLevel,
            isPrivileged
          })
        ) {
          if (principal) await clearPrincipalLockout(tx, principal.id);

          const grant = await createEnrollmentGrant(
            tx,
            tenantId,
            identityRow!.id,
            resolveChallengeTtlSec(),
            now
          );

          await recordAuditEvent(tx, {
            tenantId,
            moduleKey: "identity_access",
            action: "mfa_enrollment_required",
            resourceType: "identity",
            resourceId: identityRow!.id,
            severity: "warning",
            message:
              "Password verified; tenant policy requires MFA enrollment before a session is issued.",
            attributes: {
              method: "password",
              enforcementLevel: mfaPolicy.enforcementLevel,
              ...auditContext
            },
            correlationId: locals.correlationId
          });

          return fail(
            401,
            "MFA_ENROLLMENT_REQUIRED",
            "Multi-factor authentication enrollment is required before sign-in can complete.",
            {},
            {
              mfaEnrollmentToken: grant.token,
              expiresAt: grant.expiresAt.toISOString()
            }
          );
        }
      }
    }

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(now.getTime() + policy.sessionTtlMin * 60_000);

    if (principal) {
      await clearPrincipalLockout(tx, principal.id);

      // PROMOTION — the password was just proven, so it is safe to copy the
      // hash onto the principal. `promotePrincipalCredential` is a no-op once a
      // credential exists, so this cannot let a stale identity hash from another
      // tenant overwrite the live one.
      if (!principal.hasCredential && identityRow!.password_hash) {
        await promotePrincipalCredential(
          tx,
          principal.id,
          identityRow!.password_hash
        );
      }
    }

    await tx`UPDATE awcms_identities SET last_login_at = ${now} WHERE id = ${identityRow!.id}`;

    // The fingerprint columns exist so a person reading `GET /auth/sessions`
    // can tell their own sessions apart well enough to end one they do not
    // recognise (Gelombang 2, `sql/100`). `persistableClientIpHash` returns
    // null when the deployment has no stable key — a stored hash that changes
    // on every restart would show one device as several.
    await tx`
      INSERT INTO awcms_sessions
        (tenant_id, identity_id, token_hash, expires_at,
         client_ip_hash, user_agent_summary, origin_auth, credential_epoch)
      VALUES (
        ${tenantId}, ${identityRow!.id}, ${tokenHash}, ${expiresAt},
        ${persistableClientIpHash(clientIp)}, ${summarizeUserAgent(request) ?? null}, 'password',
        ${currentCredentialEpoch(tx, tenantId, identityRow!.id)}
      )
    `;

    // Issue #145 — the success counterpart of `recordLoginFailure`, and the
    // reason the `failed_login_count = 0` reset above is no longer a
    // history-destroying operation: the preceding `login_failed` rows survive
    // it in `awcms_audit_events`, so a post-incident responder can still see
    // the brute-force run that preceded a successful takeover. `method:
    // "password"` is unconditional — this is the only branch that mints a
    // session from a password. Neither `token` nor `tokenHash` is referenced in
    // the attributes.
    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "login_succeeded",
      resourceType: "identity",
      resourceId: identityRow!.id,
      severity: "info",
      message: "Password sign-in succeeded; session created.",
      attributes: { method: "password", ...auditContext },
      correlationId: locals.correlationId
    });

    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: policy.sessionTtlMin * 60,
      secure: process.env.AUTH_COOKIE_SECURE === "true"
    };
    cookies.set(SESSION_COOKIE_NAME, token, cookieOptions);
    cookies.set(TENANT_COOKIE_NAME, tenantId, cookieOptions);

    return ok({ token, expiresAt: expiresAt.toISOString() });
  }).catch(async (error: unknown) => {
    // Issue #145 — the login transaction was rolled back, so any `login_failed`
    // row `recordLoginFailure` wrote inside it is gone. Re-record it on a fresh
    // transaction, then rethrow untouched: this handler observes the failure for
    // the audit trail, it does not swallow or reshape it.
    await recordLoginFailureOutOfBand(sql, {
      tenantId,
      audit: auditContext,
      correlationId: locals.correlationId
    });

    throw error;
  });
};
