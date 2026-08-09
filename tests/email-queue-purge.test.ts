/**
 * Retention for the email outbox (Issue #468, ADR-0072).
 *
 * The interesting assertions here are all about ONE thing: that the purge
 * cannot delete work. A retention job is the rare piece of code whose bug is
 * invisible in production — rows are supposed to disappear, so rows
 * disappearing wrongly looks exactly like the job succeeding.
 *
 * Pure: registry + source text + `sql/`. No database, no network. The
 * behaviour against a real database is proven separately in the PR body, by
 * running the predicate with a cutoff 400 days in the FUTURE and showing that
 * `queued` and `sending` rows survive it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { emailModule } from "../src/modules/email/module";
import { EMAIL_TERMINAL_STATUSES } from "../src/modules/email/application/email-queue-purge";
import { TABLES_PREDATING_THE_RULE } from "../scripts/data-lifecycle-table-coverage-check";
import { WORKER_ROLE_GRANTS } from "../scripts/security-readiness";

const PURGE = "src/modules/email/application/email-queue-purge.ts";
const JOB = "scripts/email-queue-purge.ts";
const SCHEMA = "sql/014_awcms_email_schema.sql";
const MIGRATION = "sql/095_awcms_email_retention.sql";

/**
 * Every status the schema's CHECK constraint allows.
 *
 * The slice is bounded by the constraint's own `CHECK (status IN (...))` rather
 * than by the next identifier in the file. The first draft ran to the following
 * index and swept up the dispatcher-index COMMENT, which quotes three of the
 * statuses — so the list came back with duplicates and the test failed for a
 * reason that had nothing to do with the schema.
 */
function statusesFromSchema(): string[] {
  const source = readFileSync(SCHEMA, "utf8");
  const match = source.match(
    /awcms_email_messages_status_check\s*\n?\s*CHECK \(status IN \(([\s\S]*?)\)\)/
  );

  return [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
    (found) => found[1]!
  );
}

describe("the terminal status list is derived from the schema, not guessed", () => {
  test("every status the CHECK allows is classified exactly once", () => {
    // The failure this prevents is silent in BOTH directions. A status added to
    // the schema and not here accumulates forever with no error; a status added
    // here that is not terminal deletes live work.
    const live = ["queued", "sending", "retry_wait"];
    const all = statusesFromSchema();

    expect(all.length).toBeGreaterThan(0);
    expect([...all].sort()).toEqual(
      [...EMAIL_TERMINAL_STATUSES, ...live].sort()
    );
  });

  test("`suppressed` is terminal and `sending` is not", () => {
    // The two easiest to get backwards. `suppressed` means the address was on
    // the suppression list at dispatch time — a final answer. `sending` is
    // claimed by a dispatcher pass that may be mid-flight, and its lease is
    // what recovers it if that pass died.
    expect(EMAIL_TERMINAL_STATUSES).toContain("suppressed");
    expect(EMAIL_TERMINAL_STATUSES).not.toContain("sending");
    expect(EMAIL_TERMINAL_STATUSES).not.toContain("queued");
    expect(EMAIL_TERMINAL_STATUSES).not.toContain("retry_wait");
  });
});

