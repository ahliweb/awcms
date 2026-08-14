/**
 * A minimal gettext PO parser (ADR-0095).
 *
 * WHY HAND-WRITTEN RATHER THAN A DEPENDENCY
 *
 * This repo's dependency posture is narrow and gated (`bun run deps:audit:check`),
 * and the PO subset actually needed here is small enough to read in one sitting:
 * comments, flags, `msgctxt`, `msgid`, `msgid_plural`, `msgstr`, `msgstr[N]`, and
 * the multi-line string continuation form. Anything beyond that subset is
 * REJECTED rather than guessed at — a catalog this parser cannot fully account
 * for is a catalog whose translations would silently go missing.
 *
 * WHERE THIS RUNS
 *
 * Build time only, from `scripts/i18n-compile.ts` and `scripts/i18n-catalog-check.ts`.
 * The application never parses PO at request time; it imports the compiled
 * catalogs (ADR-0095 §"Keputusan 3" — the production image ships only `dist/`,
 * so a runtime read of `locales/` would be the 29-silent-jobs defect again).
 */

/** The `\u0004` (EOT) byte gettext itself uses to join context to msgid. */
export const CONTEXT_SEPARATOR = "\u0004";

export interface PoEntry {
  /** `msgctxt`, or null when the entry is uncontextualised. */
  readonly context: string | null;
  readonly msgid: string;
  /** Present only on plural entries. */
  readonly msgidPlural: string | null;
  /**
   * Translations, indexed by plural form. A singular entry has exactly one.
   * An empty string means "untranslated" — gettext's own convention, and the
   * reason `en.po` may legitimately be all-empty (msgid IS the English text).
   */
  readonly msgstr: readonly string[];
  /** True when flagged `#, fuzzy`. Treated as UNTRANSLATED, as gettext does. */
  readonly fuzzy: boolean;
  /** 1-based line of the entry's first `msgid`, for error messages. */
  readonly line: number;
}

export interface PoFile {
  /** Header key/value pairs from the `msgid ""` entry, keys lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  /** Every non-header entry, in file order. */
  readonly entries: readonly PoEntry[];
}

export class PoParseError extends Error {
  constructor(
    message: string,
    readonly line: number
  ) {
    super(`line ${line}: ${message}`);
    this.name = "PoParseError";
  }
}

/**
 * Decodes one PO string literal's INNER text (quotes already stripped).
 *
 * Rejects an unknown escape rather than passing it through: `\d` in a catalog is
 * far more likely to be a typo in a translation than an intentional backslash,
 * and passing it through would put a stray `\` on a rendered screen.
 */
function decodeEscapes(raw: string, line: number): string {
  let out = "";

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];

    if (char !== "\\") {
      out += char;
      continue;
    }

    const next = raw[i + 1];
    i += 1;

    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      default:
        throw new PoParseError(
          `unsupported escape sequence \\${next ?? "<end of line>"}`,
          line
        );
    }
  }

  return out;
}

/** Extracts the quoted payload of a line like `msgid "text"` or a bare `"more"`. */
function readQuoted(text: string, line: number): string {
  const trimmed = text.trim();

  if (
    trimmed.length < 2 ||
    !trimmed.startsWith('"') ||
    !trimmed.endsWith('"')
  ) {
    throw new PoParseError(
      `expected a double-quoted string, got ${trimmed}`,
      line
    );
  }

  return decodeEscapes(trimmed.slice(1, -1), line);
}

/** Splits a header blob (`Key: value\n…`) into a lower-cased key map. */
function parseHeaders(blob: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const rawLine of blob.split("\n")) {
    if (rawLine.trim() === "") continue;

    const colon = rawLine.indexOf(":");
    if (colon === -1) continue;

    headers[rawLine.slice(0, colon).trim().toLowerCase()] = rawLine
      .slice(colon + 1)
      .trim();
  }

  return headers;
}

type Field = "msgctxt" | "msgid" | "msgid_plural" | "msgstr";

interface Pending {
  context: string | null;
  msgid: string | null;
  msgidPlural: string | null;
  msgstr: Map<number, string>;
  fuzzy: boolean;
  line: number;
}

function emptyPending(): Pending {
  return {
    context: null,
    msgid: null,
    msgidPlural: null,
    msgstr: new Map(),
    fuzzy: false,
    line: 0
  };
}

/**
 * Parses a PO document. Throws `PoParseError` on anything it cannot fully
 * account for — the callers are a compiler and a gate, both of which must fail
 * loudly rather than emit a catalog with holes in it.
 */
