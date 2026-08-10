/**
 * Lifecycle descriptors for infrastructure-owned tables (ADR-0076, Issue #479).
 *
 * The registry itself is easy to test and not the interesting part. What is
 * interesting is the control that stops it becoming a parking lot: a table gets
 * to be called "infrastructure" only if the write-ownership classifier —
 * `ownerOfFile`, the one `modules:table-writes:check` already uses — says it is.
 * Every assertion about that is fed a planted census containing the defect it
 * must catch, because a coverage gate can be green while every one of its
 * answers is wrong.
 *
 * Pure: no database, no network. The SQL assertions run against a recording
 * fake, which is enough — what they check is which statement was issued and
 * with what cutoff, not what Postgres did with it.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  collectAllLifecycleDescriptorKeys,
  EDGE_CACHE_DONE_RETENTION_DAYS,
  EDGE_CACHE_FAILED_RETENTION_DAYS,
  EDGE_CACHE_PURGES_LIFECYCLE_KEY,
  findInfrastructureOwnershipProblems,
  INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
  validateInfrastructureLifecycleRegistry,
  type InfrastructureLifecycleDescriptor
} from "../src/modules/data-lifecycle/domain/infrastructure-lifecycle-registry";
import { collectHighVolumeTableDescriptors } from "../src/modules/data-lifecycle/domain/lifecycle-registry";
import { pruneTerminalEdgeCachePurges } from "../src/lib/edge-cache/purge-queue";
import {
  collectDescribedTables,
  TABLES_PREDATING_THE_RULE
} from "../scripts/data-lifecycle-table-coverage-check";
import { INFRASTRUCTURE_OWNER } from "../scripts/table-write-ownership-check";

const MODULE_KEYS = listModules().map((module) => module.key);
const MODULE_TABLES = collectHighVolumeTableDescriptors(listModules()).map(
  (descriptor) => descriptor.tableName
);

function validate(
  descriptors: readonly InfrastructureLifecycleDescriptor[],
  moduleTables: readonly string[] = MODULE_TABLES
) {
  return validateInfrastructureLifecycleRegistry(
    descriptors,
    moduleTables,
    MODULE_KEYS
  );
}

/** A clone of the real descriptor, so a mutation test changes exactly one thing. */
function descriptorWith(
  overrides: Partial<InfrastructureLifecycleDescriptor>
): InfrastructureLifecycleDescriptor {
  return { ...INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS[0]!, ...overrides };
}

