/**
 * The public half of the invitation flow — preview and acceptance (ADR-0082,
 * Gelombang 4 PR 4.2 of #423).
 *
 * Both callers are UNAUTHENTICATED, so the whole file is written around one
 * rule: the response must not vary with anything the caller did not already
 * know. Unknown, revoked, already-accepted, expired, and
 * belongs-to-another-tenant all produce the same refusal, and the reason lives
 * only in the audit row.
 *
 * ## Preview never returns the address
 *
 * It returns the tenant's name, the inviter's name, and the expiry. Whoever
 * legitimately holds the link read the address in their own mailbox; whoever
 * holds a STOLEN link did not, and this surface is not going to tell them.
 *
 * ## The row lock is load-bearing
 *
 * `claimInvitation` reads `FOR UPDATE`. Without it, two concurrent acceptances
 * of the same link both pass the status check and the second collides on
 * `awcms_identities_tenant_login_key` mid-transaction — a 500 for a user who
 * did nothing wrong, and a rollback that takes the audit row with it. This is
 * the defect `approveRegistrationRequest`'s `FOR UPDATE` was mutation-proven
 * against, and `completePasswordReset` repeats it for the same reason.
 *
 * ## Acceptance does NOT issue a session
 *
 * The invitee signs in at `/login` afterwards, like anyone else. Minting a
 * session here would route around the tenant's own MFA policy (a tenant with
 * `required_for_all` would get a member holding a full session and no second
 * factor), around `isPasswordLoginDisabledForIdentity` for an SSO-only tenant,
 * and around the login rate limit. The endpoint that creates an account is not
 * the place to decide who may hold a session.
 */
import { hashInviteToken } from "../../../lib/auth/invitation-token";
import { evaluateInvitation } from "../domain/invitation-policy";
import { materializeMembership } from "./membership-materialization";
import type { InvitationDenyReason } from "../domain/invitation-policy";

export type InvitationPreview = {
  tenantName: string;
  inviterName: string;
  expiresAt: string;
};

export type PreviewInvitationResult =
  | { outcome: "found"; preview: InvitationPreview }
  | { outcome: "invalid"; reason: InvitationDenyReason };

export type AcceptInvitationResult =
  | {
      outcome: "accepted";
      invitationId: string;
      identityId: string;
      tenantUserId: string;
      grantedRoleCodes: string[];
    }
  | { outcome: "invalid"; reason: InvitationDenyReason }
  | { outcome: "identifier_taken" }
  | { outcome: "unknown_role" }
  | { outcome: "system_role"; roleCodes: string[] };

type InvitationRow = {
  id: string;
  login_identifier: string;
  display_name: string;
  status: string;
  expires_at: Date;
  skip_email_confirmation: boolean;
  tenant_name: string;
  inviter_name: string | null;
};

/**
 * Reads the invitation named by a raw token.
 *
 * The lookup is `tenant_id = ? AND token_hash = ?`, so an otherwise valid token
 * presented with a different tenant header simply finds nothing — the header
 * selects the RLS scope, and the token proves the claim. A mismatch collapses
 * into `not_found` like everything else rather than announcing itself.
 */
