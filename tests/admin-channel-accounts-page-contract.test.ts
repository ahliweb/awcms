/**
 * `/admin/channel-accounts` and `/admin/channel-accounts/[id]` gate against the
 * endpoints they drive (Issue #1154, ADR-0148 UP-08).
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE,
 * the owner included, while still looking like a working screen. The properties
 * pinned here are the ones the issue makes load-bearing:
 *
 * - every permission the screens name is DECLARED, SEEDED and ENFORCED by the
 *   endpoint behind the control, and the navigation entry opens a page that
 *   exists on a key the page accepts;
 * - NO credential is ever rendered, fetched or kept: the screens import no
 *   secret store and select no reference, "replace credential" is a write-only
 *   password field with no "show", and the script touches no web storage;
 * - a capability the provider does not offer is shown DISABLED, never filtered
 *   out of the table;
 * - there is no Connect button, because no connector exists to verify one;
 * - every mutation the script sends carries an `Idempotency-Key`, and the two
 *   terminal actions are confirmed by typing, not by a click-through.
 *
 * Pure: no database, no network.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { stripComments } from "../scripts/lib/source-text";
import { CHANNEL_ACCOUNTS_GUARDS } from "../src/modules/channel-accounts/domain/channel-accounts-constants";

const LIST_PAGE = "src/pages/admin/channel-accounts.astro";
const DETAIL_PAGE = "src/pages/admin/channel-accounts/[id].astro";
/** Comments stripped: the docblocks name the very things the screens must not do. */
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const list = read(LIST_PAGE);
const detail = read(DETAIL_PAGE);
const both = `${list}\n${detail}`;

/** The literal guard object a page spells out, so the coverage gate (which reads source text) sees it. */
function literalGuard(source: string, name: string) {
  const match = new RegExp(
    `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)"\\s*\\} as const;`
  ).exec(source);

  expect(match).not.toBeNull();

  return { moduleKey: match![1], activityCode: match![2], action: match![3] };
}

describe("the screens gate on keys that really exist", () => {
  test("each literal guard equals the module's own guard constant", () => {
    expect(literalGuard(list, "READ_GUARD")).toEqual(
      CHANNEL_ACCOUNTS_GUARDS.read
    );
    expect(literalGuard(detail, "READ_GUARD")).toEqual(
      CHANNEL_ACCOUNTS_GUARDS.read
    );
    expect(literalGuard(detail, "DISCONNECT_GUARD")).toEqual(
      CHANNEL_ACCOUNTS_GUARDS.disconnect
    );
    expect(literalGuard(detail, "CREDENTIALS_GUARD")).toEqual(
      CHANNEL_ACCOUNTS_GUARDS.manageCredentials
    );
  });

  test("every key is DECLARED by its module and SEEDED by a migration", () => {
    const declared = new Set<string>();

    for (const module of listModules()) {
      for (const permission of module.permissions ?? []) {
        declared.add(
          `${module.key}.${permission.activityCode}.${permission.action}`
        );
      }
    }

    const channelSeed = read("sql/319_awcms_channel_accounts_permissions.sql");
    const whatsappSeed = read(
      "sql/323_awcms_whatsapp_sender_routing_permissions.sql"
    );
    const keys: [string, string, string, string][] = [
      ["channel_accounts", "accounts", "read", channelSeed],
      ["channel_accounts", "accounts", "revoke", channelSeed],
      ["channel_accounts", "credentials", "manage", channelSeed],
      ["whatsapp_delivery", "sender_policy", "configure", whatsappSeed],
      ["whatsapp_delivery", "senders", "read", whatsappSeed]
    ];

    for (const [moduleKey, activityCode, action, seed] of keys) {
      expect(declared.has(`${moduleKey}.${activityCode}.${action}`)).toBe(true);
      expect(seed).toContain(`'${moduleKey}', '${activityCode}', '${action}'`);
    }
  });

  test("each endpoint enforces the key the screen assumes", () => {
    const expectations: [string, string][] = [
      [
        "src/pages/api/v1/channel-accounts/accounts/index.ts",
        "CHANNEL_ACCOUNTS_GUARDS.read"
      ],
      [
        "src/pages/api/v1/channel-accounts/accounts/[id]/credential.ts",
        "CHANNEL_ACCOUNTS_GUARDS.manageCredentials"
      ],
      [
        "src/pages/api/v1/channel-accounts/accounts/[id]/disconnect.ts",
        "CHANNEL_ACCOUNTS_GUARDS.disconnect"
      ],
      [
        "src/pages/api/v1/channel-accounts/connections/[id]/revoke.ts",
        "CHANNEL_ACCOUNTS_GUARDS.disconnect"
      ]
    ];

    for (const [route, guard] of expectations) {
      expect(read(route)).toContain(guard);
    }

    const senderPolicy = read("src/pages/api/v1/whatsapp/sender-policy.ts");

    expect(senderPolicy).toContain('activityCode: "sender_policy"');
    expect(senderPolicy).toContain('action: "configure"');
  });

  test("the sidebar entry opens the list page on the key the page accepts", () => {
    const module = listModules().find((m) => m.key === "channel_accounts")!;

    expect(module.status).toBe("active");
    expect(module.navigation).toEqual([
      expect.objectContaining({
        path: "/admin/channel-accounts",
        requiredPermission: "channel_accounts.accounts.read"
      })
    ]);
    expect(list).toContain("authorize: READ_GUARD");
  });

  test("a control is shown only when the chokepoint allows its permission", () => {
    // `can(...)` runs the full chokepoint, so a deny policy hides the button.
    expect(detail).toContain("await can(DISCONNECT_GUARD)");
    expect(detail).toContain("await can(CREDENTIALS_GUARD)");
    expect(detail).toContain("await can(SENDER_POLICY_GUARD)");
    expect(detail).toContain("await can(SENDERS_READ_GUARD)");
    // Not `ssr.permissions.has`: that is raw RBAC and skips ABAC and module state.
    expect(both).not.toContain("ssr.permissions.has");
  });

  test("both screens use the routes' own visibility rules, not a copy", () => {
    expect(list).toContain("canSeeAllAccounts");
    expect(list).toContain("scopeCoveredFor");
    expect(list).toContain("filterVisibleConnections");
    expect(detail).toContain("loadAuthorizedAccount");
    expect(detail).toContain("mayRevokeConnection");
  });
});

