/**
 * The tax-definition editor's model (Issue #901): it must map rows to the JSON
 * the endpoint takes WITHOUT altering a rate, and must decline — not guess — a
 * document it cannot show faithfully. Pure.
 */
import { describe, expect, test } from "bun:test";

import {
  initialModel,
  loadEditableModel,
  parseModel,
  serializeModel
} from "../src/lib/ui/tax-definition-model";
import { validateTaxDefinition } from "../src/modules/tax/domain/tax-validation";

const DOC = {
  categories: [
    { code: "general", name: "General" },
    { code: "books", name: "Books", description: "Printed books" }
  ],
  rules: [
    {
      categoryCode: "general",
      treatment: "taxable",
      components: [
        { code: "vat", name: "VAT", rate: "7.50", basis: "net" },
        { code: "levy", name: "Levy", rate: "0.10", basis: "cumulative" }
      ]
    },
    { categoryCode: "books", treatment: "zero_rated", components: [] },
    { categoryCode: null, treatment: "exempt", components: [] }
  ]
};

describe("serializeModel / parseModel", () => {
  test("round-trips a definition and keeps every rate an exact string", () => {
    const model = parseModel(JSON.stringify(DOC));
    expect(model).not.toBeNull();
    expect(JSON.parse(serializeModel(model!))).toEqual(DOC);
  });

  test("the serialised document is accepted by the server validator", () => {
    const model = parseModel(JSON.stringify(DOC))!;
    const collector = { errors: [] as unknown[] };
    const accepted = validateTaxDefinition(
      JSON.parse(serializeModel(model)),
      collector as never
    );
    expect(collector.errors).toEqual([]);
    expect(accepted).not.toBeNull();
  });

  test("a non-taxable rule never carries components, even if the row had some", () => {
    const model = parseModel(JSON.stringify(DOC))!;
    model.rules[2]!.components = [
      { code: "x", name: "X", rate: "1", basis: "net" }
    ];
    expect(JSON.parse(serializeModel(model)).rules[2].components).toEqual([]);
  });

  test("an empty description is omitted, a fallback category becomes null", () => {
    const out = JSON.parse(serializeModel(initialModel()));
    expect(out.rules[0].categoryCode).toBeNull();
    const model = parseModel(JSON.stringify(DOC))!;
    model.categories[0]!.description = "  ";
    expect(JSON.parse(serializeModel(model)).categories[0]).not.toHaveProperty(
      "description"
    );
  });

  test("declines what it cannot show faithfully", () => {
    for (const text of [
      "not json",
      "[]",
      JSON.stringify({ categories: [], rules: [], extra: 1 }),
      JSON.stringify({ categories: [{ code: 1, name: "x" }], rules: [] }),
      JSON.stringify({
        categories: [],
        rules: [
          {
            categoryCode: null,
            treatment: "taxable",
            components: [{ code: "a", name: "A", rate: 7.5, basis: "net" }]
          }
        ]
      }),
      JSON.stringify({
        categories: [],
        rules: [{ categoryCode: null, treatment: "taxable", surprise: true }]
      })
    ]) {
      expect(parseModel(text)).toBeNull();
    }
  });
});

describe("loadEditableModel (the editor's overwrite guard)", () => {
  test("blank text starts a fresh model", () => {
    expect(loadEditableModel("  \n")).toEqual(initialModel());
  });

  test("a showable document loads", () => {
    expect(loadEditableModel(JSON.stringify(DOC))).not.toBeNull();
  });

  test("unparseable or unshowable JSON is null, so the rows stay hidden", () => {
    expect(loadEditableModel("{ not json")).toBeNull();
    expect(loadEditableModel('{"categories":[],"rules":[],"x":1}')).toBeNull();
  });
});
