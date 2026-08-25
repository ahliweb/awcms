/**
 * blog-legacy-rubrik-redirects.ts — `bun run blog:legacy:rubrik-redirects`.
 *
 * Issue #711 / ADR-0113. Turns the committed
 * `data/seputarborneo-legacy/rubrik-redirects.json` map into
 * `POST /api/v1/seo/redirects/import` payload chunks.
 *
 * ## Why the map is a committed FILE and not derived here
 *
 * Its sibling `blog:legacy:redirects:import` derives its map from
 * `awcms_blog_posts.legacy_source_id`, so the map cannot disagree with the
 * content. Nothing equivalent exists for rubrik listings: they are not
 * articles, they have no provenance column, and — the part that decides it —
 * the legacy URLs are **hand-typed link literals**, not generated. Their set
 * lives in a PHP working copy and a MariaDB volume that exist on one
 * workstation and ship nowhere.
 *
 * So the derivation happened once, against both, and its result is committed
 * with its provenance (`data/seputarborneo-legacy/README.md`). This script does
 * not touch a legacy database and cannot: there is nothing left to ask it.
 *
 * ## What this does NOT do
 *
 * It does not write. It builds the payload and prints it; loading is
 * `POST /api/v1/seo/redirects/import`, which is itself `dryRun` by default and
 * caps a call at `MAX_IMPORT_ITEMS`. Two reasons to keep the write out of here:
 * the import endpoint already owns conflict/loop/chain safety and the audit
 * row, and a bulk redirect load is an authoring action that should carry an
 * operator's credential rather than a script's database role.
 *
 * ## The check that earns its place
 *
 * Every `sourcePath` is pushed through the SAME `normalizeRedirectPath` and
 * `validateRedirectTarget` the write path uses, and every target slug through
 * `isValidSlug`. The map is data, and data drifts: a hand-edit that introduces
 * a raw space, a duplicate source, or a self-redirect must fail HERE and not at
 * hop 4,000 of a cutover. `--emit` refuses outright when anything fails.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { logScriptFailure } from "../src/lib/logging/error-log";
import { isValidSlug } from "../src/modules/blog-content/domain/slug-policy";
import { normalizeRedirectPath } from "../src/modules/seo-distribution/domain/redirect-path";
import { validateRedirectTarget } from "../src/modules/seo-distribution/domain/redirect-target";

/** Mirrors `MAX_IMPORT_ITEMS` in `src/pages/api/v1/seo/redirects/import.ts`. */
const IMPORT_CHUNK_SIZE = 200;

const MAP_PATH = "data/seputarborneo-legacy/rubrik-redirects.json";

export type LegacyRubrikEntry = {
  sourcePath: string;
  legacyHref: string;
  legacyNews: string;
  legacyKategori: string;
  articlesAtCapture: number;
  parentArticlesAtCapture: number;
  canonicalRubrik: string[];
  /** `null` = deliberately no rule (no resolvable destination). */
  targetPath: string | null;
};

export type LegacyRubrikMap = {
  capturedAt: string;
  source: Record<string, unknown>;
  entries: LegacyRubrikEntry[];
};

export type MapProblem = { sourcePath: string; problem: string };

/**
 * Every reason this map could not be loaded safely, all of them, rather than
 * the first — an operator fixing a hand-edited file should see the whole list.
 *
 * `allowedHosts` is empty on purpose: every target here is a relative path, and
 * `validateRedirectTarget` classifies a relative target without consulting the
 * host list. Passing a host would make this check weaker than the write path's,
 * not stronger, by admitting absolute targets this map must never contain.
 */