describe("no credential is rendered, fetched or kept", () => {
  test("the screens import no secret store and select no reference", () => {
    for (const source of [list, detail]) {
      expect(source).not.toContain("application/secret-store");
      expect(source).not.toContain("defaultSecretStore");
      expect(source).not.toContain("secretId");
      expect(source).not.toContain("secret_id");
      expect(source).not.toContain(".resolve(");
      expect(source).not.toContain("channel-sender-credential-adapter");
    }
  });

  test("the account shown is the PUBLIC view (no secret reference)", () => {
    expect(detail).toContain("toPublicAccount(loaded.account)");
    // The list uses the directory's view type, which has `hasCredential` only.
    expect(list).toContain("type AccountView");
  });

  test("replace credential is a write-only password field with no show control", () => {
    expect(detail).toContain('type="password"');
    expect(detail).toContain('autocomplete="new-password"');
    expect(detail).toContain('spellcheck="false"');
    expect(detail).not.toMatch(/show (the )?(credential|secret|token)/i);
    expect(detail).not.toMatch(/type="text"[^>]*secret/);
    // No value attribute is ever rendered into the field.
    expect(detail).not.toMatch(/id="channel-account-secret"[^>]*\svalue=/);
  });

  test("the script keeps the value in no storage, URL or message, and clears the field", () => {
    const script = detail.slice(detail.indexOf("<script>"));

    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
    expect(script).not.toContain("document.cookie");
    expect(script).not.toContain("indexedDB");
    expect(script).toContain('input.value = ""');
    // The success notice is an allow-listed key, never echoed text.
    expect(script).toContain("?notice=${notice}");
    expect(detail).toContain("Object.hasOwn(NOTICES, noticeKey)");
  });

  test("the stored credential is only ever reported as present or absent", () => {
    expect(detail).toContain("account.hasCredential");
    expect(detail).toContain("Stored (write-only, never shown)");
  });

  test("an external identity is masked in both screens", () => {
    expect(list).toContain("maskExternalId(account.externalId)");
    expect(detail).toContain("maskExternalId(account.externalId)");
    expect(list).not.toMatch(/\{account\.externalId\}/);
    expect(detail).not.toMatch(/\{account\.externalId\}/);
  });
});

describe("capability evidence and the absence of a Connect button", () => {
  test("every capability row is rendered; an unsupported one is disabled, not filtered", () => {
    expect(detail).toContain("detail.capabilities.map(");
    expect(detail).not.toMatch(/detail\.capabilities\s*\.filter\(/);
    expect(detail).toContain("capabilityRowDisplay(capability)");
    expect(detail).toContain('aria-disabled={display.disabled ? "true"');
  });

  test("there is no Connect control and no OAuth start", () => {
    for (const source of [list, detail]) {
      expect(source).not.toContain("oauth/start");
      expect(source).not.toMatch(/>\s*\{t\("Connect"\)\}/);
      expect(source).not.toMatch(/js-channel-connect/);
    }
  });

  test("the provider table explains why a provider has no Connect action", () => {
    expect(list).toContain("providerAvailability(");
    expect(list).toContain("getChannelOAuthAdapter(provider)");
  });
});

describe("mutations: idempotent, and the terminal ones are typed", () => {
  const script = detail.slice(detail.indexOf("<script>"));

  test("every mutation the script sends carries an Idempotency-Key", () => {
    const sends = [...script.matchAll(/sendJson\(\s*"(?:PUT|POST|DELETE)"/g)];
    // credential, step-up (a login-style call that takes no key), disconnect /
    // revoke (through `confirmedPost`), default sender.
    const withKey = [
      ...script.matchAll(/"Idempotency-Key":\s*(?:key|newKey\(\))/g)
    ];

    expect(sends.length).toBeGreaterThanOrEqual(4);
    // Every send except the step-up carries one.
    expect(withKey.length).toBe(sends.length - 1);
  });

  test("the endpoints the script calls are the ones that exist", () => {
    expect(script).toContain(
      "/api/v1/channel-accounts/accounts/${accountId}/credential"
    );
    expect(script).toContain(
      "/api/v1/channel-accounts/accounts/${form.dataset.accountId}/disconnect"
    );
    expect(script).toContain(
      "/api/v1/channel-accounts/connections/${form.dataset.connectionId}/revoke"
    );
    expect(script).toContain("/api/v1/whatsapp/sender-policy");
  });

  test("disconnect and revoke are confirmed by typing a name, not a click-through", () => {
    expect(detail).toContain("Type the account name to confirm");
    expect(detail).toContain("Type the provider name to confirm");
    expect(script).toContain("confirmationMatches(input.value, expected)");
    expect(script).not.toContain("confirmAction(");
  });

  test("the disconnect panel states the queue impact for a sender", () => {
    expect(detail).toContain("channel-account-queue-impact");
    expect(detail).toContain("summarizeWhatsappSenders(");
  });
});
