/**
 * CSS design-token VALUE validation — the security spine of the `theming`
 * module (Issue #269, ADR-0029 §5). Pure, no I/O.
 *
 * ## Reject, never sanitize
 *
 * Every function here VALIDATES (accepts an already-safe value, or throws)
 * rather than SANITIZES (strips dangerous substrings out of a value). This is
 * deliberate and load-bearing:
 *
 *  - A tenant-supplied token value that is not EXACTLY one of the strict,
 *    bounded shapes below is REJECTED with a `CssValueError` — it is never
 *    "cleaned up" and stored. Multi-character sanitization (e.g. stripping
 *    `expression(` or `/*` out of a value) is bypassable by construction and
 *    is exactly the `js/incomplete-multi-character-sanitization` CodeQL class;
 *    rejecting an unmatched value avoids that whole class structurally.
 *  - Because accepted values are already constrained to a safe character set,
 *    there is nothing left to escape when they are serialized into a
 *    `text/css` custom-property declaration (`serializeThemeTokensCss`). The
 *    serializer still re-runs validation as defense in depth.
 *
 * This is the single control ADR-0029's threat model relies on for "CSS
 * injection" and "unsafe URL / exfiltration": a tenant can never place
 * `url(javascript:…)`, `expression()`, `@import`, an unbalanced token, a
 * comment breakout, or a raw `<script>`/`;`/`{}` into the emitted stylesheet.
 */

/** Thrown when a tenant-supplied CSS token value fails validation. */
export class CssValueError extends Error {
  readonly tokenValue: string;
  constructor(message: string, tokenValue: string) {
    super(message);
    this.name = "CssValueError";
    this.tokenValue = tokenValue;
  }
}

/** Hard cap on any single token value — a design token is a short scalar, never a stylesheet. */
export const MAX_CSS_TOKEN_VALUE_LENGTH = 128;

/**
 * The ONLY characters a validated primitive token value may contain. Letters,
 * digits, and the small punctuation set the color/dimension/number grammars
 * need: `#` (hex), `.` (decimal), `,` `%` `(` `)` and space/slash (functional
 * color notation), `-` (negative dimensions / hyphenated named colors). Notably
 * ABSENT: `;` `{` `}` `<` `>` `\` `` ` `` `@` `*` `!` `&` `"` `'` `=` `:` — the
 * characters a CSS-injection / comment-breakout / at-rule / url() payload needs.
 */
const SAFE_CSS_PRIMITIVE_CHARSET = /^[A-Za-z0-9#.,%()\/ -]*$/;

/**
 * Substrings that must never appear in a token value even if every individual
 * character is in the safe charset (e.g. `//` cannot form a comment here since
 * `*` is already banned, but we reject defensively; a functional-notation
 * lookalike like `expression` cannot appear because letters are allowed).
 * These are belt-and-suspenders on top of the charset + grammar checks.
 */
const FORBIDDEN_CSS_SUBSTRINGS: readonly string[] = [
  "//",
  "/*",
  "*/",
  "url",
  "expression",
  "javascript",
  "data:",
  "import",
  "@",
  "\\"
];

/** True if every `(` in the string has a matching later `)` and vice versa (no nesting depth < 0, ends at 0). */
function hasBalancedParens(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * The universal guard every typed validator below calls FIRST. Enforces:
 * non-empty, length-bounded, no control characters / newlines, the safe
 * charset only, no forbidden substrings, and balanced parentheses. Throws
 * `CssValueError` on any violation — never returns a "cleaned" string.
 */
export function assertSafeCssPrimitive(value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new CssValueError(
      "Token value must be a non-empty string.",
      String(value)
    );
  }
  if (value.length > MAX_CSS_TOKEN_VALUE_LENGTH) {
    throw new CssValueError(
      `Token value exceeds ${MAX_CSS_TOKEN_VALUE_LENGTH} characters.`,
      value
    );
  }
  // Control characters (incl. newlines/tabs) are forbidden anywhere — a
  // newline could split a declaration; a control char could smuggle intent
  // past a naive downstream reader. Checked by char code so no control
  // literal appears in this source file.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw new CssValueError(
        "Token value contains a control character.",
        value
      );
    }
  }
  if (!SAFE_CSS_PRIMITIVE_CHARSET.test(value)) {
    throw new CssValueError(
      "Token value contains a character outside the safe CSS token charset.",
      value
    );
  }
  const lowered = value.toLowerCase();
  for (const forbidden of FORBIDDEN_CSS_SUBSTRINGS) {
    if (lowered.includes(forbidden)) {
      throw new CssValueError(
        `Token value contains a forbidden CSS construct ("${forbidden}").`,
        value
      );
    }
  }
  if (!hasBalancedParens(value)) {
    throw new CssValueError("Token value has unbalanced parentheses.", value);
  }
}

