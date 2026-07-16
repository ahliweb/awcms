import { describe, expect, test } from "bun:test";

import {
  filterPermittedProjectionDescriptors,
  isProjectionPermitted
} from "../src/modules/reporting/domain/projection-permission-filter";
import type { ProjectionDescriptor } from "../src/modules/_shared/module-contract";

/**
 * Reviewer finding on PR #781: `ProjectionDescriptor.requiredPermission`
 * was validated for shape (registry gate) but never actually consulted at
 * read time — every registered descriptor happened to share the same
 * `requiredPermission`, so the gap was invisible until a caller holds a
 * COARSE permission but not a SPECIFIC descriptor's own permission. These
 * two synthetic fixtures deliberately declare DIFFERENT permissions to
 * exercise exactly that scenario.
 */
function descriptor(
  overrides: Partial<ProjectionDescriptor> = {}
): ProjectionDescriptor {
  return {
    key: "test_module.example_projection",
    version: 1,
    ownerModuleKey: "test_module",
    scope: "tenant",
    description: "A test projection.",
    source: {
      strategy: "cursor_table",
      streams: [
        {
          streamKey: "stream_one",
          tableName: "awcms_example_table",
          cursorColumn: "created_at",
          metrics: [{ metricKey: "example_count", effect: "increment" }]
        }
      ]
    },
    rebuildSource: {
      streams: [
        {
          streamKey: "stream_one",
          tableName: "awcms_example_table",
          cursorColumn: "created_at",
          metrics: [{ metricKey: "example_count", effect: "increment" }]
        }
      ]
    },
    metricLabels: { example_count: "Example count" },
    requiredPermission: "test_module.projections.read",
    freshness: {
      targetSeconds: 60,
      staleAfterSeconds: 300,
      errorAfterConsecutiveFailures: 3
    },
    retentionClass: "documentation only",
    batchLimit: 1000,
    ...overrides
  };
}

describe("isProjectionPermitted / filterPermittedProjectionDescriptors (Issue #753 follow-up)", () => {
  test("permitted when the caller holds the descriptor's own requiredPermission", () => {
    const d = descriptor({ requiredPermission: "module_a.projections.read" });
    expect(
      isProjectionPermitted(d, new Set(["module_a.projections.read"]))
    ).toBe(true);
  });

  test("NOT permitted when the caller holds only a DIFFERENT (coarser or unrelated) permission", () => {
    const d = descriptor({ requiredPermission: "module_a.projections.read" });
    expect(
      isProjectionPermitted(d, new Set(["module_b.projections.read"]))
    ).toBe(false);
    expect(isProjectionPermitted(d, new Set())).toBe(false);
  });

  test("two descriptors declaring DIFFERENT permissions: a caller holding only one permission sees only the matching descriptor in a list, and is denied the other by direct lookup", () => {
    const descriptorA = descriptor({
      key: "module_a.projection_a",
      ownerModuleKey: "module_a",
      requiredPermission: "module_a.projections.read"
    });
    const descriptorB = descriptor({
      key: "module_b.projection_b",
      ownerModuleKey: "module_b",
      requiredPermission: "module_b.projections.read"
    });

    // Caller holds ONLY module_a's permission — NOT module_b's, even
    // though both descriptors might otherwise be gated by the same
    // coarse endpoint-level permission (e.g. `reporting.projections.read`)
    // at the route layer. This is exactly the gap the reviewer's finding
    // describes: a coarse endpoint gate alone would let this caller see
    // BOTH; the per-descriptor filter here is what correctly narrows it.
    const grantedPermissionKeys = new Set(["module_a.projections.read"]);

    const visible = filterPermittedProjectionDescriptors(
      [descriptorA, descriptorB],
      grantedPermissionKeys
    );
    expect(visible.map((d) => d.key)).toEqual(["module_a.projection_a"]);

    expect(isProjectionPermitted(descriptorA, grantedPermissionKeys)).toBe(
      true
    );
    expect(isProjectionPermitted(descriptorB, grantedPermissionKeys)).toBe(
      false
    );
  });

  test("filterPermittedProjectionDescriptors returns an empty list when the caller holds none of the declared permissions", () => {
    const result = filterPermittedProjectionDescriptors(
      [
        descriptor({ requiredPermission: "module_a.projections.read" }),
        descriptor({
          key: "module_b.projection_b",
          requiredPermission: "module_b.projections.read"
        })
      ],
      new Set(["completely_unrelated.permission.read"])
    );
    expect(result).toEqual([]);
  });

  test("filterPermittedProjectionDescriptors keeps every descriptor when the caller holds all their permissions", () => {
    const descriptorA = descriptor({
      key: "module_a.projection_a",
      requiredPermission: "module_a.projections.read"
    });
    const descriptorB = descriptor({
      key: "module_b.projection_b",
      requiredPermission: "module_b.projections.read"
    });

    const result = filterPermittedProjectionDescriptors(
      [descriptorA, descriptorB],
      new Set(["module_a.projections.read", "module_b.projections.read"])
    );
    expect(result.map((d) => d.key).sort()).toEqual(
      ["module_a.projection_a", "module_b.projection_b"].sort()
    );
  });
});
