/**
 * data-lifecycle-registry-check.ts — `bun run data-lifecycle:registry:check`.
 *
 * ADR-0037 (ported from awcms-micro Issue #745). High-volume table registry
 * validation gate — same shape as `scripts/validate-module-graph.ts` (`bun run
 * modules:dag:check`) and `scripts/identity-access-sod-registry-check.ts`.
 *
 * ## Why this gate is no longer pure (ADR-0076)
 *
 * It validates a SECOND registry now: the descriptors for tables owned by
 * `src/lib/` infrastructure rather than by a module. That registry's real
 * danger is not a malformed descriptor — the shape validator catches those —
 * but a table being parked there because writing its descriptor in the owning
 * module was inconvenient. No rule written in prose prevents that.
 *
 * So the gate asks the filesystem instead, with the SAME function
 * `modules:table-writes:check` uses to answer "who writes this table"
 * (`ownerOfFile`). A table whose writers are a module cannot be declared
 * infrastructure, and a table nothing writes cannot either. Wrong ownership
 * becomes unstateable in both directions, which is what Issue #479 asked for.
 *
 * The cost is one `src/` scan per run, in a gate that used to touch nothing.
 * It is paid deliberately: `data-lifecycle:table-coverage:check`, its immediate
 * neighbour in the chain, already reads `sql/` for the same kind of reason.
 */
import { listModules } from "../src/modules";
import {
  formatLifecycleRegistryIssue,
  validateLifecycleRegistry
} from "../src/modules/data-lifecycle/domain/lifecycle-registry";
import {
  findInfrastructureOwnershipProblems,
  INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
  validateInfrastructureLifecycleRegistry
} from "../src/modules/data-lifecycle/domain/infrastructure-lifecycle-registry";
import {
  collectTableWrites,
  INFRASTRUCTURE_OWNER
} from "./table-write-ownership-check";

async function main(): Promise<void> {
  const modules = listModules();
  const moduleResult = validateLifecycleRegistry(modules);

  const infrastructureResult = validateInfrastructureLifecycleRegistry(
    INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
    moduleResult.descriptors.map((descriptor) => descriptor.tableName),
    modules.map((module) => module.key)
  );

  // Only worth scanning `src/` when there is something to attribute. With an
  // empty infrastructure registry this gate stays as pure as it always was.
  const ownershipIssues =
    INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS.length === 0
      ? []
      : findInfrastructureOwnershipProblems(
          INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
          await collectTableWrites(),
          INFRASTRUCTURE_OWNER
        );

  const issues = [
    ...moduleResult.issues,
    ...infrastructureResult.issues,
    ...ownershipIssues
  ];

  if (issues.length === 0) {
    console.log(
      `data-lifecycle:registry:check OK — ${moduleResult.descriptors.length} deskriptor milik modul ` +
        `+ ${INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS.length} deskriptor milik infrastruktur, semuanya valid ` +
        "(kepemilikan infrastruktur diverifikasi terhadap penulis nyata di `src/`)."
    );
    return;
  }

  console.error("data-lifecycle:registry:check FAILED —");
  for (const issue of issues) {
    console.error(`  ${formatLifecycleRegistryIssue(issue)}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
