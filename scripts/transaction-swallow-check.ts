/**
 * transaction-swallow-check.ts — `bun run db:transaction-swallow:check`
 * (Issue #1099).
 *
 * Refuses a `catch` that SWALLOWS a failed statement of an open transaction
 * without a savepoint around that statement.
 *
 * ## Why a gate
 *
 * PostgreSQL aborts the whole transaction when one statement fails. Up to
 * Bun 1.4.2, `sql.begin(cb)` quietly returned `cb`'s value when `cb` had caught
 * such an error and carried on: the `COMMIT` degraded to a `ROLLBACK` and
 * nobody noticed. About 45 sites relied on that — "catch the 23505, map it to a
 * 409 / `duplicate_key`, return". Bun 1.4.3 throws
 * `ERR_POSTGRES_COMMIT_ROLLED_BACK` instead, so every one of those became a 500.
 *
 * The fix is to say what the code always meant. The statement that is EXPECTED
 * to fail runs in `tx.savepoint(async (sp) => …)`: the failure rolls back to the
 * savepoint, the transaction stays valid, and the catch is then a plain
 * business decision. Where the intent really was "abort everything", the catch
 * rethrows and the error is mapped outside the transaction.
 *
 * There is deliberately NO central swallowing of ERR_POSTGRES_COMMIT_ROLLED_BACK
 * in the tenant wrapper: it would hide this whole class of bug, including every
 * future accidental swallow, and it would commit-or-not on a guess.
 *
 * ## What it flags (static, text-level, no database)
 *
 * A `try { … } catch { … }` (or `expr.catch(…)`) where
 *
 *   1. the try block issues SQL through a transaction handle — an identifier
 *      named `tx`/`sp`/`trx`/`transaction`/`savepoint`, or any name declared
 *      `Bun.TransactionSQL` in the same file — OUTSIDE a `.savepoint(…)` call
 *      and outside a nested `begin`/`withTenant*`/`runTenantWork` wrapper
 *      (a catch around a whole nested transaction is not inside this one), AND
 *   2. the catch can complete normally: it contains a `return`/`continue`/
 *      `break`, or it does not end in a `throw`.
 *
 * A catch that always ends in `throw` is a mapping, not a swallow, and passes.
 *
 * ## Reviewed exceptions
 *
 * {@link ALLOWLIST} holds `path#enclosing-function` keys with a written reason.
 * An entry that no longer matches anything is itself an error, so the list
 * cannot rot. Adding one needs a reviewer to agree the write set in the
 * transaction before the failed statement really is meant to commit.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const SCANNED_DIRECTORIES = ["src", "scripts"];
const SCANNED_EXTENSIONS = [".ts", ".astro"];

/** Names a transaction handle conventionally carries in this repo. */
const BASE_TX_NAMES = ["tx", "sp", "trx", "transaction", "savepoint"];

const METHOD_CALLS = ["savepoint", "begin", "reserve"];

/** Calls that open a NEW transaction (a catch around one is outside it). */
const TX_WRAPPERS = [
  "begin",
  "withTenant",
  "withTenantOrThrow",
  "runTenantWork",
  "reserve"
];

/**
 * `path#enclosing function` -> why the swallow is safe. Empty on purpose:
 * every site found for Issue #1099 was converted to a savepoint or rethrown.
 */
export const ALLOWLIST: Readonly<Record<string, string>> = {};

export type SwallowFinding = {
  file: string;
  line: number;
  scope: string;
  kind: "try_catch" | "promise_catch" | "promise_allsettled";
  text: string;
};

/**
 * Blanks comments, string contents, regex literals and template TEXT (keeping
 * `${…}` expressions and the tag before a template), preserving length and
 * newlines so offsets and line numbers still line up with the source.
 */
