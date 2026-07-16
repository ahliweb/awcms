/**
 * Pure dependency-graph validation for tenant module enable/disable. No I/O
 * here — the application layer (`application/tenant-module-lifecycle.ts`)
 * resolves the current state from `listModules()` + `awcms_tenant_modules`
 * and hands it to these functions, keeping the actual decision testable
 * without a database.
 *
 * The dependency graph itself always comes from the live code registry
 * (`listModules()`'s own `dependencies` arrays), never the DB's
 * `awcms_module_dependencies` table — that table only reflects whatever
 * `bun run modules:sync` last wrote, and enable/disable must never depend on
 * someone having remembered to run a sync first.
 */
import type { ModuleDescriptor } from "../../_shared/module-contract";

export type ModuleLifecycleErrorCode =
  | "MODULE_NOT_FOUND"
  | "MODULE_ALREADY_ENABLED"
  | "MODULE_ALREADY_DISABLED"
  | "MODULE_DEPENDENCY_MISSING"
  | "MODULE_DEPENDENCY_DISABLED"
  | "MODULE_REVERSE_DEPENDENCY_ACTIVE"
  | "MODULE_DEPENDENCY_CYCLE"
  | "MODULE_VERSION_INCOMPATIBLE"
  | "CORE_MODULE_CANNOT_BE_DISABLED";

export type LifecycleValidationResult =
  | { valid: true }
  | { valid: false; code: ModuleLifecycleErrorCode; message: string };

/** `tenantEnabled` defaults to `true` when no `awcms_tenant_modules` row exists — a module with no explicit tenant state is available by default (backward-compatible with pre-existing behavior). */
export type ModuleTenantState = {
  moduleKey: string;
  tenantEnabled: boolean;
};

function buildDependencyGraph(
  descriptors: readonly ModuleDescriptor[]
): Map<string, readonly string[]> {
  return new Map(descriptors.map((d) => [d.key, d.dependencies] as const));
}

/** DFS from `startKey` through the dependency graph — `true` if the walk revisits `startKey`, i.e. `startKey` is part of a dependency cycle. */
export function hasDependencyCycle(
  startKey: string,
  descriptors: readonly ModuleDescriptor[]
): boolean {
  const graph = buildDependencyGraph(descriptors);
  const visited = new Set<string>();

  function walk(key: string, depth: number): boolean {
    if (depth > 0 && key === startKey) {
      return true;
    }
    if (visited.has(key)) {
      return false;
    }
    visited.add(key);

    for (const dep of graph.get(key) ?? []) {
      if (walk(dep, depth + 1)) {
        return true;
      }
    }
    return false;
  }

  return walk(startKey, 0);
}

function compareSemver(a: string, b: string): number {
  const partsA = a.split(".").map((n) => Number(n) || 0);
  const partsB = b.split(".").map((n) => Number(n) || 0);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export type EnableValidationInput = {
  target: ModuleDescriptor | null;
  targetTenantState: ModuleTenantState;
  /** One entry per direct dependency declared by `target.dependencies`. `null` for a dependency key not found in `listModules()` at all. */
  dependencyStates: (
    | { descriptor: ModuleDescriptor; tenantState: ModuleTenantState }
    | { descriptor: null; moduleKey: string }
  )[];
  allDescriptors: readonly ModuleDescriptor[];
  currentAppVersion: string;
};

export function evaluateModuleEnable(
  input: EnableValidationInput
): LifecycleValidationResult {
  const { target } = input;

  if (!target || target.status === "disabled") {
    return {
      valid: false,
      code: "MODULE_NOT_FOUND",
      message: "Module is not registered or is globally disabled."
    };
  }

  if (input.targetTenantState.tenantEnabled) {
    return {
      valid: false,
      code: "MODULE_ALREADY_ENABLED",
      message: "Module is already enabled for this tenant."
    };
  }

  for (const dependency of input.dependencyStates) {
    if (!dependency.descriptor) {
      return {
        valid: false,
        code: "MODULE_DEPENDENCY_MISSING",
        message: `Dependency "${dependency.moduleKey}" is not a registered module.`
      };
    }

    if (
      dependency.descriptor.status === "disabled" ||
      !dependency.tenantState.tenantEnabled
    ) {
      return {
        valid: false,
        code: "MODULE_DEPENDENCY_DISABLED",
        message: `Dependency "${dependency.descriptor.key}" is disabled.`
      };
    }
  }

  if (hasDependencyCycle(target.key, input.allDescriptors)) {
    return {
      valid: false,
      code: "MODULE_DEPENDENCY_CYCLE",
      message: `Module "${target.key}" is part of a circular dependency.`
    };
  }

  const minAppVersion = target.compatibility?.minAppVersion;
  if (
    minAppVersion &&
    compareSemver(input.currentAppVersion, minAppVersion) < 0
  ) {
    return {
      valid: false,
      code: "MODULE_VERSION_INCOMPATIBLE",
      message: `Module "${target.key}" requires app version >= ${minAppVersion}, current is ${input.currentAppVersion}.`
    };
  }

  return { valid: true };
}

export type DisableValidationInput = {
  target: ModuleDescriptor | null;
  targetTenantState: ModuleTenantState;
  /** Every OTHER registered module that declares a dependency on the target, with its own current tenant state. */
  reverseDependencies: {
    descriptor: ModuleDescriptor;
    tenantState: ModuleTenantState;
  }[];
};

export function evaluateModuleDisable(
  input: DisableValidationInput
): LifecycleValidationResult {
  const { target } = input;

  if (!target) {
    return {
      valid: false,
      code: "MODULE_NOT_FOUND",
      message: "Module is not registered."
    };
  }

  if (target.isCore) {
    return {
      valid: false,
      code: "CORE_MODULE_CANNOT_BE_DISABLED",
      message: `Module "${target.key}" is core and cannot be disabled.`
    };
  }

  if (!input.targetTenantState.tenantEnabled) {
    return {
      valid: false,
      code: "MODULE_ALREADY_DISABLED",
      message: "Module is already disabled for this tenant."
    };
  }

  const activeDependent = input.reverseDependencies.find(
    (dependent) => dependent.tenantState.tenantEnabled
  );

  if (activeDependent) {
    return {
      valid: false,
      code: "MODULE_REVERSE_DEPENDENCY_ACTIVE",
      message: `Module "${activeDependent.descriptor.key}" depends on "${target.key}" and is still enabled.`
    };
  }

  return { valid: true };
}