// --- Color ---------------------------------------------------------------

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * `rgb()`/`rgba()`/`hsl()`/`hsla()` with STRICTLY numeric/percent components.
 * Linear regex (no nested unbounded quantifiers) — the `(?:[...]){0,3}` group is
 * bounded, so no ReDoS. Components: number or percent, comma-or-space separated,
 * optional `/ alpha`. Rejects any function argument that is not a number/percent
 * (so `rgb(var(--x))` / `rgb(expression())` never match — and `var`/`expression`
 * are already banned substrings anyway).
 */
const FUNCTIONAL_COLOR =
  /^(?:rgb|rgba|hsl|hsla)\(\s*-?\d+(?:\.\d+)?%?(?:\s*[, ]\s*-?\d+(?:\.\d+)?%?){2,3}(?:\s*\/\s*-?\d+(?:\.\d+)?%?)?\s*\)$/;

/**
 * A small allow-list of CSS named colors a tenant may use by name. Kept short
 * on purpose — the full 148-name list adds nothing a hex value can't express,
 * and a shorter list is a smaller thing to reason about. `transparent`/
 * `currentcolor` are the two genuinely useful keywords.
 */
const NAMED_COLOR_ALLOW_LIST: ReadonlySet<string> = new Set([
  "transparent",
  "currentcolor",
  "black",
  "white",
  "red",
  "green",
  "blue",
  "gray",
  "grey"
]);

/**
 * Validate a color token value. Accepts a hex color, a strictly-numeric
 * functional color, or an allow-listed named color. Returns the value
 * unchanged (already safe) or throws `CssValueError`.
 */
export function validateColorValue(value: string): string {
  assertSafeCssPrimitive(value);
  if (HEX_COLOR.test(value)) return value;
  if (FUNCTIONAL_COLOR.test(value)) return value;
  if (NAMED_COLOR_ALLOW_LIST.has(value.toLowerCase())) return value;
  throw new CssValueError(
    "Color must be a hex, rgb()/rgba()/hsl()/hsla() with numeric components, or an allow-listed named color.",
    value
  );
}

// --- Dimension -----------------------------------------------------------

export type DimensionConstraint = {
  units: readonly string[];
  min: number;
  max: number;
};

/** The units a dimension token may use — no `calc()`, no `var()`, no viewport-math expression. */
export const DIMENSION_UNIT_ALLOW_LIST: readonly string[] = [
  "px",
  "rem",
  "em",
  "%",
  "vh",
  "vw",
  "ch"
];

const DIMENSION_NUMBER_UNIT = /^(-?\d+(?:\.\d+)?)([a-z%]+)$/;

/**
 * Validate a dimension token value: a number followed by a unit from
 * `constraint.units`, with the numeric part within `[min, max]`. `0` alone is
 * accepted (unitless zero is valid CSS). Rejects `calc(...)`, `var(...)`, and
 * anything with an out-of-range or non-numeric magnitude.
 */
