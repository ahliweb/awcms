/**
 * Which archive-purge failures are EXPECTED (Issue #1040), and what the job
 * does about them.
 *
 * A delegated snapshot of a baseline table failing with 42501 must not make the
 * daily job exit non-zero (a permanent false alarm). Anything else must.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test
} from "bun:test";

import { applyJobExitCode } from "../src/lib/jobs/job-runner";
import type { JobResult } from "../src/lib/jobs/job-runner";
import {
  isKnownUnreadableDelegatedFailure,
  lifecycleFailureCode,
  summarizeArchivePurgeOutcome,
  type DataLifecycleArchivePurgeResult
} from "../src/modules/data-lifecycle/application/archive-purge-job";
import { KNOWN_UNREADABLE_DELEGATED_TABLES } from "../src/modules/data-lifecycle/domain/known-unreadable-delegated";

// The shipped baseline is EMPTY since #1042 (count-only functions, sql/303), but
// the mechanism stays; exercise it with a fixture entry added for this file only.
const BASELINE_TABLE = "awcms_fixture_unreadable_delegated";

beforeAll(() => {
  KNOWN_UNREADABLE_DELEGATED_TABLES.push(BASELINE_TABLE);
});

afterAll(() => {
  KNOWN_UNREADABLE_DELEGATED_TABLES.splice(
    KNOWN_UNREADABLE_DELEGATED_TABLES.indexOf(BASELINE_TABLE),
    1
  );
});

function pgError(sqlstate: string): Error {
  return Object.assign(new Error("secret row text must never be logged"), {
    errno: sqlstate,
    code: "ERR_POSTGRES_SERVER_ERROR"
  });
}

function result(
  overrides: Partial<DataLifecycleArchivePurgeResult> = {}
): DataLifecycleArchivePurgeResult {
  return {
    tenantsChecked: 1,
    descriptorsGeneric: 1,
    descriptorsDelegated: 29,
    totalArchived: 0,
    totalPurged: 0,
    totalDryRunEligible: 0,
    tenantsHitPassLimit: [],
    descriptorFailures: [],
    knownUnreadableDelegated: [],
    ...overrides
  };
}

/** Run the exit-code contract for a verdict and report the code. */
function exitCodeFor(status: "success" | "partial"): number {
  const before = process.exitCode;
  process.exitCode = 0;
  applyJobExitCode({ status } as unknown as JobResult);
  const code = Number(process.exitCode ?? 0);
  process.exitCode = before;

  return code;
}

afterEach(() => {
  process.exitCode = 0;
});

describe("which failures are expected", () => {
  test("a baseline table with 42501 is expected", () => {
    expect(
      isKnownUnreadableDelegatedFailure(BASELINE_TABLE, pgError("42501"))
    ).toBe(true);
  });

  test("a baseline table with another SQLSTATE is not", () => {
    expect(
      isKnownUnreadableDelegatedFailure(BASELINE_TABLE, pgError("42703"))
    ).toBe(false);
  });

  test("a table outside the baseline with 42501 is not", () => {
    expect(
      isKnownUnreadableDelegatedFailure(
        "awcms_not_on_the_list",
        pgError("42501")
      )
    ).toBe(false);
  });

  test("the code never carries the message", () => {
    expect(lifecycleFailureCode(pgError("42501"))).toBe("42501");
    expect(lifecycleFailureCode(new Error("row text"))).toBe("Error");
  });
});

describe("the job verdict and exit code", () => {
  test("only known-unreadable snapshots: success and exit code 0", () => {
    const outcome = summarizeArchivePurgeOutcome(
      result({ knownUnreadableDelegated: ["t1:inventory.movements"] })
    );

    expect(outcome.status).toBe("success");
    expect(outcome.detail).toContain("t1:inventory.movements");
    expect(exitCodeFor(outcome.status)).toBe(0);
  });

  test("an unexpected failure: partial and a non-zero exit code", () => {
    const outcome = summarizeArchivePurgeOutcome(
      result({
        knownUnreadableDelegated: ["t1:inventory.movements"],
        descriptorFailures: ["t1:comments.threads"]
      })
    );

    expect(outcome.status).toBe("partial");
    expect(exitCodeFor(outcome.status)).toBe(1);
  });

  test("an unfinished backlog is still partial", () => {
    const outcome = summarizeArchivePurgeOutcome(
      result({ tenantsHitPassLimit: ["t1"] })
    );

    expect(outcome.status).toBe("partial");
    expect(exitCodeFor(outcome.status)).toBe(1);
  });
});
