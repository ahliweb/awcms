/**
 * Static scan behind the single-flight form audit (Issue #1224).
 *
 * Reads every client script under `src/pages/**`, `src/components/**` and
 * `src/lib/ui/**` and reports, per ENTRY POINT, how it is bound and what it
 * does:
 *
 *   - `onSubmit` / `onSubmitAll` / `onAction` — the shared helpers of
 *     `src/lib/ui/admin-form-client.ts`, which own the in-flight flag since
 *     #1224;
 *   - `direct-submit` — `addEventListener("submit", …)` on the page's own;
 *   - `direct-click` — an `addEventListener("click", …)` whose listener body
 *     reaches a request.
 *
 * It exists for two consumers that must not drift apart: the source-contract
 * test (`tests/single-flight-source-contract.test.ts`) that fails when a script
 * binds outside the helpers, and `bun run ui:single-flight:audit`, which prints
 * the same findings so the table in `docs/awcms/ui-single-flight-audit.md` can
 * be regenerated and compared against the code.
 *
 * ## What it is NOT
 *
 * It is a lexical scan, not an analysis. It strips comments, finds a call by
 * name and matches its parentheses. That is enough for this codebase's
 * conventions (positional helper calls with an inline handler) and it is
 * deliberately conservative: anything it cannot classify is reported as
 * `unknown`, never silently dropped.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { listFilesRecursive, REPO_ROOT } from "./repo-files";
import { stripComments } from "./source-text";

export const HELPER_NAMES = ["onSubmit", "onSubmitAll", "onAction"] as const;

export type EntryKind =
  (typeof HELPER_NAMES)[number] | "direct-submit" | "direct-event";

/** How the entry point guarded double-submit BEFORE #1224. */
export type ProtectionBefore =
  /** The handler (or a helper it calls) locks its control: `lockElement`, `mutateAndReload`. */
  | "lock"
  /** Locks nothing the scan can see; read by hand in the audit table. */
  | "none-seen";

export type EntryPoint = {
  /** Repo-relative, forward slashes. */
  file: string;
  /** 1-based line of the binding call. */
  line: number;
  /** 1-based line of the call's closing parenthesis. */
  endLine: number;
  kind: EntryKind;
  /** First string argument: the form id, selector, or event name. */
  target: string;
  /** Does the handler reach a request (directly or through a known helper)? */
  reachesRequest: boolean;
  /** How the handler guarded double-submit on its own. */
  guard: ProtectionBefore;
  /** Does the handler reach an `Idempotency-Key` source? */
  idempotencyKey: boolean;
};

const SCAN_ROOTS = ["src/pages", "src/components", "src/lib/ui"] as const;

/** Server routes under `src/pages/api` render no client script. */
const SKIP_PREFIXES = ["src/pages/api/"];

/** The module that DEFINES the helpers; it is the mechanism, not a consumer. */
export const HELPER_MODULE = "src/lib/ui/admin-form-client.ts";

/**
 * Identifiers that put a MUTATING request on the wire. A bare `fetch(` is not a
 * seed: most are GETs (a list, a poll), which a double click cannot duplicate.
 * See {@link mutatingFetch}.
 */
const REQUEST_SEEDS = [
  "sendJson",
  "sendJsonRequest",
  "sendJsonForData",
  "sendJsonWithFieldErrors",
  "mutateAndReload"
];

/** Identifiers that lock the control (the pre-#1224 protection). */
const LOCK_SEEDS = ["lockElement", "mutateAndReload"];

const KEY_LITERALS = ["Idempotency-Key"];

type Source = {
  file: string;
  /** Comment-stripped code, string CONTENTS intact (for values). */
  code: string;
  /** Same length; string contents blanked (for structure). */
  masked: string;
};

/** Blank everything between quotes so a `)` inside a string cannot unbalance a match. */
export function maskStrings(code: string): string {
  const out = code.split("");
  let index = 0;

  while (index < code.length) {
    const char = code[index]!;

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      index += 1;

      while (index < code.length) {
        if (code[index] === "\\") {
          if (code[index] !== "\n") out[index] = " ";
          if (code[index + 1] !== "\n") out[index + 1] = " ";
          index += 2;
          continue;
        }
        if (code[index] === quote) {
          index += 1;
          break;
        }
        if (code[index] !== "\n") out[index] = " ";
        index += 1;
      }

      continue;
    }

    index += 1;
  }

  return out.join("");
}

/**
 * The script bodies of an `.astro` file, each padded with newlines so that a
 * line number in the extracted text equals the line number in the file.
 */
