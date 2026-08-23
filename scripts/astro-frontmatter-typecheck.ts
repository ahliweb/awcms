/**
 * astro-frontmatter-typecheck.ts — `bun run check:astro-frontmatter:check`.
 *
 * Closes finding C4 of the standards document as far as it can be closed here.
 *
 * ## The gap this fills, and what it already caught
 *
 * `bun run typecheck` is `tsc --noEmit`, and `tsc` cannot parse `.astro`. The
 * usual answer is `astro check`, which this repo **cannot run**: its language
 * server requires TypeScript's programmatic API, TypeScript 7 does not ship it,
 * and the repo is on 7.0.2. Running it prints exactly that and exits — so 61
 * files and ~34,760 lines of frontmatter were never checked by anything.
 *
 * That is not theoretical either. The first run of this gate found
 * `/admin/seo` computing `showRedirectActions` from three `const`s declared 130
 * lines further down — a temporal dead zone, so the component function threw
 * `ReferenceError: Cannot access 'canUpdateRedirect' before initialization` as
 * its third statement. The screen answered 404 on every request and had never
 * rendered once. Every gate in the chain was green: the page compiled, built,
 * and shipped, because nothing type-checked it.
 *
 * `check:astro-scripts:check` established the technique for `<script>` blocks
 * (Issue #552, which found two defects the same way). This is the same trick
 * applied to the other half of the file.
 *
 * ## How it works
 *
 * Each frontmatter is written to a sibling `*.astro-frontmatter-check.ts` in
 * the SAME directory as its page, then `tsc` runs over
 * `scripts/astro-frontmatter/tsconfig.json` and the files are deleted in a
 * `finally`. Same directory is the whole trick, exactly as in the script gate:
 * the imports are relative, so a mirrored tree elsewhere would need every
 * specifier rewritten — a transformation that can itself be wrong, and would
 * then report errors that are not in the page.
 *
 * ## The four compromises, and why the divergence is narrowed not removed
 *
 * Two live in `scripts/astro-frontmatter/shim.d.ts` (component props and
 * `Astro.props` go unchecked) and are documented there. The two here:
 *
 * 1. **`export {}` is appended.** A frontmatter with no import is a SCRIPT to
 *    TypeScript, and its top-level `const`s land in the global scope — so two
 *    pages that both declare `ariaLabel` collide with an error belonging to
 *    neither. Forcing module scope is what makes the reported errors real.
 * 2. **`noUnusedLocals` / `noUnusedParameters` are off** for this project only.
 *    Almost every frontmatter binding is consumed by the TEMPLATE, which is not
 *    extracted, so leaving them on reports 658 phantom unused declarations and
 *    buries the real signal. An unused frontmatter const is also the cheapest
 *    class of defect there is; a use-before-declaration is not.
 *
 * What survives is everything else: undefined variables, wrong types across
 * every `src/` import, null handling, await/async mistakes, and the ordering
 * error above. `astro check` would additionally check component props, which is
 * why `astro-files-not-type-checked` stays in the manifest with its scope
 * rewritten rather than being deleted.
 */
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { listFilesRecursive } from "./lib/repo-files";

const SOURCE_ROOT = "src";

/** The suffix identifying a generated file — matched by `.gitignore`. */
export const GENERATED_SUFFIX = ".astro-frontmatter-check.ts";

/**
 * The frontmatter of an `.astro` file — the TypeScript between the opening
 * `---` and the matching close — or `null` when the file has none.
 *
 * Anchored at the start of the file: a `---` further down is a horizontal rule
 * in the template, and treating it as a fence would silently truncate the
 * extraction and check a fragment while reporting the whole file clean.
 */
export function extractFrontmatter(astro: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(astro);
  return match?.[1] ?? null;
}

/** `admin/modules/[moduleKey].astro` → `admin/modules/_moduleKey_…` — `[` is not a filename TypeScript enjoys. */
export function generatedNameFor(astroPath: string): string {
  const base = path.basename(astroPath, ".astro").replaceAll(/[[\]]/g, "_");
  return path.join(path.dirname(astroPath), `${base}${GENERATED_SUFFIX}`);
}

/**
 * The text written to disk: the frontmatter, then a module marker.
 *
 * See compromise 1 above — without this, a page with no imports contributes its
 * top-level bindings to the global scope.
 */
export function generatedSourceFor(frontmatter: string): string {
  return `${frontmatter}\n\nexport {};\n`;
}

async function main(): Promise<void> {
  const entries = listFilesRecursive(SOURCE_ROOT);

  const stale = entries.filter((file) => file.endsWith(GENERATED_SUFFIX));
  if (stale.length > 0) {
    console.error(
      "check:astro-frontmatter:check FAILED — generated files left over from " +
        "an interrupted run. They are gitignored, so they are invisible to " +
        "git and may no longer match their page. Delete them and re-run:"
    );
    for (const file of stale) console.error(`  ${file}`);
    process.exitCode = 1;
    return;
  }

  const generated: string[] = [];

  try {
    for (const file of entries.filter((entry) => entry.endsWith(".astro"))) {
      const frontmatter = extractFrontmatter(await Bun.file(file).text());
      if (frontmatter === null) continue;

      const target = generatedNameFor(file);
      await writeFile(target, generatedSourceFor(frontmatter), "utf8");
      generated.push(target);
    }

    if (generated.length === 0) {
      console.error(
        "check:astro-frontmatter:check FAILED — no `.astro` file yielded a " +
          "frontmatter block. Every page and layout in this repo has one, so " +
          "this means the extraction stopped matching, not that they went away."
      );
      process.exitCode = 1;
      return;
    }

    const result = Bun.spawnSync(
      [
        "bun",
        "x",
        "tsc",
        "--noEmit",
        "--project",
        "scripts/astro-frontmatter/tsconfig.json"
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    if (result.exitCode !== 0) {
      console.error(
        `check:astro-frontmatter:check FAILED — ${generated.length} ` +
          "frontmatter block(s) extracted; tsc rejected at least one. Line " +
          "numbers are relative to the block, so add 1 for the page (the " +
          "opening `---`):"
      );
      console.error(new TextDecoder().decode(result.stdout).trimEnd());
      console.error(new TextDecoder().decode(result.stderr).trimEnd());
      process.exitCode = 1;
      return;
    }

    console.log(
      `check:astro-frontmatter:check OK — ${generated.length} frontmatter ` +
        "block(s) typechecked."
    );
  } finally {
    await Promise.all(generated.map((file) => rm(file, { force: true })));
  }
}

// Guarded, like `astro-script-typecheck.ts`: the pure exports above are
// imported by `tests/astro-frontmatter-typecheck.test.ts`, and an unguarded
// top-level call would run the whole gate — writing and deleting 61 files —
// every time the suite imports this module.
if (import.meta.main) {
  await main();
}
