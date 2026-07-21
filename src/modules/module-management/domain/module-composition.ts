/**
 * Deterministic module-registry composition — the validation engine
 * (originally Issue #178, epic #177; ADR-0025). Validates the reviewed base
 * registry (`src/modules/index.ts`'s `listBaseModules()`) into one final,
 * validated module list. Validation is 100% compile-time TypeScript — no
 * runtime discovery, file upload, package scanning, `eval`, or untrusted code
 * loading.
 *
 * ADR-0034 §3 removed the derived-application pathway: the `application`
 * registry parameter, the migration-namespace overlap check, the
 * base-override / reserved-module-type checks, and the `mergeModuleRegistries`
 * seam are gone. These functions now validate a single reviewed registry (the
 * base). The remaining checks are all base-load-bearing invariants that also
 * hold when new domain modules are added directly to `src/modules/`.
 *
 * ## Why this lives in `module-management/domain/`, NOT `_shared/`
 *
 * This engine reuses TWO existing validators:
 * `../../_shared/module-dependency-graph.ts` (`validateModuleDependencyGraph`
 * — the registry-wide DAG check, Issue #680, which awcms places in
 * `_shared/`) and `./job-registry.ts` (`validateJobDescriptor` — a SIBLING
 * in this same `module-management/domain/` folder). Placing composition in
 * `module-management/domain/` keeps every import pointing DOWN the
 * dependency arrow: modules depend on `_shared/`, and a sibling import of
 * `./job-registry.ts` stays inside this module. Putting it in `_shared/`
 * instead would force `_shared/` to import FROM `module-management/domain/`
 * (`job-registry.ts`) — inverting the kernel-vs-module direction.
 *
 * Only `src/modules/index.ts` and the CLI scripts
 * (`scripts/validate-module-composition.ts`,
 * `scripts/module-composition-inventory-*.ts`) import this file.
 *
 * ## Every composition issue class (see `ModuleCompositionIssue`)
 *
 * Reused as-is from the whole-registry DAG validator: `self_dependency`,
 * `duplicate_dependency`, `missing_dependency`, `cycle`. Plus:
 * - `duplicate_module_key` — two modules in the registry share a key.
 * - `capability_provider_conflict` — two or more modules declare the same
 *   string in their own `capabilities.provides`.
 * - `capability_provider_missing` — a REQUIRED (`optional` not `true`)
 *   `capabilities.consumes` entry names a `providedBy` module that is not in
 *   the registry, or is but doesn't declare that capability in its own
 *   `provides`.
 * - `deployment_profile_incompatible` — a module declares
 *   `compatibility.deploymentProfiles` including a profile that one of its own
 *   `dependencies` (which also declares `deploymentProfiles`) does NOT support.
 * - `navigation_path_conflict` — two navigation entries declare the exact same
 *   `path`.
 * - `invalid_job_descriptor` — reuses `./job-registry.ts`'s
 *   `validateJobDescriptor` against every module's `jobs` array.
 *
 * Permission catalogs and health descriptors have no dedicated issue type
 * (permissions are inherently namespaced by their own module's key; health
 * is two optional booleans with no shape to validate) — both still flow into
 * `buildComposedModuleInventory` so the deterministic inventory reflects them.
 */
import type { ModuleDescriptor } from "../../_shared/module-contract";
import {
  formatModuleDependencyGraphIssue,
  validateModuleDependencyGraph,
  type ModuleDependencyGraphIssue
} from "../../_shared/module-dependency-graph";
import { validateJobDescriptor } from "./job-registry";

export type ModuleCompositionIssue =
  | ModuleDependencyGraphIssue
  | { type: "duplicate_module_key"; moduleKey: string; occurrences: number }
  | {
      type: "capability_provider_conflict";
      capability: string;
      providerModuleKeys: readonly string[];
    }
  | {
      type: "capability_provider_missing";
      moduleKey: string;
      capability: string;
      providedBy: string;
      reason:
        "provider_not_registered" | "provider_does_not_declare_capability";
    }
  | {
      type: "deployment_profile_incompatible";
      moduleKey: string;
      dependencyKey: string;
      unsupportedProfile: string;
    }
  | {
      type: "navigation_path_conflict";
      path: string;
      moduleKeys: readonly string[];
    }
  | {
      type: "invalid_job_descriptor";
      moduleKey: string;
      command: string;
      errors: readonly string[];
    };

export type ModuleCompositionResult =
  | { valid: true; registry: readonly ModuleDescriptor[] }
  | {
      valid: false;
      registry: readonly ModuleDescriptor[];
      issues: readonly ModuleCompositionIssue[];
    };