export function astroScripts(source: string): string {
  // The frontmatter is server code and may MENTION `<script>` in a comment.
  const fence = /^---\r?\n[\s\S]*?\r?\n---/.exec(source);
  const text = fence
    ? fence[0].replace(/[^\n]/g, " ") + source.slice(fence[0].length)
    : source;
  const pieces: string[] = [];
  // Attribute values may contain `>` and `/` (a URL), so they are matched as
  // quoted units; a self-closing `<script … />` has no body and must not
  // swallow the markup up to the NEXT `</script>`.
  const pattern =
    /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  let consumed = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match[1]!.trimEnd().endsWith("/")) {
      pattern.lastIndex = match.index + match[0].indexOf(">") + 1;
      continue;
    }

    const bodyStart = match.index + match[0].length - match[2]!.length - 9;
    const before = text.slice(consumed, bodyStart);
    // Keep the newlines only; everything else outside a script is markup.
    pieces.push(before.replace(/[^\n]/g, " "));
    pieces.push(match[2]!);
    consumed = bodyStart + match[2]!.length;
  }

  return pieces.join("");
}

function loadSource(root: string, file: string): Source {
  const text = readFileSync(path.join(root, file), "utf8");
  const raw = file.endsWith(".astro") ? astroScripts(text) : text;
  const code = stripComments(raw);

  return { file, code, masked: maskStrings(code) };
}

/** Index just past the `)` matching the `(` at `open`, or -1. */
function matchParen(masked: string, open: number): number {
  let depth = 0;

  for (let index = open; index < masked.length; index += 1) {
    const char = masked[index];

    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return -1;
}

function lineOf(code: string, index: number): number {
  let line = 1;

  for (let i = 0; i < index; i += 1) if (code[i] === "\n") line += 1;

  return line;
}

function firstStringArgument(code: string, open: number): string {
  const match = /^\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(code.slice(open + 1));

  return match ? match[2]! : "";
}

/**
 * Index of the `{` that opens the body of a function whose parameter list
 * opens at `paren`. A parameter's own object TYPE contains braces, so the
 * parameter list is matched first; a `Promise<{ … }>` return type contains
 * them too, so angle depth is tracked until the body brace.
 */
function bodyOpen(masked: string, paren: number): number {
  const afterParams = matchParen(masked, paren);
  if (afterParams === -1) return -1;

  let angle = 0;

  for (let index = afterParams; index < masked.length; index += 1) {
    const char = masked[index];

    if (char === "<") angle += 1;
    else if (char === ">" && masked[index - 1] !== "=") angle -= 1;
    else if (char === "{" && angle <= 0) return index;
    else if (char === ";" && angle <= 0) return -1;
  }

  return -1;
}

/** Index just past the `}` matching the `{` at `open`, or -1. */
function matchBrace(masked: string, open: number): number {
  let depth = 0;

  for (let index = open; index < masked.length; index += 1) {
    const char = masked[index];

    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return -1;
}

type Declared = { name: string; exported: boolean; body: Source };

/** Every function declared in `source`, with its body as a sub-source. */
function declaredFunctions(source: Source): Declared[] {
  const declared: Declared[] = [];
  const declaration =
    /(\bexport\s+)?\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/g;
  const arrow =
    /(\bexport\s+)?\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g;

  for (const pattern of [declaration, arrow]) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source.masked)) !== null) {
      const open = bodyOpen(source.masked, match.index + match[0].length - 1);
      if (open === -1) continue;

      const end = matchBrace(source.masked, open);
      if (end === -1) continue;

      declared.push({
        name: match[2]!,
        exported: match[1] !== undefined,
        body: {
          file: source.file,
          code: source.code.slice(open, end),
          masked: source.masked.slice(open, end)
        }
      });
    }
  }

  return declared;
}

