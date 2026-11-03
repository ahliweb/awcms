/**
 * The `e2e-smoke` job really exercises the channel-account screens (Issue #1154).
 *
 * `/admin/channel-accounts/[id]` is a dynamic route: the render sweep derives its
 * id from the listing and FAILS (never skips) when there is no link. That is only
 * satisfiable if the job switches the module on and seeds one account, and the
 * opt-in spec only runs if the job says the module is on. Nothing in the repo
 * proves the workflow does either, so a later edit that drops the env or the seed
 * would turn the sweep red for a reason far from its cause, or (worse, if the
 * sweep were ever relaxed) silently stop requesting the screen. This pins both.
 *
 * Pure: reads the workflow and the specs as text.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const e2eStep = workflow.slice(
  workflow.indexOf("Start server, seed a tenant via the setup wizard")
);

describe("the e2e-smoke job turns the channel-account screens on", () => {
  test("it enables the module with the origin it requires, and a run-time key ring", () => {
    expect(e2eStep).toContain('CHANNEL_ACCOUNTS_ENABLED: "true"');
    expect(e2eStep).toContain("APP_URL: http://127.0.0.1:4321");
    // Generated at run time: a committed ring literal would be scanned as a secret.
    expect(e2eStep).toMatch(
      /CHANNEL_SECRETS_ENCRYPTION_KEYS="k1:\$\(openssl rand -base64 32\)"/
    );
    // The ring is set BEFORE the server starts, or it never sees it.
    expect(e2eStep.indexOf("CHANNEL_SECRETS_ENCRYPTION_KEYS=")).toBeLessThan(
      e2eStep.indexOf("bun ./dist/standalone-entry.mjs")
    );
  });

  test("it tells the specs the module is on, and seeds one neutral account", () => {
    expect(e2eStep).toContain('E2E_CHANNEL_ACCOUNTS: "1"');
    expect(e2eStep).toContain("INSERT INTO awcms_channel_accounts");
    // After the tenant exists (the seed names it), before the specs run.
    expect(
      e2eStep.indexOf("INSERT INTO awcms_channel_accounts")
    ).toBeGreaterThan(e2eStep.indexOf('export E2E_TENANT_ID="$tenant_id"'));
    expect(e2eStep.indexOf("INSERT INTO awcms_channel_accounts")).toBeLessThan(
      e2eStep.indexOf("bun run test:e2e")
    );
  });

  test("the sweep has no exception for the route: it must derive a real id", () => {
    const sweep = readFileSync("tests/e2e/admin-screens-render.e2e.ts", "utf8");

    expect(sweep).not.toContain("channel-accounts");
  });

  test("the opt-in spec exists and is in the write wave", () => {
    const waves = readFileSync("tests/e2e/support/e2e-waves.ts", "utf8");

    expect(waves).toContain('"admin-channel-accounts.e2e.ts"');
    expect(
      readFileSync("tests/e2e/admin-channel-accounts.e2e.ts", "utf8")
    ).toContain('process.env.E2E_CHANNEL_ACCOUNTS === "1"');
  });
});
