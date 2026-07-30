/**
 * Parser for the vendored upstream dump
 * `data/idn-admin-regions/upstream/cahyadsn-wilayah/db/wilayah.sql` (ADR-0046).
 *
 * The file is a MySQL-style dump: a licence header in a block comment, DDL, then
 * ~91,600 value rows of the form
 *
 * ```sql
 * ('11.01.01.2001','Keude Bakongan'),
 * ```
 *
 * ## It is parsed as TEXT — no SQL engine, ever
 *
 * Nothing here executes SQL, and nothing here needs MySQL installed. The dump is
 * untrusted input in the only sense that matters: it is data, and it is turned
 * into rows by string parsing, then written through bound parameters. Feeding
 * upstream statements to a database would hand an external project the ability
 * to run DDL/DML in ours.
 *
 * ## A line this parser does not understand is an ERROR, not a skip
 *
 * The tempting shape — "match the value pattern, ignore everything else" — fails
 * silently in the one way that matters here: if upstream changes its quoting or
 * adds a column, a permissive parser imports a partial hierarchy and reports
 * success. Regions would simply be missing, and nothing would say so. So every
 * line is classified into exactly one of three buckets, and anything that lands
 * in `unparsed` fails the import with the line numbers attached.
 */

/** One raw `(code, name)` pair, before hierarchy normalisation. */
export type WilayahDumpRow = {
  /** Dotted upstream code, e.g. `11.01.01.2001`. */
  code: string;
  /** Name exactly as upstream spells it, whitespace-trimmed only. */
  name: string;
  /** 1-based line number in the dump — carried so errors point at a real place. */
  lineNumber: number;
};

export type WilayahDumpParseResult = {
  rows: WilayahDumpRow[];
  /** Lines that are legitimately not data (header, DDL, blank, comment). */
  ignoredLineCount: number;
  /**
   * Lines that look like data but did not match the value grammar. Non-empty
   * means the import MUST fail: the alternative is a silently partial dataset.
   */
  unparsed: { lineNumber: number; content: string }[];
  /** Codes appearing more than once in the file (upstream duplicate). */
  duplicateCodes: string[];
};

/**
 * A value tuple: `('<code>','<name>')` followed by `,` or the statement's final
 * `;`. `code` is restricted to digits and dots — the only shape upstream uses —
 * so a malformed code lands in `unparsed` instead of being imported as a region
 * with a garbage identifier. The name is captured lazily up to the closing
 * `'),`/`');` so an embedded escaped quote does not truncate it.
 */
const VALUE_LINE = /^\('([0-9.]+)','(.*?)'\)\s*[,;]$/;

/**
 * Lines that are legitimately not data rows: line comments, blanks, and the DDL
 * statements upstream ships around the values.
 *
 * The dump's licence header is NOT covered here — it is free prose inside a
 * `/* … *\/` block, and matching prose by pattern would mean accepting anything.
 * Block comments are tracked as parser STATE below instead, so a data line that
 * happens to read like prose still fails loudly.
 */
const IGNORABLE_LINE =
  /^(--|$|DROP\b|CREATE\b|ALTER\b|INSERT\b|VALUES\b|SET\b|COMMIT\b|START\b|LOCK\b|UNLOCK\b)/i;

/**
 * Statements whose body may span lines and must be skipped whole (`CREATE TABLE
 * … (` … `) ENGINE=MyISAM;`).
 *
 * `INSERT`/`VALUES` are deliberately NOT here: their continuation lines are the
 * data. Treating them as multi-line statements swallows all 91,599 value rows
 * and reports a clean, empty, successful parse — which is exactly what happened
 * the first time this branch was written, and why the parser's own test asserts
 * a row COUNT rather than merely "no errors".
 */
const MULTILINE_STATEMENT_START =
  /^(DROP|CREATE|ALTER|SET|LOCK|UNLOCK|START)\b/i;

/**
 * MySQL escaping used inside single-quoted string literals. Upstream's current
 * file happens to contain none of these, which is exactly why they are handled:
 * a name like `Ma\'rang` appearing in a future dump must import as `Ma'rang`,
 * not as a parse failure or a mangled string.
 */
function unescapeSqlString(value: string): string {
  return value
    .replace(/''/g, "'")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/**
 * Parses the dump text into raw rows. Pure: no filesystem, no database, no
 * network — the caller reads the file and decides what to do with the result.
 */
export function parseWilayahDump(text: string): WilayahDumpParseResult {
  const rows: WilayahDumpRow[] = [];
  const unparsed: { lineNumber: number; content: string }[] = [];
  const seen = new Map<string, number>();
  const duplicateCodes: string[] = [];
  let ignoredLineCount = 0;

  // `\r` is stripped per line rather than globally: the dump is CRLF upstream
  // (see `.gitattributes` — the bytes are preserved deliberately), so every line
  // would otherwise end in a stray carriage return and match nothing.
  const lines = text.split("\n");
  let insideBlockComment = false;
  let insideDdlStatement = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").replace(/\r$/, "").trim();
    const lineNumber = index + 1;

    // Block-comment state: the ~24-line licence header at the top of the dump
    // is free prose, so it is skipped by KNOWING it is inside `/* … */`, not by
    // pattern-matching prose (which would make the parser accept anything).
    if (insideBlockComment) {
      ignoredLineCount += 1;
      if (line.includes("*/")) insideBlockComment = false;
      continue;
    }

    if (line.startsWith("/*") && !line.includes("*/")) {
      insideBlockComment = true;
      ignoredLineCount += 1;
      continue;
    }

    if (line.startsWith("/*")) {
      ignoredLineCount += 1;
      continue;
    }

    // Multi-line DDL (`CREATE TABLE … (` … `) ENGINE=MyISAM;`): its column lines
    // are neither comments nor values. Tracked as state, ending at the `;`, so
    // the parser stays strict about everything outside a statement it is
    // deliberately skipping. `INSERT` is excluded from this branch precisely
    // because its continuation lines ARE the data.
    if (insideDdlStatement) {
      ignoredLineCount += 1;
      if (line.endsWith(";")) insideDdlStatement = false;
      continue;
    }

    if (line.startsWith("(")) {
      const match = VALUE_LINE.exec(line);

      if (!match) {
        unparsed.push({ lineNumber, content: line });
        continue;
      }

      const code = match[1] ?? "";
      const name = unescapeSqlString(match[2] ?? "").trim();

      if (name.length === 0) {
        unparsed.push({ lineNumber, content: line });
        continue;
      }

      const firstSeen = seen.get(code);

      if (firstSeen !== undefined) {
        duplicateCodes.push(code);
        continue;
      }

      seen.set(code, lineNumber);
      rows.push({ code, name, lineNumber });
      continue;
    }

    if (IGNORABLE_LINE.test(line)) {
      ignoredLineCount += 1;
      if (MULTILINE_STATEMENT_START.test(line) && !line.endsWith(";")) {
        insideDdlStatement = true;
      }
      continue;
    }

    unparsed.push({ lineNumber, content: line });
  }

  return { rows, ignoredLineCount, unparsed, duplicateCodes };
}
