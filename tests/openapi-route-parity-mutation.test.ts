/**
 * Mutation tests for the route↔contract parity gate (Issue #182, epic #177):
 * removing a route (a route file deleted) OR removing a fragment's path (a
 * fragment deleted / operation dropped) must make the gate go RED. Drives the
 * REAL gate logic (`collectRouteParityProblems`) against the live bundle +
 * route templates, then mutates one side and asserts a problem appears.
 *
 * Also proves determinism of the readable API-reference generator.
 */
import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  collectRouteParityProblems,
  routeFileToTemplate
} from "../scripts/api-spec-check";
import { buildApiReferenceMarkdown } from "../scripts/api-docs-generate";

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, "src/pages/api/v1");

async function discoverRouteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverRouteFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function liveSets(): Promise<{
  declaredPaths: Set<string>;
  routeTemplates: Set<string>;
}> {
  const bundleRaw = await readFile(
    path.join(ROOT, "openapi/awcms-public-api.openapi.yaml"),
    "utf8"
  );
  const doc = parseYaml(bundleRaw) as {
    paths?: Record<string, unknown>;
  };
  const declaredPaths = new Set(Object.keys(doc.paths ?? {}));
  const routeFiles = await discoverRouteFiles(ROUTES_DIR);
  const routeTemplates = new Set(routeFiles.map((f) => routeFileToTemplate(f)));
  return { declaredPaths, routeTemplates };
}

describe("route↔contract parity mutation", () => {
  test("the live bundle and route tree are in parity (baseline green)", async () => {
    const { declaredPaths, routeTemplates } = await liveSets();
    expect(collectRouteParityProblems(declaredPaths, routeTemplates)).toEqual(
      []
    );
  });

  test("removing a route (route file deleted) makes the gate red", async () => {
    const { declaredPaths, routeTemplates } = await liveSets();
    const victim = [...declaredPaths][0]!;
    const mutated = new Set(routeTemplates);
    mutated.delete(victim);
    const problems = collectRouteParityProblems(declaredPaths, mutated);
    expect(
      problems.some(
        (p) => p.includes(victim) && p.includes("no matching route file")
      )
    ).toBe(true);
  });

  test("removing a fragment path (contract path dropped) makes the gate red", async () => {
    const { declaredPaths, routeTemplates } = await liveSets();
    const victim = [...routeTemplates][0]!;
    const mutated = new Set(declaredPaths);
    mutated.delete(victim);
    const problems = collectRouteParityProblems(mutated, routeTemplates);
    expect(
      problems.some(
        (p) => p.includes(victim) && p.includes("no matching OpenAPI path")
      )
    ).toBe(true);
  });
});

describe("api-docs generator determinism", () => {
  test("generating the reference twice yields byte-identical Markdown", async () => {
    const first = await buildApiReferenceMarkdown(ROOT);
    const second = await buildApiReferenceMarkdown(ROOT);
    expect(second).toBe(first);
  });

  test("the reference contains the standard envelope and every module section", async () => {
    const md = await buildApiReferenceMarkdown(ROOT);
    expect(md).toContain("### Standard error envelope");
    expect(md).toContain("## REST operations by module");
    expect(md).toContain("## Domain events");
  });
});
