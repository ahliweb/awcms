import { describe, expect, test } from "bun:test";
import {
  collectProjectionDescriptors,
  validateProjectionRegistry
} from "../src/modules/reporting/domain/projection-registry";
import type {
  ModuleDescriptor,
  ProjectionDescriptor
} from "../src/modules/_shared/module-contract";
import { listModules } from "../src/modules";

function baseModule(
  key: string,
  projections: ProjectionDescriptor[]
): ModuleDescriptor {
  return {
    key,
    name: key,
    version: "1.0.0",
    status: "active",
    description: "test fixture module",
    dependencies: [],
    reportingProjections: projections
  };
}

function validDescriptor(
  overrides: Partial<ProjectionDescriptor> = {}
): ProjectionDescriptor {
  return {
    key: "test_module.example_projection",
    version: 1,
    ownerModuleKey: "test_module",
    scope: "tenant",
    description: "A valid test projection.",
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

describe("validateProjectionRegistry (Issue #753)", () => {
  test("a well-formed descriptor is valid", () => {
    const result = validateProjectionRegistry([
      baseModule("test_module", [validDescriptor()])
    ]);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("ownerModuleKey must equal the declaring module's own key", () => {
    const result = validateProjectionRegistry([
      baseModule("test_module", [
        validDescriptor({ ownerModuleKey: "someone_else" })
      ])
    ]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("ownerModuleKey"))
    ).toBe(true);
  });

  test("duplicate keys across the whole registry are rejected", () => {
    const result = validateProjectionRegistry([
      baseModule("test_module", [validDescriptor()]),
      baseModule("test_module", [validDescriptor()])
    ]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.message.includes("registered 2 times")
      )
    ).toBe(true);
  });

  test("freshness.staleAfterSeconds must be >= targetSeconds", () => {
    const result = validateProjectionRegistry([
      baseModule("test_module", [
        validDescriptor({
          freshness: {
            targetSeconds: 300,
            staleAfterSeconds: 60,
            errorAfterConsecutiveFailures: 3
          }
        })
      ])
    ]);
    expect(result.valid).toBe(false);
  });

  test("batchLimit must be positive and bounded", () => {
    const tooLarge = validateProjectionRegistry([
      baseModule("test_module", [validDescriptor({ batchLimit: 999_999_999 })])
    ]);
    expect(tooLarge.valid).toBe(false);

    const zero = validateProjectionRegistry([
      baseModule("test_module", [validDescriptor({ batchLimit: 0 })])
    ]);
    expect(zero.valid).toBe(false);
  });

  test("cursor_table strategy requires at least one stream", () => {
    const result = validateProjectionRegistry([
      baseModule("test_module", [
        validDescriptor({ source: { strategy: "cursor_table", streams: [] } })
      ])
    ]);
    expect(result.valid).toBe(false);
  });

  test("domain_event strategy requires events and consumerName", () => {
    const result = validateProjectionRegistry([
      baseModule("test_module", [
        validDescriptor({
          source: { strategy: "domain_event", events: [], consumerName: "" }
        })
      ])
    ]);
    expect(result.valid).toBe(false);
  });

  test("rebuildSource must always declare at least one stream, even for a domain_event strategy descriptor", () => {
    const result = validateProjectionRegistry([
      baseModule("test_module", [
        validDescriptor({
          source: {
            strategy: "domain_event",
            events: [{ eventType: "some.event", eventVersion: "1.0" }],
            consumerName: "test_module.consumer"
          },
          rebuildSource: { streams: [] }
        })
      ])
    ]);
    expect(result.valid).toBe(false);
  });

  test("a metric rule declaring matchColumn without matchValue (or vice versa) is rejected", () => {
    const result = validateProjectionRegistry([
      baseModule("test_module", [
        validDescriptor({
          source: {
            strategy: "cursor_table",
            streams: [
              {
                streamKey: "stream_one",
                tableName: "awcms_example_table",
                cursorColumn: "created_at",
                metrics: [
                  {
                    metricKey: "example_count",
                    effect: "increment",
                    matchColumn: "status"
                    // matchValue deliberately omitted
                  }
                ]
              }
            ]
          }
        })
      ])
    ]);
    expect(result.valid).toBe(false);
  });

  test("metricLabels referencing a metricKey no stream actually produces is rejected", () => {
    const result = validateProjectionRegistry([
      baseModule("test_module", [
        validDescriptor({
          metricLabels: { nonexistent_metric: "Ghost metric" }
        })
      ])
    ]);
    expect(result.valid).toBe(false);
  });

  test("collectProjectionDescriptors flattens every module's own array", () => {
    const descriptors = collectProjectionDescriptors([
      baseModule("module_a", [validDescriptor({ key: "module_a.one" })]),
      baseModule("module_b", [validDescriptor({ key: "module_b.two" })])
    ]);
    expect(descriptors.map((d) => d.key).sort()).toEqual([
      "module_a.one",
      "module_b.two"
    ]);
  });

  test("the REAL registered registry (src/modules/index.ts) is valid", () => {
    const result = validateProjectionRegistry(listModules());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.descriptors.length).toBe(3);
  });
});
