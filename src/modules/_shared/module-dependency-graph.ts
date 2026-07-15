/**
 * Registry-wide module dependency-graph validation (base primitive,
 * diadaptasi dari awcms-mini `module-management/domain/module-dependency-graph.ts`).
 *
 * Ini adalah gate build-time yang memvalidasi SELURUH registry modul
 * (`listModules()`) sebagai satu graf: begitu modul ERP baru ditambahkan
 * dengan `dependencies`, gate ini menolak keras bila ada self-dependency,
 * dependency ganda, dependency ke key yang tidak terdaftar, atau siklus
 * (langsung maupun tidak langsung). Murni kode — tanpa I/O, network, atau
 * database — aman dijalankan di setiap CI build (`bun run modules:dag:check`,
 * `scripts/validate-module-graph.ts`).
 *
 * Empat masalah dideteksi independen (semuanya muncul di `issues`, tidak
 * berhenti di temuan pertama):
 * - `self_dependency` — modul mencantumkan dirinya sendiri.
 * - `duplicate_dependency` — key yang sama diulang dalam satu array
 *   `dependencies`.
 * - `missing_dependency` — key yang bukan `key` modul mana pun.
 * - `cycle` — satu/lebih modul yang rantai dependensinya tidak pernah
 *   berujung (dideteksi registry-wide via algoritma Kahn: berulang kali
 *   buang node yang seluruh dependensinya sudah teratasi; sisa yang tak
 *   pernah teratasi, per definisi, ada di dalam siklus). `path` adalah
 *   rantai module-key yang bisa dibaca manusia; module key adalah
 *   identifier kode statis, bukan secret/data tenant, aman dicetak verbatim.
 *
 * Self-dependency dan duplikat dikeluarkan dari edge yang dijalani Kahn
 * (sudah dilaporkan sebagai issue-nya sendiri) agar self-loop atau key
 * berulang tidak memanufaktur laporan `cycle` palsu di atas issue yang lebih
 * spesifik.
 */
import type { ModuleDescriptor } from "./module-contract";

export type ModuleDependencyGraphIssue =
  | { type: "self_dependency"; moduleKey: string }
  | { type: "duplicate_dependency"; moduleKey: string; dependencyKey: string }
  | { type: "missing_dependency"; moduleKey: string; dependencyKey: string }
  | { type: "cycle"; path: readonly string[] };

export type ModuleDependencyGraphValidationResult =
  | { valid: true }
  | { valid: false; issues: readonly ModuleDependencyGraphIssue[] };

export function formatModuleDependencyGraphIssue(
  issue: ModuleDependencyGraphIssue
): string {
  switch (issue.type) {
    case "self_dependency":
      return `Module "${issue.moduleKey}" declares itself as its own dependency.`;
    case "duplicate_dependency":
      return `Module "${issue.moduleKey}" declares dependency "${issue.dependencyKey}" more than once.`;
    case "missing_dependency":
      return `Module "${issue.moduleKey}" depends on "${issue.dependencyKey}", which is not a registered module.`;
    case "cycle":
      return `Circular dependency: ${issue.path.join(" -> ")}.`;
  }
}

/** DFS dibatasi ke himpunan node yang sudah diketahui siklik, memakai recursion stack saat ini untuk menemukan di mana sebuah walk pertama kali mengunjungi ulang node yang masih di stack — suffix itu (plus node yang diulang) adalah cycle path sungguhan. */
function findCyclePath(
  cyclicKeys: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>
): string[] {
  const cyclicSet = new Set(cyclicKeys);
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();
  let found: string[] | null = null;

  function walk(key: string): void {
    if (found) {
      return;
    }

    stack.push(key);
    onStack.add(key);
    visited.add(key);

    for (const dep of edges.get(key) ?? []) {
      if (!cyclicSet.has(dep)) {
        continue;
      }

      if (onStack.has(dep)) {
        const cycleStart = stack.indexOf(dep);
        found = [...stack.slice(cycleStart), dep];
        return;
      }

      if (!visited.has(dep)) {
        walk(dep);
        if (found) {
          return;
        }
      }
    }

    stack.pop();
    onStack.delete(key);
  }

  walk(cyclicKeys[0]!);
  return found ?? [...cyclicKeys, cyclicKeys[0]!];
}

export function validateModuleDependencyGraph(
  descriptors: readonly ModuleDescriptor[]
): ModuleDependencyGraphValidationResult {
  const issues: ModuleDependencyGraphIssue[] = [];
  const descriptorByKey = new Map(descriptors.map((d) => [d.key, d]));

  // `validEdges` mengecualikan self-dependency dan duplikat (sudah
  // dilaporkan) DAN key yang hilang (juga sudah dilaporkan, dan kalau tidak
  // dikecualikan akan membuat setiap node yang menyentuhnya tampak
  // unresolved-selamanya di pass Kahn di bawah, menutupi siklus REAL sebagai
  // "cycle" palsu berbentuk missing-dependency).
  const validEdges = new Map<string, string[]>();

  for (const descriptor of descriptors) {
    const seen = new Set<string>();
    const edges: string[] = [];

    for (const dependencyKey of descriptor.dependencies) {
      if (dependencyKey === descriptor.key) {
        issues.push({ type: "self_dependency", moduleKey: descriptor.key });
        continue;
      }

      if (seen.has(dependencyKey)) {
        issues.push({
          type: "duplicate_dependency",
          moduleKey: descriptor.key,
          dependencyKey
        });
        continue;
      }
      seen.add(dependencyKey);

      if (!descriptorByKey.has(dependencyKey)) {
        issues.push({
          type: "missing_dependency",
          moduleKey: descriptor.key,
          dependencyKey
        });
        continue;
      }

      edges.push(dependencyKey);
    }

    validEdges.set(descriptor.key, edges);
  }

  // Algoritma Kahn: sebuah node "resolvable" begitu setiap dependency-nya
  // (via `validEdges`) sudah resolved. Resolve berulang semua yang siap;
  // yang tak pernah siap, per definisi, bagian dari siklus.
  const resolved = new Set<string>();
  let progressed = true;

  while (progressed) {
    progressed = false;

    for (const descriptor of descriptors) {
      if (resolved.has(descriptor.key)) {
        continue;
      }

      const deps = validEdges.get(descriptor.key) ?? [];
      if (deps.every((dep) => resolved.has(dep))) {
        resolved.add(descriptor.key);
        progressed = true;
      }
    }
  }

  const cyclic = descriptors
    .map((d) => d.key)
    .filter((key) => !resolved.has(key));

  if (cyclic.length > 0) {
    issues.push({ type: "cycle", path: findCyclePath(cyclic, validEdges) });
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true };
}
