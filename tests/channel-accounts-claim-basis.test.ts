/**
 * The claim basis of a channel account (Issue #1215, ADR-0170, amending ADR-0148
 * invariant I1) and the platform release action that backs it. Pure: no database.
 *
 * What it defends: a provider is only on the "claimed by verification" list in
 * the SAME change as the connector call that proves its id. Widening that list
 * on a hunch re-opens external-id squatting for exactly the providers where the
 * proof is missing, with every other check still green; and the locator that
 * reads across tenants must stay a single-caller function.
 */
import { readdir, readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import {
  PROVIDER_MATRIX,
  VERIFIED_CLAIM_KINDS,
  claimBasisFor
} from "../src/modules/channel-accounts/domain/provider-matrix";

describe("claimBasisFor", () => {
  test("exactly the two proven (provider, kind) pairs claim by verification", () => {
    expect(VERIFIED_CLAIM_KINDS).toEqual({
      telegram: ["bot"],
      mailketing: ["sender_identity"]
    });
    expect(claimBasisFor("telegram", "bot")).toBe("verification");
    expect(claimBasisFor("mailketing", "sender_identity")).toBe("verification");
  });

  test("everything else holds the claim from registration, the fail-closed default", () => {
    for (const [provider, row] of Object.entries(PROVIDER_MATRIX)) {
      for (const kind of Object.keys(row.kinds)) {
        const expected =
          (provider === "telegram" && kind === "bot") ||
          (provider === "mailketing" && kind === "sender_identity")
            ? "verification"
            : "registration";

        expect(claimBasisFor(provider, kind)).toBe(expected);
      }
    }

    // Unknown inputs never reach `verification`, including prototype keys.
    expect(claimBasisFor("starsender", "device")).toBe("registration");
    expect(claimBasisFor("telegram", "channel")).toBe("registration");
    expect(claimBasisFor("mailketing", "esp_account")).toBe("registration");
    expect(claimBasisFor("nope", "bot")).toBe("registration");
    expect(claimBasisFor("__proto__", "bot")).toBe("registration");
    expect(claimBasisFor("constructor", "toString")).toBe("registration");
  });

  test("every kind on the verification list is a real registrable kind of its provider", () => {
    for (const [provider, kinds] of Object.entries(VERIFIED_CLAIM_KINDS)) {
      const row = PROVIDER_MATRIX[provider];

      expect(row).toBeDefined();
      expect(row!.registrable).toBe(true);

      for (const kind of kinds) expect(row!.kinds[kind]).toBeDefined();
    }
  });
});

describe("each verification-basis provider has the connector call that proves it", () => {
  test("telegram bot: the connector binds the token to the account's id with getMe and then reports health", async () => {
    const dispatch = await readFile(
      "src/modules/telegram-engagement/application/dispatch.ts",
      "utf8"
    );

    expect(dispatch).toContain('"getMe"');
    expect(dispatch).toContain("botId !== material.externalId");
    expect(dispatch).toContain("BOT_IDENTITY_MISMATCH");
    expect(dispatch).toContain("recordBotHealth(");
  });

  test("mailketing sender: a sender is connected only when the provider's own verified list holds its address", async () => {
    const verify = await readFile(
      "src/modules/email/application/email-sender-verify.ts",
      "utf8"
    );

    expect(verify).toContain("senders.value.verified.has(sender.address)");
    expect(verify).toContain("claim_contested");
  });
});

describe("the platform release action", () => {
  test("the locator function is called from exactly one application file", async () => {
    const callers: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;

        if (entry.isDirectory()) await walk(full);
        else if (/\.(ts|astro)$/.test(entry.name)) {
          if (
            (await readFile(full, "utf8")).includes(
              "awcms_find_channel_account_claim_holder"
            )
          ) {
            callers.push(full);
          }
        }
      }
    }

    await walk("src");

    expect(callers).toEqual([
      "src/modules/channel-accounts/application/claim-release.ts"
    ]);
  });

  test("the only route that reaches it is guarded by the platform-scoped permission", async () => {
    const route = await readFile(
      "src/pages/api/v1/channel-accounts/claims/release.ts",
      "utf8"
    );
    const constants = await readFile(
      "src/modules/channel-accounts/domain/channel-accounts-constants.ts",
      "utf8"
    );
    const callers: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;

        if (entry.isDirectory()) await walk(full);
        else if (/\.(ts|astro)$/.test(entry.name)) {
          if (
            (await readFile(full, "utf8")).includes("releaseContestedClaim")
          ) {
            callers.push(full);
          }
        }
      }
    }

    await walk("src");

    expect(callers.sort()).toEqual([
      "src/modules/channel-accounts/application/claim-release.ts",
      "src/pages/api/v1/channel-accounts/claims/release.ts"
    ]);
    expect(route).toContain("CHANNEL_ACCOUNTS_GUARDS.releaseClaim");
    expect(route).toContain("requireConditionalStepUp");
    expect(route).toContain("runIdempotent");
    expect(constants).toMatch(
      /releaseClaim:\s*\{[^}]*activityCode: ACCOUNT_CLAIMS_ACTIVITY_CODE,[^}]*action: "revoke"/
    );
  });

  test("the permission is seeded as platform scope and granted to the setup tenant only", async () => {
    const files = (await readdir("sql")).filter((name) =>
      name.endsWith(".sql")
    );
    const seeding: string[] = [];

    for (const name of files) {
      const body = await readFile(`sql/${name}`, "utf8");

      if (
        body.includes("'channel_accounts', 'account_claims', 'revoke'") &&
        /INSERT INTO awcms_permissions/.test(body)
      ) {
        seeding.push(name);
        expect(body).toContain("'platform'");
        expect(body).toContain("FROM awcms_setup_state");
        expect(body).not.toMatch(/FROM\s+awcms_tenants/i);
      }
    }

    expect(seeding).toEqual(["416_awcms_channel_accounts_claim_on_verify.sql"]);
  });
});