export function sanitize(source: string, keepText = false): string {
  const out = source.split("");
  const n = source.length;
  const templateStack: number[] = []; // brace depth at which a `${` opened
  let braceDepth = 0;
  let i = 0;
  let lastSignificant = "";

  const blank = (from: number, to: number, isText = false) => {
    if (isText && keepText) return;
    for (let k = from; k < to; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };

  const readTemplate = (start: number): number => {
    // `start` is just after the opening backtick or the closing `}` of `${`.
    let k = start;
    while (k < n) {
      const c = source[k]!;
      if (c === "\\") {
        k += 2;
        continue;
      }
      if (c === "`") {
        blank(start, k, true);
        return k + 1;
      }
      if (c === "$" && source[k + 1] === "{") {
        blank(start, k, true);
        templateStack.push(braceDepth);
        braceDepth++;
        return k + 2;
      }
      k++;
    }
    blank(start, n, true);
    return n;
  };

  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && source[k] !== c && source[k] !== "\n") {
        k += source[k] === "\\" ? 2 : 1;
      }
      blank(i + 1, k, true);
      i = k + 1;
      lastSignificant = c;
      continue;
    }

    if (c === "`") {
      i = readTemplate(i + 1);
      lastSignificant = "`";
      continue;
    }

    if (c === "{") {
      braceDepth++;
    } else if (c === "}") {
      braceDepth--;
      if (
        templateStack.length > 0 &&
        templateStack[templateStack.length - 1] === braceDepth
      ) {
        templateStack.pop();
        i = readTemplate(i + 1);
        lastSignificant = "`";
        continue;
      }
    }

    if (c === "/") {
      const regexContext =
        lastSignificant === "" ||
        "(,=:[!&|?{};+-*%<>~^".includes(lastSignificant);
      const keywordBefore = /(?:return|typeof|case|in|of)\s*$/.test(
        source.slice(Math.max(0, i - 8), i)
      );

      if (regexContext || keywordBefore) {
        let k = i + 1;
        let inClass = false;
        while (k < n && source[k] !== "\n") {
          const d = source[k]!;
          if (d === "\\") {
            k += 2;
            continue;
          }
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) break;
          k++;
        }
        if (source[k] === "/") {
          blank(i + 1, k, true);
          i = k + 1;
          lastSignificant = "/";
          continue;
        }
      }
    }

    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }

  return out.join("");
}

/** Index of the bracket matching the opener at `open`, or -1. */
function matchBracket(code: string, open: number): number {
  const opener = code[open]!;
  const closer = opener === "{" ? "}" : opener === "(" ? ")" : "]";
  let depth = 0;

  for (let k = open; k < code.length; k++) {
    const c = code[k]!;
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) return k;
    }
  }

  return -1;
}

/** Replaces `[from, to]` with spaces (keeping newlines). */
function blankRange(code: string, from: number, to: number): string {
  return (
    code.slice(0, from) +
    code.slice(from, to + 1).replace(/[^\n]/g, " ") +
    code.slice(to + 1)
  );
}

/**
 * Blanks every call to one of `names` (including its argument list), so
 * whatever runs inside a savepoint or a NESTED transaction is not mistaken for
 * a statement of the transaction the catch belongs to.
 */
function stripCalls(code: string, names: readonly string[]): string {
  // `savepoint`/`begin`/`reserve` are METHODS: only `handle.savepoint(` opens
  // one. A free function that merely shares the name must not hide a statement.
  // The wrappers (`withTenant`, …) are free functions.
  const methods = names.filter((n) => METHOD_CALLS.includes(n));
  const free = names.filter((n) => !METHOD_CALLS.includes(n));
  const alternatives = [
    methods.length > 0 ? `[\\w$]+\\s*\\.\\s*(?:${methods.join("|")})` : null,
    free.length > 0 ? `\\b(?:${free.join("|")})` : null
  ].filter((a): a is string => a !== null);
  const pattern = new RegExp(
    `(?:${alternatives.join("|")})\\s*(?:<[^()]*>)?\\s*\\(`,
    "g"
  );
  let result = code;
  let match: RegExpExecArray | null;

  pattern.lastIndex = 0;
  while ((match = pattern.exec(result)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(result, open);

    if (close === -1) break;

    result = blankRange(result, match.index, close);
    pattern.lastIndex = match.index;
  }

  return result;
}

/**
 * Blanks every function that DECLARES a transaction handle as a parameter
 * (`async (tx) => …`, `({ tx }) => …`, `function (tx) { … }`). A `try` that
 * wraps such a function wraps a WHOLE nested transaction, so the catch sits
 * outside it: whatever the handle does inside belongs to that transaction, not
 * to the one the catch could be inside.
 */
function stripOwnTxScopes(code: string, names: readonly string[]): string {
  const word = `\\b(?:${names.join("|")})\\b`;
  const pattern = new RegExp(
    `(?:\\basync\\s*)?\\(([^()]*${word}[^()]*)\\)\\s*(?::\\s*[^=;{}]*?)?=>|(?:\\basync\\s*)?${word}\\s*=>|\\bfunction\\b\\s*[\\w$]*\\s*\\([^()]*${word}[^()]*\\)\\s*(?::\\s*[^{};]*?)?(?=\\{)`,
    "g"
  );
  let result = code;
  let match: RegExpExecArray | null;

  pattern.lastIndex = 0;
  while ((match = pattern.exec(result)) !== null) {
    let k = match.index + match[0].length;

    while (k < result.length && /\s/.test(result[k]!)) k++;

    let end: number;

    if (result[k] === "{") {
      end = matchBracket(result, k);
    } else {
      // Expression body: up to the first unmatched `)`/`,`/`;`.
      let depth = 0;
      end = k;
      while (end < result.length) {
        const c = result[end]!;
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") {
          if (depth === 0) break;
          depth--;
        } else if ((c === "," || c === ";") && depth === 0) break;
        end++;
      }
      end = end - 1;
    }

    if (end === -1) break;

    result = blankRange(result, match.index, end);
    pattern.lastIndex = match.index;
  }

  return result;
}

