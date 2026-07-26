/**
 * Preset execution (Issue #261, ported from awcms-micro).
 *
 * Resolves the tenant's current module state, asks
 * `domain/module-presets.ts` what to do, then executes that plan through the
 * EXISTING `enableTenantModule`/`disableTenantModule` primitives — one call per
 * planned change, in the planned order.
 *
 * ## Zero re-derivation
 *
 * Nothing here re-implements lifecycle validation. Every enable and disable
 * runs the real thing against live state, so a planned change can still be
 * rejected. Rejections are REPORTED, never swallowed and never worked around:
 * a preset that cannot be fully reached says so, item by item, rather than
 * reporting success over a half-applied profile.
 *
 * ## Why there is no new permission
 *
 * Applying a preset is exactly a sequence of enables and disables, so it is
 * guarded by BOTH `module_management.tenant_modules.enable` and
 * `.disable` — the permissions those operations already require. A new
 * `presets.apply` action would need a seed migration, and an unseeded action
 * denies even the owner: the latent-authz trap this repo has already hit on the
 * roles and ABAC write surfaces. Reusing both is also the honest guard — a
 * preset can disable a module, so holding only `enable` must not be enough.
 */
import type { ModulePresetName } from "../domain/module-presets";
import {
  computeModulePresetPlan,
  findModulePreset,
  MODULE_PRESETS,
  type ModulePresetPlan
} from "../domain/module-presets";
import { listModules } from "../..";
import {
  disableTenantModule,
  enableTenantModule,
  fetchTenantModuleEntries
} from "./tenant-module-lifecycle";

export type ModulePresetChangeOutcome =
  | { moduleKey: string; action: "enable" | "disable"; outcome: "applied" }
  | {
      moduleKey: string;
      action: "enable" | "disable";
      outcome: "rejected";
      code: string;
      message: string;
    };

export type ModulePresetApplyResult = {
  presetName: ModulePresetName;
  plan: ModulePresetPlan;
  changes: ModulePresetChangeOutcome[];
  /** True when every planned change applied. A preset with an empty plan is trivially complete. */
  complete: boolean;
};

/** The catalog, for `GET`. Pure metadata — no tenant state involved. */
export function listModulePresets() {
  return MODULE_PRESETS.map((preset) => ({
    name: preset.name,
    label: preset.label,
    description: preset.description,
    enabledModuleKeys: [...preset.enabledModuleKeys]
  }));
}

async function currentTenantState(tx: Bun.SQL, tenantId: string) {
  return (await fetchTenantModuleEntries(tx, tenantId)).map((entry) => ({
    moduleKey: entry.moduleKey,
    tenantEnabled: entry.tenantEnabled
  }));
}

/**
 * What applying `presetName` WOULD do, without writing anything.
 *
 * Worth its own entry point: a preset both enables and disables, so an operator
 * about to switch a live tenant's profile deserves to see the disable list
 * before it happens rather than after.
 */
export async function planModulePreset(
  tx: Bun.SQL,
  tenantId: string,
  presetName: string
): Promise<ModulePresetPlan | null> {
  const preset = findModulePreset(presetName);

  if (!preset) {
    return null;
  }

  return computeModulePresetPlan({
    preset,
    allDescriptors: listModules(),
    currentState: await currentTenantState(tx, tenantId)
  });
}

/**
 * Apply a preset. Returns `null` for an unknown preset name so the route can
 * answer 404 rather than inventing an empty plan.
 *
 * Order matters and is the plan's: enables first (dependency-safe), then
 * disables (leaves-first). Enabling before disabling means a module moving from
 * "needed by A" to "needed by B" never passes through a moment where neither
 * holds it.
 *
 * Sequential `await`s, never `Promise.all`: `tx` is one reserved connection,
 * and concurrent queries on it desync the transaction.
 */
export async function applyModulePreset(
  tx: Bun.SQL,
  tenantId: string,
  presetName: string,
  actorTenantUserId: string
): Promise<ModulePresetApplyResult | null> {
  const preset = findModulePreset(presetName);

  if (!preset) {
    return null;
  }

  const plan = computeModulePresetPlan({
    preset,
    allDescriptors: listModules(),
    currentState: await currentTenantState(tx, tenantId)
  });
  const changes: ModulePresetChangeOutcome[] = [];

  for (const moduleKey of plan.toEnable) {
    const result = await enableTenantModule(
      tx,
      tenantId,
      moduleKey,
      actorTenantUserId
    );

    changes.push(
      result.outcome === "applied"
        ? { moduleKey, action: "enable", outcome: "applied" }
        : {
            moduleKey,
            action: "enable",
            outcome: "rejected",
            code: result.validation.code,
            message: result.validation.message
          }
    );
  }

  for (const moduleKey of plan.toDisable) {
    const result = await disableTenantModule(
      tx,
      tenantId,
      moduleKey,
      actorTenantUserId,
      `Applied module preset "${preset.name}".`
    );

    changes.push(
      result.outcome === "applied"
        ? { moduleKey, action: "disable", outcome: "applied" }
        : {
            moduleKey,
            action: "disable",
            outcome: "rejected",
            code: result.validation.code,
            message: result.validation.message
          }
    );
  }

  return {
    presetName: preset.name,
    plan,
    changes,
    complete: changes.every((change) => change.outcome === "applied")
  };
}
