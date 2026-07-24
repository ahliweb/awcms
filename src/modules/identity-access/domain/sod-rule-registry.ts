/**
 * Static SoD rule registry validation gate (Issue #181, epic #177 Wave 2
 * authorization). Ported from awcms-mini
 * (`identity-access/domain/sod-rule-registry.ts`, Issue #746). Pure
 * code-registry validation — no I/O, no database, no network — the same shape
 * as `reporting/domain/projection-registry.ts`'s `validateProjectionRegistry`,
 * which `scripts/reporting-projection-registry-check.ts` already wires into
 * `bun run check`. This file's `validateSoDRuleRegistry` is wired the same way
 * by `scripts/identity-access-sod-registry-check.ts` (`bun run
 * identity-access:sod-registry:check`).
 *
 * Every `SoDRuleDescriptor` is declared by its OWNING module's own `module.ts`
 * (`ModuleDescriptor.sodRules`, see `_shared/module-contract.ts`) — this file
 * only AGGREGATES (`collectSoDRuleDescriptors`) and VALIDATES what modules
 * already declared. It never invents a rule and never reaches into another
 * module's schema. The BASE ships no domain *business* rules (issue #181
 * out-of-scope); the illustrative business rules live in the test-support
 * fixture `tests/fixtures/example-domain-modules/`. It DOES ship one
 * System-Foundation governance rule — `data_lifecycle.legal_hold_maker_checker`
 * (ADR-0037), a module-owned maker/checker over `data_lifecycle`'s own
 * permissions. The gate validates whatever the `listModules()` registry
 * contains.
 */
import type {
  ModuleDescriptor,
  SoDRuleDescriptor
} from "../../_shared/module-contract";

const RULE_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const PERMISSION_KEY_PATTERN =
  /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export const VALID_SCOPE_APPLICABILITIES: readonly string[] = [
  "any",
  "same_scope_only",
  "global_within_tenant"
];

export const VALID_SEVERITIES: readonly string[] = [
  "low",
  "medium",
  "high",
  "critical"
];

export type SoDRuleRegistryIssue = {
  ruleKey: string;
  message: string;
};

export function formatSoDRuleRegistryIssue(
  issue: SoDRuleRegistryIssue
): string {
  return `[${issue.ruleKey}] ${issue.message}`;
}

/** Flattens every registered module's own `sodRules` array into one list — order follows `modules` (i.e. `listModules()`), stable and deterministic. */
export function collectSoDRuleDescriptors(
  modules: readonly ModuleDescriptor[]
): SoDRuleDescriptor[] {
  return modules.flatMap((module) => module.sodRules ?? []);
}

function validateSingleRule(
  ownerModule: ModuleDescriptor,
  rule: SoDRuleDescriptor
): SoDRuleRegistryIssue[] {
  const issues: SoDRuleRegistryIssue[] = [];
  const push = (message: string) =>
    issues.push({ ruleKey: rule.ruleKey || "(missing key)", message });

  if (!rule.ruleKey || !RULE_KEY_PATTERN.test(rule.ruleKey)) {
    push(
      `ruleKey must be non-empty and match "<module_key>.<rule_shortname>" (got ${JSON.stringify(rule.ruleKey)}).`
    );
  }

  if (rule.ownerModuleKey !== ownerModule.key) {
    push(
      `ownerModuleKey (${JSON.stringify(rule.ownerModuleKey)}) must equal the declaring module's own key (${JSON.stringify(ownerModule.key)}) — a module must not declare a rule it claims another module owns.`
    );
  }

  if (!rule.description) {
    push("description is required.");
  }

  if (
    !Array.isArray(rule.conflictingPermissionKeys) ||
    rule.conflictingPermissionKeys.length < 2
  ) {
    push("conflictingPermissionKeys must declare at least 2 permission keys.");
  } else {
    for (const key of rule.conflictingPermissionKeys) {
      if (!PERMISSION_KEY_PATTERN.test(key)) {
        push(
          `conflictingPermissionKeys entry ${JSON.stringify(key)} is not a valid "module.activity.action" permission key.`
        );
      }
    }
    if (
      new Set(rule.conflictingPermissionKeys).size !==
      rule.conflictingPermissionKeys.length
    ) {
      push("conflictingPermissionKeys must not contain duplicates.");
    }
  }

  if (!VALID_SCOPE_APPLICABILITIES.includes(rule.scopeApplicability)) {
    push(
      `scopeApplicability ${JSON.stringify(rule.scopeApplicability)} is not one of ${VALID_SCOPE_APPLICABILITIES.join(", ")}.`
    );
  }

  if (!VALID_SEVERITIES.includes(rule.severity)) {
    push(
      `severity ${JSON.stringify(rule.severity)} is not one of ${VALID_SEVERITIES.join(", ")}.`
    );
  }

  if (!rule.exceptionPolicy) {
    push("exceptionPolicy is required.");
  } else {
    const { allowed, requiresApprovalPermission, maxDurationDays } =
      rule.exceptionPolicy;

    if (allowed) {
      if (
        !requiresApprovalPermission ||
        !PERMISSION_KEY_PATTERN.test(requiresApprovalPermission)
      ) {
        push(
          "exceptionPolicy.requiresApprovalPermission is required and must be a valid permission key when exceptionPolicy.allowed is true."
        );
      }
      if (
        !Number.isFinite(maxDurationDays) ||
        (maxDurationDays as number) <= 0
      ) {
        push(
          "exceptionPolicy.maxDurationDays must be a positive number when exceptionPolicy.allowed is true."
        );
      }
    } else {
      if (requiresApprovalPermission !== undefined) {
        push(
          "exceptionPolicy.requiresApprovalPermission must not be set when exceptionPolicy.allowed is false."
        );
      }
      if (maxDurationDays !== undefined) {
        push(
          "exceptionPolicy.maxDurationDays must not be set when exceptionPolicy.allowed is false."
        );
      }
    }
  }

  return issues;
}

export type SoDRuleRegistryValidationResult = {
  valid: boolean;
  issues: SoDRuleRegistryIssue[];
  rules: readonly SoDRuleDescriptor[];
};

/**
 * Validates the WHOLE registry: per-rule structural validity
 * (`validateSingleRule`) plus a cross-rule invariant (unique `ruleKey` across
 * the whole registry — a rule must never be registered twice, which would make
 * the gate red on drift).
 */
export function validateSoDRuleRegistry(
  modules: readonly ModuleDescriptor[]
): SoDRuleRegistryValidationResult {
  const issues: SoDRuleRegistryIssue[] = [];
  const allRules: SoDRuleDescriptor[] = [];
  const seenKeys = new Map<string, number>();

  for (const module of modules) {
    for (const rule of module.sodRules ?? []) {
      allRules.push(rule);
      issues.push(...validateSingleRule(module, rule));

      seenKeys.set(rule.ruleKey, (seenKeys.get(rule.ruleKey) ?? 0) + 1);
    }
  }

  for (const [ruleKey, count] of seenKeys) {
    if (count > 1) {
      issues.push({
        ruleKey,
        message: `ruleKey is registered ${count} times — rule keys must be unique across the whole registry.`
      });
    }
  }

  return { valid: issues.length === 0, issues, rules: allRules };
}
