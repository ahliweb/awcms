/**
 * Mechanical checks behind the hand-written exemption lists in
 * `scripts/jobs-env-allowlist.ts` (Issue #1131, L4).
 *
 * Every list there is an EXCUSE: it says "this job reaches a reader of a scoped
 * secret, or a computed import, and that is fine". An excuse is only as good as
 * the check that notices when it stops being true. These helpers work on source
 * text so `tests/jobs-env-exemption-guards.test.ts` can prove, with synthetic
 * sources, that each check fires — a guard that was never seen to fail is not
 * evidence of anything.
 *
 * ## Which declaration does a reference sit in?
 *
 * The repository is Prettier-formatted, so every top-level declaration starts at
 * column 0 and everything inside it is indented. `enclosingDeclaration` uses
 * that instead of a brace matcher: it takes the nearest column-0 line above the
 * reference. A column-0 line it does not recognise as a function or a constant
 * (a `class`, a `type`, an `if`) is reported as such rather than being folded
 * into the declaration above it, because folding is how a class method calling a
 * reader would be attributed to an innocent function that happens to precede it.
 * When the layout is not what is assumed, the answer is a name nobody listed,
 * which fails the check — the safe direction.
 */

/** What `enclosingDeclaration` returns for a reference outside any function or constant. */
export const MODULE_LEVEL = "(module level)";

const DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*(\w+)|(?:const|let|var)\s+(\w+)|(?:abstract\s+)?class\s+(\w+))/;

/**
 * The name of the top-level function or constant containing `index`; `class X`
 * for a class; `(module level)` for anything else at column 0.
 */
export function enclosingDeclaration(source: string, index: number): string {
  let lineStart = source.lastIndexOf("\n", index - 1) + 1;
  for (;;) {
    const lineEnd = source.indexOf("\n", lineStart);
    const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (/^[A-Za-z_$@]/.test(line)) {
      const match = DECLARATION.exec(line);
      if (!match) return MODULE_LEVEL;
      if (match[3] !== undefined) return `class ${match[3]}`;
      return match[1] ?? match[2] ?? MODULE_LEVEL;
    }
    if (lineStart === 0) return MODULE_LEVEL;
    lineStart = source.lastIndexOf("\n", lineStart - 2) + 1;
  }
}

/** Offsets of `name` in `source` that are not its own declaration. */
export function referencesOf(source: string, name: string): number[] {
  const out: number[] = [];
  const declaration = new RegExp(
    `(?:function\\s*\\*?\\s+|const\\s+|let\\s+)${name}\\b`
  );
  for (const match of source.matchAll(new RegExp(`\\b${name}\\b`, "g"))) {
    const index = match.index as number;
    if (
      declaration.test(
        source.slice(Math.max(0, index - 20), index + name.length)
      )
    ) {
      continue;
    }
    out.push(index);
  }
  return out;
}

/**
 * Offsets where `source` READS the variable `name`: `env.NAME`, `{ NAME } = env`,
 * or the name as an exact string literal (a helper such as
 * `readConfiguredUrl("NAME")`). A message that merely contains the name inside a
 * longer string is not a read.
 */
export function variableReadOffsets(source: string, name: string): number[] {
  const patterns = [
    new RegExp(`["'\`]${name}["'\`]`, "g"),
    new RegExp(`\\.${name}\\b`, "g"),
    new RegExp(`\\{[^{}]*\\b${name}\\b[^{}]*\\}\\s*=\\s*\\w`, "g")
  ];
  return patterns
    .flatMap((pattern) =>
      [...source.matchAll(pattern)].map((match) => match.index as number)
    )
    .sort((a, b) => a - b);
}

/**
 * `REACHES_WITHOUT_READING` excuses a job that imports the file reading `name`
 * without calling the reader. The rest of the proof checks every OTHER file the
 * job reaches; this checks the reader file itself, which that proof skips:
 *
 * - every read of `name` is inside one of `readerCalls`; and
 * - every reference to a function in `readerCalls` is inside another of them.
 *
 * Together the listed functions are a closed set that nothing else in the file
 * touches. A new helper that calls a reader internally, a constant initialised
 * from one at import time, or a second function that reads the variable is
 * reported, because a job that imports the helper would then read the secret
 * through a file it was excused for.
 */
export function readerFileProblems(
  file: string,
  strippedSource: string,
  name: string,
  readerCalls: readonly string[]
): string[] {
  const problems: string[] = [];
  const allowed = new Set(readerCalls);

  for (const offset of variableReadOffsets(strippedSource, name)) {
    const inside = enclosingDeclaration(strippedSource, offset);
    if (!allowed.has(inside)) {
      problems.push(
        `${file}: ${inside} reads ${name} and is not in readerCalls (${readerCalls.join(", ")})`
      );
    }
  }

  for (const call of readerCalls) {
    for (const offset of referencesOf(strippedSource, call)) {
      const inside = enclosingDeclaration(strippedSource, offset);
      if (!allowed.has(inside)) {
        problems.push(
          `${file}: ${inside} references ${call}, which reads ${name}, and is not in readerCalls (${readerCalls.join(", ")})`
        );
      }
    }
  }

  return [...new Set(problems)];
}

/** One computed `import(...)`: where it is and the exact expression inside the brackets. */
export type ImportSite = { file: string; expression: string };

const siteKey = (site: ImportSite): string =>
  `${site.file}\u0000${site.expression}`;

/**
 * Compare the computed imports found with the ones `UNTRACEABLE_IMPORT_SITES`
 * lists, as MULTISETS keyed by file and expression: a second computed import in
 * a listed file is not covered by the first one's entry, and neither is a second
 * occurrence of the same expression (list it twice to accept two).
 */
export function diffImportSites(
  found: readonly ImportSite[],
  listed: readonly ImportSite[]
): { unexplained: ImportSite[]; stale: ImportSite[] } {
  const remaining = new Map<string, number>();
  for (const site of listed) {
    remaining.set(siteKey(site), (remaining.get(siteKey(site)) ?? 0) + 1);
  }

  const unexplained: ImportSite[] = [];
  for (const site of found) {
    const left = remaining.get(siteKey(site)) ?? 0;
    if (left > 0) remaining.set(siteKey(site), left - 1);
    else unexplained.push(site);
  }

  const stale: ImportSite[] = [];
  for (const site of listed) {
    const left = remaining.get(siteKey(site)) ?? 0;
    if (left > 0) {
      stale.push(site);
      remaining.set(siteKey(site), left - 1);
    }
  }

  return { unexplained, stale };
}
