/**
 * A JSON parser that additionally tracks which numeric literals were
 * written with a decimal point or exponent (Issue ahliweb/omes#197).
 *
 * Why this exists: `type: "integer"` must reject `19.0`, exactly like
 * `lib/omes/py/jobs/schema.py` does (Python's `json.load` parses `19.0` as
 * a `float`, so `isinstance(instance, int)` is false). JavaScript's
 * `JSON.parse` has no such distinction — `19.0` and `19` both become the
 * identical `number` value `19`, so by the time a value has gone through
 * `JSON.parse`, whether its literal had a decimal point is unrecoverable.
 *
 * This parser is a small recursive-descent JSON reader used specifically
 * where AWCMS has the RAW JSON TEXT available (a request body, a vendored
 * fixture file) and wants OMES-identical `integer` enforcement. It returns
 * the ordinary parsed value plus a `Set` of JSON-pointer-style paths (the
 * same `$.foo.bar[0]` format `schema.ts`'s error messages use) naming every
 * number whose literal contained `.`, `e`, or `E` — i.e. every value a
 * Python `type: "integer"` check would reject even though it is
 * mathematically a whole number.
 *
 * Callers that only have an already-`JSON.parse`d JS object (no raw text)
 * cannot recover this distinction — that is an unavoidable JavaScript
 * platform gap, not a validator weakening. `schema.ts`'s `validate()` still
 * enforces `Number.isInteger()` in that case, which is the best available
 * without the source text.
 *
 * SECURITY: this parser deliberately does NOT use plain `obj[key] = value`
 * to build object results. A hand-rolled recursive-descent parser that does
 * is a textbook prototype-pollution vector: `key === "__proto__"` would hit
 * `Object.prototype`'s accessor instead of creating a data property, so a
 * payload like `{"__proto__":{"password":"leaked"}}` would silently vanish
 * from `Object.keys()`/`Object.entries()` — invisible to `schema.ts`'s
 * `additionalProperties`/`required` checks AND to `scanForRawSecrets`, both
 * of which walk objects with `Object.keys`/`Object.entries`. Every key is
 * therefore written with `Object.defineProperty`, which — like native
 * `JSON.parse` — always creates a literal own, enumerable, writable data
 * property, `__proto__`/`constructor`/`prototype` included, and never
 * touches the prototype chain.
 */

export class JsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonParseError";
  }
}

export type ParsedJson<T = unknown> = {
  value: T;
  /** Paths (in `$.foo.bar[0]` form) of every number literal written with `.`/`e`/`E`. */
  floatLiteralPaths: ReadonlySet<string>;
};

/**
 * Sets an OWN, enumerable, writable data property named `key` on `obj`,
 * exactly as native `JSON.parse` does for every object key — including
 * `__proto__`, `constructor`, and `prototype`, none of which get special
 * treatment. Never use `obj[key] = value` to build a parsed-JSON object:
 * see this module's doc for why.
 */
function setOwnProperty(
  obj: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}

/**
 * Maximum object/array nesting depth. A recursive-descent parser like this
 * one uses one JS call stack frame per nesting level; without a cap, a
 * malicious/malformed payload with deep nesting (e.g. `"[[[[[...".repeat(n)`)
 * throws an uncaught `RangeError: Maximum call stack size exceeded` instead
 * of a clean, catchable parse error. 1000 comfortably exceeds any legitimate
 * OMES contract payload's nesting (none exceeds single digits) while still
 * failing fast, well before the actual engine stack limit.
 */
const MAX_NESTING_DEPTH = 1000;

