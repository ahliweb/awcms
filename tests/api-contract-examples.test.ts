/**
 * Contract example gate (Issue #1391, ADR-0167). The positive cases run the real
 * bundle; the negative cases CORRUPT one field of a real example (and a few
 * synthetic contracts), so a gate that stopped looking -- a location no longer
 * walked, formats switched off, nullable ignored -- turns a test red instead of
 * staying green.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  collectExamples,
  findNonSyntheticEmails,
  validateContractExamples
} from "../scripts/api-contract-examples";
import { BUNDLED_PATH } from "../scripts/openapi-bundle";

type Doc = Record<string, any>;

async function loadBundle(): Promise<Doc> {
  return parseYaml(
    await readFile(path.resolve(process.cwd(), BUNDLED_PATH), "utf8")
  ) as Doc;
}

function examplesOf(
  doc: Doc,
  route: string,
  method: string,
  status: string
): Record<string, { value: any }> {
  return doc.paths[route][method].responses[status].content["application/json"]
    .examples;
}

const BLOG = "/api/v1/blog/posts";
const NEWSLETTER = "/api/v1/newsletter/subscribe";
const BOOKING = "/api/v1/booking/policy";

describe("the real bundle", () => {
  test("every example validates against its schema", async () => {
    const result = validateContractExamples(await loadBundle());
    expect(result.failures).toEqual([]);
    expect(result.checked).toBeGreaterThan(20);
  });

  test("the three representative operations carry an example per relevant status", async () => {
    const doc = await loadBundle();
    expect(Object.keys(examplesOf(doc, BLOG, "get", "200")).sort()).toEqual([
      "full",
      "stable_order",
      "summary"
    ]);
    for (const status of ["400", "401", "403"]) {
      expect(
        Object.keys(examplesOf(doc, BLOG, "get", status)).length
      ).toBeGreaterThan(0);
    }
    expect(
      Object.keys(examplesOf(doc, NEWSLETTER, "post", "400")).length
    ).toBeGreaterThan(0);
    for (const status of ["401", "403"]) {
      expect(
        Object.keys(examplesOf(doc, BOOKING, "put", status)).length
      ).toBeGreaterThan(0);
    }
    expect(Object.keys(examplesOf(doc, NEWSLETTER, "post", "200"))).toEqual([
      "neutral"
    ]);
    expect(Object.keys(examplesOf(doc, NEWSLETTER, "post", "429"))).toEqual([
      "rate_limited"
    ]);
    expect(Object.keys(examplesOf(doc, BOOKING, "put", "200"))).toEqual([
      "configured"
    ]);
    for (const status of ["400", "409", "422"]) {
      expect(
        Object.keys(examplesOf(doc, BOOKING, "put", status)).length
      ).toBeGreaterThan(0);
    }
  });

  test("the newsletter 200 example is neutral: one outcome, no address, no state", async () => {
    const doc = await loadBundle();
    const examples = examplesOf(doc, NEWSLETTER, "post", "200");
    // Anti-enumeration: there is exactly ONE success body, and it names neither
    // an address nor a status such as `already_subscribed`.
    expect(Object.keys(examples)).toHaveLength(1);
    const body = examples.neutral!.value;
    expect(Object.keys(body.data)).toEqual(["message"]);
    const text = JSON.stringify(body).toLowerCase();
    for (const word of [
      "@",
      "already",
      "pending",
      "suppress",
      "unsubscrib",
      "not found",
      "new subscriber"
    ]) {
      expect(text).not.toContain(word);
    }
  });

  test("the blog list examples reflect the conditional shape (summary vs full)", async () => {
    const doc = await loadBundle();
    const examples = examplesOf(doc, BLOG, "get", "200");
    const summaryRow = examples.summary!.value.data.posts[0];
    const fullRow = examples.full!.value.data.posts[0];
    expect("contentJson" in summaryRow).toBe(false);
    expect("nextCursor" in examples.summary!.value.data).toBe(false);
    expect(typeof examples.stable_order!.value.data.nextCursor).toBe("string");
    expect(Array.isArray(fullRow.termIds)).toBe(true);
    expect("contentJson" in fullRow).toBe(true);
  });
});

describe("mutating one field of a real example turns the gate red", () => {
  const mutations: [string, (doc: Doc) => void][] = [
    [
      "a required field of the summary row is dropped",
      (doc) => {
        delete examplesOf(doc, BLOG, "get", "200").summary!.value.data.posts[0]
          .tenantId;
      }
    ],
    [
      "a feed field of the full row is dropped (oneOf must not let it pass as a summary)",
      (doc) => {
        delete examplesOf(doc, BLOG, "get", "200").full!.value.data.posts[0]
          .termIds;
      }
    ],
    [
      "an enum value is outside its enum",
      (doc) => {
        examplesOf(
          doc,
          BLOG,
          "get",
          "200"
        ).summary!.value.data.posts[0].status = "live";
      }
    ],
    [
      "a uuid is malformed",
      (doc) => {
        examplesOf(doc, BLOG, "get", "200").full!.value.data.posts[0].id = "x";
      }
    ],
    [
      "the neutral message is removed",
      (doc) => {
        delete examplesOf(doc, NEWSLETTER, "post", "200").neutral!.value.data
          .message;
      }
    ],
    [
      "a real e-mail domain appears",
      (doc) => {
        examplesOf(doc, NEWSLETTER, "post", "200").neutral!.value.data.message =
          "sent to budi@gmail.com";
      }
    ],
    [
      "the booking `replayed` flag is dropped",
      (doc) => {
        delete examplesOf(doc, BOOKING, "put", "200").configured!.value.data
          .replayed;
      }
    ],
    [
      "a booking value leaves its range",
      (doc) => {
        examplesOf(
          doc,
          BOOKING,
          "put",
          "200"
        ).configured!.value.data.policy.maxHoldSeconds = 5;
      }
    ],
    [
      "a date-time is not a date-time",
      (doc) => {
        examplesOf(
          doc,
          BOOKING,
          "put",
          "200"
        ).configured!.value.data.updatedAt = "yesterday";
      }
    ],
    [
      "an error example loses its required `error.code`",
      (doc) => {
        delete examplesOf(doc, BOOKING, "put", "401").auth_required!.value.error
          .code;
      }
    ]
  ];

  for (const [name, mutate] of mutations) {
    test(name, async () => {
      const doc = await loadBundle();
      mutate(doc);
      const result = validateContractExamples(doc);
      expect(result.failures.length).toBeGreaterThan(0);
    });
  }
});

describe("synthetic contracts", () => {
  function contract(extra: Doc): Doc {
    return {
      openapi: "3.1.0",
      info: { title: "t", version: "1.0.0" },
      paths: {
        "/things": {
          get: {
            operationId: "getThings",
            parameters: [
              {
                name: "limit",
                in: "query",
                schema: { type: "integer", minimum: 1 },
                example: 5
              }
            ],
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Thing" },
                    ...extra
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Thing: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string", format: "uuid" },
              note: { type: "string", nullable: true },
              when: { type: "string", format: "date-time" }
            }
          }
        }
      }
    };
  }
  const good = "3f6b1d52-8a4e-4c1b-9d7e-2b5f0a9c4e11";

  test("a valid `example` and a valid named example both pass", () => {
    const result = validateContractExamples(
      contract({
        example: { id: good, note: null },
        examples: { one: { value: { id: good, when: "2026-11-22T09:30:00Z" } } }
      })
    );
    expect(result.failures).toEqual([]);
    // media-type example + named example + the parameter example
    expect(result.checked).toBe(3);
  });

  test("an invalid media-type `example` fails", () => {
    expect(
      validateContractExamples(contract({ example: { id: "nope" } })).failures
    ).toHaveLength(1);
  });

  test("an invalid named example fails and names its pointer", () => {
    const [failure] = validateContractExamples(
      contract({ examples: { broken: { value: { note: "x" } } } })
    ).failures;
    expect(failure!.pointer).toContain("/examples/broken/value");
  });

  test("an invalid parameter example fails", () => {
    const doc = contract({});
    doc.paths["/things"].get.parameters[0].example = 0;
    expect(validateContractExamples(doc).failures).toHaveLength(1);
  });

  test("an invalid schema-level example fails", () => {
    const doc = contract({});
    doc.components.schemas.Thing.properties.id.example = "not-a-uuid";
    expect(validateContractExamples(doc).failures).toHaveLength(1);
  });

  test("a `$ref` example is resolved, and an invalid one fails", () => {
    const doc = contract({
      examples: { shared: { $ref: "#/components/examples/Bad" } }
    });
    doc.components.examples = { Bad: { value: { id: "nope" } } };
    expect(validateContractExamples(doc).failures).toHaveLength(1);
  });

  test("a property NAMED `example` is not mistaken for the keyword", () => {
    const doc = contract({});
    doc.components.schemas.Thing.properties.example = { type: "string" };
    expect(validateContractExamples(doc).failures).toEqual([]);
    expect(collectExamples(doc).map((c) => c.pointer)).not.toContain(
      "/components/schemas/Thing/properties/example"
    );
  });
});

describe("synthetic data only", () => {
  test("reserved domains pass, real ones are reported", () => {
    expect(
      findNonSyntheticEmails({
        a: "user@example.test",
        b: ["x@mail.example.com", "y@host.invalid"],
        c: "Contact: z@example.org."
      })
    ).toEqual([]);
    expect(
      findNonSyntheticEmails({ a: "someone@gmail.com", b: "x@corp.co.id" })
    ).toEqual(["someone@gmail.com", "x@corp.co.id"]);
  });
});
