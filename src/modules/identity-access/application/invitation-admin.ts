/**
 * Invitation administration (ADR-0082, Gelombang 4 PR 4.1 of #423) — the read
 * model and the three mutations behind `/api/v1/invitations`.
 *
 * An invitation is an OFFER. Nothing in this file confers access: the roles it
 * names are recorded in `awcms_invitation_policies` and stay inert until
 * acceptance calls `grantRolePolicy`, the same writer every other grant goes
 * through. `activeRoleGrants` (ADR-0079) does not read these tables and must
 * never be taught to — a subject holding a role because a row says they were
 * invited is the second grant path ADR-0079 collapsed.
 *
 * ## Inviting and granting a role are two authorities
 *
 * The routes gate `invitations.create` here, and additionally
 * `access_control.assign` whenever the body names roles. That split is
 * ADR-0081's, and invitations raise its stakes: a grant to a group reaches
 * whoever joins later, while a grant carried by an invitation reaches someone
 * who does not exist yet — no row to review, no name to recognise, and the
 * recipient chooses when it becomes live.
 *
 * ## Every refusal precedes every write
 *
 * A 4xx returned from inside `withTenant` COMMITs, so an outcome discovered
 * halfway through would leave half a row behind. Each function below resolves
 * all of its refusals before it writes anything, and the one duplicate that
 * cannot be pre-checked without a race (a second invitation to the same
 * address) is absorbed by `ON CONFLICT … DO NOTHING` against the partial unique
 * index rather than being allowed to raise 23505 — a raised error aborts the
 * transaction and takes the audit row with it. `sql/074` chose the same shape.
 */
import {
  generateInviteToken,
  hashInviteToken
} from "../../../lib/auth/invitation-token";
import { sealUrlParams } from "../../../lib/security/secure-url-params";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  encodeKeysetCursor,
  KEYSET_CURSOR_CREATED_AT_SQL
} from "../../_shared/keyset-pagination";
import { INVITATION_MAX_RESEND_COUNT } from "../domain/invitation-policy";
import type { KeysetCursor } from "../../_shared/keyset-pagination";
import type { AuthNotificationPort } from "../../_shared/ports/auth-notification-port";
import type { CreateInvitationInput } from "../domain/invitation-policy";

const AUDIT_MODULE_KEY = "identity_access";
const AUDIT_RESOURCE_TYPE = "invitation";

export const INVITATION_TEMPLATE_KEY = "auth.invitation";

const LIST_LIMIT = 100;

export type InvitationDelivery = "queued" | "unavailable";

export type InvitationDeliveryOptions = {
  tokenTtlHours: number;
  /** `${APP_URL}/accept-invitation` — the page, not the API route. */
  invitationUrlBase: string;
  notifications: AuthNotificationPort;
  correlationId?: string;
};

export type CreateInvitationResult =
  | {
      outcome: "created";
      invitationId: string;
      delivery: InvitationDelivery;
      grantedRoleCodes: string[];
    }
  | { outcome: "identifier_taken" }
  | { outcome: "already_pending" }
  | { outcome: "unknown_role" }
  | { outcome: "system_role"; roleCodes: string[] };

export type RevokeInvitationResult =
  { outcome: "revoked" } | { outcome: "not_found" };

export type ResendInvitationResult =
  | { outcome: "resent"; resendCount: number; delivery: InvitationDelivery }
  | { outcome: "not_found" }
  | { outcome: "resend_limit_reached" };

export type InvitationView = {
  id: string;
  loginIdentifierMasked: string;
  displayName: string;
  status: string;
  skipEmailConfirmation: boolean;
  resendCount: number;
  expiresAt: string;
  createdAt: string;
  roleCodes: string[];
};

type InvitationRow = {
  id: string;
  login_identifier: string;
  display_name: string;
  status: string;
  skip_email_confirmation: boolean;
  resend_count: number;
  expires_at: Date;
  created_at: Date;
  created_at_cursor: string;
  role_codes: string[] | null;
};

/**
 * Masks an address for a listing.
 *
 * A local copy rather than `maskIdentifierValue`, for the reason
 * `self-registration.ts` states about its own: these are not profile
 * identifiers, and importing `profile_identity`'s helper here would assert a
 * relationship between the two that does not exist. The invitee has no profile
 * until they accept.
 */
function maskAddress(value: string): string {
  const atIndex = value.indexOf("@");
  if (atIndex <= 0) {
    return "***";
  }

  const local = value.slice(0, atIndex);
  const domain = value.slice(atIndex);
  const head = local.slice(0, 1);

  return `${head}${"*".repeat(Math.max(local.length - 1, 1))}${domain}`;
}