export function formatModuleCompositionIssue(
  issue: ModuleCompositionIssue
): string {
  switch (issue.type) {
    case "self_dependency":
    case "duplicate_dependency":
    case "missing_dependency":
    case "cycle":
      return formatModuleDependencyGraphIssue(issue);
    case "duplicate_module_key":
      return `Module key "${issue.moduleKey}" is declared ${issue.occurrences} times in the module registry.`;
    case "capability_provider_conflict":
      return `Capability "${issue.capability}" is provided by more than one module: ${issue.providerModuleKeys.join(", ")}.`;
    case "capability_provider_missing":
      return issue.reason === "provider_not_registered"
        ? `Module "${issue.moduleKey}" requires capability "${issue.capability}" from "${issue.providedBy}", which is not a registered module in the registry.`
        : `Module "${issue.moduleKey}" requires capability "${issue.capability}" from "${issue.providedBy}", which does not declare providing that capability.`;
    case "deployment_profile_incompatible":
      return `Module "${issue.moduleKey}" declares compatibility with deployment profile "${issue.unsupportedProfile}", but its dependency "${issue.dependencyKey}" does not support that profile.`;
    case "navigation_path_conflict":
      return `Navigation path "${issue.path}" is declared by more than one module: ${issue.moduleKeys.join(", ")}.`;
    case "invalid_job_descriptor":
      return `Module "${issue.moduleKey}" declares an invalid job "${issue.command}": ${issue.errors.join("; ")}`;
  }
}

function checkDuplicateModuleKeys(
  registry: readonly ModuleDescriptor[]
): ModuleCompositionIssue[] {
  const counts = new Map<string, number>();
  for (const module of registry) {
    counts.set(module.key, (counts.get(module.key) ?? 0) + 1);
  }

  const issues: ModuleCompositionIssue[] = [];
  for (const [moduleKey, occurrences] of counts) {
    if (occurrences > 1) {
      issues.push({ type: "duplicate_module_key", moduleKey, occurrences });
    }
  }
  return issues;
}

function checkCapabilityBindings(
  registry: readonly ModuleDescriptor[]
): ModuleCompositionIssue[] {
  const issues: ModuleCompositionIssue[] = [];
  const byKey = new Map(registry.map((m) => [m.key, m] as const));

  const providerMap = new Map<string, string[]>();
  for (const module of registry) {
    for (const capability of module.capabilities?.provides ?? []) {
      const providers = providerMap.get(capability) ?? [];
      providers.push(module.key);
      providerMap.set(capability, providers);
    }
  }

  for (const [capability, providerModuleKeys] of providerMap) {
    if (providerModuleKeys.length > 1) {
      issues.push({
        type: "capability_provider_conflict",
        capability,
        providerModuleKeys
      });
    }
  }

  for (const module of registry) {
    for (const consumed of module.capabilities?.consumes ?? []) {
      if (consumed.optional) continue;

      const provider = byKey.get(consumed.providedBy);
      if (!provider) {
        issues.push({
          type: "capability_provider_missing",
          moduleKey: module.key,
          capability: consumed.capability,
          providedBy: consumed.providedBy,
          reason: "provider_not_registered"
        });
        continue;
      }

      if (
        !(provider.capabilities?.provides ?? []).includes(consumed.capability)
      ) {
        issues.push({
          type: "capability_provider_missing",
          moduleKey: module.key,
          capability: consumed.capability,
          providedBy: consumed.providedBy,
          reason: "provider_does_not_declare_capability"
        });
      }
    }
  }

  return issues;
}

function checkDeploymentProfiles(
  registry: readonly ModuleDescriptor[]
): ModuleCompositionIssue[] {
  const issues: ModuleCompositionIssue[] = [];
  const byKey = new Map(registry.map((m) => [m.key, m] as const));

  for (const module of registry) {
    const ownProfiles = module.compatibility?.deploymentProfiles;
    if (!ownProfiles) continue;

    for (const dependencyKey of module.dependencies) {
      const dependencyProfiles =
        byKey.get(dependencyKey)?.compatibility?.deploymentProfiles;
      if (!dependencyProfiles) continue;

      for (const profile of ownProfiles) {
        if (!dependencyProfiles.includes(profile)) {
          issues.push({
            type: "deployment_profile_incompatible",
            moduleKey: module.key,
            dependencyKey,
            unsupportedProfile: profile
          });
        }
      }
    }
  }

  return issues;
}

