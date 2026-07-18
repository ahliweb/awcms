/**
 * Derived-fragment composition test (Issue #182, epic #177 — composition seam
 * #178). Proves a DERIVED application module can contribute its own OpenAPI
 * fragment (declared via `ModuleDescriptor.api.openApiPath`) into the published
 * bundle through `buildBundledDocument`'s `extraFragmentFiles` seam WITHOUT
 * editing any base fragment or the base bundle — and that such a fragment can
 * never silently override a base path/operation/schema.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  BundleConflictError,
  buildBundledDocument
} from "../scripts/openapi-bundle";
import { exampleCrmModule } from "./fixtures/derived-application-example/modules/example-crm/module";

const ROOT = process.cwd();

type AnyRecord = Record<string, unknown>;

describe("derived OpenAPI fragment contribution", () => {
  test("the fixture derived module declares its own openApiPath", () => {
    expect(exampleCrmModule.api?.openApiPath).toBe(
      "tests/fixtures/derived-application-example/openapi/modules/example-crm.openapi.yaml"
    );
  });

  test("a base-only bundle does NOT contain the derived path or schema", async () => {
    const base = (await buildBundledDocument(ROOT)) as AnyRecord;
    expect(Object.keys(base.paths as AnyRecord)).not.toContain(
      "/api/v1/example-crm/contacts"
    );
    expect(
      Object.keys((base.components as AnyRecord).schemas as AnyRecord)
    ).not.toContain("ExampleCrmContact");
  });

  test("passing the derived fragment via the seam merges its path + schema", async () => {
    const composed = (await buildBundledDocument(ROOT, {
      extraFragmentFiles: [exampleCrmModule.api!.openApiPath]
    })) as AnyRecord;

    expect(Object.keys(composed.paths as AnyRecord)).toContain(
      "/api/v1/example-crm/contacts"
    );
    expect(
      Object.keys((composed.components as AnyRecord).schemas as AnyRecord)
    ).toContain("ExampleCrmContact");

    // Base paths/schemas remain intact alongside the derived contribution.
    expect(Object.keys(composed.paths as AnyRecord)).toContain(
      "/api/v1/health"
    );
    // Merged bundle is still deterministically sorted.
    const pathKeys = Object.keys(composed.paths as AnyRecord);
    expect(pathKeys).toEqual([...pathKeys].sort((a, b) => a.localeCompare(b)));
  });

  test("a derived fragment overriding a base path is rejected", async () => {
    await expect(
      buildBundledDocument(ROOT, {
        extraFragmentFiles: [
          path.join(ROOT, "tests/fixtures/openapi-conflict-path.openapi.yaml")
        ]
      })
    ).rejects.toBeInstanceOf(BundleConflictError);
  });

  test("a derived fragment overriding a base/shared schema is rejected", async () => {
    await expect(
      buildBundledDocument(ROOT, {
        extraFragmentFiles: [
          path.join(ROOT, "tests/fixtures/openapi-conflict-schema.openapi.yaml")
        ]
      })
    ).rejects.toBeInstanceOf(BundleConflictError);
  });
});