function callsIdentifier(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${name}\\s*(?:<[^>(]*>)?\\(`).test(text);
}

/** A `fetch(` whose options name a mutating method, in the same text. */
function mutatingFetch(text: string): boolean {
  return (
    /(?<![\w$.])fetch\s*\(/.test(text) &&
    /method\s*:\s*["'`](?:POST|PUT|PATCH|DELETE)["'`]/.test(text)
  );
}

/** What a body must mention to count, and how to look for it. */
type Probe = {
  /** Function names whose CALL counts. */
  names: readonly string[];
  /** Literal text whose presence counts (e.g. a header name). */
  literals?: readonly string[];
  /** Whether a mutating `fetch(` counts. */
  mutatingFetch?: boolean;
};

/**
 * The two scopes a call can resolve to: names EXPORTED from a shared module
 * (resolved in every file), and names declared in the same file. A bare name
 * is never matched across files — `render`/`sync` exist in a dozen scripts
 * and an earlier version that did so called a colour toggle "a request".
 */
type Reach = { shared: Set<string>; local: Map<string, Set<string>> };

function bodyReaches(
  body: { code: string; masked: string },
  probe: Probe,
  names: ReadonlySet<string>
): boolean {
  if (probe.mutatingFetch && mutatingFetch(body.code)) return true;

  for (const literal of probe.literals ?? []) {
    if (body.code.includes(literal)) return true;
  }

  for (const name of names) {
    if (callsIdentifier(body.masked, name)) return true;
  }

  return false;
}

/** The fixed point of "this function reaches the probe", per file. */
function computeReach(sources: Source[], probe: Probe): Reach {
  const shared = new Set(probe.names);
  const local = new Map<string, Set<string>>();
  const declarations = sources.map((source) => ({
    file: source.file,
    functions: declaredFunctions(source)
  }));
  let grew = true;

  while (grew) {
    grew = false;

    for (const { file, functions } of declarations) {
      const here = local.get(file) ?? new Set<string>();
      local.set(file, here);

      for (const fn of functions) {
        if (here.has(fn.name)) continue;

        const visible = new Set([...shared, ...here]);

        if (bodyReaches(fn.body, probe, visible)) {
          here.add(fn.name);
          grew = true;
          if (fn.exported) shared.add(fn.name);
        }
      }
    }
  }

  return { shared, local };
}

function reaches(
  source: Source,
  body: { code: string; masked: string },
  probe: Probe,
  reach: Reach
): boolean {
  return bodyReaches(
    body,
    probe,
    new Set([...reach.shared, ...(reach.local.get(source.file) ?? [])])
  );
}

const REQUEST_PROBE: Probe = { names: REQUEST_SEEDS, mutatingFetch: true };
const LOCK_PROBE: Probe = { names: LOCK_SEEDS };
const KEY_PROBE: Probe = {
  names: ["createIdempotencyKeySource"],
  literals: KEY_LITERALS
};

export type Scan = {
  entries: EntryPoint[];
  /** Files under the scan roots, for "nothing skipped" accounting. */
  filesScanned: string[];
};

/** Every entry point under the scan roots (or `roots`, for the unit tests). */
export function scanEntryPoints(
  options: { root?: string; roots?: readonly string[] } = {}
): Scan {
  const root = options.root ?? REPO_ROOT;
  const roots = options.roots ?? SCAN_ROOTS;

  const files = roots
    .flatMap((dir) =>
      listFilesRecursive(path.join(root, dir), {
        extensions: [".astro", ".ts"],
        excludeSuffixes: [".d.ts"],
        tolerateMissing: true,
        relativeTo: root
      })
    )
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => !SKIP_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .sort();

  const sources = files.map((file) => loadSource(root, file));
  const reach = {
    request: computeReach(sources, REQUEST_PROBE),
    lock: computeReach(sources, LOCK_PROBE),
    key: computeReach(sources, KEY_PROBE)
  };

  const entries: EntryPoint[] = [];

  for (const source of sources) {
    if (source.file === HELPER_MODULE) continue;

    const helperCall = new RegExp(
      `(?<![\\w$.])(${HELPER_NAMES.join("|")})\\s*\\(`,
      "g"
    );
    let match: RegExpExecArray | null;

    while ((match = helperCall.exec(source.masked)) !== null) {
      // A declaration (`function onSubmit(`) is not a binding.
      const before = source.masked.slice(
        Math.max(0, match.index - 12),
        match.index
      );
      if (/function\s*$/.test(before)) continue;

      const open = match.index + match[0].length - 1;
      const end = matchParen(source.masked, open);
      if (end === -1) continue;

      entries.push(
        classify(source, match.index, open, end, match[1] as EntryKind, reach)
      );
    }

    const listener =
      /\.addEventListener\s*\(\s*(["'])(submit|click|change|keydown|keyup|input|dblclick)\1/g;

    // Run on `code`, not `masked`: the event name IS a string literal.
    while ((match = listener.exec(source.code)) !== null) {
      const open = source.masked.indexOf("(", match.index);
      const end = matchParen(source.masked, open);
      if (end === -1) continue;

      const event = source.code
        .slice(open + 1, end)
        .match(/^\s*["'](\w+)["']/)?.[1];
      const kind: EntryKind =
        event === "submit" ? "direct-submit" : "direct-event";
      const entry = classify(source, match.index, open, end, kind, reach);

      // A click listener that reaches no request is UI plumbing (a toggle, a
      // dialog), not a mutation entry point.
      if (kind === "direct-event" && !entry.reachesRequest) continue;

      entries.push(entry);
    }
  }

  return { entries, filesScanned: files };
}

function classify(
  source: Source,
  start: number,
  open: number,
  end: number,
  kind: EntryKind,
  reach: { request: Reach; lock: Reach; key: Reach }
): EntryPoint {
  const body = {
    code: source.code.slice(open, end),
    masked: source.masked.slice(open, end)
  };
  const isHelper = (HELPER_NAMES as readonly string[]).includes(kind);

  return {
    file: source.file,
    line: lineOf(source.code, start),
    endLine: lineOf(source.code, end),
    kind,
    target: isHelper
      ? firstStringArgument(source.code, open)
      : (source.code.slice(open + 1, end).match(/^\s*["'](\w+)["']/)?.[1] ??
        ""),
    reachesRequest: reaches(source, body, REQUEST_PROBE, reach.request),
    guard: reaches(
      source,
      // `mutateAndReload(null, …)` has no control to lock: it is a lock in
      // name only (the reason-panel hidden forms), so it must not count.
      {
        code: body.code.replace(/mutateAndReload\s*\(\s*null/g, "x(null"),
        masked: body.masked.replace(/mutateAndReload\s*\(\s*null/g, "x(null")
      },
      LOCK_PROBE,
      reach.lock
    )
      ? "lock"
      : "none-seen",
    idempotencyKey: reaches(source, body, KEY_PROBE, reach.key)
  };
}
