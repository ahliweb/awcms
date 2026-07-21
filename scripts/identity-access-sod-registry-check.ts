/**
 * identity-access-sod-registry-check.ts — `bun run
 * identity-access:sod-registry:check`.
 *
 * Issue #181 (epic #177 Wave 2 authorization). Static SoD rule registry
 * validation gate — same shape as `scripts/reporting-projection-registry-check.ts`
 * (`bun run reporting:projections:registry:check`): pure code-registry
 * (`listModules()`) validation, no I/O, no network, no database, safe to run
 * on every CI build.
 *
 * `listModules()` IS the module registry — so this gate validates whatever
 * SoD rules the registered modules declare. In a pure base it validates the
 * base's rules (none — the base ships no domain SoD rules); once a domain
 * module with `sodRules` is added directly to `src/modules/`, this gate
 * validates its rules too. SoD registry DRIFT (a duplicate `ruleKey`, an
 * `ownerModuleKey` that does not match the declaring module, a rule with fewer
 * than 2 conflicting keys, an invalid enum, ...) makes this gate — and
 * therefore CI — RED (issue #181: "SoD registry drift membuat CI merah").
 *
 * The base ships ZERO domain SoD rules, so the illustrative rules live in the
 * test-support fixture `tests/fixtures/example-domain-modules/` (NOT in any
 * base module) and are validated by `tests/sod-rule-registry.test.ts` (which
 * composes the fixture with the base and runs the same validator), rather than
 * by this gate on the base-only registry.
 */
import { listModules } from "../src/modules";
import {
  formatSoDRuleRegistryIssue,
  validateSoDRuleRegistry
} from "../src/modules/identity-access/domain/sod-rule-registry";

function main(): void {
  const result = validateSoDRuleRegistry(listModules());

  if (result.valid) {
    console.log(
      `identity-access:sod-registry:check OK — ${result.rules.length} registered SoD rule(s) are valid.`
    );
    return;
  }

  console.error("identity-access:sod-registry:check FAILED —");
  for (const issue of result.issues) {
    console.error(`  ${formatSoDRuleRegistryIssue(issue)}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
