/**
 * Unit tests for the CSS design-token VALUE validation spine (Issue #269,
 * ADR-0029 §5). This is the primary security control for "CSS injection" and
 * "unsafe URL / exfiltration" — it must REJECT (never sanitize) every value that
 * is not exactly one of the strict, bounded shapes.
 */
import { describe, expect, test } from "bun:test";

import {
  CssValueError,
  DIMENSION_UNIT_ALLOW_LIST,
  MAX_CSS_TOKEN_VALUE_LENGTH,
  MAX_FONT_STACK_LENGTH,
  assertSafeCssPrimitive,
  validateColorValue,
  validateDimensionValue,
  validateFontStack,
  validateNumberValue
} from "../src/modules/theming/domain/css-value-validation";

describe("assertSafeCssPrimitive — the universal guard", () => {
  const INJECTION_VECTORS = [
    "red; background: url(javascript:alert(1))",
    "url(javascript:alert(1))",
    "url('data:text/html,<script>')",
    "expression(alert(1))",
    "@import 'evil.css'",
    "#fff}/**/body{display:none",
    "1px;} * { color: red",
    "<script>alert(1)</script>",
    "'; DROP TABLE x; --",
    "javascript:alert(1)",
    "\\65 xpression(1)",
    "rgb(0,0,0) /* comment */"
  ];

  test.each(INJECTION_VECTORS)("rejects injection vector %p", (vector) => {
    expect(() => assertSafeCssPrimitive(vector)).toThrow(CssValueError);
  });

  test("rejects a value with a control character (checked by char code, no literal here)", () => {
    expect(() =>
      assertSafeCssPrimitive(`red${String.fromCharCode(10)}x`)
    ).toThrow(CssValueError);
    expect(() =>
      assertSafeCssPrimitive(`red${String.fromCharCode(0)}`)
    ).toThrow(CssValueError);
    expect(() =>
      assertSafeCssPrimitive(`red${String.fromCharCode(127)}`)
    ).toThrow(CssValueError);
  });

  test("rejects an over-long value", () => {
    expect(() =>
      assertSafeCssPrimitive("1".repeat(MAX_CSS_TOKEN_VALUE_LENGTH + 1))
    ).toThrow(CssValueError);
  });

  test("rejects unbalanced parentheses", () => {
    expect(() => assertSafeCssPrimitive("rgb(0,0,0")).toThrow(CssValueError);
    expect(() => assertSafeCssPrimitive("0,0,0)")).toThrow(CssValueError);
  });

  test("rejects the empty string / non-string", () => {
    expect(() => assertSafeCssPrimitive("")).toThrow(CssValueError);
    // @ts-expect-error deliberately wrong type
    expect(() => assertSafeCssPrimitive(null)).toThrow(CssValueError);
  });

  test("accepts a plain safe primitive", () => {
    expect(() => assertSafeCssPrimitive("#2563eb")).not.toThrow();
    expect(() => assertSafeCssPrimitive("1.5rem")).not.toThrow();
  });
});

describe("validateColorValue", () => {
  test.each([
    "#fff",
    "#ffff",
    "#2563eb",
    "#2563ebff",
    "rgb(0,0,0)",
    "rgba(0, 0, 0, 0.5)",
    "hsl(210, 50%, 50%)",
    "hsla(210 50% 50% / 0.5)",
    "transparent",
    "currentcolor"
  ])("accepts %p", (value) => {
    expect(validateColorValue(value)).toBe(value);
  });

  test.each([
    "#gggggg",
    "#12",
    "rgb(var(--x))",
    "rgb(0,0,0);",
    "url(#x)",
    "expression(1)",
    "blue url(x)",
    "#fff!important"
  ])("rejects %p", (value) => {
    expect(() => validateColorValue(value)).toThrow(CssValueError);
  });
});

describe("validateDimensionValue", () => {
  const constraint = { units: DIMENSION_UNIT_ALLOW_LIST, min: 0, max: 100 };

  test.each(["0", "1rem", "0.5rem", "16px", "50%", "10vh", "2ch"])(
    "accepts %p",
    (value) => {
      expect(validateDimensionValue(value, constraint)).toBe(value);
    }
  );

  test("rejects an out-of-range magnitude", () => {
    expect(() => validateDimensionValue("200px", constraint)).toThrow(
      CssValueError
    );
    expect(() => validateDimensionValue("-5px", constraint)).toThrow(
      CssValueError
    );
  });

  test("rejects a disallowed unit", () => {
    expect(() => validateDimensionValue("1pt", constraint)).toThrow(
      CssValueError
    );
  });

  test("rejects calc()/var()/expressions", () => {
    expect(() =>
      validateDimensionValue("calc(100% - 1rem)", constraint)
    ).toThrow(CssValueError);
    expect(() => validateDimensionValue("var(--x)", constraint)).toThrow(
      CssValueError
    );
  });
});

describe("validateNumberValue", () => {
  test("accepts a bounded number", () => {
    expect(validateNumberValue("1.5", { min: 1, max: 2 })).toBe("1.5");
  });

  test("rejects out of range / non-numeric / non-integer when integer required", () => {
    expect(() => validateNumberValue("3", { min: 1, max: 2 })).toThrow(
      CssValueError
    );
    expect(() => validateNumberValue("abc", { min: 0, max: 10 })).toThrow(
      CssValueError
    );
    expect(() =>
      validateNumberValue("1.5", { min: 0, max: 10, integer: true })
    ).toThrow(CssValueError);
  });
});

describe("validateFontStack — descriptor-owned font-family stacks", () => {
  test.each([
    "sans-serif",
    "system-ui, sans-serif",
    '"Segoe UI", system-ui, sans-serif',
    "'Helvetica Neue', Arial, sans-serif",
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif'
  ])("accepts the safe stack %p unchanged", (stack) => {
    expect(validateFontStack(stack)).toBe(stack);
  });

  test.each([
    "sans-serif; background: url(javascript:alert(1))", // declaration breakout
    '"Segoe UI"} body { display: none', // rule breakout
    "url('data:text/html,<script>')", // url() + angle brackets
    "@import 'evil.css'", // at-rule
    "expression(alert(1))", // legacy expression
    "Segoe/**/UI", // comment
    "family: value", // colon
    "100%", // percent
    "a#b" // hash
  ])("rejects the injection-shaped stack %p", (stack) => {
    expect(() => validateFontStack(stack)).toThrow(CssValueError);
  });

  test("rejects a control character (checked by char code)", () => {
    expect(() => validateFontStack(`Arial${String.fromCharCode(10)}`)).toThrow(
      CssValueError
    );
    expect(() => validateFontStack(`Arial${String.fromCharCode(127)}`)).toThrow(
      CssValueError
    );
  });

  test("rejects unbalanced quotes (an unclosed family name)", () => {
    expect(() => validateFontStack('"Segoe UI, sans-serif')).toThrow(
      CssValueError
    );
    expect(() => validateFontStack("'Helvetica, sans-serif")).toThrow(
      CssValueError
    );
  });

  test("rejects the empty string / non-string / an over-long stack", () => {
    expect(() => validateFontStack("")).toThrow(CssValueError);
    // @ts-expect-error deliberately wrong type
    expect(() => validateFontStack(null)).toThrow(CssValueError);
    expect(() =>
      validateFontStack("a".repeat(MAX_FONT_STACK_LENGTH + 1))
    ).toThrow(CssValueError);
  });
});
