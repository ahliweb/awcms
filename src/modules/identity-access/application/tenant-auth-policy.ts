/**
 * Tenant authentication policy CRUD (Issue #185, epic ERP-readiness enterprise
 * auth #177) over `awcms_tenant_auth_policies` (sql/025). Ported/adapted from
 * awcms-mini `application/tenant-auth-policy.ts` (Issue #591); `mfa_required`
 * DROPPED (awcms models tenant MFA enforcement in `awcms_tenant_mfa_policies`,
 * sql/024), `jit_provisioning_enabled` ADDED.
 *
 * `saveTenantAuthPolicy` is the ONE place that enforces "`sso_required=true`
 * (or `password_login_enabled=false`) cannot be enabled unless at least one
 * break-glass local owner remains available" — checked at save time against a
 * fresh DB read of the candidate break-glass identities' current status, never
 * trusted from the request body alone.
 */
import {
  evaluateBreakGlassRequirement,
  type UpdateTenantAuthPolicyInput
} from "../domain/tenant-sso-policy";

export type TenantAuthPolicyView = {
  tenantId: string;
  passwordLoginEnabled: boolean;
  ssoEnabled: boolean;
  ssoRequired: boolean;
  autoLinkVerifiedEmail: boolean;
  jitProvisioningEnabled: boolean;
  allowedEmailDomains: string[];
  breakGlassIdentityIds: string[];
  updatedAt: string | null;
};

const DEFAULT_POLICY_VIEW: Omit<TenantAuthPolicyView, "tenantId"> = {
  passwordLoginEnabled: true,
  ssoEnabled: false,
  ssoRequired: false,
  autoLinkVerifiedEmail: false,
  jitProvisioningEnabled: false,
  allowedEmailDomains: [],
  breakGlassIdentityIds: [],
  updatedAt: null
};

type TenantAuthPolicyRow = {
  password_login_enabled: boolean;
  sso_enabled: boolean;
  sso_required: boolean;
  auto_link_verified_email: boolean;
  jit_provisioning_enabled: boolean;
  allowed_email_domains: unknown;
  break_glass_identity_ids: unknown;
  updated_at: Date;
};

function toArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function toView(
  tenantId: string,
  row: TenantAuthPolicyRow
): TenantAuthPolicyView {
  return {
    tenantId,
    passwordLoginEnabled: row.password_login_enabled,
    ssoEnabled: row.sso_enabled,
    ssoRequired: row.sso_required,
    autoLinkVerifiedEmail: row.auto_link_verified_email,
    jitProvisioningEnabled: row.jit_provisioning_enabled,
    allowedEmailDomains: toArray(row.allowed_email_domains),
    breakGlassIdentityIds: toArray(row.break_glass_identity_ids),
    updatedAt: row.updated_at.toISOString()
  };
}

/** Returns the tenant's policy, or the safe backward-compatible default (password login on, SSO off) when no row was ever saved. */
export async function getTenantAuthPolicy(
  tx: Bun.SQL,
  tenantId: string
): Promise<TenantAuthPolicyView> {
  const rows = (await tx`
    SELECT password_login_enabled, sso_enabled, sso_required,
           auto_link_verified_email, jit_provisioning_enabled,
           allowed_email_domains, break_glass_identity_ids, updated_at
    FROM awcms_tenant_auth_policies
    WHERE tenant_id = ${tenantId}
  `) as TenantAuthPolicyRow[];
  const row = rows[0];

  if (!row) {
    return { tenantId, ...DEFAULT_POLICY_VIEW };
  }

  return toView(tenantId, row);
}

/**
 * Resolves which of `breakGlassIdentityIds` currently resolve to an identity
 * that can still complete a local password login in this tenant: the identity
 * exists, belongs to this tenant, `status='active'`, and has an `active`
 * `awcms_tenant_users` membership. Exported so `scripts/security-readiness.ts`
 * can re-derive the SAME eligibility rule at go-live time (a break-glass
 * identity that was eligible when the policy was last saved can drift to
 * ineligible without the policy being re-saved).
 */
export async function fetchEligibleBreakGlassIdentityIds(
  tx: Bun.SQL,
  tenantId: string,
  breakGlassIdentityIds: string[]
): Promise<string[]> {
  if (breakGlassIdentityIds.length === 0) {
    return [];
  }

  const rows = (await tx`
    SELECT i.id
    FROM awcms_identities i
    JOIN awcms_tenant_users tu
      ON tu.tenant_id = i.tenant_id AND tu.identity_id = i.id
    WHERE i.tenant_id = ${tenantId}
      AND i.id = ANY(${tx.array(breakGlassIdentityIds, "uuid")})
      AND i.status = 'active'
      AND tu.status = 'active'
  `) as { id: string }[];

  return rows.map((row) => row.id);
}

