/**
 * The extraction behind `check:astro-frontmatter:check` (standards finding C4).
 *
 * The gate itself is proved by running it — it reported the `/admin/seo`
 * temporal-dead-zone defect before the fix and `OK` after. What is tested here
 * is the extraction, because every one of these details silently changes what
 * gets checked rather than making the gate fail: a wrong fence truncates the
 * block and reports the remainder clean, and a missing module marker turns
 * every import-free page into a global-scope collision with errors belonging
 * to no file.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  GENERATED_SUFFIX,
  extractFrontmatter,
  generatedNameFor,
  generatedSourceFor
} from "../scripts/astro-frontmatter-typecheck";

const ROOT = path.resolve(import.meta.dir, "..");

describe("extractFrontmatter", () => {
  test("takes the block between the opening fences", () => {
    expect(extractFrontmatter("---\nconst a = 1;\n---\n<p>x</p>\n")).toBe(
      "const a = 1;"
    );
  });

  test("a `---` in the TEMPLATE does not end the block early", () => {
    // A horizontal rule below the frontmatter is ordinary markup. A greedy or
    // unanchored fence match would cut the block at it, typecheck the fragment,
    // and report the page clean having never seen the rest.
    const astro =
      "---\nconst a = 1;\nconst b = 2;\n---\n<p>a</p>\n\n---\n\n<p>b</p>\n";
    expect(extractFrontmatter(astro)).toBe("const a = 1;\nconst b = 2;");
  });

  test("the fence must open the file", () => {
    // A page whose first line is markup has no frontmatter. Treating a later
    // `---` as the opening fence would extract template text as TypeScript.
    expect(
      extractFrontmatter("<p>x</p>\n---\nnot frontmatter\n---\n")
    ).toBeNull();
  });

  test("no frontmatter at all is `null`, not an empty block", () => {
    expect(extractFrontmatter("<p>x</p>\n")).toBeNull();
  });

  test("an empty frontmatter is a block, not `null`", () => {
    expect(extractFrontmatter("---\n\n---\n<p>x</p>\n")).toBe("");
  });

  test("CRLF files are handled", () => {
    expect(extractFrontmatter("---\r\nconst a = 1;\r\n---\r\n<p>x</p>")).toBe(
      "const a = 1;"
    );
  });
});

describe("generatedNameFor", () => {
  test("lands beside the page, not in a mirrored tree", () => {
    // Same directory is the whole trick: the imports inside a frontmatter are
    // relative, so a mirrored tree would need every specifier rewritten — a
    // transformation that can itself be wrong, and would then report errors
    // that are not in the page.
    expect(generatedNameFor("src/pages/admin/seo.astro")).toBe(
      `src/pages/admin/seo${GENERATED_SUFFIX}`
    );
  });

  test("dynamic-route brackets are replaced", () => {
    expect(generatedNameFor("src/pages/admin/modules/[moduleKey].astro")).toBe(
      `src/pages/admin/modules/_moduleKey_${GENERATED_SUFFIX}`
    );
  });
});

describe("generatedSourceFor", () => {
  test("appends a module marker", () => {
    // Without it a frontmatter with no imports is a SCRIPT, so its top-level
    // `const`s go to the GLOBAL scope. Two components that both declare
    // `ariaLabel` then collide — and this repo has exactly that pair, so the
    // gate would open with two errors belonging to neither file.
    expect(generatedSourceFor("const a = 1;")).toContain("export {};");
  });

  test("the frontmatter comes first and is unmodified", () => {
    // Line numbers in the gate's output are relative to the block, and the
    // message tells the reader to add 1. Prefixing anything would break that.
    const generated = generatedSourceFor("const a = 1;\nconst b = 2;");
    expect(generated.startsWith("const a = 1;\nconst b = 2;")).toBe(true);
  });
});

describe("the gate is wired in", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8")
  ) as { scripts: Record<string, string> };

  test("`check` runs it", () => {
    // A gate outside the chain runs nowhere: CI's quality job is `bun run
    // check` itself, so the chain is what decides whether this executes.
    expect(pkg.scripts["check:astro-frontmatter:check"]).toBeDefined();
    expect(pkg.scripts.check).toContain(
      "bun run check:astro-frontmatter:check"
    );
  });

  test("the shim is excluded from the ROOT tsconfig", () => {
    // `declare module "*.astro"` must not reach the main typecheck, or it
    // starts answering for real imports there and hides genuine errors.
    const tsconfig = JSON.parse(
      readFileSync(path.join(ROOT, "tsconfig.json"), "utf8")
    ) as { exclude: string[] };
    expect(tsconfig.exclude).toContain("scripts/astro-frontmatter");
  });

  test("the generated files are gitignored", () => {
    // They are transient. An interrupted run must not offer them to git — and
    // the gate refuses to start while one exists, which is what keeps a stale
    // one from being typechecked in place of its page.
    const ignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    expect(ignore).toContain(`src/**/*${GENERATED_SUFFIX}`);
  });

  test("the shim has no top-level import or export", () => {
    // A `.d.ts` with either is a MODULE, and `declare module "*.astro"` inside
    // a module is read as augmentation of an existing module rather than a
    // wildcard — so every `.astro` import fails to resolve and the gate
    // reports 53 phantom TS2307s instead of real defects. This happened.
    const shim = readFileSync(
      path.join(ROOT, "scripts/astro-frontmatter/shim.d.ts"),
      "utf8"
    );
    const code = shim
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Anchored at column 0: the `export default` lines INSIDE each `declare
    // module` block are indented and are exactly what those blocks are for.
    // Only a top-level statement makes the file a module.
    expect(/^import\s/m.test(code)).toBe(false);
    expect(/^export\s/m.test(code)).toBe(false);
  });
});
