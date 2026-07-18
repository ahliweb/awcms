/**
 * Build-time extension point for a derived/downstream repository (Issue
 * #178, epic #177 "Kesiapan fondasi ERP turunan", Wave 1, ADR-0025).
 *
 * A derived repository forks/vendors this base repository, then REPLACES the
 * export below with its own `ApplicationModuleRegistry` — this is the ONLY
 * file a derived repository needs to edit to contribute application modules
 * to the final composed registry. `src/modules/index.ts` (the reviewed base
 * composition root) stays completely untouched, and so does every individual
 * base `module.ts` — exactly the guardrail ADR-0013 §5/§9 and
 * `docs/awcms/derived-application-guide.md` require ("derived applications
 * must not directly edit the base module registry").
 *
 * Still 100% static, compile-time TypeScript, resolved and bundled at
 * `bun run build`/`bun run typecheck` time like every other import in this
 * repo — no runtime discovery, file upload, package scanning, `eval`, or
 * untrusted code loading. `src/modules/index.ts` imports this file
 * unconditionally and merges whatever it exports
 * (`module-management/domain/module-composition.ts`'s `mergeModuleRegistries`)
 * into the effective registry `listModules()` returns.
 *
 * This base repository's own build ships `undefined` here — see
 * `src/modules/index.ts`'s own comment for why that keeps `listModules()`
 * byte-identical to its pre-#178 value (a default base build produces the
 * same effective registry as before this change).
 *
 * A real derived repository would instead do something like:
 *
 * ```ts
 * import type { ApplicationModuleRegistry } from "./_shared/module-contract";
 * import { salesModule } from "./sales/module";
 * import { inventoryModule } from "./inventory/module";
 *
 * export const applicationModuleRegistry: ApplicationModuleRegistry = {
 *   id: "awpos",
 *   modules: [salesModule, inventoryModule],
 *   migrationNamespace: { label: "awpos", rangeStart: 900, rangeEnd: 999 }
 * };
 * ```
 *
 * See `tests/fixtures/derived-application-example/` for a working, in-repo
 * illustration of exactly this shape (used only by tests — never wired in
 * here, since this file must stay `undefined` for the base repository's own
 * shipped behavior to remain unchanged).
 */
import type { ApplicationModuleRegistry } from "./_shared/module-contract";

export const applicationModuleRegistry: ApplicationModuleRegistry | undefined =
  undefined;
