/**
 * Retention for the domain-event delivery ledger (Issue #468, ADR-0072).
 *
 * The third and last delegated purge in this repo, and the only one that needs
 * more than one predicate beyond the cutoff. The three sibling purges each
 * exclude non-terminal rows and stop; this one also has to refuse rows that a
 * replay record — or another delivery — still points at.
 *
 * Pure: registry + source text + `sql/`. No database, no network. The behaviour
 * against a real database is proven in the PR body with five rows that qualify
 * on age, of which four survive for four DIFFERENT reasons.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { domainEventRuntimeModule } from "../src/modules/domain-event-runtime/module";
import { SETTLED_DELIVERY_STATUSES } from "../src/modules/domain-event-runtime/application/delivery-retention-purge";
import { TABLES_PREDATING_THE_RULE } from "../scripts/data-lifecycle-table-coverage-check";
import { WORKER_ROLE_GRANTS } from "../scripts/security-readiness";

const PURGE =
  "src/modules/domain-event-runtime/application/delivery-retention-purge.ts";
const JOB = "scripts/domain-event-deliveries-purge.ts";
const SCHEMA = "sql/009_awcms_domain_event_runtime_schema.sql";
const MIGRATION = "sql/097_awcms_domain_event_deliveries_retention.sql";

function statusesFromSchema(): string[] {
  const source = readFileSync(SCHEMA, "utf8");
  const match = source.match(
    /awcms_domain_event_deliveries_status_check\s*\n?\s*CHECK \(status IN \(([\s\S]*?)\)\)/
  );

  return [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
    (found) => found[1]!
  );
}

describe("`dead_letter` is not settled, and that is the trap", () => {
  test("every status the CHECK allows is classified exactly once", () => {
    const notSettled = ["pending", "dead_letter"];
    const all = statusesFromSchema();

    expect(all.length).toBeGreaterThan(0);
    expect([...all].sort()).toEqual(
      [...SETTLED_DELIVERY_STATUSES, ...notSettled].sort()
    );
  });

  test("`dead_letter` is excluded from the settled set", () => {
    // It LOOKS terminal — the dispatcher will never retry one by itself — and
    // it is precisely the row an operator opens /admin/domain-events to find
    // and replay. A window that swept it would delete the work AND the evidence
    // of it, indistinguishably from the queue having drained cleanly.
    expect(SETTLED_DELIVERY_STATUSES).not.toContain("dead_letter");
    expect(SETTLED_DELIVERY_STATUSES).not.toContain("pending");
    expect([...SETTLED_DELIVERY_STATUSES].sort()).toEqual([
      "delivered",
      "skipped"
    ]);
  });
});

describe("the DELETE carries all three predicates", () => {
  const source = readFileSync(PURGE, "utf8");

  test("settled statuses are inline in the statement", () => {
    expect(source).toContain("d.status IN ('delivered', 'skipped')");
  });

  test("no unsettled status appears anywhere in the code", () => {
    // Comments stripped: this file EXPLAINS why dead_letter is excluded, and
    // matching that explanation would be the self-match trap — always planted
    // by the fix, because a fix explains itself.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
      .join("\n");

    for (const unsettled of ["'dead_letter'", "'pending'"]) {
      expect(code).not.toContain(unsettled);
    }
  });

  test("a row a replay record references is skipped", () => {
    // `awcms_domain_event_replays` carries two NOT NULL foreign keys into this
    // table. Deleting either side fails on the constraint, and a purge that
    // half-succeeds every night is worse than one that never runs.
    expect(source).toContain("FROM awcms_domain_event_replays r");
    expect(source).toContain("r.original_delivery_id = d.id");
    expect(source).toContain("r.replay_delivery_id = d.id");
  });

  test("a row another delivery references is skipped too", () => {
    // `replay_of_delivery_id` is a self-foreign-key: a replay attempt is a new
    // row pointing back at the original.
    expect(source).toContain("child.replay_of_delivery_id = d.id");
  });

  test("both guards are NOT EXISTS, evaluated inside the delete statement", () => {
    // A join would need a second round trip, and a row that becomes referenced
    // between the SELECT and the DELETE would be deleted anyway. One statement,
    // one transaction, no window.
    expect(source.match(/NOT EXISTS \(/g)?.length).toBe(2);
    expect(source).toContain("DELETE FROM awcms_domain_event_deliveries");
  });

  test("the legal hold is checked before anything is deleted", () => {
    expect(source.indexOf("isDescriptorHeld(")).toBeLessThan(
      source.indexOf("DELETE FROM awcms_domain_event_deliveries")
    );
  });
});

describe("the dry run counts what the delete would remove", () => {
  const job = readFileSync(JOB, "utf8");

  test("the preview repeats all three predicates", () => {
    // A preview that can disagree with the delete is worse than no preview.
    expect(job).toContain("d.status IN ('delivered', 'skipped')");
    expect(job).toContain("r.original_delivery_id = d.id");
    expect(job).toContain("child.replay_of_delivery_id = d.id");
  });
});

describe("the descriptor, the ledger, and the scope statement", () => {
  const descriptors = domainEventRuntimeModule.dataLifecycle ?? [];

  test("exactly one table is described, and it is delegated", () => {
    expect(descriptors.map((d) => d.tableName)).toEqual([
      "awcms_domain_event_deliveries"
    ]);
    expect(descriptors[0]!.executionMode).toBe("delegated");
    expect(descriptors[0]!.cursorColumn).toBe("updated_at");
    expect(descriptors[0]!.existingAdopter?.jobCommand).toBe(
      "bun run domain-events:deliveries:purge"
    );
  });

  test("the described table is off the debt ledger", () => {
    expect(TABLES_PREDATING_THE_RULE).not.toContain(
      "awcms_domain_event_deliveries"
    );
  });

  test("`awcms_domain_events` stays on it, deliberately", () => {
    // The parent holds the payloads and is the larger half of the disk problem.
    // Deleting deliveries does not shrink it, and how long an event PAYLOAD is
    // worth keeping is a different question from how long a delivery RECEIPT
    // is. Asserted so the scope statement cannot quietly become an omission.
    expect(TABLES_PREDATING_THE_RULE).toContain("awcms_domain_events");
    expect(descriptors.some((d) => d.tableName === "awcms_domain_events")).toBe(
      false
    );
  });

  test("the retention index is partial, on the purgeable statuses only", () => {
    // The closest existing index is (tenant_id, status) with no time column, so
    // on a table whose whole problem is accumulated `delivered` rows it would
    // mean reading every one of them to find the old ones. Partial because the
    // dispatcher's hot path is `status = 'pending'`.
    const migration = readFileSync(MIGRATION, "utf8");

    expect(migration).toContain(
      "ON awcms_domain_event_deliveries (tenant_id, updated_at)\n  WHERE status IN ('delivered', 'skipped')"
    );
  });

  test("the worker got DELETE, in SQL and in the readiness map", () => {
    expect(readFileSync(MIGRATION, "utf8")).toContain(
      "GRANT DELETE ON awcms_domain_event_deliveries TO awcms_worker;"
    );
    expect(WORKER_ROLE_GRANTS.awcms_domain_event_deliveries).toContain(
      "DELETE"
    );
  });
});
