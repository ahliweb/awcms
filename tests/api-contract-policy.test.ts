/**
 * Contract policy gate for NEW operations (Issue #1395, ADR-0167 section 5).
 *
 * The negative cases are synthetic contracts: a gate that went blind (a rule no
 * longer walked, the baseline ignored) turns a test red instead of staying
 * green. The last block runs the real bundle, the real baseline and the real
 * route files.
 */
import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  MIN_REASON_LENGTH,
  checkContractPolicy,
  createRouteRateLimitProbe,
  type PolicyInputs
} from "../scripts/api-contract-policy";
import {
  CONTRACT_POLICY_BASELINE,
  CONTRACT_POLICY_EXCEPTIONS
} from "../scripts/api-contract-policy-baseline";
import { RATE_LIMIT_HELPER } from "../scripts/lib/route-handler-graph";

type Doc = Record<string, any>;

const GOOD_BODY = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } }
};

function okResponse(overrides: Doc = {}): Doc {
  return {
    description: "ok",
    content: {
      "application/json": {
        schema: GOOD_BODY,
        example: { id: "a" },
        ...overrides
      }
    }
  };
}

function operation(
  id: string,
  responses: Doc = { "200": okResponse() },
  extra: Doc = {}
): Doc {
  return { operationId: id, responses, ...extra };
}

function contract(paths: Record<string, Doc>, components: Doc = {}): Doc {
  return {
    openapi: "3.1.0",
    info: { title: "t", version: "1" },
    paths,
    components
  };
}

const never = () => false;
function inputs(overrides: Partial<PolicyInputs> = {}): PolicyInputs {
  return { baseline: [], exceptions: [], isRateLimited: never, ...overrides };
}
const rules = (r: ReturnType<typeof checkContractPolicy>) =>
  r.violations.map((v) => v.rule);

describe("a compliant new operation passes", () => {
  test("example, required, 3.1 null, no limiter", () => {
    const doc = contract({
      "/a": {
        get: operation("a", {
          "200": okResponse({
            schema: {
              type: "object",
              required: ["id", "note"],
              properties: {
                id: { type: "string" },
                note: { type: ["string", "null"] }
              }
            }
          }),
          "204": { description: "none" }
        })
      }
    });
    const r = checkContractPolicy(doc, inputs());
    expect(r.violations).toEqual([]);
    expect(r.checked).toBe(1);
  });

  test("an explicit empty required list satisfies rule 2", () => {
    const doc = contract({
      "/a": {
        get: operation("a", {
          "200": okResponse({
            schema: {
              type: "object",
              required: [],
              properties: { x: { type: "string" } }
            }
          })
        })
      }
    });
    expect(checkContractPolicy(doc, inputs()).violations).toEqual([]);
  });

  test("examples (plural) on the media type satisfy rule 1", () => {
    const resp = okResponse();
    delete resp.content["application/json"].example;
    resp.content["application/json"].examples = { one: { value: { id: "a" } } };
    const doc = contract({ "/a": { get: operation("a", { "200": resp }) } });
    expect(checkContractPolicy(doc, inputs()).violations).toEqual([]);
  });
});

describe("rule 1: a response example is required", () => {
  test("no example on a 2xx body fails and names the rule", () => {
    const resp = okResponse();
    delete resp.content["application/json"].example;
    const doc = contract({ "/a": { get: operation("a", { "200": resp }) } });
    const r = checkContractPolicy(doc, inputs());
    expect(rules(r)).toEqual(["response-example"]);
    expect(r.violations[0]!.message).toContain("no example");
    expect(r.violations[0]!.operationId).toBe("a");
  });

  test("a schema-level example is not a declared media-type example", () => {
    const resp = okResponse({ schema: { ...GOOD_BODY, example: { id: "a" } } });
    delete resp.content["application/json"].example;
    const doc = contract({ "/a": { get: operation("a", { "200": resp }) } });
    expect(rules(checkContractPolicy(doc, inputs()))).toEqual([
      "response-example"
    ]);
  });

  test("a missing example in a response reached through components.responses fails", () => {
    const resp = okResponse();
    delete resp.content["application/json"].example;
    const doc = contract(
      {
        "/a": {
          get: operation("a", { "200": { $ref: "#/components/responses/R" } })
        }
      },
      { responses: { R: resp } }
    );
    expect(rules(checkContractPolicy(doc, inputs()))).toEqual([
      "response-example"
    ]);
  });

  test("an error response without an example is not checked", () => {
    const doc = contract({
      "/a": {
        get: operation("a", {
          "200": okResponse(),
          "404": {
            description: "x",
            content: { "application/json": { schema: GOOD_BODY } }
          }
        })
      }
    });
    expect(checkContractPolicy(doc, inputs()).violations).toEqual([]);
  });
});

