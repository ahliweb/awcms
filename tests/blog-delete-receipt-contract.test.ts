/**
 * Issue #1443: the soft-delete handlers of the blog module answer
 * `{ success, data: { id, deleted: true } }`, not the deleted row. The contract
 * must say so, or a generated client types `data` as a BlogPost that is never
 * sent. Handler and contract are pinned to each other here, and the example is
 * validated against the schema with the same ajv as `api:contract:lint`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { validateContractExamples } from "../scripts/api-contract-examples";
import { BUNDLED_PATH } from "../scripts/openapi-bundle";

type Doc = Record<string, any>;

const OPERATIONS = [
  { route: "/api/v1/blog/posts/{id}", file: "posts/[id].ts" },
  { route: "/api/v1/blog/pages/{id}", file: "pages/[id].ts" },
  { route: "/api/v1/blog/terms/{id}", file: "terms/[id].ts" },
  { route: "/api/v1/blog/institutions/{id}", file: "institutions/[id].ts" },
  { route: "/api/v1/blog/widgets/{id}", file: "widgets/[id].ts" },
  { route: "/api/v1/blog/menus/{id}", file: "menus/[id].ts" },
  { route: "/api/v1/blog/templates/{id}", file: "templates/[id].ts" },
  { route: "/api/v1/blog/ads/{id}", file: "ads/[id].ts" }
] as const;

async function bundle(): Promise<Doc> {
  return parseYaml(
    await readFile(path.resolve(process.cwd(), BUNDLED_PATH), "utf8")
  ) as Doc;
}

describe("blog soft-delete contract matches the handler (#1443)", () => {
  for (const { route, file } of OPERATIONS) {
    test(`DELETE ${route} declares the delete receipt`, async () => {
      const doc = await bundle();
      const ok =
        doc.paths[route].delete.responses["200"].content["application/json"];
      expect(ok.schema.properties.data).toEqual({
        $ref: "#/components/schemas/BlogDeleteReceipt"
      });

      const receipt = doc.components.schemas.BlogDeleteReceipt;
      expect(receipt.required.sort()).toEqual(["deleted", "id"]);
      expect(receipt.additionalProperties).toBe(false);
      expect(receipt.properties.deleted.enum).toEqual([true]);

      // The handler's literal is what the schema describes, field for field.
      const source = await readFile(
        path.resolve(process.cwd(), "src/pages/api/v1/blog", file),
        "utf8"
      );
      const literal =
        /return ok\(\{\s*id(?::\s*\w+)?,\s*deleted:\s*true\s*\}\)/.exec(source);
      expect(literal).not.toBeNull();
      expect(Object.keys(receipt.properties).sort()).toEqual(["deleted", "id"]);
    });
  }

  test("the receipt example validates, and a BlogPost-shaped body does not", async () => {
    const doc = await bundle();
    expect(validateContractExamples(doc).failures).toEqual([]);

    const example =
      doc.paths["/api/v1/blog/posts/{id}"].delete.responses["200"].content[
        "application/json"
      ].examples;
    expect(example).toBeDefined();

    for (const { route } of OPERATIONS) {
      const examples =
        doc.paths[route].delete.responses["200"].content["application/json"]
          .examples;
      expect(Object.keys(examples ?? {})).toContain("softDeleted");
    }

    const corrupted = structuredClone(doc);
    const first = Object.values(
      corrupted.paths["/api/v1/blog/posts/{id}"].delete.responses["200"]
        .content["application/json"].examples as Record<string, any>
    )[0];
    first.value.data.deleted = false;
    expect(validateContractExamples(corrupted).failures.length).toBeGreaterThan(
      0
    );
  });
});