/**
 * The emailed link.
 *
 * It carries the TENANT as well as the token, and that is not decoration: both
 * public invitation endpoints are tenant-scoped under FORCE RLS and demand
 * `X-AWCMS-Tenant-ID`, so a link without it produces a page that cannot make
 * the call it exists to make. `requestPasswordReset` carries the tenant for the
 * same reason.
 *
 * Sealed with AES-256-GCM into one opaque `?p=` when
 * `AUTH_URL_PARAM_ENCRYPTION_KEY` is set, plain otherwise. The plain fallback
 * is not a weakness: the token is already 256 bits of CSPRNG and a tenant id is
 * not a secret.
 */
function buildInvitationUrl(
  base: string,
  rawToken: string,
  tenantId: string
): string {
  const sealed = sealUrlParams({ token: rawToken, tenantId });

  return sealed
    ? `${base}?p=${sealed}`
    : `${base}?token=${encodeURIComponent(rawToken)}&tenantId=${tenantId}`;
}

/**
 * Enqueues the invitation email through the capability port.
 *
 * `identity_access` never writes `awcms_email_*` (ADR-0013 §6); the adapter is
 * injected by the route's composition root. The ADDRESS operation is used, not
 * the account one — the whole point of this message is that its recipient has
 * no membership row yet.
 *
 * Returns `"unavailable"` rather than throwing when the tenant has no active
 * `auth.invitation` template or the address is suppressed. That is a real
 * answer the caller audits: unlike the password-reset flow, whose response must
 * stay generic for enumeration reasons, the caller here is an authenticated
 * administrator who already holds `invitations.create` — telling them the mail
 * did not go out costs nothing and saves them waiting for a link that will
 * never arrive.
 */
async function deliverInvitation(
  tx: Bun.SQL,
  tenantId: string,
  options: InvitationDeliveryOptions,
  input: {
    toAddress: string;
    inviteeName: string;
    inviterName: string;
    tenantName: string;
    rawToken: string;
  }
): Promise<InvitationDelivery> {
  const result = await options.notifications.enqueueAuthAddressNotification(
    tx,
    {
      tenantId,
      templateKey: INVITATION_TEMPLATE_KEY,
      recipientAddress: input.toAddress,
      variables: {
        inviteeName: input.inviteeName,
        inviterName: input.inviterName,
        tenantName: input.tenantName,
        invitationUrl: buildInvitationUrl(
          options.invitationUrlBase,
          input.rawToken,
          tenantId
        ),
        expiresInHours: String(options.tokenTtlHours)
      },
      ...(options.correlationId === undefined
        ? {}
        : { correlationId: options.correlationId })
    }
  );

  return result.enqueued ? "queued" : "unavailable";
}

type ActorNames = { inviterName: string; tenantName: string };

async function resolveActorNames(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string
): Promise<ActorNames> {
  const rows = (await tx`
    SELECT t.tenant_name, p.display_name AS inviter_name
    FROM awcms_tenants t
    LEFT JOIN awcms_tenant_users tu
      ON tu.tenant_id = t.id AND tu.id = ${actorTenantUserId}
    LEFT JOIN awcms_identities i
      ON i.tenant_id = tu.tenant_id AND i.id = tu.identity_id
    LEFT JOIN awcms_profiles p
      ON p.tenant_id = i.tenant_id AND p.id = i.profile_id
    WHERE t.id = ${tenantId}
  `) as { tenant_name: string | null; inviter_name: string | null }[];

  const row = rows[0];

  return {
    tenantName: row?.tenant_name ?? "",
    inviterName: row?.inviter_name ?? ""
  };
}