describe("rule 2: a required list is present on object response schemas", () => {
  test("an inline object with properties and no required fails", () => {
    const doc = contract({
      "/a": {
        get: operation("a", {
          "200": okResponse({
            schema: { type: "object", properties: { id: { type: "string" } } }
          })
        })
      }
    });
    const r = checkContractPolicy(doc, inputs());
    expect(rules(r)).toEqual(["required-list"]);
    expect(r.violations[0]!.message).toContain("no `required` list");
  });

  test("a nested object inside an array, reached through a component $ref, fails", () => {
    const doc = contract(
      {
        "/a": {
          get: operation("a", {
            "200": okResponse({
              schema: {
                type: "object",
                required: ["items"],
                properties: {
                  items: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Item" }
                  }
                }
              }
            })
          })
        }
      },
      {
        schemas: {
          Item: { type: "object", properties: { id: { type: "string" } } }
        }
      }
    );
    const r = checkContractPolicy(doc, inputs());
    expect(rules(r)).toEqual(["required-list"]);
    expect(r.violations[0]!.pointer).toBe("/components/schemas/Item");
  });

  test("a map (additionalProperties only) needs no required list", () => {
    const doc = contract({
      "/a": {
        get: operation("a", {
          "200": okResponse({
            schema: { type: "object", additionalProperties: { type: "string" } }
          })
        })
      }
    });
    expect(checkContractPolicy(doc, inputs()).violations).toEqual([]);
  });

  test("a recursive schema terminates", () => {
    const doc = contract(
      {
        "/a": {
          get: operation("a", {
            "200": okResponse({ schema: { $ref: "#/components/schemas/Node" } })
          })
        }
      },
      {
        schemas: {
          Node: {
            type: "object",
            required: ["child"],
            properties: { child: { $ref: "#/components/schemas/Node" } }
          }
        }
      }
    );
    expect(checkContractPolicy(doc, inputs()).violations).toEqual([]);
  });
});

describe("rule 3: no nullable", () => {
  test("nullable in a response property fails", () => {
    const doc = contract({
      "/a": {
        get: operation("a", {
          "200": okResponse({
            schema: {
              type: "object",
              required: ["n"],
              properties: { n: { type: "string", nullable: true } }
            }
          })
        })
      }
    });
    const r = checkContractPolicy(doc, inputs());
    expect(rules(r)).toEqual(["no-nullable"]);
    expect(r.violations[0]!.message).toContain('type: [X, "null"]');
  });

  test("nullable in a request body or a parameter fails", () => {
    const doc = contract({
      "/a": {
        post: operation(
          "a",
          { "200": okResponse() },
          {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: [],
                    properties: { n: { type: "string", nullable: true } }
                  }
                }
              }
            },
            parameters: [
              {
                name: "q",
                in: "query",
                schema: { type: "string", nullable: true }
              }
            ]
          }
        )
      }
    });
    expect(rules(checkContractPolicy(doc, inputs()))).toEqual([
      "no-nullable",
      "no-nullable"
    ]);
  });

  test("a property merely NAMED nullable in an example is not the keyword", () => {
    const doc = contract({
      "/a": {
        get: operation("a", {
          "200": okResponse({ example: { id: "a", nullable: true } })
        })
      }
    });
    expect(checkContractPolicy(doc, inputs()).violations).toEqual([]);
  });
});

