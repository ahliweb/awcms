/**
 * Tenant-module matrix (Issue #261, ported from awcms-micro) — module ×
 * relevant-attribute for the ONE tenant already in the caller's context.
 *
 * Single-tenant scope, never a cross-tenant view: this repo's identity model is
 * strictly 1:1 tenant-scoped and RLS would refuse the rows anyway.
 *
 * ## Zero re-derivation
 *
 * Every field comes from something that already exists:
 *
 * - `fetchModuleCatalog` — static/registry fields;
 * - `fetchTenantModuleEntries` — this tenant's enabled state;
 * - `resolveProtectedModuleKeys` — the core/protected flag (Issue #261's
 *   preset work);
 * - `evaluateModuleEnable`/`evaluateModuleDisable` — the two warnings, called
 *   with each module's REAL current state.
 *
 * That last point is the one worth being strict about. The warnings are an
 * honest re-application of the exact validation the real enable/disable
 * endpoints run, not a parallel reimplementation that can drift from them. This
 * function never forges a synthetic tenant state to coax an answer out of a
 * function that would otherwise short-circuit.
 *
 * ## Why only two warning directions, not four
 *
 * `dependencyWarning` is computed ONLY for a currently-DISABLED module —
 * "would enabling this succeed right now?" — filtered to the dependency and
 * version rejection codes. Never `MODULE_ALREADY_ENABLED`, which is not a
 * warning, just the wrong question.
 *
 * `reverseDependencyWarning` is computed ONLY for a currently-ENABLED module —
 * "would disabling this be blocked?" — filtered to
 * `MODULE_REVERSE_DEPENDENCY_ACTIVE`.
 *
 * The other two combinations cannot arise. An enabled module's dependencies are
 * satisfied by construction, because `disableTenantModule` already refuses to
 * disable a dependency while an active dependent remains. Asking
 * `evaluateModuleEnable` about an already-enabled module would short-circuit to
 * `MODULE_ALREADY_ENABLED` before reaching the dependency loop — an answer to a
 * question the function is not designed for, which is exactly the kind of thing
 * that looks like a check and is not one.
 *
 * ## No health column, deliberately
 *
 * awcms-micro's matrix carries a health pill, fed by a BATCHED
 * `fetchModuleHealthReports` that shares one context across the whole registry.
 * This base has only the single-module `fetchModuleHealthReport`, so a health
 * column here would mean 21 separate reads inside one transaction — an N+1 this
 * function would be introducing, not inheriting. Health stays available
 * per-module at `GET /api/v1/modules/{moduleKey}/health`; a batched reader is a
 * separate piece of work, and the column arrives with it.
 */
import packageJson from "../../../../package.json";
import { listModules } from "../..";
import { fetchModuleCatalog, type ModuleCatalogEntry } from "./module-catalog";
import {
  fetchTenantModuleEntries,
  type TenantModuleListEntry
} from "./tenant-module-lifecycle";
import { resolveProtectedModuleKeys } from "../domain/module-presets";
import {
  evaluateModuleDisable,
  evaluateModuleEnable,
  type ModuleLifecycleErrorCode,
  type ModuleTenantState
} from "../domain/tenant-module-lifecycle";

const CURRENT_APP_VERSION = packageJson.version;

/** Rejection codes that are worth surfacing as a warning on a disabled row. */
const DEPENDENCY_WARNING_CODES: ReadonlySet<ModuleLifecycleErrorCode> = new Set(
  [
    "MODULE_DEPENDENCY_MISSING",
    "MODULE_DEPENDENCY_DISABLED",
    "MODULE_DEPENDENCY_CYCLE",
    "MODULE_VERSION_INCOMPATIBLE"
  ]
);

export type ModuleMatrixWarning = {
  code: ModuleLifecycleErrorCode;
  message: string;
};