function txNamesIn(code: string): string[] {
  const names = new Set(BASE_TX_NAMES);
  const declared =
    /\b([A-Za-z_$][\w$]*)\s*:\s*(?:Bun\.TransactionSQL|TransactionSQL|Bun\.SQL|SQL)\b/g;
  let match: RegExpExecArray | null;

  while ((match = declared.exec(code)) !== null) {
    names.add(match[1]!);
  }

  // The parameter a transaction wrapper hands its callback, whatever it is
  // called: `sql.begin(async (t) => …)`, `withTenant(sql, id, async (db) => …)`.
  const wrapper = new RegExp(
    `\\b(?:${TX_WRAPPERS.join("|")}|transaction)\\s*(?:<[^()]*>)?\\s*\\(`,
    "g"
  );

  while ((match = wrapper.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);

    if (close === -1) continue;

    const callback =
      /(?:\basync\s*)?\(\s*([A-Za-z_$][\w$]*)\s*[,):]|(?:\basync\s+)?\b([A-Za-z_$][\w$]*)\s*=>/.exec(
        code.slice(open + 1, close)
      );
    const name = callback?.[1] ?? callback?.[2];

    if (name && name !== "async") names.add(name);
  }

  return [...names];
}

function usesTx(code: string, names: readonly string[]): boolean {
  return new RegExp(`(?<![\\w$.])(?:${names.join("|")})(?![\\w$])`).test(code);
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let k = 0; k < offset; k++) if (source[k] === "\n") line++;
  return line;
}

/** Best-effort name of the function (or method) containing `offset`. */
function enclosingScope(code: string, offset: number): string {
  const head = code.slice(0, offset);
  const patterns = [
    /(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/g,
    /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/g,
    /(?:export\s+const\s+)(GET|POST|PUT|PATCH|DELETE)\b/g
  ];
  let best = { index: -1, name: "(module)" };

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(head)) !== null) {
      if (match.index > best.index) {
        best = { index: match.index, name: match[1]! };
      }
    }
  }

  return best.name;
}

/** True when a catch body can finish without throwing. */
function catchCanComplete(body: string): boolean {
  const trimmed = body.trim();

  if (trimmed === "") return true;
  if (/\b(?:return|continue|break)\b/.test(trimmed)) return true;

  // The LAST top-level statement must be a throw.
  let depth = 0;
  let lastStart = 0;

  for (let k = 0; k < trimmed.length; k++) {
    const c = trimmed[k]!;
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0 && c === "}") lastStart = k + 1;
    } else if (c === ";" && depth === 0 && k < trimmed.length - 1) {
      lastStart = k + 1;
    }
  }

  return !/^\s*throw\b/.test(trimmed.slice(lastStart));
}

