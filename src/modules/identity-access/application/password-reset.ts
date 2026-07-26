/**
 * Password-reset application logic (Wave 2 delta auth, adapted from awcms-micro
 * Issue #496) — the first real producer of `awcms_email_messages` in this repo.
 * Reuses what already exists rather than rebuilding auth: `login.ts`'s
 * tenant/identity/tenant_user active checks, `session-token.ts`'s token shape
 * (via `lib/auth/reset-token.ts`'s twin `generateResetToken`/`hashResetToken`),
 * and `tenant-auth-policy.ts`'s SSO-only rule.
 *
 * ## Enumeration-safe by construction
 *
 * `requestPasswordReset` returns `outcome: "ineligible"` for EVERY case a
 * caller must not be able to tell apart — unknown identifier, inactive
 * identity, inactive tenant-user, inactive tenant, SSO-only identity,
 * non-mailable identifier — and the endpoint responds with one fixed 200 body
 * for every outcome including success. The distinction survives only in the
 * audit trail, which is tenant-scoped, RLS-protected and never part of a
 * response.
 *
 * ## Three adaptations beyond the micro original
 *
 * 1. **SSO-only identities are refused.** `awcms` has a tenant auth policy
 *    (`password_login_enabled=false` + a break-glass allow-list, sql/025) that
 *    micro does not. Without this check, password reset would be a supported,
 *    unauthenticated way to mint a working password for an identity whose
 *    tenant deliberately turned password login off — a policy bypass with a
 *    friendly UI.
 * 2. **Delivery goes through a capability port**, not an INSERT into
 *    `awcms_email_messages`. That table belongs to `email` (ADR-0013 §6); the
 *    micro original wrote into it directly. See
 *    `_shared/ports/auth-notification-port.ts`.
 * 3. **A non-mailable `login_identifier` is ineligible** rather than enqueued
 *    (`isMailableLoginIdentifier`).
 */
import { hashPassword } from "../../../lib/auth/password";
import {
  generateResetToken,
  hashResetToken
} from "../../../lib/auth/reset-token";
import { sealUrlParams } from "../../../lib/security/secure-url-params";
import type { AuthNotificationPort } from "../../_shared/ports/auth-notification-port";
import {
  evaluatePasswordResetToken,
  isMailableLoginIdentifier,
  type PasswordResetDenyReason
} from "../domain/password-reset-policy";
import { revokeAllSessionsForIdentity } from "./session-revocation";
import { isPasswordLoginDisabledForIdentity } from "./tenant-auth-policy";

/** The `email` template + category the reset link is delivered through (seeded by `email:templates:seed-defaults`). */
export const PASSWORD_RESET_TEMPLATE_KEY = "auth.password_reset";

export type RequestPasswordResetOptions = {
  tokenTtlMinutes: number;
  /** Base URL the link is built from, e.g. `${APP_URL}/reset-password`. */
  resetUrlBase: string;
  notifications: AuthNotificationPort;
  correlationId?: string;
};

/**
 * `"ineligible"` covers every case the response must not distinguish.
 * `"delivery_unavailable"` means the identity WAS eligible and a token was
 * issued, but nothing could be queued (no active `auth.password_reset` template
 * for the tenant, or the address is suppressed) — an operator-visible
 * misconfiguration, still invisible to the caller.
 */
export type RequestPasswordResetOutcome =
  "enqueued" | "ineligible" | "delivery_unavailable";

export type RequestPasswordResetResult = {
  outcome: RequestPasswordResetOutcome;
  /** Set only when an eligible identity resolved — never for `"ineligible"`. */
  identityId?: string;
};

const INELIGIBLE: RequestPasswordResetResult = { outcome: "ineligible" };

