/**
 * Tenant module lifecycle service. Tenant-level availability/configuration
 * only — never unloads code from the runtime (`awcms_tenant_modules` is the
 * only thing written here).
 */
import packageJson from "../../../../package.json";
import { listModules } from "../..";
import type { ModuleDescriptor } from "../../_shared/module-contract";
import { syncModuleDescriptors } from "./descriptor-sync";
import {
  evaluateModuleDisable,
  evaluateModuleEnable,
  type LifecycleValidationResult,
  type ModuleTenantState
} from "../domain/tenant-module-lifecycle";

const CURRENT_APP_VERSION = packageJson.version;

export type TenantModuleListEntry = {
  moduleKey: string;
  name: string;
  version: string;
  isCore: boolean;
  tenantEnabled: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
  disableReason: string | null;
};

type TenantModuleRow = {
  module_key: string;
  enabled: boolean;
  enabled_at: Date | null;
  disabled_at: Date | null;
  disable_reason: string | null;
};

async function fetchTenantModuleRows(
  tx: Bun.SQL,
  tenantId: string
): Promise<Map<string, TenantModuleRow>> {
  const rows = (await tx`
    SELECT module_key, enabled, enabled_at, disabled_at, disable_reason
    FROM awcms_tenant_modules
    WHERE tenant_id = ${tenantId}
  `) as TenantModuleRow[];

  return new Map(rows.map((row) => [row.module_key, row]));
}

function resolveTenantState(
  moduleKey: string,
  rows: Map<string, TenantModuleRow>
): ModuleTenantState {
  const row = rows.get(moduleKey);

  return { moduleKey, tenantEnabled: row?.enabled ?? true };
}

export async function fetchTenantModuleEntries(
  tx: Bun.SQL,
  tenantId: string
): Promise<TenantModuleListEntry[]> {
  const rows = await fetchTenantModuleRows(tx, tenantId);

  return listModules().map((descriptor) => {
    const row = rows.get(descriptor.key);

    return {
      moduleKey: descriptor.key,
      name: descriptor.name,
      version: descriptor.version,
      isCore: descriptor.isCore ?? false,
      tenantEnabled: row?.enabled ?? true,
      enabledAt: row?.enabled_at?.toISOString() ?? null,
      disabledAt: row?.disabled_at?.toISOString() ?? null,
      disableReason: row?.disable_reason ?? null
    };
  });
}

function findDescriptor(moduleKey: string): ModuleDescriptor | null {
  return listModules().find((d) => d.key === moduleKey) ?? null;
}

/**
 * Single-module narrowing of `fetchTenantModuleEntries` above — for a caller
 * that only needs one module's tenant-enabled state (e.g. an anonymous
 * public gate), reading a narrower surface than the plural function.
 * Returns `null` only if `moduleKey` isn't a registered descriptor at all.
 * Same opt-out-by-default semantics as `fetchTenantModuleEntries` — no
 * `awcms_tenant_modules` row means `tenantEnabled: true`.
 */
export async function fetchTenantModuleEntry(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string
): Promise<TenantModuleListEntry | null> {
  const descriptor = findDescriptor(moduleKey);

  if (!descriptor) {
    return null;
  }

  const rows = (await tx`
    SELECT enabled, enabled_at, disabled_at, disable_reason
    FROM awcms_tenant_modules
    WHERE tenant_id = ${tenantId} AND module_key = ${moduleKey}
  `) as {
    enabled: boolean;
    enabled_at: Date | null;
    disabled_at: Date | null;
    disable_reason: string | null;
  }[];
  const row = rows[0];

  return {
    moduleKey: descriptor.key,
    name: descriptor.name,
    version: descriptor.version,
    isCore: descriptor.isCore ?? false,
    tenantEnabled: row?.enabled ?? true,
    enabledAt: row?.enabled_at?.toISOString() ?? null,
    disabledAt: row?.disabled_at?.toISOString() ?? null,
    disableReason: row?.disable_reason ?? null
  };
}

export type TenantModuleMutationResult =
  | { outcome: "applied" }
  | {
      outcome: "rejected";
      validation: Extract<LifecycleValidationResult, { valid: false }>;
    };

export async function enableTenantModule(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string,
  actorTenantUserId: string
): Promise<TenantModuleMutationResult> {
  // `awcms_tenant_modules.module_key` has an FK to `awcms_modules` — ensure
  // the registry is current before writing tenant state that references it,
  // rather than requiring an operator to have already run
  // `bun run modules:sync`/`POST /api/v1/modules/sync` at least once.
  // Idempotent and cheap (a handful of upserts, no network calls).
  await syncModuleDescriptors(tx);

  const rows = await fetchTenantModuleRows(tx, tenantId);
  const target = findDescriptor(moduleKey);
  const allDescriptors = listModules();

  const dependencyStates = (target?.dependencies ?? []).map((depKey) => {
    const depDescriptor = findDescriptor(depKey);

    return depDescriptor
      ? {
          descriptor: depDescriptor,
          tenantState: resolveTenantState(depKey, rows)
        }
      : { descriptor: null, moduleKey: depKey };
  });

  const validation = evaluateModuleEnable({
    target,
    targetTenantState: resolveTenantState(moduleKey, rows),
    dependencyStates,
    allDescriptors,
    currentAppVersion: CURRENT_APP_VERSION
  });

  if (!validation.valid) {
    return { outcome: "rejected", validation };
  }

  await tx`
    INSERT INTO awcms_tenant_modules
      (tenant_id, module_key, enabled, enabled_at, enabled_by, disabled_at, disabled_by, disable_reason)
    VALUES (${tenantId}, ${moduleKey}, true, now(), ${actorTenantUserId}, null, null, null)
    ON CONFLICT (tenant_id, module_key) DO UPDATE SET
      enabled = true,
      enabled_at = now(),
      enabled_by = ${actorTenantUserId},
      disabled_at = null,
      disabled_by = null,
      disable_reason = null,
      updated_at = now()
  `;

  return { outcome: "applied" };
}

export async function disableTenantModule(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string,
  actorTenantUserId: string,
  reason: string
): Promise<TenantModuleMutationResult> {
  // Same reasoning as `enableTenantModule` — the FK to `awcms_modules`
  // requires the registry to be current.
  await syncModuleDescriptors(tx);

  const rows = await fetchTenantModuleRows(tx, tenantId);
  const target = findDescriptor(moduleKey);

  const reverseDependencies = listModules()
    .filter((d) => d.key !== moduleKey && d.dependencies.includes(moduleKey))
    .map((descriptor) => ({
      descriptor,
      tenantState: resolveTenantState(descriptor.key, rows)
    }));

  const validation = evaluateModuleDisable({
    target,
    targetTenantState: resolveTenantState(moduleKey, rows),
    reverseDependencies
  });

  if (!validation.valid) {
    return { outcome: "rejected", validation };
  }

  await tx`
    INSERT INTO awcms_tenant_modules
      (tenant_id, module_key, enabled, enabled_at, disabled_at, disabled_by, disable_reason)
    VALUES (${tenantId}, ${moduleKey}, false, null, now(), ${actorTenantUserId}, ${reason})
    ON CONFLICT (tenant_id, module_key) DO UPDATE SET
      enabled = false,
      disabled_at = now(),
      disabled_by = ${actorTenantUserId},
      disable_reason = ${reason},
      updated_at = now()
  `;

  return { outcome: "applied" };
}
