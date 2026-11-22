/**
 * Contract lint gate (Issue #1390, ADR-0167). The positive case runs the real
 * bundle; the negative cases are deliberately broken synthetic contracts, so a
 * gate that went blind (strictness switched off, a location no longer walked)
 * turns a test red instead of staying green.
 */
import { describe, expect, test } from "bun:test";

import {
  lintOpenApiContract,
  runContractLint
} from "../scripts/api-contract-lint";

type Doc = Record<string, unknown>;

function contract(schemas: Record<string, unknown>): Doc {
  return {
    openapi: "3.1.0",
    info: { title: "t", version: "1.0.0" },
    paths: {
      "/things/{id}": {
        get: {
          operationId: "getThing",
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Thing" }
                }
              }
            },
            "404": { $ref: "#/components/responses/NotFound" }
          }
        }
      }
    },
    components: {
      schemas: {
        Thing: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } }
        },
        Err: { type: "object", properties: { code: { type: "string" } } },
        ...schemas
      },
      responses: {
        NotFound: {
          description: "nope",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/Err" } }
          }
        }
      }
    }
  };
}

describe("api:contract:lint", () => {
  test("the real bundle compiles with no failure", async () => {
    const result = await runContractLint();
    expect(result.failures).toEqual([]);
    expect(result.compiled).toBeGreaterThan(1000);
  });

  test("a sound contract with OpenAPI annotations and x- extensions passes", () => {
    const doc = contract({
      Pet: {
        type: "object",
        discriminator: { propertyName: "kind" },
        xml: { name: "pet" },
        externalDocs: { url: "https://example.test" },
        example: { kind: "cat" },
        "x-awcms-note": "vendor extension",
        properties: {
          kind: { type: "string" },
          tag: { type: ["integer", "null"], format: "int64" }
        },
        oneOf: [{ $ref: "#/components/schemas/Thing" }]
      }
    });
    expect(lintOpenApiContract(doc).failures).toEqual([]);
  });

  test("properties: null fails and names the schema pointer", () => {
    const doc = contract({ Broken: { type: "object", properties: null } });
    const { failures } = lintOpenApiContract(doc);
    expect(failures.map((f) => f.pointer)).toContain(
      "/components/schemas/Broken"
    );
  });

  test("nullable without a type fails", () => {
    const doc = contract({
      Loose: { nullable: true, properties: { a: { type: "string" } } }
    });
    const { failures } = lintOpenApiContract(doc);
    const hit = failures.find((f) => f.pointer === "/components/schemas/Loose");
    expect(hit?.message).toContain("nullable");
  });

  test("a dangling $ref in a component schema fails", () => {
    const doc = contract({
      Dangling: { $ref: "#/components/schemas/Missing" }
    });
    const { failures } = lintOpenApiContract(doc);
    expect(
      failures.some((f) => f.pointer === "/components/schemas/Dangling")
    ).toBe(true);
  });

  test("a broken schema inside an operation response names the operation and the pointer", () => {
    const doc = contract({});
    (doc.paths as Doc)["/boom"] = {
      post: {
        operationId: "postBoom",
        responses: {
          "201": {
            description: "created",
            content: {
              "application/json": {
                schema: { type: "object", properties: null }
              }
            }
          }
        }
      }
    };
    const { failures } = lintOpenApiContract(doc);
    const hit = failures.find((f) => f.where.startsWith("POST /boom"));
    expect(hit?.where).toBe("POST /boom -> 201");
    expect(hit?.pointer).toBe(
      "/paths/~1boom/post/responses/201/content/application~1json/schema"
    );
  });

  test("a broken schema reached only through components.responses (error response) fails", () => {
    const doc = contract({});
    ((doc.components as Doc).responses as Doc).NotFound = {
      description: "nope",
      content: {
        "application/json": { schema: { type: "object", properties: null } }
      }
    };
    const { failures } = lintOpenApiContract(doc);
    expect(failures.some((f) => f.where === "GET /things/{id} -> 404")).toBe(
      true
    );
  });

  test("a broken request body fails", () => {
    const doc = contract({});
    (doc.paths as Doc)["/in"] = {
      put: {
        operationId: "putIn",
        requestBody: {
          content: {
            "application/json": { schema: { type: "object", required: "id" } }
          }
        },
        responses: { "204": { description: "none" } }
      }
    };
    const { failures } = lintOpenApiContract(doc);
    expect(failures.some((f) => f.where === "PUT /in")).toBe(true);
  });

  test("a response $ref into components.responses that does not exist fails", () => {
    const doc = contract({});
    const get = ((doc.paths as Doc)["/things/{id}"] as Doc).get as {
      responses: Doc;
    };
    get.responses["500"] = { $ref: "#/components/responses/Gone" };
    const { failures } = lintOpenApiContract(doc);
    expect(failures.some((f) => f.where === "GET /things/{id} -> 500")).toBe(
      true
    );
  });

  test("strictness is not switched off: unknown keyword, unknown format, 3.0-style exclusiveMinimum", () => {
    const doc = contract({
      A: { type: "object", propertyz: {} },
      B: { type: "string", format: "no-such-format" },
      C: { type: "number", minimum: 1, exclusiveMinimum: true }
    });
    const pointers = lintOpenApiContract(doc).failures.map((f) => f.pointer);
    expect(pointers).toContain("/components/schemas/A");
    expect(pointers).toContain("/components/schemas/B");
    expect(pointers).toContain("/components/schemas/C");
  });
});