describe("rule 3 blind spots: keyword-named properties, $ref siblings, path-item parameters", () => {
  const rulesOf = (doc: Doc): string[] =>
    checkContractPolicy(doc, inputs()).violations.map((v) => v.rule);
  const withProperty = (name: string): Doc =>
    contract({
      "/a": {
        get: operation("a", {
          "200": okResponse({
            schema: {
              type: "object",
              required: [name],
              properties: { [name]: { type: "string", nullable: true } }
            }
          })
        })
      }
    });

  for (const name of ["default", "example", "examples", "enum", "const"]) {
    test(`a property NAMED ${name} still carries nullable into a violation`, () => {
      expect(rulesOf(withProperty(name))).toEqual(["no-nullable"]);
    });
  }

  test("a keyword-named key inside an example VALUE is still skipped", () => {
    const doc = contract({
      "/a": {
        get: operation("a", {
          "200": okResponse({ example: { default: { nullable: true } } })
        })
      }
    });
    expect(rulesOf(doc)).toEqual([]);
  });

  test("nullable beside a $ref fails", () => {
    const doc = contract(
      {
        "/a": {
          get: operation("a", {
            "200": okResponse({
              schema: {
                type: "object",
                required: ["x"],
                properties: {
                  x: { $ref: "#/components/schemas/X", nullable: true }
                }
              }
            })
          })
        }
      },
      { schemas: { X: { type: "string" } } }
    );
    expect(rulesOf(doc)).toEqual(["no-nullable"]);
  });

  test("nullable in a path-item parameter fails", () => {
    const doc = contract({
      "/a": {
        parameters: [
          {
            name: "q",
            in: "query",
            schema: { type: "string", nullable: true }
          }
        ],
        get: operation("a")
      }
    });
    expect(rulesOf(doc)).toEqual(["no-nullable"]);
  });

  test("a missing required list under $defs / contains is seen", () => {
    for (const where of ["$defs", "contains"]) {
      const inner = { type: "object", properties: { n: { type: "string" } } };
      const schema =
        where === "$defs"
          ? { ...GOOD_BODY, $defs: { inner } }
          : { ...GOOD_BODY, contains: inner };
      const doc = contract({
        "/a": { get: operation("a", { "200": okResponse({ schema }) }) }
      });
      expect(rulesOf(doc)).toEqual(["required-list"]);
    }
  });
});

describe("rule 4: 429 where the handler is rate-limited", () => {
  const doc = contract({ "/a": { get: operation("a") } });

  test("a rate-limited handler without 429 fails", () => {
    const r = checkContractPolicy(doc, inputs({ isRateLimited: () => true }));
    expect(rules(r)).toEqual(["rate-limit-429"]);
    expect(r.violations[0]!.message).toContain("429");
  });

  test("a rate-limited handler with 429 passes", () => {
    const withLimit = contract({
      "/a": {
        get: operation("a", {
          "200": okResponse(),
          "429": { description: "slow down" }
        })
      }
    });
    expect(
      checkContractPolicy(withLimit, inputs({ isRateLimited: () => true }))
        .violations
    ).toEqual([]);
  });

  test("an undetectable handler FAILS closed", () => {
    const r = checkContractPolicy(
      doc,
      inputs({ isRateLimited: () => undefined })
    );
    expect(rules(r)).toEqual(["rate-limit-429"]);
    expect(r.violations[0]!.message).toContain("fail closed");
  });

  test("the probe receives the upper-case method and the path template", () => {
    const seen: string[] = [];
    checkContractPolicy(
      doc,
      inputs({ isRateLimited: (m, t) => (seen.push(`${m} ${t}`), false) })
    );
    expect(seen).toEqual(["GET /a"]);
  });
});

describe("a pre-existing operation is not checked", () => {
  const bad = (id: string) =>
    operation(id, {
      "200": {
        description: "x",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { n: { type: "string", nullable: true } }
            }
          }
        }
      }
    });

  test("the same defects: red when new, ignored when in the baseline", () => {
    const doc = contract({ "/a": { get: bad("old") } });
    expect(
      checkContractPolicy(doc, inputs()).violations.length
    ).toBeGreaterThan(0);
    const r = checkContractPolicy(
      doc,
      inputs({ baseline: ["old"], isRateLimited: () => true })
    );
    expect(r.violations).toEqual([]);
    expect(r.checked).toBe(0);
  });

  test("only the new operation of two is reported", () => {
    const doc = contract({
      "/a": { get: bad("old") },
      "/b": { get: bad("fresh") }
    });
    const r = checkContractPolicy(doc, inputs({ baseline: ["old"] }));
    expect(r.checked).toBe(1);
    expect(new Set(r.violations.map((v) => v.operationId))).toEqual(
      new Set(["fresh"])
    );
  });

  test("a component an old operation also reaches is shared, a new-only one is checked", () => {
    const comps = {
      schemas: {
        Shared: {
          type: "object",
          properties: { n: { type: "string", nullable: true } }
        },
        Own: { type: "object", properties: { n: { type: "string" } } }
      }
    };
    const withRef = (id: string, ref: string) =>
      operation(id, {
        "200": okResponse({ schema: { $ref: `#/components/schemas/${ref}` } })
      });
    const doc = contract(
      {
        "/old": { get: withRef("old", "Shared") },
        "/new": { get: withRef("fresh", "Shared") },
        "/new2": { get: withRef("fresh2", "Own") }
      },
      comps
    );
    const r = checkContractPolicy(doc, inputs({ baseline: ["old"] }));
    expect(new Set(r.violations.map((v) => v.operationId))).toEqual(
      new Set(["fresh2"])
    );
    expect(rules(r)).toEqual(["required-list"]);
  });
});

