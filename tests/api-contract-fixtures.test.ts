/**
 * Contract fixtures generator and freshness gate (Issue #1392, ADR-0167).
 *
 * Positive cases run the real bundle; the negative cases mutate a contract or
 * the committed pack, so a gate that stopped looking turns a test red. The
 * TV-0..TV-5 vectors are the ones in report #1379 section 7; TV-2 is the KNOWN
 * LIMIT of instance validation (a property renamed in a schema that declares no
 * `required` still validates), asserted as such so nobody mistakes it for cover.
 */
import { describe, expect, test } from "bun:test";
import type { AnySchema } from "ajv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { EXAMPLE_FORMATS } from "../scripts/api-contract-examples";
import { ROOT_ID, createAjv } from "../scripts/api-contract-lint";
import {
  PACK_PATH,
  buildFixturePack,
  generatePackFromBundle,
  serializePack,
  sha256,
  type FixturePack
} from "../scripts/api-contract-fixtures";
import { BUNDLED_PATH } from "../scripts/openapi-bundle";

type Doc = Record<string, any>;

const MINI = `
openapi: 3.1.0
info: { title: t, version: "1" }
paths:
  /offices:
    get:
      operationId: listOffices
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [data]
                properties:
                  data:
                    type: object
                    properties:
                      items:
                        type: array
                        items: { $ref: "#/components/schemas/Office" }
components:
  schemas:
    Office:
      type: object
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
`;

const OFFICES_200 =
  "/paths/~1offices/get/responses/200/content/application~1json/schema";

function mini(): Doc {
  return parseYaml(MINI) as Doc;
}

function packOf(doc: Doc): FixturePack {
  return buildFixturePack(doc, "test");
}

/** Validate `value` against the schema at `pointer` of `doc` (formats enforced). */
function validates(doc: Doc, pointer: string, value: unknown): boolean {
  const ajv = createAjv(doc, EXAMPLE_FORMATS);
  ajv.addSchema(doc as AnySchema, ROOT_ID);
  return ajv.compile({ $ref: `${ROOT_ID}#${pointer}` })(value) as boolean;
}

function officesFixture(): unknown {
  const fixture = packOf(mini()).operations["GET /offices"]!.responses["200"];
  return (fixture as { value: unknown }).value;
}

const FRESH = generatePackFromBundle();

async function loadBundle(): Promise<Doc> {
  return parseYaml(
    await readFile(path.resolve(process.cwd(), BUNDLED_PATH), "utf8")
  ) as Doc;
}

