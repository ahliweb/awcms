/**
 * Retention for the object sync upload queue (Issue #468, ADR-0072).
 *
 * Sibling of `email-queue-purge.test.ts`, and the two share one concern: a
 * retention job is the rare piece of code whose bug is invisible in production,
 * because rows are supposed to disappear.
 *
 * What is specific here is the ABSENCE that this module's descriptor list
 * documents. `awcms_sync_outbox` has zero producers repo-wide, so it keeps its
 * place on the debt ledger instead of receiving a descriptor that would be
 * fiction twice over. That claim is asserted rather than asserted-in-a-comment:
 * if somebody wires a producer, the assertion below fails and the descriptor
 * becomes required.
 *
 * Pure: registry + source text + `sql/`. No database, no network.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { syncStorageModule } from "../src/modules/sync-storage/module";
import { OBJECT_QUEUE_TERMINAL_STATUSES } from "../src/modules/sync-storage/application/object-queue-purge";
import {
  BOUNDED_BY_DESIGN,
  TABLES_PREDATING_THE_RULE
} from "../scripts/data-lifecycle-table-coverage-check";
import { WORKER_ROLE_GRANTS } from "../scripts/security-readiness";

const PURGE = "src/modules/sync-storage/application/object-queue-purge.ts";
const JOB = "scripts/object-queue-purge.ts";
const SCHEMA = "sql/012_awcms_object_sync_queue_schema.sql";
const MIGRATION = "sql/096_awcms_object_sync_queue_retention.sql";

function statusesFromSchema(): string[] {
  const source = readFileSync(SCHEMA, "utf8");
  const match = source.match(
    /awcms_object_sync_queue_status_check\s*\n?\s*CHECK \(status IN \(([\s\S]*?)\)\)/
  );

  return [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
    (found) => found[1]!
  );
}

describe("the terminal status list is derived from the schema, not guessed", () => {
  test("every status the CHECK allows is classified exactly once", () => {
    const live = ["pending", "sending"];
    const all = statusesFromSchema();

    expect(all.length).toBeGreaterThan(0);
    expect([...all].sort()).toEqual(
      [...OBJECT_QUEUE_TERMINAL_STATUSES, ...live].sort()
    );
  });

  test("`sending` is not terminal", () => {
    // The one worth naming: it reads as transient enough to ignore and is
    // exactly the row that must survive, because it may be mid-upload right
    // now. Its lease (`next_retry_at`) is the only thing that recovers it if
    // the dispatcher pass holding it died.
    expect(OBJECT_QUEUE_TERMINAL_STATUSES).not.toContain("sending");
    expect(OBJECT_QUEUE_TERMINAL_STATUSES).not.toContain("pending");
  });
});

describe("the DELETE names the statuses and the right cursor", () => {
  const source = readFileSync(PURGE, "utf8");

  test("terminal statuses are inline in the statement", () => {
    expect(source).toContain("status IN ('sent', 'failed')");
  });

  test("no live status appears in any statement", () => {
    // Comments stripped: this file EXPLAINS which statuses are live, and
    // matching that explanation is the self-match trap — always planted by the
    // fix, because a fix explains itself.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
      .join("\n");

    for (const live of ["'pending'", "'sending'"]) {
      expect(code).not.toContain(live);
    }
  });

  test("the cursor is created_at, and uploaded_at is never used as one", () => {
    // `uploaded_at` is the obvious substitute for the `updated_at` this table
    // does not have, and it is the wrong one: it is NULL for every `failed`
    // row, so a cursor on it would make failures immortal.
    expect(source).toContain("created_at < ${cutoff}");
    expect(source).not.toContain("uploaded_at <");
  });

  test("the legal hold is checked before anything is deleted", () => {
    expect(source.indexOf("isDescriptorHeld(")).toBeLessThan(
      source.indexOf("DELETE FROM awcms_object_sync_queue")
    );
  });
});

describe("the dry run counts what the delete would remove", () => {
  test("the preview uses the same terminal status list as the DELETE", () => {
    expect(readFileSync(JOB, "utf8")).toContain("status IN ('sent', 'failed')");
  });
});

describe("the descriptor and the ledger agree", () => {
  const descriptors = syncStorageModule.dataLifecycle ?? [];

  test("exactly one table is described, and it is delegated", () => {
    expect(descriptors.map((d) => d.tableName)).toEqual([
      "awcms_object_sync_queue"
    ]);
    expect(descriptors[0]!.executionMode).toBe("delegated");
    expect(descriptors[0]!.existingAdopter?.jobCommand).toBe(
      "bun run sync:objects:purge"
    );
  });

  test("the purged table is off the debt ledger", () => {
    expect(TABLES_PREDATING_THE_RULE).not.toContain("awcms_object_sync_queue");
  });

  test("the existing index is reused rather than a new one added", () => {
    // `awcms_object_sync_queue_tenant_status_created_idx` (sql/012) is already
    // the purge's exact shape. Declared DESC, which costs nothing — PostgreSQL
    // reads a btree backwards, so an ascending scan needs no sort.
    expect(readFileSync(MIGRATION, "utf8")).not.toContain("CREATE INDEX");
    expect(readFileSync(SCHEMA, "utf8")).toContain(
      "awcms_object_sync_queue_tenant_status_created_idx\n  ON awcms_object_sync_queue (tenant_id, status, created_at DESC)"
    );
  });

  test("the worker got DELETE, in SQL and in the readiness map", () => {
    expect(readFileSync(MIGRATION, "utf8")).toContain(
      "GRANT DELETE ON awcms_object_sync_queue TO awcms_worker;"
    );
    expect(WORKER_ROLE_GRANTS.awcms_object_sync_queue).toContain("DELETE");
  });
});

describe("awcms_sync_outbox is gone, and nothing quietly recreated it", () => {
  /**
   * ADR-0077 retired the table. What used to live here was a scan proving
   * NOTHING WROTE it — the premise its `BOUNDED_BY_DESIGN` entry rested on.
   * That premise has been superseded by a stronger one: the table does not
   * exist.
   *
   * The scan is kept, pointed at the whole repo rather than at writes alone,
   * because "retired" is a claim that decays quietly. A migration recreating
   * the table, or a route still selecting from it, would leave `sync/pull`
   * reading a second outbox again — the exact shape #477 was filed about — and
   * nothing else in the suite would notice.
   */
  /**
   * DDL and DML naming the retired table, anywhere under `src/` or `sql/`.
   *
   * Prose is deliberately NOT matched: `sql/010`, `sql/017`, `sql/096` and
   * `sql/098` all name the table in comments or superseded DDL, and applied
   * migrations are never edited. What must never come back is a table or a
   * READ — `sync/pull` reading a second outbox again is the exact shape #477
   * was filed about.
   */
  function ddlOrDmlNamingTheTable(): string[] {
    const offenders: string[] = [];
    const pattern =
      /(CREATE\s+TABLE(\s+IF\s+NOT\s+EXISTS)?|INSERT\s+INTO|UPDATE|FROM|JOIN)\s+awcms_sync_outbox\b/i;

    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|astro|sql)$/.test(entry.name)) continue;
        // The migration that drops it must name it in DDL to do so.
        if (entry.name.startsWith("099_")) continue;
        // `sql/010` created it and `sql/017` forced RLS on it; both are applied
        // and therefore immutable.
        if (/^(010|017)_/.test(entry.name)) continue;

        if (pattern.test(readFileSync(full, "utf8"))) {
          offenders.push(full);
        }
      }
    }

    walk("src");
    walk("sql");

    return offenders;
  }

  test("nothing creates it again, and nothing reads it again", () => {
    expect(ddlOrDmlNamingTheTable()).toEqual([]);
  });

  test("it is on neither list, because a table that does not exist needs no answer", () => {
    // The coverage gate derives its table set from `sql/`, and `DROP TABLE`
    // removes it there. An entry left behind on either list would be a claim
    // about nothing — which the gate itself now rejects as a stale entry.
    expect(TABLES_PREDATING_THE_RULE).not.toContain("awcms_sync_outbox");
    expect(BOUNDED_BY_DESIGN.map((entry) => entry.table)).not.toContain(
      "awcms_sync_outbox"
    );
  });
});
