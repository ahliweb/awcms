/**
 * The payroll data boundary (Issue #978, PS-18 (b)).
 *
 * Every case plants a violation: a gate that has only ever been observed
 * passing has not been observed. The tables and the `hr_payroll` module do not
 * exist yet (#957 is blocked on a DPIA), so the registries are driven with
 * fixtures that name the tables the phase-3 schema will create - which is the
 * point: the rule has to hold BEFORE the first descriptor is written.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { findPayrollSurfaces } from "../scripts/edge-cache-surfaces-check";
import { listModules } from "../src/modules";
import type {
  CommentableResourceDescriptor,
  ModuleDescriptor,
  ProjectionDescriptor,
  SearchSourceDescriptor
} from "../src/modules/_shared/module-contract";
import {
  PAYROLL_BOUND_DESCRIPTOR_TYPES,
  PAYROLL_EXEMPT_DESCRIPTOR_TYPES,
  assertNotPayrollTable,
  findPayrollTables,
  isPayrollOwnerModule,
  isPayrollTable
} from "../src/modules/_shared/payroll-data-boundary";
import { validateCommentableResourceRegistry } from "../src/modules/comments/domain/commentable-resource-registry";
import { assertSafeTableName as assertCommentsTable } from "../src/modules/comments/domain/commentable-resource-registry";
import { assertProjectionExportable } from "../src/modules/reporting/application/export-generation";
import { validateProjectionRegistry } from "../src/modules/reporting/domain/projection-registry";
import {
  assertSafeTableName as assertSearchTable,
  validateSearchSourceRegistry
} from "../src/modules/site-search/domain/search-source-registry";

/** Every table the phase-3 schema is designed to create (hr-payroll.md section 6). */
const PAYROLL_TABLES: string[] = [
  "awcms_hr_compensation",
  "awcms_hr_payout_accounts",
  "awcms_hr_payroll_periods",
  "awcms_hr_payroll_runs",
  "awcms_hr_payroll_run_lines",
  "awcms_hr_payroll_run_events",
  "awcms_hr_payslips"
];

describe("isPayrollTable", () => {
  test.each(PAYROLL_TABLES)("%s is a payroll table", (table) => {
    expect(isPayrollTable(table)).toBe(true);
  });

  test("the family is matched by prefix, so a table added later is covered without an edit", () => {
    for (const table of [
      "awcms_hr_payroll_adjustments",
      "awcms_hr_payroll",
      "awcms_hr_compensation_versions",
      "awcms_hr_payout_account",
      "awcms_hr_payslip"
    ]) {
      expect(isPayrollTable(table)).toBe(true);
    }
  });

  test("spelling tricks PostgreSQL would resolve to the same table are caught", () => {
    for (const table of [
      "AWCMS_HR_PAYSLIPS",
      '"awcms_hr_payslips"',
      "public.awcms_hr_payslips",
      '"public"."awcms_hr_compensation"',
      "  awcms_hr_payroll_runs  "
    ]) {
      expect(isPayrollTable(table)).toBe(true);
    }
  });

  test("neighbouring tables that are NOT payroll are left alone", () => {
    for (const table of [
      "awcms_hr_commission_rules",
      "awcms_hr_employments",
      "awcms_hr_shift_assignments",
      "awcms_hr_pay_rule_sets",
      "awcms_blog_posts",
      "awcms_hr_payrollish_not",
      "awcms_hr_compensationx"
    ]) {
      // `awcms_hr_payrollish_not` and `awcms_hr_compensationx` are the
      // boundary cases: the pattern is a prefix followed by `_` or the end, not
      // a bare string prefix.
      expect(isPayrollTable(table)).toBe(false);
    }
  });

  test("plural, salary, wage and prefixed spellings the first list missed are caught (audit M2)", () => {
    for (const table of [
      "awcms_hr_compensations",
      "awcms_hr_payrolls",
      "awcms_hr_salary_history",
      "awcms_hr_salaries",
      "awcms_hr_employee_compensation",
      "awcms_hr_wages",
      "awcms_hr_wage_scales",
      "awcms_payroll_records",
      "awcms_hr_payouts",
      "awcms_hr_payout_account"
    ]) {
      expect(isPayrollTable(table)).toBe(true);
    }
  });

  test("commission accruals and their transition log are inside the boundary (owner decision on the #978 audit)", () => {
    for (const table of [
      "awcms_hr_commission_accruals",
      "awcms_hr_commission_transitions"
    ]) {
      expect(isPayrollTable(table)).toBe(true);
    }
  });

  test("findPayrollTables returns the offenders once each, in order", () => {
    expect(
      findPayrollTables([
        "awcms_blog_posts",
        "awcms_hr_payslips",
        "awcms_hr_payslips",
        "awcms_hr_compensation"
      ])
    ).toEqual(["awcms_hr_payslips", "awcms_hr_compensation"]);
  });

  test("hr_payroll and hr_commission are payroll owner modules, hr_workforce is not", () => {
    expect(isPayrollOwnerModule("hr_payroll")).toBe(true);
    expect(isPayrollOwnerModule("hr_commission")).toBe(true);
    expect(isPayrollOwnerModule("hr_workforce")).toBe(false);
    expect(isPayrollOwnerModule(null)).toBe(false);
  });
});

