/**
 * `/admin/procurement` — the read half (Issue #905).
 *
 * The module flipped to `active` in the change that landed this screen, so the
 * claim worth proving in a browser is the one the flip makes: an owner can REACH
 * the screen from the sidebar and every view renders its real contents — not a
 * refusal and not a blank 200 — and stays inside 360px.
 *
 * A read-wave spec: GETs only. The write half is
 * `admin-procurement-write.e2e.ts`.
 */
import { test, expect } from "./support/e2e-read-wave";

const seeded = Boolean(
  process.env.E2E_TENANT_ID &&
  process.env.E2E_LOGIN_IDENTIFIER &&
  process.env.E2E_PASSWORD
);

test.describe("procurement screen (owner, read-only)", () => {
  test.skip(!seeded, "requires a seeded tenant");

  test("the sidebar offers the screen", async ({ page }) => {
    await page.goto("/admin");
    await expect(
      page.locator('a[href="/admin/procurement"]').first()
    ).toBeVisible();
  });

  test("every view renders its contents", async ({ page }) => {
    await page.goto("/admin/procurement");
    await expect(page.locator("#procurement-denied")).toHaveCount(0);
    await expect(page.locator("#procurement-load-error")).toHaveCount(0);
    await expect(page.locator("#procurement-suppliers-heading")).toBeVisible();
    await expect(page.locator("#supplier-form")).toBeVisible();

    await page.goto("/admin/procurement?view=documents");
    await expect(page.locator("#procurement-documents-heading")).toBeVisible();
    await expect(page.locator("#document-form")).toBeVisible();
    // The receipt mode shows the supplier, not the source location.
    await expect(page.locator("#document-mode")).toHaveValue("receive");
    await expect(page.locator("#document-source-location")).toBeHidden();
    await page.locator("#document-mode").selectOption("transfer");
    await expect(page.locator("#document-source-location")).toBeVisible();
    await expect(page.locator("#document-supplier")).toBeHidden();

    await page.goto("/admin/procurement?view=policy");
    await expect(page.locator("#procurement-policy-heading")).toBeVisible();
    await expect(page.locator("#policy-form")).toBeVisible();

    await page.goto("/admin/procurement?view=reports");
    await expect(page.locator("#procurement-reports-heading")).toBeVisible();
    await expect(page.locator("#procurement-receiving-heading")).toBeVisible();

    await page.goto("/admin/procurement?view=reconciliation");
    await expect(
      page.locator("#procurement-reconciliation-heading")
    ).toBeVisible();
  });

  test("reconciliation runs read-only and reports consistent", async ({
    page
  }) => {
    await page.goto("/admin/procurement?view=reconciliation&run=1");
    await expect(page.locator("#procurement-reconcile-result")).toHaveAttribute(
      "data-consistent",
      "true"
    );
  });

  test("an invalid report period is refused rather than run", async ({
    page
  }) => {
    await page.goto(
      "/admin/procurement?view=reports&from=2026-02-01&to=2026-01-01"
    );
    await expect(
      page.locator("#procurement-report-period-invalid")
    ).toBeVisible();
    await expect(page.locator("#procurement-receiving-table")).toHaveCount(0);
  });

  test("hostile filter values are ignored rather than breaking the page", async ({
    page
  }) => {
    const response = await page.goto(
      "/admin/procurement?view=documents&mode=nope&status=nope&cursor=%00%00&document=not-a-uuid"
    );
    expect(response?.status()).toBe(200);
    await expect(page.locator("#procurement-documents-heading")).toBeVisible();
  });

  test("a missing document or supplier says so instead of rendering blank", async ({
    page
  }) => {
    await page.goto(
      "/admin/procurement?view=documents&document=00000000-0000-4000-8000-000000000000"
    );
    await expect(page.locator("#procurement-detail-missing")).toBeVisible();

    await page.goto(
      "/admin/procurement?view=suppliers&supplier=00000000-0000-4000-8000-000000000000"
    );
    await expect(page.locator("#procurement-detail-missing")).toBeVisible();
  });

  test("the views do not scroll sideways at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    for (const view of [
      "suppliers",
      "documents",
      "policy",
      "reports",
      "reconciliation"
    ]) {
      await page.goto(`/admin/procurement?view=${view}`);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(overflow, `${view} overflows at 360px`).toBeLessThanOrEqual(0);
    }
  });
});
