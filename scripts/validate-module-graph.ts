/**
 * validate-module-graph.ts — `bun run modules:dag:check`.
 *
 * Gate DAG lintas-registry: gagal keras bila ada module descriptor yang
 * memperkenalkan self-dependency, dependency ganda, key dependency yang
 * hilang, atau siklus (langsung/tidak langsung). Tanpa I/O, network, atau
 * database — validasi murni code-registry (`listModules()`), aman dijalankan
 * di setiap CI build dan sebelum sinkronisasi registry modul ke database.
 * Lihat `src/modules/_shared/module-dependency-graph.ts`.
 */
import { listModules } from "../src/modules";
import {
  formatModuleDependencyGraphIssue,
  validateModuleDependencyGraph
} from "../src/modules/_shared/module-dependency-graph";

function main(): void {
  const result = validateModuleDependencyGraph(listModules());

  if (result.valid) {
    console.log(
      `modules:dag:check OK — ${listModules().length} modul terdaftar membentuk DAG yang valid.`
    );
    return;
  }

  console.error("modules:dag:check GAGAL —");
  for (const issue of result.issues) {
    console.error(`  ${formatModuleDependencyGraphIssue(issue)}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
