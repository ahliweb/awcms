/**
 * Authenticated admin write-action E2E (Issue #166) — exercises the
 * permission-gated create-office form on `/admin/offices`: log in through the
 * real `/login` form → session cookies → `/admin` guard → fill the create form
 * → `POST /api/v1/offices` via cookie auth → page reload → the new row appears
 * in the SSR-rendered `#offices-table`.
 *
 * Env-gated exactly like `admin-offices.e2e.ts`: the CI `e2e-smoke` job seeds a
 * tenant + owner via `POST /api/v1/setup/initialize` and hands the credentials
 * through env vars. Skipped (not failed) when they are absent, so a local
 * `bun run test:e2e` without a seeded DB stays green. The seeded owner role
 * holds every permission, so the `office_management.create` gate passes and the
 * form renders.
 */
import { test, expect } from "@playwright/test";
import { provideTenant } from "./support/e2e-auth";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

test.describe("admin offices create (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner creates an office and sees the new row appear", async ({
    page
  }) => {
    await page.goto("/login");
    await provideTenant(page, tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();

    // The client script redirects to /admin on success.
    await page.waitForURL("**/admin");

    await page.goto("/admin/offices");

    // The owner holds `office_management.create`, so the form renders.
    const form = page.locator("#office-create-form");
    await expect(form).toBeVisible();

    // A per-run unique code so re-running the suite doesn't collide on the
    // `(tenant_id, office_code)` uniqueness constraint.
    const newCode = `BR-E2E-${Date.now()}`;

    await page.locator("#office-code").fill(newCode);
    await page.locator("#office-name").fill("E2E Branch");
    await page.locator("#office-type").selectOption("branch");
    await page.locator("#office-create-submit").click();

    // The client reloads the page on success; wait for the SSR table to
    // re-render with the new row.
    const table = page.locator("#offices-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText(newCode);
    await expect(page.locator("#office-create-error")).toBeHidden();
  });
});