export function parseJsonTrackingFloats<T = unknown>(
  text: string
): ParsedJson<T> {
  const floatLiteralPaths = new Set<string>();
  let i = 0;
  const n = text.length;

  const err = (message: string): never => {
    throw new JsonParseError(`${message} at offset ${i}`);
  };

  // Only the four characters JSON's own grammar (RFC 8259 §2) calls
  // whitespace — space, tab, LF, CR. Not JS's `\s`, which additionally
  // matches vertical tab, form feed, various Unicode space separators, and
  // U+FEFF (BOM/ZERO WIDTH NO-BREAK SPACE) — so `\s`-based skipping would
  // silently accept a leading BOM or a vertical-tab-indented payload that
  // both native `JSON.parse` and Python's `json.loads` reject.
  const isJsonWhitespace = (ch: string): boolean =>
    ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

  const skipWs = () => {
    while (i < n && isJsonWhitespace(text[i]!)) i++;
  };

  const parseValue = (path: string, depth: number): unknown => {
    if (depth > MAX_NESTING_DEPTH) {
      err(`exceeded maximum nesting depth of ${MAX_NESTING_DEPTH}`);
    }
    skipWs();
    if (i >= n) err("unexpected end of input");
    const c = text[i]!;
    if (c === "{") return parseObject(path, depth);
    if (c === "[") return parseArray(path, depth);
    if (c === '"') return parseString();
    if (c === "t") return parseLiteral("true", true);
    if (c === "f") return parseLiteral("false", false);
    if (c === "n") return parseLiteral("null", null);
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber(path);
    return err(`unexpected character '${c}'`);
  };

  const parseLiteral = <V>(literal: string, value: V): V => {
    if (text.slice(i, i + literal.length) !== literal) {
      err(`expected literal '${literal}'`);
    }
    i += literal.length;
    return value;
  };

  const isDigit = (ch: string | undefined): ch is string =>
    ch !== undefined && ch >= "0" && ch <= "9";

  const parseNumber = (path: string): number => {
    const start = i;
    if (text[i] === "-") i++;

    // Integer part: JSON's grammar (RFC 8259 §6) is `"0" | onenine digit*`
    // — a single `0`, or a nonzero digit followed by more digits. A
    // leading zero followed by another digit (`01`) is NOT valid JSON,
    // even though `Number("01")` happily parses to `1`; reject it exactly
    // like native `JSON.parse("01")` and Python `json.loads("01")` do.
    if (!isDigit(text[i])) err("invalid number literal: expected a digit");
    if (text[i] === "0") {
      i++;
      if (isDigit(text[i]))
        err(
          "invalid number literal: leading zero must not be followed by a digit"
        );
    } else {
      while (isDigit(text[i])) i++;
    }

    let isFloatLiteral = false;
    if (text[i] === ".") {
      // A decimal point MUST be followed by at least one digit (`-.5` and
      // `5.` are both invalid JSON) — unlike `Number("-.5")`, which is
      // happy to accept a digit-less fraction.
      i++;
      if (!isDigit(text[i]))
        err("invalid number literal: '.' must be followed by a digit");
      isFloatLiteral = true;
      while (isDigit(text[i])) i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      if (!isDigit(text[i]))
        err("invalid number literal: exponent must have a digit");
      isFloatLiteral = true;
      while (isDigit(text[i])) i++;
    }

    const token = text.slice(start, i);
    if (isFloatLiteral) floatLiteralPaths.add(path);
    // Huge-magnitude literals (e.g. `1e400`) round to `Infinity`/lose
    // precision exactly like native `JSON.parse`/Python `json.loads` do —
    // that is matching platform behavior, not a gap this parser needs to
    // close.
    return Number(token);
  };

  const parseString = (): string => {
    if (text[i] !== '"') err("expected string");
    i++;
    let out = "";
    while (i < n && text[i] !== '"') {
      const c = text[i]!;
      if (c === "\\") {
        i++;
        const esc = text[i];
        switch (esc) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const hex = text.slice(i + 1, i + 5);
            if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              err("invalid \\u escape sequence");
            }
            // A lone (unpaired) surrogate half here is intentionally
            // accepted, exactly like native `JSON.parse`/Python
            // `json.loads` — both permit an ill-formed UTF-16 string
            // rather than rejecting it. A valid surrogate PAIR (e.g. an
            // emoji encoded as two consecutive `😀` escapes) is
            // reconstructed correctly by simple concatenation, since JS
            // strings are themselves UTF-16 code-unit sequences.
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            err(`invalid escape sequence '\\${esc}'`);
        }
        i++;
      } else if (c.charCodeAt(0) < 0x20) {
        // RFC 8259 §7: control characters (U+0000-U+001F) must be escaped;
        // a literal one inside a string is invalid JSON. Native
        // `JSON.parse` rejects it too.
        err("invalid unescaped control character in string");
      } else {
        out += c;
        i++;
      }
    }
    if (text[i] !== '"') err("unterminated string");
    i++;
    return out;
  };

  const parseObject = (
    path: string,
    depth: number
  ): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    i++; // {
    skipWs();
    if (text[i] === "}") {
      i++;
      return obj;
    }
    for (;;) {
      skipWs();
      const key = parseString();
      skipWs();
      if (text[i] !== ":") err("expected ':'");
      i++;
      const value = parseValue(`${path}.${key}`, depth + 1);
      // Own-property write (see setOwnProperty's doc): never `obj[key] = value`.
      // Duplicate keys: matches native JSON.parse's "last write wins".
      setOwnProperty(obj, key, value);
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        break;
      }
      err("expected ',' or '}'");
    }
    return obj;
  };

  const parseArray = (path: string, depth: number): unknown[] => {
    const arr: unknown[] = [];
    i++; // [
    skipWs();
    if (text[i] === "]") {
      i++;
      return arr;
    }
    let idx = 0;
    for (;;) {
      arr.push(parseValue(`${path}[${idx}]`, depth + 1));
      idx++;
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        break;
      }
      err("expected ',' or ']'");
    }
    return arr;
  };

  skipWs();
  const value = parseValue("$", 0);
  skipWs();
  if (i !== n) err("unexpected trailing content");

  return { value: value as T, floatLiteralPaths };
}

/**
 * Deep, order-independent structural equality for parsed-JSON values.
 * `schema.ts`'s `const`/`enum` comparisons use this instead of
 * `JSON.stringify(a) === JSON.stringify(b)`, which is key-ORDER-sensitive
 * for objects (`{"a":1,"b":2}` and `{"b":2,"a":1}` stringify to different
 * strings despite being the same JSON value) — Python's `==` comparison,
 * which is what `lib/omes/py/jobs/schema.py`'s `const`/`enum` checks use,
 * is order-independent. Not yet exercised by any vendored v1 schema (none
 * declares an object/array-valued `const`/`enum`), but must not silently
 * regress the moment one does.
 */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, idx) => deepEqualJson(item, b[idx]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>).sort();
    const bKeys = Object.keys(b as Record<string, unknown>).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key, idx) =>
        key === bKeys[idx] &&
        deepEqualJson(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key]
        )
    );
  }
  return false;
}
