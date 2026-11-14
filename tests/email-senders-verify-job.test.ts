/**
 * `email:senders:verify` as a scheduled job (audit L-1 and L-2 of PR #1301).
 *
 * - L-2: with `EMAIL_SENDER_ROUTING_ENABLED` unset the job must be a no-op that
 *   never reaches the database. Proven by running the real script with an
 *   unreachable `DATABASE_URL`: only the guard can make it exit 0.
 * - L-1: a run that probed nothing because the secret store could not hand over
 *   a token must exit non-zero, because cron monitoring sees only the exit code.
 *   (Counting the failures is covered in
 *   tests/integration/email-sender-routing.integration.test.ts.)
 */
import { describe, expect, test } from "bun:test";

import { emailSendersVerifyRunFailed } from "../src/modules/email/application/email-sender-verify";

describe("email:senders:verify script guard (audit L-2)", () => {
  test("routing off: SKIPPED, exit 0, and no connection is attempted", () => {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    delete env.EMAIL_SENDER_ROUTING_ENABLED;
    env.DATABASE_URL = "postgres://nobody:none@127.0.0.1:1/none";
    env.WORKER_DATABASE_URL = "postgres://nobody:none@127.0.0.1:1/none";

    const result = Bun.spawnSync(["bun", "scripts/email-senders-verify.ts"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000
    });
    const out = `${result.stdout.toString()}${result.stderr.toString()}`;

    expect(out).toContain("email:senders:verify SKIPPED");
    expect(out).not.toContain("FAILED");
    expect(result.exitCode).toBe(0);
  });

  test("routing on with an unreachable database: exit non-zero, never a silent success", () => {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    env.EMAIL_SENDER_ROUTING_ENABLED = "true";
    env.DATABASE_URL = "postgres://nobody:none@127.0.0.1:1/none";

    const result = Bun.spawnSync(["bun", "scripts/email-senders-verify.ts"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000
    });

    expect(result.exitCode).not.toBe(0);
  });
});

describe("emailSendersVerifyRunFailed (audit L-1)", () => {
  const ok = { accounts: 3, accountsProbed: 3, secretStoreFailures: 0 };

  test("a healthy run passes, and so does a run with nothing to do", () => {
    expect(emailSendersVerifyRunFailed(ok, 0)).toBe(false);
    expect(
      emailSendersVerifyRunFailed(
        { accounts: 0, accountsProbed: 0, secretStoreFailures: 0 },
        0
      )
    ).toBe(false);
  });

  test("MUTANT: a failed tenant, a secret-store failure, or accounts with nothing probed each fail the run", () => {
    expect(emailSendersVerifyRunFailed(ok, 1)).toBe(true);
    expect(
      emailSendersVerifyRunFailed({ ...ok, secretStoreFailures: 1 }, 0)
    ).toBe(true);
    expect(
      emailSendersVerifyRunFailed(
        { accounts: 2, accountsProbed: 0, secretStoreFailures: 0 },
        0
      )
    ).toBe(true);
  });
});
