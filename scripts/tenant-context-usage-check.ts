/**
 * `withTenant` may refuse. This gate covers the two ways that refusal can be
 * lost that the TYPE SYSTEM cannot see.
 *
 * `withTenant(...)` returns `T | Response`, so anything that reads fields off
 * the result is a compile error the day it is written. Two holes remain, and
 * both are the shape that shipped:
 *
 * 1. **A discarded result.** `await withTenant(sql, id, async (tx) => { … })`
 *    as a bare statement type-checks perfectly — the `503` is constructed,
 *    returned, and dropped on the floor. The write never happened and nobody
 *    is told. `withTenantOrThrow` is the form for a side-effect-only call: it
 *    throws, so the caller's own `catch` (or the job runner) sees it.
 *
 * 2. **`.astro` frontmatter.** `bun run typecheck` is `tsc --noEmit`, which
 *    does not read `.astro` files at all, so an admin page could assign a
 *    `Response` to a variable it then maps over and no gate in the chain
 *    would notice. Every one of the 15 admin screens calls this from
 *    frontmatter that returns DATA, never a `Response`, so the rule for that
 *    extension is simply "use `withTenantOrThrow`" — no judgement call, and
 *    no need to teach this script what an Astro page returns.
 *
 * Pure text, no database, no AST: it runs in the `quality` job on every PR and
 * fails at authoring time, the same shape as
 * `migration-tenant-guc-consistency` and `table-write-ownership-check`.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

const SOURCE_ROOTS = ["src", "scripts", "tests"];
const SOURCE_EXTENSIONS = [".ts", ".astro"];

/**
 * The definition itself, plus the two gates that scan source text for this
 * very call and would otherwise report their own regexes.
 */
const EXEMPT_FILES = new Set([
  "src/lib/database/tenant-context.ts",
  "scripts/tenant-context-usage-check.ts",
  "scripts/tenant-route-factory-check.ts",
  "scripts/work-class-registry-generate.ts"
]);

/** `withTenant(` / `withTenant<T>(` — and NOT `withTenantOrThrow(`, which is the fix. */
const WITH_TENANT_CALL = /\bwithTenant\s*(?:<[^()]*>)?\s*\(/;

/**
 * A call whose value goes nowhere: the line starts the statement with `await`
 * (or the bare call) rather than `return`, `=`, `const`, `(`, `?`, `,` …
 *
 * Anchored at the start of the trimmed line on purpose. `const x = await
 * withTenant(` and `return withTenant(` both keep the value reachable, and
 * whichever branch reads it is then the compiler's problem, not this gate's.
 */
const DISCARDED_CALL =
  /^await\s+withTenant\s*(?:<[^()]*>)?\s*\(|^withTenant\s*(?:<[^()]*>)?\s*\(/;

export type UsageViolation = {
  file: string;
  line: number;
  kind: "discarded_result" | "astro_frontmatter";
  text: string;
};

/**
 * Comment lines are dropped so a docblock EXPLAINING this rule is not read as
 * breaking it — the same self-report `table-write-ownership-check` hit, and
 * this file's own header would trip it on the first run otherwise.
 */
export function findUsageViolations(
  file: string,
  source: string
): UsageViolation[] {
  if (EXEMPT_FILES.has(file)) return [];

  const isAstro = file.endsWith(".astro");
  const violations: UsageViolation[] = [];

  source.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (
      line.startsWith("//") ||
      line.startsWith("*") ||
      line.startsWith("/*")
    ) {
      return;
    }

    if (!WITH_TENANT_CALL.test(line)) return;

    if (isAstro) {
      violations.push({
        file,
        line: index + 1,
        kind: "astro_frontmatter",
        text: line
      });
      return;
    }

    if (DISCARDED_CALL.test(line)) {
      violations.push({
        file,
        line: index + 1,
        kind: "discarded_result",
        text: line
      });
    }
  });

  return violations;
}

async function* walk(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* walk(full);
      continue;
    }

    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      yield full;
    }
  }
}

export async function collectUsageViolations(): Promise<UsageViolation[]> {
  const violations: UsageViolation[] = [];

  for (const root of SOURCE_ROOTS) {
    for await (const file of walk(root)) {
      violations.push(
        ...findUsageViolations(file, await Bun.file(file).text())
      );
    }
  }

  return violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
  );
}

const REASON: Record<UsageViolation["kind"], string> = {
  discarded_result:
    "hasil withTenant() dibuang. Saat pool menolak, 503-nya hilang tanpa jejak dan " +
    "penulisan tak pernah terjadi — pakai withTenantOrThrow() supaya menjadi error.",
  astro_frontmatter:
    "frontmatter .astro tidak dicek `tsc --noEmit`, jadi Response yang bocor ke sini " +
    "tak tertangkap siapa pun — pakai withTenantOrThrow()."
};

async function main(): Promise<void> {
  const violations = await collectUsageViolations();

  if (violations.length === 0) {
    console.log(
      "tenant-context usage OK — tidak ada hasil withTenant() yang dibuang, " +
        "tidak ada pemanggilan dari .astro."
    );
    return;
  }

  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line} — ${REASON[violation.kind]}\n    ${violation.text}`
    );
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