export type ModuleMatrixRow = {
  moduleKey: string;
  name: string;
  version: string;
  type: ModuleCatalogEntry["type"];
  status: string;
  isCore: boolean;
  /**
   * `isCore` unioned with the transitive dependency closure of every core
   * module. A disable attempt on any of these is guaranteed to be rejected
   * server-side, so a UI can decline to offer the control at all rather than
   * offering one that always fails.
   */
  isProtected: boolean;
  tenantEnabled: boolean;
  disableReason: string | null;
  dependencies: string[];
  /** Only ever set for a currently-DISABLED module. */
  dependencyWarning: ModuleMatrixWarning | null;
  /** Only ever set for a currently-ENABLED module. */
  reverseDependencyWarning: ModuleMatrixWarning | null;
};

function toTenantState(entry: TenantModuleListEntry): ModuleTenantState {
  return { moduleKey: entry.moduleKey, tenantEnabled: entry.tenantEnabled };
}

export async function fetchModuleMatrix(
  tx: Bun.SQL,
  tenantId: string
): Promise<ModuleMatrixRow[]> {
  // Sequential, never Promise.all: `tx` is one reserved connection, and
  // concurrent queries on it desync the transaction.
  const catalog = await fetchModuleCatalog(tx);
  const tenantEntries = await fetchTenantModuleEntries(tx, tenantId);

  // Everything below is pure — two reads total, regardless of module count.
  const allDescriptors = listModules();
  const descriptorByKey = new Map(allDescriptors.map((d) => [d.key, d]));
  const tenantEntryByKey = new Map(
    tenantEntries.map((entry) => [entry.moduleKey, entry])
  );
  const protectedKeys = resolveProtectedModuleKeys(allDescriptors);

  /** A module with no row is enabled — the same convention the lifecycle service uses. */
  function resolveTenantState(moduleKey: string): ModuleTenantState {
    const entry = tenantEntryByKey.get(moduleKey);

    return entry ? toTenantState(entry) : { moduleKey, tenantEnabled: true };
  }

  return catalog.map((entry) => {
    const descriptor = descriptorByKey.get(entry.moduleKey) ?? null;
    const tenantState = resolveTenantState(entry.moduleKey);
    const tenantEntry = tenantEntryByKey.get(entry.moduleKey) ?? null;

    let dependencyWarning: ModuleMatrixRow["dependencyWarning"] = null;

    if (!tenantState.tenantEnabled && descriptor) {
      const validation = evaluateModuleEnable({
        target: descriptor,
        targetTenantState: tenantState,
        dependencyStates: descriptor.dependencies.map((dependencyKey) => {
          const dependencyDescriptor =
            descriptorByKey.get(dependencyKey) ?? null;

          return dependencyDescriptor
            ? {
                descriptor: dependencyDescriptor,
                tenantState: resolveTenantState(dependencyKey)
              }
            : { descriptor: null, moduleKey: dependencyKey };
        }),
        allDescriptors,
        currentAppVersion: CURRENT_APP_VERSION
      });

      if (!validation.valid && DEPENDENCY_WARNING_CODES.has(validation.code)) {
        dependencyWarning = {
          code: validation.code,
          message: validation.message
        };
      }
    }

    let reverseDependencyWarning: ModuleMatrixRow["reverseDependencyWarning"] =
      null;

    if (tenantState.tenantEnabled && descriptor) {
      const validation = evaluateModuleDisable({
        target: descriptor,
        targetTenantState: tenantState,
        reverseDependencies: allDescriptors
          .filter(
            (candidate) =>
              candidate.key !== entry.moduleKey &&
              candidate.dependencies.includes(entry.moduleKey)
          )
          .map((candidate) => ({
            descriptor: candidate,
            tenantState: resolveTenantState(candidate.key)
          }))
      });

      if (
        !validation.valid &&
        validation.code === "MODULE_REVERSE_DEPENDENCY_ACTIVE"
      ) {
        reverseDependencyWarning = {
          code: validation.code,
          message: validation.message
        };
      }
    }

    return {
      moduleKey: entry.moduleKey,
      name: entry.name,
      version: entry.version,
      type: entry.type,
      status: entry.status,
      isCore: entry.isCore,
      isProtected: protectedKeys.has(entry.moduleKey),
      tenantEnabled: tenantState.tenantEnabled,
      disableReason: tenantEntry?.disableReason ?? null,
      dependencies: entry.dependencies,
      dependencyWarning,
      reverseDependencyWarning
    };
  });
}
