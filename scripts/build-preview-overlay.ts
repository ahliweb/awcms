#!/usr/bin/env bun
/**
 * build-preview-overlay.ts — `bun run build:preview-overlay[:check]` (Issue #592).
 *
 * Bundles `src/lib/ui/blog-preview-overlay.ts` into
 * `public/js/blog-preview-overlay.js`, the browser code for the editor preview.
 *
 * ## Why this build step exists at all
 *
 * `src/pages/admin/blog/[id]/preview.ts` is an `APIRoute` returning an HTML
 * string, and Astro only bundles `<script>` for `.astro` components. This app's
 * CSP is `default-src 'self'` with no `'unsafe-inline'`, so an inline script on
 * that page is refused by the browser. The script therefore has to come from
 * `public/`, which Astro copies through verbatim.
 *
 * The cheap alternative was to hand-write the JavaScript there, following
 * `public/js/news-share.js`. It was rejected because of what it would have
 * cost: a SECOND, untyped copy of the block <-> Portable Text conversion that
 * `src/lib/ui/portable-text-editor.ts` owns. Issue #592's whole premise is that
 * a preview which drifts from the real thing is worse than no preview, and an
 * overlay whose editor drifts from the real editor is that same defect one
 * layer in.
 *
 * ## Why the output is COMMITTED
 *
 * The same reason every other generated artefact in this repo is: `astro dev`
 * and `astro build` both serve `public/` as-is, so a file generated only at
 * build time would be missing in dev and on a fresh clone. Committing it and
 * gating its freshness is the shape `openapi:bundle`, `i18n:compile` and the
 * inventories already use — the artefact is real, and the gate is what keeps it
 * honest.
 *
 * `:check` rebuilds into memory and compares bytes. It does NOT write, so a
 * stale artefact fails CI instead of being silently repaired by the check that
 * was supposed to catch it.
 *
 * ## The comparison is only MEANINGFUL on the pinned Bun
 *
 * A minified bundle is the output of a specific bundler, so its bytes change
 * when the bundler does — identifier renaming and codegen are not stable across
 * Bun releases. Comparing them therefore asks TWO questions at once, and only
 * one of them is this gate's: "was the artefact rebuilt after its source
 * changed", and "is the machine running the same Bun that produced it".
 *
 * Conflating them made the gate LIE. On a developer machine one minor ahead of
 * the pin it reported `is STALE` — a claim about the artefact — when the
 * artefact was correct and the toolchain differed. Two things followed from
 * that, and the second is the expensive one:
 *
 *   - `tests/blog-preview-overlay.test.ts` shells out to this gate, so the
 *     false failure also failed the test suite;
 *   - the message names `bun run build:preview-overlay` as the remedy, and
 *     running it on the wrong Bun commits a bundle that reddens CI — the gate
 *     handed out the instruction that breaks the thing it guards.
 *
 * So the version is now a stated PRECONDITION rather than a hidden assumption.
 * Off the pin, a byte difference is reported as UNVERIFIED (exit 0) instead of
 * as staleness: CI runs every job at the pinned version, so the gate keeps its
 * full strength exactly where it is enforced. `family:conformance:check`
 * already asserts CI's `bun-version:` set equals {`packageManager` pin,
 * `engines` floor}, so reading the pin from `packageManager` cannot drift away
 * from the version CI actually installs.
 *
 * Two cases stay version-independent and still FAIL anywhere: a missing
 * artefact, and bytes that MATCH (a match is a match, whoever built it).
 */
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const ENTRYPOINT = path.join(ROOT, "src/lib/ui/blog-preview-overlay.ts");
const OUTPUT = path.join(ROOT, "public/js/blog-preview-overlay.js");
const OUTPUT_LABEL = "public/js/blog-preview-overlay.js";

/**
 * The Bun this artefact must be built by, read from the single place the repo
 * already declares it. Not duplicated here: a second literal is a second thing
 * to forget when the pin moves.
 */
export function pinnedBunVersion(packageManager: unknown): string {
  if (typeof packageManager !== "string") return "";
  const at = packageManager.indexOf("@");
  return at >= 0 ? packageManager.slice(at + 1).trim() : "";
}

async function readPinnedBunVersion(): Promise<string> {
  const pkg = (await Bun.file(path.join(ROOT, "package.json")).json()) as {
    packageManager?: unknown;
  };
  return pinnedBunVersion(pkg.packageManager);
}

/**
 * Minified, because nobody reads a generated bundle and every byte is charged
 * to `APP_BUDGET_BYTES`. The banner is what a reader of the file needs instead:
 * where it came from and how to regenerate it.
 */
