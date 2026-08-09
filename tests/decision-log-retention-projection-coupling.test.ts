/**
 * ADR-0072 §E — two artifacts that must stay honest about each other.
 *
 * `identity_access` declares retention for `awcms_abac_decision_logs`, and
 * `reporting` reads that same table as a `cursor_table` projection source whose
 * description used to assert it is "never updated/deleted".
 *
 * Those two claims cannot both be true. The failure is silent and it is not the
 * projection breaking: an operator triggers a rebuild, the counts come back
 * smaller, and nothing anywhere says why. So the coupling is asserted here
 * rather than left to whoever edits one of the two files next.
 *
 * Both directions matter:
 *
 * - retention exists → the projection must NOT claim rows are never deleted, and
 *   must name the coupling;
 * - the projection reads the table → retention must actually be declared, so
 *   deleting the descriptor while leaving the corrected description in place
 *   fails too.
 */
import { describe, expect, test } from "bun:test";

import { identityAccessModule } from "../src/modules/identity-access/module";
import { reportingModule } from "../src/modules/reporting/module";

const DECISION_LOG_TABLE = "awcms_abac_decision_logs";
const LIFECYCLE_KEY = "identity_access.abac_decision_logs";

function decisionLogDescriptor() {
  return identityAccessModule.dataLifecycle?.find(
    (descriptor) => descriptor.key === LIFECYCLE_KEY
  );
}

function projectionsReadingDecisionLog() {
  // `ProjectionSourceContract` is a union — `domain_event` sources carry
  // `events`, not `streams`. Narrowing on `strategy` rather than reaching for
  // an optional property keeps this honest if a projection over this table is
  // ever re-sourced from events instead of a cursor.
  return (reportingModule.reportingProjections ?? []).filter(
    (projection) =>
      projection.source.strategy === "cursor_table" &&
      projection.source.streams.some(
        (stream) => stream.tableName === DECISION_LOG_TABLE
      )
  );
}

describe("ADR-0072 — decision-log retention", () => {
  test("the descriptor exists and is hard-delete under legal hold", () => {
    const descriptor = decisionLogDescriptor();

    expect(descriptor).toBeDefined();
    expect(descriptor!.tableName).toBe(DECISION_LOG_TABLE);
    expect(descriptor!.retentionClass).toBe("audit_security");
    expect(descriptor!.deletion.mode).toBe("hard_delete");
    expect(descriptor!.legalHold.applicable).toBe(true);
    expect(descriptor!.legalHold.precedence).toBe("overrides_retention");
  });

  test("the window is 365 days, and shortening it is a decision not an edit", () => {
    // ADR-0072 §C: the number is the rebuild horizon of `reporting`'s
    // access-audit projection, not a storage preference. Anyone lowering it is
    // shrinking what a rebuild can reconstruct, which is why it is asserted.
    const descriptor = decisionLogDescriptor();

    expect(descriptor!.defaultRetentionDays).toBe(365);
    expect(descriptor!.retentionMinDays).toBeGreaterThanOrEqual(90);
  });

  test("the required index is the EXISTING one, not a new ascending twin", () => {
    // sql/091's header: a btree is scannable backwards, so the DESC index from
    // sql/005 already serves the engine's ASC cursor scan. A second index would
    // add write amplification to the most-written table in the repo.
    const descriptor = decisionLogDescriptor();
    const index = descriptor!.requiredIndexes?.[0];

    expect(index?.columns).toEqual(["tenant_id", "created_at"]);
    expect(index?.purpose).toContain("sql/005");
  });
});

describe("ADR-0072 §E — the projection stays honest about the coupling", () => {
  test("at least one projection reads the table, or this test guards nothing", () => {
    // Without this the assertions below range over an empty array and pass
    // vacuously — the failure mode ADR-0072 itself is about, reproduced here.
    expect(projectionsReadingDecisionLog().length).toBeGreaterThan(0);
  });

  test("no projection over it still claims rows are never deleted", () => {
    for (const projection of projectionsReadingDecisionLog()) {
      expect(projection.description).not.toContain("never updated/deleted");
      expect(projection.description).not.toContain("never deleted");
    }
  });

  test("every projection over it names the retention coupling", () => {
    // The reader who needs this is the operator about to press rebuild.
    for (const projection of projectionsReadingDecisionLog()) {
      expect(projection.description).toContain("RETENTION COUPLING");
      expect(projection.description).toContain("ADR-0072");
    }
  });

  test("the coupling text is only owed BECAUSE retention was declared", () => {
    // The other direction: deleting the descriptor while keeping the corrected
    // description would leave the repo describing a coupling that no longer
    // exists. Asserting both here is what makes the pair one fact.
    expect(decisionLogDescriptor()).toBeDefined();
    expect(projectionsReadingDecisionLog().length).toBeGreaterThan(0);
  });
});
