/**
 * Unit tests for the modular OpenAPI pipeline (Issue #182, epic #177):
 *
 * - the `$ref`/fragment resolver merges every fragment's paths+schemas into one
 *   bundle (nothing lost);
 * - the bundle is deterministic (build twice → byte-identical);
 * - a merge conflict (duplicate path or schema across fragments) throws
 *   `BundleConflictError`;
 * - the generated bundle is CONTRACT-EQUIVALENT to the pre-migration monolith
 *   snapshot (guards against an accidental API change during the split);
 * - duplicate `operationId` and non-standard error responses are rejected by
 *   the exported gate functions.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  BundleConflictError,
  buildBundledDocument,
  bundleOpenApi,
  listModuleFragmentFiles
} from "../scripts/openapi-bundle";
import {
  collectOperationIdProblems,
  collectPathParameterProblems,
  collectStandardErrorSchemaProblems
} from "../scripts/api-spec-check";

const ROOT = process.cwd();

type AnyRecord = Record<string, unknown>;

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: AnyRecord = {};
    for (const key of Object.keys(value as AnyRecord).sort()) {
      out[key] = sortDeep((value as AnyRecord)[key]);
    }
    return out;
  }
  return value;
}

/**
 * True iff `subset` is fully contained in `superset`: every leaf value in the
 * pre-migration contract is present and equal in the current one, with NEW keys
 * allowed only in `superset`. Removing or changing a pre-existing field returns
 * false. Arrays must match length + element-wise (adding an optional property
 * to a schema touches `properties` — an object — not `required`/`parameters`
 * arrays, so a genuinely additive change stays a subset here).
 */
function isAdditiveSuperset(subset: unknown, superset: unknown): boolean {
  if (Array.isArray(subset)) {
    return (
      Array.isArray(superset) &&
      subset.length === superset.length &&
      subset.every((v, i) => isAdditiveSuperset(v, superset[i]))
    );
  }
  if (subset && typeof subset === "object") {
    if (!superset || typeof superset !== "object" || Array.isArray(superset)) {
      return false;
    }
    const sup = superset as AnyRecord;
    return Object.entries(subset as AnyRecord).every(
      ([k, v]) => k in sup && isAdditiveSuperset(v, sup[k])
    );
  }
  return subset === superset;
}

async function loadFragment(fileName: string): Promise<AnyRecord> {
  const raw = await readFile(
    path.join(ROOT, "openapi/modules", fileName),
    "utf8"
  );
  return (parseYaml(raw) ?? {}) as AnyRecord;
}

describe("openapi bundle — fragment resolver", () => {
  test("merges every fragment's paths and schemas into the bundle (nothing lost)", async () => {
    const bundle = (await buildBundledDocument(ROOT)) as AnyRecord;
    const bundlePaths = new Set(Object.keys(bundle.paths as AnyRecord));
    const bundleSchemas = new Set(
      Object.keys((bundle.components as AnyRecord).schemas as AnyRecord)
    );

    const fragmentFiles = await listModuleFragmentFiles(ROOT);
    expect(fragmentFiles.length).toBeGreaterThan(1);

    for (const fileName of fragmentFiles) {
      const frag = await loadFragment(fileName);
      for (const pathKey of Object.keys((frag.paths as AnyRecord) ?? {})) {
        expect(bundlePaths.has(pathKey)).toBe(true);
      }
      const fragSchemas =
        ((frag.components as AnyRecord)?.schemas as AnyRecord) ?? {};
      for (const schemaName of Object.keys(fragSchemas)) {
        expect(bundleSchemas.has(schemaName)).toBe(true);
      }
    }
  });

  test("bundle keys are alphabetically sorted (deterministic ordering)", async () => {
    const bundle = (await buildBundledDocument(ROOT)) as AnyRecord;
    const pathKeys = Object.keys(bundle.paths as AnyRecord);
    expect(pathKeys).toEqual([...pathKeys].sort((a, b) => a.localeCompare(b)));
    const schemaKeys = Object.keys(
      (bundle.components as AnyRecord).schemas as AnyRecord
    );
    expect(schemaKeys).toEqual(
      [...schemaKeys].sort((a, b) => a.localeCompare(b))
    );
  });

  test("bundling twice produces byte-identical output (idempotent)", async () => {
    const first = await bundleOpenApi(ROOT);
    const second = await bundleOpenApi(ROOT);
    expect(second).toBe(first);
  });

  test("committed bundle matches freshly generated bundle (not hand-edited/stale)", async () => {
    const committed = await readFile(
      path.join(ROOT, "openapi/awcms-public-api.openapi.yaml"),
      "utf8"
    );
    const fresh = await bundleOpenApi(ROOT);
    expect(fresh).toBe(committed);
  });
});