describe("identity and the baseline that only shrinks", () => {
  test("an operation without an operationId fails", () => {
    const doc = contract({
      "/a": { get: { responses: { "200": okResponse() } } }
    });
    expect(rules(checkContractPolicy(doc, inputs()))).toEqual(["operation-id"]);
  });

  test("a duplicated operationId fails for both operations", () => {
    const doc = contract({
      "/a": { get: operation("same") },
      "/b": { get: operation("same") }
    });
    expect(rules(checkContractPolicy(doc, inputs()))).toEqual([
      "operation-id",
      "operation-id"
    ]);
  });

  test("a baseline entry naming no operation fails (stale)", () => {
    const doc = contract({ "/a": { get: operation("a") } });
    const r = checkContractPolicy(doc, inputs({ baseline: ["gone"] }));
    expect(rules(r)).toEqual(["stale-baseline"]);
    expect(r.violations[0]!.message).toContain("only shrinks");
  });

  test("a webhooks section is refused rather than silently unchecked", () => {
    const doc = {
      ...contract({ "/a": { get: operation("a") } }),
      webhooks: { hook: { post: operation("h") } }
    };
    expect(rules(checkContractPolicy(doc, inputs()))).toContain("unsupported");
  });
});

describe("exceptions need a recorded reason", () => {
  const REASON =
    "Streaming endpoint: the body is an event stream and has no JSON shape to exemplify.";
  const noExample = () => {
    const resp = okResponse();
    delete resp.content["application/json"].example;
    return contract({ "/a": { get: operation("a", { "200": resp }) } });
  };

  test("a reasoned exception waives exactly its rule", () => {
    const r = checkContractPolicy(
      noExample(),
      inputs({
        exceptions: [
          { operationId: "a", rule: "response-example", reason: REASON }
        ]
      })
    );
    expect(r.violations).toEqual([]);
  });

  test("it does not waive another rule of the same operation", () => {
    const doc = noExample();
    const r = checkContractPolicy(
      doc,
      inputs({
        isRateLimited: () => true,
        exceptions: [
          { operationId: "a", rule: "response-example", reason: REASON }
        ]
      })
    );
    expect(rules(r)).toEqual(["rate-limit-429"]);
  });

  test("a missing or short reason fails and the violation stays", () => {
    for (const reason of ["", "n/a", "x".repeat(MIN_REASON_LENGTH - 1)]) {
      const r = checkContractPolicy(
        noExample(),
        inputs({
          exceptions: [{ operationId: "a", rule: "response-example", reason }]
        })
      );
      expect(rules(r).sort()).toEqual(["bad-exception", "response-example"]);
    }
  });

  test("an exception for a rule the operation does not violate fails (stale)", () => {
    const doc = contract({ "/a": { get: operation("a") } });
    const r = checkContractPolicy(
      doc,
      inputs({
        exceptions: [{ operationId: "a", rule: "no-nullable", reason: REASON }]
      })
    );
    expect(rules(r)).toEqual(["bad-exception"]);
  });

  test("an exception for a baseline, unknown operation or unknown rule fails", () => {
    const doc = contract({ "/a": { get: operation("a") } });
    const r = checkContractPolicy(
      doc,
      inputs({
        baseline: ["a"],
        exceptions: [
          { operationId: "a", rule: "no-nullable", reason: REASON },
          { operationId: "ghost", rule: "no-nullable", reason: REASON },
          { operationId: "a", rule: "made-up", reason: REASON }
        ]
      })
    );
    expect(rules(r)).toEqual([
      "bad-exception",
      "bad-exception",
      "bad-exception"
    ]);
  });

  test("a duplicate exception fails", () => {
    const e = { operationId: "a", rule: "response-example", reason: REASON };
    const r = checkContractPolicy(noExample(), inputs({ exceptions: [e, e] }));
    expect(rules(r)).toEqual(["bad-exception"]);
  });
});