export async function createInvitation(
  tx: Bun.SQL,
  tenantId: string,
  inviterTenantUserId: string,
  input: CreateInvitationInput,
  now: Date,
  options: InvitationDeliveryOptions
): Promise<CreateInvitationResult> {
  // 1. An address that already has an account here is not invitable. Checked
  //    against `awcms_identities` with exact equality, matching every other
  //    lookup on the auth path — see `domain/invitation-policy.ts` on why this
  //    is never lowercased.
  const existing = (await tx`
    SELECT 1 FROM awcms_identities
    WHERE tenant_id = ${tenantId}
      AND login_identifier = ${input.loginIdentifier}
  `) as unknown[];

  if (existing.length > 0) {
    return { outcome: "identifier_taken" };
  }

  // 2. Roles resolve all-or-nothing, and a system role refuses the whole
  //    invitation. `system_role` is a DISTINCT outcome from `unknown_role` on
  //    purpose: the administrator's own screen just rendered that role, so
  //    "unknown" would be a confusing lie. Same split as
  //    `approveRegistrationRequest`.
  let grantedRoleCodes: string[] = [];
  if (input.roleIds.length > 0) {
    const found = (await tx`
      SELECT id, role_code, is_system FROM awcms_roles
      WHERE tenant_id = ${tenantId}
        AND id = ANY(${tx.array(input.roleIds, "uuid")})
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

  const rawToken = generateInviteToken();
  const expiresAt = new Date(
    now.getTime() + options.tokenTtlHours * 60 * 60 * 1000
  );

  // 3. `ON CONFLICT … DO NOTHING` against the partial unique index, so a
  //    concurrent duplicate becomes an empty result rather than a 23505 that
  //    would abort the transaction and take the audit row with it.
  const inserted = (await tx`
    INSERT INTO awcms_invitations
      (tenant_id, login_identifier, display_name, token_hash, status,
       skip_email_confirmation, invited_by_tenant_user_id, issued_at, expires_at)
    VALUES
      (${tenantId}, ${input.loginIdentifier}, ${input.displayName},
       ${hashInviteToken(rawToken)}, 'pending',
       ${input.skipEmailConfirmation}, ${inviterTenantUserId}, ${now},
       ${expiresAt})
    ON CONFLICT (tenant_id, login_identifier) WHERE status = 'pending'
    DO NOTHING
    RETURNING id
  `) as { id: string }[];

  const invitation = inserted[0];
  if (!invitation) {
    return { outcome: "already_pending" };
  }

  // 4. The policy the offer carries. `scope_type`/`scope_id` are pinned
  //    tenant-wide by `awcms_invitation_policies_tenant_wide_only_check` — see
  //    ADR-0082 on why the columns exist while the value cannot vary.
  for (const roleId of input.roleIds) {
    await tx`
      INSERT INTO awcms_invitation_policies
        (tenant_id, invitation_id, role_id, scope_type, scope_id)
      VALUES
        (${tenantId}, ${invitation.id}, ${roleId}, 'tenant', ${tenantId})
    `;
  }

  const names = await resolveActorNames(tx, tenantId, inviterTenantUserId);
  const delivery = await deliverInvitation(tx, tenantId, options, {
    toAddress: input.loginIdentifier,
    inviteeName: input.displayName,
    inviterName: names.inviterName,
    tenantName: names.tenantName,
    rawToken
  });

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: inviterTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "invitation_created",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: invitation.id,
    severity: "warning",
    message: "Invitation issued.",
    attributes: {
      roleCount: input.roleIds.length,
      roleCodes: grantedRoleCodes,
      skipEmailConfirmation: input.skipEmailConfirmation,
      delivery
    },
    ...(options.correlationId === undefined
      ? {}
      : { correlationId: options.correlationId })
  });

  return {
    outcome: "created",
    invitationId: invitation.id,
    delivery,
    grantedRoleCodes
  };
}

/**
 * The tenant's invitations, newest first, keyset-paginated.
 *
 * The address is MASKED. An invitation list is one of the few admin surfaces
 * whose rows are addresses of people who are not users here — often people who
 * never will be — so the unmasked value has no reason to leave the database.
 * `listTenantUsers` takes the same posture for the same reason.
 */
export async function listInvitations(
  tx: Bun.SQL,
  tenantId: string,
  filter: { status?: string } = {},
  cursor?: KeysetCursor
): Promise<{ invitations: InvitationView[]; nextCursor: string | null }> {
  const status = filter.status ?? null;
  // Bound as separate parameters rather than reached for inside the tuple
  // comparison, so the `IS NULL` guard is a plain parameter test — the shape
  // `redirect-directory.ts` uses.
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT
      i.id, i.login_identifier, i.display_name, i.status,
      i.skip_email_confirmation, i.resend_count, i.expires_at, i.created_at,
      ${tx.unsafe(KEYSET_CURSOR_CREATED_AT_SQL)} AS created_at_cursor,
      (
        SELECT array_agg(r.role_code ORDER BY r.role_code)
        FROM awcms_invitation_policies ip
        JOIN awcms_roles r
          ON r.tenant_id = ip.tenant_id AND r.id = ip.role_id
        WHERE ip.tenant_id = i.tenant_id AND ip.invitation_id = i.id
      ) AS role_codes
    FROM awcms_invitations i
    WHERE i.tenant_id = ${tenantId}
      AND (${status}::text IS NULL OR i.status = ${status})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (i.created_at, i.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ${LIST_LIMIT}
  `) as InvitationRow[];

  const page = rows;
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return {
    invitations: page.map((row) => ({
      id: row.id,
      loginIdentifierMasked: maskAddress(row.login_identifier),
      displayName: row.display_name,
      status: row.status,
      skipEmailConfirmation: row.skip_email_confirmation,
      resendCount: row.resend_count,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      roleCodes: row.role_codes ?? []
    })),
    nextCursor
  };
}

/**
 * Kills a pending invitation's link.
 *
 * The row survives — `revoke` answers "this link is dead now" while keeping the
 * record that answers "who offered what, to whom, and what happened". A deleted
 * row and an offer that was never made cannot be told apart.
 */
export async function revokeInvitation(
  tx: Bun.SQL,
  tenantId: string,
  invitationId: string,
  actorTenantUserId: string,
  now: Date,
  reason: string | null,
  correlationId?: string
): Promise<RevokeInvitationResult> {
  const updated = (await tx`
    UPDATE awcms_invitations
    SET status = 'revoked',
        revoked_at = ${now},
        revoked_by_tenant_user_id = ${actorTenantUserId},
        revoke_reason = ${reason},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND id = ${invitationId}
      AND status = 'pending'
    RETURNING id
  `) as { id: string }[];

  if (updated.length === 0) {
    return { outcome: "not_found" };
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "invitation_revoked",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: invitationId,
    severity: "warning",
    message: "Invitation revoked.",
    attributes: { reason },
    ...(correlationId === undefined ? {} : { correlationId })
  });

  return { outcome: "revoked" };
}

