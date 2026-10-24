/**
 * Which source files can a job's process reach? A static import tracer, kept as a
 * reusable helper so a test (or a future gate) can ask the question instead of
 * every author answering it by hand (Issue #1120).
 *
 * ## Why this exists
 *
 * `ops/run-job.sh` hands a job container the global env allow-list plus the
 * variables `JOB_SCOPED` (`scripts/jobs-env-allowlist.ts`) grants that job by
 * name. The scoped map is written by a person, and a person is wrong in exactly
 * one direction that matters: a job that reads a secret but is not listed does
 * not crash. It sees the secret as "not configured", takes the inert default and
 * reports success. So the map is held against this tracer from both sides — a
 * job that can reach a reader must be listed (no silent failure), and a listed
 * job must really reach one (no stale grant).
 *
 * ## What it follows, and what it deliberately does not
 *
 * - Followed: `import … from "./x"`, `import "./x"`, `export … from "./x"`, and
 *   `import("./x")` with a LITERAL relative specifier. Bun runs TypeScript with
 *   no build step, so these are exactly the files the process can load.
 * - Not followed: `import type …` and `export type … from`. They are erased
 *   before execution, so a type-only edge cannot make a process read anything.
 *   Following them would grant secrets to jobs that merely share a type.
 * - Not followed: bare specifiers (`node:fs`, `postgres`, `astro:…`). Packages do
 *   not read this repository's variables.
 * - CANNOT follow: `import(someVariable)` or a template with a hole. These are
 *   returned in `dynamic`, never silently skipped — the caller must either fail
 *   or hold an allow-list with a reason per site. A relative specifier that
 *   resolves to no file is returned in `unresolved` for the same reason.
 *
 * It over-approximates on purpose: reachability is file-level, not call-level. A
 * job importing `src/modules/index.ts` "reaches" every module whether or not it
 * calls them. For a least-privilege grant that is the safe direction — the
 * failure to avoid is a missing grant, and a spurious one is visible in the map.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { stripComments } from "./source-text.ts";

/** One edge out of a file the tracer could not follow to a concrete file. */
export type UntraceableImport = {
  /** The importing file, repo-relative. */
  from: string;
  /** The specifier text, or the dynamic-import argument expression. */
  specifier: string;
};

export type ImportTrace = {
  /** The entry file, repo-relative with `/` separators. */
  entry: string;
  /** Every file reachable from the entry (including the entry), repo-relative, sorted. */
  files: string[];
  /** `import(expr)` whose argument is not a string literal. */
  dynamic: UntraceableImport[];
  /** Relative specifiers that resolve to no file on disk, or to a file type the tracer cannot read. */
  unresolved: UntraceableImport[];
  /**
   * Non-relative specifiers (`node:fs`, `postgres`, `@scope/pkg/sub` as
   * `@scope/pkg`). A package is not this repository's code, but a specifier that
   * is neither a builtin nor a declared dependency is something the tracer has
   * never heard of; the caller decides what is acceptable.
   */
  bare: UntraceableImport[];
  /**
   * Ways to run code the import graph cannot see: `require(`, `Bun.spawn(`,
   * `Bun.spawnSync(`, Bun's shell (`Bun.$`), `new Worker(` and any import of
   * `child_process`. A reader reached through them would be invisible.
   */
  escapes: UntraceableImport[];
};

const SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs"
];
/** Imported for their bytes, never executed as code: a leaf, not an unparsed file. */
const DATA_EXTENSIONS =
  /\.(json|css|sql|txt|md|po|svg|png|jpg|jpeg|webp|woff2?)$/;
const SOURCE_FILE = new RegExp(`\\.(${SOURCE_EXTENSIONS.join("|")})$`);

const RESOLVE_SUFFIXES = [
  "",
  ...SOURCE_EXTENSIONS.map((extension) => `.${extension}`),
  ...SOURCE_EXTENSIONS.map((extension) => `/index.${extension}`)
];

/** `import … from "x"` / `export … from "x"` — `type` forms are filtered by the caller. */
const FROM_IMPORT =
  /\b(import|export)\b([^;'"`]*?)\bfrom\s*(["'])([^"'\n]+)\3/g;
/** `import "x"` — a side-effect import. */
const BARE_IMPORT = /(?:^|[\s;{}])import\s*(["'])([^"'\n]+)\1/g;
/** `import(` — the argument that follows is read by `readCallArgument`. */
const DYNAMIC_IMPORT_OPEN = /\bimport\(/g;
const STRING_LITERAL = /^(["'])([^"'\n]*)\1$/;
/** Code the import graph cannot see into. */
const ESCAPES = /\b(require|Bun\.spawn|Bun\.spawnSync)\s*\(/g;
/** Bun's shell: Bun.$`cmd`, and `import { $ } from "bun"`. */
const BUN_SHELL =
  /\bBun\.\$\s*`|\bimport\s*\{[^}]*\$[^}]*\}\s*from\s*["']bun["']/;
/** `new Worker(...)` loads another module the graph does not see. */
const NEW_WORKER = /\bnew\s+Worker\s*\(/;

/** Repo-relative form with forward slashes — stable across hosts and in messages. */
function toRepoPath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function resolveRelative(
  fromAbsolute: string,
  specifier: string
): string | null {
  const base = path.resolve(path.dirname(fromAbsolute), specifier);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * The index of the bracket that closes the group `text` is inside at `start`
 * (the first unmatched `)`, `]` or `}`), or -1 when there is none. Strings and
 * template literals are skipped, and a template's `${ … }` is scanned as the
 * expression it is, so a `)` inside a string or a nested call cannot end the
 * argument early.
 */
function findClosingBracket(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index] as string;
    if (char === '"' || char === "'") {
      index += 1;
      while (index < text.length && text[index] !== char) {
        index += text[index] === "\\" ? 2 : 1;
      }
    } else if (char === "`") {
      index += 1;
      while (index < text.length && text[index] !== "`") {
        if (text[index] === "\\") {
          index += 2;
        } else if (text[index] === "$" && text[index + 1] === "{") {
          const close = findClosingBracket(text, index + 2);
          if (close === -1) return -1;
          index = close + 1;
        } else {
          index += 1;
        }
      }
    } else if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return index;
      depth -= 1;
    }
    index += 1;
  }
  return -1;
}