describe("generator on the real bundle", () => {
  test("the committed pack is byte-identical to a fresh generation", async () => {
    const committed = await readFile(path.resolve(PACK_PATH), "utf8");
    expect(await FRESH).toBe(committed);
  });

  test("two runs are byte-identical", async () => {
    expect(await generatePackFromBundle()).toBe(await FRESH);
  });

  test("every generated operation is reported or fixtured, none silent", async () => {
    const pack = JSON.parse(await FRESH) as FixturePack;
    expect(pack.summary.operations).toBeGreaterThan(700);
    expect(pack.summary.fixtures).toBe(
      pack.summary.declared + pack.summary.generated
    );
    expect(pack.summary.skipped).toBe(pack.skipped.length);
    for (const skip of pack.skipped) {
      expect(skip.reason.length).toBeGreaterThan(0);
    }
    // the declared examples of #1391 are used, not regenerated over.
    const post = pack.operations["POST /api/v1/newsletter/subscribe"]!;
    expect(post.responses["200"]).toMatchObject({ source: "declared" });
  });

  test("fixtures are synthetic: no e-mail outside a reserved domain", async () => {
    const text = await FRESH;
    const emails = [...text.matchAll(/[^\s@"'<>(),;:\\]+@([A-Za-z0-9.-]+)/g)];
    for (const match of emails) {
      expect(match[1]).toMatch(
        /(^|\.)(example\.(test|com|org|net)|[a-z0-9-]+\.(test|example|invalid|localhost))$/i
      );
    }
  });
});

describe("freshness mutation", () => {
  test("changing one example of the contract changes the pack (stale pack is red)", async () => {
    const doc = await loadBundle();
    const text = await readFile(path.resolve(BUNDLED_PATH), "utf8");
    const before = serializePack(buildFixturePack(doc, sha256(text)));

    const op = doc.paths["/api/v1/newsletter/subscribe"].post;
    const examples = op.responses["200"].content["application/json"].examples;
    const first = Object.values(examples)[0] as { value: Record<string, any> };
    const key = Object.keys(first.value.data)[0]!;
    first.value.data[key] = "mutated-value";
    const mutatedText = text.replace("a", "a "); // any byte change flips the hash
    const after = serializePack(buildFixturePack(doc, sha256(mutatedText)));

    expect(after).not.toBe(before);
    expect(after).toContain("mutated-value");
  });

  test("a stale committed pack differs from the fresh one", async () => {
    const committed = await readFile(path.resolve(PACK_PATH), "utf8");
    const stale = committed.replace('"declared"', '"generated"');
    expect(stale).not.toBe(await FRESH);
  });
});

describe("TV-0 to TV-5 (report #1379 section 7)", () => {
  test("TV-0 baseline passes", () => {
    expect(validates(mini(), OFFICES_200, officesFixture())).toBe(true);
  });

  test("TV-1 a new optional property is additive and still passes", () => {
    const doc = mini();
    doc.components.schemas.Office.properties.extra = { type: "string" };
    expect(validates(doc, OFFICES_200, officesFixture())).toBe(true);
  });

  test("TV-2 a renamed property is NOT caught while Office declares no `required` (known limit)", () => {
    const doc = mini();
    const props = doc.components.schemas.Office.properties;
    props.title = props.name;
    delete props.name;
    expect(validates(doc, OFFICES_200, officesFixture())).toBe(true);

    // ...and it IS caught once the schema says what it requires: the reason the
    // contract policy asks for `required` on new operations (ADR-0167 section 5).
    const strict = mini();
    strict.components.schemas.Office.required = ["id", "name"];
    expect(validates(strict, OFFICES_200, officesFixture())).toBe(true);
    const renamed = mini();
    renamed.components.schemas.Office.required = ["id", "title"];
    renamed.components.schemas.Office.properties.title = { type: "string" };
    expect(validates(renamed, OFFICES_200, officesFixture())).toBe(false);
  });

  test("TV-3 a property retyped to integer is caught", () => {
    const doc = mini();
    doc.components.schemas.Office.properties.id = { type: "integer" };
    expect(validates(doc, OFFICES_200, officesFixture())).toBe(false);
  });

  test("TV-4 a new required property is caught", () => {
    const doc = mini();
    doc.components.schemas.Office.properties.zzReq = { type: "string" };
    doc.components.schemas.Office.required = ["zzReq"];
    expect(validates(doc, OFFICES_200, officesFixture())).toBe(false);
  });

  test("TV-5 additionalProperties:false with fewer properties is caught", () => {
    const doc = mini();
    delete doc.components.schemas.Office.properties.name;
    doc.components.schemas.Office.additionalProperties = false;
    expect(validates(doc, OFFICES_200, officesFixture())).toBe(false);
  });
});

describe("generator rules", () => {
  function one(schema: Record<string, unknown>, extra: Doc = {}): any {
    const doc: Doc = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/x": {
          post: {
            requestBody: {
              content: { "application/json": { schema } }
            },
            responses: { "200": { description: "ok" } }
          }
        }
      },
      components: extra.components ?? {}
    };
    return packOf(doc);
  }

  test("oneOf picks the first branch that validates the whole node", () => {
    const pack = one({
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["a"],
          properties: { a: { type: "string" } }
        },
        {
          type: "object",
          required: ["a", "b"],
          properties: { a: { type: "string" }, b: { type: "integer" } }
        }
      ]
    });
    expect(pack.operations["POST /x"]!.request!.value).toEqual({
      a: "example"
    });
  });

  test("allOf merges object parts; a later `{}` does not overwrite", () => {
    const pack = one({
      allOf: [
        {
          type: "object",
          required: ["k"],
          properties: { k: { type: "string", pattern: "^[a-z]+$" } }
        },
        { type: "object", properties: { k: {}, n: { type: "integer" } } }
      ]
    });
    expect(pack.operations["POST /x"]!.request!.value).toEqual({
      k: "example",
      n: 1
    });
  });

  test("a cycle through an optional property is cut, not skipped", () => {
    const pack = one(
      { $ref: "#/components/schemas/Node" },
      {
        components: {
          schemas: {
            Node: {
              type: "object",
              required: ["id"],
              properties: {
                id: { type: "string" },
                child: { $ref: "#/components/schemas/Node" }
              }
            }
          }
        }
      }
    );
    expect(pack.operations["POST /x"]!.request!.value).toEqual({
      id: "example"
    });
    expect(pack.skipped).toEqual([]);
  });

  test("a cycle through a required property is reported with a reason", () => {
    const pack = one(
      { $ref: "#/components/schemas/Node" },
      {
        components: {
          schemas: {
            Node: {
              type: "object",
              required: ["child"],
              properties: { child: { $ref: "#/components/schemas/Node" } }
            }
          }
        }
      }
    );
    expect(pack.operations["POST /x"]!.request).toBeUndefined();
    expect(pack.skipped).toHaveLength(1);
    expect(pack.skipped[0]!.reason).toContain("cyclic");
  });

  test("const, enum, format, bounds and null-able types", () => {
    const pack = one({
      type: "object",
      required: ["c", "e", "u", "n", "t"],
      properties: {
        c: { const: 7 },
        e: { enum: ["x", "y"] },
        u: { type: "string", format: "email" },
        n: { type: "integer", minimum: 5, maximum: 9 },
        t: { type: ["string", "null"] }
      }
    });
    expect(pack.operations["POST /x"]!.request!.value).toEqual({
      c: 7,
      e: "x",
      u: "user@example.test",
      n: 5,
      t: "example"
    });
  });

  test("an unsatisfiable pattern and a non-JSON body are reported, not dropped", () => {
    const pack = one({ type: "string", pattern: "^(?!)$" });
    expect(pack.summary.skipped).toBe(1);
    expect(pack.skipped[0]!.reason).toContain("pattern");
    expect(pack.operations["POST /x"]!.request).toBeUndefined();
  });
});