/**
 * Reissues the link, ROTATING the token.
 *
 * Rotation is what makes "resend" safe: without it one invitation grows N live
 * links, and revoking the invitation means revoking N secrets nobody counted.
 * Overwriting `token_hash` in place means the previous link dies at the instant
 * the new one is born, because the row only ever holds one hash.
 *
 * Guarded by `invitations.create` at the route, not by an action of its own —
 * minting a fresh credential is exactly the authority `create` already names.
 *
 * The `resend_count` ceiling is enforced by the UPDATE's own predicate rather
 * than by a read-then-write: two concurrent resends would both read the same
 * count and both pass a JS check, which is the shape that made the login
 * lockout counter non-atomic (#483).
 */
export async function resendInvitation(
  tx: Bun.SQL,
  tenantId: string,
  invitationId: string,
  actorTenantUserId: string,
  now: Date,
  options: InvitationDeliveryOptions
): Promise<ResendInvitationResult> {
  const rawToken = generateInviteToken();
  const expiresAt = new Date(
    now.getTime() + options.tokenTtlHours * 60 * 60 * 1000
  );

  const updated = (await tx`
    UPDATE awcms_invitations
    SET token_hash = ${hashInviteToken(rawToken)},
        resend_count = resend_count + 1,
        issued_at = ${now},
        expires_at = ${expiresAt},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND id = ${invitationId}
      AND status = 'pending'
      AND resend_count < ${INVITATION_MAX_RESEND_COUNT}
    RETURNING id, login_identifier, display_name, resend_count
  `) as {
    id: string;
    login_identifier: string;
    display_name: string;
    resend_count: number;
  }[];

  const invitation = updated[0];
  if (!invitation) {
    // Nothing was updated, and the two reasons are distinguishable only by a
    // second read. The caller is an authenticated administrator holding
    // `invitations.create`, so telling them which one it was leaks nothing and
    // is the difference between "try again" and "revoke and reinvite".
    const existing = (await tx`
      SELECT resend_count FROM awcms_invitations
      WHERE tenant_id = ${tenantId} AND id = ${invitationId} AND status = 'pending'
    `) as { resend_count: number }[];

    return existing.length > 0
      ? { outcome: "resend_limit_reached" }
      : { outcome: "not_found" };
  }

  const names = await resolveActorNames(tx, tenantId, actorTenantUserId);
  const delivery = await deliverInvitation(tx, tenantId, options, {
    toAddress: invitation.login_identifier,
    inviteeName: invitation.display_name,
    inviterName: names.inviterName,
    tenantName: names.tenantName,
    rawToken
  });

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "invitation_resent",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: invitationId,
    severity: "warning",
    message: "Invitation resent; its previous link is no longer valid.",
    attributes: { resendCount: invitation.resend_count, delivery },
    ...(options.correlationId === undefined
      ? {}
      : { correlationId: options.correlationId })
  });

  return {
    outcome: "resent",
    resendCount: invitation.resend_count,
    delivery
  };
}