describe("rate-limit detection is the handler call graph, not a text search", () => {
  const root = mkdtempSync(path.join(tmpdir(), "policy-routes-"));
  const routes = path.join(root, "src/pages/api/v1");
  mkdirSync(path.join(routes, "things"), { recursive: true });
  writeFileSync(
    path.join(routes, "things/support.ts"),
    `export function limit(request: Request) {\n  return checkRateLimit(request);\n}\nexport function plain() {\n  return 1;\n}\n`
  );
  writeFileSync(
    path.join(routes, "things/index.ts"),
    `import { limit, plain } from "./support";\n// checkRateLimit( mentioned only in a comment\nexport async function POST(c: any) {\n  return limit(c.request);\n}\nexport async function GET() {\n  return plain();\n}\n`
  );
  mkdirSync(path.join(routes, "things/[id]"), { recursive: true });
  writeFileSync(
    path.join(routes, "things/[id]/index.ts"),
    `export async function PATCH() {\n  return checkSharedRateLimit();\n}\n`
  );
  const probe = createRouteRateLimitProbe(root);

  test("a helper reached through an import marks only the handler that calls it", () => {
    expect(probe("POST", "/api/v1/things")).toBe(true);
    expect(probe("GET", "/api/v1/things")).toBe(false);
  });

  test("a bracket segment becomes a path parameter", () => {
    expect(probe("PATCH", "/api/v1/things/{id}")).toBe(true);
  });

  test("a handler that does not exist is undefined, not false", () => {
    expect(probe("DELETE", "/api/v1/things")).toBeUndefined();
    expect(probe("GET", "/api/v1/missing")).toBeUndefined();
  });

  test("cleanup", () => rmSync(root, { recursive: true, force: true }));
});

describe("the real contract, baseline and routes", () => {
  const bundle = parseYaml(
    readFileSync(
      path.resolve(import.meta.dir, "../openapi/awcms-public-api.openapi.yaml"),
      "utf8"
    )
  ) as Doc;

  test("the gate is green on the committed contract", () => {
    const r = checkContractPolicy(bundle, {
      baseline: CONTRACT_POLICY_BASELINE,
      exceptions: CONTRACT_POLICY_EXCEPTIONS,
      isRateLimited: createRouteRateLimitProbe()
    });
    expect(r.violations).toEqual([]);
  });

  test("the baseline is pinned exactly, and to the routes it exempts", () => {
    // Exact, not a ceiling: retrofitting an operation (deleting its line) must
    // edit these two numbers in the same diff, and so must any add or swap.
    // The hash covers `operationId METHOD route`, so an id that moves to a
    // different route (or is reused by a new operation at another route) cannot
    // keep its exemption silently.
    const routeOf = new Map<string, string>();
    for (const [route, item] of Object.entries(bundle.paths as Doc)) {
      for (const method of ["get", "put", "post", "delete", "patch"]) {
        const id = (item as Doc)[method]?.operationId;
        if (typeof id === "string") {
          routeOf.set(id, `${method.toUpperCase()} ${route}`);
        }
      }
    }
    const lines = CONTRACT_POLICY_BASELINE.map(
      (id) => `${id} ${routeOf.get(id)}`
    );
    expect(CONTRACT_POLICY_BASELINE.length).toBe(742);
    expect(
      new Bun.CryptoHasher("sha256").update(lines.join("\n")).digest("hex")
    ).toBe("8defe6fda199f44e08d338a0c9abb29b96d3338b17ee8bcb95bb419621d675e2");
    expect(CONTRACT_POLICY_BASELINE.length).toBeGreaterThan(0);
    expect([...CONTRACT_POLICY_BASELINE]).toEqual(
      [...CONTRACT_POLICY_BASELINE].sort()
    );
    expect(new Set(CONTRACT_POLICY_BASELINE).size).toBe(
      CONTRACT_POLICY_BASELINE.length
    );
  });

  test("every real exception carries a reason", () => {
    for (const e of CONTRACT_POLICY_EXCEPTIONS) {
      expect(e.reason.trim().length).toBeGreaterThanOrEqual(MIN_REASON_LENGTH);
    }
  });

  test("the real probe distinguishes a limited operation from an unlimited sibling", () => {
    const probe = createRouteRateLimitProbe();
    expect(probe("POST", "/api/v1/omes/servers")).toBe(true);
    expect(probe("GET", "/api/v1/omes/servers")).toBe(false);
  });

  test("the limiter pattern names exactly the exported limiter helpers", () => {
    const exported = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts")) {
          for (const m of readFileSync(full, "utf8").matchAll(
            /export (?:async )?function (check\w*RateLimit)\(/g
          )) {
            exported.add(m[1]!);
          }
        }
      }
    };
    walk(path.resolve(import.meta.dir, "../src/lib"));
    walk(path.resolve(import.meta.dir, "../src/modules"));
    const named = RATE_LIMIT_HELPER.source.match(/\((.*?)\)/)![1]!.split("|");
    expect([...exported].sort()).toEqual([...named].sort());
  });
});
