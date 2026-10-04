/**
 * `/admin/inventory` and `/admin/tax` — the write half (Issue #894).
 *
 * Drives the real forms end to end through cookie auth: every request below is
 * the page's own client script calling the existing `/api/v1/inventory/*` and
 * `/api/v1/tax/*` endpoints, so a wrong URL, a missing `Idempotency-Key`, a
 * body field the strict validators refuse, or a script CSP silently killed all
 * show up here as a row that never appears.
 *
 * Every identifier carries a per-run suffix because the seeded tenant is shared
 * across the run and the ledger is append-only: nothing here can be cleaned up
 * afterwards, so nothing here may collide with a re-run.
 */
import { test, expect } from "@playwright/test";

const seeded = Boolean(
  process.env.E2E_TENANT_ID &&
  process.env.E2E_LOGIN_IDENTIFIER &&
  process.env.E2E_PASSWORD
);

const run = Date.now().toString(36);
const codeA = `e2e-a-${run}`;
const codeB = `e2e-b-${run}`;
const itemKept = `kept-${run}`;
const itemReversed = `rev-${run}`;

test.describe.configure({ mode: "serial" });

test.describe("inventory and tax screens (owner, writes)", () => {
  test.skip(!seeded, "requires a seeded tenant");

  test("registers two locations", async ({ page }) => {
    for (const [code, name] of [
      [codeA, "E2E warehouse A"],
      [codeB, "E2E warehouse B"]
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

  test("posts an adjustment, transfers part of it, and sees both ends in the ledger", async ({
    page
  }) => {
    await page.goto("/admin/inventory?view=movements");
    await page
      .locator("#adjust-location")
      .selectOption({ label: `E2E warehouse A (${codeA})` });
    await page.locator("#adjust-item-type").fill("product");
    await page.locator("#adjust-item-ref").fill(itemKept);
    await page.locator("#adjust-quantity").fill("5");
    await page.locator("#adjust-submit").click();

    const table = page.locator("#inventory-movements-table");
    await expect(table).toContainText(itemKept);

    await page
      .locator("#transfer-from")
      .selectOption({ label: `E2E warehouse A (${codeA})` });
    await page
      .locator("#transfer-to")
      .selectOption({ label: `E2E warehouse B (${codeB})` });
    await page.locator("#transfer-item-type").fill("product");
    await page.locator("#transfer-item-ref").fill(itemKept);
    await page.locator("#transfer-quantity").fill("2");
    await page.locator("#transfer-submit").click();

    await expect(
      table.locator('tr:has-text("' + itemKept + '")[data-movement-id]')
    ).toHaveCount(3);
    await expect(
      table.locator('[data-operation="transfer_out"]')
    ).not.toHaveCount(0);
    await expect(
      table.locator('[data-operation="transfer_in"]')
    ).not.toHaveCount(0);

    await page.goto(
      `/admin/inventory?view=balances&itemRef=${encodeURIComponent(itemKept)}`
    );
    const balances = page.locator("#inventory-balances-table");
    await expect(balances.locator("tbody tr")).toHaveCount(2);
    await expect(balances).toContainText("3 unit");
    await expect(balances).toContainText("2 unit");
  });

  test("reverses an adjustment through the reason panel", async ({ page }) => {
    await page.goto("/admin/inventory?view=movements");
    await page
      .locator("#adjust-location")
      .selectOption({ label: `E2E warehouse A (${codeA})` });
    await page.locator("#adjust-item-type").fill("product");
    await page.locator("#adjust-item-ref").fill(itemReversed);
    await page.locator("#adjust-quantity").fill("1");
    await page.locator("#adjust-submit").click();

    const table = page.locator("#inventory-movements-table");
    const row = table.locator(`tr:has-text("${itemReversed}")`);
    await expect(row).toHaveCount(1);

    await row.locator(".js-reverse-adjustment").click();

    const panel = page.locator("[data-reason-panel]");
    await expect(panel).toBeVisible();
    await panel.locator("textarea").fill("Entered against the wrong item");
    await panel.locator("[data-reason-panel-submit]").click();

    // The page reloads; the compensating row is a `reversal` operation, and the
    // original no longer offers a Reverse button (Issue #900) — the listing now
    // says it has been reversed.
    await expect(
      table.locator(
        `tr:has-text("${itemReversed}") [data-operation="reversal"]`
      )
    ).toHaveCount(1);
    await expect(
      table.locator(`tr:has-text("${itemReversed}") .js-reverse-adjustment`)
    ).toHaveCount(0);
  });

  test("sets a low-stock threshold and sees the signal", async ({ page }) => {
    await page.goto("/admin/inventory?view=balances");
    await page
      .locator("#threshold-location")
      .selectOption({ label: `E2E warehouse A (${codeA})` });
    await page.locator("#threshold-item-type").fill("product");
    await page.locator("#threshold-item-ref").fill(itemKept);
    await page.locator("#threshold-value").fill("10");
    // The client reloads the page on success; wait for the response, then let the
    // reload settle before navigating away, or the goto aborts the reload.
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/inventory/balances/threshold") &&
        response.request().method() === "PUT"
    );
    await page.locator("#threshold-submit").click();
    expect((await saved).status()).toBe(200);
    await page.waitForLoadState("load");

    await page.goto(
      `/admin/inventory?view=balances&lowStockOnly=1&itemRef=${encodeURIComponent(itemKept)}`
    );
    await expect(
      page.locator('#inventory-balances-table [data-low="true"]')
    ).toHaveCount(1);
  });

  test("changes a location's negative-stock policy and deactivates it", async ({
    page
  }) => {
    await page.goto("/admin/inventory?view=locations");
    const row = page.locator(`tr:has-text("${codeB}")`);
    await row.locator(".js-location-policy").selectOption("allow");
    await row.locator(".js-save-location-policy").click();
    await expect(
      page.locator(`tr:has-text("${codeB}") .js-location-policy`)
    ).toHaveValue("allow");

    await page
      .locator(`tr:has-text("${codeB}")`)
      .locator('.js-location-status[data-next-status="inactive"]')
      .click();
    await page.locator("#confirm-dialog-confirm").click();
    await expect(
      page.locator(`tr:has-text("${codeB}") [data-status="inactive"]`)
    ).toHaveCount(1);
  });

  test("renames a location through the details control", async ({ page }) => {
    await page.goto("/admin/inventory?view=locations");
    const row = page.locator(`tr:has-text("${codeA}")`);
    await row.locator(".js-location-name").fill(`E2E renamed ${run}`);
    await row.locator(".js-save-location-details").click();
    await expect(
      page.locator(`tr:has-text("${codeA}") .js-location-name`)
    ).toHaveValue(`E2E renamed ${run}`);
  });

  test("rebuilds balances behind a confirmation and reports the result", async ({
    page
  }) => {
    await page.goto("/admin/inventory?view=balances");
    await page.locator("#rebuild-submit").click();
    await page.locator("#confirm-dialog-confirm").click();
    await expect(page.locator("#inventory-rebuild-result")).toBeVisible();
    await expect(page.locator("#inventory-action-error")).toBeHidden();
  });

  test("builds a tax draft with the structured editor", async ({ page }) => {
    const profile = `e2e-ed-${run}`;
    const later = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    await page.goto("/admin/tax?view=rules");
    await page.locator("#draft-profile").fill(profile);
    await page.locator("#draft-name").fill("E2E structured");
    await page.locator("#draft-jurisdiction").fill("e2e-jurisdiction");
    await page.locator("#draft-currency").fill("USD");
    await page.locator("#draft-effective").fill(later);

    const editor = page.locator("#tax-definition-editor");
    await expect(editor).toBeVisible();

    // Locale-independent hooks: the visible labels are translated.
    await editor.locator('[data-editor-action="add-category"]').click();
    const category = editor.locator("fieldset.tax-editor-row").first();
    await category.locator('[data-editor-field="code"]').fill("general");
    await category.locator('[data-editor-field="name"]').fill("General");

    // The initial rule is a taxable fallback with one blank component.
    // The last row is the component (the rule row that contains it comes first).
    const component = editor.locator("fieldset.tax-editor-row").last();
    await component.locator('[data-editor-field="code"]').fill("tax-1");
    await component.locator('[data-editor-field="name"]').fill("Tax");
    await component.locator('[data-editor-field="rate"]').fill("7.50");

    await expect(page.locator("#draft-definition")).toHaveValue(
      /"rate": "7\.50"/
    );

    await page.locator("#draft-submit").click();
    await expect(
      page.locator(`#tax-versions-table tr:has-text("${profile}")`)
    ).toHaveCount(1);
  });

  test("authors a tax draft and publishes it after confirmation", async ({
    page
  }) => {
    const profile = `e2e-${run}`;
    const tomorrow = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    await page.goto("/admin/tax?view=rules");
    await page.locator("#draft-profile").fill(profile);
    await page.locator("#draft-name").fill("E2E rule profile");
    await page.locator("#draft-jurisdiction").fill("e2e-jurisdiction");
    await page.locator("#draft-currency").fill("USD");
    await page.locator("#draft-effective").fill(tomorrow);
    // The raw JSON lives in a disclosure once the structured editor is up.
    await page.locator("#tax-definition-advanced summary").click();
    await page.locator("#draft-definition").fill(
      JSON.stringify({
        categories: [{ code: "general", name: "General" }],
        rules: [
          {
            categoryCode: "general",
            treatment: "taxable",
            components: [
              { code: "tax-1", name: "Tax", rate: "0.10", basis: "net" }
            ]
          }
        ]
      })
    );
    await page.locator("#draft-submit").click();

    const row = page.locator(`#tax-versions-table tr:has-text("${profile}")`);
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-status="draft"]')).toHaveCount(1);

    await row.locator(".js-publish-version").click();
    await page.locator("#confirm-dialog-confirm").click();

    await expect(
      page.locator(
        `#tax-versions-table tr:has-text("${profile}") [data-status="published"]`
      )
    ).toHaveCount(1);
  });

  test("a draft the server rejects shows a safe message, not its internals", async ({
    page
  }) => {
    await page.goto("/admin/tax?view=rules");
    await page.locator("#draft-profile").fill(`bad-${run}`);
    await page.locator("#draft-name").fill("Bad draft");
    await page.locator("#draft-jurisdiction").fill("e2e-jurisdiction");
    await page.locator("#draft-currency").fill("USD");
    await page.locator("#draft-effective").fill("2099-01-01");
    await page.locator("#tax-definition-advanced summary").click();
    await page
      .locator("#draft-definition")
      .fill('{"categories":[],"rules":[]}');
    await page.locator("#draft-submit").click();

    const error = page.locator("#tax-action-error");
    await expect(error).toBeVisible();
    await expect(error).not.toContainText(/stack|postgres|definition\.rules/i);
  });
});