describe("the registry that ships", () => {
  test("is valid", () => {
    const result = validate(INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS);

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("describes exactly the edge cache purge queue today", () => {
    expect(
      INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS.map((d) => d.tableName)
    ).toEqual(["awcms_edge_cache_purges"]);
  });

  test("its owner really is infrastructure, checked against the writers in src/", async () => {
    // The load-bearing assertion of the whole ADR, run against the REAL census
    // rather than a planted one: if somebody moves the INSERT into a module,
    // this goes red and the descriptor has to move with it.
    const { collectTableWrites } =
      await import("../scripts/table-write-ownership-check");

    expect(
      findInfrastructureOwnershipProblems(
        INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
        await collectTableWrites(),
        INFRASTRUCTURE_OWNER
      )
    ).toEqual([]);
  });
});

describe("ownership cannot be claimed wrongly, in either direction", () => {
  test("a table written by a MODULE is refused", () => {
    const problems = findInfrastructureOwnershipProblems(
      INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
      [{ table: "awcms_edge_cache_purges", owner: "blog_content" }],
      INFRASTRUCTURE_OWNER
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("blog_content");
    expect(problems[0]!.message).toContain("not by infrastructure");
  });

  test("one module writer among infrastructure writers is still refused", () => {
    // The realistic shape of the mistake: the table stays mostly infrastructure
    // and one module starts writing it directly. A check that only looked at
    // the FIRST writer, or at the majority, would pass this.
    const problems = findInfrastructureOwnershipProblems(
      INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
      [
        { table: "awcms_edge_cache_purges", owner: INFRASTRUCTURE_OWNER },
        { table: "awcms_edge_cache_purges", owner: "theming" }
      ],
      INFRASTRUCTURE_OWNER
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("theming");
  });

  test("a table nothing writes is refused rather than assumed", () => {
    const problems = findInfrastructureOwnershipProblems(
      INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
      [{ table: "awcms_something_else", owner: INFRASTRUCTURE_OWNER }],
      INFRASTRUCTURE_OWNER
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("no file in src/ writes");
  });

  test("the owner literal is passed in, so a drifted copy fails loudly", () => {
    // If the script's constant were re-typed here and later changed there, the
    // gate would match nothing and stay green forever. Feeding the wrong
    // literal must therefore produce a failure, not silence.
    const problems = findInfrastructureOwnershipProblems(
      INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
      [{ table: "awcms_edge_cache_purges", owner: INFRASTRUCTURE_OWNER }],
      "(some other spelling)"
    );

    expect(problems).toHaveLength(1);
  });
});

describe("the registry refuses descriptors that would misrepresent themselves", () => {
  test("a key namespaced as a registered module is refused", () => {
    const result = validate([descriptorWith({ key: "blog_content.purges" })]);

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.message).join(" ")).toContain(
      "is a REGISTERED MODULE key"
    );
  });

  test("`edge_cache` is NOT a module key, which is why the shipped key is allowed", () => {
    // Guards the test above from becoming vacuous: if an `edge_cache` module
    // were ever added, the shipped descriptor would have to be re-keyed and
    // this states that in the place somebody would look.
    expect(MODULE_KEYS).not.toContain("edge_cache");
    expect(EDGE_CACHE_PURGES_LIFECYCLE_KEY.split(".")[0]).toBe("edge_cache");
  });

  test("an ownerPath outside src/lib/ is refused", () => {
    for (const ownerPath of [
      "src/modules/theming/",
      "src/lib/edge-cache",
      "scripts/",
      ""
    ]) {
      expect(validate([descriptorWith({ ownerPath })]).valid).toBe(false);
    }
  });

  test("executionMode other than delegated is refused", () => {
    const generic = descriptorWith({
      executionMode: "generic" as "delegated"
    });

    const result = validate([generic]);

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.message).join(" ")).toContain(
      'must be "delegated"'
    );
  });

  test("a table already described by a module is refused", () => {
    const result = validate(INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS, [
      ...MODULE_TABLES,
      "awcms_edge_cache_purges"
    ]);

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.message).join(" ")).toContain(
      "ALSO declared by a module"
    );
  });

  test("the same table twice is refused", () => {
    const result = validate([
      ...INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS,
      descriptorWith({ key: "edge_cache.purges_again" })
    ]);

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.message).join(" ")).toContain(
      "registered 2 times"
    );
  });

  test("the shared shape rules still apply — a broken retention window is refused", () => {
    const result = validate([
      descriptorWith({ retentionMinDays: 90, defaultRetentionDays: 7 })
    ]);

    expect(result.valid).toBe(false);
  });
});

describe("legal hold reaches the second registry", () => {
  test("the infrastructure key is a valid hold target", () => {
    expect(collectAllLifecycleDescriptorKeys(listModules())).toContain(
      EDGE_CACHE_PURGES_LIFECYCLE_KEY
    );
  });

  test("every module key is still a valid hold target", () => {
    const keys = collectAllLifecycleDescriptorKeys(listModules());

    for (const descriptor of collectHighVolumeTableDescriptors(listModules())) {
      expect(keys).toContain(descriptor.key);
    }
  });
});

type Call = { sql: string; values: unknown[] };

function recordingTx(rowsPerCall: number[] = []) {
  const calls: Call[] = [];
  let index = 0;

  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ sql: strings.join(" ? "), values });
    const count = rowsPerCall[index++] ?? 0;

    return Promise.resolve(
      Array.from({ length: count }, (_, i) => ({ id: `row-${i}` }))
    );
  }) as unknown as Bun.SQL;

  return { tx, calls };
}

