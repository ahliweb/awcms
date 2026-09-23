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

export function parseJsonTrackingFloats<T = unknown>(
  text: string
): ParsedJson<T> {
  const floatLiteralPaths = new Set<string>();
  let i = 0;
  const n = text.length;

  const err = (message: string): never => {
    throw new JsonParseError(`${message} at offset ${i}`);
  };

  const skipWs = () => {
    while (i < n && /\s/.test(text[i]!)) i++;
  };

  const parseValue = (path: string): unknown => {
    skipWs();
    if (i >= n) err("unexpected end of input");
    const c = text[i]!;
    if (c === "{") return parseObject(path);
    if (c === "[") return parseArray(path);
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

  const parseNumber = (path: string): number => {
    const start = i;
    if (text[i] === "-") i++;
    while (i < n && text[i]! >= "0" && text[i]! <= "9") i++;
    let isFloatLiteral = false;
    if (text[i] === ".") {
      isFloatLiteral = true;
      i++;
      while (i < n && text[i]! >= "0" && text[i]! <= "9") i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      isFloatLiteral = true;
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      while (i < n && text[i]! >= "0" && text[i]! <= "9") i++;
    }
    const token = text.slice(start, i);
    if (token === "" || token === "-") err("invalid number literal");
    if (isFloatLiteral) floatLiteralPaths.add(path);
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
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            err(`invalid escape sequence '\\${esc}'`);
        }
        i++;
      } else {
        out += c;
        i++;
      }
    }
    if (text[i] !== '"') err("unterminated string");
    i++;
    return out;
  };

  const parseObject = (path: string): Record<string, unknown> => {
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
      obj[key] = parseValue(`${path}.${key}`);
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

  const parseArray = (path: string): unknown[] => {
    const arr: unknown[] = [];
    i++; // [
    skipWs();
    if (text[i] === "]") {
      i++;
      return arr;
    }
    let idx = 0;
    for (;;) {
      arr.push(parseValue(`${path}[${idx}]`));
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

  const value = parseValue("$");
  skipWs();
  if (i !== n) err("unexpected trailing content");

  return { value: value as T, floatLiteralPaths };
}
