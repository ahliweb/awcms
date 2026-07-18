/**
 * In-repo fixture `ApplicationModuleRegistry` (Issue #178, epic #177
 * "Kesiapan fondasi ERP turunan", Wave 1) — illustrates exactly what a real
 * derived repository would export from ITS OWN
 * `src/modules/application-registry.ts` (see that file in this repo for the
 * base's own, always-`undefined`, shipped version). Consumed ONLY by
 * `tests/module-composition-fixture.test.ts` — never imported by
 * `src/modules/application-registry.ts` or `src/modules/index.ts`
 * themselves, since the base repository's own build must keep shipping
 * `undefined` there (a default base build produces the same effective
 * registry as before Issue #178).
 *
 * `migrationNamespace` reserves `900-999`, comfortably above the base's own
 * reserved `1-899` (`module-management/domain/module-composition.ts`'s
 * `BASE_MODULE_MIGRATION_NAMESPACE`) — a real derived repository's own `sql/`
 * directory would number its migrations starting at `900` under this same
 * convention, guaranteeing zero numbering collisions with the base by
 * construction.
 */
import type { ApplicationModuleRegistry } from "../../../src/modules/_shared/module-contract";
import { exampleCrmModule } from "./modules/example-crm/module";

export const exampleApplicationModuleRegistry: ApplicationModuleRegistry = {
  id: "derived-application-example-fixture",
  modules: [exampleCrmModule],
  migrationNamespace: {
    label: "derived-application-example fixture",
    rangeStart: 900,
    rangeEnd: 999
  }
};
