/**
 * OpenAPI contract hygiene (Issue #1389). Two defects that are INVISIBLE to
 * `api:spec:check` and still make the published contract lie:
 *
 * 1. `nullable: true` without a `type`. The document is `openapi: 3.1.0`, where
 *    `nullable` is not a keyword at all (3.0 only) and a validator ignores it,
 *    so the field is silently NOT nullable. A schema that wraps a `$ref` must
 *    say `oneOf: [{ $ref }, { type: "null" }]`; a scalar says
 *    `type: [X, "null"]`.
 * 2. A `properties:` that is empty (YAML `null`) with field-shaped siblings
 *    next to it -- the indentation slip that left `BookingPolicy.policy`
 *    declaring no property at all while its ten fields hung one level too high.
 *
 * The scan covers every fragment AND the bundle, so a hand edit of either is
 * caught. It is deliberately narrow: retrofitting every `type` + `nullable`
 * pair, and a general ajv-based lint of the contract, are out of scope here
 * (the lint gate is Issue #1390).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const OPENAPI_DIR = path.join(process.cwd(), "openapi");

const files = [
  "awcms-public-api.src.yaml",
  "awcms-public-api.openapi.yaml",
  ...readdirSync(path.join(OPENAPI_DIR, "modules")).map((f) => `modules/${f}`)
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findHygieneViolations(doc: unknown): string[] {
  const found: string[] = [];

  const walk = (node: unknown, where: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${where}/${i}`));
      return;
    }
    if (!isRecord(node)) {
      return;
    }

    if (node.nullable === true && node.type === undefined) {
      found.push(`${where}: nullable: true without a type`);
    }

    if ("properties" in node) {
      const props = node.properties;
      const emptyProps =
        props === null ||
        props === undefined ||
        (isRecord(props) && Object.keys(props).length === 0);
      const fieldLikeSiblings = Object.entries(node).filter(
        ([key, value]) =>
          key !== "properties" && isRecord(value) && "type" in value
      );
      if (emptyProps && fieldLikeSiblings.length > 0) {
        found.push(
          `${where}: empty properties next to field-shaped siblings (${fieldLikeSiblings
            .map(([key]) => key)
            .join(", ")})`
        );
      }
    }

    for (const [key, value] of Object.entries(node)) {
      walk(value, `${where}/${key}`);
    }
  };

  walk(doc, "");
  return found;
}

describe("OpenAPI contract hygiene (#1389)", () => {
  test("the detector flags both defects (it can fail)", () => {
    expect(
      findHygieneViolations({
        a: { nullable: true, allOf: [{ $ref: "#/x" }] },
        b: {
          type: "object",
          properties: null,
          field: { type: "integer" }
        }
      })
    ).toHaveLength(2);
    expect(
      findHygieneViolations({
        a: { oneOf: [{ $ref: "#/x" }, { type: "null" }] },
        b: { type: "object", properties: { field: { type: "integer" } } },
        c: { type: "object", properties: {} }
      })
    ).toEqual([]);
  });

  for (const file of files) {
    test(`${file} has no nullable-without-type and no hollow properties`, () => {
      const doc = parse(readFileSync(path.join(OPENAPI_DIR, file), "utf8"));
      expect(findHygieneViolations(doc)).toEqual([]);
    });
  }

  test("BookingPolicy.policy really declares its ten fields", () => {
    const doc = parse(
      readFileSync(
        path.join(OPENAPI_DIR, "modules/booking.openapi.yaml"),
        "utf8"
      )
    ) as {
      components: {
        schemas: {
          BookingPolicy: {
            properties: {
              policy: {
                required: string[];
                properties: Record<string, { type: unknown }>;
              };
            };
          };
        };
      };
    };
    const policy = doc.components.schemas.BookingPolicy.properties.policy;

    expect(Object.keys(policy.properties).sort()).toEqual(
      [...policy.required].sort()
    );
    expect(policy.properties.defaultHoldSeconds?.type).toEqual([
      "integer",
      "null"
    ]);
    expect(policy.properties.defaultTimezone?.type).toEqual(["string", "null"]);
  });
});
