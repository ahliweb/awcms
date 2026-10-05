/**
 * `/admin/procurement` — the write half (Issue #905).
 *
 * Drives the real forms end to end through cookie auth: every request below is
 * the page's own client script calling the existing `/api/v1/procurement/*`
 * endpoints, so a wrong URL, a missing `Idempotency-Key`, a body field the strict
 * validators refuse, or a script CSP silently killed all show up here as a row
 * that never appears.
 *
 * Every identifier carries a per-run suffix because the seeded tenant is shared
 * across the run and the ledger is append-only: nothing here can be cleaned up
 * afterwards, so nothing may collide with a re-run.
 */
import { test, expect } from "@playwright/test";

const seeded = Boolean(
  process.env.E2E_TENANT_ID &&
  process.env.E2E_LOGIN_IDENTIFIER &&
  process.env.E2E_PASSWORD
);

const run = Date.now().toString(36);
const codeA = `pe-a-${run}`;
const codeB = `pe-b-${run}`;
const vendor = `V-${run}`;
const item = `pitem-${run}`;
const secret = `TAX-${run}-123456789`;

test.describe.configure({ mode: "serial" });

async function fillLine(
  page: import("@playwright/test").Page,
  cost: string
): Promise<void> {
  const row = page.locator(".js-document-line").first();
  await row.locator('[name="itemRef"]').fill(item);
  await row.locator('[name="sku"]').fill(`SKU-${run}`);
  await row.locator('[name="itemName"]').fill("E2E widget");
  await row.locator('[name="quantity"]').fill("5");
  if (cost) await row.locator('[name="unitCost"]').fill(cost);
}

