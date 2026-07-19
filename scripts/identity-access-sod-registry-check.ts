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
 * `listModules()` IS the composed registry (base + whatever
 * `src/modules/application-registry.ts` contributes) — so this gate validates
 * the MERGED registry: in a pure base it validates the base's rules (none —
 * the base ships no domain SoD rules), and in a derived application it
 * validates base + application rules together. SoD registry DRIFT (a duplicate
 * `ruleKey`, an `ownerModuleKey` that does not match the declaring module, a
 * rule with fewer than 2 conflicting keys, an invalid enum, ...) makes this
 * gate — and therefore CI — RED (issue #181: "SoD registry drift membuat CI
 * merah"; "Rule registry derived module wajib tervalidasi saat build/CI").
 *
 * The illustrative rules the base repository ships live in the fixture
 * `tests/fixtures/derived-application-example/` (NOT in any base module), so
 * they are validated by `tests/sod-rule-registry.test.ts` (which composes the
 * fixture with the base and runs the same validator) rather than by this gate
 * on the base-only registry — this gate is what turns a REAL derived
 * application's registry drift red.
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
