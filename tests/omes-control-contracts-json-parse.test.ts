/**
 * Issue ahliweb/omes#197 — adversarial-input hardening for
 * `src/modules/omes-control/domain/contracts/json-parse.ts`, the raw-text
 * JSON reader `validateOmesContractText` uses so `type: "integer"`
 * enforcement can see the difference between `19` and `19.0` (see that
 * module's doc).
 *
 * A prior version of this parser built object results with plain
 * `obj[key] = value`, which is a textbook prototype-pollution vector: for
 * `key === "__proto__"`, that assignment hits `Object.prototype`'s
 * `__proto__` ACCESSOR instead of creating a data property, so a payload
 * like `{"__proto__":{"password":"leaked"}}` would vanish from
 * `Object.keys()`/`Object.entries()` — invisible to both `schema.ts`'s
 * `additionalProperties`/`required` checks and the independent
 * `scanForRawSecrets` scanner, on `validateOmesContractText`, the very
 * entry point this module's docs recommend for #198's request handlers.
 * `schema.ts` had a second, related gap: it looked up a schema's declared
 * property names with the `in` operator and bracket indexing, both of
 * which also resolve `"__proto__"` against the INHERITED `Object.prototype`
 * accessor rather than the schema's own declared keys.
 *
 * This file proves both are fixed, and locks down the surrounding grammar
 * edge cases (leading zeros, digit-less decimals, BOM, control characters,
 * nesting depth, trailing data, surrogates, huge numbers) against silent
 * drift from native `JSON.parse`/Python `json.loads` behavior.
 */
import { describe, expect, test } from "bun:test";

import { validateOmesContractText } from "../src/modules/omes-control/domain/contracts";
import {
  deepEqualJson,
  JsonParseError,
  parseJsonTrackingFloats
} from "../src/modules/omes-control/domain/contracts/json-parse";
import { scanForRawSecrets } from "../src/modules/omes-control/domain/contracts/schema";