export function parsePo(source: string): PoFile {
  const lines = source.split(/\r?\n/);
  const entries: PoEntry[] = [];
  let headers: Record<string, string> = {};
  let sawHeader = false;

  let pending = emptyPending();
  // Which field the next bare `"continuation"` line appends to.
  let current: Field | null = null;
  let currentPluralIndex = 0;

  const flush = (atLine: number): void => {
    if (pending.msgid === null) {
      // Nothing accumulated (blank lines / comment-only block) — not an error.
      pending = emptyPending();
      current = null;
      return;
    }

    // The header is the entry whose msgid is empty and which carries no context.
    if (pending.msgid === "" && pending.context === null) {
      if (sawHeader) {
        throw new PoParseError(
          "duplicate header entry",
          pending.line || atLine
        );
      }

      headers = parseHeaders(pending.msgstr.get(0) ?? "");
      sawHeader = true;
      pending = emptyPending();
      current = null;
      return;
    }

    const maxIndex = Math.max(...pending.msgstr.keys(), 0);
    const msgstr: string[] = [];

    for (let i = 0; i <= maxIndex; i += 1) {
      msgstr.push(pending.msgstr.get(i) ?? "");
    }

    entries.push({
      context: pending.context,
      msgid: pending.msgid,
      msgidPlural: pending.msgidPlural,
      msgstr,
      fuzzy: pending.fuzzy,
      line: pending.line
    });

    pending = emptyPending();
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();

    if (trimmed === "") {
      flush(lineNumber);
      continue;
    }

    if (trimmed.startsWith("#")) {
      // `#,` carries flags; `fuzzy` is the only one that changes meaning here.
      // Every other comment form (`#.`, `#:`, `#|`, plain `#`) is metadata this
      // parser has no reason to keep.
      if (trimmed.startsWith("#,")) {
        const flags = trimmed
          .slice(2)
          .split(",")
          .map((flag) => flag.trim());

        if (flags.includes("fuzzy")) {
          pending.fuzzy = true;
        }
      }

      continue;
    }

    if (trimmed.startsWith('"')) {
      if (current === null) {
        throw new PoParseError(
          "continuation string with no preceding msgid/msgstr keyword",
          lineNumber
        );
      }

      const addition = readQuoted(trimmed, lineNumber);

      if (current === "msgctxt") {
        pending.context = (pending.context ?? "") + addition;
      } else if (current === "msgid") {
        pending.msgid = (pending.msgid ?? "") + addition;
      } else if (current === "msgid_plural") {
        pending.msgidPlural = (pending.msgidPlural ?? "") + addition;
      } else {
        pending.msgstr.set(
          currentPluralIndex,
          (pending.msgstr.get(currentPluralIndex) ?? "") + addition
        );
      }

      continue;
    }

    const keywordMatch = /^([A-Za-z_]+)(\[(\d+)\])?\s+(.*)$/.exec(trimmed);

    if (!keywordMatch) {
      throw new PoParseError(`unrecognised line: ${trimmed}`, lineNumber);
    }

    const keyword = keywordMatch[1] ?? "";
    const bracketIndex = keywordMatch[3];
    const rest = keywordMatch[4] ?? "";
    const value = readQuoted(rest, lineNumber);

    switch (keyword) {
      case "msgctxt":
        // A new `msgctxt` opens a new entry — PO has no blank line requirement.
        if (pending.msgid !== null) flush(lineNumber);
        pending.context = value;
        pending.line = lineNumber;
        current = "msgctxt";
        break;

      case "msgid":
        if (pending.msgid !== null) flush(lineNumber);
        pending.msgid = value;
        if (pending.line === 0) pending.line = lineNumber;
        current = "msgid";
        break;

      case "msgid_plural":
        if (pending.msgid === null) {
          throw new PoParseError("msgid_plural before msgid", lineNumber);
        }
        pending.msgidPlural = value;
        current = "msgid_plural";
        break;

      case "msgstr": {
        if (pending.msgid === null) {
          throw new PoParseError("msgstr before msgid", lineNumber);
        }

        currentPluralIndex = bracketIndex ? Number(bracketIndex) : 0;

        if (pending.msgstr.has(currentPluralIndex)) {
          throw new PoParseError(
            `duplicate msgstr[${currentPluralIndex}]`,
            lineNumber
          );
        }

        pending.msgstr.set(currentPluralIndex, value);
        current = "msgstr";
        break;
      }

      default:
        throw new PoParseError(`unsupported keyword "${keyword}"`, lineNumber);
    }
  }

  flush(lines.length);

  return { headers, entries };
}

/** The lookup key for an entry: `context\u0004msgid`, or bare `msgid`. */
export function catalogKey(
  msgid: string,
  context: string | null = null
): string {
  return context === null ? msgid : `${context}${CONTEXT_SEPARATOR}${msgid}`;
}
