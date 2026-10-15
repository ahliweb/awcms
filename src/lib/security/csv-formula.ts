/**
 * CSV cell writing with spreadsheet-formula neutralisation (Issue #978,
 * finding PS-18 (c); OWASP "CSV Injection").
 *
 * A cell whose text begins with `=`, `+`, `-`, `@`, TAB or CR is interpreted as
 * a formula by Excel, LibreOffice and Google Sheets when the file is opened, so
 * a value an attacker (or a careless tenant) managed to put in a name, a label
 * or a free-text column becomes code that runs on the reader's machine
 * (`=HYPERLINK(...)`, `=cmd|' /c ...'!A0`). The standard mitigation is to prefix
 * such a cell with a single quote, which every one of those programs renders as
 * a literal and does not display.
 *
 * ## One helper, because there were two private copies
 *
 * `reporting`'s export adapter had its own `csvEscape` with this rule and
 * `data_lifecycle`'s archive adapter had another WITHOUT it. A rule that lives in
 * each writer is a rule the next writer forgets; `tests/csv-formula-neutralisation
 * .test.ts` scans `src/` and fails when a CSV writer does not use this file.
 *
 * ## Two modes
 *
 * - **Default (an export a person opens).** Lossy by design: `=1+1` is written
 *   `'=1+1`. Nothing reads it back.
 * - **`reversible` (an archive that is parsed back).** `data_lifecycle` archives
 *   are restored from the very file that was written, so the prefix has to be
 *   undone exactly. The pair {@link csvCellForWrite} / {@link restoreCsvCell} is a
 *   bijection on strings: a value that ALREADY starts with `'` followed by a
 *   leader (`'=x`) is prefixed too (`''=x`), and restore removes exactly one
 *   leading quote when what remains still starts with `'*` plus a leader. A value
 *   such as `'abc` is not touched in either direction.
 *
 * ## Numbers are not strings
 *
 * A JavaScript `number` or `bigint` serialises to digits, `.`, `e` and a sign;
 * `-5` is a number to every spreadsheet, not a formula, and prefixing it would
 * turn a numeric column into text. They are written as-is. A numeric STRING
 * (`"-5"`) arrives from outside the type system and is neutralised like any
 * other string.
 */

/**
 * What a spreadsheet may read as a formula: an ASCII trigger (OWASP: `=`, `+`,
 * `-`, `@`, TAB, CR) or its full-width look-alike, optionally behind leading
 * whitespace or zero-width characters that some importers strip before they
 * decide. Issue #978 audit L3.
 */
const TRIGGER_CORE =
  "[\\s\\u200B-\\u200D\\u2060\\uFEFF]*[=+\\-@\\t\\r\\uFF1D\\uFF0B\\uFF0D\\uFF20]";

const FORMULA_LEADER = new RegExp(`^${TRIGGER_CORE}`, "u");

/** The same set, preceded by any number of the neutralising quote. */
const QUOTED_FORMULA_LEADER = new RegExp(`^'*${TRIGGER_CORE}`, "u");

/** What a restore may undo: at least one quote, then a trigger. */
const NEUTRALISED_PREFIX = new RegExp(`^'+${TRIGGER_CORE}`, "u");

/**
 * First line of a data-lifecycle CSV archive written with reversible
 * neutralisation (Issue #978 audit L2). `restoreCsvCell` is applied ONLY to a
 * file that starts with it, so an archive written before this change restores
 * byte for byte instead of losing a leading quote that was part of the data.
 */
export const CSV_NEUTRALISED_MARKER = "#awcms-csv-neutralised:v1";

/** True when `text` would be read as a formula if written to a cell unchanged. */
export function startsWithCsvFormulaLeader(text: string): boolean {
  return FORMULA_LEADER.test(text);
}

/**
 * Prefix a formula-leading string with one single quote.
 *
 * Lossy mode: `'=x` (already quoted) is left alone because it does not start
 * with a leader, which is correct for an export and wrong for an archive — see
 * {@link csvCellForWrite} `reversible`.
 */
export function neutralizeCsvFormula(text: string): string {
  return FORMULA_LEADER.test(text) ? `'${text}` : text;
}

/** Quote a cell per RFC 4180 when it carries a delimiter, quote or line break. */
export function quoteCsvCell(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export type CsvCellOptions = {
  /**
   * The file is parsed back by {@link restoreCsvCell}. Also prefixes a string
   * that already begins with `'` plus a leader, so the round trip is exact.
   */
  reversible?: boolean;
};

/** Text for any cell value, before neutralisation. */
function stringifyCsvValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

/**
 * One cell, ready to be joined with commas: stringified, formula-neutralised,
 * then quoted. The order matters — neutralise first, so a leading TAB or CR that
 * forces quoting is quoted WITH its prefix in front of it.
 */
export function csvCellForWrite(
  value: unknown,
  options: CsvCellOptions = {}
): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "number" || typeof value === "bigint") {
    return quoteCsvCell(String(value));
  }

  const text = stringifyCsvValue(value);
  const leader = options.reversible ? QUOTED_FORMULA_LEADER : FORMULA_LEADER;

  return quoteCsvCell(leader.test(text) ? `'${text}` : text);
}

/** Inverse of {@link csvCellForWrite} in `reversible` mode, applied to a parsed field. */
export function restoreCsvCell(text: string): string {
  return NEUTRALISED_PREFIX.test(text) ? text.slice(1) : text;
}
