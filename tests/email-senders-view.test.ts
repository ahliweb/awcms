/**
 * The pure rules of `/admin/email-senders` (Issue #1162, ADR-0151 sections 2, 6
 * and 7): stale is not unknown, a balance below the floor is insufficient, the
 * screen's "may send" is the dispatcher's own freshness gate, an address is
 * masked, and the v1 to v2 migration notice names the state exactly.
 *
 * Pure: no database, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  accountConnection,
  classifyCheckFreshness,
  creditReading,
  mailketingMigrationNotice,
  maskSenderAddress,
  senderHealthHold,
  senderVerification
} from "../src/modules/email/domain/email-senders-view";
import {
  evaluateEmailSenderHealth,
  type EmailAccountHealthFacts
} from "../src/modules/email/domain/email-sender";

const NOW = new Date("2026-11-14T12:00:00.000Z");
const WINDOW = 360 * 60_000;
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);
const facts = (
  state: string,
  ageMinutes: number,
  extra: Partial<EmailAccountHealthFacts> = {}
): EmailAccountHealthFacts => ({
  state,
  reasonCode: null,
  checkedAt: minutesAgo(ageMinutes),
  quotaRemaining: null,
  ...extra
});

describe("freshness: stale and unknown are different answers", () => {
  test("no check is unknown, an old check is stale, a recent one is fresh", () => {
    expect(classifyCheckFreshness(null, NOW, WINDOW)).toBe("unknown");
    expect(classifyCheckFreshness(minutesAgo(361), NOW, WINDOW)).toBe("stale");
    expect(classifyCheckFreshness(minutesAgo(360), NOW, WINDOW)).toBe("fresh");
    expect(classifyCheckFreshness(minutesAgo(1), NOW, WINDOW)).toBe("fresh");
  });

  test("a check from the future is not stale (clock skew), it is as fresh as it can be proven", () => {
    expect(classifyCheckFreshness(minutesAgo(-5), NOW, WINDOW)).toBe("fresh");
  });
});

describe("sender verification", () => {
  test("only a fresh `ok` is verified; an old `ok` is stale, never verified", () => {
    expect(senderVerification(facts("ok", 5), NOW, WINDOW)).toBe("verified");
    expect(senderVerification(facts("ok", 400), NOW, WINDOW)).toBe("stale");
  });

  test("no row is unknown; degraded is unverified; failing is failing", () => {
    expect(senderVerification(null, NOW, WINDOW)).toBe("unknown");
    expect(
      senderVerification(
        facts("degraded", 5, { reasonCode: "SENDER_UNVERIFIED" }),
        NOW,
        WINDOW
      )
    ).toBe("unverified");
    expect(senderVerification(facts("failing", 5), NOW, WINDOW)).toBe(
      "failing"
    );
    expect(senderVerification(facts("unknown", 5), NOW, WINDOW)).toBe(
      "unknown"
    );
    // A value this build does not know is not read as verified.
    expect(senderVerification(facts("mystery", 5), NOW, WINDOW)).toBe(
      "unknown"
    );
  });
});

describe("credit", () => {
  test("below the floor is insufficient; at the floor is ok", () => {
    expect(
      creditReading(facts("ok", 5, { quotaRemaining: 99 }), NOW, WINDOW, 100)
    ).toEqual({ kind: "insufficient", balance: 99 });
    expect(
      creditReading(facts("ok", 5, { quotaRemaining: 100 }), NOW, WINDOW, 100)
    ).toEqual({ kind: "ok", balance: 100 });
  });

  test("an old balance is stale, never ok; no balance is unknown", () => {
    expect(
      creditReading(
        facts("ok", 500, { quotaRemaining: 5000 }),
        NOW,
        WINDOW,
        100
      )
    ).toEqual({ kind: "stale", balance: 5000 });
    expect(creditReading(null, NOW, WINDOW, 100)).toEqual({ kind: "unknown" });
    expect(creditReading(facts("ok", 5), NOW, WINDOW, 100)).toEqual({
      kind: "unknown"
    });
  });

  test("a provider-reported depletion is insufficient whatever the floor", () => {
    expect(
      creditReading(
        facts("degraded", 5, {
          reasonCode: "CREDIT_DEPLETED",
          quotaRemaining: 0
        }),
        NOW,
        WINDOW,
        0
      )
    ).toEqual({ kind: "insufficient", balance: 0 });
  });
});

describe("account connection", () => {
  const input = (
    status: string,
    f: EmailAccountHealthFacts | null
  ): Parameters<typeof accountConnection>[0] => ({
    status,
    facts: f,
    now: NOW,
    maxAgeMs: WINDOW
  });

  test("a disconnected account is disconnected whatever its last health said", () => {
    for (const status of ["revoked", "disabled", "deleted"]) {
      expect(accountConnection(input(status, facts("ok", 1)))).toBe(
        "disconnected"
      );
    }

    expect(accountConnection(input("pending", facts("ok", 1)))).toBe("pending");
  });

  test("the states an operator can act on are told apart", () => {
    expect(accountConnection(input("connected", facts("ok", 1)))).toBe(
      "connected"
    );
    expect(accountConnection(input("connected", facts("ok", 900)))).toBe(
      "stale"
    );
    expect(accountConnection(input("connected", null))).toBe("unknown");
    expect(accountConnection(input("degraded", facts("failing", 1)))).toBe(
      "credential_rejected"
    );
    expect(
      accountConnection(
        input(
          "degraded",
          facts("degraded", 1, { reasonCode: "CREDIT_DEPLETED" })
        )
      )
    ).toBe("credit_depleted");
    expect(
      accountConnection(
        input(
          "connected",
          facts("unknown", 1, { reasonCode: "CREDIT_RESPONSE_UNRECOGNISED" })
        )
      )
    ).toBe("unverified_response");
  });
});

describe("the screen's hold IS the dispatcher's freshness gate", () => {
  test("every combination answers exactly what evaluateEmailSenderHealth answers", () => {
    const cases: (EmailAccountHealthFacts | null)[] = [
      null,
      facts("ok", 5, { quotaRemaining: 500 }),
      facts("ok", 900, { quotaRemaining: 500 }),
      facts("ok", 5, { quotaRemaining: 5 }),
      facts("ok", 5),
      facts("degraded", 5),
      facts("failing", 5),
      facts("unknown", 5)
    ];

    for (const sender of cases) {
      for (const account of cases) {
        const input = {
          sender,
          account,
          now: NOW,
          maxAgeMs: WINDOW,
          creditFloor: 100
        };

        expect(senderHealthHold(input)).toBe(evaluateEmailSenderHealth(input));
      }
    }
  });

  test("a verified sender of an account with no visible balance is held, not ready", () => {
    expect(
      senderHealthHold({
        sender: facts("ok", 5),
        account: null,
        now: NOW,
        maxAgeMs: WINDOW,
        creditFloor: 100
      })
    ).toBe("CREDIT_UNKNOWN");
  });
});

describe("masking", () => {
  test("an address keeps its first letter and its domain", () => {
    expect(maskSenderAddress("newsletter@brand.example")).toBe(
      "n•••@brand.example"
    );
    expect(maskSenderAddress("a@b.co")).toBe("a•••@b.co");
  });

  test("a value that is not an address is reduced, never echoed", () => {
    expect(maskSenderAddress("short")).toBe("••••");
    expect(maskSenderAddress("not-an-address-at-all")).toBe("••••-all");
    expect(maskSenderAddress("@nolocal")).toBe("••••ocal");
    expect(maskSenderAddress("nodomain@")).toBe("••••ain@");
  });
});

describe("the v1 to v2 migration notice", () => {
  const env = (values: Record<string, string>) =>
    values as unknown as NodeJS.ProcessEnv;

  test("a deployment sender that is not Mailketing has nothing to migrate", () => {
    expect(mailketingMigrationNotice(env({ EMAIL_PROVIDER: "log" }))).toEqual({
      kind: "not_mailketing",
      deploymentApiVersion: null
    });
    expect(mailketingMigrationNotice(env({}))).toMatchObject({
      kind: "not_mailketing"
    });
  });

  test("unset is v1, and v1 is reported as the un-migrated state", () => {
    expect(
      mailketingMigrationNotice(env({ EMAIL_PROVIDER: "mailketing" }))
    ).toEqual({ kind: "v1_active", deploymentApiVersion: "v1" });
  });

  test("v2 is unverified until the live check is acknowledged", () => {
    const base = {
      EMAIL_PROVIDER: "mailketing",
      EMAIL_MAILKETING_API_VERSION: "v2"
    };

    expect(mailketingMigrationNotice(env(base))).toEqual({
      kind: "v2_unverified",
      deploymentApiVersion: "v2"
    });
    expect(
      mailketingMigrationNotice(
        env({ ...base, EMAIL_MAILKETING_V2_VERIFIED: "true" })
      )
    ).toEqual({ kind: "v2_verified", deploymentApiVersion: "v2" });
    // Only exactly "true" acknowledges it.
    expect(
      mailketingMigrationNotice(
        env({ ...base, EMAIL_MAILKETING_V2_VERIFIED: "yes" })
      )
    ).toMatchObject({ kind: "v2_unverified" });
  });

  test("a value that is neither v1 nor v2 is reported, never read as v1", () => {
    expect(
      mailketingMigrationNotice(
        env({
          EMAIL_PROVIDER: "mailketing",
          EMAIL_MAILKETING_API_VERSION: "V2"
        })
      )
    ).toEqual({ kind: "invalid_version", deploymentApiVersion: null });
  });
});