function moduleWith(
  key: string,
  extra: Partial<ModuleDescriptor>
): ModuleDescriptor {
  return {
    key,
    name: key,
    version: "1.0.0",
    status: "active",
    description: "fixture",
    dependencies: [],
    ...extra
  };
}

function projection(
  tableName: string,
  overrides: Partial<ProjectionDescriptor> = {},
  ownerModuleKey = "fixture"
): ProjectionDescriptor {
  const stream = {
    streamKey: "stream_one",
    tableName,
    cursorColumn: "created_at",
    metrics: [{ metricKey: "example_count", effect: "increment" as const }]
  };

  return {
    key: `${ownerModuleKey}.example`,
    version: 1,
    ownerModuleKey,
    scope: "tenant",
    description: "fixture projection",
    source: { strategy: "cursor_table", streams: [stream] },
    rebuildSource: { streams: [stream] },
    metricLabels: { example_count: "Example count" },
    requiredPermission: `${ownerModuleKey}.reports.read`,
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

describe("reporting projections", () => {
  test("the fixture is valid, so each failure below is about the planted table", () => {
    const result = validateProjectionRegistry([
      moduleWith("fixture", {
        reportingProjections: [projection("awcms_example_table")]
      })
    ]);

    expect(result.issues).toEqual([]);
  });

  test.each(PAYROLL_TABLES)(
    "registering %s as a projection SOURCE fails the gate",
    (table) => {
      const result = validateProjectionRegistry([
        moduleWith("fixture", { reportingProjections: [projection(table)] })
      ]);

      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (issue) =>
            issue.message.includes(table) && issue.message.includes("PS-18")
        )
      ).toBe(true);
    }
  );

  test("a payroll table only in the REBUILD source is refused too", () => {
    const clean = projection("awcms_example_table");
    const result = validateProjectionRegistry([
      moduleWith("fixture", {
        reportingProjections: [
          {
            ...clean,
            rebuildSource: {
              streams: [
                {
                  ...clean.rebuildSource.streams[0]!,
                  tableName: "awcms_hr_payslips"
                }
              ]
            }
          }
        ]
      })
    ]);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("rebuildSource"))
    ).toBe(true);
  });

  test("a projection declared by hr_payroll is refused whatever table it reads", () => {
    const result = validateProjectionRegistry([
      moduleWith("hr_payroll", {
        reportingProjections: [
          projection("awcms_something_harmless", {}, "hr_payroll")
        ]
      })
    ]);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("owns payroll data"))
    ).toBe(true);
  });

  test.each([
    "awcms.hr.payroll.run_posted",
    "awcms.hr.commission.accrued",
    "hr_payroll.payslip_issued",
    "awcms.hr.compensation.changed"
  ])(
    "a projection owned by ANOTHER module consuming the payroll event %s is refused (audit L5)",
    (eventType) => {
      const base = projection("awcms_example_table");
      const result = validateProjectionRegistry([
        moduleWith("fixture", {
          reportingProjections: [
            {
              ...base,
              source: {
                strategy: "domain_event",
                events: [{ eventType, eventVersion: "1.0" }],
                consumerName: "fixture_consumer"
              }
            }
          ]
        })
      ]);

      expect(result.valid).toBe(false);
      expect(
        result.issues.some((issue) => issue.message.includes("payroll event"))
      ).toBe(true);
    }
  );

  test("a domain_event projection over an ordinary event is accepted", () => {
    const base = projection("awcms_example_table");
    const result = validateProjectionRegistry([
      moduleWith("fixture", {
        reportingProjections: [
          {
            ...base,
            source: {
              strategy: "domain_event",
              events: [
                { eventType: "awcms.blog.post_published", eventVersion: "1.0" }
              ],
              consumerName: "fixture_consumer"
            }
          }
        ]
      })
    ]);

    expect(result.issues.filter((i) => i.message.includes("payroll"))).toEqual(
      []
    );
  });

  test("a domain_event projection still has to be rebuildable from a table, so it cannot dodge the rule", () => {
    const base = projection("awcms_hr_payroll_runs");
    const result = validateProjectionRegistry([
      moduleWith("fixture", {
        reportingProjections: [
          {
            ...base,
            source: {
              strategy: "domain_event",
              events: [{ eventType: "x.y", eventVersion: "1.0" }],
              consumerName: "fixture.consumer"
            } as ProjectionDescriptor["source"]
          }
        ]
      })
    ]);

    expect(result.valid).toBe(false);
  });

  test("a report EXPORT of a payroll-backed projection is refused at write time as well", () => {
    expect(() =>
      assertProjectionExportable(projection("awcms_hr_payroll_run_lines"))
    ).toThrow(/payroll table/);
    expect(() =>
      assertProjectionExportable(
        projection("awcms_example_table", {}, "hr_payroll")
      )
    ).toThrow(/owns payroll data/);
    expect(() =>
      assertProjectionExportable(projection("awcms_example_table"))
    ).not.toThrow();
  });
});