describe("openapi bundle — merge conflict detection", () => {
  test("a duplicate path across fragments throws BundleConflictError", async () => {
    // The reporting fragment owns `/api/v1/reports/projections`; re-declaring it
    // through the derived seam must be rejected, not silently overriding base.
    const conflicting = path.join(
      ROOT,
      "tests/fixtures/openapi-conflict-path.openapi.yaml"
    );
    await expect(
      buildBundledDocument(ROOT, { extraFragmentFiles: [conflicting] })
    ).rejects.toBeInstanceOf(BundleConflictError);
  });

  test("a duplicate schema across fragments throws BundleConflictError", async () => {
    const conflicting = path.join(
      ROOT,
      "tests/fixtures/openapi-conflict-schema.openapi.yaml"
    );
    await expect(
      buildBundledDocument(ROOT, { extraFragmentFiles: [conflicting] })
    ).rejects.toBeInstanceOf(BundleConflictError);
  });

  test("a fragment declaring an unsupported components section (responses) throws BundleConflictError", async () => {
    // The bundler carries only `paths` + `components.schemas`; a fragment-local
    // `components.responses` would otherwise be silently dropped, leaving a
    // dangling 2xx `$ref` that the 4xx/5xx-only error-envelope gate never
    // catches. Must fail closed with an actionable message.
    const conflicting = path.join(
      ROOT,
      "tests/fixtures/openapi-conflict-components.openapi.yaml"
    );
    await expect(
      buildBundledDocument(ROOT, { extraFragmentFiles: [conflicting] })
    ).rejects.toBeInstanceOf(BundleConflictError);
  });
});

describe("openapi bundle — contract equivalence to pre-migration monolith", () => {
  test("every pre-migration path/schema is preserved byte-identically in the current bundle (modularization changed no existing contract; additive endpoints allowed)", async () => {
    // The snapshot is the FROZEN pre-#182 monolith. Its purpose is to prove the
    // fragmentation (and every later additive PR) never mutated a contract that
    // existed before the split — NOT to mirror the current bundle. So this is a
    // SUBSET assertion: each pre-migration path/schema must still be present and
    // byte-identical; new endpoints (e.g. MFA #184) may be added on top. Never
    // edit the frozen snapshot — that would make this test compare the bundle
    // against a copy of itself and silently defeat it. A backward-compatible
    // change to an EXISTING pre-migration endpoint (e.g. Turnstile #186 adding
    // an optional field) is acknowledged in INTENTIONALLY_EVOLVED_PATHS below,
    // NOT by mutating the snapshot.
    const [snapshotRaw, bundleRaw] = await Promise.all([
      readFile(
        path.join(
          ROOT,
          "tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml"
        ),
        "utf8"
      ),
      readFile(path.join(ROOT, "openapi/awcms-public-api.openapi.yaml"), "utf8")
    ]);
    const before = parseYaml(snapshotRaw) as AnyRecord;
    const after = parseYaml(bundleRaw) as AnyRecord;

    // Global, root-owned surfaces must NOT change with an endpoint addition.
    for (const key of ["security", "info", "servers"] as const) {
      expect(sortDeep(after[key])).toEqual(sortDeep(before[key]));
    }
    for (const key of ["securitySchemes", "parameters", "responses"] as const) {
      expect(sortDeep((after.components as AnyRecord)[key])).toEqual(
        sortDeep((before.components as AnyRecord)[key])
      );
    }

    // Documented, reviewed BACKWARD-COMPATIBLE evolutions of a pre-migration
    // endpoint (like the tags test's single allowed `Domain Event Runtime`
    // addition). A path listed here is NOT required to stay byte-identical, but
    // its pre-migration contract must remain a strict subset of the current one
    // (every pre-existing field preserved; only additive changes allowed) — a
    // removal or a type change still fails. The FROZEN snapshot is never edited;
    // intentional divergences are acknowledged HERE instead. Each entry needs a
    // reason so an accidental drift can't hide behind the allow-list.
    const INTENTIONALLY_EVOLVED_PATHS: Record<string, string> = {
      // Turnstile #186 adds an OPTIONAL `turnstileToken` to the request body.
      "/api/v1/auth/login":
        "#186 optional turnstileToken (backward-compatible)",
      "/api/v1/setup/initialize":
        "#186 optional turnstileToken (backward-compatible)"
    };

    // Per-operation contract: every pre-migration path is byte-identical now,
    // except the explicitly-acknowledged additive evolutions above.
    const beforePaths = before.paths as AnyRecord;
    const afterPaths = after.paths as AnyRecord;
    for (const pathKey of Object.keys(beforePaths)) {
      expect(afterPaths[pathKey]).toBeDefined();
      if (pathKey in INTENTIONALLY_EVOLVED_PATHS) {
        // Additive-only: the frozen contract must still be fully contained.
        expect(
          isAdditiveSuperset(beforePaths[pathKey], afterPaths[pathKey])
        ).toBe(true);
      } else {
        expect(sortDeep(afterPaths[pathKey])).toEqual(
          sortDeep(beforePaths[pathKey])
        );
      }
    }

    // Every pre-migration schema is byte-identical now (new schemas allowed).
    const beforeSchemas = (before.components as AnyRecord).schemas as AnyRecord;
    const afterSchemas = (after.components as AnyRecord).schemas as AnyRecord;
    for (const schemaName of Object.keys(beforeSchemas)) {
      expect(afterSchemas[schemaName]).toBeDefined();
      expect(sortDeep(afterSchemas[schemaName])).toEqual(
        sortDeep(beforeSchemas[schemaName])
      );
    }
  });

  test("bundle tags are a SUPERSET of the monolith tags (only additive, documented tag declarations allowed)", async () => {
    const [snapshotRaw, bundleRaw] = await Promise.all([
      readFile(
        path.join(
          ROOT,
          "tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml"
        ),
        "utf8"
      ),
      readFile(path.join(ROOT, "openapi/awcms-public-api.openapi.yaml"), "utf8")
    ]);
    const beforeTags = new Set(
      ((parseYaml(snapshotRaw) as AnyRecord).tags as AnyRecord[]).map(
        (t) => t.name as string
      )
    );
    const afterTags = new Set(
      ((parseYaml(bundleRaw) as AnyRecord).tags as AnyRecord[]).map(
        (t) => t.name as string
      )
    );
    for (const name of beforeTags) expect(afterTags.has(name)).toBe(true);
    // The only documented addition: the previously-undeclared operation tag.
    const added = [...afterTags].filter((n) => !beforeTags.has(n));
    expect(added).toEqual(["Domain Event Runtime"]);
  });
});

