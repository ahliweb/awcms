/**
 * Self-registration application service (Wave 2 delta auth, adapted from
 * awcms-micro). Same posture as `password-reset.ts`: the public path is
 * anti-enumeration by construction, and the real outcome survives only in the
 * audit trail.
 *
 * ## Trust model
 *
 * - `submitRegistrationRequest` is reachable by anonymous callers. It NEVER
 *   creates a login-eligible account — only a `pending` row. It accepts no
 *   privilege input and no password.
 * - `listPendingRegistrations` / `approve` / `reject` sit behind the admin ABAC
 *   guard (`identity_access.registration_requests.{read,approve,reject}`).
 *   Approval is the ONLY path that materializes profile + identity +
 *   tenant_user, and therefore the single point at which a self-registered
 *   applicant becomes able to sign in.
 * - Approval REFUSES system roles. It is the second writer of
 *   `awcms_access_assignments` in this repo, and it sits behind a different
 *   permission than the first one (`access_control.assign`, whose service
 *   `user-admin.ts#assignRole` throws `SystemRoleAssignmentError`). Two writers
 *   with two rule sets is how `owner` — a system role holding the entire tenant
 *   catalogue — became reachable from a permission whose stated purpose is that
 *   it does NOT edit roles. What it still does NOT do is demand
 *   `access_control.assign` for granting an ordinary role at approval time:
 *   that is the deliberate design recorded in the route's docblock, and
 *   narrowing it is an authority change that belongs in an ADR, not here.
 *
 * ## Approval issues a credential the applicant must claim
 *
 * The identity is created with an UNUSABLE password — a hash of fresh CSPRNG
 * bytes nobody ever sees — and the applicant receives a password-reset link
 * through the same `requestPasswordReset` flow `/forgot-password` uses. So:
 * no anonymous submitter's secret is ever stored, a rejected or abandoned
 * request leaves no credential behind, and the applicant proves control of the
 * mailbox before the account can be used. The alternative (micro's) stores an
 * argon2id hash chosen by an unverified stranger for an account that may never
 * exist.
 *
 * The consequence is stated rather than hidden: if delivery is unavailable
 * (tenant has no active `auth.password_reset` template, or the address is
 * suppressed) the account exists but has no way in. `approveRegistrationRequest`
 * reports that as `delivery: "unavailable"` so the admin screen can say so, and
 * the recovery is ordinary — the applicant uses `/forgot-password`, or the
 * admin fixes the template and re-triggers it.
 */
import { linkIdentityToPrincipal } from "./principal-store";
import { generateResetToken } from "../../../lib/auth/reset-token";
import { hashPassword } from "../../../lib/auth/password";
import { createPersonProfileForIdentity } from "../../profile-identity/application/person-profile";
import type { AuthNotificationPort } from "../../_shared/ports/auth-notification-port";
import { isMailableLoginIdentifier } from "../domain/password-reset-policy";
import { grantRolePolicy } from "./access-policy-writer";
import {
  requestPasswordReset,
  type RequestPasswordResetOptions
} from "./password-reset";

/**
 * Every reason a submission produced no row. Internal only — the endpoint
 * answers identically for all of them, including `created`.
 */
export type SubmitRegistrationOutcome =
  | "created"
  | "tenant_inactive"
  | "not_mailable"
  | "identifier_taken"
  | "duplicate_pending";

export type SubmitRegistrationResult = {
  outcome: SubmitRegistrationOutcome;
  /** Set only when a row was written — never for a rejected submission. */
  requestId?: string;
};

