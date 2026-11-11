/**
 * Pure rules of `email` sender routing (Issue #1160, ADR-0151 section 2): sender
 * precedence, purpose, the hold/terminal split, the freshness gate, the
 * fail-closed provider parsers, the configuration defaults, request validation
 * and the static contracts the database relies on. No database, no network.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  validateAnnouncementInput,
  validateEmailSenderPolicyInput
} from "../src/modules/email/domain/announcement-validation";
import {
  isEmailSenderRoutingEnabled,
  resolveEmailMailketingCreditFloor,
  resolveEmailSenderHealthMaxAgeMs,
  resolveEmailSenderRatePerHour
} from "../src/modules/email/domain/email-config";
import {
  capabilityForEmailPurpose,
  chooseEmailSender,
  classifyEmailSenderUnavailable,
  emailSenderBreakerKey,
  emailSenderScopeAllows,
  evaluateEmailSenderHealth,
  parseEmailBusinessScope,
  pickEmailPolicy,
  purposeForEmailCategory
} from "../src/modules/email/domain/email-sender";
import {
  parseMailketingV2Credits,
  parseMailketingV2Senders
} from "../src/modules/email/domain/mailketing-v2-contract";
import { createMailketingV2AccountProbe } from "../src/modules/email/infrastructure/mailketing-v2-provider";
import { resolveEnqueueEmailSender } from "../src/modules/email/application/email-sender-directory";

const env = (values: Record<string, string>) =>
  values as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-11-11T10:00:00.000Z");
const SCOPE = { type: "brand", id: "11111111-2222-4333-8444-555555555555" };

describe("sender precedence: explicit, else policy, else deployment; never a second candidate", () => {
  test("explicit wins and carries no policy version", () => {
    expect(
      chooseEmailSender({
        explicitSenderAccountId: "a",
        policy: {
          businessScope: null,
          defaultSenderAccountId: "b",
          configVersion: 3
        }
      })
    ).toEqual({
      senderAccountId: "a",
      selection: "explicit",
      policyVersion: null
    });
  });

  test("a policy with a NULL default is an explicit deployment decision, versioned", () => {
    expect(
      chooseEmailSender({
        explicitSenderAccountId: null,
        policy: {
          businessScope: null,
          defaultSenderAccountId: null,
          configVersion: 2
        }
      })
    ).toEqual({
      senderAccountId: null,
      selection: "deployment",
      policyVersion: 2
    });
  });

  test("the scope's own policy beats the tenant-wide one, even with a NULL default", () => {
    const policies = [
      { businessScope: null, defaultSenderAccountId: "wide", configVersion: 1 },
      { businessScope: SCOPE, defaultSenderAccountId: null, configVersion: 1 }
    ];

    expect(pickEmailPolicy(policies, SCOPE)?.defaultSenderAccountId).toBeNull();
    expect(pickEmailPolicy(policies, null)?.defaultSenderAccountId).toBe(
      "wide"
    );
  });

  test("a scoped sender serves only its own scope; a tenant-wide one any", () => {
    expect(emailSenderScopeAllows(SCOPE, SCOPE)).toBe(true);
    expect(emailSenderScopeAllows(SCOPE, null)).toBe(false);
    expect(emailSenderScopeAllows(null, SCOPE)).toBe(true);
  });
});

describe("purpose", () => {
  test("auth.* and security notices are security mail; the rest transactional", () => {
    expect(purposeForEmailCategory("auth.password_reset")).toBe("security");
    expect(purposeForEmailCategory("auth.invitation")).toBe("security");
    expect(purposeForEmailCategory("system.security_notice")).toBe("security");
    expect(purposeForEmailCategory("system.announcement")).toBe(
      "transactional"
    );
    expect(capabilityForEmailPurpose("transactional")).toBe("dm");
  });

  test("security mail is refused a tenant sender before any database work", async () => {
    const tx = (() => {
      throw new Error("no query expected");
    }) as unknown as Bun.SQL;
    const decision = await resolveEnqueueEmailSender(tx, {
      tenantId: SCOPE.id,
      explicitSenderAccountId: SCOPE.id,
      businessScope: null,
      purpose: "security",
      senders: async () => null,
      env: env({ EMAIL_SENDER_ROUTING_ENABLED: "true" })
    });

    expect(decision).toMatchObject({ ok: false, reason: "SENDER_UNAVAILABLE" });
  });

  test("routing off: no policy read, a named sender is SENDER_ROUTING_DISABLED, none is the deployment sender", async () => {
    const tx = (() => {
      throw new Error("no query expected");
    }) as unknown as Bun.SQL;
    const base = {
      tenantId: SCOPE.id,
      businessScope: null,
      purpose: "transactional" as const,
      senders: async () => null,
      env: env({})
    };

    expect(
      await resolveEnqueueEmailSender(tx, {
        ...base,
        explicitSenderAccountId: SCOPE.id
      })
    ).toMatchObject({ ok: false, reason: "SENDER_ROUTING_DISABLED" });
    expect(
      await resolveEnqueueEmailSender(tx, {
        ...base,
        explicitSenderAccountId: null
      })
    ).toMatchObject({ ok: true, snapshot: { senderAccountId: null } });
  });
});

describe("a sender that cannot send: terminal or hold, never reroute", () => {
  test("gone or never approved is terminal; recoverable is a hold", () => {
    for (const reason of [
      "ACCOUNT_NOT_FOUND",
      "NOT_AN_EMAIL_SENDER",
      "ACCOUNT_REVOKED",
      "ACCOUNT_DISABLED",
      "CAPABILITY_DENIED",
      "CONNECTION_NOT_ACTIVE"
    ] as const) {
      expect(classifyEmailSenderUnavailable(reason)).toBe("terminal");
    }

    for (const reason of [
      "ACCOUNT_PENDING",
      "ACCOUNT_DEGRADED",
      "CHANNEL_ACCOUNTS_DISABLED",
      "CREDENTIAL_UNAVAILABLE",
      "SECRET_STORE_UNAVAILABLE",
      "CONNECTION_EXPIRED"
    ] as const) {
      expect(classifyEmailSenderUnavailable(reason)).toBe("hold");
    }
  });

  test("the breaker key is per Mailketing account, never the deployment key", () => {
    expect(emailSenderBreakerKey("abc")).toBe("email-mailketing:account:abc");
  });
});

describe("the freshness gate: unknown and stale are holds", () => {
  const fresh = {
    state: "ok",
    reasonCode: null,
    checkedAt: NOW,
    quotaRemaining: null
  };
  const credit = (quota: number | null, state = "ok", checkedAt = NOW) => ({
    state,
    reasonCode: null,
    checkedAt,
    quotaRemaining: quota
  });
  const gate = (sender: unknown, account: unknown) =>
    evaluateEmailSenderHealth({
      sender: sender as never,
      account: account as never,
      now: NOW,
      maxAgeMs: 60 * 60_000,
      creditFloor: 10
    });

  test("all fresh and above the floor: send", () => {
    expect(gate(fresh, credit(11))).toBeNull();
  });

  test("each unknown or stale fact holds", () => {
    expect(gate(null, credit(100))).toBe("SENDER_VERIFICATION_UNKNOWN");
    expect(gate({ ...fresh, state: "unknown" }, credit(100))).toBe(
      "SENDER_VERIFICATION_UNKNOWN"
    );
    expect(gate({ ...fresh, state: "degraded" }, credit(100))).toBe(
      "SENDER_UNVERIFIED"
    );
    expect(
      gate(
        { ...fresh, checkedAt: new Date(NOW.getTime() - 2 * 3_600_000) },
        credit(100)
      )
    ).toBe("SENDER_VERIFICATION_STALE");
    expect(gate(fresh, null)).toBe("CREDIT_UNKNOWN");
    expect(gate(fresh, credit(null))).toBe("CREDIT_UNKNOWN");
    expect(gate(fresh, credit(9))).toBe("CREDIT_BELOW_THRESHOLD");
    expect(
      gate(fresh, credit(100, "ok", new Date(NOW.getTime() - 2 * 3_600_000)))
    ).toBe("CREDIT_STALE");
  });
});

describe("provider parsers are fail-closed", () => {
  test("credits: only an explicit non-negative number", () => {
    expect(
      parseMailketingV2Credits('{"success":true,"data":{"credits":42.9}}')
    ).toEqual({ ok: true, balance: 42 });
    expect(
      parseMailketingV2Credits('{"success":true,"data":{"credits":"42"}}')
    ).toEqual({ ok: false });
    expect(
      parseMailketingV2Credits('{"success":true,"data":{"credits":-1}}')
    ).toEqual({ ok: false });
    expect(parseMailketingV2Credits('{"success":false}')).toEqual({
      ok: false
    });
    expect(parseMailketingV2Credits("<html>")).toEqual({ ok: false });
  });

  test("senders: verified only when the entry says so explicitly", () => {
    const parsed = parseMailketingV2Senders(
      JSON.stringify({
        success: true,
        data: [
          { email: "News@Brand.Example", verified: true },
          { from_email: "b@brand.example", status: "verified" },
          { email: "c@brand.example", status: "pending" },
          { email: "d@brand.example", verified: "true" },
          { email: "not an address", verified: true },
          { sender: "e@brand.example" }
        ]
      })
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect([...parsed.verified].sort()).toEqual([
      "b@brand.example",
      "news@brand.example"
    ]);
    expect(parseMailketingV2Senders('{"success":true,"data":{}}')).toEqual({
      ok: false
    });
  });

  test("audit L5: contradictory flags or duplicate entries with mixed verdicts are ambiguous, never verified", () => {
    const parsed = parseMailketingV2Senders(
      JSON.stringify({
        success: true,
        data: [
          { email: "flags@b.example", verified: true, status: "pending" },
          { email: "dup@b.example", verified: true },
          { email: "DUP@b.example", status: "rejected" },
          { email: "twice@b.example", verified: true },
          { email: "twice@b.example", status: "verified" }
        ]
      })
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect([...parsed.verified]).toEqual(["twice@b.example"]);
    expect([...parsed.ambiguous].sort()).toEqual([
      "dup@b.example",
      "flags@b.example"
    ]);
  });

  test("the probe sends the token in a header only and maps 401/402/5xx to fixed codes", async () => {
    const urls: string[] = [];
    const bodies: (string | undefined)[] = [];
    let status = 401;
    const probe = createMailketingV2AccountProbe({
      apiToken: "CANARY-probe-token",
      transport: async (request) => {
        urls.push(request.url);
        bodies.push(request.body);
        expect(request.headers.Authorization).toBe("Bearer CANARY-probe-token");

        return {
          ok: true,
          status,
          retryAfter: null,
          body: "CANARY-probe-token"
        };
      }
    });

    expect(await probe.readCredits()).toEqual({ ok: false, failure: "auth" });
    status = 402;
    expect(await probe.readCredits()).toEqual({ ok: false, failure: "credit" });
    status = 503;
    expect(await probe.listVerifiedSenders()).toEqual({
      ok: false,
      failure: "unavailable"
    });
    status = 200;
    expect(await probe.listVerifiedSenders()).toEqual({
      ok: false,
      failure: "malformed"
    });
    expect(urls.every((url) => !url.includes("CANARY"))).toBe(true);
    expect(bodies.every((body) => body === undefined)).toBe(true);
  });
});

describe("configuration defaults are safe", () => {
  test("routing is off unless exactly true", () => {
    expect(isEmailSenderRoutingEnabled(env({}))).toBe(false);
    expect(
      isEmailSenderRoutingEnabled(env({ EMAIL_SENDER_ROUTING_ENABLED: "TRUE" }))
    ).toBe(false);
    expect(
      isEmailSenderRoutingEnabled(env({ EMAIL_SENDER_ROUTING_ENABLED: "true" }))
    ).toBe(true);
  });

  test("bad numbers fall back to defaults; a credit floor of 0 is allowed", () => {
    expect(
      resolveEmailSenderHealthMaxAgeMs(
        env({ EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES: "x" })
      )
    ).toBe(360 * 60_000);
    expect(resolveEmailMailketingCreditFloor(env({}))).toBe(100);
    expect(
      resolveEmailMailketingCreditFloor(
        env({ EMAIL_MAILKETING_CREDIT_FLOOR: "0" })
      )
    ).toBe(0);
    expect(
      resolveEmailMailketingCreditFloor(
        env({ EMAIL_MAILKETING_CREDIT_FLOOR: "-5" })
      )
    ).toBe(100);
    expect(
      resolveEmailSenderRatePerHour(env({ EMAIL_SENDER_RATE_PER_HOUR: "0" }))
    ).toBe(300);
  });
});

describe("request validation", () => {
  test("announcement sender fields are optional, shape-checked and lower-cased", () => {
    const base = {
      templateKey: "system.announcement",
      target: { type: "tenant" }
    };

    expect(validateAnnouncementInput(base)).toMatchObject({ valid: true });
    expect(
      validateAnnouncementInput({
        ...base,
        senderAccountId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
        businessScope: SCOPE
      })
    ).toMatchObject({
      valid: true,
      value: {
        senderAccountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        businessScope: SCOPE
      }
    });
    expect(
      validateAnnouncementInput({ ...base, senderAccountId: "x" })
    ).toMatchObject({ valid: false });
    expect(
      validateAnnouncementInput({
        ...base,
        businessScope: { type: "Brand", id: SCOPE.id }
      })
    ).toMatchObject({ valid: false });
  });

  test("the policy body needs both keys, refuses unknown ones, and accepts null", () => {
    expect(
      validateEmailSenderPolicyInput({
        businessScope: null,
        defaultSenderAccountId: null
      })
    ).toMatchObject({ valid: true });
    expect(
      validateEmailSenderPolicyInput({ businessScope: null })
    ).toMatchObject({ valid: false });
    expect(
      validateEmailSenderPolicyInput({
        businessScope: null,
        defaultSenderAccountId: null,
        apiToken: "x"
      })
    ).toMatchObject({ valid: false });
  });

  test("parseEmailBusinessScope refuses malformed scopes rather than guessing", () => {
    expect(parseEmailBusinessScope(undefined)).toBeNull();
    expect(parseEmailBusinessScope({ type: "brand", id: "nope" })).toBe(
      "invalid"
    );
    expect(parseEmailBusinessScope([])).toBe("invalid");
  });
});

describe("static contracts", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  test("one queue: the routing migration creates only the policy table", () => {
    const created = [
      ...read("sql/346_awcms_email_sender_routing.sql").matchAll(
        /CREATE TABLE IF NOT EXISTS (\w+)/g
      )
    ].map((m) => m[1]);

    expect(created).toEqual(["awcms_email_sender_policies"]);
  });

  test("marketing is not admitted and security mail is pinned to the deployment sender", () => {
    const sql = read("sql/346_awcms_email_sender_routing.sql");

    expect(sql).toContain("CHECK (purpose IN ('transactional', 'security'))");
    expect(sql).toContain(
      "CHECK (purpose <> 'security' OR sender_account_id IS NULL)"
    );
  });

  test("the worker sees a Mailketing token only as a live esp_account's own credential", () => {
    const sql = read("sql/348_awcms_email_sender_worker_visibility.sql");

    expect(sql).toContain("a.account_kind = 'esp_account'");
    expect(sql).not.toMatch(
      /facebook|instagram|tiktok|youtube|linkedin|threads/
    );
  });

  test("the request path never imports the credential adapter or the secret store", () => {
    for (const file of [
      "src/pages/api/v1/email/senders.ts",
      "src/pages/api/v1/email/sender-policy.ts",
      "src/pages/api/v1/email/announcements/index.ts",
      "src/modules/email/infrastructure/channel-account-loaders.ts",
      "src/modules/email/application/email-dispatch.ts",
      "src/modules/email/application/email-sender-directory.ts"
    ]) {
      const source = read(file);

      expect(source, file).not.toContain("channel-sender-credential-adapter");
      expect(source, file).not.toContain("secret-store");
    }
  });
});
