/**
 * Who holds a permission that requires an enrolled MFA factor, and has none
 * (ADR-0141, finding PS-13) — the READINESS half of the requirement.
 *
 * The gate in `access-guard.ts` is what protects a tenant; this answers the
 * question an operator has BEFORE the first refusal: which tenants have people
 * who are about to be told to enrol. It exists because the alternative — refusing
 * at GRANT time — was rejected (ADR-0141 §2), and a requirement that is only ever
 * discovered by the person it blocks, in the middle of running payroll, is a
 * worse product than one an operator can list in advance.
 *
 * ## Read-only, and every read goes through an existing keyed path
 *
 * - "Who holds what" is the `activeRoleGrants` fragment, the one definition of a
 *   grant in force (ADR-0079), so this cannot disagree with the chokepoint about
 *   who holds a key.
 * - "Is this person enrolled" is `getMfaStatus`, one keyed read per holder. The
 *   MFA tables are GLOBAL and may only be queried by key
 *   (`identity:principal-access:check`): a bulk anti-join against the factor
 *   table would be the targeting list that gate exists to prevent. Holders of a
 *   payroll-critical permission are few, so the per-holder read is the cheaper
 *   price to pay.
 *
 * ## A holder who cannot use the permission is not a finding
 *
 * A module the tenant turned off, or whose entitlement it does not hold, is
 * refused by the chokepoint before enrolment is ever asked about. Reporting its
 * holders would list every tenant's owner (the owner role receives the whole
 * catalogue) for a module nobody there can reach, and a report that is mostly
 * noise is one operators stop reading. Availability is resolved with the SAME
 * function the chokepoint uses.
 *
 * ## What is returned
 *
 * Tenant-user ids and permission KEYS only. No login identifier, no name, no
 * address: this is an operator report and an id is enough to act on, while a
 * name in a go-live log is a disclosure nobody asked for.
 */
import { listModules } from "../../index";
import { mfaRequiredPermissionKeys } from "../domain/mfa-required-permissions";
import { requiredEntitlementForModule } from "../domain/entitlement";
import { resolveModuleAvailability } from "./auth-context";
import { activeRoleGrants } from "./grant-source";
import { getMfaStatus } from "./mfa";

export type UnenrolledMfaRequiredHolder = {
  tenantUserId: string;
  /** The flagged keys this person holds — never fewer than one. */
  permissionKeys: string[];
};

export type MfaRequiredHolderReport = {
  /** Flagged keys whose module is usable by this tenant, i.e. the ones that matter. */
  activeKeyCount: number;
  /** Distinct people holding at least one of them. */
  holderCount: number;
  /** The subset with no active factor, ordered by tenant-user id for stable output. */
  unenrolled: UnenrolledMfaRequiredHolder[];
};

export const EMPTY_MFA_REQUIRED_HOLDER_REPORT: MfaRequiredHolderReport = {
  activeKeyCount: 0,
  holderCount: 0,
  unenrolled: []
};

export async function reportMfaRequiredPermissionHolders(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  options?: { requiredKeys?: ReadonlySet<string> }
): Promise<MfaRequiredHolderReport> {
  const flagged = options?.requiredKeys ?? mfaRequiredPermissionKeys();

  if (flagged.size === 0) return EMPTY_MFA_REQUIRED_HOLDER_REPORT;

  // Narrow to the keys this tenant can actually exercise.
  const modules = listModules();
  const moduleKeys = new Set(
    [...flagged].map((key) => key.slice(0, key.indexOf(".")))
  );
  const usableModules = new Set<string>();

  for (const moduleKey of moduleKeys) {
    const availability = await resolveModuleAvailability(
      tx,
      tenantId,
      moduleKey,
      requiredEntitlementForModule(moduleKey, modules),
      now
    );

    if (availability.enabled && availability.entitlementHeld) {
      usableModules.add(moduleKey);
    }
  }

  const activeKeys = [...flagged].filter((key) =>
    usableModules.has(key.slice(0, key.indexOf(".")))
  );

  if (activeKeys.length === 0) return EMPTY_MFA_REQUIRED_HOLDER_REPORT;

  const rows = (await tx`
    SELECT DISTINCT g.tenant_user_id, tu.identity_id,
           p.module_key, p.activity_code, p.action
    FROM (${activeRoleGrants(tx, tenantId)}) g
    JOIN awcms_role_permissions rp
      ON rp.role_id = g.role_id AND rp.tenant_id = ${tenantId}
    JOIN awcms_permissions p ON p.id = rp.permission_id
    JOIN awcms_roles r ON r.id = g.role_id AND r.tenant_id = ${tenantId}
    JOIN awcms_tenant_users tu
      ON tu.id = g.tenant_user_id AND tu.tenant_id = ${tenantId}
    JOIN awcms_identities i
      ON i.id = tu.identity_id AND i.tenant_id = ${tenantId}
    WHERE r.deleted_at IS NULL
      AND tu.status = 'active'
      AND i.status = 'active'
      AND (p.module_key || '.' || p.activity_code || '.' || p.action) = ANY(${tx.array(activeKeys, "text")})
    ORDER BY g.tenant_user_id
  `) as {
    tenant_user_id: string;
    identity_id: string;
    module_key: string;
    activity_code: string;
    action: string;
  }[];

  const holders = new Map<
    string,
    { identityId: string; permissionKeys: Set<string> }
  >();

  for (const row of rows) {
    const entry = holders.get(row.tenant_user_id) ?? {
      identityId: row.identity_id,
      permissionKeys: new Set<string>()
    };

    entry.permissionKeys.add(
      `${row.module_key}.${row.activity_code}.${row.action}`
    );
    holders.set(row.tenant_user_id, entry);
  }

  const unenrolled: UnenrolledMfaRequiredHolder[] = [];

  for (const [tenantUserId, holder] of holders) {
    const status = await getMfaStatus(tx, tenantId, holder.identityId);

    if (!status.enabled) {
      unenrolled.push({
        tenantUserId,
        permissionKeys: [...holder.permissionKeys].sort()
      });
    }
  }

  return {
    activeKeyCount: activeKeys.length,
    holderCount: holders.size,
    unenrolled
  };
}