describe("api-spec-check gate functions (unit)", () => {
  test("collectOperationIdProblems flags a duplicate operationId", () => {
    const doc = {
      security: [{ bearerAuth: [], tenantHeader: [] }],
      paths: {
        "/api/v1/a": { get: { operationId: "dup" } },
        "/api/v1/b": { get: { operationId: "dup" } }
      }
    };
    const problems = collectOperationIdProblems(doc);
    expect(
      problems.some((p) => p.includes('Duplicate operationId "dup"'))
    ).toBe(true);
  });

  test("collectOperationIdProblems flags security: [] outside the allow-list", () => {
    const doc = {
      security: [{ bearerAuth: [], tenantHeader: [] }],
      paths: {
        "/api/v1/secret": {
          get: { operationId: "getSecret", security: [] }
        }
      }
    };
    const problems = collectOperationIdProblems(doc);
    expect(
      problems.some((p) => p.includes("not in ALLOWED_PUBLIC_OPERATIONS"))
    ).toBe(true);
  });

  test("collectStandardErrorSchemaProblems flags an inline (non-ApiError) error body", () => {
    const doc = {
      components: { schemas: { ApiError: { type: "object" } }, responses: {} },
      paths: {
        "/api/v1/x": {
          get: {
            operationId: "getX",
            responses: {
              "200": {},
              "400": {
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { oops: {} } }
                  }
                }
              }
            }
          }
        }
      }
    };
    const problems = collectStandardErrorSchemaProblems(doc);
    expect(
      problems.some((p) => p.includes('response "400" does not resolve'))
    ).toBe(true);
  });

  test("collectStandardErrorSchemaProblems accepts a $ref to a shared ApiError response", () => {
    const doc = {
      components: {
        schemas: { ApiError: { type: "object" } },
        responses: {
          BadRequest: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" }
              }
            }
          }
        }
      },
      paths: {
        "/api/v1/x": {
          get: {
            operationId: "getX",
            responses: {
              "200": {},
              "400": { $ref: "#/components/responses/BadRequest" }
            }
          }
        }
      }
    };
    expect(collectStandardErrorSchemaProblems(doc)).toEqual([]);
  });

  test("collectPathParameterProblems flags a template param with no matching declaration", () => {
    const doc = {
      paths: {
        "/api/v1/things/{id}": {
          get: { operationId: "getThing", parameters: [] }
        }
      }
    };
    const problems = collectPathParameterProblems(doc);
    expect(problems.some((p) => p.includes('"{id}"'))).toBe(true);
  });

  test("collectPathParameterProblems accepts a param declared at the path-item level (shared across methods)", () => {
    // Valid OpenAPI: `{id}` is factored up to the path item, not repeated on
    // each operation. Must NOT false-positive — this is the exact ergonomics a
    // derived contributor relies on.
    // Path-item-level `parameters` is valid OpenAPI but not part of the method
    // map's element type, so cast to the function's parameter type.
    const doc = {
      paths: {
        "/api/v1/things/{id}": {
          parameters: [{ name: "id", in: "path", required: true }],
          get: { operationId: "getThing" },
          delete: { operationId: "deleteThing" }
        }
      }
    } as Parameters<typeof collectPathParameterProblems>[0];
    expect(collectPathParameterProblems(doc)).toEqual([]);
  });
});