test.describe("procurement screen (owner, writes)", () => {
  test.skip(!seeded, "requires a seeded tenant");

  test("registers two stock locations (the inventory screen)", async ({
    page
  }) => {
    for (const [code, name] of [
      [codeA, "PE warehouse A"],
      [codeB, "PE warehouse B"]
    ] as const) {
      await page.goto("/admin/inventory?view=locations");
      await page.locator("#location-code").fill(code);
      await page.locator("#location-name").fill(name);
      await page.locator("#location-submit").click();
      await expect(page.locator("#inventory-locations-table")).toContainText(
        code
      );
    }
  });

  test("registers a supplier, edits it, and adds a masked identifier", async ({
    page
  }) => {
    await page.goto("/admin/procurement?view=suppliers");
    await page.locator("#supplier-code").fill(vendor);
    await page.locator("#supplier-name").fill("PE supplier");
    await page.locator("#supplier-categories").fill("e2e, goods");
    await page.locator("#supplier-submit").click();

    const table = page.locator("#procurement-suppliers-table");
    await expect(table).toContainText(vendor);
    // A duplicate vendor code is refused with its own message, not swallowed.
    await page.locator("#supplier-code").fill(vendor.toLowerCase());
    await page.locator("#supplier-name").fill("Duplicate");
    await page.locator("#supplier-submit").click();
    await expect(page.locator("#procurement-action-error")).toBeVisible();

    await page.goto("/admin/procurement?view=suppliers");
    await table
      .locator("tbody tr", { hasText: vendor })
      .locator("a")
      .first()
      .click();
    await page.locator("#supplier-edit-name").fill("PE supplier renamed");
    await page.locator("#supplier-edit-submit").click();
    await expect(page.locator("#procurement-supplier-heading")).toContainText(
      "PE supplier renamed"
    );

    await page.locator("#identifier-type").selectOption("tax_id");
    await page.locator("#identifier-value").fill(secret);
    await page.locator("#identifier-submit").click();

    const identifiers = page.locator("#procurement-identifiers-table");
    await expect(identifiers).toBeVisible();
    // Masked: the clear value is nowhere in the page.
    await expect(page.locator("body")).not.toContainText(secret);
  });

  test("reveals the identifier once, behind a confirmation, and drops it on hide", async ({
    page
  }) => {
    await page.goto("/admin/procurement?view=suppliers");
    await page
      .locator("#procurement-suppliers-table tbody tr", { hasText: vendor })
      .locator("a")
      .first()
      .click();

    await page.locator(".js-reveal-identifier").first().click();
    await page.locator("#confirm-dialog-confirm").click();
    await expect(page.locator("#identifier-reveal-result")).toHaveText(secret);

    await page.locator("#identifier-reveal-hide").click();
    await expect(page.locator(".js-reveal-identifier").first()).toBeFocused();
    await expect(page.locator("#identifier-reveal-panel")).toBeHidden();
    await expect(page.locator("body")).not.toContainText(secret);
  });

  test("receives stock: draft, submit, finalise, and the ledger agrees", async ({
    page
  }) => {
    await page.goto("/admin/procurement?view=documents");
    await page.locator("#document-mode").selectOption("receive");
    await page
      .locator("#document-supplier")
      .selectOption({ label: `PE supplier renamed (${vendor})` });
    await page
      .locator("#document-location")
      .selectOption({ label: `PE warehouse A (${codeA})` });
    await fillLine(page, "10");
    // A spare, untouched row (template defaults only) must not block the submit.
    await page.locator("#document-add-line").click();
    await page.locator("#document-submit").click();

    await expect(page.locator("#procurement-document-detail")).toHaveAttribute(
      "data-status",
      "draft"
    );
    await page.locator("#document-action-submit").click();
    await page.locator("#confirm-dialog-confirm").click();
    await expect(page.locator("#procurement-document-detail")).toHaveAttribute(
      "data-status",
      "submitted"
    );

    await page.locator("#document-action-finalise").click();
    await page.locator("#confirm-dialog-confirm").click();
    await expect(page.locator("#procurement-document-detail")).toHaveAttribute(
      "data-status",
      "finalised"
    );
    await expect(page.locator("#procurement-document-movements")).toBeVisible();

    await page.goto(
      `/admin/inventory?view=balances&itemRef=${encodeURIComponent(item)}`
    );
    await expect(page.locator("#inventory-balances-table")).toContainText(
      "5 unit"
    );

    await page.goto("/admin/procurement?view=reconciliation&run=1");
    await expect(page.locator("#procurement-reconcile-result")).toHaveAttribute(
      "data-consistent",
      "true"
    );
  });

  test("transfers part of it between locations as a paired document", async ({
    page
  }) => {
    await page.goto("/admin/procurement?view=documents");
    await page.locator("#document-mode").selectOption("transfer");
    await page
      .locator("#document-source-location")
      .selectOption({ label: `PE warehouse A (${codeA})` });
    await page
      .locator("#document-location")
      .selectOption({ label: `PE warehouse B (${codeB})` });
    const row = page.locator(".js-document-line").first();
    await row.locator('[name="itemRef"]').fill(item);
    await row.locator('[name="sku"]').fill(`SKU-${run}`);
    await row.locator('[name="itemName"]').fill("E2E widget");
    await row.locator('[name="quantity"]').fill("2");
    await page.locator("#document-submit").click();

    await page.locator("#document-action-submit").click();
    await page.locator("#confirm-dialog-confirm").click();
    await page.locator("#document-action-finalise").click();
    await page.locator("#confirm-dialog-confirm").click();
    await expect(page.locator("#procurement-document-detail")).toHaveAttribute(
      "data-status",
      "finalised"
    );

    await page.goto(
      `/admin/inventory?view=balances&itemRef=${encodeURIComponent(item)}`
    );
    const balances = page.locator("#inventory-balances-table");
    await expect(balances).toContainText("3 unit");
    await expect(balances).toContainText("2 unit");
  });

  test("reverses the transfer through the reason panel", async ({ page }) => {
    // The transfer, not the receipt: reversing the receipt would take back more
    // stock than warehouse A still holds, and the ledger would rightly refuse.
    await page.goto(
      "/admin/procurement?view=documents&mode=transfer&status=finalised"
    );
    await page
      .locator("#procurement-documents-table tbody tr")
      .first()
      .locator("a")
      .first()
      .click();

    await page.locator("#document-action-reverse").click();
    const panel = page.locator("[data-reason-panel]");
    await expect(panel).toBeVisible();
    await panel.locator("textarea").fill("Sent to the wrong warehouse");
    await panel.locator("[data-reason-panel-submit]").click();

    await expect(page.locator("#procurement-document-detail")).toHaveAttribute(
      "data-status",
      "reversed"
    );
    await expect(page.locator("#document-action-reverse")).toHaveCount(0);
  });

  test("cancels a draft with a mandatory reason", async ({ page }) => {
    await page.goto("/admin/procurement?view=documents");
    await page
      .locator("#document-supplier")
      .selectOption({ label: `PE supplier renamed (${vendor})` });
    await page
      .locator("#document-location")
      .selectOption({ label: `PE warehouse A (${codeA})` });
    await fillLine(page, "1");
    await page.locator("#document-submit").click();
    await expect(page.locator("#procurement-document-detail")).toHaveAttribute(
      "data-status",
      "draft"
    );

    await page.locator("#document-action-cancel").click();
    const panel = page.locator("[data-reason-panel]");
    await panel.locator("textarea").fill("Entered twice");
    await panel.locator("[data-reason-panel-submit]").click();
    await expect(page.locator("#procurement-document-detail")).toHaveAttribute(
      "data-status",
      "cancelled"
    );
  });

  test("sets and clears the approval threshold", async ({ page }) => {
    await page.goto("/admin/procurement?view=policy");
    await page.locator("#policy-threshold").fill("1000000");
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/procurement/policy") &&
        response.request().method() === "PUT"
    );
    await page.locator("#policy-submit").click();
    expect((await saved).status()).toBe(200);
    await page.waitForLoadState("load");
    await expect(page.locator("#procurement-policy-readout")).toHaveAttribute(
      "data-threshold",
      "1000000"
    );

    // Leave the shared tenant as it was found: approval off.
    await page.locator("#policy-threshold").fill("");
    const cleared = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/procurement/policy") &&
        response.request().method() === "PUT"
    );
    await page.locator("#policy-submit").click();
    expect((await cleared).status()).toBe(200);
    await page.waitForLoadState("load");
    await expect(page.locator("#procurement-policy-readout")).toHaveAttribute(
      "data-threshold",
      ""
    );
  });

  test("deletes and restores the supplier", async ({ page }) => {
    await page.goto("/admin/procurement?view=suppliers");
    await page
      .locator("#procurement-suppliers-table tbody tr", { hasText: vendor })
      .locator("a")
      .first()
      .click();
    await page.locator("#supplier-delete").click();
    // The client reloads on success; let that reload settle before navigating
    // away, or the goto aborts it.
    const deleted = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/procurement/suppliers/") &&
        response.request().method() === "DELETE"
    );
    await page.locator("#confirm-dialog-confirm").click();
    expect((await deleted).status()).toBe(200);
    await page.waitForLoadState("load");

    await page.goto("/admin/procurement?view=suppliers&includeDeleted=1");
    const row = page.locator("#procurement-suppliers-table tbody tr", {
      hasText: vendor
    });
    await expect(row).toHaveAttribute("data-deleted", "true");
    await row.locator(".js-supplier-restore").click();
    await expect(
      page.locator("#procurement-suppliers-table tbody tr", {
        hasText: vendor
      })
    ).toHaveAttribute("data-deleted", "false");
  });
});
