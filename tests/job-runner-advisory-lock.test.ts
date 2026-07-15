import { describe, expect, test } from "bun:test";

import {
  JOB_LOCK_NAMESPACE,
  hashJobNameToInt32
} from "../src/lib/jobs/advisory-lock";

describe("hashJobNameToInt32 (Issue #697)", () => {
  test("is deterministic for the same job name", () => {
    expect(hashJobNameToInt32("logs:audit:purge")).toBe(
      hashJobNameToInt32("logs:audit:purge")
    );
  });

  test("different job names hash to different keys", () => {
    expect(hashJobNameToInt32("logs:audit:purge")).not.toBe(
      hashJobNameToInt32("modules:sync")
    );
    expect(hashJobNameToInt32("analytics:rollup")).not.toBe(
      hashJobNameToInt32("analytics:purge")
    );
  });

  test("always returns a non-negative value that fits Postgres int4", () => {
    for (const name of [
      "logs:audit:purge",
      "modules:sync",
      "email:dispatch",
      "sync:objects:dispatch",
      ""
    ]) {
      const hash = hashJobNameToInt32(name);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0x7fffffff);
      expect(Number.isInteger(hash)).toBe(true);
    }
  });

  test("JOB_LOCK_NAMESPACE is distinct from db-migrate.ts's own single-bigint lock key (975_202_601_372)", () => {
    expect(JOB_LOCK_NAMESPACE).not.toBe(975_202_601_372);
  });
});
