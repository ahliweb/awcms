#!/usr/bin/env bun
/**
 * build:inline-scripts:check — no component script may be INLINED into the SSR
 * output.
 *
 * WHY THIS GATE READS `dist/` AND NOT THE SOURCE
 *
 * `src/lib/security/security-headers.ts` sends one CSP with no
 * `'unsafe-inline'`: `script-src 'self' '<theme-init hash>'`. Exactly one inline
 * script is authorised, by hash, and it is written by hand as `is:inline`
 * (`THEME_INIT_SCRIPT_BODY`). Every other client script must be an
 * Astro-bundled EXTERNAL module, which `'self'` admits.
 *
 * Whether a component `<script>` ends up external is decided by the BUNDLER, not
 * by the source. Astro emits an external file only when something survives
 * bundling that needs a cross-chunk import; if nothing does, it writes the whole
 * body into the SSR manifest's `inlinedScripts` map and `renderScript` emits
 * `<script type="module">…</script>`. The browser then refuses it and the
 * feature is rendered-but-dead.
 *
 * That has now happened three times:
 *
 *   1. `LanguageSwitcher` — shipped, found in production (v9.1.2).
 *   2. The first attempted fix for it — a bare side-effect import into a module
 *      nothing else used, which folded into the script and inlined identically.
 *   3. `ThemeToggle` — sat in the build for weeks while the component's own doc
 *      comment asserted the opposite, because its only import was a string
 *      constant that the minifier folds to a literal.
 *
 * All three were invisible to 47 gates and ~4,400 tests, because dev, `bun run
 * build` and Playwright all speak plain HTTP with no CSP enforcement. The one
 * place the truth is written down is the built manifest. So this reads that.
 *
 * THE INVARIANT
 *
 * `inlinedScripts` must contain no entry with a non-empty body. It is not "at
 * most one" — the hash-authorised script is `is:inline` and therefore never
 * passes through this map at all, so the correct count is ZERO. A bound of zero
 * is also the only bound that cannot rot: no allow-list to update, nothing to
 * quietly widen when the next component wants an exception.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "dist/server/entry.mjs");

/** One inlined script found in the built manifest. */
export type InlinedScript = { id: string; bytes: number };

/**
 * Pull the `inlinedScripts` entries out of the serialized manifest.
 *
 * The manifest is embedded in `entry.mjs` as a JSON string argument, so this
 * finds the `"inlinedScripts":[…]` array and walks it with a brace/bracket
 * counter rather than trying to JSON.parse the whole (very large) file or
 * matching the bodies with a regex — script bodies contain brackets, quotes and
 * escapes, and a regex over them is the `js/bad-tag-filter` mistake in a
 * different costume.
 *
 * Exported for `tests/build-inline-script-check.test.ts`, which feeds it
 * synthetic manifests including the exact shapes this repo has shipped.
 */
export function extractInlinedScripts(source: string): InlinedScript[] {
  const key = '"inlinedScripts":';
  const keyAt = source.indexOf(key);
  if (keyAt === -1) return [];

  let i = source.indexOf("[", keyAt);
  if (i === -1) return [];

  const scripts: InlinedScript[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  /** Entries of the innermost `[id, body]` pair currently being read. */
  let pair: string[] = [];
  let current = "";

  for (; i < source.length; i++) {
    const ch = source[i] as string;

    if (inString) {
      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        current += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        pair.push(current);
        current = "";
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      current = "";
      continue;
    }
    if (ch === "[") {
      depth++;
      if (depth === 2) pair = [];
      continue;
    }
    if (ch === "]") {
      depth--;
      if (depth === 1) {
        const [id, body] = pair;
        // A present-but-empty body means "resolve externally" — not an inline
        // script. Only a non-empty body is actually written into the HTML.
        if (id !== undefined && body !== undefined && body.length > 0) {
          scripts.push({ id, bytes: body.length });
        }
      }
      if (depth === 0) break;
      continue;
    }
  }

  return scripts;
}

/** Trim the absolute build path so the message names a file a reader can open. */
function relativeId(id: string): string {
  const withoutRoot = id.startsWith(ROOT) ? id.slice(ROOT.length + 1) : id;
  return withoutRoot.split("?")[0] ?? withoutRoot;
}

if (import.meta.main) {
  if (!existsSync(ENTRY)) {
    console.error(
      `build:inline-scripts:check FAILED — ${path.relative(ROOT, ENTRY)} does not exist.\n` +
        `  This gate reads the BUILT artefact, so it cannot run before a build.\n` +
        `  Run \`bun run build\` first (the \`check\` chain already does).`
    );
    process.exit(1);
  }

  const scripts = extractInlinedScripts(readFileSync(ENTRY, "utf8"));

  if (scripts.length > 0) {
    console.error(
      `build:inline-scripts:check FAILED — ${scripts.length} component script(s) were INLINED into the SSR output:`
    );
    for (const { id, bytes } of scripts) {
      console.error(`  - ${relativeId(id)} (${bytes} bytes)`);
    }
    console.error(
      `\n  The CSP is \`script-src 'self' '<theme-init hash>'\`, so the browser will\n` +
        `  REFUSE each of these and the feature will render but never run. Nothing in\n` +
        `  dev, in the build, or in Playwright shows this — they all speak plain HTTP\n` +
        `  with no CSP enforcement.\n\n` +
        `  Fix: move the behaviour into \`src/lib/ui/<name>-client.ts\` and import it\n` +
        `  from \`AdminLayout.astro\`'s script block, alongside the imports already\n` +
        `  proven external. Do NOT reach for \`is:inline\` + a second hash: that grows\n` +
        `  the CSP allow-list once per component and each new hash is another thing\n` +
        `  that silently stops matching when a byte changes.`
    );
    process.exit(1);
  }

  console.log(
    "build:inline-scripts:check OK — no component script is inlined; the only inline script is the hash-authorised theme-init body."
  );
}
