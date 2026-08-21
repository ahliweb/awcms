/**
 * jsonb-binding-check.ts — `bun run db:jsonb-binding:check` (Issue #641).
 *
 * Refuses `${JSON.stringify(x)}::jsonb` anywhere in `src/` or `scripts/`.
 *
 * ## Why a gate and not a comment
 *
 * Four files in this repo already carried a comment warning about exactly this
 * trap — `reporting/application/reconciliation-run-store.ts`,
 * `identity-access/application/machine-credential-directory.ts`,
 * `site-profile/application/site-profile-directory.ts` and
 * `visitor-analytics/application/collector.ts`. Somebody hit it, wrote it down
 * where they hit it, and SEVEN other call sites kept the broken spelling —
 * including `blog:portable-text:backfill`, the job whose whole purpose is to
 * populate the canonical column ADR-0100 introduced.
 *
 * A comment in four files told four files. This tells the build.
 *
 * ## What the trap actually is
 *
 * Bun.SQL JSON-ENCODES a string parameter bound to a jsonb slot, so
 * `${JSON.stringify(x)}::jsonb` stores the jsonb SCALAR STRING `"[{...}]"`
 * rather than the value. Verified against a real PostgreSQL 18:
 *
 *   JSON.stringify + ::jsonb  ->  jsonb_typeof = 'string'
 *   the JS value   + ::jsonb  ->  jsonb_typeof = 'array'
 *
 * Nothing throws. `jsonb_typeof` reports `string`, `@>` matches nothing, `->`
 * returns null, and a reader that happens to `JSON.parse` the value back makes
 * the round trip look correct. On the public blog path it meant
 * `hasCanonicalPortableTextBody` — `Array.isArray(...)` — was always false, so
 * every page rendered the lossy `content_json` projection instead of the
 * canonical body.
 *
 * ## The fix is always the same
 *
 * Bind the JS value: `${value}::jsonb`. For an optional column,
 * `${value ?? null}::jsonb`.
 */
import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";

const ROOT = path.resolve(import.meta.dir, "..");
const SCANNED_DIRECTORIES = ["src", "scripts"];

/**
 * `JSON.stringify(...)` immediately followed by `}::jsonb`, allowing the
 * newlines Prettier introduces between them. `[\s\S]*?` is non-greedy so a file
 * with two unrelated occurrences cannot be matched as one span.
 */
const OFFENDING_PATTERN = /JSON\.stringify\([\s\S]*?\)\s*\}\s*::\s*jsonb/;

/**
 * A line that MENTIONS the trap rather than committing it. Every current
 * mention is inside a comment explaining the rule, and a gate that reddened on
 * its own documentation would teach people to delete the documentation.
 */
function isExplanatoryMention(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("*") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("--") ||
    trimmed.startsWith("/*")
  );
}

type Finding = { file: string; line: number; text: string };

function walk(directory: string, out: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (full.endsWith(".ts") || full.endsWith(".astro")) {
      out.push(full);
    }
  }
  return out;
}

export function findJsonbBindingOffenders(
  files: readonly { path: string; source: string }[]
): Finding[] {
  const findings: Finding[] = [];

  for (const file of files) {
    const lines = file.source.split("\n");

    for (const [index, line] of lines.entries()) {
      if (isExplanatoryMention(line)) {
        continue;
      }

      // Join with the next two lines so a call Prettier wrapped across them is
      // still seen as one expression.
      const window = [
        line,
        lines[index + 1] ?? "",
        lines[index + 2] ?? ""
      ].join("\n");

      if (line.includes("JSON.stringify(") && OFFENDING_PATTERN.test(window)) {
        findings.push({
          file: file.path,
          line: index + 1,
          text: line.trim()
        });
      }
    }
  }

  return findings;
}

function main(): void {
  const files: { path: string; source: string }[] = [];

  for (const directory of SCANNED_DIRECTORIES) {
    for (const full of walk(path.join(ROOT, directory), [])) {
      files.push({
        path: path.relative(ROOT, full),
        source: readFileSync(full, "utf8")
      });
    }
  }

  const findings = findJsonbBindingOffenders(files);

  if (findings.length > 0) {
    console.error(
      `db:jsonb-binding:check FAILED — ${findings.length} site(s) bind a STRINGIFIED value to a jsonb slot:\n`
    );
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}`);
      console.error(`      ${finding.text}`);
    }
    console.error(
      "\n  Bun.SQL JSON-ENCODES a string parameter bound to a jsonb slot, so this\n" +
        "  stores the jsonb SCALAR STRING rather than the value. Nothing throws:\n" +
        "  `@>` matches nothing, `->` returns null, and a reader that parses the\n" +
        "  string back makes the round trip look correct (Issue #641).\n\n" +
        "  Bind the value itself:  ${value}::jsonb\n" +
        "  Optional column:        ${value ?? null}::jsonb\n"
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `db:jsonb-binding:check OK — ${files.length} file(s) scanned, no stringified jsonb bindings.`
  );
}

if (import.meta.main) {
  main();
}
