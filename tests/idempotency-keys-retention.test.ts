/**
 * Retention and subject-data classification of `awcms_idempotency_keys`
 * (Issue #1034, ADR-0145 amendment 1).
 *
 * Pure: reads the module registry, the migrations and the gate scripts. The
 * database half is `tests/integration/idempotency-keys-retention.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  domainEventRuntimeModule,
  IDEMPOTENCY_KEYS_DEFAULT_RETENTION_DAYS,
  IDEMPOTENCY_KEYS_LIFECYCLE_KEY
} from "../src/modules/domain-event-runtime/module";
import { TABLES_PREDATING_THE_RULE } from "../scripts/data-lifecycle-table-coverage-check";
import { NO_SUBJECT_DATA } from "../scripts/subject-data-coverage-check";
import { WORKER_ROLE_GRANTS } from "../scripts/security-readiness";

const ROOT = path.resolve(import.meta.dirname, "..");
const TABLE = "awcms_idempotency_keys";

const lifecycle = domainEventRuntimeModule.dataLifecycle?.find(
  (d) => d.tableName === TABLE
);
const subject = domainEventRuntimeModule.subjectData?.find(
  (d) => d.tableName === TABLE
);

describe("the lifecycle descriptor", () => {
  test("is a generic hard delete by created_at on the existing index", () => {
    expect(lifecycle?.key).toBe(IDEMPOTENCY_KEYS_LIFECYCLE_KEY);
    expect(lifecycle?.executionMode).toBe("generic");
    expect(lifecycle?.deletion.mode).toBe("hard_delete");
    expect(lifecycle?.cursorColumn).toBe("created_at");
    expect(lifecycle?.archive.archivable).toBe(false);
    expect(lifecycle?.requiredIndexes[0]?.columns).toEqual([
      "tenant_id",
      "created_at"
    ]);
  });

  test("the horizon is comfortably longer than the 24 hour deploy-straddle guard", () => {
    expect(IDEMPOTENCY_KEYS_DEFAULT_RETENTION_DAYS).toBe(30);
    expect(lifecycle?.defaultRetentionDays).toBe(30);
    // An override can never reach the guard: even the floor is a week.
    expect(lifecycle!.retentionMinDays).toBeGreaterThanOrEqual(7);
    expect(lifecycle!.retentionMaxDays).toBeGreaterThanOrEqual(
      lifecycle!.defaultRetentionDays
    );
  });

  test("the table is off the debt ledger", () => {
    expect(TABLES_PREDATING_THE_RULE).not.toContain(TABLE);
  });
});

describe("the subject-data classification", () => {
  test("is answered by a descriptor, not by a refusal that claims no personal data", () => {
    expect(subject).toBeDefined();
    expect(NO_SUBJECT_DATA.map((entry) => entry.table)).not.toContain(TABLE);
  });

  test("is unreachable, never exported, retained and bounded by the purge", () => {
    expect(subject?.unreachableBySubject).toBe(true);
    expect(subject?.subjectColumns).toEqual([]);
    expect(subject?.exportable).toBe(false);
    expect(subject?.erasure).toBe("retain_under_obligation");
    expect(subject?.redactedColumns).toContain("response_body");
    expect(subject?.rationale).toContain(IDEMPOTENCY_KEYS_LIFECYCLE_KEY);
  });
});

describe("the worker privilege", () => {
  test("sql/276 grants exactly SELECT and DELETE", () => {
    const migration = readFileSync(
      path.join(ROOT, "sql/276_awcms_idempotency_keys_worker_purge_grant.sql"),
      "utf8"
    );

    expect(migration).toMatch(
      /GRANT SELECT, DELETE ON awcms_idempotency_keys TO awcms_worker;/
    );
    expect(migration).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE)\b/);
  });

  test("the security-readiness matrix lists the same pair", () => {
    expect([...WORKER_ROLE_GRANTS[TABLE]!].sort()).toEqual([
      "DELETE",
      "SELECT"
    ]);
  });
});
