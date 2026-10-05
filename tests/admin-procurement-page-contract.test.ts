/**
 * `/admin/procurement` gates against the endpoints it drives — Issue #905
 * (ADR-0128).
 *
 * Sibling of `admin-inventory-tax-page-contract.test.ts`. The screen is five
 * independently-readable views behind one any-of entry decision, so every key it
 * names must be declared AND seeded (a key nobody seeds denies even the owner),
 * every high-risk call must carry an `Idempotency-Key`, the reveal must never
 * put a clear value into markup or storage, and the module must be `active`
 * with a navigation entry that points at the page.
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/procurement.astro";
const API = "src/pages/api/v1/procurement";

function declared(): Set<string> {
  const keys = new Set<string>();
  for (const module of listModules()) {
    for (const permission of module.permissions ?? []) {
      keys.add(`${module.key}.${permission.activityCode}.${permission.action}`);
    }
  }
  return keys;
}

const KEYS = [
  "procurement.suppliers.read",
  "procurement.suppliers.create",
  "procurement.suppliers.update",
  "procurement.suppliers.delete",
  "procurement.suppliers.restore",
  "procurement.suppliers.reveal",
  "procurement.documents.read",
  "procurement.documents.create",
  "procurement.documents.submit",
  "procurement.documents.finalise",
  "procurement.documents.cancel",
  "procurement.documents.reverse",
  "procurement.documents.reconcile",
  "procurement.policy.read",
  "procurement.policy.configure",
  "procurement.reports.read",
  "inventory.locations.read"
];

describe("every key the screen names is declared, and the page names it", () => {
  test("keys", async () => {
    const page = await readFile(PAGE, "utf8");
    const all = declared();

    for (const key of KEYS) {
      const [moduleKey, activityCode, action] = key.split(".");
      expect(all.has(key)).toBe(true);
      expect(page).toContain(`moduleKey: "${moduleKey}"`);
      expect(page).toContain(`activityCode: "${activityCode}"`);
      expect(page).toContain(`action: "${action}"`);
    }
  });

  test("every key is seeded by the migration", async () => {
    const seed = await readFile(
      "sql/175_awcms_procurement_permissions.sql",
      "utf8"
    );

    for (const key of KEYS.filter((k) => k.startsWith("procurement."))) {
      const [, activityCode, action] = key.split(".");
      expect(seed).toContain(`'procurement', '${activityCode}', '${action}'`);
    }
  });
});

describe("the entry decision is any-of over the read permissions", () => {
  test("shape", async () => {
    const page = await readFile(PAGE, "utf8");
    expect(page).toMatch(/authorize: \[/);
    expect(page).toContain(
      "const [maySuppliers, mayDocuments, mayPolicy, mayReports, mayReconcile] ="
    );
  });
});

describe("the controls call endpoints that exist, with an Idempotency-Key where the endpoint needs one", () => {
  test("endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    for (const [url, route, keyed] of [
      ["${BASE}/suppliers`", "suppliers/index.ts", false],
      ["/restore", "suppliers/[id]/restore.ts", false],
      ["/identifiers`", "suppliers/[id]/identifiers/index.ts", false],
      [
        "/reveal`",
        "suppliers/[id]/identifiers/[identifierId]/reveal.ts",
        false
      ],
      ["${BASE}/documents`", "documents/index.ts", true],
      ["/${action}`", "documents/[id]/submit.ts", true],
      ["/${action}`", "documents/[id]/finalise.ts", true],
      ["/${path}`", "documents/[id]/cancel.ts", true],
      ["/${path}`", "documents/[id]/reversal.ts", true],
      ["${BASE}/policy`", "policy.ts", true]
    ] as const) {
      expect(page).toContain(url);
      const source = await readFile(`${API}/${route}`, "utf8");
      expect(source.includes("readIdempotencyKey")).toBe(keyed);
    }

    expect(page).toContain("Idempotency-Key");
    expect(page).toContain('"reversal"');
  });

  test("every high-risk call takes its key from the content-derived source", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("createIdempotencyKeySource()");
    expect(page).not.toMatch(/Idempotency-Key"?:\s*crypto\.randomUUID/);
  });
});

describe("what the screen may not do", () => {
  test("no control writes a balance, a total or a lifecycle state", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).not.toMatch(
      /name="(onHand|on_hand|balance|totalCost|status)"[^>]*hidden/
    );
    expect(page).not.toContain("/api/v1/inventory/");
    expect(page).not.toContain("/api/v1/procurement/documents/${id}`");
  });

  test("no own <h1>, no inline style attribute, no raw fetch, no window.confirm", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).not.toContain("<h1");
    expect(page).not.toMatch(/\sstyle=/);
    expect(page).not.toMatch(/\bfetch\(/);
    expect(page).not.toContain("window.confirm");
    expect(page).toContain('from "../../lib/ui/admin-form-client"');
  });

  test("no innerHTML of any kind in the page script or the model", async () => {
    const strip = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const page = strip(await readFile(PAGE, "utf8"));
    const model = strip(
      await readFile("src/lib/ui/procurement-document-model.ts", "utf8")
    );

    for (const source of [page, model]) {
      expect(source).not.toMatch(/innerHTML|insertAdjacentHTML|set:html/);
    }
  });

  test("high-risk actions are confirmed or reasoned before they are sent", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("<ReasonPanel");
    expect(page).toContain("initReasonPanel()");
    expect(page).toContain("data-reason-form");
    const action = page.slice(page.indexOf('onAction(".js-document-action"'));
    expect(action.indexOf("confirmAction(")).toBeGreaterThan(-1);
    expect(action.indexOf("confirmAction(")).toBeLessThan(
      action.indexOf("sendJson(")
    );
  });
});

describe("the audited reveal", () => {
  test("the clear value goes to one live region as text, and is never persisted", async () => {
    const page = await readFile(PAGE, "utf8");
    const reveal = page.slice(
      page.indexOf("const revealPanel"),
      page.indexOf("// --- Document form")
    );

    expect(reveal).toContain("revealResult.textContent = outcome.data.value");
    expect(reveal).not.toMatch(
      /localStorage|sessionStorage|indexedDB|dataset\.\w+\s*=|setAttribute|document\.cookie/
    );
    expect(reveal).toContain("hideRevealed");
    expect(reveal).toContain("pagehide");
    expect(reveal).toContain("confirmAction(");
  });

  test("the reveal control is gated by suppliers.reveal and the add re-lists", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("data.canRevealIdentifier");
    expect(page).toContain('activityCode: "suppliers"');
    // The add answers a minimal ack with no id: the page must reload, not read
    // one back.
    const add = page.slice(page.indexOf('onSubmit("identifier-form"'));
    expect(add.slice(0, add.indexOf("onAction"))).toContain("mutateAndReload");
  });

  test("the endpoint is the audited, no-store one", async () => {
    const route = await readFile(
      `${API}/suppliers/[id]/identifiers/[identifierId]/reveal.ts`,
      "utf8"
    );
    expect(route).toContain("PROCUREMENT_GUARDS.suppliers.reveal");
    expect(route).toContain("no-store");
  });
});

describe("the navigation entry points at this page", () => {
  test("module is active with a seeded requiredPermission", () => {
    const procurement = listModules().find(
      (module) => module.key === "procurement"
    )!;
    const entry = procurement.navigation![0]!;

    expect(procurement.status).toBe("active");
    expect(entry.path).toBe("/admin/procurement");
    expect(declared().has(entry.requiredPermission!)).toBe(true);
  });
});

describe("review follow-ups (Issue #905)", () => {
  test("the reveal live region is persistent and Hide returns focus to the opener", async () => {
    const page = await readFile(PAGE, "utf8");
    const region = page.slice(
      page.indexOf('id="identifier-reveal-result"') - 80,
      page.indexOf('id="identifier-reveal-panel"')
    );

    expect(region).toContain('role="status"');
    expect(region).toContain('aria-live="polite"');
    // The region sits OUTSIDE the element that is hidden and un-hidden.
    expect(region).not.toContain("hidden");
    expect(page).toContain("revealOpener");
    expect(page).toContain("revealOpener.focus()");
  });

  test("the line row template has no required inputs and a half-filled row is caught before the request", async () => {
    const page = await readFile(PAGE, "utf8");
    const template = page.slice(
      page.indexOf('<template id="document-line-template">'),
      page.indexOf("</template>")
    );

    expect(template).not.toMatch(/\brequired\b/);
    expect(page).toContain("missingLineFields(");
  });

  test("a location select is only rendered when complete and non-empty", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("LOCATION_PICKER_MAX_PAGES");
    expect(page).toContain("locationsComplete");
    expect(page).toMatch(/activeLocations\.length > 0/);
    expect(page).not.toMatch(/\{mayLocations \? \(\s*<label for="document-/);
  });
});