export function validateDimensionValue(
  value: string,
  constraint: DimensionConstraint
): string {
  assertSafeCssPrimitive(value);
  if (value === "0") return value;
  const match = DIMENSION_NUMBER_UNIT.exec(value);
  if (!match) {
    throw new CssValueError(
      "Dimension must be a number followed by an allowed unit.",
      value
    );
  }
  const magnitude = Number(match[1]);
  const unit = match[2]!;
  if (!constraint.units.includes(unit)) {
    throw new CssValueError(
      `Dimension unit "${unit}" is not one of ${constraint.units.join(", ")}.`,
      value
    );
  }
  if (
    !Number.isFinite(magnitude) ||
    magnitude < constraint.min ||
    magnitude > constraint.max
  ) {
    throw new CssValueError(
      `Dimension magnitude must be between ${constraint.min} and ${constraint.max}.`,
      value
    );
  }
  return value;
}

// --- Number --------------------------------------------------------------

export type NumberConstraint = {
  min: number;
  max: number;
  integer?: boolean;
};

const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * Validate a plain numeric token value (line-height, font-weight, z-index, …)
 * within `[min, max]`, optionally integer-only.
 */
export function validateNumberValue(
  value: string,
  constraint: NumberConstraint
): string {
  assertSafeCssPrimitive(value);
  if (!PLAIN_NUMBER.test(value)) {
    throw new CssValueError(
      "Number token must be a plain numeric value.",
      value
    );
  }
  const numeric = Number(value);
  if (
    !Number.isFinite(numeric) ||
    numeric < constraint.min ||
    numeric > constraint.max
  ) {
    throw new CssValueError(
      `Number must be between ${constraint.min} and ${constraint.max}.`,
      value
    );
  }
  if (constraint.integer && !Number.isInteger(numeric)) {
    throw new CssValueError("Number token must be an integer.", value);
  }
  return value;
}

// --- Font family stack ---------------------------------------------------

/** A font-family stack is a short list of family names, never a stylesheet. */
export const MAX_FONT_STACK_LENGTH = 256;

/**
 * The characters a descriptor-owned font-family STACK may contain. Broader than
 * a primitive token value (a stack quotes multi-word family names and separates
 * families with commas — e.g. `"Segoe UI", system-ui, sans-serif`) but STILL
 * narrow enough that a CSS-injection payload is structurally impossible: it
 * allows ONLY letters, digits, space, comma, single/double quote and hyphen.
 * Notably ABSENT: `;` `{` `}` `<` `>` `\` `/` `@` `:` `(` `)` `#` `%` `.` `!`
 * `&` `=` — every character a declaration-breakout / at-rule / `url()` /
 * comment / `expression()` payload needs. So a stack can never escape its
 * `--awcms-theme-<key>: <stack>;` declaration.
 */
const SAFE_FONT_STACK_CHARSET = /^[A-Za-z0-9 ,"'-]+$/;

/** True if `"` and `'` each occur an even number of times (every quoted name is closed). */
function hasBalancedQuotes(value: string): boolean {
  let doubles = 0;
  let singles = 0;
  for (const char of value) {
    if (char === '"') doubles += 1;
    else if (char === "'") singles += 1;
  }
  return doubles % 2 === 0 && singles % 2 === 0;
}

/**
 * Validate a font-family STACK string (the reviewed, descriptor-owned CSS the
 * serializer emits when a tenant picks a font-family key — never tenant-
 * authored, but validated as defense in depth so a mistaken/hostile DERIVED
 * theme's stack fails compose/tests rather than reaching the stylesheet). Same
 * reject-not-sanitize posture as the primitives: an unmatched value throws
 * `CssValueError`, it is never "cleaned". Returns the value unchanged if safe.
 */
export function validateFontStack(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CssValueError(
      "Font stack must be a non-empty string.",
      String(value)
    );
  }
  if (value.length > MAX_FONT_STACK_LENGTH) {
    throw new CssValueError(
      `Font stack exceeds ${MAX_FONT_STACK_LENGTH} characters.`,
      value
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw new CssValueError(
        "Font stack contains a control character.",
        value
      );
    }
  }
  if (!SAFE_FONT_STACK_CHARSET.test(value)) {
    throw new CssValueError(
      "Font stack contains a character outside the safe font-family charset.",
      value
    );
  }
  if (!hasBalancedQuotes(value)) {
    throw new CssValueError("Font stack has unbalanced quotes.", value);
  }
  return value;
}