const NEVER_HELD = { isDescriptorHeld: async () => false };
const ALWAYS_HELD = { isDescriptorHeld: async () => true };

describe("the delegated purge the descriptor points at", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");

  test("an active legal hold stops it issuing any DELETE at all", async () => {
    const { tx, calls } = recordingTx();

    const result = await pruneTerminalEdgeCachePurges(
      tx,
      "tenant-1",
      ALWAYS_HELD,
      { now, limit: 100 }
    );

    expect(result).toEqual({
      prunedCompleted: 0,
      prunedFailed: 0,
      heldByLegalHold: true
    });
    // Returning zeros while still deleting would satisfy the assertion above.
    expect(calls).toHaveLength(0);
  });

  test("it asks about THIS descriptor's key, not a tenant-wide guess", async () => {
    let askedFor = "";
    const { tx } = recordingTx();

    await pruneTerminalEdgeCachePurges(
      tx,
      "tenant-1",
      {
        isDescriptorHeld: async (_tx, _tenantId, key) => {
          askedFor = key;

          return false;
        }
      },
      { now, limit: 100 }
    );

    expect(askedFor).toBe(EDGE_CACHE_PURGES_LIFECYCLE_KEY);
  });

  test("both terminal statuses are pruned, each on its own window", async () => {
    const { tx, calls } = recordingTx([3, 2]);

    const result = await pruneTerminalEdgeCachePurges(
      tx,
      "tenant-1",
      NEVER_HELD,
      { now, limit: 100 }
    );

    expect(result).toEqual({
      prunedCompleted: 3,
      prunedFailed: 2,
      heldByLegalHold: false
    });
    expect(calls).toHaveLength(2);

    expect(calls[0]!.sql).toContain("status = 'done'");
    expect(calls[0]!.sql).toContain("completed_at <");
    expect(calls[1]!.sql).toContain("status = 'failed'");

    const day = 24 * 60 * 60 * 1_000;
    expect(calls[0]!.values).toContainEqual(
      new Date(now.getTime() - EDGE_CACHE_DONE_RETENTION_DAYS * day)
    );
    expect(calls[1]!.values).toContainEqual(
      new Date(now.getTime() - EDGE_CACHE_FAILED_RETENTION_DAYS * day)
    );
  });

  test("the failed prune orders on created_at — completed_at is NULL on those rows", async () => {
    // An exhausted row never completed. Written against `completed_at` the
    // statement would be valid SQL that matches nothing, and the table would
    // keep growing while the job reported success.
    const { tx, calls } = recordingTx([0, 0]);

    await pruneTerminalEdgeCachePurges(tx, "tenant-1", NEVER_HELD, {
      now,
      limit: 100
    });

    expect(calls[1]!.sql).toContain("created_at <");
    expect(calls[1]!.sql).not.toContain("completed_at");
  });

  test("the windows are the ones the descriptor publishes", () => {
    const descriptor = INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS[0]!;

    expect(descriptor.defaultRetentionDays).toBe(
      EDGE_CACHE_DONE_RETENTION_DAYS
    );
    expect(descriptor.retentionMaxDays).toBe(EDGE_CACHE_FAILED_RETENTION_DAYS);
    expect(EDGE_CACHE_FAILED_RETENTION_DAYS).toBeGreaterThan(
      EDGE_CACHE_DONE_RETENTION_DAYS
    );
  });
});

describe("the coverage ledger records the debt as paid", () => {
  test("the table is no longer on TABLES_PREDATING_THE_RULE", () => {
    expect(TABLES_PREDATING_THE_RULE).not.toContain("awcms_edge_cache_purges");
  });

  test("and it counts as described, so the gate does not simply stop seeing it", () => {
    // Removing the ledger entry without teaching the gate about the second
    // registry would have turned a described table into an undescribed one —
    // the same green-for-the-wrong-reason this ADR is about.
    expect(collectDescribedTables()).toContain("awcms_edge_cache_purges");
  });
});
