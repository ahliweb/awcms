import { assertUuid } from "../../../lib/database/tenant-context";
import { linkIdentityToPrincipal } from "../../identity-access/application/principal-store";
import { hashPassword } from "../../../lib/auth/password";
import type { SetupInitializeInput } from "../domain/setup-validation";

export type PlatformBootstrapResult =
  | { outcome: "already_initialized" }
  | {
      outcome: "initialized";
      tenantId: string;
      officeId: string;
      ownerProfileId: string;
      ownerIdentityId: string;
      ownerTenantUserId: string;
      ownerRoleId: string;
    };

export type CreatedTenant = {
  tenantId: string;
  officeId: string;
  ownerProfileId: string;
  ownerIdentityId: string;
  ownerTenantUserId: string;
  ownerRoleId: string;
};

/**
 * Creates a tenant with its office, owner account, `owner` role, grants, and
 * access assignment — the whole set, in the caller's transaction.
 *
 * ## Why this is extracted (ADR-0054)
 *
 * The setup wizard and tenant provisioning both need it, and the one thing that
 * must never differ between them is the `scope` filter on the grant. A second
 * copy of this INSERT is exactly how the cross-tenant defect ADR-0052 removed
 * would come back: the copy would be written by someone reading the original,
 * which for most of this repo's life did not have the filter.
 *
 * `grantPlatformScope` is the ONLY difference between the two callers, and it
 * is a parameter rather than a branch on "is this the first tenant?" so the
 * answer is stated at the call site instead of inferred.
 *
 * ## The tenant-context switch
 *
 * Every table written below is under FORCE RLS keyed on
 * `app.current_tenant_id`, so this sets that GUC to the tenant being CREATED.
 * The caller may already be inside a different tenant's context (provisioning
 * runs as the platform tenant), so it restores the previous value before
 * returning — otherwise the caller's own audit row, idempotency record, and
 * anything else after this point would silently be written into the new
 * tenant's partition.
 *
 * Both ids are `assertUuid`-validated before interpolation; `SET LOCAL` takes
 * no bind parameters, which is why this is the one place `tx.unsafe` appears.
 */