const BANNER = [
  "/* GENERATED — do not edit.",
  " * Source: src/lib/ui/blog-preview-overlay.ts",
  " * Rebuild: bun run build:preview-overlay",
  " * Gated by: bun run build:preview-overlay:check (Issue #592)",
  " */"
].join("\n");

export async function buildPreviewOverlayBundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [ENTRYPOINT],
    target: "browser",
    format: "esm",
    minify: true,
    banner: BANNER
  });

  if (!result.success || result.outputs.length !== 1) {
    const reasons = result.logs.map((entry) => String(entry)).join("\n  ");
    throw new Error(
      `could not bundle ${ENTRYPOINT}:\n  ${reasons || "no output produced"}`
    );
  }

  return await result.outputs[0]!.text();
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const allowVersionMismatch = process.argv.includes(
    "--allow-version-mismatch"
  );
  const pinned = await readPinnedBunVersion();
  const running = Bun.version;
  const onPin = pinned !== "" && running === pinned;

  if (!checkOnly) {
    // Writing on the wrong Bun produces a bundle this gate rejects in CI, and
    // the developer finds out one push later. Refused rather than warned:
    // a warning above a successful write is read as success, and the artefact
    // is already committed by then. The override exists for the one legitimate
    // case — moving the pin itself, where the NEW Bun is the correct builder.
    if (!onPin && !allowVersionMismatch) {
      console.error(
        `build:preview-overlay REFUSED — this is Bun ${running}, the pin is ${pinned || "(unreadable)"}.\n\n` +
          "  A minified bundle is the output of a specific bundler. Writing one\n" +
          "  here produces bytes CI (which runs the pinned Bun) rejects, so the\n" +
          "  commit that 'fixes' the gate is the commit that reddens it.\n\n" +
          `  Rebuild with Bun ${pinned}, or pass --allow-version-mismatch if you\n` +
          "  are deliberately moving the pin.\n"
      );
      process.exitCode = 1;
      return;
    }

    const bundled = await buildPreviewOverlayBundle();
    await Bun.write(OUTPUT, bundled);
    console.log(
      `build:preview-overlay OK — wrote ${OUTPUT_LABEL} (${Buffer.byteLength(bundled)} bytes) with Bun ${running}.`
    );
    return;
  }

  const bundled = await buildPreviewOverlayBundle();

  const existing = Bun.file(OUTPUT);

  if (!(await existing.exists())) {
    console.error(
      `build:preview-overlay:check FAILED — ${OUTPUT_LABEL} is missing.\n` +
        "  Run: bun run build:preview-overlay"
    );
    process.exitCode = 1;
    return;
  }

  if ((await existing.text()) !== bundled) {
    // Off the pin this difference answers no question. Saying "STALE" here
    // would be a claim about the artefact made on evidence about the toolchain,
    // and the remedy it names would commit a bundle CI rejects.
    if (!onPin) {
      console.log(
        `build:preview-overlay:check UNVERIFIED — this is Bun ${running}, the pin is ${pinned || "(unreadable)"}.\n\n` +
          `  ${OUTPUT_LABEL} differs from a bundle built here, but a minified\n` +
          "  bundle's bytes are a property of the bundler as much as of the\n" +
          "  source, so on a different Bun this difference does not distinguish\n" +
          "  a stale artefact from a newer minifier. So it is not reported as\n" +
          "  one, and it is NOT a reason to rebuild: doing that here commits\n" +
          "  bytes CI rejects.\n\n" +
          `  CI runs every job on Bun ${pinned}, so this gate is enforced there\n` +
          "  at full strength. To check it locally, use that Bun.\n"
      );
      return;
    }

    console.error(
      `build:preview-overlay:check FAILED — ${OUTPUT_LABEL} is STALE.\n\n` +
        "  It no longer matches a fresh bundle of\n" +
        "  src/lib/ui/blog-preview-overlay.ts (or of something that module\n" +
        "  imports — the block <-> Portable Text conversion it shares with the\n" +
        "  editor is the whole reason it is a bundle rather than hand-written\n" +
        "  JavaScript).\n\n" +
        "  Run: bun run build:preview-overlay\n"
    );
    process.exitCode = 1;
    return;
  }

  // A MATCH is version-independent evidence: whatever built the committed file,
  // a fresh bundle of the current source reproduces it byte for byte.
  console.log(
    `build:preview-overlay:check OK — ${OUTPUT_LABEL} matches its source` +
      (onPin ? "." : ` (built here on Bun ${running}, pin is ${pinned}).`)
  );
}

if (import.meta.main) {
  await main();
}
