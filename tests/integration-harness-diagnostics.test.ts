/**
 * A killed migration must not be reported as a failed one.
 *
 * ## What this is for
 *
 * PR #259's integration job failed with:
 *
 *     error: db:migrate failed against the ephemeral integration database (exit 143).
 *
 * `db:migrate` had not failed. 143 is 128 + SIGTERM: the subprocess was KILLED
 * by bun's 5000ms per-hook default while `setupIntegrationDatabase()` was still
 * applying 70 migrations inside `beforeAll`. The run went green on a re-run with
 * no code change.
 *
 * The wording is the expensive part. "db:migrate failed" points a reader at
 * `sql/`, which is the one place the problem is not. The `--timeout 60000` now
 * on the CI step stops it happening; this branch makes the next occurrence —
 * a slower runner, more migrations — diagnose itself.
 *
 * No database: `describeMigrationFailure` is pure over an exit code, which is
 * exactly why it was extracted. A branch that only fires on an unattended CI
 * runner is one nobody would otherwise ever see run.
 */
import { describe, expect, test } from "bun:test";

import { describeMigrationFailure } from "./integration/harness";

describe("db:migrate failure diagnostics", () => {
  test("exit 143 is reported as KILLED, names the hook timeout, and points at the fix", () => {
    const message = describeMigrationFailure(143, 5001, "out", "err");

    expect(message).toContain("KILLED (SIGTERM)");
    expect(message).toContain("did NOT fail");
    expect(message).toContain("5001ms");
    // The three things a reader needs: what actually happened, where the budget
    // lives, and which file to edit.
    expect(message).toContain("per-hook timeout");
    expect(message).toContain("setupIntegrationDatabase()");
    expect(message).toContain("--timeout");
    expect(message).toContain(".github/workflows/{ci,release}.yml");
  });

  test("exit 143 does NOT claim the migration failed", () => {
    // The whole defect: the old message did. Asserting the absence is what
    // makes this a regression test rather than a restatement.
    const message = describeMigrationFailure(143, 5001, "", "");

    expect(message).not.toMatch(/^db:migrate failed/);
  });

  test("a genuine non-zero exit still reads as a failure, with the elapsed time", () => {
    const message = describeMigrationFailure(1, 812, "out", "syntax error");

    expect(message).toStartWith("db:migrate failed");
    expect(message).toContain("exit 1");
    expect(message).toContain("812ms");
    expect(message).toContain("syntax error");
    expect(message).not.toContain("SIGTERM");
  });

  test("both branches carry the subprocess output through", () => {
    for (const exitCode of [1, 143]) {
      const message = describeMigrationFailure(
        exitCode,
        10,
        "STDOUT-MARKER",
        "STDERR-MARKER"
      );

      expect(message).toContain("STDOUT-MARKER");
      expect(message).toContain("STDERR-MARKER");
    }
  });
});