export function findMapProblems(map: LegacyRubrikMap): MapProblem[] {
  const problems: MapProblem[] = [];
  const seen = new Set<string>();

  for (const entry of map.entries) {
    const normalized = normalizeRedirectPath(entry.sourcePath);

    if (!normalized.ok) {
      problems.push({
        sourcePath: entry.sourcePath,
        problem: `source path rejected: ${normalized.reason}`
      });
      continue;
    }

    if (normalized.path !== entry.sourcePath) {
      // Storing a path that normalises to something else means the rule is
      // filed under a key no request will ever produce.
      problems.push({
        sourcePath: entry.sourcePath,
        problem: `source path is not already normalized (becomes ${normalized.path})`
      });
    }

    if (seen.has(normalized.path)) {
      problems.push({
        sourcePath: entry.sourcePath,
        problem: "duplicate source path — the import would conflict with itself"
      });
    }

    seen.add(normalized.path);

    if (entry.targetPath === null) {
      continue;
    }

    const target = validateRedirectTarget(entry.targetPath, []);

    if (!target.ok) {
      problems.push({
        sourcePath: entry.sourcePath,
        problem: `target rejected: ${target.reason}`
      });
      continue;
    }

    const slug = entry.targetPath.replace(/^\/kategori\//, "");

    if (!isValidSlug(slug)) {
      problems.push({
        sourcePath: entry.sourcePath,
        problem: `target category slug "${slug}" is not a valid slug`
      });
    }

    if (target.target === normalized.path) {
      problems.push({
        sourcePath: entry.sourcePath,
        problem: "self-redirect — source and target are the same path"
      });
    }
  }

  return problems;
}

export type ImportItem = {
  sourcePath: string;
  target: string;
  statusCode: 301;
  reason: string;
};

/** The entries that carry a rule, as import items. `targetPath: null` is skipped by design. */
export function buildImportItems(map: LegacyRubrikMap): ImportItem[] {
  return map.entries
    .filter((entry) => entry.targetPath !== null)
    .map((entry) => ({
      sourcePath: entry.sourcePath,
      target: entry.targetPath!,
      statusCode: 301 as const,
      reason: `SeputarBorneo legacy rubrik listing (ADR-0113; ${entry.articlesAtCapture} articles at capture)`
    }));
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }

  return out;
}

async function main(): Promise<void> {
  const emit = process.argv.includes("--emit");
  const map = JSON.parse(readFileSync(MAP_PATH, "utf8")) as LegacyRubrikMap;

  const problems = findMapProblems(map);
  const items = buildImportItems(map);
  const skipped = map.entries.filter((entry) => entry.targetPath === null);
  const chunks = chunk(items, IMPORT_CHUNK_SIZE);

  console.log(`map:      ${MAP_PATH} (captured ${map.capturedAt})`);
  console.log(`entries:  ${map.entries.length}`);
  console.log(`rules:    ${items.length}`);
  console.log(
    `no rule:  ${skipped.length}${skipped.length > 0 ? ` (${skipped.map((entry) => entry.sourcePath).join(", ")})` : ""}`
  );
  console.log(`chunks:   ${chunks.length} of at most ${IMPORT_CHUNK_SIZE}`);

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);

    for (const problem of problems) {
      console.error(`  - ${problem.sourcePath}: ${problem.problem}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log("\nevery source path and target passes the write-path guards.");

  if (!emit) {
    console.log(
      "\nPreview only. Re-run with --emit to write the payload chunks, then load them\n" +
        "with POST /api/v1/seo/redirects/import (dryRun first).\n" +
        "The destination categories must exist in the tenant BEFORE loading, or every\n" +
        "rule 301s into a 404."
    );
    return;
  }

  chunks.forEach((batch, index) => {
    const file = `seputarborneo-rubrik-redirects.${index + 1}.json`;

    writeFileSync(
      file,
      `${JSON.stringify({ dryRun: true, redirects: batch }, null, 2)}\n`,
      "utf8"
    );
    console.log(`wrote ${file} (${batch.length} rule(s))`);
  });
}

if (import.meta.main) {
  main().catch((error) => {
    logScriptFailure("blog:legacy:rubrik-redirects", error);
    process.exitCode = 1;
  });
}