describe("the DELETE names the statuses — the descriptor cannot express them", () => {
  const source = readFileSync(PURGE, "utf8");

  test("the message step lists every terminal status inline", () => {
    // This is the assertion that makes `executionMode: "delegated"` worth
    // anything. Delegation only MOVES the responsibility here; if the delegated
    // implementation forgets the predicate it deletes pending work exactly as
    // the generic engine would.
    expect(source).toContain(
      "m.status IN ('sent', 'failed', 'cancelled', 'suppressed')"
    );
  });

  test("no live status appears in any statement", () => {
    // Comments stripped first: this file EXPLAINS which statuses are live, and
    // matching that explanation would be the self-match trap this repo has hit
    // three times — always planted by the fix, because a fix explains itself.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
      .join("\n");

    for (const live of ["'queued'", "'sending'", "'retry_wait'"]) {
      expect(code).not.toContain(live);
    }
  });

  test("attempts are deleted before messages, and the FK is respected both ways", () => {
    // Order matters: `awcms_email_delivery_attempts.message_id` references the
    // other table, so deleting a message whose attempts still point at it fails
    // on the foreign key. A purge that half-succeeds every night is worse than
    // one that never runs — the error is intermittent and the backlog grows.
    expect(
      source.indexOf("DELETE FROM awcms_email_delivery_attempts")
    ).toBeLessThan(source.indexOf("DELETE FROM awcms_email_messages"));
    // And the message step skips any row that still has attempts, so a
    // batch-limited attempt step cannot make the message step fail.
    expect(source).toContain("SELECT 1 FROM awcms_email_delivery_attempts a");
  });

  test("each table is gated on its OWN legal hold", () => {
    for (const key of [
      "EMAIL_ATTEMPTS_LIFECYCLE_KEY",
      "EMAIL_MESSAGES_LIFECYCLE_KEY"
    ]) {
      expect(source).toContain(key);
    }
    expect(source.match(/isDescriptorHeld\(/g)?.length).toBe(2);
  });
});

describe("the dry run counts what the delete would remove", () => {
  test("the preview uses the same terminal status list as the DELETE", () => {
    // A preview that can disagree with the delete is worse than no preview.
    // The two SQL fragments are deliberately written out separately (this repo
    // has no shared SQL builder), so they are pinned against each other here.
    const job = readFileSync(JOB, "utf8");

    expect(job).toContain(
      "status IN ('sent', 'failed', 'cancelled', 'suppressed')"
    );
  });

  test("the dry run exists here even though push:queue:purge deliberately has none", () => {
    // Not an inconsistency: `push:queue:purge`'s tables were created by the
    // same PR as that job, so its first run has at most one retention window
    // behind it. These two tables have accumulated since `sql/014` with no
    // retention at all, so the FIRST run on a live deployment is the largest
    // delete this job will ever do, against rows nobody has counted.
    const job = readFileSync(JOB, "utf8");

    expect(job).toContain('process.argv.includes("--dry-run")');
    expect(job).toContain("DRY RUN");
  });
});

describe("the descriptors and the ledger agree", () => {
  const descriptors = emailModule.dataLifecycle ?? [];

  test("both tables carry a descriptor and both are delegated", () => {
    expect(descriptors.map((d) => d.tableName).sort()).toEqual([
      "awcms_email_delivery_attempts",
      "awcms_email_messages"
    ]);

    for (const descriptor of descriptors) {
      expect(descriptor.executionMode).toBe("delegated");
      expect(descriptor.existingAdopter?.purgeFunctionRef).toContain(
        "email-queue-purge.ts#purgeEmailQueue"
      );
      expect(descriptor.existingAdopter?.jobCommand).toBe(
        "bun run email:queue:purge"
      );
    }
  });

  test("the message sweep is keyed on updated_at, not created_at", () => {
    // `created_at` would measure a long-retried message from before its last
    // attempt, making it eligible while it was still being worked on.
    const byTable = new Map(descriptors.map((d) => [d.tableName, d]));

    expect(byTable.get("awcms_email_messages")!.cursorColumn).toBe(
      "updated_at"
    );
    expect(byTable.get("awcms_email_delivery_attempts")!.cursorColumn).toBe(
      "attempted_at"
    );
  });

  test("neither table is still on the debt ledger", () => {
    // The gate treats a ledgered table that HAS a descriptor as an error rather
    // than a tolerated duplicate, so this and the descriptors above must land
    // together — which is the property being asserted.
    expect(TABLES_PREDATING_THE_RULE).not.toContain("awcms_email_messages");
    expect(TABLES_PREDATING_THE_RULE).not.toContain(
      "awcms_email_delivery_attempts"
    );
  });
});

describe("the worker got exactly the verb the purge needs", () => {
  test("sql/095 grants DELETE and the code-side grant map agrees", () => {
    // `sql/022` gave the worker what the DISPATCHER needs and nothing more,
    // which was right. The purge is a second worker entrypoint with a different
    // job. Both halves are asserted because a grant in SQL that the readiness
    // map does not know about is a privilege nothing reviews.
    const migration = readFileSync(MIGRATION, "utf8");

    expect(migration).toContain(
      "GRANT DELETE ON awcms_email_messages TO awcms_worker;"
    );
    expect(migration).toContain(
      "GRANT DELETE ON awcms_email_delivery_attempts TO awcms_worker;"
    );
    expect(WORKER_ROLE_GRANTS.awcms_email_messages).toContain("DELETE");
    expect(WORKER_ROLE_GRANTS.awcms_email_delivery_attempts).toContain(
      "DELETE"
    );
  });

  test("the purge index is the purge's own, not the dispatcher's", () => {
    // `awcms_email_messages_dispatch_idx` covers the OPPOSITE status set
    // (`queued`/`retry_wait`) and is keyed on `next_attempt_at`, so reusing it
    // would leave the purge scanning.
    const migration = readFileSync(MIGRATION, "utf8");

    expect(migration).toContain(
      "awcms_email_messages_retention_idx\n  ON awcms_email_messages (tenant_id, status, updated_at)"
    );
  });
});
