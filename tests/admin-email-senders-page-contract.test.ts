/**
 * `/admin/email-senders` gates against the endpoints it drives (Issue #1162,
 * ADR-0151 sections 2 and 7, ADR-0149).
 *
 * Sibling of `admin-channel-accounts-page-contract.test.ts`, for the same silent
 * failure: a page gating on a permission key no migration seeds hides the
 * control from EVERYONE, the owner included, while still looking like a working
 * screen. The properties pinned here are the ones the issue makes load-bearing:
 *
 * - every permission the screen names is DECLARED, SEEDED and ENFORCED by the
 *   endpoint behind the control, and the sidebar entry opens a page that exists;
 * - NO credential, secret reference or token is ever rendered, fetched or kept;
 * - what the screen cannot do safely (test send, lists and campaigns) is shown
 *   DISABLED and explained, never a working-looking button, and rotation and
 *   disconnect are LINKS to the connection manager, not a duplicate control;
 * - the one control (make default) sends an `Idempotency-Key` and only error
 *   codes the endpoint really emits.
 *
 * Pure: no database, no network.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { stripComments } from "../scripts/lib/source-text";
import {
  EMAIL_SENDERS_READ_GUARD,
  EMAIL_SENDER_POLICY_GUARD
} from "../src/modules/email/application/email-senders-screen";

const PAGE = "src/pages/admin/email-senders.astro";
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const page = read(PAGE);

function literalGuard(source: string, name: string) {
  const match = new RegExp(
    `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)"\\s*\\} as const;`
  ).exec(source);

  expect(match).not.toBeNull();

  return { moduleKey: match![1], activityCode: match![2], action: match![3] };
}

describe("the screen gates on keys that really exist", () => {
  test("each literal guard equals the module's own constant", () => {
    expect(literalGuard(page, "READ_GUARD")).toEqual(EMAIL_SENDERS_READ_GUARD);
    expect(literalGuard(page, "POLICY_GUARD")).toEqual(
      EMAIL_SENDER_POLICY_GUARD
    );
  });

  test("every key is DECLARED by the email module and SEEDED by a migration", () => {
    const email = listModules().find((module) => module.key === "email")!;
    const declared = new Set(
      (email.permissions ?? []).map(
        (permission) => `${permission.activityCode}.${permission.action}`
      )
    );
    const seed = read("sql/347_awcms_email_sender_routing_permissions.sql");

    for (const [activity, action] of [
      ["senders", "read"],
      ["sender_policy", "configure"]
    ]) {
      expect(declared.has(`${activity}.${action}`)).toBe(true);
      expect(seed).toContain(`'email', '${activity}', '${action}'`);
    }
  });

  test("each endpoint enforces the key the screen assumes", () => {
    expect(read("src/pages/api/v1/email/senders.ts")).toContain(
      'activityCode: "senders"'
    );
    const policy = read("src/pages/api/v1/email/sender-policy.ts");

    expect(policy).toContain('activityCode: "sender_policy"');
    expect(policy).toContain('action: "configure"');
  });

  test("the sidebar entry opens this page on the key the page accepts", () => {
    const email = listModules().find((module) => module.key === "email")!;

    expect(email.navigation).toContainEqual(
      expect.objectContaining({
        path: "/admin/email-senders",
        requiredPermission: "email.senders.read"
      })
    );
    expect(page).toContain("authorize: READ_GUARD");
  });

  test("the control is decided by the chokepoint, not by raw RBAC", () => {
    expect(page).toContain("can({ ...guard })");
    expect(page).not.toContain("ssr.permissions.has");
  });
});

describe("the screen applies the API's own visibility rules, not a copy", () => {
  const screen = read("src/modules/email/application/email-senders-screen.ts");
  const route = read("src/pages/api/v1/email/senders.ts");

  test("the list route and the screen share ONE visibility function", () => {
    expect(route).toContain("filterVisibleEmailSenders(");
    expect(screen).toContain("filterVisibleEmailSenders(");
  });

  test("accounts come from the channel registry's own listing under the senders.read guard", () => {
    expect(screen).toContain("lister.list(");
    expect(screen).toContain("EMAIL_SENDERS_READ_GUARD");
    expect(
      read("src/modules/email/infrastructure/channel-account-loaders.ts")
    ).toContain("support.canSeeAllAccounts(context)");
  });

  test("the verdict is the dispatcher's freshness gate", () => {
    expect(read("src/modules/email/domain/email-senders-view.ts")).toContain(
      "evaluateEmailSenderHealth(input)"
    );
  });

  test("a dependency that cannot be loaded is `unavailable`, never an empty list", () => {
    expect(screen).toContain(
      "if (!lister || !access) return empty(true, false)"
    );
  });
});

describe("no credential is rendered, fetched or kept", () => {
  test("the page and the screen import no secret store and select no reference", () => {
    const sources = [
      page,
      read("src/modules/email/application/email-senders-screen.ts"),
      read("src/modules/email/domain/email-senders-view.ts"),
      read("src/lib/i18n/labels/email-senders.ts")
    ];

    for (const source of sources) {
      expect(source).not.toContain("secret-store");
      expect(source).not.toContain("defaultSecretStore");
      expect(source).not.toContain("secretId");
      expect(source).not.toContain("secret_id");
      expect(source).not.toContain(".resolve(");
      expect(source).not.toContain("resolveEmailCredential");
      expect(source).not.toContain("webhook");
    }
  });

  test("the sender address is masked and the raw external id is never rendered", () => {
    expect(page).toContain("sender.addressMasked");
    expect(page).not.toContain("externalId");
    expect(
      read("src/modules/email/application/email-senders-screen.ts")
    ).toContain("maskSenderAddress(account.externalId)");
  });

  test("the script touches no web storage and holds no credential input", () => {
    expect(page).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(page).not.toMatch(/type="password"/);
  });
});

describe("what is not safe to offer is shown disabled, and links go to the owner of the action", () => {
  test("test send and remote list/campaign management are disabled buttons with a stated reason", () => {
    for (const reason of ["email-test-send-why", "email-lists-why"]) {
      expect(page).toContain(`aria-describedby="${reason}"`);
      expect(page).toContain(`id="${reason}"`);
    }

    // A disabled control is `disabled`, not hidden and not a live handler.
    expect(page.match(/\sdisabled(\s|>)/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2
    );
    expect(page).not.toContain("js-email-test-send");
  });

  test("a withheld make-default is disabled with its reason, not omitted", () => {
    expect(page).toContain("disabled={sender.defaultWithheld !== null}");
    expect(page).toContain("email-default-why-");
  });

  test("rotation and disconnect are links to the connection manager, with no control here", () => {
    expect(page).toContain("/admin/channel-accounts");
    expect(page).not.toContain("/disconnect");
    expect(page).not.toContain("/credential");
  });

  test("the page says the provider is outbound only", () => {
    expect(page).toContain("These senders have no inbox");
  });
});

describe("the one mutation is safe", () => {
  const script = page.slice(page.lastIndexOf("<script>"));

  test("it is the audited, idempotent sender-policy endpoint with an Idempotency-Key", () => {
    expect(script).toContain('"/api/v1/email/sender-policy"');
    expect(script).toContain('"PUT"');
    expect(script).toContain('"Idempotency-Key"');
    expect(script).toContain("createIdempotencyKeySource");
    // It is the ONLY mutation the script can send.
    expect(script.match(/sendJson\(/g)?.length).toBe(1);
  });

  test("the script is bundled (an import-free script would be inlined and refused by the CSP)", () => {
    expect(script).toMatch(
      /import \{[\s\S]*?\} from "..\/..\/lib\/ui\/admin-form-client"/
    );
  });

  test("every error code the script maps is one the endpoint really emits", () => {
    const route = read("src/pages/api/v1/email/sender-policy.ts");
    const handled = [...script.matchAll(/case "([A-Z_]+)":/g)].map(
      (match) => match[1]!
    );

    expect(handled.length).toBeGreaterThan(0);

    for (const code of handled) {
      // `ACCESS_DENIED`, `SENDER_UNAVAILABLE`, ... appear in the route's source
      // or in the shared chokepoint answers every tenant route returns.
      const shared = ["RATE_LIMITED", "IDEMPOTENCY_CONFLICT", "ACCESS_DENIED"];

      expect(route.includes(`"${code}"`) || shared.includes(code)).toBe(true);
    }
  });

  test("the notice after a change is an allow-list, never echoed text", () => {
    expect(page).toContain("Object.hasOwn(NOTICES, noticeKey)");
  });
});

describe("states", () => {
  test("denied, error, unavailable and disabled each have their own element and are not conflated", () => {
    for (const id of [
      "email-senders-denied",
      "email-senders-error",
      "email-senders-unavailable",
      "email-senders-disabled"
    ]) {
      expect(page).toContain(`id="${id}"`);
    }
  });

  test("the migration warning, credit, freshness and queue are rendered", () => {
    for (const hook of [
      "email-senders-migration-v1",
      "email-senders-migration-unverified",
      "data-credit=",
      "data-freshness=",
      "laneText(sender.lane)"
    ]) {
      expect(page).toContain(hook);
    }
  });
});