/**
 * The argument of the `import(` whose opening bracket ends just before `start`,
 * whitespace collapsed so a formatter cannot change what a site is keyed by.
 * An argument that never closes is returned to the end of the text rather than
 * dropped: it is reported like any other computed import.
 */
function readCallArgument(text: string, start: number): string {
  const close = findClosingBracket(text, start);
  return text
    .slice(start, close === -1 ? text.length : close)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The specifiers a file loads at runtime, split by how far the tracer can go.
 * Exported separately from `traceImports` so the parsing is testable on a string.
 */
export function readImports(source: string): {
  relative: string[];
  dynamic: string[];
  bare: string[];
  escapes: string[];
} {
  const text = stripComments(source);
  const relative = new Set<string>();
  const bare = new Set<string>();
  const dynamic: string[] = [];

  const add = (specifier: string): void => {
    if (specifier.startsWith(".")) relative.add(specifier);
    else if (specifier.length > 0) bare.add(packageName(specifier));
  };

  for (const match of text.matchAll(FROM_IMPORT)) {
    const clause = (match[2] ?? "").trim();
    // `import type { X } from …` and `export type { X } from …` are erased
    // before Bun executes anything.
    if (/^type\b/.test(clause)) continue;
    add(match[4] ?? "");
  }

  for (const match of text.matchAll(BARE_IMPORT)) {
    add(match[2] ?? "");
  }

  for (const match of text.matchAll(DYNAMIC_IMPORT_OPEN)) {
    const argument = readCallArgument(
      text,
      (match.index as number) + match[0].length
    );
    // `import()` with nothing inside is a syntax error, so it can only be prose
    // that the comment stripper left behind (a backticked `import()` in a doc).
    if (argument === "") continue;
    const literal = STRING_LITERAL.exec(argument);
    if (literal) add(literal[2] ?? "");
    else dynamic.push(argument);
  }

  const escapes = [...text.matchAll(ESCAPES)].map((match) => `${match[1]}(`);
  if (BUN_SHELL.test(text)) escapes.push("Bun.$");
  if (NEW_WORKER.test(text)) escapes.push("new Worker(");
  // Importing the process-spawning builtin is itself the escape: what it starts
  // is invisible to the graph.
  for (const name of bare) {
    if (name === "node:child_process" || name === "child_process") {
      escapes.push("child_process");
    }
  }

  return {
    relative: [...relative],
    dynamic,
    bare: [...bare],
    escapes: [...new Set(escapes)]
  };
}

/** `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`; `node:fs` and `bun:test` unchanged. */
export function packageName(specifier: string): string {
  if (/^(node|bun|astro):/.test(specifier)) return specifier;
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? specifier);
}

/** Every file reachable from `entry` through static (and literal dynamic) imports. */
export function traceImports(entry: string, root = process.cwd()): ImportTrace {
  const entryAbsolute = path.resolve(root, entry);
  const seen = new Set<string>();
  const dynamic: UntraceableImport[] = [];
  const unresolved: UntraceableImport[] = [];
  const bare: UntraceableImport[] = [];
  const escapes: UntraceableImport[] = [];
  const queue = [entryAbsolute];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);

    // Only source we can parse. A data file is a leaf; anything else we cannot
    // read (an `.astro` page, say) is reported rather than assumed harmless.
    if (!SOURCE_FILE.test(current)) {
      if (current !== entryAbsolute && !DATA_EXTENSIONS.test(current)) {
        unresolved.push({
          from: toRepoPath(root, current),
          specifier: "(file type the tracer cannot read)"
        });
      }
      continue;
    }

    const from = toRepoPath(root, current);
    const imports = readImports(readFileSync(current, "utf8"));

    for (const specifier of imports.bare) bare.push({ from, specifier });
    for (const specifier of imports.escapes) escapes.push({ from, specifier });

    for (const expression of imports.dynamic) {
      dynamic.push({
        from: toRepoPath(root, current),
        specifier: expression
      });
    }

    for (const specifier of imports.relative) {
      const resolved = resolveRelative(current, specifier);
      if (resolved === null) {
        unresolved.push({ from: toRepoPath(root, current), specifier });
      } else {
        queue.push(resolved);
      }
    }
  }

  return {
    entry: toRepoPath(root, entryAbsolute),
    files: [...seen].map((file) => toRepoPath(root, file)).sort(),
    dynamic,
    unresolved,
    bare,
    escapes
  };
}

/**
 * The script file a `bun run <target>` executes, from `package.json` `scripts`.
 * Only the plain `bun <file> [args]` shape resolves; a chained command or a
 * different runner returns null (those are not jobs `run-job.sh` can usefully
 * run, and the caller should say so rather than guess).
 */
export function resolveTargetEntry(
  target: string,
  packageScripts: Readonly<Record<string, string>>
): string | null {
  const command = packageScripts[target];
  if (command === undefined) return null;
  const match =
    /^bun\s+(?!run\b)(scripts\/\S+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))(?:\s|$)/.exec(
      command
    );
  return match ? (match[1] ?? null) : null;
}