async function findInvitation(
  tx: Bun.SQL,
  tenantId: string,
  rawToken: string,
  lock: boolean
): Promise<InvitationRow | null> {
  // Two statements rather than one parameterized by a boolean: `FOR UPDATE`
  // cannot be bound, and interpolating it would be the one place in this file
  // where a caller's flag reaches SQL text.
  const rows = lock
    ? ((await tx`
        SELECT
          i.id, i.login_identifier, i.display_name, i.status, i.expires_at,
          i.skip_email_confirmation,
          t.tenant_name,
          p.display_name AS inviter_name
        FROM awcms_invitations i
        JOIN awcms_tenants t ON t.id = i.tenant_id
        LEFT JOIN awcms_tenant_users tu
          ON tu.tenant_id = i.tenant_id AND tu.id = i.invited_by_tenant_user_id
        LEFT JOIN awcms_identities ident
          ON ident.tenant_id = tu.tenant_id AND ident.id = tu.identity_id
        LEFT JOIN awcms_profiles p
          ON p.tenant_id = ident.tenant_id AND p.id = ident.profile_id
        WHERE i.tenant_id = ${tenantId}
          AND i.token_hash = ${hashInviteToken(rawToken)}
        FOR UPDATE OF i
      `) as InvitationRow[])
    : ((await tx`
        SELECT
          i.id, i.login_identifier, i.display_name, i.status, i.expires_at,
          i.skip_email_confirmation,
          t.tenant_name,
          p.display_name AS inviter_name
        FROM awcms_invitations i
        JOIN awcms_tenants t ON t.id = i.tenant_id
        LEFT JOIN awcms_tenant_users tu
          ON tu.tenant_id = i.tenant_id AND tu.id = i.invited_by_tenant_user_id
        LEFT JOIN awcms_identities ident
          ON ident.tenant_id = tu.tenant_id AND ident.id = tu.identity_id
        LEFT JOIN awcms_profiles p
          ON p.tenant_id = ident.tenant_id AND p.id = ident.profile_id
        WHERE i.tenant_id = ${tenantId}
          AND i.token_hash = ${hashInviteToken(rawToken)}
      `) as InvitationRow[]);

  return rows[0] ?? null;
}

export async function previewInvitation(
  tx: Bun.SQL,
  tenantId: string,
  rawToken: string,
  now: Date
): Promise<PreviewInvitationResult> {
  const row = await findInvitation(tx, tenantId, rawToken, false);
  const evaluation = evaluateInvitation(
    row === null ? null : { status: row.status, expiresAt: row.expires_at },
    now
  );

  if (evaluation.outcome === "invalid") {
    return { outcome: "invalid", reason: evaluation.reason };
  }

  return {
    outcome: "found",
    preview: {
      tenantName: row!.tenant_name,
      // An inviter whose account was since deactivated leaves the join empty.
      // An empty string keeps the response shape stable rather than making the
      // page render "null invited you".
      inviterName: row!.inviter_name ?? "",
      expiresAt: row!.expires_at.toISOString()
    }
  };
}

export async function acceptInvitation(
  tx: Bun.SQL,
  tenantId: string,
  rawToken: string,
  input: { password: string; displayName?: string },
  now: Date
): Promise<AcceptInvitationResult> {
  const row = await findInvitation(tx, tenantId, rawToken, true);
  const evaluation = evaluateInvitation(
    row === null ? null : { status: row.status, expiresAt: row.expires_at },
    now
  );

  if (evaluation.outcome === "invalid") {
    return { outcome: "invalid", reason: evaluation.reason };
  }

  const invitation = row!;

  const roleRows = (await tx`
    SELECT role_id FROM awcms_invitation_policies
    WHERE tenant_id = ${tenantId} AND invitation_id = ${invitation.id}
  `) as { role_id: string }[];

  const materialized = await materializeMembership(tx, tenantId, {
    loginIdentifier: invitation.login_identifier,
    // The invitee may correct the name the inviter typed for them; if they do
    // not, the inviter's version stands.
    displayName: input.displayName ?? invitation.display_name,
    password: input.password,
    // Accepting through a link sent to that mailbox IS proof of control, so an
    // ordinary acceptance verifies the profile. `skip_email_confirmation`
    // matters for the OTHER direction — it is what let the invitation be issued
    // without demanding this proof at all.
    emailVerified: true,
    roleIds: roleRows.map((role) => role.role_id),
    reason: `invitation ${invitation.id} accepted`
  });

  if (materialized.outcome !== "created") {
    return materialized;
  }

  // `AND status = 'pending'` is redundant under the row lock and kept anyway:
  // it is the predicate that makes this UPDATE correct on its own terms, and a
  // future caller that reaches it without the lock would otherwise be wrong
  // silently.
  await tx`
    UPDATE awcms_invitations
    SET status = 'accepted',
        accepted_at = ${now},
        accepted_tenant_user_id = ${materialized.tenantUserId},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND id = ${invitation.id}
      AND status = 'pending'
  `;

  return {
    outcome: "accepted",
    invitationId: invitation.id,
    identityId: materialized.identityId,
    tenantUserId: materialized.tenantUserId,
    grantedRoleCodes: materialized.grantedRoleCodes
  };
}
