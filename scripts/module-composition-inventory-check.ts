/**
 * Read-only freshness gate for
 * `docs/awcms/module-composition-inventory.json` (Issue #178, epic #177
 * "Kesiapan fondasi ERP turunan", Wave 1, ADR-0025).
 *
 * `scripts/module-composition-inventory-generate.ts` (`bun run
 * modules:composition:inventory:generate`) regenerates the composed inventory
 * from the module registry — but it's a MUTATION (it rewrites the file), so
 * it can't be part of `bun run check` directly. This script is the read-only
 * twin: it regenerates the JSON in memory and diffs it against the COMMITTED
 * file, failing loudly if a module/capability/permission/navigation/job/
 * health/migration-namespace/deployment-profile change landed without
 * regenerating and committing the composed inventory.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  MODULE_COMPOSITION_INVENTORY_PATH,
  buildModuleCompositionInventoryJson
} from "./module-composition-inventory-generate";

export async function runModuleCompositionInventoryCheck(
  rootDir = process.cwd()
): Promise<string[]> {
  const committedPath = path.join(rootDir, MODULE_COMPOSITION_INVENTORY_PATH);

  let committed: string;
  try {
    committed = await readFile(committedPath, "utf8");
  } catch {
    return [
      `${MODULE_COMPOSITION_INVENTORY_PATH} is missing — run \`bun run modules:composition:inventory:generate\` and commit the result.`
    ];
  }

  const fresh = await buildModuleCompositionInventoryJson(rootDir);

  if (fresh === committed) return [];

  return [
    `${MODULE_COMPOSITION_INVENTORY_PATH} does not match a fresh regeneration from the composed module registry — run \`bun run modules:composition:inventory:generate\` and commit the result.`
  ];
}

if (import.meta.main) {
  const problems = await runModuleCompositionInventoryCheck();

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(problem);
    }
    console.error(
      `\nmodules:composition:inventory:check GAGAL — ${problems.length} temuan.`
    );
    process.exitCode = 1;
  } else {
    console.log(
      "modules:composition:inventory:check OK — docs/awcms/module-composition-inventory.json matches a fresh regeneration."
    );
  }
}