export async function submitRegistrationRequest(
  tx: Bun.SQL,
  tenantId: string,
  input: { loginIdentifier: string; displayName: string }
): Promise<SubmitRegistrationResult> {
  const tenantRows = (await tx`
    SELECT status FROM awcms_tenants WHERE id = ${tenantId}
  `) as { status: string }[];

  if (tenantRows[0]?.status !== "active") {
    return { outcome: "tenant_inactive" };
  }

  // Re-checked here even though the validator already rejects it: this function
  // is also reachable from tests and any future caller, and an unmailable
  // identifier would produce an approved account that can never be claimed.
  if (!isMailableLoginIdentifier(input.loginIdentifier)) {
    return { outcome: "not_mailable" };
  }

  // An account already exists. No row is created, and the caller is told
  // nothing — this is the single most valuable answer to an enumeration sweep,
  // so it must be indistinguishable from success.
  const existing = await tx`
    SELECT 1 FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND login_identifier = ${input.loginIdentifier}
  `;

  if (existing[0]) {
    return { outcome: "identifier_taken" };
  }

  // The partial unique index (sql/074) allows at most one PENDING row per
  // identifier. `DO NOTHING` turns a second submit into "no row returned"
  // rather than a 23505 the route would have to catch — and, critically, it
  // does so INSIDE the transaction: a raised constraint error here would abort
  // the transaction and take the audit row with it.
  const inserted = (await tx`
    INSERT INTO awcms_registration_requests
      (tenant_id, login_identifier, display_name)
    VALUES (${tenantId}, ${input.loginIdentifier}, ${input.displayName})
    ON CONFLICT (tenant_id, login_identifier) WHERE status = 'pending'
      DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (!inserted[0]) {
    return { outcome: "duplicate_pending" };
  }

  return { outcome: "created", requestId: inserted[0].id };
}

export type PendingRegistrationView = {
  id: string;
  /** Masked — this renders in an admin queue and the raw value is PII. */
  loginIdentifierMasked: string;
  displayName: string;
  requestedAt: string;
};

const QUEUE_LIMIT = 200;

export async function listPendingRegistrations(
  tx: Bun.SQL,
  tenantId: string
): Promise<PendingRegistrationView[]> {
  const rows = (await tx`
    SELECT id, login_identifier, display_name, requested_at
    FROM awcms_registration_requests
    WHERE tenant_id = ${tenantId} AND status = 'pending'
    ORDER BY requested_at ASC, id ASC
    LIMIT ${QUEUE_LIMIT}
  `) as {
    id: string;
    login_identifier: string;
    display_name: string;
    requested_at: Date;
  }[];

  return rows.map((row) => ({
    id: row.id,
    loginIdentifierMasked: maskAddress(row.login_identifier),
    displayName: row.display_name,
    requestedAt: row.requested_at.toISOString()
  }));
}

/**
 * Local mask rather than `profile-identity`'s `maskIdentifierValue`: these rows
 * are not profile identifiers and never become one until approval, so reaching
 * into that module's domain for a display helper would declare a dependency
 * this file does not otherwise have.
 */
function maskAddress(value: string): string {
  const atIndex = value.indexOf("@");

  if (atIndex <= 0) {
    return "***";
  }

  return `${value.slice(0, 1)}${"*".repeat(Math.max(atIndex - 1, 1))}${value.slice(atIndex)}`;
}

export type ApproveRegistrationResult =
  | {
      outcome: "approved";
      identityId: string;
      tenantUserId: string;
      /** Whether the applicant's password-reset link was actually queued. */
      delivery: "queued" | "unavailable";
      /** Role codes actually granted, sorted — empty on the default (no role) path. */
      grantedRoleCodes: string[];
    }
  | { outcome: "not_found" }
  | { outcome: "identifier_taken" }
  | { outcome: "unknown_role" }
  /**
   * At least one requested role is a SYSTEM role (`owner`). Distinct from
   * `unknown_role` on purpose: the role exists and the reviewer's own screen
   * just rendered it, so answering "does not exist" would be a lie about a row
   * they can see. It leaks nothing they do not already hold — listing this
   * tenant's roles is what `registration_requests.read` already showed them.
   */
  | { outcome: "system_role"; roleCodes: string[] };

export type ApproveRegistrationOptions = {
  roleIds: string[];
  notifications: AuthNotificationPort;
  /** Base URL for the claim link, e.g. `${APP_URL}/reset-password`. */
  resetUrlBase: string;
  tokenTtlMinutes: number;
  correlationId?: string;
};

export async function approveRegistrationRequest(
  tx: Bun.SQL,
  tenantId: string,
  requestId: string,
  reviewerTenantUserId: string,
  now: Date,
  options: ApproveRegistrationOptions
): Promise<ApproveRegistrationResult> {
  // `FOR UPDATE`, with `status = 'pending'` in the predicate: two reviewers
  // approving the same row concurrently would otherwise both read it as
  // pending and both start creating an account. The database does stop the
  // second one — `awcms_identities_tenant_login_key` raises 23505 — but it
  // raises it mid-transaction, which aborts the whole thing and surfaces as a
  // 500 to a reviewer who did nothing wrong. Mutation-proven: drop the lock and
  // `two reviewers approving the same row` fails with exactly that error.
  //
  // The lock serializes them instead, so the second reviewer sees no pending
  // row and gets a clean `not_found` → 404. Correctness was never at risk here;
  // the failure MODE was.
  const requestRows = (await tx`
    SELECT id, login_identifier, display_name
    FROM awcms_registration_requests
    WHERE tenant_id = ${tenantId} AND id = ${requestId} AND status = 'pending'
    FOR UPDATE
  `) as { id: string; login_identifier: string; display_name: string }[];
  const request = requestRows[0];

  if (!request) {
    return { outcome: "not_found" };
  }

  // An admin may have created the same account by hand since the request was
  // filed. Checked before anything is written, so approval never half-succeeds.
  const duplicate = await tx`
    SELECT 1 FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND login_identifier = ${request.login_identifier}
  `;

  if (duplicate[0]) {
    return { outcome: "identifier_taken" };
  }

  // Carried into the audit row: `roleCount` alone cannot answer "which role did
  // this approval hand out?", and that is the only question an auditor has
  // about an approval that granted one.
  let grantedRoleCodes: string[] = [];

  if (options.roleIds.length > 0) {
    const found = (await tx`
      SELECT id, role_code, is_system FROM awcms_roles
      WHERE tenant_id = ${tenantId}
        AND id = ANY(${tx.array(options.roleIds, "uuid")})
        AND deleted_at IS NULL
    `) as { id: string; role_code: string; is_system: boolean }[];

    // All-or-nothing: a partially-valid role list must not silently grant the
    // subset that happened to resolve.
    if (found.length !== options.roleIds.length) {
      return { outcome: "unknown_role" };
    }

    // A system role is `owner`, and `owner` holds the WHOLE tenant catalogue
    // (`tenant-admin/application/platform-bootstrap.ts` seeds it that way). The
    // ordinary assignment path already refuses this — `user-admin.ts#assignRole`
    // throws `SystemRoleAssignmentError` and its route is gated on
    // `access_control.assign`. Approval writes the same table
    // (`awcms_access_assignments`) behind a DIFFERENT permission, so without
    // this check a principal holding only `registration_requests.{read,approve}`
    // — a role whose whole point is that it does NOT edit the RBAC catalogue —
    // could mint an `owner`. Refused BEFORE any write: this function returns
    // from inside the tenant transaction and a returned 4xx COMMITs.
    const systemRoles = found.filter((role) => role.is_system);

    if (systemRoles.length > 0) {
      return {
        outcome: "system_role",
        roleCodes: systemRoles.map((role) => role.role_code)
      };
    }

    grantedRoleCodes = found.map((role) => role.role_code).sort();
  }

  // Not `emailVerified`: an approving reviewer confirmed the person should have
  // access, which is not the same as anyone having proved control of the
  // address. The reset link this approval sends is what proves that, and it
  // does so after the profile exists.
  const profileId = await createPersonProfileForIdentity(tx, tenantId, {
    displayName: request.display_name
  });

  // An unusable credential: the hash of 32 CSPRNG bytes that are discarded
  // immediately. The column is NOT NULL and login verifies against it, so there
  // is no "no password" state to represent — this is the closest honest thing,
  // and it is unguessable rather than a shared placeholder.
  const unusablePasswordHash = await hashPassword(generateResetToken());

  const identityRows = (await tx`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (
      ${tenantId}, ${profileId}, ${request.login_identifier},
      ${unusablePasswordHash}, 'active'
    )
    RETURNING id
  `) as { id: string }[];
  const identityId = identityRows[0]!.id;

  // ADR-0086 — an identity with no principal counts NO failed logins, because
  // the lockout counter lives on the principal now. Every identity writer links.
  await linkIdentityToPrincipal(tx, identityId, request.login_identifier);

  const tenantUserRows = (await tx`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id, status)
    VALUES (${tenantId}, ${identityId}, 'active')
    RETURNING id
  `) as { id: string }[];
  const tenantUserId = tenantUserRows[0]!.id;

  // ADR-0078 — grants land in `awcms_access_policies`. Written one at a time
  // rather than as a set-based INSERT: `grantRolePolicy` also records the
  // `granted` lifecycle event, and a history that exists for grants made through
  // the admin surface but not for grants made by approving a registration would
  // be a gap exactly where an investigation looks first. The list is a handful of
  // role ids chosen by a reviewer, not a batch.
  //
  // No `ON CONFLICT DO NOTHING` equivalent is needed: this runs immediately after
  // the tenant user is created in the same transaction, so it can hold nothing
  // yet, and duplicate role ids in one request are refused by validation.
  for (const roleId of options.roleIds) {
    await grantRolePolicy(tx, tenantId, {
      tenantUserId,
      roleId,
      grantedByTenantUserId: reviewerTenantUserId,
      reason: "self-registration approved"
    });
  }

  await tx`
    UPDATE awcms_registration_requests
    SET status = 'approved',
        reviewed_at = ${now},
        reviewed_by_tenant_user_id = ${reviewerTenantUserId},
        created_identity_id = ${identityId},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId} AND id = ${requestId}
  `;

  // Now that the account exists and is active, the ordinary password-reset
  // request path applies to it unchanged — including its own eligibility
  // checks, its token supersession, and its audit-free generic result.
  const resetOptions: RequestPasswordResetOptions = {
    tokenTtlMinutes: options.tokenTtlMinutes,
    resetUrlBase: options.resetUrlBase,
    notifications: options.notifications,
    correlationId: options.correlationId
  };
  const reset = await requestPasswordReset(
    tx,
    tenantId,
    request.login_identifier,
    now,
    resetOptions
  );

  return {
    outcome: "approved",
    identityId,
    tenantUserId,
    delivery: reset.outcome === "enqueued" ? "queued" : "unavailable",
    grantedRoleCodes
  };
}

export type RejectRegistrationResult =
  { outcome: "rejected"; requestId: string } | { outcome: "not_found" };

/** Closes a pending request. Creates nothing, and is a no-op on an already-reviewed row. */
export async function rejectRegistrationRequest(
  tx: Bun.SQL,
  tenantId: string,
  requestId: string,
  reviewerTenantUserId: string,
  now: Date
): Promise<RejectRegistrationResult> {
  const rows = (await tx`
    UPDATE awcms_registration_requests
    SET status = 'rejected',
        reviewed_at = ${now},
        reviewed_by_tenant_user_id = ${reviewerTenantUserId},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId} AND id = ${requestId} AND status = 'pending'
    RETURNING id
  `) as { id: string }[];

  if (!rows[0]) {
    return { outcome: "not_found" };
  }

  return { outcome: "rejected", requestId: rows[0].id };
}
