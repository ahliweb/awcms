/**
 * The `/admin/procurement` request-body model (Issue #905). Pure.
 */
import { describe, expect, test } from "bun:test";

import {
  buildDocumentBody,
  buildLine,
  calendarDateOrEmpty,
  isBlankLine,
  missingLineFields,
  isSupplierDocumentMode,
  parseLabelList,
  type DocumentFormFields,
  type LineFields
} from "../src/lib/ui/procurement-document-model";

const line: LineFields = {
  itemType: " product ",
  itemRef: "sku-1",
  sku: "SKU-1",
  itemName: "Widget",
  unitCode: "unit",
  quantity: " 2.50 ",
  unitCost: "10"
};

const base: DocumentFormFields = {
  mode: "receive",
  supplierId: "s-1",
  locationId: "l-1",
  sourceLocationId: "l-0",
  externalReference: "",
  documentDate: "",
  notes: "",
  currencyCode: "",
  lines: [line]
};

describe("modes", () => {
  test("receipts and supplier returns are the supplier modes", () => {
    expect(isSupplierDocumentMode("receive")).toBe(true);
    expect(isSupplierDocumentMode("supplier_return")).toBe(true);
    expect(isSupplierDocumentMode("requisition")).toBe(false);
    expect(isSupplierDocumentMode("transfer")).toBe(false);
  });
});

describe("buildDocumentBody", () => {
  test("a supplier mode sends the supplier and never a source location", () => {
    const body = buildDocumentBody(base);
    expect(body.supplierId).toBe("s-1");
    expect("sourceLocationId" in body).toBe(false);
  });

  test("a location mode sends the source location and never a supplier", () => {
    const body = buildDocumentBody({ ...base, mode: "transfer" });
    expect(body.sourceLocationId).toBe("l-0");
    expect("supplierId" in body).toBe(false);
  });

  test("blank optional fields are omitted, not sent empty", () => {
    const body = buildDocumentBody(base);
    for (const key of [
      "externalReference",
      "documentDate",
      "notes",
      "currencyCode"
    ]) {
      expect(key in body).toBe(false);
    }
  });

  test("optional fields are trimmed and the currency upper-cased", () => {
    const body = buildDocumentBody({
      ...base,
      externalReference: " PO-1 ",
      documentDate: "2026-10-05",
      notes: " n ",
      currencyCode: "idr"
    });
    expect(body.externalReference).toBe("PO-1");
    expect(body.documentDate).toBe("2026-10-05");
    expect(body.notes).toBe("n");
    expect(body.currencyCode).toBe("IDR");
  });

  test("never carries a lifecycle state or a total", () => {
    const body = buildDocumentBody(base);
    expect("status" in body).toBe(false);
    expect("totalCost" in body).toBe(false);
  });
});

describe("buildLine", () => {
  test("quantities stay exact decimal strings and a blank cost is omitted", () => {
    const built = buildLine({ ...line, unitCost: " ", unitCode: "" });
    expect(built.quantity).toBe("2.50");
    expect(typeof built.quantity).toBe("string");
    expect("unitCost" in built).toBe(false);
    expect("unitCode" in built).toBe(false);
    expect(built.itemType).toBe("product");
  });
});

describe("isBlankLine", () => {
  // Exactly what the row template renders: the two pre-filled defaults and
  // nothing the operator typed.
  const untouched: LineFields = {
    itemType: "product",
    itemRef: "",
    sku: "",
    itemName: "",
    unitCode: "unit",
    quantity: "",
    unitCost: ""
  };

  test("an untouched row with the template defaults is blank", () => {
    expect(isBlankLine(untouched)).toBe(true);
    expect(missingLineFields(untouched)).toEqual([]);
  });

  test("any typed field makes it a line", () => {
    expect(isBlankLine({ ...untouched, sku: "x" })).toBe(false);
    expect(isBlankLine({ ...untouched, quantity: "1" })).toBe(false);
    expect(isBlankLine({ ...untouched, unitCost: "5" })).toBe(false);
  });
});

describe("missingLineFields", () => {
  test("a half-filled row names what is missing", () => {
    expect(
      missingLineFields({
        itemType: "product",
        itemRef: "a",
        sku: "",
        itemName: "",
        unitCode: "unit",
        quantity: "",
        unitCost: ""
      })
    ).toEqual(["sku", "itemName", "quantity"]);
  });

  test("a complete row misses nothing", () => {
    expect(missingLineFields(line)).toEqual([]);
  });

  test("a cleared item type on a typed row is reported", () => {
    expect(missingLineFields({ ...line, itemType: " " })).toEqual(["itemType"]);
  });
});

describe("parseLabelList", () => {
  test("splits on commas, trims and drops empties", () => {
    expect(parseLabelList(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(parseLabelList("")).toEqual([]);
  });
});

describe("calendarDateOrEmpty", () => {
  test("accepts a real date and refuses the rest", () => {
    expect(calendarDateOrEmpty("2026-02-28")).toBe("2026-02-28");
    expect(calendarDateOrEmpty("2026-02-30")).toBe("");
    expect(calendarDateOrEmpty("nope")).toBe("");
    expect(calendarDateOrEmpty("")).toBe("");
  });
});