/** Count-only convenience wrapper for callers that only need whether at least one eligible identity exists. */
export async function countEligibleBreakGlassIdentities(
  tx: Bun.SQL,
  tenantId: string,
  breakGlassIdentityIds: string[]
): Promise<number> {
  const eligibleIds = await fetchEligibleBreakGlassIdentityIds(
    tx,
    tenantId,
    breakGlassIdentityIds
  );

  return eligibleIds.length;
}

export type SaveTenantAuthPolicyResult =
  | { outcome: "saved"; policy: TenantAuthPolicyView }
  | { outcome: "break_glass_required" };

export async function saveTenantAuthPolicy(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: UpdateTenantAuthPolicyInput
): Promise<SaveTenantAuthPolicyResult> {
  const current = await getTenantAuthPolicy(tx, tenantId);

  const passwordLoginEnabled =
    input.passwordLoginEnabled ?? current.passwordLoginEnabled;
  const ssoEnabled = input.ssoEnabled ?? current.ssoEnabled;
  const ssoRequired = input.ssoRequired ?? current.ssoRequired;
  const autoLinkVerifiedEmail =
    input.autoLinkVerifiedEmail ?? current.autoLinkVerifiedEmail;
  const jitProvisioningEnabled =
    input.jitProvisioningEnabled ?? current.jitProvisioningEnabled;
  const allowedEmailDomains =
    input.allowedEmailDomains ?? current.allowedEmailDomains;
  const submittedBreakGlassIdentityIds =
    input.breakGlassIdentityIds ?? current.breakGlassIdentityIds;

  const eligibleBreakGlassIdentityIds =
    await fetchEligibleBreakGlassIdentityIds(
      tx,
      tenantId,
      submittedBreakGlassIdentityIds
    );

  const breakGlassEvaluation = evaluateBreakGlassRequirement({
    passwordLoginEnabled,
    ssoRequired,
    breakGlassIdentityIds: submittedBreakGlassIdentityIds,
    eligibleBreakGlassCount: eligibleBreakGlassIdentityIds.length
  });

  if (breakGlassEvaluation.outcome === "invalid") {
    return { outcome: "break_glass_required" };
  }

  // Persist only the ids confirmed eligible right now, never the submitted list
  // verbatim — a submission of "1 valid + N garbage ids" must not silently save
  // the garbage alongside the real one. Filtering keeps the column self-cleaning.
  const eligibleIdSet = new Set(eligibleBreakGlassIdentityIds);
  const breakGlassIdentityIds = submittedBreakGlassIdentityIds.filter((id) =>
    eligibleIdSet.has(id)
  );

  const rows = (await tx`
    INSERT INTO awcms_tenant_auth_policies
      (tenant_id, password_login_enabled, sso_enabled, sso_required,
       auto_link_verified_email, jit_provisioning_enabled, allowed_email_domains,
       break_glass_identity_ids, updated_by)
    VALUES (
      ${tenantId}, ${passwordLoginEnabled}, ${ssoEnabled}, ${ssoRequired},
      ${autoLinkVerifiedEmail}, ${jitProvisioningEnabled},
      ${allowedEmailDomains}::jsonb, ${breakGlassIdentityIds}::jsonb,
      ${actorTenantUserId}
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      password_login_enabled = ${passwordLoginEnabled},
      sso_enabled = ${ssoEnabled},
      sso_required = ${ssoRequired},
      auto_link_verified_email = ${autoLinkVerifiedEmail},
      jit_provisioning_enabled = ${jitProvisioningEnabled},
      allowed_email_domains = ${allowedEmailDomains}::jsonb,
      break_glass_identity_ids = ${breakGlassIdentityIds}::jsonb,
      updated_at = now(),
      updated_by = ${actorTenantUserId}
    RETURNING password_login_enabled, sso_enabled, sso_required,
              auto_link_verified_email, jit_provisioning_enabled,
              allowed_email_domains, break_glass_identity_ids, updated_at
  `) as TenantAuthPolicyRow[];

  return { outcome: "saved", policy: toView(tenantId, rows[0]!) };
}

/**
 * Login-time enforcement. Returns `true` only when password login should be
 * REJECTED for this identity: the tenant's policy has
 * `password_login_enabled=false` AND this identity is not a configured
 * break-glass identity. A single cheap read (no eligibility re-check — an
 * identity already listed as break-glass is trusted here; `saveTenantAuthPolicy`
 * guarantees the list held ≥1 eligible identity at save time). Callers
 * (`login.ts`) gate this behind `isSsoEnabled(env)` so a deployment that never
 * enables SSO never runs this query or changes login behavior at all.
 */
export async function isPasswordLoginDisabledForIdentity(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT password_login_enabled, break_glass_identity_ids
    FROM awcms_tenant_auth_policies
    WHERE tenant_id = ${tenantId}
  `) as {
    password_login_enabled: boolean;
    break_glass_identity_ids: unknown;
  }[];
  const row = rows[0];

  if (!row || row.password_login_enabled) {
    return false;
  }

  const breakGlassIds = toArray(row.break_glass_identity_ids);
  return !breakGlassIds.includes(identityId);
}
