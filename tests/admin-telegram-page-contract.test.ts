/**
 * `/admin/telegram` gates against the endpoints it drives (Issue #965, ADR-0140).
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE,
 * including the owner, while still looking like a working screen.
 *
 * Properties of this screen worth pinning:
 *
 * - **Every permission the page names is DECLARED and SEEDED**, and the sidebar
 *   entry opens a page that exists.
 * - **No chat id, ciphertext, hash, body or variable is ever rendered or fetched**:
 *   the projections return the masked chat, and the page is held to using it.
 * - **The link code is never rendered by the server**: it appears once, in the
 *   response to the click, and goes straight into an anchor.
 * - **"Is this you?" is only answerable here**: the confirm and reject controls
 *   exist, and the page shows the captured name as escaped text.
 * - **Each panel is gated on its own permission.**
 *
 * Pure: no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/telegram.astro";
const ROUTES = {
  links: "src/pages/api/v1/telegram/links.ts",
  bindings: "src/pages/api/v1/telegram/bindings/index.ts",
  me: "src/pages/api/v1/telegram/bindings/me/index.ts",
  confirm: "src/pages/api/v1/telegram/bindings/me/confirm.ts",
  reject: "src/pages/api/v1/telegram/bindings/me/reject.ts",
  revokeOwn: "src/pages/api/v1/telegram/bindings/me/revoke.ts",
  revoke: "src/pages/api/v1/telegram/bindings/[id]/revoke.ts",
  settings: "src/pages/api/v1/telegram/settings.ts",
  diagnostics: "src/pages/api/v1/telegram/diagnostics.ts",
  templates: "src/pages/api/v1/telegram/templates.ts"
};

const EXPECTED = [
  "telegram_delivery.messages.read",
  "telegram_delivery.templates.read",
  "telegram_delivery.bindings.read",
  "telegram_delivery.bindings.revoke",
  "telegram_delivery.links.create",
  "telegram_delivery.settings.configure"
];

describe("/admin/telegram gates on keys that really exist", () => {
  test("every key the page names is DECLARED by the module and SEEDED by sql/218", async () => {
    const page = await readFile(PAGE, "utf8");
    const seed = await readFile(
      "sql/218_awcms_telegram_delivery_permissions.sql",
      "utf8"
    );
    const declared = new Set<string>();

    for (const module of listModules()) {
      for (const permission of module.permissions ?? []) {
        declared.add(
          `${module.key}.${permission.activityCode}.${permission.action}`
        );
      }
    }

    for (const key of EXPECTED) {
      const [, activityCode, action] = key.split(".");

      expect(page).toContain(`activityCode: "${activityCode}"`);
      expect(page).toContain(`action: "${action}"`);
      expect(declared.has(key)).toBe(true);
      expect(seed).toContain(`'${activityCode}', '${action}'`);
    }
  });

  test("each endpoint enforces the key the page assumes", async () => {
    const expectations: [keyof typeof ROUTES, string, string][] = [
      ["links", "links", "create"],
      ["bindings", "bindings", "read"],
      ["me", "links", "create"],
      ["confirm", "links", "create"],
      ["reject", "links", "create"],
      ["revokeOwn", "links", "create"],
      ["revoke", "bindings", "revoke"],
      ["settings", "messages", "read"],
      ["settings", "settings", "configure"],
      ["diagnostics", "messages", "read"],
      ["templates", "templates", "read"]
    ];

    for (const [route, activityCode, action] of expectations) {
      const source = await readFile(ROUTES[route], "utf8");

      expect(source).toContain('moduleKey: "telegram_delivery"');
      expect(source).toContain(`activityCode: "${activityCode}"`);
      expect(source).toContain(`action: "${action}"`);
    }
  });

  test("the sidebar entry opens the screen on a key the screen accepts", async () => {
    const module = listModules().find((m) => m.key === "telegram_delivery")!;
    const page = await readFile(PAGE, "utf8");

    expect(module.navigation).toEqual([
      expect.objectContaining({
        path: "/admin/telegram",
        requiredPermission: "telegram_delivery.links.create"
      })
    ]);

    // L14: the link shows for a holder of ANY panel's key (a diagnostics-only
    // administrator holds `messages.read` and nothing else), and every key it
    // names is declared by this module.
    const entry = module.navigation![0]!;
    const declared = new Set(
      (module.permissions ?? []).map(
        (p) => `${module.key}.${p.activityCode}.${p.action}`
      )
    );

    expect([...(entry.requiredAnyPermission ?? [])].sort()).toEqual(
      EXPECTED.filter((key) => key !== "telegram_delivery.links.create").sort()
    );

    for (const key of [
      entry.requiredPermission!,
      ...(entry.requiredAnyPermission ?? [])
    ]) {
      expect(declared.has(key)).toBe(true);
    }
    expect(module.status).toBe("active");
    expect(page).toContain('activityCode: "links"');
  });
});

describe("the properties this screen exists to keep", () => {
  test("no chat id, ciphertext, hash, body or variable is ever rendered", async () => {
    const page = (await readFile(PAGE, "utf8")).replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    );

    expect(page).toContain("binding.chatMasked");
    expect(page).toContain("own.chatMasked");
    expect(page).not.toMatch(/chat_?ciphertext/i);
    expect(page).not.toMatch(/chat_?hash/i);
    expect(page).not.toMatch(/\.chatId\b/);
    expect(page).not.toMatch(/\.body\b/);
    expect(page).not.toMatch(/(message|row|entry)\.variables\b/);
  });

  test("the server never renders a link code: it comes from the click's response", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain('"POST",\n      "/api/v1/telegram/links"');
    expect(page).toContain('startsWith("https://t.me/")');
    // The anchor is filled by the client script only.
    expect(page).toContain('id="telegram-link-anchor"');
    expect(page).not.toMatch(/telegram-link-anchor[^>]*href=\{/);
  });

  test('"is this you?" is answered here, with the captured name as escaped text', async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("js-telegram-confirm");
    expect(page).toContain("js-telegram-reject");
    expect(page).toContain("/api/v1/telegram/bindings/me/confirm");
    expect(page).toContain("/api/v1/telegram/bindings/me/reject");
    expect(page).toContain("{own.displayName");
    expect(page).not.toMatch(/set:html|innerHTML/);
  });

  test("the mutations call the real endpoints with the right verbs", async () => {
    // Whitespace-normalised: prettier wraps the calls that now pass headers.
    const page = (await readFile(PAGE, "utf8")).replace(/\s+/g, " ");

    expect(page).toContain('"POST", "/api/v1/telegram/bindings/me/revoke"');
    expect(page).toContain(
      '"POST", `/api/v1/telegram/bindings/${bindingId}/revoke`'
    );
    expect(page).toContain('"PUT", "/api/v1/telegram/settings", { enabled }');
  });

  test("each panel is gated on its OWN permission", async () => {
    const page = await readFile(PAGE, "utf8");

    for (const flag of [
      "data.canLink",
      "data.canReadBindings",
      "data.canReadMessages",
      "data.canReadTemplates",
      "data.canConfigure",
      "data.canRevokeBindings"
    ]) {
      expect(page).toContain(`{${flag} &&`);
    }
  });

  test("turning the tenant switch OFF asks first", async () => {
    const page = await readFile(PAGE, "utf8");

    // The themed dialog, never the OS `window.confirm` (ADR-0125; the repo-wide
    // `admin-no-raw-browser-dialogs` test enforces the second half).
    expect(page).toContain("await confirmAction(");
    expect(page).not.toContain("window.confirm(");
  });
});

describe("audit M1 and L1: the handshake routes", () => {
  test("every route that manages the caller's OWN chat refuses a machine credential, after authorize", async () => {
    for (const route of [
      "links",
      "me",
      "confirm",
      "reject",
      "revokeOwn"
    ] as const) {
      const source = await readFile(ROUTES[route], "utf8");

      expect(source).toContain("refuseNonInteractive(auth.context)");
      expect(source.indexOf("authorize:")).toBeLessThan(
        source.indexOf("refuseNonInteractive(auth.context)")
      );
    }
  });

  test("confirm and reject send and require the id of the chat that was shown", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("data-binding-id={own.id}");
    expect(page).toContain("/api/v1/telegram/bindings/me/confirm");
    expect(page).toContain("{ bindingId }");

    for (const [route, parser] of [
      ["confirm", "parseConfirmBody"],
      ["reject", "parseBindingIdBody"]
    ] as const) {
      const source = await readFile(ROUTES[route], "utf8");

      expect(source).toContain(parser);
      expect(source).toContain("409");
    }
  });
});

describe("Issue #1008: proof of possession and idempotency on the routes", () => {
  test("confirm needs the PIN, verifies it against the hash ring, and fails closed without one", async () => {
    const source = await readFile(ROUTES.confirm, "utf8");
    const page = await readFile(PAGE, "utf8");

    expect(source).toContain("parseConfirmBody(prepared.payload)");
    expect(source).toContain("resolveTelegramHashRing()");
    expect(source).toContain("TELEGRAM_PIN_INVALID");
    expect(source).toContain("TELEGRAM_PIN_LOCKED");
    // The screen asks for the PIN and sends it with the chat it was shown.
    expect(page).toContain('id="telegram-pin"');
    expect(page).toContain("bindingId,\n          pin");
  });

  test("the administrator revoke and the switch require an Idempotency-Key, are person-only, and are keyed per actor", async () => {
    for (const route of ["revoke", "settings"] as const) {
      const source = await readFile(ROUTES[route], "utf8");

      expect(source).toContain("readIdempotencyKey(request)");
      expect(source).toContain("runTelegramIdempotent(");
      expect(source).toContain("refuseMachineCredential(auth.context)");
      expect(source.indexOf("authorize:")).toBeLessThan(
        source.indexOf("refuseMachineCredential(auth.context)")
      );
      // The refusal comes before any work, the key before the mutation.
      expect(
        source.indexOf("refuseMachineCredential(auth.context)")
      ).toBeLessThan(source.indexOf("runTelegramIdempotent("));
    }

    const page = await readFile(PAGE, "utf8");

    expect(page.match(/idempotency\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("the mutations are registered as idempotent in OpenAPI", async () => {
    const spec = await readFile(
      "openapi/modules/telegram-delivery.openapi.yaml",
      "utf8"
    );

    expect(spec).toContain("IdempotencyKey");
    expect(spec).toContain("TELEGRAM_PIN_INVALID");
    expect(spec).toContain("TELEGRAM_PIN_LOCKED");
  });
});

describe("the admin ledger", () => {
  test("no `telegram_delivery` key is left on NOT_YET_SCREENED", async () => {
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");

    expect(
      NOT_YET_SCREENED.filter((key) => key.startsWith("telegram_delivery."))
    ).toEqual([]);
    expect(EXPECTED).toHaveLength(6);
  });
});