const SEARCH_SOURCE: SearchSourceDescriptor = {
  key: "fixture.post",
  ownerModuleKey: "fixture",
  resourceType: "fixture_post",
  tableName: "awcms_example_posts",
  localeColumn: "locale",
  updatedAtColumn: "updated_at",
  titleColumn: "title",
  bodyColumns: ["content_text"],
  urlTemplate: "/blog/:tenantCode/:slug",
  slugColumn: "slug",
  publicationFilter: { equals: { status: "published" } },
  weight: 1,
  privacyClassification: "public"
};

describe("site-search sources", () => {
  test("the fixture is valid", () => {
    expect(
      validateSearchSourceRegistry([
        moduleWith("fixture", { searchSources: [SEARCH_SOURCE] })
      ]).issues
    ).toEqual([]);
  });

  test.each(PAYROLL_TABLES)(
    "registering %s as a search source fails the gate",
    (table) => {
      const result = validateSearchSourceRegistry([
        moduleWith("fixture", {
          searchSources: [{ ...SEARCH_SOURCE, tableName: table }]
        })
      ]);

      expect(result.valid).toBe(false);
      expect(
        result.issues.some((issue) => issue.message.includes("PS-18"))
      ).toBe(true);
    }
  );

  test("a payroll table smuggled in through a JOIN facet is refused", () => {
    const result = validateSearchSourceRegistry([
      moduleWith("fixture", {
        searchSources: [
          {
            ...SEARCH_SOURCE,
            termFacets: [
              {
                facetKey: "grade",
                kind: "join",
                linkTable: "awcms_example_links",
                valueTable: "awcms_hr_compensation",
                linkSourceColumn: "post_id",
                linkValueColumn: "value_id",
                valueIdColumn: "id",
                valueColumn: "code",
                labelColumn: "label"
              }
            ]
          }
        ]
      })
    ]);

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("valueTable"))
    ).toBe(true);
  });

  test("a search source declared by hr_payroll is refused", () => {
    const result = validateSearchSourceRegistry([
      moduleWith("hr_payroll", {
        searchSources: [
          {
            ...SEARCH_SOURCE,
            key: "hr_payroll.post",
            ownerModuleKey: "hr_payroll"
          }
        ]
      })
    ]);

    expect(result.valid).toBe(false);
  });

  test("the SQL builder's own identifier assertion refuses it too (a descriptor that bypassed the gate)", () => {
    expect(() => assertSearchTable("awcms_hr_payslips")).toThrow(/payroll/);
    expect(assertSearchTable("awcms_blog_posts")).toBe("awcms_blog_posts");
  });
});

