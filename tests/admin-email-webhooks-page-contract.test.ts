/**
 * `/admin/email-webhooks` gates against the endpoints it drives (Issue #1162,
 * ADR-0151 section 5, ADR-0149).
 *
 * Sibling of `admin-email-senders-page-contract.test.ts`, for the same silent
 * failure: a page gating on a permission key no migration seeds hides the
 * control from EVERYONE, the owner included, while still looking like a working
 * screen. Pinned here:
 *
 * - every permission the screen names is DECLARED, SEEDED and ENFORCED by the
 *   endpoint behind the control, and the sidebar entry opens a page that exists;
 * - no token, hash or whole recipient is selected, rendered or stored by the
 *   page or its application function;
 * - the three mutations send an `Idempotency-Key`, ask for a confirmation first,
 *   and map only error codes the endpoints really emit;
 * - the callback address exists only in a script-written field.
 *
 * Pure: no database, no network.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { stripComments } from "../scripts/lib/source-text";
import { EMAIL_WEBHOOK_GUARDS } from "../src/modules/email/application/webhook-route-support";

const PAGE = "src/pages/admin/email-webhooks.astro";
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const page = read(PAGE);
const screen = read("src/modules/email/application/email-webhooks-screen.ts");

function literalGuard(source: string, name: string) {
  const match = new RegExp(
    `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)"\\s*\\} as const;`
  ).exec(source);

  expect(match).not.toBeNull();

  return { moduleKey: match![1], activityCode: match![2], action: match![3] };
}

describe("the screen gates on keys that really exist", () => {
  test("each literal guard equals the endpoints' own guard", () => {
    expect(literalGuard(page, "READ_GUARD")).toEqual(EMAIL_WEBHOOK_GUARDS.read);
    expect(literalGuard(page, "CONFIGURE_GUARD")).toEqual(
      EMAIL_WEBHOOK_GUARDS.configure
    );
    expect(literalGuard(page, "APPROVE_GUARD")).toEqual(
      EMAIL_WEBHOOK_GUARDS.approve
    );
  });

  test("every key is DECLARED by the email module and SEEDED by a migration", () => {
    const email = listModules().find((module) => module.key === "email")!;
    const declared = new Set(
      (email.permissions ?? []).map(
        (permission) => `${permission.activityCode}.${permission.action}`
      )
    );
    const seed = read("sql/380_awcms_email_webhook_permissions.sql");

    for (const [activity, action] of [
      ["webhook", "read"],
      ["webhook", "configure"],
      ["provider_events", "approve"]
    ]) {
      expect(declared.has(`${activity}.${action}`)).toBe(true);
      expect(seed).toContain(`'email', '${activity}', '${action}'`);
    }
  });

  test("each endpoint enforces the key the screen assumes", () => {
    const support = read(
      "src/modules/email/application/webhook-route-support.ts"
    );
    const callbacks = read("src/pages/api/v1/email/webhook-callbacks/index.ts");
    const revoke = read(
      "src/pages/api/v1/email/webhook-callbacks/[id]/revoke.ts"
    );
    const events = read("src/pages/api/v1/email/provider-events/index.ts");
    const review = read(
      "src/pages/api/v1/email/provider-events/[id]/review.ts"
    );

    expect(support).toContain('activityCode: "webhook"');
    expect(support).toContain('activityCode: "provider_events"');
    expect(callbacks).toContain("authorize: EMAIL_WEBHOOK_GUARDS.read");
    expect(callbacks).toContain("authorize: EMAIL_WEBHOOK_GUARDS.configure");
    expect(revoke).toContain("authorize: EMAIL_WEBHOOK_GUARDS.configure");
    expect(events).toContain("authorize: EMAIL_WEBHOOK_GUARDS.read");
    expect(review).toContain("authorize: EMAIL_WEBHOOK_GUARDS.approve");
  });

  test("the sidebar entry opens this page on the key the page accepts", () => {
    const email = listModules().find((module) => module.key === "email")!;

    expect(email.navigation).toContainEqual(
      expect.objectContaining({
        path: "/admin/email-webhooks",
        requiredPermission: "email.webhook.read"
      })
    );
    expect(page).toContain("authorize: READ_GUARD");
  });

  test("the controls are decided by the chokepoint, not by raw RBAC", () => {
    expect(page).toContain("can({ ...guard })");
    expect(page).not.toContain("ssr.permissions.has");
    expect(screen).toContain("await can(EMAIL_WEBHOOK_GUARDS.configure)");
    expect(screen).toContain("await can(EMAIL_WEBHOOK_GUARDS.approve)");
  });
});

describe("the screen applies the API's own visibility rules, not a copy", () => {
  test("callbacks and events are narrowed per account by the API's own decision", () => {
    expect(screen).toContain('"viewer"');
    expect(screen).toContain("access.canUseAccount(");
    expect(screen).toContain("directory.listWebhookSubscriptions(");
    expect(screen).toContain("listProviderEvents(");
    expect(read("src/pages/api/v1/email/provider-events/index.ts")).toContain(
      "access.canUseAccount("
    );
  });

  test("a dependency that cannot be loaded is `unavailable`, never an empty list", () => {
    expect(screen).toContain(
      "if (!lister || !directory || !access) return empty(true, false)"
    );
  });

  test("a review control needs the permission AND a pending bounce or unsubscribe", () => {
    expect(screen).toContain('event.reviewStatus === "pending"');
    expect(screen).toContain("REVIEWABLE_EVENT_TYPES.has(event.eventType)");
    expect(screen).toMatch(/canApprove &&/);
  });
});

describe("no token, hash or whole recipient is selected, rendered or kept", () => {
  test("neither the page nor the screen function touches a token, hash or secret store", () => {
    for (const source of [
      page,
      screen,
      read("src/lib/i18n/labels/email-webhooks.ts")
    ]) {
      expect(source).not.toContain("callbackTokenHash");
      expect(source).not.toContain("callback_token_hash");
      expect(source).not.toContain("recipientHash");
      expect(source).not.toContain("recipient_hash");
      expect(source).not.toContain("secret-store");
      expect(source).not.toContain("secretId");
      expect(source).not.toContain("externalId");
    }
  });

  test("the recipient is the masked form and a click is its host only", () => {
    expect(page).toContain("event.recipientMasked");
    expect(page).toContain("event.linkHost");
    expect(screen).toContain("recipientMasked: event.recipientMasked");
  });

  test("the script touches no web storage", () => {
    expect(page).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  test("the callback address is written by the script, never rendered by the server", () => {
    const html = page.slice(0, page.lastIndexOf("<script>"));
    const script = page.slice(page.lastIndexOf("<script>"));

    expect(html).not.toContain("callbackPath");
    expect(html).toContain('id="email-callback-reveal-url"');
    expect(html).toMatch(/id="email-callback-reveal-url"[\s\S]*?readonly/);
    expect(script).toContain("result.data.callbackPath");
  });

  test("the quarantine is labelled unauthenticated, in words and in the table caption", () => {
    expect(page).toContain('t("Unauthenticated")');
    expect(page).toContain("Events reported by Mailketing, unauthenticated");
  });
});

describe("the mutations are safe", () => {
  const script = page.slice(page.lastIndexOf("<script>"));

  test("each one is an audited, idempotent endpoint and sends an Idempotency-Key", () => {
    expect(script).toContain('"/api/v1/email/webhook-callbacks"');
    expect(script).toContain("/api/v1/email/webhook-callbacks/${id}/revoke");
    expect(script).toContain("/api/v1/email/provider-events/${id}/review");
    expect(script.match(/"Idempotency-Key"/g)?.length).toBe(3);
    expect(script).toContain("createIdempotencyKeySource");
  });

  test("every one asks for a confirmation before it sends", () => {
    expect(script.match(/confirmAction\(/g)?.length).toBe(3);
    // Rotation (an existing live address) is confirmed too, not only revoke.
    expect(script).toContain('say("confirmRotate")');
  });

  test("the script is bundled (an import-free script would be inlined and refused by the CSP)", () => {
    expect(script).toMatch(
      /import \{[\s\S]*?\} from "..\/..\/lib\/ui\/admin-form-client"/
    );
  });

  test("every error code the script maps is one an endpoint really emits", () => {
    const sources = [
      read("src/pages/api/v1/email/webhook-callbacks/index.ts"),
      read("src/pages/api/v1/email/webhook-callbacks/[id]/revoke.ts"),
      read("src/pages/api/v1/email/provider-events/[id]/review.ts"),
      read("src/modules/email/application/webhook-route-support.ts")
    ].join("\n");
    const shared = ["RATE_LIMITED", "ACCESS_DENIED"];
    const handled = [...script.matchAll(/case "([A-Z_]+)":/g)].map(
      (match) => match[1]!
    );

    expect(handled.length).toBeGreaterThan(0);

    for (const code of handled) {
      expect(sources.includes(`"${code}"`) || shared.includes(code)).toBe(true);
    }
  });
});

describe("states", () => {
  test("denied, error, unavailable and disabled each have their own element and are not conflated", () => {
    for (const id of [
      "email-webhooks-denied",
      "email-webhooks-error",
      "email-webhooks-unavailable",
      "email-webhooks-disabled"
    ]) {
      expect(page).toContain(`id="${id}"`);
    }
  });

  test("paging is keyset: a cursor link, never an offset", () => {
    expect(page).toContain('rel="next"');
    expect(page).toContain("data.nextCursor");
    expect(page).not.toMatch(/offset/i);
  });
});
