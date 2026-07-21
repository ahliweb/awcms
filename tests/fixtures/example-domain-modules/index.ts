/**
 * In-repo TEST-SUPPORT example domain modules.
 *
 * A small, self-contained set of illustrative DOMAIN modules used ONLY by
 * tests to exercise the base enforcement machinery against realistic module
 * metadata the reviewed base itself deliberately never ships:
 *
 *   - Segregation-of-duties rules (Issue #181) — the base ships ZERO domain
 *     SoD rules, so the illustrative conflicting-permission pairs live here
 *     and are composed with the base registry to prove
 *     `identity-access/domain/sod-rule-registry.ts` validates them.
 *   - A business-scope hierarchy resolver (Issue #180) — the base ships a
 *     fail-closed no-op resolver, so this fixture supplies a concrete
 *     in-memory adapter (`modules/example-crm/business-scope-hierarchy-adapter.ts`)
 *     to exercise the `BusinessScopeHierarchyPort` contract.
 *   - An OpenAPI fragment (Issue #182) — proves an additional module fragment
 *     merges into the bundle through `buildBundledDocument`'s
 *     `extraFragmentFiles` seam without editing any base fragment.
 *   - Module-composition validation (Issue #178) — proves the composition
 *     rule engine validates a registry that includes an example domain module.
 *
 * These modules are NEVER registered in the real base registry
 * (`src/modules/index.ts`) — they are imported only by the tests that need
 * example domain metadata to assert base enforcement behavior against.
 */
import type { ModuleDescriptor } from "../../../src/modules/_shared/module-contract";
import { exampleCrmModule } from "./modules/example-crm/module";

/** The example domain modules a test composes with `listBaseModules()`. */
export const exampleDomainModules: readonly ModuleDescriptor[] = [
  exampleCrmModule
];