const COMMENTABLE: CommentableResourceDescriptor = {
  key: "fixture.post",
  ownerModuleKey: "fixture",
  resourceType: "fixture_post",
  tableName: "awcms_example_posts",
  localeColumn: "locale",
  slugColumn: "slug",
  urlTemplate: "/blog/:tenantCode/:slug",
  publicationFilter: { equals: { status: "published" } },
  defaultPolicy: "moderated-anonymous"
};

describe("comments resources", () => {
  test("the fixture is valid", () => {
    expect(
      validateCommentableResourceRegistry([
        moduleWith("fixture", { commentableResources: [COMMENTABLE] })
      ]).issues
    ).toEqual([]);
  });

  test.each(PAYROLL_TABLES)(
    "registering %s as a commentable resource fails the gate",
    (table) => {
      const result = validateCommentableResourceRegistry([
        moduleWith("fixture", {
          commentableResources: [{ ...COMMENTABLE, tableName: table }]
        })
      ]);

      expect(result.valid).toBe(false);
      expect(
        result.issues.some((issue) => issue.message.includes("PS-18"))
      ).toBe(true);
    }
  );

  test("a commentable resource declared by hr_payroll is refused", () => {
    const result = validateCommentableResourceRegistry([
      moduleWith("hr_payroll", {
        commentableResources: [
          {
            ...COMMENTABLE,
            key: "hr_payroll.post",
            ownerModuleKey: "hr_payroll"
          }
        ]
      })
    ]);

    expect(result.valid).toBe(false);
  });

  test("the engine's identifier assertion refuses it too", () => {
    expect(() => assertCommentsTable("awcms_hr_payroll_runs")).toThrow(
      /payroll/
    );
    expect(assertCommentsTable("awcms_blog_posts")).toBe("awcms_blog_posts");
  });
});

describe("edge-cache surfaces", () => {
  const SAFE_SURFACE = {
    key: "blog-post",
    pattern: /^\/blog\/[^/]+\/[^/]+$/,
    ttlSeconds: 300,
    requiresTenant: true,
    allowedQueryParams: [],
    moduleKey: "blog_content",
    rationale: "Public blog post body, identical for every anonymous visitor."
  };
  const ROUTES = new Map([["hr_payroll", ["/api/v1/payroll"]]]);

  test("an ordinary surface passes", () => {
    expect(findPayrollSurfaces([SAFE_SURFACE], ROUTES)).toEqual([]);
  });

  test("a surface owned by hr_payroll is refused", () => {
    const failures = findPayrollSurfaces(
      [{ ...SAFE_SURFACE, key: "x-runs", moduleKey: "hr_payroll" }],
      ROUTES
    );

    expect(failures.join("\n")).toContain("owned by payroll module");
  });

  test.each([
    ["payslip-view", /^\/payslips\/[^/]+$/],
    ["pay", /^\/payroll\/[^/]+$/],
    ["x", /^\/blog\/[^/]+\/compensation$/],
    ["y", /^\/me\/salary$/]
  ])(
    "a surface whose key or pattern is payroll vocabulary (%s) is refused",
    (key, pattern) => {
      const failures = findPayrollSurfaces(
        [{ ...SAFE_SURFACE, key, pattern, moduleKey: "blog_content" }],
        ROUTES
      );

      expect(failures.join("\n")).toContain("payroll vocabulary");
    }
  );

  test("a surface that overlaps a route a payroll module serves is refused, even with neutral words", () => {
    const failures = findPayrollSurfaces(
      [
        {
          ...SAFE_SURFACE,
          key: "neutral",
          pattern: /^\/api\/v1\/payroll\/[^/]+$/,
          moduleKey: "blog_content"
        }
      ],
      ROUTES
    );

    expect(failures.join("\n")).toContain(
      "overlaps a route a payroll module serves"
    );
  });

  test.each([
    ["no pay word, probes only", /^\/api\/v1\/hr\/[^/]+\/runs/],
    ["wildcard segment", /^\/api\/v1\/[^/]+\/runs$/],
    ["hr namespace prefix", /^\/api\/v1\/hr\/employees\/[^/]+$/],
    ["admin hr namespace", /^\/admin\/hr\/[a-z]+$/]
  ])(
    "a surface that dodges the vocabulary check (%s) is still refused (audit L5)",
    (_name, pattern) => {
      const failures = findPayrollSurfaces(
        [
          {
            ...SAFE_SURFACE,
            key: "neutral",
            pattern,
            moduleKey: "blog_content"
          }
        ],
        new Map()
      );

      expect(failures.length).toBeGreaterThan(0);
    }
  );

  test("a surface is probed as a regex against payroll paths, not only by its words", () => {
    const failures = findPayrollSurfaces(
      [
        {
          ...SAFE_SURFACE,
          key: "neutral",
          pattern: /^\/api\/v1\/hr\/[^/]+\/runs/,
          moduleKey: "blog_content"
        }
      ],
      new Map([["hr_payroll", ["/api/v1/ledger"]]])
    );

    expect(failures.join("\n")).toContain("matches the payroll route path");
  });

  test("a content purge enqueued for hr_payroll is reported", () => {
    const failures = findPayrollSurfaces(
      [SAFE_SURFACE],
      ROUTES,
      new Set(["blog_content", "hr_payroll"])
    );

    expect(failures.join("\n")).toContain("m:hr_payroll");
  });
});

