/**
 * The static import tracer behind the job-scoped secret guard (Issue #1120).
 *
 * The guard is only as good as the tracer: a tracer that silently misses an edge
 * would let a job that reads a secret go ungranted, and that job would then fail
 * by taking the code default and reporting success. So the cases that matter —
 * what is followed, what is deliberately NOT followed, and what is reported
 * rather than skipped — are pinned here on small fixture trees.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  readImports,
  resolveTargetEntry,
  traceImports
} from "../scripts/lib/job-import-graph";

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "job-graph-"));
  roots.push(root);
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(root, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("readImports", () => {
  test("follows static, re-export, side-effect and literal dynamic relative imports", () => {
    const { relative, dynamic } = readImports(`
      import { a } from "./a";
      import b from '../b';
      import "./side-effect";
      export { c } from "./c";
      export * from "./d";
      const lazy = await import("./e");
      import {
        multi,
        line
      } from "./f";
    `);

    expect(relative.sort()).toEqual(
      ["./a", "../b", "./side-effect", "./c", "./d", "./e", "./f"].sort()
    );
    expect(dynamic).toEqual([]);
  });

  test("ignores type-only imports, which are erased before Bun runs anything", () => {
    const { relative } = readImports(`
      import type { T } from "./only-a-type";
      export type { U } from "./also-a-type";
      import { real } from "./real";
    `);

    expect(relative).toEqual(["./real"]);
  });

  test("ignores bare specifiers and node builtins", () => {
    const { relative } = readImports(`
      import fs from "node:fs";
      import postgres from "postgres";
      import { z } from "zod";
    `);

    expect(relative).toEqual([]);
  });

  test("ignores an import mentioned only in a comment", () => {
    const { relative, dynamic } = readImports(`
      // import { x } from "./commented-out";
      /* const y = await import("./also-commented"); */
      import { z } from "./live";
    `);

    expect(relative).toEqual(["./live"]);
    expect(dynamic).toEqual([]);
  });

  test("REPORTS a computed dynamic import instead of skipping it", () => {
    const { dynamic } = readImports(
      "const m = await import(`${process.cwd()}/x.ts`); const n = await import(name);"
    );

    expect(dynamic).toHaveLength(2);
  });
});

describe("readImports: what is not a relative file", () => {
  test("reports bare specifiers by package name, builtins and subpaths included", () => {
    const { bare } = readImports(`
      import fs from "node:fs";
      import { sql } from "postgres";
      import { z } from "@scope/pkg/sub/path";
      import "side-effect-pkg/register";
      const lazy = await import("lazy-pkg");
    `);

    expect(bare.sort()).toEqual(
      [
        "@scope/pkg",
        "lazy-pkg",
        "node:fs",
        "postgres",
        "side-effect-pkg"
      ].sort()
    );
  });

  test("reports require() and Bun.spawn* as code the graph cannot see", () => {
    const { escapes } = readImports(`
      const lib = require("./hidden");
      Bun.spawn(["bun", "run", "x"]);
      Bun.spawnSync(["ls"]);
    `);

    expect(escapes.sort()).toEqual([
      "Bun.spawn(",
      "Bun.spawnSync(",
      "require("
    ]);
  });

  test("reports child_process imports, Bun's shell and new Worker as escapes too", () => {
    expect(
      readImports('import { execFileSync } from "node:child_process";').escapes
    ).toEqual(["child_process"]);
    expect(readImports('import cp from "child_process";').escapes).toEqual([
      "child_process"
    ]);
    expect(readImports("await Bun.$`ls`;").escapes).toEqual(["Bun.$"]);
    expect(readImports('import { $ } from "bun";').escapes).toEqual(["Bun.$"]);
    expect(readImports('const w = new Worker("./w.ts");').escapes).toEqual([
      "new Worker("
    ]);
    // A plain `bun` import is not the shell.
    expect(readImports('import { file } from "bun";').escapes).toEqual([]);
  });

  test("does not report an escape that is only in a comment", () => {
    expect(
      readImports(
        "// require('x')\n/* Bun.spawn(['y']) */\nexport const a = 1;"
      ).escapes
    ).toEqual([]);
  });
});

describe("traceImports", () => {
  test("parses .tsx, .mts, .cts and .jsx files too, so a reader there is not invisible", () => {
    const root = fixture({
      "scripts/job.ts":
        'import "../src/a.tsx";\nimport "../src/b.mts";\nimport "../src/c.cts";\nimport "../src/d.jsx";',
      "src/a.tsx": 'import "./deep";',
      "src/b.mts": "export const b = 1;",
      "src/c.cts": "export const c = 1;",
      "src/d.jsx": "export const d = 1;",
      "src/deep.ts": "export const deep = 1;"
    });

    expect(traceImports("scripts/job.ts", root).files).toEqual([
      "scripts/job.ts",
      "src/a.tsx",
      "src/b.mts",
      "src/c.cts",
      "src/d.jsx",
      "src/deep.ts"
    ]);
  });

  test("reports a reachable file type it cannot read instead of assuming it is harmless", () => {
    const root = fixture({
      "scripts/job.ts":
        'import "../src/page.astro";\nimport "../src/data.json";',
      "src/page.astro": "---\n---",
      "src/data.json": "{}"
    });

    const trace = traceImports("scripts/job.ts", root);
    expect(trace.unresolved).toEqual([
      {
        from: "src/page.astro",
        specifier: "(file type the tracer cannot read)"
      }
    ]);
  });

  test("collects bare specifiers and escapes per file", () => {
    const root = fixture({
      "scripts/job.ts":
        'import { x } from "unknown-pkg";\nBun.spawn(["a"]);\nimport "./other";',
      "scripts/other.ts": 'const m = require("fs");'
    });

    const trace = traceImports("scripts/job.ts", root);
    expect(trace.bare).toEqual([
      { from: "scripts/job.ts", specifier: "unknown-pkg" }
    ]);
    expect(trace.escapes.map((e) => `${e.from} ${e.specifier}`).sort()).toEqual(
      ["scripts/job.ts Bun.spawn(", "scripts/other.ts require("]
    );
  });

  test("reaches transitive files, resolves index and extension-less specifiers, and survives a cycle", () => {
    const root = fixture({
      "scripts/job.ts": 'import { a } from "../src/a";\nimport "../src/dir";',
      "src/a.ts": 'import { b } from "./b";',
      "src/b.ts": 'import { a } from "./a"; // cycle',
      "src/dir/index.ts": "export const d = 1;",
      "src/unrelated.ts": "export const u = 1;"
    });

    const trace = traceImports("scripts/job.ts", root);

    expect(trace.files).toEqual([
      "scripts/job.ts",
      "src/a.ts",
      "src/b.ts",
      "src/dir/index.ts"
    ]);
    expect(trace.dynamic).toEqual([]);
    expect(trace.unresolved).toEqual([]);
  });

  test("follows a literal dynamic import and lists a computed one with the file it is in", () => {
    const root = fixture({
      "scripts/job.ts":
        'const a = await import("../src/lazy");\nconst b = await import(`../src/${x}`);',
      "src/lazy.ts": "export const l = 1;"
    });

    const trace = traceImports("scripts/job.ts", root);

    expect(trace.files).toContain("src/lazy.ts");
    expect(trace.dynamic).toEqual([
      { from: "scripts/job.ts", specifier: "`../src/${x}`" }
    ]);
  });

  test("does not reach a file that is only imported as a type", () => {
    const root = fixture({
      "scripts/job.ts": 'import type { T } from "../src/types";',
      "src/types.ts": "export type T = string;"
    });

    expect(traceImports("scripts/job.ts", root).files).toEqual([
      "scripts/job.ts"
    ]);
  });

  test("REPORTS a relative import that resolves to no file", () => {
    const root = fixture({
      "scripts/job.ts": 'import { gone } from "../src/missing";'
    });

    expect(traceImports("scripts/job.ts", root).unresolved).toEqual([
      { from: "scripts/job.ts", specifier: "../src/missing" }
    ]);
  });
});

describe("resolveTargetEntry", () => {
  const scripts = {
    "push:dispatch": "bun scripts/push-dispatch.ts",
    "push:auth-secret:rekey":
      "bun scripts/push-auth-secret-backfill.ts --rekey",
    chained: "bun run a && bun run b",
    build: "astro build",
    "dist-entry": "bun dist/standalone-entry.mjs"
  };

  test("resolves the plain `bun scripts/<file>` shape, ignoring trailing args", () => {
    expect(resolveTargetEntry("push:dispatch", scripts)).toBe(
      "scripts/push-dispatch.ts"
    );
    expect(resolveTargetEntry("push:auth-secret:rekey", scripts)).toBe(
      "scripts/push-auth-secret-backfill.ts"
    );
  });

  test("returns null for anything else rather than guessing", () => {
    expect(resolveTargetEntry("chained", scripts)).toBeNull();
    expect(resolveTargetEntry("build", scripts)).toBeNull();
    expect(resolveTargetEntry("dist-entry", scripts)).toBeNull();
    expect(resolveTargetEntry("absent", scripts)).toBeNull();
  });
});
