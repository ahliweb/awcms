/**
 * The metric-rule arithmetic shared by the incremental worker and the rebuild
 * (Issue #944: the `sumColumn` form and the tie-safe page boundary). Pure.
 */
import { describe, expect, test } from "bun:test";

import type {
  ModuleDescriptor,
  ProjectionDescriptor
} from "../src/modules/_shared/module-contract";
import { trimIncompleteTail } from "../src/modules/reporting/domain/cursor-boundary";
import {
  computeRuleDelta,
  ruleColumns
} from "../src/modules/reporting/domain/projection-metric-delta";
import { validateProjectionRegistry } from "../src/modules/reporting/domain/projection-registry";

describe("computeRuleDelta", () => {
  const rows = [
    { kind: "confirmed", booked: "86400" },
    { kind: "confirmed", booked: 3600 },
    { kind: "cancelled", booked: 0 }
  ];

  test("counts matching rows by default", () => {
    expect(
      computeRuleDelta(rows, {
        metricKey: "confirmed",
        effect: "increment",
        matchColumn: "kind",
        matchValue: "confirmed"
      })
    ).toBe(2);
    expect(
      computeRuleDelta(rows, { metricKey: "all", effect: "increment" })
    ).toBe(3);
  });

  test("sums the column over the matching rows, reading a bigint string", () => {
    expect(
      computeRuleDelta(rows, {
        metricKey: "booked",
        effect: "increment",
        matchColumn: "kind",
        matchValue: "confirmed",
        sumColumn: "booked"
      })
    ).toBe(86_400 + 3_600);
    expect(
      computeRuleDelta(rows, {
        metricKey: "booked",
        effect: "increment",
        sumColumn: "booked"
      })
    ).toBe(90_000);
  });

  test("a decrement is the negation", () => {
    expect(
      computeRuleDelta(rows, { metricKey: "all", effect: "decrement" })
    ).toBe(-3);
  });

  test("refuses a quantity that is not a non-negative integer rather than writing a wrong number", () => {
    for (const bad of [-1, 1.5, "abc", null, undefined, Number.NaN]) {
      expect(() =>
        computeRuleDelta([{ n: bad }], {
          metricKey: "x",
          effect: "increment",
          sumColumn: "n"
        })
      ).toThrow(/sumColumn "n"/);
    }
  });

  test("ruleColumns lists the match and sum columns once", () => {
    expect(
      ruleColumns([
        {
          metricKey: "a",
          effect: "increment",
          matchColumn: "kind",
          matchValue: "x"
        },
        {
          metricKey: "b",
          effect: "increment",
          matchColumn: "kind",
          matchValue: "y",
          sumColumn: "qty"
        }
      ]).sort()
    ).toEqual(["kind", "qty"]);
  });
});

describe("trimIncompleteTail (a page never ends inside a millisecond)", () => {
  const at = (ms: number) => ({ created_at: new Date(1_700_000_000_000 + ms) });

  test("a source that ran out (no lookahead row) is returned whole", () => {
    const rows = [at(0), at(1), at(1)];

    expect(trimIncompleteTail(rows, "created_at", 3)).toEqual(rows);
    expect(trimIncompleteTail(rows, "created_at", 5)).toEqual(rows);
  });

  test("a lookahead in a LATER millisecond leaves the page exactly as it was", () => {
    // limit 3, fetched 4: the 4th is the lookahead and does not tie the page's last row.
    const rows = [at(0), at(5), at(9), at(10)];

    expect(trimIncompleteTail(rows, "created_at", 3)).toEqual([
      at(0),
      at(5),
      at(9)
    ]);
  });

  test("a lookahead in the page's last millisecond drops that millisecond from the page", () => {
    // created + held of one reservation share an instant; the page cut falls between them.
    const rows = [at(0), at(5), at(5), at(9), at(9)];
    const kept = trimIncompleteTail(rows, "created_at", 4);

    expect(kept).toEqual([at(0), at(5), at(5)]);
  });

  test("the dropped rows are strictly later than the kept ones, so the next pass reads them whole", () => {
    const rows = [at(0), at(5), at(9), at(9)];
    const kept = trimIncompleteTail(rows, "created_at", 3);
    const cursor = kept[kept.length - 1]!.created_at.getTime();
    const resumeBound = cursor + 1;

    expect(kept).toEqual([at(0), at(5)]);

    for (const dropped of rows.slice(kept.length)) {
      expect(dropped.created_at.getTime()).toBeGreaterThanOrEqual(resumeBound);
    }
  });

  test("limit + 1 rows inside one millisecond fail loudly rather than skipping the rest of it silently", () => {
    const rows = [at(7), at(7), at(7), at(7)];

    expect(() => trimIncompleteTail(rows, "created_at", 3)).toThrow(
      /share one millisecond/
    );
  });

  test("an empty fetch stays empty", () => {
    expect(trimIncompleteTail([], "created_at", 3)).toEqual([]);
  });
});

describe("registry validation of sumColumn", () => {
  function moduleWith(
    metric: Record<string, unknown>
  ): readonly ModuleDescriptor[] {
    const stream = {
      streamKey: "events",
      tableName: "awcms_booking_reservation_events",
      cursorColumn: "created_at",
      metrics: [{ metricKey: "booked", effect: "increment", ...metric }]
    };
    const descriptor = {
      key: "booking.probe",
      version: 1,
      ownerModuleKey: "booking",
      scope: "tenant",
      description: "probe",
      source: { strategy: "cursor_table", streams: [stream] },
      rebuildSource: { streams: [stream] },
      metricLabels: { booked: "Booked" },
      requiredPermission: "booking.reports.read",
      freshness: {
        targetSeconds: 300,
        staleAfterSeconds: 900,
        errorAfterConsecutiveFailures: 3
      },
      retentionClass: "test",
      batchLimit: 100
    } as unknown as ProjectionDescriptor;

    return [
      {
        key: "booking",
        reportingProjections: [descriptor]
      } as unknown as ModuleDescriptor
    ];
  }

  test("a valid sumColumn passes", () => {
    expect(
      validateProjectionRegistry(moduleWith({ sumColumn: "booked_nights" }))
        .valid
    ).toBe(true);
  });

  test("an unsafe sumColumn identifier is refused", () => {
    const result = validateProjectionRegistry(
      moduleWith({ sumColumn: "booked_nights; DROP TABLE x" })
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0]!.message).toMatch(/sumColumn/);
  });

  test("a decrementing quantity is refused: the store clamps at zero and would desync silently", () => {
    const result = validateProjectionRegistry(
      moduleWith({ sumColumn: "booked_nights", effect: "decrement" })
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(" ")).toMatch(
      /decrement/
    );
  });
});