/** A catch that inspects a DATABASE error and maps it to something else. */
const INSPECTS_DATABASE_ERROR =
  /\berrno\b|\bPostgresError\b|\bsqlstate\b|\bSQLSTATE\b|\bmessage\b[^;{}]*\.includes\s*\(|["'`]2[0-9]{4}["'`]|["'`]55000["'`]|\bisUniqueViolation\b|\bisForeignKeyViolation\b|_dedup|_key\b/i;

/** A reason must name WHY the catch is safe: a category, or the error class. */
const MARKER_CATEGORY =
  /pooled|autocommit|healthy|savepoint|read-only|pre-?check|before any (?:write|statement|sql)|no database error/i;
const MARKER_ERROR_CLASS = /\b[A-Z][A-Za-z0-9]*Error\b/;

/** First index at or after `from` whose sanitized char is not whitespace. */
function firstCodeIndex(code: string, from: number, to: number): number {
  for (let k = from; k < to; k++) {
    if (!/\s/.test(code[k]!)) return k;
  }
  return to;
}

/**
 * The reviewed marker of ONE catch: a real comment (the sanitized source is
 * blank there, the raw source is not) that precedes the FIRST statement of that
 * catch block, carrying a substantive reason. Anywhere else — in a string, in a
 * nested construct, after the first statement — it is not a marker.
 */
function reviewedMarker(
  source: string,
  code: string,
  bodyStart: number,
  bodyEnd: number
): boolean {
  const lead = firstCodeIndex(code, bodyStart, bodyEnd);
  const comments = source.slice(bodyStart, lead);
  const at = comments.indexOf("tx-swallow-ok:");

  if (at === -1) return false;

  const reason = comments
    .slice(at + "tx-swallow-ok:".length)
    .replace(/\/\/|\/\*|\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    reason.length >= 20 &&
    (MARKER_CATEGORY.test(reason) || MARKER_ERROR_CLASS.test(reason))
  );
}

/** Splits `a, b, c` at depth 0. */
function topLevelArguments(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let k = 0; k < args.length; k++) {
    const c = args[k]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(args.slice(start, k));
      start = k + 1;
    }
  }

  parts.push(args.slice(start));

  return parts;
}

/** Pure: the swallows in one file's source, allowlist NOT applied. */
export function rawTransactionSwallows(
  file: string,
  source: string,
  options: { includeRethrowing?: boolean } = {}
): SwallowFinding[] {
  const code = sanitize(source);
  // Same, but string/template text kept: the ONLY place an explicit
  // `unsafe("ROLLBACK TO SAVEPOINT …")` can be told from prose.
  const codeText = sanitize(source, true);
  const names = txNamesIn(code);
  const findings: SwallowFinding[] = [];

  const exposed = (guarded: string): boolean =>
    usesTx(
      stripOwnTxScopes(
        stripCalls(guarded, ["savepoint", ...TX_WRAPPERS]),
        names
      ),
      names
    );

  const report = (kind: SwallowFinding["kind"], offset: number): void => {
    findings.push({
      file,
      line: lineOf(source, offset),
      scope: enclosingScope(code, offset),
      kind,
      text: source
        .slice(offset, offset + 80)
        .split("\n")[0]!
        .trim()
    });
  };

  const tryPattern = /\btry\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = tryPattern.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);

    if (close === -1) continue;

    const afterTry = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(
      code.slice(close + 1)
    );

    if (!afterTry) continue; // try/finally without catch swallows nothing

    const catchOpen = close + 1 + afterTry[0].length - 1;
    const catchClose = matchBracket(code, catchOpen);

    if (catchClose === -1) continue;

    const body = code.slice(catchOpen + 1, catchClose);
    const header = code.slice(close + 1, catchOpen);
    const completes = catchCanComplete(body);
    // A catch that always rethrows is a swallow only when it MAPS a database
    // error to another error: the caller then catches that mapped error on a
    // transaction the unguarded statement already aborted (the createOffice
    // shape). A bare log-and-rethrow passes.
    const mapsDatabaseError =
      !completes &&
      /\bthrow\s+new\b/.test(body) &&
      INSPECTS_DATABASE_ERROR.test(header + body);

    if (!completes && !mapsDatabaseError && !options.includeRethrowing) {
      continue;
    }

    if (
      /\.unsafe\s*\(\s*[`'"]\s*ROLLBACK\s+TO\s+SAVEPOINT/i.test(
        codeText.slice(catchOpen + 1, catchClose)
      ) ||
      reviewedMarker(source, code, catchOpen + 1, catchClose)
    ) {
      continue;
    }

    if (exposed(code.slice(open + 1, close))) {
      report("try_catch", close + 1);
    }
  }

  // `statement.catch(handler)` and `statement.then(ok, handler)` — promise-level
  // swallows of a tx statement. A reviewed marker does not apply: restructure.
  const promisePattern = /\.(catch|then)\s*\(/g;

  while ((match = promisePattern.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);

    if (close === -1) continue;

    const args = topLevelArguments(code.slice(open + 1, close));
    const handler = match[1] === "catch" ? args[0] : args[1];

    if (handler === undefined || handler.trim() === "") continue;

    // Walk back over the receiver expression to the statement boundary.
    let depth = 0;
    let start = match.index;

    while (start > 0) {
      const c = code[start - 1]!;
      if (c === ")" || c === "]" || c === "}") depth++;
      else if (c === "(" || c === "[" || c === "{") {
        if (depth === 0) break;
        depth--;
      } else if (c === ";" && depth === 0) break;
      start--;
    }

    // An arrow handler of the form `(e) => { …throw… }` does not swallow.
    const rethrows = /\bthrow\b/.test(handler) && !/\breturn\b/.test(handler);

    if (!rethrows && exposed(code.slice(start, match.index))) {
      report("promise_catch", match.index);
    }
  }

  // `Promise.allSettled([... tx statements ...])` swallows every rejection.
  const settled = /\bPromise\s*\.\s*allSettled\s*\(/g;

  while ((match = settled.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);

    if (close !== -1 && exposed(code.slice(open + 1, close))) {
      report("promise_allsettled", match.index);
    }
  }

  return findings;
}

/** Pure: the swallows in one file's source that are not reviewed exceptions. */
export function findTransactionSwallows(
  file: string,
  source: string,
  allowlist: Readonly<Record<string, string>> = ALLOWLIST
): SwallowFinding[] {
  return rawTransactionSwallows(file, source).filter(
    (finding) => !(`${finding.file}#${finding.scope}` in allowlist)
  );
}

function walk(directory: string, out: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SCANNED_EXTENSIONS.some((ext) => full.endsWith(ext))) {
      out.push(full);
    }
  }

  return out;
}

