/**
 * domain-event-consumers-check.ts — `bun run domain-events:consumers:check`.
 *
 * ADR-0134 (Issue #918). Pure code-registry gate, no network and no database,
 * same shape as `site-search:sources:check` and
 * `reporting:projections:registry:check`. Three things, all derived from
 * `listModules()` and `src/`:
 *
 * 1. Every module's `domainEventConsumers` passes the SAME validator the runtime
 *    runs at registry build time (duplicate name, subscribing to an event type
 *    no module publishes, missing `domain_event_runtime` dependency, malformed
 *    versions, `self_managed` without a rationale), and the registry actually
 *    BUILDS from them.
 * 2. The consumer names that already shipped are still declared. A name keys
 *    delivery rows and the effect ledger, so a rename is not a refactor: pending
 *    deliveries are orphaned and every effect runs again.
 * 3. Nothing outside the runtime calls `applyConsumerEffectOnce` itself,
 *    imports its module (`application/consumer-effect`), or names the ledger
 *    table `awcms_domain_event_consumer_effects`.
 *    Idempotency is applied BY the registry, to a consumer's `handle`, keyed
 *    `(tenant, consumer name, event id)`. A `handle` that ALSO claims that
 *    marker finds it already taken, sees `applied: false`, and silently skips
 *    its own effect — green, wrong, and invisible. Emitted-once is not
 *    handled-once; the answer is one guard in one place, not two.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { listModules } from "../src/modules";
import {
  collectDeclaredDomainEventConsumers,
  formatDomainEventConsumerIssue,
  validateDomainEventConsumerDeclarations
} from "../src/modules/domain-event-runtime/domain/consumer-declarations";
import { buildDomainEventConsumerRegistry } from "../src/modules/domain-event-runtime/infrastructure/consumer-registry";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import { stripComments } from "./lib/source-text";

/**
 * Names that have shipped. Append-only: a consumer retired for real is removed
 * here in the same PR that retires it, with the migration that deals with its
 * pending deliveries — never silently by rename.
 */
export const SHIPPED_CONSUMER_NAMES: readonly string[] = [
  "domain_event_runtime.activity_rollup_projector",
  "logging.sample_event_audit_projector",
  "reporting.event_activity_projector"
];

/** The only files that may mention the helper in code, or import its module: its definition and the registry that applies it. */
const EFFECT_GUARD_ALLOWED_FILES: readonly string[] = [
  "src/modules/domain-event-runtime/application/consumer-effect.ts",
  "src/modules/domain-event-runtime/infrastructure/consumer-registry.ts"
];

/** The effect-ledger table. Also named, as descriptor metadata only, by the runtime's own `module.ts` (`subjectData`). */
const EFFECT_LEDGER_TABLE = "awcms_domain_event_consumer_effects";
const EFFECT_LEDGER_TABLE_ALLOWED_FILES: readonly string[] = [
  ...EFFECT_GUARD_ALLOWED_FILES,
  "src/modules/domain-event-runtime/module.ts"
];

/** An import of the helper's module (any relative spelling) ends in `consumer-effect`. */
const CONSUMER_EFFECT_IMPORT = /consumer-effect["'`]/;

export function findMissingShippedConsumers(
  modules: readonly ModuleDescriptor[],
  shipped: readonly string[] = SHIPPED_CONSUMER_NAMES
): string[] {
  const declared = new Set(
    collectDeclaredDomainEventConsumers(modules).map(
      (entry) => entry.declaration.name
    )
  );

  return shipped.filter((name) => !declared.has(name));
}

export function findEffectGuardBypasses(
  files: readonly { path: string; text: string }[]
): string[] {
  const offenders = new Set<string>();

  for (const file of files) {
    const code = stripComments(file.text);
    const guardAllowed = EFFECT_GUARD_ALLOWED_FILES.includes(file.path);

    if (
      !guardAllowed &&
      (code.includes("applyConsumerEffectOnce") ||
        CONSUMER_EFFECT_IMPORT.test(code))
    ) {
      offenders.add(file.path);
    }

    if (
      !EFFECT_LEDGER_TABLE_ALLOWED_FILES.includes(file.path) &&
      code.includes(EFFECT_LEDGER_TABLE)
    ) {
      offenders.add(file.path);
    }
  }

  return [...offenders].sort();
}

function listSourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    const info = statSync(full);

    if (info.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (/\.(ts|astro)$/.test(entry)) {
      found.push(full);
    }
  }

  return found;
}

function main(): void {
  const failures: string[] = [];
  const modules = listModules();
  const result = validateDomainEventConsumerDeclarations(modules);

  for (const issue of result.issues) {
    failures.push(formatDomainEventConsumerIssue(issue));
  }

  if (result.valid) {
    try {
      buildDomainEventConsumerRegistry(modules);
    } catch (error) {
      failures.push(
        `registry failed to build: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  for (const name of findMissingShippedConsumers(modules)) {
    failures.push(
      `[${name}] a shipped consumer is no longer declared — renaming or dropping one orphans its pending deliveries and re-runs its effects.`
    );
  }

  const bypasses = findEffectGuardBypasses(
    listSourceFiles("src").map((file) => ({
      path: file.split(path.sep).join("/"),
      text: readFileSync(file, "utf8")
    }))
  );
  for (const file of bypasses) {
    failures.push(
      `${file} references applyConsumerEffectOnce, its module, or the awcms_domain_event_consumer_effects ledger. The registry already applies it to a consumer's handle; a second claim on the same (tenant, consumer, event) marker makes the effect silently never run. Declare the consumer with the default idempotency and drop the call (or declare "self_managed" with a rationale and use your own ledger).`
    );
  }

  if (failures.length > 0) {
    console.error(
      `domain-events:consumers:check FAILED — ${failures.length} problem(s):`
    );
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `domain-events:consumers:check OK — ${result.consumers.length} descriptor-declared consumer(s) are valid, unique, subscribed to published events, and idempotency-guarded by the registry.`
  );
}

if (import.meta.main) {
  main();
}
