/**
 * ADR-0065 — the `awcms-astro` consumer contract, driven with planted specs.
 *
 * The live check passing proves nothing on its own: the fixture was generated
 * from the current bundle, so of course it matches. What must hold is that the
 * subset rule refuses the changes that break a consumer and accepts the ones
 * that do not — and that the closure reaches SCHEMAS, since a path object is a
 * few lines of `$ref` and every interesting breakage happens behind one.
 */
import { describe, expect, test } from "bun:test";

import {
  buildConsumerContract,
  collectRefs,
  findContractBreaks,
  isAdditiveSuperset
} from "../scripts/api-consumer-contract";

describe("$ref closure", () => {
  const components = {
    schemas: {
      Outer: { properties: { inner: { $ref: "#/components/schemas/Inner" } } },
      Inner: { properties: { leaf: { $ref: "#/components/schemas/Leaf" } } },
      Leaf: { type: "string" },
      Unrelated: { type: "number" }
    }
  };

  test("follows refs transitively", () => {
    // A one-level closure would freeze `Outer` and miss `Leaf` — a half-frozen
    // contract that reads like a whole one.
    const refs = collectRefs(
      { schema: { $ref: "#/components/schemas/Outer" } },
      components
    );

    expect([...refs].sort()).toEqual([
      "#/components/schemas/Inner",
      "#/components/schemas/Leaf",
      "#/components/schemas/Outer"
    ]);
  });

  test("does not drag in unreferenced components", () => {
    const refs = collectRefs(
      { schema: { $ref: "#/components/schemas/Leaf" } },
      components
    );

    expect([...refs]).toEqual(["#/components/schemas/Leaf"]);
  });

  test("a ref cycle terminates", () => {
    const cyclic = {
      schemas: {
        A: { items: { $ref: "#/components/schemas/B" } },
        B: { items: { $ref: "#/components/schemas/A" } }
      }
    };

    expect(
      [...collectRefs({ $ref: "#/components/schemas/A" }, cyclic)].sort()
    ).toEqual(["#/components/schemas/A", "#/components/schemas/B"]);
  });
});

describe("additive-superset rule", () => {
  test("an added optional property passes", () => {
    expect(
      isAdditiveSuperset(
        { a: { type: "string" } },
        {
          a: { type: "string" },
          b: { type: "number" }
        }
      )
    ).toBe(true);
  });

  test("a renamed property fails", () => {
    expect(
      isAdditiveSuperset(
        { a: { type: "string" } },
        { aRenamed: { type: "string" } }
      )
    ).toBe(false);
  });

  test("a retyped property fails", () => {
    expect(
      isAdditiveSuperset({ a: { type: "string" } }, { a: { type: "number" } })
    ).toBe(false);
  });

  test("an added enum value passes, a removed one fails", () => {
    expect(isAdditiveSuperset(["draft"], ["draft", "review"])).toBe(true);
    expect(isAdditiveSuperset(["draft", "review"], ["draft"])).toBe(false);
  });

  test("a removed `required` entry fails", () => {
    // Loosening `required` is source-compatible for a producer and NOT for a
    // consumer that reads the field unconditionally.
    expect(isAdditiveSuperset({ required: ["id"] }, { required: [] })).toBe(
      false
    );
  });
});

describe("contract breaks", () => {
  const frozen = {
    paths: { "/x": { get: { responses: { "200": { description: "ok" } } } } },
    schemas: {},
    components: {
      schemas: { Thing: { properties: { id: { type: "string" } } } }
    }
  };

  test("a deleted path is reported", () => {
    expect(
      findContractBreaks(frozen, { paths: {}, components: frozen.components })
    ).toContain("path /x is gone from the bundle");
  });

  test("a deleted component is reported", () => {
    expect(
      findContractBreaks(frozen, {
        paths: frozen.paths,
        components: { schemas: {} }
      })
    ).toContain("components.schemas.Thing is gone from the bundle");
  });

  test("a deep schema change is reported even when the path is untouched", () => {
    // The case the pre-migration snapshot's path-only comparison would miss.
    const breaks = findContractBreaks(frozen, {
      paths: frozen.paths,
      components: { schemas: { Thing: { properties: { idRenamed: {} } } } }
    });

    expect(breaks).toEqual(["components.schemas.Thing changed non-additively"]);
  });

  test("an unchanged contract reports nothing", () => {
    expect(findContractBreaks(frozen, frozen)).toEqual([]);
  });
});

describe("building the contract", () => {
  test("a missing consumer path throws rather than silently shrinking the contract", () => {
    // Quietly dropping it would turn "awcms-astro's endpoint was deleted" into a
    // passing check — the exact failure this gate exists to prevent.
    expect(() => buildConsumerContract({ paths: {}, components: {} })).toThrow(
      /is not in openapi/
    );
  });
});

describe("the live contract", () => {
  test("api:consumer-contract:check passes as committed", () => {
    const result = Bun.spawnSync(["bun", "scripts/api-consumer-contract.ts"]);

    expect(result.exitCode).toBe(0);
  });
});
