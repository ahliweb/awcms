/**
 * `/admin/inventory` and `/admin/tax` — the read half (Issue #894).
 *
 * Both modules shipped API-first and flipped to `active` in the change that
 * landed these screens, so the claim worth proving in a browser is the one the
 * flip makes: an owner can REACH each screen from the sidebar and every view of
 * it renders its real contents, not a refusal and not a blank 200.
 *
 * `admin-screens-render.e2e.ts` already sweeps the route list for status, shell
 * and absence of a denial hook, and `responsive-360.e2e.ts` for horizontal
 * overflow at four widths. What neither can say is whether the VIEWS inside a
 * screen render — they load `/admin/inventory`, never `?view=movements` — so
 * that is what this does, plus the sidebar entry, which a descriptor typo would
 * silently drop.
 *
 * A read-wave spec: GETs only. The write half is
 * `admin-inventory-tax-write.e2e.ts`.
 */
import { test, expect } from "./support/e2e-read-wave";

const seeded = Boolean(
  process.env.E2E_TENANT_ID &&
  process.env.E2E_LOGIN_IDENTIFIER &&
  process.env.E2E_PASSWORD
);

test.describe("inventory and tax screens (owner, read-only)", () => {
  test.skip(!seeded, "requires a seeded tenant");

  test("the sidebar offers both screens", async ({ page }) => {
    await page.goto("/admin");
    await expect(
      page.locator('a[href="/admin/inventory"]').first()
    ).toBeVisible();
    await expect(page.locator('a[href="/admin/tax"]').first()).toBeVisible();
  });

  test("every inventory view renders its contents", async ({ page }) => {
    await page.goto("/admin/inventory");
    await expect(page.locator("#inventory-denied")).toHaveCount(0);
    await expect(page.locator("#inventory-load-error")).toHaveCount(0);
    await expect(page.locator("#inventory-balances-heading")).toBeVisible();
    // The owner holds `policy.configure`, so the threshold form is offered.
    await expect(page.locator("#threshold-form")).toBeVisible();
    await expect(page.locator("#inventory-reconcile-link")).toBeVisible();

    await page.goto("/admin/inventory?view=movements");
    await expect(page.locator("#inventory-movements-heading")).toBeVisible();
    await expect(page.locator("#adjust-form")).toBeVisible();
    await expect(page.locator("#transfer-form")).toBeVisible();

    await page.goto("/admin/inventory?view=locations");
    await expect(page.locator("#inventory-locations-heading")).toBeVisible();
    await expect(page.locator("#location-form")).toBeVisible();
    await expect(page.locator("#tenant-policy-form")).toBeVisible();
  });

  test("reconciliation runs read-only and reports consistent", async ({
    page
  }) => {
    await page.goto("/admin/inventory?view=balances&reconcile=1");
    await expect(page.locator("#inventory-reconcile-result")).toHaveAttribute(
      "data-consistent",
      "true"
    );
  });

  test("a hostile filter value is ignored rather than breaking the page", async ({
    page
  }) => {
    const response = await page.goto(
      "/admin/inventory?view=movements&locationId=not-a-uuid&cursor=%00%00&movementType=nope"
    );
    expect(response?.status()).toBe(200);
    await expect(page.locator("#inventory-movements-heading")).toBeVisible();
  });

  test("every tax view renders its contents", async ({ page }) => {
    await page.goto("/admin/tax");
    await expect(page.locator("#tax-denied")).toHaveCount(0);
    await expect(page.locator("#tax-load-error")).toHaveCount(0);
    await expect(page.locator("#tax-profiles-heading")).toBeVisible();
    await expect(page.locator("#rule-version-form")).toBeVisible();

    await page.goto("/admin/tax?view=snapshots");
    await expect(page.locator("#tax-snapshots-heading")).toBeVisible();

    await page.goto("/admin/tax?view=report");
    await expect(page.locator("#tax-report-heading")).toBeVisible();
    await expect(page.locator("#tax-report-prompt")).toBeVisible();
  });

  test("the tax report runs for a valid period and refuses an invalid one", async ({
    page
  }) => {
    await page.goto("/admin/tax?view=report&from=2026-01-01&to=2026-01-31");
    await expect(page.locator("#tax-report-integrity")).toHaveAttribute(
      "data-consistent",
      "true"
    );

    await page.goto("/admin/tax?view=report&from=2026-02-01&to=2026-01-01");
    await expect(page.locator("#tax-report-period-invalid")).toBeVisible();
    await expect(page.locator("#tax-report-result")).toHaveCount(0);
  });

  test("a missing snapshot or version says so instead of rendering blank", async ({
    page
  }) => {
    await page.goto(
      "/admin/tax?view=snapshots&snapshot=00000000-0000-4000-8000-000000000000"
    );
    await expect(page.locator("#tax-snapshot-missing")).toBeVisible();

    await page.goto(
      "/admin/tax?view=rules&version=00000000-0000-4000-8000-000000000000"
    );
    await expect(page.locator("#tax-version-missing")).toBeVisible();
  });
});
