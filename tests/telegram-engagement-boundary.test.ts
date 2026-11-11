/**
 * The boundary between the customer context (`telegram_engagement`, Issue
 * #1156) and the staff-only `telegram_delivery` (ADR-0140), held structurally
 * (ADR-0152 section 1, TG1, test T-N1), plus the secret-handling seams of the
 * customer module (TG11).
 *
 *   - The staff module's PUBLIC PORT is byte-for-byte what ADR-0140 shipped and
 *     its purpose list is still exactly `staff_ops`: changing either needs an ADR
 *     that supersedes ADR-0140, and this test is where that becomes visible.
 *   - Nothing in the customer module, its routes or its job imports anything
 *     from `telegram-delivery`, names a staff table, or reads a staff setting
 *     other than the one documented exception (the staff bot's numeric id, to
 *     REFUSE it).
 *   - No route file decrypts a secret: only the connector, the dispatcher and
 *     the webhook verification reach the `resolve*` functions.
 *   - The staff module did not gain a customer path: it does not import the
 *     customer module either.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { listModules } from "../src/modules";
import { TELEGRAM_PURPOSE } from "../src/modules/telegram-delivery/domain/telegram-constants";
import { PURPOSES } from "../src/modules/telegram-engagement/domain/telegram-engagement-constants";

const STAFF_PORT = "src/modules/_shared/ports/telegram-delivery-port.ts";
const STAFF_PORT_SHA256 =
  "0ce0ea5b0c693c004c023ab9df65d112daccbbaf0217707813190c36b3860559";

function files(pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync(".")].sort();
}

const CUSTOMER_FILES = [
  ...files("src/modules/telegram-engagement/**/*.ts"),
  ...files("src/pages/api/v1/telegram-engagement/**/*.ts"),
  "scripts/telegram-engagement-dispatch.ts"
];

describe("telegram_delivery stays staff-only and unchanged (T-N1)", () => {
  test("the staff port file is exactly what ADR-0140 shipped", () => {
    const digest = createHash("sha256")
      .update(readFileSync(STAFF_PORT))
      .digest("hex");

    expect(digest).toBe(STAFF_PORT_SHA256);
  });

  test("the staff purpose list is still `staff_ops` only, and the customer list never contains it", () => {
    expect(TELEGRAM_PURPOSE).toBe("staff_ops");
    expect(PURPOSES as readonly string[]).not.toContain("staff_ops");
  });

  test("the customer module imports nothing from telegram_delivery and names none of its tables", () => {
    expect(CUSTOMER_FILES.length).toBeGreaterThan(10);

    for (const file of CUSTOMER_FILES) {
      const source = readFileSync(file, "utf8");

      expect(source, file).not.toMatch(
        /from\s+["'][^"']*telegram-delivery[^"']*["']/
      );
      expect(source, file).not.toMatch(
        /\bawcms_telegram_(?!engagement_)[a-z_]+/
      );
      expect(source, file).not.toContain("TELEGRAM_WEBHOOK_SECRET");
      expect(source, file).not.toContain("TELEGRAM_CHAT_");
    }
  });

  test("the staff module does not import the customer module", () => {
    for (const file of [
      ...files("src/modules/telegram-delivery/**/*.ts"),
      ...files("src/pages/api/v1/telegram/**/*.ts")
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toContain(
        "telegram-engagement"
      );
    }
  });

  test("the only staff setting the customer module reads is the staff bot's id, in one function", () => {
    const readers = CUSTOMER_FILES.filter((file) =>
      readFileSync(file, "utf8").includes("TELEGRAM_BOT_TOKEN")
    );

    expect(readers).toEqual([
      "src/modules/telegram-engagement/domain/staff-bot-identity.ts"
    ]);
  });

  test("the two modules are separate registry entries with disjoint permissions", () => {
    const modules = listModules();
    const staff = modules.find((m) => m.key === "telegram_delivery");
    const customer = modules.find((m) => m.key === "telegram_engagement");

    expect(staff).toBeDefined();
    expect(customer).toBeDefined();
    expect(customer!.dependencies).not.toContain("telegram_delivery");
    expect(customer!.status).toBe("experimental");
    expect(customer!.navigation ?? []).toEqual([]);
  });
});

describe("secret handling seams (TG11)", () => {
  test("no route file reaches a decrypting function", () => {
    for (const file of files("src/pages/api/v1/telegram-engagement/**/*.ts")) {
      const source = readFileSync(file, "utf8");

      expect(source, file).not.toMatch(/resolve(BotToken|WebhookSeed)\b/);
      expect(source, file).not.toMatch(/\.resolve\(/);
      expect(source, file).not.toContain("secret-store");
    }
  });

  test("only the connector/dispatcher and the webhook verification decrypt", () => {
    const decrypting = CUSTOMER_FILES.filter((file) =>
      /resolve(BotToken|WebhookSeed)\(/.test(readFileSync(file, "utf8"))
    );

    expect(decrypting).toEqual([
      "src/modules/telegram-engagement/application/dispatch.ts",
      "src/modules/telegram-engagement/application/webhook-ingest.ts",
      "src/modules/telegram-engagement/infrastructure/channel-accounts-bridge.ts"
    ]);
  });

  test("the bot API URL is built in exactly one file", () => {
    const builders = CUSTOMER_FILES.filter((file) =>
      readFileSync(file, "utf8").includes("/bot${token}/")
    );

    expect(builders).toEqual([
      "src/modules/telegram-engagement/infrastructure/bot-api-client.ts"
    ]);
  });
});