/** Allowlist entries that point at nothing — they must not outlive the code. */
export function staleAllowlistEntries(
  files: readonly { path: string; source: string }[],
  allowlist: Readonly<Record<string, string>> = ALLOWLIST
): string[] {
  const live = new Set<string>();

  for (const file of files) {
    // Raw (unfiltered) so allowlisted hits count as "live".
    for (const finding of rawTransactionSwallows(file.path, file.source)) {
      live.add(`${finding.file}#${finding.scope}`);
    }
  }

  return Object.keys(allowlist).filter((key) => !live.has(key));
}

function main(): void {
  const files: { path: string; source: string }[] = [];

  for (const directory of SCANNED_DIRECTORIES) {
    for (const full of walk(path.join(ROOT, directory), [])) {
      files.push({
        path: path.relative(ROOT, full).split(path.sep).join("/"),
        source: readFileSync(full, "utf8")
      });
    }
  }

  const findings = files.flatMap((file) =>
    findTransactionSwallows(file.path, file.source)
  );

  if (findings.length > 0) {
    console.error(
      `transaction-swallow-check: ${findings.length} catch block(s) swallow a failed statement of an open transaction without a savepoint.\n` +
        "A failed statement aborts the whole transaction (PostgreSQL), and on Bun >= 1.4.3 the commit then throws ERR_POSTGRES_COMMIT_ROLLED_BACK.\n" +
        "Wrap ONLY the statement expected to fail in `tx.savepoint(async (sp) => …)`, or rethrow and map the error outside the transaction.\n"
    );
    for (const finding of findings) {
      console.error(
        `  ${finding.file}:${finding.line} [${finding.scope}] ${finding.kind}: ${finding.text}`
      );
    }
    process.exit(1);
  }

  const stale = staleAllowlistEntries(files);

  if (stale.length > 0) {
    console.error(
      `transaction-swallow-check: stale ALLOWLIST entr${stale.length === 1 ? "y" : "ies"} (no longer matches code): ${stale.join(", ")}`
    );
    process.exit(1);
  }

  console.log(
    `transaction-swallow-check: ${files.length} files scanned, no unguarded catch-and-continue inside a transaction.`
  );
}

if (import.meta.main) {
  main();
}
