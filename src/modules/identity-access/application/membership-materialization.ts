/**
 * `materializeMembership()` — turning an accepted offer into an account
 * (ADR-0082, Gelombang 4 PR 4.2 of #423).
 *
 * ## Why this is ONE function
 *
 * There are already three places in this repository that bring a membership
 * into existence: `approveRegistrationRequest`, `jitProvisionIdentity`, and
 * `bootstrapPlatformTenant`. They agree on the shape — profile, then identity,
 * then tenant user — and they have already drifted once on the detail that
 * matters most (`verification_status`), which is what produced
 * `createPersonProfileForIdentity` as a single writer.
 *
 * This is the fourth, and it is deliberately written as one function with one
 * caller rather than as a helper the others are re-pointed at. Gelombang 7
 * replaces the identity row with a global principal, and it needs exactly one
 * place to redirect. Re-pointing the existing three now would make this PR a
 * refactor of self-registration and SSO on top of everything else — and would
 * turn `tests/access-assignment-writers.test.ts` red for a reason unrelated to
 * invitations, since its non-vacuity assertion names `self-registration.ts` by
 * path as a direct caller of `grantRolePolicy`.
 *
 * ## The system-role refusal happens HERE too
 *
 * `createInvitation` already refused a role marked `is_system`. This checks
 * again, because the two moments can be days apart: a role can be marked
 * system, soft-deleted, or dropped from the catalogue in between, and the
 * invitation would still be carrying its id. `approveRegistrationRequest` sets
 * the precedent — and the program doc requires the check at both ends.
 *
 * ## Every refusal precedes every write
 *
 * A 4xx returned from inside `withTenant` COMMITs. Each refusal below is
 * resolved before the first INSERT, so a rejected acceptance leaves nothing
 * behind but its audit row.
 */
import { linkIdentityToPrincipal } from "./principal-store";
import { hashPassword } from "../../../lib/auth/password";
import { createPersonProfileForIdentity } from "../../profile-identity/application/person-profile";
import { grantRolePolicy } from "./access-policy-writer";

export type MaterializeMembershipInput = {
  loginIdentifier: string;
  displayName: string;
  password: string;
  /** Marks the profile `verified` — gated by the invitation's own `skip_email_confirmation`, which the platform permission guards at issue time. */
  emailVerified: boolean;
  roleIds: readonly string[];
  /** Recorded on each grant, so `awcms_access_policy_events` says WHY the role was held. */
  reason: string;
};

export type MaterializeMembershipResult =
  | {
      outcome: "created";
      identityId: string;
      tenantUserId: string;
      grantedRoleCodes: string[];
    }
  | { outcome: "identifier_taken" }
  | { outcome: "unknown_role" }
  | { outcome: "system_role"; roleCodes: string[] };

export async function materializeMembership(
  tx: Bun.SQL,
  tenantId: string,
  input: MaterializeMembershipInput
): Promise<MaterializeMembershipResult> {
  // 1. The address must still be free. Exact equality, never lowercased — the
  //    comparison every other lookup on the auth path uses.
  const existing = (await tx`
    SELECT 1 FROM awcms_identities
    WHERE tenant_id = ${tenantId}
      AND login_identifier = ${input.loginIdentifier}
  `) as unknown[];

  if (existing.length > 0) {
    return { outcome: "identifier_taken" };
  }

  // 2. The roles must still resolve, and none of them may be a system role.
  //    Re-derived from the database rather than trusted from the invitation:
  //    the row carries ids, and what those ids MEAN can have changed.
  let grantedRoleCodes: string[] = [];
  if (input.roleIds.length > 0) {
    const found = (await tx`
      SELECT id, role_code, is_system FROM awcms_roles
      WHERE tenant_id = ${tenantId}
        AND id = ANY(${tx.array([...input.roleIds], "uuid")})
        AND deleted_at IS NULL
    `) as { id: string; role_code: string; is_system: boolean }[];

    if (found.length !== input.roleIds.length) {
      return { outcome: "unknown_role" };
    }

    const systemRoles = found.filter((row) => row.is_system);
    if (systemRoles.length > 0) {
      return {
        outcome: "system_role",
        roleCodes: systemRoles.map((row) => row.role_code).sort()
      };
    }

    grantedRoleCodes = found.map((row) => row.role_code).sort();
  }

  // 3. Profile through the single writer that owns `awcms_profiles`
  //    (ADR-0013 §6) — a fresh INSERT here would also redden
  //    `modules:table-writes:check`, and the drift that gate exists to stop is
  //    exactly the `verification_status` disagreement this parameter carries.
  const profileId = await createPersonProfileForIdentity(tx, tenantId, {
    displayName: input.displayName,
    emailVerified: input.emailVerified
  });

  const identityRows = (await tx`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES
      (${tenantId}, ${profileId}, ${input.loginIdentifier},
       ${await hashPassword(input.password)}, 'active')
    RETURNING id
  `) as { id: string }[];

  const identityId = identityRows[0]!.id;

  // ADR-0086 — an identity with no principal counts NO failed logins, because
  // the lockout counter lives on the principal now. Every identity writer links.
  await linkIdentityToPrincipal(tx, identityId, input.loginIdentifier);

  const tenantUserRows = (await tx`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id, status)
    VALUES (${tenantId}, ${identityId}, 'active')
    RETURNING id
  `) as { id: string }[];

  const tenantUserId = tenantUserRows[0]!.id;

  // 4. One call per role rather than a set-based INSERT: the shared writer also
  //    writes the `granted` lifecycle event, and a grant with no provenance row
  //    is a hole exactly where an investigation starts.
  for (const roleId of input.roleIds) {
    await grantRolePolicy(tx, tenantId, {
      tenantUserId,
      roleId,
      // No actor: the invitee granted themselves nothing. The administrator who
      // decided this is named by the invitation, and by its audit row.
      grantedByTenantUserId: null,
      reason: input.reason
    });
  }

  return { outcome: "created", identityId, tenantUserId, grantedRoleCodes };
}
