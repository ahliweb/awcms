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
import { readdir } from "node:fs/promises";

import { listModules } from "../src/modules";
import {
  formatModuleDependencyGraphIssue,
  validateModuleDependencyGraph
} from "../src/modules/_shared/module-dependency-graph";

const LIB_ROOT = "src/lib";

/**
 * `src/lib/<x>` names that mean a module even though they are not spelled like
 * its key. Without these, two of the four real cases would have slipped through
 * (`seo` and `search`) — awcms-micro found the same thing when it built this
 * check (ADR-0038 there).
 */
const LIB_NAMESPACE_ALIASES: Readonly<Record<string, string>> = {
  seo: "seo_distribution",
  search: "site_search",
  media: "media_library",
  blog: "blog_content",
  news: "news_portal",
  analytics: "visitor_analytics"
};

/**
 * `src/lib/logging` is the one namespace allowed to share a module's name.
 *
 * It is the database-free logger primitive, imported by well over a hundred
 * files including `src/lib` itself, and the `logging` MODULE is the audit-trail
 * service — different things that happen to share a word. Recorded as an
 * exception rather than an exclusion so `tests/lib-namespace-ownership.test.ts`
 * can prove it is DETECTED and merely excused, not a blind spot in detection.
 */
const LIB_NAMESPACE_EXCEPTIONS: Readonly<Record<string, string>> = {
  logging:
    "Database-free logger primitive (`log()`, redaction) used by ~139 files " +
    "including src/lib itself. The `logging` MODULE is the audit-trail service " +
    "— a different thing that shares a word. Moving this under a module would " +
    "make every module import that module to write a log line."
};

export type LibNamespaceViolation = {
  namespace: string;
  moduleKey: string;
  viaAlias: boolean;
};

/**
 * Pure: which `src/lib/<x>` directories collide with a module key, exactly or
 * through a domain alias.
 *
 * `src/lib` is technical infrastructure that must not carry a domain name. A
 * namespace named after a module is how a second, ungated module system grew
 * there: `src/lib/{seo,theming,comments,search}` held code owned by modules,
 * and `seo_distribution` even reached UP into `src/lib/seo` along a path the
 * DAG validator cannot see. Module presentation/delivery code belongs in
 * `src/modules/<m>/presentation/`.
 */
export function findLibNamespaceViolations(
  namespaces: readonly string[],
  moduleKeys: readonly string[]
): LibNamespaceViolation[] {
  const keys = new Set(moduleKeys);
  const violations: LibNamespaceViolation[] = [];

  for (const namespace of namespaces) {
    if (namespace in LIB_NAMESPACE_EXCEPTIONS) {
      continue;
    }

    const direct = namespace.replaceAll("-", "_");
    const alias = LIB_NAMESPACE_ALIASES[namespace];

    if (keys.has(direct)) {
      violations.push({ namespace, moduleKey: direct, viaAlias: false });
    } else if (alias && keys.has(alias)) {
      violations.push({ namespace, moduleKey: alias, viaAlias: true });
    }
  }

  return violations;
}

async function libNamespaces(): Promise<string[]> {
  const entries = await readdir(LIB_ROOT, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function main(): Promise<void> {
  const modules = listModules();
  const result = validateModuleDependencyGraph(modules);
  const namespaces = await libNamespaces();
  const libViolations = findLibNamespaceViolations(
    namespaces,
    modules.map((module) => module.key)
  );

  // A run from the wrong directory would list nothing and report a cheerful,
  // meaningless OK.
  if (namespaces.length === 0) {
    console.error(
      `modules:dag:check GAGAL — 0 namespace ditemukan di ${LIB_ROOT}. Jalankan dari root repository.`
    );
    process.exitCode = 1;
    return;
  }

  if (result.valid && libViolations.length === 0) {
    console.log(
      `modules:dag:check OK — ${modules.length} modul terdaftar membentuk DAG yang valid; ` +
        `${namespaces.length} namespace ${LIB_ROOT} tidak ada yang menyandang nama modul ` +
        `(${Object.keys(LIB_NAMESPACE_EXCEPTIONS).length} pengecualian tercatat).`
    );
    return;
  }

  console.error("modules:dag:check GAGAL —");

  if (!result.valid) {
    for (const issue of result.issues) {
      console.error(`  ${formatModuleDependencyGraphIssue(issue)}`);
    }
  }

  for (const violation of libViolations) {
    const how = violation.viaAlias
      ? ` (lewat alias domain -> \`${violation.moduleKey}\`)`
      : "";

    console.error(
      `  ${LIB_ROOT}/${violation.namespace}/ menyandang nama modul \`${violation.moduleKey}\`${how}. ` +
        `${LIB_ROOT} hanya untuk infrastruktur teknis tanpa nama domain — pindahkan ke ` +
        `src/modules/${violation.moduleKey.replaceAll("_", "-")}/presentation/ (composition root rute, ` +
        "glue middleware, skrip klien browser milik modul itu)."
    );
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