function checkNavigationPaths(
  registry: readonly ModuleDescriptor[]
): ModuleCompositionIssue[] {
  const pathToModules = new Map<string, string[]>();

  for (const module of registry) {
    for (const entry of module.navigation ?? []) {
      const owners = pathToModules.get(entry.path) ?? [];
      owners.push(module.key);
      pathToModules.set(entry.path, owners);
    }
  }

  const issues: ModuleCompositionIssue[] = [];
  for (const [path, moduleKeys] of pathToModules) {
    if (moduleKeys.length > 1) {
      issues.push({ type: "navigation_path_conflict", path, moduleKeys });
    }
  }
  return issues;
}

function checkJobDescriptors(
  registry: readonly ModuleDescriptor[]
): ModuleCompositionIssue[] {
  const issues: ModuleCompositionIssue[] = [];

  for (const module of registry) {
    for (const job of module.jobs ?? []) {
      const result = validateJobDescriptor(job);
      if (!result.valid) {
        issues.push({
          type: "invalid_job_descriptor",
          moduleKey: module.key,
          command: job.command,
          errors: result.errors
        });
      }
    }
  }

  return issues;
}

/**
 * The full rule engine. Reports EVERY distinct issue across the whole
 * registry in one pass (never stops at the first), the same philosophy
 * `validateModuleDependencyGraph` already uses.
 */
export function validateComposedModuleRegistry(
  registry: readonly ModuleDescriptor[]
): readonly ModuleCompositionIssue[] {
  const dagResult = validateModuleDependencyGraph(registry);

  return [
    ...(dagResult.valid ? [] : dagResult.issues),
    ...checkDuplicateModuleKeys(registry),
    ...checkCapabilityBindings(registry),
    ...checkDeploymentProfiles(registry),
    ...checkNavigationPaths(registry),
    ...checkJobDescriptors(registry)
  ];
}

/**
 * Convenience wrapper. `registry` is always echoed back (even when
 * `valid: false`) so a caller can inspect it for diagnostics — never treat it
 * as safe to ship/sync when `valid` is `false`.
 */
export function composeModuleRegistry(
  registry: readonly ModuleDescriptor[]
): ModuleCompositionResult {
  const issues = validateComposedModuleRegistry(registry);

  return issues.length > 0
    ? { valid: false, registry, issues }
    : { valid: true, registry };
}

export type ComposedModuleInventoryEntry = {
  key: string;
  name: string;
  version: string;
  status: string;
  type: string | null;
  dependencies: readonly string[];
  capabilitiesProvided: readonly string[];
  capabilitiesConsumed: readonly {
    capability: string;
    providedBy: string;
    optional: boolean;
  }[];
  permissionCount: number;
  navigationCount: number;
  jobCount: number;
  hasHealthCheck: boolean;
  hasReadinessCheck: boolean;
  deploymentProfiles: readonly string[] | null;
};

export type ComposedModuleInventory = {
  moduleCount: number;
  valid: boolean;
  issueCount: number;
  modules: readonly ComposedModuleInventoryEntry[];
};

function toInventoryEntry(
  module: ModuleDescriptor
): ComposedModuleInventoryEntry {
  return {
    key: module.key,
    name: module.name,
    version: module.version,
    status: module.status,
    type: module.type ?? null,
    dependencies: module.dependencies,
    capabilitiesProvided: module.capabilities?.provides ?? [],
    capabilitiesConsumed: (module.capabilities?.consumes ?? []).map((c) => ({
      capability: c.capability,
      providedBy: c.providedBy,
      optional: c.optional ?? false
    })),
    permissionCount: module.permissions?.length ?? 0,
    navigationCount: module.navigation?.length ?? 0,
    jobCount: module.jobs?.length ?? 0,
    hasHealthCheck: module.health?.hasHealthCheck ?? false,
    hasReadinessCheck: module.health?.hasReadinessCheck ?? false,
    deploymentProfiles: module.compatibility?.deploymentProfiles ?? null
  };
}

/**
 * Deterministic, machine-readable module inventory for CI/release evidence.
 * No wall-clock timestamp embedded — a pure function of committed source,
 * enforced by `scripts/module-composition-inventory-check.ts`'s
 * regenerate-and-diff gate. `modules` is sorted by `key` so two runs against
 * the same input always produce byte-identical JSON, independent of
 * registration order.
 */
export function buildComposedModuleInventory(
  registry: readonly ModuleDescriptor[]
): ComposedModuleInventory {
  const result = composeModuleRegistry(registry);

  const modules = result.registry
    .map((m) => toInventoryEntry(m))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    moduleCount: result.registry.length,
    valid: result.valid,
    issueCount: result.valid ? 0 : result.issues.length,
    modules
  };
}
