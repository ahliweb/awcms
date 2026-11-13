/**
 * Issue #1276: opt-in `numericText` for `csvCellForWrite`. A string that is only
 * an optionally signed decimal is written as is (negative money carried as
 * `numeric(14,2)` text); everything else is neutralised exactly as before.
 */
import { describe, expect, test } from "bun:test";

import { csvCellForWrite } from "../src/lib/security/csv-formula";

const opt = { numericText: true };

describe("csvCellForWrite numericText", () => {
  test("a signed decimal string is written as is", () => {
    expect(csvCellForWrite("-12.50", opt)).toBe("-12.50");
    expect(csvCellForWrite("+5", opt)).toBe("+5");
    expect(csvCellForWrite("-.5", opt)).toBe("-.5");
    expect(csvCellForWrite("12.50", opt)).toBe("12.50");
    expect(csvCellForWrite("-12.50", { ...opt, reversible: true })).toBe(
      "-12.50"
    );
  });

  test("anything else is neutralised exactly as without the option", () => {
    for (const text of [
      "-1+cmd",
      "-1e5",
      "-12.50\n=cmd",
      "-12.50\n",
      " -12.50",
      "-12.50 ",
      "\t-12.50",
      "\r-12.50",
      "-",
      "--5",
      "-1.",
      "=1+1",
      "-１２"
    ]) {
      const written = csvCellForWrite(text, opt);

      expect(written).toBe(csvCellForWrite(text));
      expect(written.replace(/^"/, "").startsWith("'")).toBe(true);
    }
  });

  test("a non-string value and the default mode are unchanged", () => {
    expect(csvCellForWrite(-5, opt)).toBe("-5");
    expect(csvCellForWrite("-12.50")).toBe("'-12.50");
    expect(csvCellForWrite("-12.50", { reversible: true })).toBe("'-12.50");
  });
});
