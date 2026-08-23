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

import { existsSync, readdirSync } from "node:fs";

import {
  buildConsumerContract,
  collectRefs,
  COMMITTED_PATHS,
  CONSUMED_PATHS,
  CONSUMER_PATHS,
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

/**
 * CONSUMED vs COMMITTED (assessment §9.5).
 *
 * The first version of this contract froze six paths because it was derived by
 * grepping the neighbour repo for `/api/v1/` **without stripping comments**.
 * Three of the six were prose: a type docblock, a comment explaining why the
 * build deliberately does NOT call `/auth/session`, and an error message
 * telling a human how to mint a credential.
 *
 * The neighbour has the authoritative answer and gates it —
 * `tests/kontrak-awcms.test.mjs` there asserts "the source calls exactly three
 * surfaces", comments removed first, bound two-ways to a marker block.
 *
 * These tests cannot read that repo. What they CAN do is make the two lists
 * unable to drift apart quietly: pin the count that the neighbour also pins, so
 * a fourth consumed surface here has to be a deliberate edit in both places.
 */
describe("consumed vs committed", () => {
  test("exactly ten surfaces are CONSUMED — the same number the neighbour's gate asserts", () => {
    // If this fails, one of two things happened, and they need opposite fixes:
    //   - awcms-astro started (or stopped) calling a surface -> update both
    //     this list and the marker block in that repo, in the same change;
    //   - someone added a surface here that nobody calls -> it belongs in
    //     COMMITTED_PATHS with the ADR that promises it, or nowhere.
    //
    // The fourth arrived by exactly the route this split exists to make
    // possible: `/api/v1/site-profile/composed` was frozen as COMMITTED in
    // #645, BEFORE anything called it, and moved here once
    // `ahliweb/awcms-astro#61` made the call real. A promise and a dependency
    // both deserve stability and fail differently, and the distinction only
    // survives if entries actually move.
    //
    // `/api/v1/blog/terms` is the fifth and took the identical path: COMMITTED
    // in #650 with ADR-0104, moved here when `ahliweb/awcms-astro#66` built the
    // category and tag archives on it.
    //
    // The sixth and seventh, `/blog/menus` and `/blog/widgets`, took the same
    // path with one extra step in front of it: they could not be frozen at all
    // until #652 gave their responses an actual schema. Freezing an array of
    // bare `object` would have added a path to this list that no change could
    // ever break — a contract entry with no contract in it.
    //
    // The eighth and ninth, `/site-search/query` and `/suggest`, took the same
    // path (COMMITTED in #681 with ADR-0107, moved here when that repo published
    // its search box) and BROKE ITS PREMISE: they are not called by a build at
    // all. They run in the READER's browser, anonymously and cross-origin.
    //
    // That is invisible from here — both are `GET`s against this API, and the
    // neighbour's gate extracts string literals from `src/` without knowing who
    // executes them — so it is written down rather than left to be inferred. It
    // decides what breaking one costs: a shape change on the seven above reddens
    // a build somebody is watching, while a shape change on these two fails in a
    // stranger's browser, on a site published weeks ago that will not be rebuilt
    // on account of it.
    //
    // The tenth, `/analytics/collect`, is in that same reader-browser class and
    // breaks its rule again: it is the only consumed path that must carry a
    // HEADER. `security.checkOrigin` refuses a cross-origin POST whose content
    // type is form-like, so only `application/json` gets through — which is what
    // the `OPTIONS` handler from #637 exists for. Three reader-browser paths,
    // two opposite header rules, and no way to tell them apart from this side.
    expect(Object.keys(CONSUMED_PATHS)).toEqual([
      "/api/v1/blog/posts",
      "/api/v1/media/objects",
      "/api/v1/media/public-origin",
      "/api/v1/site-profile/composed",
      "/api/v1/blog/terms",
      "/api/v1/blog/menus",
      "/api/v1/blog/widgets",
      "/api/v1/site-search/query",
      "/api/v1/site-search/suggest",
      "/api/v1/analytics/collect"
    ]);
  });

  test("every COMMITTED path names an ADR that resolves to a real file", () => {
    const adrFiles = readdirSync("docs/adr");

    for (const [path, reason] of Object.entries(COMMITTED_PATHS)) {
      const cited = reason.match(/ADR-(\d{4})/);

      expect(
        cited,
        `${path} must cite the ADR that promises it`
      ).not.toBeNull();

      const prefix = `${cited![1]}-`;
      const resolved = adrFiles.some((file) => file.startsWith(prefix));

      expect(
        resolved,
        `${path} cites ADR-${cited![1]}, which has no file`
      ).toBe(true);
    }
  });

  test("the two lists are disjoint, and together they are the frozen set", () => {
    for (const path of Object.keys(COMMITTED_PATHS)) {
      expect(CONSUMED_PATHS).not.toHaveProperty(path);
    }

    expect(Object.keys(CONSUMER_PATHS).sort()).toEqual(
      [...Object.keys(CONSUMED_PATHS), ...Object.keys(COMMITTED_PATHS)].sort()
    );
  });

  test("`/api/v1/blog/posts/{id}` is deliberately in NEITHER list", () => {
    // awcms-astro ADR-0018 removed the per-id fetch — posts render from the
    // `view=full` traversal. It is not consumed, and no ADR here promises it,
    // so freezing it would bind this repo to a shape with no reader.
    //
    // Written as an assertion rather than a comment because the entry was
    // present for a whole release with the reason "single-post rendering",
    // describing a call that never happened. The next person to re-add it
    // should have to delete a test that says why.
    expect(CONSUMER_PATHS).not.toHaveProperty("/api/v1/blog/posts/{id}");
    expect(
      existsSync("docs/adr/0065-awcms-astro-consumer-contract-is-frozen.md")
    ).toBe(true);
  });
});