export async function requestPasswordReset(
  tx: Bun.SQL,
  tenantId: string,
  loginIdentifier: string,
  now: Date,
  options: RequestPasswordResetOptions
): Promise<RequestPasswordResetResult> {
  const tenantRows = (await tx`
    SELECT status FROM awcms_tenants WHERE id = ${tenantId}
  `) as { status: string }[];

  if (tenantRows[0]?.status !== "active") {
    return INELIGIBLE;
  }

  if (!isMailableLoginIdentifier(loginIdentifier)) {
    return INELIGIBLE;
  }

  const identityRows = (await tx`
    SELECT id, status
    FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND login_identifier = ${loginIdentifier}
  `) as { id: string; status: string }[];
  const identity = identityRows[0];

  if (!identity || identity.status !== "active") {
    return INELIGIBLE;
  }

  const tenantUserRows = (await tx`
    SELECT id, status FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND identity_id = ${identity.id}
  `) as { id: string; status: string }[];
  const tenantUser = tenantUserRows[0];

  if (!tenantUser || tenantUser.status !== "active") {
    return INELIGIBLE;
  }

  // Adaptation 1 (see header): an identity the tenant has taken off password
  // login cannot recover a password. Collapses into the same generic outcome —
  // the caller learns nothing about the tenant's auth policy either.
  if (await isPasswordLoginDisabledForIdentity(tx, tenantId, identity.id)) {
    return INELIGIBLE;
  }

  // Supersede any still-outstanding token BEFORE issuing the new one, so a user
  // who clicks "forgot password" twice never has two simultaneously-live links.
  await tx`
    UPDATE awcms_password_reset_tokens
    SET used_at = ${now}
    WHERE tenant_id = ${tenantId} AND identity_id = ${identity.id}
      AND used_at IS NULL
  `;

  const rawToken = generateResetToken();
  const expiresAt = new Date(now.getTime() + options.tokenTtlMinutes * 60_000);

  await tx`
    INSERT INTO awcms_password_reset_tokens
      (tenant_id, identity_id, token_hash, issued_at, expires_at)
    VALUES (${tenantId}, ${identity.id}, ${hashResetToken(rawToken)}, ${now}, ${expiresAt})
  `;

  // The completion endpoint is tenant-scoped (RLS) and requires the tenant
  // header, so the link has to carry the tenant as well as the token — the
  // `/reset-password` page reads both and sends them back. When
  // `AUTH_URL_PARAM_ENCRYPTION_KEY` is set, the pair is sealed into one opaque
  // `?p=` value (AES-256-GCM, tamper-evident) so the link exposes no guessable
  // parameter structure; otherwise it falls back to plain params. That fallback
  // is not a weakness: the token is already a 256-bit CSPRNG value and the
  // tenant id is not a secret. This link only ever reaches the account owner's
  // mailbox.
  const sealed = sealUrlParams({ token: rawToken, tenantId });
  const resetUrl = sealed
    ? `${options.resetUrlBase}?p=${sealed}`
    : `${options.resetUrlBase}?token=${encodeURIComponent(rawToken)}&tenantId=${tenantId}`;

  const delivery = await options.notifications.enqueueAuthNotification(tx, {
    tenantId,
    templateKey: PASSWORD_RESET_TEMPLATE_KEY,
    recipientTenantUserId: tenantUser.id,
    variables: {
      resetUrl,
      expiresInMinutes: String(options.tokenTtlMinutes)
    },
    correlationId: options.correlationId
  });

  return {
    outcome: delivery.enqueued ? "enqueued" : "delivery_unavailable",
    identityId: identity.id
  };
}

export type CompletePasswordResetResult =
  | { outcome: "success"; identityId: string }
  | { outcome: "invalid"; reason: PasswordResetDenyReason };

export async function completePasswordReset(
  tx: Bun.SQL,
  tenantId: string,
  rawToken: string,
  newPassword: string,
  now: Date
): Promise<CompletePasswordResetResult> {
  // `FOR UPDATE` makes redemption single-use under concurrency, not just in
  // sequence: two requests carrying the same link would otherwise both read
  // `used_at IS NULL`, both pass the evaluation, and both reset the password.
  // The row lock serializes them so the second one sees `used_at` set and is
  // rejected as `already_used`. Same read-modify-write hazard the MFA replay
  // counter had to close at the database rather than in JS.
  const tokenRows = (await tx`
    SELECT id, identity_id, expires_at, used_at
    FROM awcms_password_reset_tokens
    WHERE tenant_id = ${tenantId} AND token_hash = ${hashResetToken(rawToken)}
    FOR UPDATE
  `) as {
    id: string;
    identity_id: string;
    expires_at: Date;
    used_at: Date | null;
  }[];
  const tokenRow = tokenRows[0];

  const evaluation = evaluatePasswordResetToken(
    tokenRow
      ? { expiresAt: new Date(tokenRow.expires_at), usedAt: tokenRow.used_at }
      : null,
    now
  );

  if (evaluation.outcome === "invalid") {
    return { outcome: "invalid", reason: evaluation.reason };
  }

  const identityRows = (await tx`
    SELECT id, status FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND id = ${tokenRow!.identity_id}
  `) as { id: string; status: string }[];
  const identity = identityRows[0];

  // Deactivated between issue and redemption: reported as `not_found`, the same
  // reason an unknown token gets, because a live link must not become a probe
  // for whether an account was disabled.
  if (!identity || identity.status !== "active") {
    return { outcome: "invalid", reason: "not_found" };
  }

  // The same SSO-only refusal as the request path, re-checked here rather than
  // trusted from issue time: the tenant may have turned password login off in
  // between, and the whole point of that policy is that a password cannot be
  // used to get in.
  if (await isPasswordLoginDisabledForIdentity(tx, tenantId, identity.id)) {
    return { outcome: "invalid", reason: "not_found" };
  }

  const passwordHash = await hashPassword(newPassword);

  // Clearing the lockout state is intentional: whoever holds this link proved
  // control of the account's mailbox, which is a stronger signal than the
  // failed-attempt counter that locked it.
  await tx`
    UPDATE awcms_identities
    SET password_hash = ${passwordHash}, failed_login_count = 0,
        locked_until = NULL, updated_at = ${now}
    WHERE tenant_id = ${tenantId} AND id = ${identity.id}
  `;

  await tx`
    UPDATE awcms_password_reset_tokens
    SET used_at = ${now}
    WHERE tenant_id = ${tenantId} AND id = ${tokenRow!.id}
  `;

  await revokeAllSessionsForIdentity(tx, tenantId, identity.id, now);

  return { outcome: "success", identityId: identity.id };
}