export async function createTenantWithOwner(
  tx: Bun.SQL,
  input: SetupInitializeInput,
  options: { grantPlatformScope: boolean; restoreTenantId?: string }
): Promise<CreatedTenant> {
  const tenantRows = await tx`
    INSERT INTO awcms_tenants (tenant_code, tenant_name)
    VALUES (${input.tenantCode}, ${input.tenantName})
    RETURNING id
  `;
  const tenantId = assertUuid(tenantRows[0]!.id as string);

  await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);

  await tx`INSERT INTO awcms_tenant_settings (tenant_id) VALUES (${tenantId})`;

  const officeRows = await tx`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name, office_type)
    VALUES (${tenantId}, ${input.officeCode}, ${input.officeName}, 'head_office')
    RETURNING id
  `;
  const officeId = officeRows[0]!.id as string;

  const profileRows = await tx`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${input.ownerDisplayName})
    RETURNING id
  `;
  const profileId = profileRows[0]!.id as string;

  const passwordHash = await hashPassword(input.ownerPassword);
  const identityRows = await tx`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profileId}, ${input.ownerLoginIdentifier}, ${passwordHash})
    RETURNING id
  `;
  const identityId = identityRows[0]!.id as string;

  // ADR-0086 — an identity with no principal counts NO failed logins, because
  // the lockout counter lives on the principal now. Every identity writer links.
  await linkIdentityToPrincipal(tx, identityId, input.ownerLoginIdentifier);

  const tenantUserRows = await tx`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identityId})
    RETURNING id
  `;
  const tenantUserId = tenantUserRows[0]!.id as string;

  const roleRows = await tx`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
    VALUES (${tenantId}, 'owner', 'Owner', true)
    RETURNING id
  `;
  const roleId = roleRows[0]!.id as string;

  // The owner receives the whole TENANT-scoped catalogue. The `scope` filter is
  // the point (ADR-0053): without it this statement hands every future
  // cross-tenant permission to every tenant that is ever created, which is
  // exactly how `idn_admin_regions.dataset.configure` came to be held by an
  // ordinary tenant owner (ADR-0052). Filtering here means a new platform
  // permission is safe the moment it is declared — nobody has to remember.
  await tx`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    SELECT ${tenantId}, ${roleId}, id FROM awcms_permissions
    WHERE scope = 'tenant'
  `;

  if (options.grantPlatformScope) {
    // Only the setup wizard passes true: the tenant it creates BECOMES
    // `awcms_setup_state.tenant_id`, the last link of the chain
    // `resolvePlatformTenant` follows, so it is the platform tenant by default.
    //
    // Nothing here can widen. The chokepoint still requires the acting tenant
    // to BE the resolved platform tenant, so these rows are inert anywhere the
    // resolution does not point.
    await tx`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT ${tenantId}, ${roleId}, id FROM awcms_permissions
      WHERE scope = 'platform'
    `;
  }

  // ADR-0078 — the owner grant lands in `awcms_access_policies`, tenant-wide.
  //
  // Written inline rather than through `access-policy-writer.ts` for the reason
  // this whole file exists: `tenant_admin` must not import `identity_access`
  // application code (the module DAG runs the other way, and
  // `modules:dag:check` enforces it). The duplication is two INSERTs and is
  // pinned by `tests/access-assignment-writers.test.ts`, which scans for grant
  // writers by table name and would report this one the moment it drifted.
  //
  // `granted_by` is the new owner themselves: bootstrap runs before any session
  // exists, so there is no other actor it could name, and naming nobody would
  // lose the fact that the grant was self-originating.
  const bootstrapPolicy = (await tx`
    INSERT INTO awcms_access_policies
      (tenant_id, subject_type, tenant_user_id, role_id, scope_type, scope_id,
       granted_by_tenant_user_id, reason)
    VALUES
      (${tenantId}, 'tenant_user', ${tenantUserId}, ${roleId}, 'tenant', ${tenantId},
       ${tenantUserId}, 'tenant bootstrap')
    RETURNING id
  `) as { id: string }[];

  await tx`
    INSERT INTO awcms_access_policy_events
      (tenant_id, policy_id, event_type, actor_tenant_user_id, reason)
    VALUES (${tenantId}, ${bootstrapPolicy[0]!.id}, 'granted', ${tenantUserId}, 'tenant bootstrap')
  `;

  if (options.restoreTenantId) {
    // See the header: leaving the GUC pointed at the new tenant would send the
    // caller's remaining writes (audit, idempotency) into the wrong partition.
    await tx.unsafe(
      `SET LOCAL app.current_tenant_id = '${assertUuid(options.restoreTenantId)}'`
    );
  }

  return {
    tenantId,
    officeId,
    ownerProfileId: profileId,
    ownerIdentityId: identityId,
    ownerTenantUserId: tenantUserId,
    ownerRoleId: roleId
  };
}

/**
 * The one-time setup wizard: creates the FIRST tenant and claims
 * `awcms_setup_state`, so it can only ever succeed once. Spans `tenant_admin`,
 * `profile_identity`, and `identity_access`'s tables — a call-time
 * orchestration concern kept as an explicit composition-root function rather
 * than a module `dependencies` edge (a static dependency there would wrongly
 * imply tenant_admin cannot function at all without the other two enabled).
 *
 * The tenant it creates becomes the PLATFORM tenant, which is why it is the one
 * caller that passes `grantPlatformScope: true`. Every subsequent tenant is
 * created by `provisionTenant`, which does not.
 */
export async function bootstrapPlatformTenant(
  tx: Bun.SQL,
  input: SetupInitializeInput
): Promise<PlatformBootstrapResult> {
  const claimed = await tx`
    INSERT INTO awcms_setup_state (id, locked_at)
    VALUES (true, now())
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;

  if (!claimed[0]) {
    return { outcome: "already_initialized" };
  }

  const created = await createTenantWithOwner(tx, input, {
    grantPlatformScope: true
  });

  await tx`UPDATE awcms_setup_state SET tenant_id = ${created.tenantId} WHERE id = true`;

  return { outcome: "initialized", ...created };
}
