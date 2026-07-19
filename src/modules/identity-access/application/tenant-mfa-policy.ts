/**
 * Tenant MFA enforcement policy (Issue #184) — one row per tenant over
 * `awcms_tenant_mfa_policies` (sql/024), upsert, no `id` in the URL. New in
 * this base (awcms-mini only has a `mfa_required` boolean, not the
 * `optional`/`required_for_privileged`/`required_for_all` enum this issue
 * requires). Returns the safe default (`optional`) when no row has ever been
 * saved, so every tenant that never touches the policy behaves exactly as it
 * did before this migration.
 */
import {
  isMfaEnforcementLevel,
  type MfaEnforcementLevel
} from "../domain/mfa-policy";

export type TenantMfaPolicyView = {
  tenantId: string;
  enforcementLevel: MfaEnforcementLevel;
  updatedAt: string | null;
};

export async function getTenantMfaPolicy(
  tx: Bun.SQL,
  tenantId: string
): Promise<TenantMfaPolicyView> {
  const rows = (await tx`
    SELECT enforcement_level, updated_at
    FROM awcms_tenant_mfa_policies
    WHERE tenant_id = ${tenantId}
  `) as { enforcement_level: MfaEnforcementLevel; updated_at: Date }[];
  const row = rows[0];

  if (!row) {
    return { tenantId, enforcementLevel: "optional", updatedAt: null };
  }

  return {
    tenantId,
    enforcementLevel: row.enforcement_level,
    updatedAt: row.updated_at.toISOString()
  };
}

export type SaveTenantMfaPolicyResult =
  | { ok: true; policy: TenantMfaPolicyView }
  | { ok: false; code: "INVALID_ENFORCEMENT_LEVEL" };

export async function saveTenantMfaPolicy(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  enforcementLevel: unknown
): Promise<SaveTenantMfaPolicyResult> {
  if (!isMfaEnforcementLevel(enforcementLevel)) {
    return { ok: false, code: "INVALID_ENFORCEMENT_LEVEL" };
  }

  const rows = (await tx`
    INSERT INTO awcms_tenant_mfa_policies (tenant_id, enforcement_level, updated_by)
    VALUES (${tenantId}, ${enforcementLevel}, ${actorTenantUserId})
    ON CONFLICT (tenant_id) DO UPDATE SET
      enforcement_level = ${enforcementLevel},
      updated_at = now(),
      updated_by = ${actorTenantUserId}
    RETURNING enforcement_level, updated_at
  `) as { enforcement_level: MfaEnforcementLevel; updated_at: Date }[];
  const row = rows[0]!;

  return {
    ok: true,
    policy: {
      tenantId,
      enforcementLevel: row.enforcement_level,
      updatedAt: row.updated_at.toISOString()
    }
  };
}
