/**
 * module-composition-inventory-generate.ts — `bun run
 * modules:composition:inventory:generate`.
 *
 * Generates a single, deterministic, machine-readable snapshot of the reviewed
 * base module registry (`listBaseModules()`) for CI/release evidence —
 * `docs/awcms/module-composition-inventory.json`.
 *
 * Pure function of committed source, no wall-clock timestamp — enforced by
 * the read-only twin, `scripts/module-composition-inventory-check.ts`
 * (`bun run modules:composition:inventory:check`, part of `bun run check`).
 *
 * Local/offline only: no network access, no external CLI — pure in-memory
 * computation over the already-imported module registry.
 */
import prettier from "prettier";

import { listBaseModules } from "../src/modules";
import { buildComposedModuleInventory } from "../src/modules/module-management/domain/module-composition";

export const MODULE_COMPOSITION_INVENTORY_PATH =
  "docs/awcms/module-composition-inventory.json";

/**
 * Runs the raw JSON through this project's own Prettier config before
 * returning — without it, every regeneration would need a separate manual
 * `bun run format` pass, and the committed file would drift from what
 * `module-composition-inventory-check.ts` regenerates in memory (`bun run
 * lint`/`bun run format` already enforce Prettier style on every committed
 * `.json` file repo-wide).
 */
export async function buildModuleCompositionInventoryJson(
  rootDir = process.cwd()
): Promise<string> {
  const inventory = buildComposedModuleInventory(listBaseModules());

  const raw = JSON.stringify(inventory, null, 2);
  const filepath = `${rootDir}/${MODULE_COMPOSITION_INVENTORY_PATH}`;
  const config = (await prettier.resolveConfig(filepath)) ?? {};

  return prettier.format(raw, { ...config, filepath, parser: "json" });
}

if (import.meta.main) {
  const { writeFile } = await import("node:fs/promises");
  const json = await buildModuleCompositionInventoryJson();
  await writeFile(MODULE_COMPOSITION_INVENTORY_PATH, json, "utf8");
  console.log(
    `Diperbarui: ${MODULE_COMPOSITION_INVENTORY_PATH}. Jalankan \`bun run modules:composition:inventory:check\` untuk verifikasi.`
  );
}
