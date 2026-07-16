/**
 * Tenant-aware module settings service. Non-secret operational preferences
 * only — `awcms_module_settings.settings` must never hold a raw provider
 * token/credential (enforced by `domain/module-settings.ts`'s
 * `validateModuleSettingsPatch` before this ever runs). Real secrets stay in
 * environment variables/a secret manager.
 */
import { listModules } from "../..";
import type { ModuleDescriptor } from "../../_shared/module-contract";
import { syncModuleDescriptors } from "./descriptor-sync";
import {
  diffModuleSettings,
  mergeEffectiveSettings,
  type ModuleSettingsDiff
} from "../domain/module-settings";

export type ModuleSettingsView = {
  moduleKey: string;
  schemaVersion: number;
  defaults: Record<string, unknown>;
  tenantOverride: Record<string, unknown>;
  effective: Record<string, unknown>;
  updatedAt: string | null;
};

type ModuleSettingsRow = {
  schema_version: number;
  settings: Record<string, unknown>;
  updated_at: Date;
};

function findDescriptor(moduleKey: string): ModuleDescriptor | null {
  return listModules().find((d) => d.key === moduleKey) ?? null;
}

async function fetchSettingsRow(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string
): Promise<ModuleSettingsRow | null> {
  const rows = (await tx`
    SELECT schema_version, settings, updated_at
    FROM awcms_module_settings
    WHERE tenant_id = ${tenantId} AND module_key = ${moduleKey}
  `) as ModuleSettingsRow[];

  return rows[0] ?? null;
}

function toView(
  descriptor: ModuleDescriptor,
  row: ModuleSettingsRow | null
): ModuleSettingsView {
  const defaults = descriptor.settings?.defaults ?? {};
  const tenantOverride = row?.settings ?? {};

  return {
    moduleKey: descriptor.key,
    schemaVersion:
      row?.schema_version ?? descriptor.settings?.schemaVersion ?? 1,
    defaults,
    tenantOverride,
    effective: mergeEffectiveSettings(defaults, tenantOverride),
    updatedAt: row?.updated_at.toISOString() ?? null
  };
}

/** `null` means the module key isn't a registered descriptor at all — distinct from a registered module with no tenant override yet (which still returns a view, just with an empty `tenantOverride`/defaults-only `effective`). */
export async function fetchModuleSettingsView(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string
): Promise<ModuleSettingsView | null> {
  const descriptor = findDescriptor(moduleKey);

  if (!descriptor) {
    return null;
  }

  const row = await fetchSettingsRow(tx, tenantId, moduleKey);

  return toView(descriptor, row);
}

export type UpdateModuleSettingsResult =
  | { outcome: "not_found" }
  | {
      outcome: "applied";
      view: ModuleSettingsView;
      diff: ModuleSettingsDiff;
    };

/**
 * Merges `patch` into the tenant's existing override (shallow top-level merge
 * — `{ ...before, ...patch }`), never replacing keys the caller didn't
 * mention. Returns safe diff metadata (changed/added/removed key *names*,
 * never values) for the caller to audit.
 */
export async function updateModuleSettings(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string,
  patch: Record<string, unknown>,
  actorTenantUserId: string
): Promise<UpdateModuleSettingsResult> {
  const descriptor = findDescriptor(moduleKey);

  if (!descriptor) {
    return { outcome: "not_found" };
  }

  // `awcms_module_settings.module_key` has an FK to `awcms_modules` — same
  // reasoning as `tenant-module-lifecycle.ts`'s enable/disable.
  await syncModuleDescriptors(tx);

  const existingRow = await fetchSettingsRow(tx, tenantId, moduleKey);
  const before = existingRow?.settings ?? {};
  const after = { ...before, ...patch };
  const schemaVersion = descriptor.settings?.schemaVersion ?? 1;

  await tx`
    INSERT INTO awcms_module_settings
      (tenant_id, module_key, schema_version, settings, updated_at, updated_by)
    VALUES (${tenantId}, ${moduleKey}, ${schemaVersion}, ${after}, now(), ${actorTenantUserId})
    ON CONFLICT (tenant_id, module_key) DO UPDATE SET
      schema_version = ${schemaVersion},
      settings = ${after},
      updated_at = now(),
      updated_by = ${actorTenantUserId}
  `;

  return {
    outcome: "applied",
    view: toView(descriptor, {
      schema_version: schemaVersion,
      settings: after,
      updated_at: new Date()
    }),
    diff: diffModuleSettings(before, after)
  };
}