describe("__proto__ / prototype pollution (critical)", () => {
  test("a parsed object's __proto__ key is an own, enumerable data property — the real prototype is untouched", () => {
    const { value } = parseJsonTrackingFloats<Record<string, unknown>>(
      '{"a":1,"__proto__":{"polluted":true}}'
    );
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(Object.keys(value).sort()).toEqual(["__proto__", "a"]);
    expect(value.__proto__).toEqual({ polluted: true });
    // The literal proof this used to fail on: an unrelated, freshly created
    // plain object must NOT see the smuggled "polluted" property.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("constructor and prototype keys are also ordinary own data properties, not special-cased", () => {
    const { value } = parseJsonTrackingFloats<Record<string, unknown>>(
      '{"constructor":{"x":1},"prototype":{"y":2}}'
    );
    expect(Object.hasOwn(value, "constructor")).toBe(true);
    expect(Object.hasOwn(value, "prototype")).toBe(true);
    expect(value["constructor"]).toEqual({ x: 1 });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  test("duplicate keys keep the LAST value, matching native JSON.parse", () => {
    const { value } = parseJsonTrackingFloats<Record<string, unknown>>(
      '{"a":1,"a":2,"a":3}'
    );
    expect(value.a).toBe(3);
    expect(Object.keys(value)).toEqual(["a"]);
  });

  test("additionalProperties:false REJECTS a __proto__-keyed payload (currency schema: additionalProperties:false)", async () => {
    // currency.schema.json requires {code, name} and additionalProperties:false.
    const rawText =
      '{"code":"USD","name":"US Dollar","__proto__":{"code":"XXX"}}';
    const errors = await validateOmesContractText("currency", rawText);
    expect(errors.some((e) => e.includes("__proto__"))).toBe(true);
    expect(
      errors.some((e) => e.includes("additional properties not allowed"))
    ).toBe(true);
  });

  test("a secret smuggled under __proto__ is still caught by the independent raw-secret scanner", () => {
    const { value } = parseJsonTrackingFloats<Record<string, unknown>>(
      '{"notes":"fine","__proto__":{"api_key":"just-a-plain-string-value"}}'
    );
    const errors = scanForRawSecrets(value as never);
    expect(
      errors.some(
        (e) => e.includes("__proto__") && e.includes("secret pattern")
      )
    ).toBe(true);
  });

  test("a schema whose properties object legitimately has no __proto__ entry still enforces required/type on ordinary fields after a __proto__-keyed payload", async () => {
    // Sanity: the fix must not make __proto__ swallow validation of the REST
    // of the object either. worker-enrollment.request requires a token.
    const rawText = '{"__proto__":{"anything":true}}';
    const errors = await validateOmesContractText(
      "worker-enrollment.request",
      rawText
    );
    expect(errors.length).toBeGreaterThan(0); // missing required fields, still enforced
  });
});

describe("const/enum use order-independent deep equality", () => {
  test("deepEqualJson treats differently-ordered object keys as equal", () => {
    expect(deepEqualJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqualJson({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  test("deepEqualJson compares arrays element-wise, order-sensitive (arrays ARE ordered in JSON)", () => {
    expect(deepEqualJson([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqualJson([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  test("deepEqualJson handles nested structures and primitives", () => {
    expect(deepEqualJson({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(
      true
    );
    expect(deepEqualJson(null, null)).toBe(true);
    expect(deepEqualJson(null, 0)).toBe(false);
    expect(deepEqualJson(true, true)).toBe(true);
  });
});

describe("number grammar matches native JSON.parse/Python json.loads exactly", () => {
  const rejects = (text: string) => {
    expect(() => parseJsonTrackingFloats(text)).toThrow(JsonParseError);
  };

  test("rejects a leading zero followed by another digit", () => {
    rejects('{"n":01}');
    // Confirm this is really invalid JSON, not just this parser being strict.
    expect(() => JSON.parse('{"n":01}')).toThrow();
  });

  test("rejects a digit-less decimal (leading or trailing)", () => {
    rejects('{"n":-.5}');
    rejects('{"n":5.}');
    expect(() => JSON.parse('{"n":-.5}')).toThrow();
    expect(() => JSON.parse('{"n":5.}')).toThrow();
  });

  test("rejects a digit-less exponent", () => {
    rejects('{"n":1e}');
    rejects('{"n":1e+}');
  });

  test("accepts ordinary integers, a bare 0, and well-formed decimals/exponents", () => {
    expect(parseJsonTrackingFloats('{"n":0}').value).toEqual({ n: 0 });
    expect(parseJsonTrackingFloats('{"n":-0}').value).toEqual({ n: -0 });
    expect(parseJsonTrackingFloats('{"n":19}').value).toEqual({ n: 19 });
    expect(parseJsonTrackingFloats('{"n":19.5}').value).toEqual({ n: 19.5 });
    expect(parseJsonTrackingFloats('{"n":1.5e10}').value).toEqual({
      n: 1.5e10
    });
  });

  test("a huge-magnitude literal matches native JSON.parse's Infinity/precision-loss behavior (not a gap to close)", () => {
    const { value } = parseJsonTrackingFloats<{ n: number }>('{"n":1e400}');
    expect(value.n).toBe(Infinity);
    expect(JSON.parse('{"n":1e400}').n).toBe(Infinity);
  });
});

describe("whitespace matches JSON's grammar, not JS's \\s", () => {
  test("rejects a leading BOM (U+FEFF), which JS's \\s matches but JSON's whitespace does not", () => {
    const withBom = "﻿" + '{"a":1}';
    expect(() => parseJsonTrackingFloats(withBom)).toThrow(JsonParseError);
    // Native JSON.parse also rejects a leading BOM.
    expect(() => JSON.parse(withBom)).toThrow();
  });

  test("accepts ordinary JSON whitespace (space, tab, LF, CR) around tokens", () => {
    const text = '\t\n {"a" \r\n: \t1\n}\n';
    expect(parseJsonTrackingFloats(text).value).toEqual({ a: 1 });
  });
});

describe("string grammar", () => {
  test("rejects an unescaped control character inside a string", () => {
    const text = '{"a":"line1\nline2"}'; // literal newline, not \n escape
    expect(() => parseJsonTrackingFloats(text)).toThrow(JsonParseError);
    expect(() => JSON.parse(text)).toThrow();
  });

  test("accepts a lone (unpaired) surrogate escape, matching native JSON.parse", () => {
    const text = '{"a":"\\ud800"}';
    const { value } = parseJsonTrackingFloats<{ a: string }>(text);
    expect(value.a).toBe(JSON.parse(text).a);
  });

  test("reconstructs a surrogate-pair escape (an emoji) correctly", () => {
    const text = '{"a":"\\ud83d\\ude00"}'; // 😀
    const { value } = parseJsonTrackingFloats<{ a: string }>(text);
    expect(value.a).toBe("😀");
    expect(value.a).toBe(JSON.parse(text).a);
  });
});

describe("structural edge cases", () => {
  test("rejects trailing content after a complete document", () => {
    expect(() => parseJsonTrackingFloats('{"a":1} garbage')).toThrow(
      JsonParseError
    );
  });

  test("rejects deep nesting with a clean error instead of an uncaught stack overflow", () => {
    const depth = 5000;
    const deeplyNested = "[".repeat(depth) + "]".repeat(depth);
    expect(() => parseJsonTrackingFloats(deeplyNested)).toThrow(JsonParseError);
  });

  test("accepts reasonably nested structures (well under the depth cap)", () => {
    const depth = 20;
    const nested = "[".repeat(depth) + "1" + "]".repeat(depth);
    expect(() => parseJsonTrackingFloats(nested)).not.toThrow();
  });
});
