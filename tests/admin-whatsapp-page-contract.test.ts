/**
 * `/admin/whatsapp` gates against the endpoints it drives (Issue #963, ADR-0133).
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE
 * — including the owner — while still looking like a working screen.
 *
 * Properties of this screen worth pinning:
 *
 * - **Every permission the page names is DECLARED and SEEDED**, and the sidebar
 *   entry is gated on the same key the screen opens on.
 * - **No raw number, body or variable is ever rendered**: the projections return
 *   the masked recipient, and the page is held to using it.
 * - **`alreadySuppressed` is an ANSWER, not an error**, so the add form must not
 *   reload it away (the list is masked and unsearchable).
 * - **Consent has no segment control**: nothing on this screen offers to infer an
 *   opt-in from an audience.
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/whatsapp.astro";
const ROUTES = {
  diagnostics: "src/pages/api/v1/whatsapp/diagnostics.ts",
  cancel: "src/pages/api/v1/whatsapp/messages/[id]/cancel.ts",
  suppressions: "src/pages/api/v1/whatsapp/suppressions/index.ts",
  suppression: "src/pages/api/v1/whatsapp/suppressions/[id].ts",
  consents: "src/pages/api/v1/whatsapp/consents/index.ts",
  withdraw: "src/pages/api/v1/whatsapp/consents/[id]/withdraw.ts",
  templates: "src/pages/api/v1/whatsapp/templates.ts"
};

const EXPECTED = [
  "whatsapp_delivery.messages.read",
  "whatsapp_delivery.messages.cancel",
  "whatsapp_delivery.consents.read",
  "whatsapp_delivery.consents.create",
  "whatsapp_delivery.consents.restore",
  "whatsapp_delivery.consents.withdraw",
  "whatsapp_delivery.suppressions.read",
  "whatsapp_delivery.suppressions.create",
  "whatsapp_delivery.suppressions.delete",
  "whatsapp_delivery.templates.read"
];

describe("/admin/whatsapp gates on keys that really exist", () => {
  test("every key the page names is DECLARED by the module and SEEDED by sql/179", async () => {
    const page = await readFile(PAGE, "utf8");
    const seed = await readFile(
      "sql/179_awcms_whatsapp_delivery_permissions.sql",
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
      ["diagnostics", "messages", "read"],
      ["cancel", "messages", "cancel"],
      ["suppressions", "suppressions", "read"],
      ["suppressions", "suppressions", "create"],
      ["suppression", "suppressions", "delete"],
      ["consents", "consents", "read"],
      ["consents", "consents", "create"],
      ["consents", "consents", "restore"],
      ["withdraw", "consents", "withdraw"],
      ["templates", "templates", "read"]
    ];

    for (const [route, activityCode, action] of expectations) {
      const source = await readFile(ROUTES[route], "utf8");

      expect(source).toContain('moduleKey: "whatsapp_delivery"');
      expect(source).toContain(`activityCode: "${activityCode}"`);
      expect(source).toContain(`action: "${action}"`);
    }
  });

  test("the sidebar entry opens the same screen on the same key", async () => {
    const module = listModules().find((m) => m.key === "whatsapp_delivery")!;
    const page = await readFile(PAGE, "utf8");

    expect(module.navigation).toEqual([
      expect.objectContaining({
        path: "/admin/whatsapp",
        requiredPermission: "whatsapp_delivery.messages.read"
      })
    ]);
    expect(module.status).toBe("active");
    expect(page).toContain('activityCode: "messages"');
  });
});

describe("the properties this screen exists to keep", () => {
  test("no raw number, body or variable is ever rendered", async () => {
    const page = (await readFile(PAGE, "utf8")).replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    );

    expect(page).toContain("message.recipientMasked");
    expect(page).toContain("consent.recipientMasked");
    expect(page).toContain("entry.recipientMasked");
    expect(page).not.toMatch(/\.recipient\}/);
    // `template.variables` is the allow-list of NAMES; a message's body and
    // variable VALUES are never projected.
    expect(page).not.toMatch(/\.body\b/);
    expect(page).not.toMatch(/(message|row|entry)\.variables\b/);
    expect(page).not.toContain("recipientHash");
  });

  test("`alreadySuppressed` is surfaced, not reloaded away", async () => {
    const page = await readFile(PAGE, "utf8");
    const block = page.slice(
      page.indexOf('onSubmit("whatsapp-suppression-form"'),
      page.lastIndexOf("</script>")
    );

    expect(block.length).toBeGreaterThan(200);
    expect(block).toContain("alreadySuppressed");
    expect(block.indexOf("alreadySuppressed")).toBeLessThan(
      block.indexOf("window.location.reload()")
    );
  });

  test("the mutations call the real endpoints with the right verbs", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain(
      '"POST", `/api/v1/whatsapp/messages/${messageId}/cancel`'
    );
    expect(page).toContain(
      '"POST", `/api/v1/whatsapp/consents/${consentId}/withdraw`'
    );
    expect(page).toContain(
      '"DELETE", `/api/v1/whatsapp/suppressions/${suppressionId}`'
    );
    expect(page).toContain('"/api/v1/whatsapp/consents"');
    expect(page).toContain('"/api/v1/whatsapp/suppressions"');
  });

  test("consent is a per-recipient record: no segment or audience control", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).not.toMatch(/segment(Id|s)?\b[^"]*=/i);
    expect(page).not.toMatch(
      /<(select|input)[^>]*name="(segment|audience|list)/i
    );
  });

  test("each panel is gated on its OWN read permission", async () => {
    const page = await readFile(PAGE, "utf8");

    for (const flag of [
      "data.canReadConsents",
      "data.canReadSuppressions",
      "data.canReadTemplates"
    ]) {
      expect(page).toContain(`{${flag} && (`);
    }
  });
});

describe("the admin ledger", () => {
  test("no `whatsapp_delivery` key is left on NOT_YET_SCREENED", async () => {
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");

    expect(
      NOT_YET_SCREENED.filter((key) => key.startsWith("whatsapp_delivery."))
    ).toEqual([]);
    expect(EXPECTED).toHaveLength(10);
  });
});
