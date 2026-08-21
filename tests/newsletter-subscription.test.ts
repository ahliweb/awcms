/**
 * The newsletter module (Issue #598, ADR-0103).
 *
 * ## What is actually at risk
 *
 * Not the CRUD. Four things, and every one of them is a property a reader
 * cannot check for themselves:
 *
 * 1. **That the public endpoints tell nobody anything.** A distinguishing
 *    response turns a public endpoint into a way to ask "is this person
 *    subscribed to this newsroom's list", and for a news site in Central
 *    Kalimantan that has consequences for the person being asked about.
 * 2. **That consent is recorded when it is GIVEN.** `consent_at` at submission
 *    would be a record of what was asked for, not of what happened.
 * 3. **That neither token can be read back.** Both are bearer credentials.
 * 4. **That `suppressed` is not `unsubscribed`.** Re-subscribing must clear the
 *    one and never the other.
 *
 * Pure — no database. The tenant-isolation negative needs a real one and lives
 * in the integration suite.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import {
  canResubscribe,
  NEWSLETTER_SUBSCRIBER_STATUSES,
  receivesMail
} from "../src/modules/newsletter/domain/subscriber-status";
import {
  generateSubscriptionToken,
  hashSubscriptionToken,
  isWellFormedSubscriptionToken,
  MAX_SUBSCRIPTION_TOKEN_LENGTH,
  tokensMatch
} from "../src/modules/newsletter/domain/subscription-token";
import { validateSubscriptionRequest } from "../src/modules/newsletter/domain/subscription-request";
import {
  buildConfirmationUrl,
  buildUnsubscribeUrl,
  NEWSLETTER_CONFIRMATION_VARIABLES
} from "../src/modules/newsletter/domain/newsletter-mail";

const SUBSCRIBE = "src/pages/api/v1/newsletter/subscribe.ts";
const CONFIRM = "src/pages/api/v1/newsletter/confirm.ts";
const UNSUBSCRIBE = "src/pages/api/v1/newsletter/unsubscribe.ts";
const DIRECTORY = "src/modules/newsletter/application/subscriber-directory.ts";
const MIGRATION = "sql/139_awcms_newsletter_schema.sql";
const SCREEN = "src/pages/admin/newsletter.astro";

describe("the public endpoints are not an enumeration oracle", () => {
  test("each returns exactly ONE success message, built from a constant", async () => {
    for (const route of [SUBSCRIBE, CONFIRM, UNSUBSCRIBE]) {
      const source = stripComments(await readFile(route, "utf8"));

      // One `ok(...)` per route, and its body is the module-level constant. A
      // second `ok` with a different message is the branch that leaks.
      expect([...source.matchAll(/\bok\(/g)].length).toBe(1);
      expect(source).toContain("NEUTRAL_MESSAGE");
    }
  });

  test("subscribe returns the same body whether or not a subscription happened", async () => {
    const source = stripComments(await readFile(SUBSCRIBE, "utf8"));

    // The `ok(...)` sits OUTSIDE `withNewsletterTenant`, so an unresolved host,
    // a disabled module and a real subscription all reach it.
    const okIndex = source.indexOf("return ok({ message: NEUTRAL_MESSAGE })");
    const tenantIndex = source.indexOf("await withNewsletterTenant(");

    expect(tenantIndex).toBeGreaterThan(-1);
    expect(okIndex).toBeGreaterThan(tenantIndex);
  });

  test("all three are rate-limited, with a PARSED threshold", async () => {
    for (const route of [SUBSCRIBE, CONFIRM, UNSUBSCRIBE]) {
      const source = stripComments(await readFile(route, "utf8"));

      expect(source).toContain("checkSharedRateLimit");
      // `Number(x ?? 60)` yields NaN for a non-numeric value and `count > NaN`
      // is false — which switches a limiter OFF while its metric reads zero.
      expect(source).toContain("parsePositiveIntSetting");
      expect(source).not.toContain("Number(process.env");
    }
  });

  test("the tenant comes from the HOST, never from a header", async () => {
    for (const route of [SUBSCRIBE, CONFIRM, UNSUBSCRIBE]) {
      const source = stripComments(await readFile(route, "utf8"));

      // A tenant header on an anonymous endpoint would let any caller choose
      // whose list they are writing to — FR-NWL-002 defeated by the request it
      // is supposed to bind.
      expect(source).toContain("withNewsletterTenant");
      expect(source).not.toContain("resolveAuthInputs");
      expect(source).not.toContain("x-tenant-id");
    }
  });

  test("unsubscribe asks for the token and nothing else", async () => {
    const source = stripComments(await readFile(UNSUBSCRIBE, "utf8"));

    // PRD §30 — a person who wants out must not have to prove who they are.
    expect(source).not.toContain("email");
    expect(source).not.toContain("hashSessionToken");
    expect(source).toContain("isWellFormedSubscriptionToken");
  });
});

describe("consent is recorded when it is given", () => {
  test("`consent_at` is written by confirm and by nothing else", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    const writes = [...source.matchAll(/consent_at = /g)].length;

    // Exactly one writer. `subscribe` writing it would record consent for a
    // form submission, which is a record of what was asked for rather than of
    // what happened.
    expect(writes).toBe(1);
    expect(
      source.indexOf("consent_at = now()") >
        source.indexOf("export async function confirmSubscription")
    ).toBe(true);
  });

  test("the database refuses an active row with no consent", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    // Application validation AND a CHECK: one governs what a request may ask
    // for, the other what the table may hold.
    expect(sql).toContain("awcms_newsletter_subscribers_consent_check");
    expect(sql).toContain("status <> 'active'");
    expect(sql).toContain(
      "confirmed_at IS NOT NULL AND consent_at IS NOT NULL"
    );
  });

  test("there is no consent field a caller could pre-tick", () => {
    // PRD §30 forbids a pre-ticked consent. Having no field at all is stronger
    // than defaulting one to false.
    const result = validateSubscriptionRequest({
      email: "ani@example.org",
      consent: true,
      status: "active"
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(Object.keys(result.value).sort()).toEqual([
      "email",
      "emailNormalized",
      "locale"
    ]);
  });

  test("the normalized address is what uniqueness is built on", () => {
    const result = validateSubscriptionRequest({ email: "  Ani@Example.COM " });

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    // The display form is what the person typed; the normalized form is what
    // the unique index covers, so two spellings are one subscriber.
    expect(result.value.email).toBe("Ani@Example.COM");
    expect(result.value.emailNormalized).toBe("ani@example.com");
  });
});

describe("neither token can be read back", () => {
  test("the directory's select list names no token column", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));
    const selectList = source.slice(
      source.indexOf("const SELECT_COLUMNS ="),
      source.indexOf("export type SubscribeOutcome")
    );

    expect(selectList).not.toContain("token_hash");
  });

  test("the admin screen cannot display one", async () => {
    const screen = stripComments(await readFile(SCREEN, "utf8"));

    // A screen that showed an unsubscribe token would let anyone reading over a
    // shoulder end somebody's subscription.
    expect(screen).not.toContain("Token");
    expect(screen).not.toContain("token");
  });

  test("tokens are 256 bits and hashed, not stored raw", () => {
    const token = generateSubscriptionToken();

    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(isWellFormedSubscriptionToken(token)).toBe(true);

    const hash = hashSubscriptionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  test("two generated tokens differ", () => {
    expect(generateSubscriptionToken()).not.toBe(generateSubscriptionToken());
  });

  test("comparison is length-safe as well as constant-time", () => {
    const a = hashSubscriptionToken("one");

    expect(tokensMatch(a, a)).toBe(true);
    expect(tokensMatch(a, hashSubscriptionToken("two"))).toBe(false);
    // `timingSafeEqual` THROWS on unequal lengths, and a hash's length is not a
    // secret — so the guard is a correctness fix, not a leak.
    expect(() => tokensMatch(a, "short")).not.toThrow();
    expect(tokensMatch(a, "short")).toBe(false);
  });

  test("a token is bounded and shape-checked before it is hashed", () => {
    expect(isWellFormedSubscriptionToken("")).toBe(false);
    expect(isWellFormedSubscriptionToken("has spaces")).toBe(false);
    expect(isWellFormedSubscriptionToken("../../etc/passwd")).toBe(false);
    // An anonymous endpoint that will hash whatever it is handed will hash a
    // megabyte.
    expect(
      isWellFormedSubscriptionToken(
        "a".repeat(MAX_SUBSCRIPTION_TOKEN_LENGTH + 1)
      )
    ).toBe(false);
  });

  test("the confirmation mail carries the link and the site name, not the address", () => {
    expect([...NEWSLETTER_CONFIRMATION_VARIABLES]).toEqual([
      "confirmUrl",
      "siteName"
    ]);

    const url = buildConfirmationUrl("https://example.org", "tok_en-1");
    expect(url).toBe("https://example.org/newsletter/confirm?token=tok_en-1");
    expect(buildUnsubscribeUrl("https://example.org", "t")).toContain(
      "/newsletter/unsubscribe?token=t"
    );
  });
});

describe("suppressed is not unsubscribed", () => {
  test("the four states are distinct, and only one receives mail", () => {
    expect([...NEWSLETTER_SUBSCRIBER_STATUSES]).toEqual([
      "pending",
      "active",
      "unsubscribed",
      "suppressed"
    ]);

    expect(receivesMail("active")).toBe(true);
    for (const status of ["pending", "unsubscribed", "suppressed"] as const) {
      expect(receivesMail(status)).toBe(false);
    }
  });

  test("re-subscribing is allowed from every state EXCEPT suppressed", () => {
    // Somebody who unsubscribed in March may sign up again in June, and letting
    // them is correct. An address suppressed for abuse must not be re-addable
    // by whoever is abusing it.
    expect(canResubscribe("unsubscribed")).toBe(true);
    expect(canResubscribe("pending")).toBe(true);
    expect(canResubscribe("active")).toBe(true);
    expect(canResubscribe("suppressed")).toBe(false);
  });

  test("the upsert refuses to touch a suppressed row", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    // In the STATEMENT, not in a caller — so no future caller can forget.
    expect(source).toContain(
      "WHERE awcms_newsletter_subscribers.status <> 'suppressed'"
    );
    expect(source).toContain(
      "ON CONFLICT (tenant_id, email_normalized) DO UPDATE"
    );
  });

  test("unsubscribing cannot move a row out of suppressed either", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));
    const body = source.slice(
      source.indexOf("export async function unsubscribeByToken")
    );

    expect(body).toContain("AND status <> 'suppressed'");
  });

  test("a suppression must carry a reason, enforced by the table", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    expect(sql).toContain("awcms_newsletter_subscribers_suppression_check");
    expect(sql).toContain("suppression_reason IS NOT NULL");
  });
});

describe("idempotency is the index's job", () => {
  test("the unique index covers the normalized address per tenant", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS awcms_newsletter_subscribers_email_dedup"
    );
    expect(sql).toContain("(tenant_id, email_normalized)");
  });

  test("subscribe issues ONE statement, not a read-then-write", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));
    const body = source.slice(
      source.indexOf("export async function subscribe"),
      source.indexOf("export type ConfirmOutcome")
    );

    // Two readers submitting the same address in the same instant would both
    // find nothing and both insert. One statement makes the race impossible
    // rather than unlikely.
    expect([...body.matchAll(/await tx`/g)].length).toBe(1);
    expect(body).toContain("ON CONFLICT");
  });

  test("the table is tenant-isolated with FORCE RLS", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    // FR-NWL-002. `ENABLE` without `FORCE` is inert for a table owner.
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "tenant_id = current_setting('app.current_tenant_id')"
    );
  });
});
