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
 */
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const ENTRYPOINT = path.join(ROOT, "src/lib/ui/blog-preview-overlay.ts");
const OUTPUT = path.join(ROOT, "public/js/blog-preview-overlay.js");
const OUTPUT_LABEL = "public/js/blog-preview-overlay.js";

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
  const bundled = await buildPreviewOverlayBundle();

  if (!checkOnly) {
    await Bun.write(OUTPUT, bundled);
    console.log(
      `build:preview-overlay OK — wrote ${OUTPUT_LABEL} (${Buffer.byteLength(bundled)} bytes).`
    );
    return;
  }

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

  console.log(
    `build:preview-overlay:check OK — ${OUTPUT_LABEL} matches its source.`
  );
}

if (import.meta.main) {
  await main();
}