describe("assertNotPayrollTable", () => {
  test("throws for a payroll table and passes any other name through", () => {
    expect(() => assertNotPayrollTable("awcms_hr_payslips", "engine")).toThrow(
      /refusing to read the payroll table/
    );
    expect(assertNotPayrollTable("awcms_blog_posts", "engine")).toBe(
      "awcms_blog_posts"
    );
  });
});

describe("the live registries", () => {
  test("no registered descriptor names a payroll table or is owned by a payroll module", () => {
    const modules = listModules();

    for (const module of modules) {
      expect(isPayrollOwnerModule(module.key)).toBe(
        module.key === "hr_payroll" || module.key === "hr_commission"
      );
    }

    expect(validateProjectionRegistry(modules).valid).toBe(true);
    expect(validateSearchSourceRegistry(modules).valid).toBe(true);
    expect(validateCommentableResourceRegistry(modules).valid).toBe(true);
  });
});

describe("a new kind of registry cannot be a silent gap", () => {
  /**
   * Every exported type in `module-contract.ts` whose body declares a field that
   * names a table (`tableName`, `linkTable`, `valueTable`). When a NEW descriptor
   * type appears that names a table, this fails until someone decides: enforce
   * the payroll boundary in its registry and list it in
   * `PAYROLL_BOUND_DESCRIPTOR_TYPES`, or list it in
   * `PAYROLL_EXEMPT_DESCRIPTOR_TYPES` with the control that governs it instead.
   */
  function typesNamingATable(): string[] {
    const source = readFileSync(
      "src/modules/_shared/module-contract.ts",
      "utf8"
    );
    const names: string[] = [];

    for (const match of source.matchAll(
      /export type (\w+)\s*=\s*([\s\S]*?)(?=\n(?:\/\*\*|export type |export const |export function |$))/g
    )) {
      if (/\b(?:tableName|linkTable|valueTable)\??\s*:/.test(match[2]!)) {
        names.push(match[1]!);
      }
    }

    return names.sort();
  }

  test("every descriptor type that names a table is either bound or exempt, with a reason", () => {
    const decided = new Set([
      ...Object.keys(PAYROLL_BOUND_DESCRIPTOR_TYPES),
      ...Object.keys(PAYROLL_EXEMPT_DESCRIPTOR_TYPES)
    ]);
    const undecided = typesNamingATable().filter((name) => !decided.has(name));

    expect(undecided).toEqual([]);
  });

  test("a decided type that no longer exists is reported (the list cannot rot)", () => {
    const present = new Set(typesNamingATable());
    const stale = [
      ...Object.keys(PAYROLL_BOUND_DESCRIPTOR_TYPES),
      ...Object.keys(PAYROLL_EXEMPT_DESCRIPTOR_TYPES)
    ].filter((name) => !present.has(name));

    expect(stale).toEqual([]);
  });

  test("no type is both bound and exempt", () => {
    const overlap = Object.keys(PAYROLL_BOUND_DESCRIPTOR_TYPES).filter((name) =>
      Object.hasOwn(PAYROLL_EXEMPT_DESCRIPTOR_TYPES, name)
    );

    expect(overlap).toEqual([]);
  });
});
