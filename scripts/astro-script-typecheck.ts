/**
 * astro-script-typecheck.ts — `bun run check:astro-scripts:check`.
 *
 * Typechecks the `<script>` blocks inside `.astro` pages, which nothing else
 * in this repo does.
 *
 * ## The blind spot, and how it was found
 *
 * `bun run typecheck` is `tsc --noEmit`, and `tsc` cannot parse `.astro` at
 * all — the files are not in any program. `astro build` compiles the script
 * blocks with esbuild, which strips types without checking them. So every line
 * of client-side behaviour on 40-odd admin screens has been shipping
 * unchecked, and `AGENTS.md` already records `.astro` as the blind spot of
 * every type-based gate.
 *
 * That is not theoretical. Issue #552 refactored these scripts and found two
 * defects that a typechecker would have caught the day they landed:
 *
 * - `/admin/comments` and `/admin/blog-settings` both called
 *   `lockElement(button)` with the required `busyLabel` missing, so every
 *   moderation button read the literal string "undefined" while its request
 *   was in flight — and on `/admin/blog-settings` the same call threw outright
 *   when the button was absent, because `button` was typed `| null`.
 * - `/admin/blog-settings` rendered `result.message ?? "…"`, a property
 *   `sendJson` has never returned, so the fallback was the only message that
 *   could ever appear.
 *
 * ## How it works, and why the files land next to the page
 *
 * Each block is written to a sibling `*.astro-script-check.ts` in the SAME
 * directory as its page, then `tsc` runs over the project and the files are
 * deleted in a `finally`. Same directory is the whole trick: the imports in
 * these blocks are relative (`../../lib/ui/admin-form-client`), so a mirrored
 * tree elsewhere would need every specifier rewritten — a transformation that
 * can itself be wrong, and would then report errors that are not in the page.
 * Adjacent files resolve exactly what the page resolves.
 *
 * Blocks with no `import` are skipped: Astro inlines those, this app's CSP
 * blocks inline scripts, and a file with no imports is not a module — its
 * top-level `const`s would collide across pages in one program.
 *
 * ## Why stale files FAIL the check
 *
 * A previous run killed mid-flight leaves generated files behind, and those
 * are then typechecked against a page they may no longer match. Rather than
 * silently overwrite them, this refuses to start and names them: they are also
 * `.gitignore`d, so the alternative is a file that is invisible to git and
 * wrong.
 */
import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const PAGES_ROOT = "src/pages";

/** The suffix identifying a generated file — matched by `.gitignore`. */
export const GENERATED_SUFFIX = ".astro-script-check.ts";

export type ExtractedScript = { source: string; hasImport: boolean };

/**
 * Pulls the first plain `<script>` block out of an `.astro` file and removes
 * the block's common indentation.
 *
 * Only `<script>` with no attributes: `<script is:inline src=…>` is a browser
 * tag Astro passes through untouched, not TypeScript it compiles, and
 * `define:vars` injects identifiers that exist only at render time.
 *
 * De-indenting matters for more than looks — a block indented by two spaces
 * would otherwise put every reported error's column two past where it is in
 * the page.
 */
export function extractScriptBlock(astro: string): ExtractedScript | null {
  const match = /\n[ \t]*<script>\n([\s\S]*?)\n[ \t]*<\/script>/.exec(astro);
  if (!match?.[1]) return null;

  const lines = match[1].split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.length - line.trimStart().length);
  const pad = indents.length > 0 ? Math.min(...indents) : 0;

  const source = lines
    .map((line) => (line.length >= pad ? line.slice(pad) : line))
    .join("\n");

  return { source, hasImport: /^\s*import[\s{]/m.test(source) };
}

/** `admin/modules/[moduleKey].astro` → `admin/modules/_moduleKey_` — `[` is not a filename TypeScript enjoys. */
export function generatedNameFor(astroPath: string): string {
  const base = path.basename(astroPath, ".astro").replaceAll(/[[\]]/g, "_");
  return path.join(path.dirname(astroPath), `${base}${GENERATED_SUFFIX}`);
}

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(absolute)));
    } else if (entry.isFile()) {
      found.push(absolute);
    }
  }

  return found;
}

async function main(): Promise<void> {
  const entries = await walk(PAGES_ROOT);

  const stale = entries.filter((file) => file.endsWith(GENERATED_SUFFIX));
  if (stale.length > 0) {
    console.error(
      "check:astro-scripts:check FAILED — generated files left over from an " +
        "interrupted run. They are gitignored, so they are invisible to git " +
        "and may no longer match their page. Delete them and re-run:"
    );
    for (const file of stale) console.error(`  ${file}`);
    process.exitCode = 1;
    return;
  }

  const generated: string[] = [];

  try {
    for (const file of entries.filter((entry) => entry.endsWith(".astro"))) {
      const block = extractScriptBlock(await Bun.file(file).text());
      if (!block || !block.hasImport) continue;

      const target = generatedNameFor(file);
      await writeFile(target, `${block.source}\n`, "utf8");
      generated.push(target);
    }

    if (generated.length === 0) {
      console.error(
        "check:astro-scripts:check FAILED — no `.astro` page yielded a " +
          "script block. Every admin screen has one, so this means the " +
          "extraction stopped matching, not that the scripts went away."
      );
      process.exitCode = 1;
      return;
    }

    const result = Bun.spawnSync(["bun", "x", "tsc", "--noEmit"], {
      stdout: "pipe",
      stderr: "pipe"
    });

    if (result.exitCode !== 0) {
      console.error(
        `check:astro-scripts:check FAILED — ${generated.length} script ` +
          "block(s) extracted; tsc rejected at least one. Line and column " +
          "numbers are relative to the block, not the page:"
      );
      console.error(new TextDecoder().decode(result.stdout).trimEnd());
      console.error(new TextDecoder().decode(result.stderr).trimEnd());
      process.exitCode = 1;
      return;
    }

    console.log(
      `check:astro-scripts:check OK — ${generated.length} <script> blocks ` +
        "typechecked."
    );
  } finally {
    // Always, including on a thrown error: a leftover file is gitignored and
    // would fail the NEXT run rather than this one.
    await Promise.all(generated.map((file) => rm(file, { force: true })));
  }
}

if (import.meta.main) {
  await main();
}
