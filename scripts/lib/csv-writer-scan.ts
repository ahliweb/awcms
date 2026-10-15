/**
 * Structural CSV-writer detection (Issue #1014 L4, follow-up to #978).
 *
 * The first scanner looked for a function NAMED `csv...` or the string
 * `text/csv`, and accepted any file that merely imported the formula helper.
 * Three ways round it: an arrow writer (`const toCsv = (rows) => ...`), an
 * import that is never used on the cells, and whole-file exemptions.
 *
 * What a CSV writer IS, whatever it is called, is code that joins cells with a
 * comma. So this finds every `.join(",")` and then checks the RECEIVER - the
 * expression whose elements become cells:
 *
 * - an array literal: every element is a call to the helper, or a plain string
 *   literal that cannot start a formula (a fixed header);
 * - a `.map(...)` chain: a helper call sits inside the callback;
 * - a bare identifier: the `const`/`let` initialiser of that name is checked
 *   the same way (two levels), and an identifier that cannot be traced is an
 *   offender (fail closed, not "probably fine").
 *
 * Importing the helper therefore proves nothing; USING it on each cell does.
 * Pure text, no I/O, so a test can feed it deliberately bad fixtures.
 */

/** The shared helpers that neutralise a cell (src/lib/security/csv-formula.ts). */
export const CSV_CELL_HELPERS: readonly string[] = [
  "csvCellForWrite",
  "neutralizeCsvFormula"
];

const COMMA_JOIN = /\.join\(\s*(?:","|','|`,`)\s*\)/g;
const LINE_JOIN =
  /\.join\(\s*(?:"(?:\\r)?\\n"|'(?:\\r)?\\n'|`(?:\\r)?\\n`)\s*\)/;

const NAMED_WRITER =
  /(?:function\s+\w*csv\w*\s*\(|(?:const|let|var)\s+\w*csv\w*\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>))/i;

const OPENERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** True when the code has a name or a content type that says CSV. */
export function namesCsvWriter(code: string): boolean {
  return NAMED_WRITER.test(code) || /text\/csv/.test(code);
}

/** Positions of every comma-join in `code`. */
export function findCommaJoins(code: string): number[] {
  return [...code.matchAll(COMMA_JOIN)].map((match) => match.index!);
}

/** True when the code joins cells with a comma AND lines with a newline. */
export function joinsCellsIntoLines(code: string): boolean {
  return findCommaJoins(code).length > 0 && LINE_JOIN.test(code);
}

/**
 * The receiver text that ends right before `joinIndex` (the `.` of `.join`):
 * balanced brackets, member chains and identifiers, walked backwards.
 */
export function receiverBefore(code: string, joinIndex: number): string {
  let index = joinIndex - 1;

  for (;;) {
    while (index >= 0 && /\s/.test(code[index]!)) index -= 1;
    if (index < 0) break;

    const char = code[index]!;

    if (OPENERS[char] !== undefined) {
      const open = OPENERS[char]!;
      let depth = 0;

      for (; index >= 0; index -= 1) {
        const current = code[index]!;
        if (current === char) depth += 1;
        else if (current === open) depth -= 1;
        if (depth === 0) break;
      }
      index -= 1;
      // A call (`name(`) or an index (`x[`) continues to the left.
      continue;
    }

    if (/[\w$.?!]/.test(char)) {
      while (index >= 0 && /[\w$.?!]/.test(code[index]!)) index -= 1;
      // `.map(` chains continue across a newline before the dot.
      let look = index;
      while (look >= 0 && /\s/.test(code[look]!)) look -= 1;
      if (look >= 0 && (code[look] === ")" || code[look] === "]")) {
        index = look;
        continue;
      }
      break;
    }

    break;
  }

  return code.slice(index + 1, joinIndex).trim();
}

/** Top-level, comma-separated pieces of `text` (no nesting is split). */
function topLevelElements(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (quote !== null) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));

  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

const helperCall = (text: string): boolean =>
  CSV_CELL_HELPERS.some((helper) =>
    new RegExp(`\\b${helper}\\s*\\(`).test(text)
  );

const startsWithHelperCall = (text: string): boolean =>
  CSV_CELL_HELPERS.some((helper) => new RegExp(`^${helper}\\s*\\(`).test(text));

/** A plain string literal that cannot start a formula (a fixed header cell). */
function isSafeLiteral(element: string): boolean {
  const match = /^(["'])((?:\\.|(?!\1).)*)\1$/.exec(element);
  if (match === null) return false;

  return !/^[\s=+\-@\t\r]/.test(match[2]!);
}

/** Why `receiver` is not provably neutralised, or `null` when it is. */
export function cellProblem(
  receiver: string,
  code: string,
  depth = 0
): string | null {
  if (receiver.startsWith("[") && receiver.endsWith("]")) {
    const elements = topLevelElements(receiver.slice(1, -1));

    for (const element of elements) {
      if (element.startsWith("...")) {
        const inner = cellProblem(element.slice(3).trim(), code, depth);
        if (inner !== null) return `spread ${element}: ${inner}`;
        continue;
      }
      if (startsWithHelperCall(element) || isSafeLiteral(element)) continue;

      return `cell \`${element.replace(/\s+/g, " ")}\` does not go through csvCellForWrite`;
    }

    return null;
  }

  if (/^[A-Za-z_$][\w$]*$/.test(receiver)) {
    if (depth >= 2) return `identifier ${receiver} cannot be traced`;

    const declaration = new RegExp(
      `(?:const|let|var)\\s+${escapeRegExp(receiver)}\\s*(?::[^=]+)?=([\\s\\S]*?);`
    ).exec(code);

    if (declaration === null) {
      return `identifier ${receiver} has no declaration the scan can trace`;
    }

    return cellProblem(declaration[1]!.trim(), code, depth + 1);
  }

  if (/\.map\s*\(/.test(receiver)) {
    const afterMap = receiver.slice(receiver.search(/\.map\s*\(/));

    return helperCall(afterMap)
      ? null
      : "the .map callback never calls csvCellForWrite";
  }

  return helperCall(receiver)
    ? null
    : `receiver \`${receiver.replace(/\s+/g, " ")}\` is not provably neutralised`;
}

/** Escapes every RegExp metacharacter, backslash included. */
function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/** Every comma-join in `code` whose cells are not provably neutralised. */
export function findUnguardedCsvJoins(code: string): string[] {
  return findCommaJoins(code).flatMap((index) => {
    const problem = cellProblem(receiverBefore(code, index), code);

    return problem === null ? [] : [problem];
  });
}
